/**
 * Stripe Hosted Checkout + Customer Portal + webhook fulfillment.
 * Unlocks Premium on checkout.session.completed and keeps plan in sync via
 * customer.subscription.updated / deleted.
 */
import type http from "node:http";
import Stripe from "stripe";
import { AuthError, getAuthRepository, requireUser } from "../auth/index.js";
import { loadEnvFile } from "../db/pool.js";

loadEnvFile();

const CREATE_RE = /^\/api\/create-checkout-session\/?$/;
const PORTAL_RE = /^\/api\/create-portal-session\/?$/;
const WEBHOOK_RE = /^\/api\/stripe\/webhook\/?$/;
const OFFER_RE = /^\/api\/stripe\/premium-offer\/?$/;

/** Premium is billed as a recurring subscription. */
const CHECKOUT_MODE = "subscription" as const;

let stripeClient: Stripe | null = null;
let stripeClientKey: string | null = null;

function getStripe(): Stripe {
  // Re-read .env in case the process was started before keys were added.
  loadEnvFile();
  const key = String(process.env.STRIPE_SECRET_KEY || "").trim();
  if (!key) {
    throw Object.assign(new Error("STRIPE_SECRET_KEY is not set"), { status: 503 });
  }
  if (!stripeClient || stripeClientKey !== key) {
    stripeClient = new Stripe(key);
    stripeClientKey = key;
  }
  return stripeClient;
}

function isLiveStripeKey(): boolean {
  return String(process.env.STRIPE_SECRET_KEY || "").trim().startsWith("sk_live_");
}

function publicDomain(): string {
  return (
    process.env.DOMAIN ||
    process.env.AUTH_PUBLIC_ORIGIN ||
    "http://localhost:8787"
  ).replace(/\/$/, "");
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, no-store",
  });
  res.end(JSON.stringify(body));
}

async function readRawBody(req: http.IncomingMessage, maxBytes = 1_048_576): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > maxBytes) {
      throw Object.assign(new Error("body_too_large"), { status: 413 });
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}

function formatMoney(unitAmount: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(unitAmount / 100);
  } catch {
    return `$${(unitAmount / 100).toFixed(2)}`;
  }
}

function stripeId(
  value: string | { id?: string } | null | undefined
): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && value.id) return String(value.id);
  return null;
}

function unixToDate(sec: number | null | undefined): Date | null {
  if (sec == null || !Number.isFinite(sec)) return null;
  return new Date(sec * 1000);
}

/**
 * GET /api/stripe/premium-offer — public price display for the Premium page.
 */
export async function tryHandlePremiumOffer(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<boolean> {
  if (!OFFER_RE.test(url.pathname)) return false;

  if (req.method !== "GET") {
    json(res, 405, { error: "method_not_allowed", message: "Use GET." });
    return true;
  }

  try {
    const stripe = getStripe();
    const priceId = String(process.env.STRIPE_PRICE_ID || "").trim();
    if (!priceId || priceId === "price_...") {
      json(res, 503, {
        error: "price_not_configured",
        message: "STRIPE_PRICE_ID is not set.",
      });
      return true;
    }

    const price = await stripe.prices.retrieve(priceId);
    const amount = typeof price.unit_amount === "number" ? price.unit_amount : null;
    const currency = String(price.currency || "usd").toLowerCase();
    const interval = price.recurring?.interval || null;
    const intervalCount = price.recurring?.interval_count || 1;

    json(res, 200, {
      priceId: price.id,
      amount,
      currency,
      interval,
      intervalCount,
      livemode: Boolean(price.livemode),
      formatted: amount != null ? formatMoney(amount, currency) : null,
      label:
        amount != null && interval
          ? `${formatMoney(amount, currency)}/${intervalCount > 1 ? `${intervalCount} ${interval}s` : interval}`
          : amount != null
            ? formatMoney(amount, currency)
            : null,
    });
  } catch (err) {
    const status = Number((err as { status?: number })?.status) || 500;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[stripe] premium-offer:", message);
    json(res, status >= 400 && status < 600 ? status : 500, {
      error: "premium_offer_failed",
      message,
    });
  }
  return true;
}

/**
 * POST /api/create-checkout-session — create a Hosted Checkout Session and redirect.
 * Requires a logged-in session cookie.
 */
export async function tryHandleCreateCheckoutSession(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<boolean> {
  if (!CREATE_RE.test(url.pathname)) return false;

  if (req.method !== "POST") {
    json(res, 405, { error: "method_not_allowed", message: "Use POST." });
    return true;
  }

  try {
    const user = await requireUser(req);
    const stripe = getStripe();
    const priceId = String(process.env.STRIPE_PRICE_ID || "").trim();
    if (!priceId || priceId === "price_...") {
      json(res, 503, {
        error: "price_not_configured",
        message: "STRIPE_PRICE_ID is not set.",
      });
      return true;
    }
    const domain = publicDomain();

    if (isLiveStripeKey() && !/^https:\/\//i.test(domain)) {
      json(res, 503, {
        error: "domain_not_https",
        message: "DOMAIN must be an https origin when using live Stripe keys.",
      });
      return true;
    }

    // fixed_by_ui values from Checkout Studio + sample_only mode/urls/line_items.
    // Cast: integration_identifier / origin_context are Checkout Studio fields
    // not yet present on the installed SDK typings.
    const sessionParams = {
      ui_mode: "hosted_page",
      mode: CHECKOUT_MODE,
      billing_address_collection: "auto",
      phone_number_collection: { enabled: false },
      automatic_tax: { enabled: false },
      allow_promotion_codes: false,
      payment_method_collection: "always",
      submit_type: "auto",
      integration_identifier: "hosted_web_0001",
      origin_context: "web",
      success_url: `${domain}/premium?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${domain}/premium?checkout=cancel`,
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: String(user.id),
      customer_email: user.stripeCustomerId ? undefined : user.email,
      customer: user.stripeCustomerId || undefined,
      metadata: {
        user_id: String(user.id),
        integration_identifier: "hosted_web_0001",
      },
    } as Stripe.Checkout.SessionCreateParams;

    const session = await stripe.checkout.sessions.create(sessionParams);

    if (!session.url) {
      json(res, 502, { error: "checkout_url_missing", message: "Stripe did not return a Checkout URL." });
      return true;
    }

    // Return the URL as JSON so the SPA can navigate with window.location.
    // A 303 + fetch(credentials:"include") fails CORS when following Stripe's host.
    json(res, 200, { url: session.url, id: session.id });
  } catch (err) {
    if (err instanceof AuthError) {
      json(res, err.status, { error: err.code, message: err.message });
      return true;
    }
    const status = Number((err as { status?: number })?.status) || 500;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[stripe] create-checkout-session:", message);
    json(res, status >= 400 && status < 600 ? status : 500, {
      error: "checkout_session_failed",
      message,
    });
  }
  return true;
}

/**
 * POST /api/create-portal-session — Stripe Customer Portal (cancel / update payment).
 */
export async function tryHandleCreatePortalSession(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<boolean> {
  if (!PORTAL_RE.test(url.pathname)) return false;

  if (req.method !== "POST") {
    json(res, 405, { error: "method_not_allowed", message: "Use POST." });
    return true;
  }

  try {
    const user = await requireUser(req);
    if (!user.stripeCustomerId) {
      json(res, 400, {
        error: "no_stripe_customer",
        message: "No Stripe billing account on this user yet. Upgrade to Premium first.",
      });
      return true;
    }

    const stripe = getStripe();
    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${publicDomain()}/premium`,
    });

    if (!session.url) {
      json(res, 502, { error: "portal_url_missing", message: "Stripe did not return a Portal URL." });
      return true;
    }

    json(res, 200, { url: session.url });
  } catch (err) {
    if (err instanceof AuthError) {
      json(res, err.status, { error: err.code, message: err.message });
      return true;
    }
    const status = Number((err as { status?: number })?.status) || 500;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[stripe] create-portal-session:", message);
    json(res, status >= 400 && status < 600 ? status : 500, {
      error: "portal_session_failed",
      message,
    });
  }
  return true;
}

function subscriptionPeriod(sub: Stripe.Subscription): {
  start: Date | null;
  end: Date | null;
} {
  const item = sub.items?.data?.[0];
  return {
    start: unixToDate(item?.current_period_start),
    end: unixToDate(item?.current_period_end),
  };
}

async function syncSubscription(sub: Stripe.Subscription): Promise<void> {
  const customerId = stripeId(sub.customer);
  const period = subscriptionPeriod(sub);
  const updated = await getAuthRepository().applyStripeSubscription({
    customerId,
    subscriptionId: sub.id,
    status: sub.status,
    currentPeriodStart: period.start,
    currentPeriodEnd: period.end,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
  });
  if (!updated) {
    console.warn(
      "[stripe] subscription sync: no app_user for",
      sub.id,
      customerId || "(no customer)"
    );
  }
}

async function fulfillCheckoutSession(session: Stripe.Checkout.Session): Promise<void> {
  const userIdRaw =
    session.client_reference_id ||
    (session.metadata && session.metadata.user_id) ||
    "";
  const userId = Number(userIdRaw);
  if (!Number.isFinite(userId) || userId <= 0) {
    console.warn("[stripe] checkout.session.completed missing user id", session.id);
    return;
  }

  const customerId = stripeId(session.customer);
  const subscriptionId = stripeId(session.subscription);

  await getAuthRepository().applyStripeCheckout(userId, {
    customerId,
    subscriptionId,
    subscriptionStatus: "active",
  });

  if (subscriptionId) {
    try {
      const stripe = getStripe();
      const sub = await stripe.subscriptions.retrieve(subscriptionId);
      await syncSubscription(sub);
    } catch (err) {
      console.warn(
        "[stripe] could not sync subscription after checkout:",
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  if (session.consent?.terms_of_service === "accepted") {
    console.log("[stripe] Customer accepted terms of service", session.id);
  }
  if (session.consent?.promotions === "opt_in") {
    const email = session.customer_details?.email;
    console.log("[stripe] Customer opted in for promotional emails:", email);
  }
}

/**
 * POST /api/stripe/webhook — verify Stripe signatures and fulfill Checkout / subscriptions.
 */
export async function tryHandleStripeWebhook(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<boolean> {
  if (!WEBHOOK_RE.test(url.pathname)) return false;

  if (req.method !== "POST") {
    json(res, 405, { error: "method_not_allowed", message: "Use POST." });
    return true;
  }

  try {
    const stripe = getStripe();
    const rawBody = await readRawBody(req);
    const endpointSecret = String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
    let event: Stripe.Event;

    if (isLiveStripeKey() && !endpointSecret) {
      console.error("[stripe] STRIPE_WEBHOOK_SECRET is required with live keys.");
      json(res, 503, {
        error: "webhook_secret_required",
        message: "STRIPE_WEBHOOK_SECRET is required in live mode.",
      });
      return true;
    }

    if (endpointSecret) {
      const signature = req.headers["stripe-signature"];
      if (!signature || Array.isArray(signature)) {
        json(res, 400, { error: "missing_signature", message: "Missing Stripe-Signature header." });
        return true;
      }
      try {
        event = stripe.webhooks.constructEvent(rawBody, signature, endpointSecret);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[stripe] Webhook signature verification failed.", message);
        res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(`Webhook Error: ${message}`);
        return true;
      }
    } else {
      // Local/dev without a webhook secret — parse JSON body only.
      event = JSON.parse(rawBody.toString("utf8")) as Stripe.Event;
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        console.log("[stripe] Checkout completed:", session.id);
        await fulfillCheckoutSession(session);
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        console.log(`[stripe] ${event.type}:`, sub.id, sub.status);
        await syncSubscription(sub);
        break;
      }
      default:
        console.log("[stripe] Unhandled event type:", event.type);
    }

    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ received: true }));
  } catch (err) {
    const status = Number((err as { status?: number })?.status) || 500;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[stripe] webhook:", message);
    json(res, status >= 400 && status < 600 ? status : 500, {
      error: "webhook_failed",
      message,
    });
  }
  return true;
}
