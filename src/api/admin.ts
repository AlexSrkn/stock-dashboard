/**
 * Admin API — list users and manually grant/revoke Premium.
 *
 * Access model:
 * - Mutating requests require a same-origin admin session.
 * - Auth failures answer as 404 so the admin surface is not advertised.
 */
import type http from "node:http";
import {
  AuthError,
  canAccessPremiumContent,
  getAuthRepository,
  requireAdminUser,
  type UserPlan,
} from "../auth/index.js";
import { loadEnvFile } from "../db/pool.js";

loadEnvFile();

const USERS_RE = /^\/api\/admin\/users\/?$/;
const USER_PLAN_RE = /^\/api\/admin\/users\/(\d+)\/plan\/?$/;

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, no-store",
    "X-Robots-Tag": "noindex, nofollow",
  });
  res.end(JSON.stringify(body));
}

function notFound(res: http.ServerResponse) {
  json(res, 404, { error: "not_found", message: "Not found." });
}

function requestOrigin(req: http.IncomingMessage): string | null {
  const origin = String(req.headers.origin || "").trim();
  if (origin) return origin.replace(/\/$/, "");
  const referer = String(req.headers.referer || "").trim();
  if (!referer) return null;
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function expectedOrigins(req: http.IncomingMessage): Set<string> {
  const out = new Set<string>();
  const host = String(req.headers.host || "").trim();
  if (host) {
    out.add(`http://${host}`);
    out.add(`https://${host}`);
  }
  const configured = String(process.env.AUTH_PUBLIC_ORIGIN || "").trim().replace(/\/$/, "");
  if (configured) out.add(configured);
  return out;
}

/** Block cross-site POSTs that somehow carry the session cookie. */
function assertSameOriginAdminRequest(req: http.IncomingMessage): void {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = requestOrigin(req);
  if (!origin) {
    throw new AuthError(403, "origin_required", "Missing Origin.");
  }
  if (!expectedOrigins(req).has(origin)) {
    throw new AuthError(403, "origin_mismatch", "Cross-origin admin request blocked.");
  }
}

async function requireAdminApi(req: http.IncomingMessage) {
  assertSameOriginAdminRequest(req);
  try {
    return await requireAdminUser(req);
  } catch (err) {
    // Hide the existence of admin APIs from non-admins / anonymous callers.
    if (err instanceof AuthError && (err.status === 401 || err.status === 403)) {
      throw new AuthError(404, "not_found", "Not found.");
    }
    throw err;
  }
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > 32 * 1024) {
      throw new AuthError(413, "body_too_large", "Request body is too large.");
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AuthError(400, "invalid_json", "Request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

function handleError(res: http.ServerResponse, err: unknown) {
  if (err instanceof AuthError) {
    if (err.status === 404) {
      notFound(res);
      return;
    }
    json(res, err.status, { error: err.code, message: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error("[admin]", message);
  json(res, 500, { error: "admin_error", message: "Something went wrong." });
}

function serializeAdminUser(u: {
  id: number;
  email: string;
  displayName: string | null;
  role: string;
  plan: string;
  emailVerifiedAt: string | null;
  subscriptionStatus: string | null;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  createdAt: string;
}) {
  return {
    id: u.id,
    email: u.email,
    name: u.displayName,
    role: u.role,
    plan: u.plan,
    premium: canAccessPremiumContent(u as never),
    subscriptionStatus: u.subscriptionStatus,
    stripeSubscriptionId: u.stripeSubscriptionId,
    stripeCustomerId: u.stripeCustomerId,
    emailVerified: Boolean(u.emailVerifiedAt),
    createdAt: u.createdAt,
  };
}

export async function tryHandleAdmin(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<boolean> {
  if (USERS_RE.test(url.pathname)) {
    if (req.method !== "GET") {
      json(res, 405, { error: "method_not_allowed", message: "Use GET." });
      return true;
    }
    try {
      await requireAdminApi(req);
      const q = String(url.searchParams.get("q") || "").trim();
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || "50") || 50));
      const offset = Math.max(0, Number(url.searchParams.get("offset") || "0") || 0);
      const { users, total } = await getAuthRepository().listUsers({ q, limit, offset });
      json(res, 200, {
        total,
        users: users.map((u) => serializeAdminUser(u)),
      });
    } catch (err) {
      handleError(res, err);
    }
    return true;
  }

  const planMatch = url.pathname.match(USER_PLAN_RE);
  if (planMatch) {
    if (req.method !== "POST") {
      json(res, 405, { error: "method_not_allowed", message: "Use POST." });
      return true;
    }
    try {
      await requireAdminApi(req);
      const userId = Number(planMatch[1]);
      if (!Number.isFinite(userId) || userId <= 0) {
        throw new AuthError(400, "invalid_user", "Invalid user id.");
      }
      const body = await readJsonBody(req);
      const planRaw = String(body.plan || "").toLowerCase();
      const plan: UserPlan = planRaw === "premium" ? "premium" : "free";
      const updated = await getAuthRepository().setUserPlan(userId, plan);
      if (!updated) throw new AuthError(404, "not_found", "User not found.");
      json(res, 200, { user: serializeAdminUser(updated) });
    } catch (err) {
      handleError(res, err);
    }
    return true;
  }

  return false;
}
