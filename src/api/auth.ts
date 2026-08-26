import type http from "node:http";
import {
  AuthError,
  canAccessPremiumContent,
  forgotPassword,
  getUserFromRequest,
  login,
  logout,
  requirePremiumUser,
  requireUser,
  resendVerification,
  resetPassword,
  signup,
  toPublicUser,
  verifyEmail,
} from "../auth/index.js";
import { loadEnvFile } from "../db/pool.js";

loadEnvFile();

const AUTH_PREFIX = /^\/api\/auth(\/|$)/;
const PREMIUM_PING_RE = /^\/api\/premium\/ping\/?$/;
const ACCOUNT_RE = /^\/api\/account\/?$/;

function json(
  res: http.ServerResponse,
  status: number,
  body: unknown,
  extraHeaders: Record<string, string> = {}
) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, no-store",
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > 64 * 1024) {
      throw new AuthError(413, "body_too_large", "Request body is too large.");
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new AuthError(400, "invalid_json", "Request body must be a JSON object.");
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof AuthError) throw err;
    throw new AuthError(400, "invalid_json", "Request body must be valid JSON.");
  }
}

function handleAuthError(res: http.ServerResponse, err: unknown): void {
  if (err instanceof AuthError) {
    json(res, err.status, { error: err.code, message: err.message });
    return;
  }
  const message = err instanceof Error ? err.message : String(err);
  console.error("[auth]", message);
  json(res, 500, { error: "auth_error", message: "Something went wrong. Try again." });
}

/**
 * Auth + account + premium-gate demo routes.
 * Returns true when the request was handled.
 */
export async function tryHandleAuth(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<boolean> {
  if (ACCOUNT_RE.test(url.pathname)) {
    if (req.method !== "GET") {
      json(res, 405, { error: "method_not_allowed", message: "Use GET." });
      return true;
    }
    try {
      const user = await requireUser(req);
      json(res, 200, {
        user: toPublicUser(user),
        premium: canAccessPremiumContent(user),
      });
    } catch (err) {
      handleAuthError(res, err);
    }
    return true;
  }

  if (PREMIUM_PING_RE.test(url.pathname)) {
    if (req.method !== "GET") {
      json(res, 405, { error: "method_not_allowed", message: "Use GET." });
      return true;
    }
    try {
      const user = await requirePremiumUser(req);
      json(res, 200, {
        ok: true,
        message: "Premium access granted.",
        user: toPublicUser(user),
      });
    } catch (err) {
      handleAuthError(res, err);
    }
    return true;
  }

  if (!AUTH_PREFIX.test(url.pathname)) return false;

  const path = url.pathname.replace(/\/+$/, "") || "/";

  try {
    if (path === "/api/auth/me" && req.method === "GET") {
      const user = await getUserFromRequest(req);
      json(res, 200, { user: user ? toPublicUser(user) : null });
      return true;
    }

    if (path === "/api/auth/signup" && req.method === "POST") {
      const body = await readJsonBody(req);
      // Ignore any client-supplied plan/role — server assigns free/user only.
      const result = await signup(req, {
        name: String(body.name || ""),
        email: String(body.email || ""),
        password: String(body.password || ""),
      });
      json(
        res,
        201,
        {
          user: result.user,
          requiresEmailVerification: result.requiresEmailVerification,
          ...(result.verifyUrl ? { verifyUrl: result.verifyUrl } : {}),
        },
        { "Set-Cookie": result.cookie }
      );
      return true;
    }

    if (path === "/api/auth/login" && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await login(req, {
        email: String(body.email || ""),
        password: String(body.password || ""),
      });
      json(res, 200, { user: result.user }, { "Set-Cookie": result.cookie });
      return true;
    }

    if (path === "/api/auth/logout" && req.method === "POST") {
      const result = await logout(req);
      json(res, 200, { ok: true }, { "Set-Cookie": result.cookie });
      return true;
    }

    if (path === "/api/auth/forgot-password" && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await forgotPassword(String(body.email || ""));
      json(res, 200, result);
      return true;
    }

    if (path === "/api/auth/reset-password" && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await resetPassword({
        token: String(body.token || ""),
        password: String(body.password || ""),
      });
      json(res, 200, { user: result.user, message: "Password updated. You can log in now." });
      return true;
    }

    if (path === "/api/auth/resend-verification" && req.method === "POST") {
      const body = await readJsonBody(req);
      const result = await resendVerification(String(body.email || ""));
      json(res, 200, result);
      return true;
    }

    if (path === "/api/auth/verify-email" && (req.method === "GET" || req.method === "POST")) {
      const token =
        req.method === "GET"
          ? String(url.searchParams.get("token") || "")
          : String((await readJsonBody(req)).token || "");
      const result = await verifyEmail(req, token);
      if (req.method === "GET") {
        res.writeHead(302, {
          Location: "/stocks",
          "Cache-Control": "private, no-store",
          "Set-Cookie": result.cookie,
        });
        res.end();
        return true;
      }
      json(
        res,
        200,
        { user: result.user, message: "Email verified." },
        { "Set-Cookie": result.cookie }
      );
      return true;
    }

    json(res, 404, { error: "not_found", message: "Unknown auth endpoint." });
    return true;
  } catch (err) {
    handleAuthError(res, err);
    return true;
  }
}
