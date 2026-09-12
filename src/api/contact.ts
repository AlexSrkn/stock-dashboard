import type http from "node:http";
import { sendContactEmail } from "../auth/email.js";
import { loadEnvFile } from "../db/pool.js";

loadEnvFile();

const CONTACT_RE = /^\/api\/contact\/?$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RATE_WINDOW_MS = 60_000;
const RATE_MAX = 3;

/** Simple in-memory rate limit by IP (best-effort). */
const hits = new Map<string, number[]>();

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "private, no-store",
  });
  res.end(JSON.stringify(body));
}

function clientIp(req: http.IncomingMessage): string {
  const xf = String(req.headers["x-forwarded-for"] || "")
    .split(",")[0]
    ?.trim();
  return xf || req.socket.remoteAddress || "unknown";
}

function allowRequest(ip: string): boolean {
  const now = Date.now();
  const prev = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (prev.length >= RATE_MAX) {
    hits.set(ip, prev);
    return false;
  }
  prev.push(now);
  hits.set(ip, prev);
  return true;
}

async function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > 32 * 1024) {
      throw Object.assign(new Error("body_too_large"), { status: 413 });
    }
    chunks.push(buf);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw Object.assign(new Error("invalid_json"), { status: 400 });
  }
  return parsed as Record<string, unknown>;
}

/**
 * POST /api/contact — send contact form to CONTACT_INBOX via Resend.
 */
export async function tryHandleContact(
  url: URL,
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<boolean> {
  if (!CONTACT_RE.test(url.pathname)) return false;

  if (req.method !== "POST") {
    json(res, 405, { error: "method_not_allowed", message: "Use POST." });
    return true;
  }

  if (!allowRequest(clientIp(req))) {
    json(res, 429, {
      error: "rate_limited",
      message: "Too many messages. Please wait a minute and try again.",
    });
    return true;
  }

  try {
    const body = await readJsonBody(req);
    // Honeypot — bots fill hidden fields; humans leave empty.
    if (String(body.company || body.website || "").trim()) {
      json(res, 200, { ok: true });
      return true;
    }

    const name = String(body.name || "").trim().slice(0, 120);
    const email = String(body.email || "").trim().slice(0, 254).toLowerCase();
    const subject = String(body.subject || "").trim().slice(0, 160);
    const message = String(body.message || "").trim().slice(0, 5000);

    if (!name || !email || !subject || !message) {
      json(res, 400, { error: "invalid_input", message: "Please fill in all fields." });
      return true;
    }
    if (!EMAIL_RE.test(email)) {
      json(res, 400, { error: "invalid_email", message: "Please enter a valid email address." });
      return true;
    }

    const result = await sendContactEmail({ name, email, subject, message });
    if (!result.sent) {
      if (result.error === "email_not_configured") {
        json(res, 503, {
          error: "email_not_configured",
          message:
            "Email sending is not configured yet. Please email contact@investatlant.com directly.",
        });
        return true;
      }
      const invalidKey = /API key is invalid|401/i.test(String(result.error || ""));
      const testingOnly = /only send testing emails|verify a domain/i.test(String(result.error || ""));
      json(res, 502, {
        error: invalidKey ? "email_auth_failed" : testingOnly ? "domain_unverified" : "send_failed",
        message: invalidKey
          ? "Email service is misconfigured (invalid Resend API key). Please email contact@investatlant.com for now."
          : testingOnly
            ? "Email domain is not verified yet in Resend. Contact form can only deliver to the Resend account email until investatlant.com is verified."
            : "Could not send your message. Please try again or email contact@investatlant.com.",
      });
      return true;
    }

    json(res, 200, { ok: true, message: "Message sent. We’ll get back to you soon." });
    return true;
  } catch (err) {
    const status = Number((err as { status?: number })?.status) || 500;
    if (status === 413) {
      json(res, 413, { error: "body_too_large", message: "Message is too large." });
      return true;
    }
    if (err instanceof SyntaxError || (err as Error)?.message === "invalid_json") {
      json(res, 400, { error: "invalid_json", message: "Invalid request body." });
      return true;
    }
    console.error("[contact]", err instanceof Error ? err.message : err);
    json(res, 500, {
      error: "contact_error",
      message: "Something went wrong. Please try again or email contact@investatlant.com.",
    });
    return true;
  }
}
