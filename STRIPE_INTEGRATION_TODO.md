# Stripe Integration TODO

Scenario **B** applied: no existing Checkout Session call was found, so a minimal Hosted Checkout endpoint was added.

When this checklist is done, Checkout Studio / Dashboard setup is complete enough to take test payments.

## Values to Replace

The following values are placeholders (or must be confirmed) before going live.

**Files containing placeholders / env-driven Checkout values:**
- [src/api/stripeCheckout.ts](src/api/stripeCheckout.ts)
- [.env.example](.env.example)
- Your local [.env](.env) (not committed)

| Field | Current Value | What to Set |
|-------|--------------|-------------|
| mode | `subscription` | Keep `subscription` for recurring Premium. Switch to `payment` only for one-time charges (and then remove `payment_method_collection`). |
| success_url | `${DOMAIN\|AUTH_PUBLIC_ORIGIN}/premium?checkout=success&session_id={CHECKOUT_SESSION_ID}` | Confirm this is the page users should land on after paying. Keep `{CHECKOUT_SESSION_ID}`. |
| cancel_url | `${DOMAIN\|AUTH_PUBLIC_ORIGIN}/premium?checkout=cancel` | Confirm cancel/return page (currently Premium). |
| line_items[].price | `process.env.STRIPE_PRICE_ID` (fallback `price_...`) | Set `STRIPE_PRICE_ID` in `.env` to your real Stripe Price ID from the [Dashboard Prices](https://dashboard.stripe.com/prices) page. |
| STRIPE_SECRET_KEY | empty / `sk_test_...` | Paste your secret key from [API keys](https://dashboard.stripe.com/test/apikeys). |
| STRIPE_WEBHOOK_SECRET | empty / `whsec_...` | From the webhook endpoint signing secret in [Workbench → Webhooks](https://dashboard.stripe.com/workbench/webhooks). |
| DOMAIN | optional | Set to your public origin (e.g. `http://localhost:8787` or `https://investatlant.com`). Falls back to `AUTH_PUBLIC_ORIGIN`. |

**ui_mode note:** Installed `stripe` SDK is **v22.x** (≥ 21.0.0), so `ui_mode` is set to `hosted_page`. If you ever pin an SDK below 21.0.0, change it to `hosted`.

## Configured Parameters

These parameters were configured in Checkout Studio and are already set in code.

**Files containing these parameters:**
- [src/api/stripeCheckout.ts](src/api/stripeCheckout.ts)

| Parameter | Value |
|-----------|-------|
| ui_mode | `hosted_page` |
| billing_address_collection | `auto` |
| phone_number_collection.enabled | `false` |
| automatic_tax.enabled | `false` |
| allow_promotion_codes | `false` |
| payment_method_collection | `always` (included because `mode` is `subscription`) |
| submit_type | `auto` |
| integration_identifier | `hosted_web_0001` |
| origin_context | `web` |

## Setup and next steps

### 1. Environment variables

Copy from [.env.example](.env.example) into `.env` (you may already have some Stripe keys):

```bash
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_ID=price_...
DOMAIN=http://localhost:8787
```

Naming matches this Node server (no `VITE_` prefix — keys are server-side only).

### 2. Dependencies

Already added:

```bash
npm install stripe
```

(`stripe@22.x` in `package.json`)

### 3. Project structure (new / touched)

| Path | Role |
|------|------|
| [src/api/stripeCheckout.ts](src/api/stripeCheckout.ts) | `POST /api/create-checkout-session`, `POST /api/stripe/webhook` |
| [src/auth/repository.ts](src/auth/repository.ts) | Persist `stripe_customer_id` / `stripe_subscription_id` + set `plan=premium` |
| [server.mjs](server.mjs) | Routes the two Stripe handlers |
| [.env.example](.env.example) | Documents Stripe env vars |
| [STRIPE_INTEGRATION_TODO.md](STRIPE_INTEGRATION_TODO.md) | This checklist |

### 4. How the integration works

1. Logged-in user `POST`s `/api/create-checkout-session` (session cookie required).
2. Server creates a Stripe Checkout Session (`mode: subscription`, Hosted Checkout) and returns JSON `{ url, id }`.
3. Browser navigates to `url` (Stripe-hosted Checkout).
4. Customer pays on Stripe’s hosted page.
5. Stripe sends `checkout.session.completed` to `/api/stripe/webhook`.
6. Webhook verifies the signature (when `STRIPE_WEBHOOK_SECRET` is set), then updates `app_user` with Stripe IDs and `plan = premium`.

### 5. Start Checkout from the UI

Wire any Premium CTA to create a session and redirect, for example:

```js
const res = await fetch("/api/create-checkout-session", {
  method: "POST",
  credentials: "include",
});
const data = await res.json();
if (!res.ok) throw new Error(data.message || data.error);
window.location.href = data.url;
```

Users must be logged in first; unauthenticated requests get `401`.

### 6. Webhook setup

1. Stripe Dashboard → Developers / Workbench → Webhooks → Add endpoint.
2. URL: `https://YOUR_DOMAIN/api/stripe/webhook` (for local: Stripe CLI `stripe listen --forward-to localhost:8787/api/stripe/webhook`).
3. Subscribe at least to `checkout.session.completed`.
4. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.

### 7. Testing

Use Stripe test mode keys and [test cards](https://docs.stripe.com/testing):

| Card | Result |
|------|--------|
| `4242 4242 4242 4242` | Success |
| `4000 0000 0000 9995` | Decline |

Any future expiry, any CVC, any postal code.

### 8. Next steps after first successful test payment

- Confirm the test user has `plan = premium` and Stripe IDs populated in `app_user`.
- Optionally handle `customer.subscription.updated` / `customer.subscription.deleted` to revoke Premium on cancel.
- Add a Customer Portal session endpoint for self-serve cancel/update.
- Replace test keys with live keys when going to production.
- Point success/cancel URLs at production `DOMAIN`.
- Wire the Premium page / gate CTAs to `/api/create-checkout-session`.

### Resources

- https://docs.stripe.com/mcp
- https://docs.stripe.com/checkout/quickstart
- https://docs.stripe.com/webhooks
- https://support.stripe.com
