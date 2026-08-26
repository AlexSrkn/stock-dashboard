import type http from "node:http";
import { canAccessPremiumContent } from "./authorization.js";
import {
  buildClearSessionCookie,
  buildSessionCookie,
  getSessionTokenFromRequest,
  sessionMaxAgeSeconds,
} from "./cookies.js";
import { generateOpaqueToken, hashPassword, hashToken, verifyPassword } from "./password.js";
import { getAuthRepository, normalizeEmail } from "./repository.js";
import { sendAuthEmail } from "./email.js";
import { AuthError, toPublicUser, type AppUser, type PublicUser } from "./types.js";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LEN = 8;
const MAX_PASSWORD_LEN = 128;
const RESEND_COOLDOWN_MS = 60_000;

/** emailNormalized → last send timestamp */
const resendCooldown = new Map<string, number>();

/**
 * Email verification is ON by default. Set AUTH_REQUIRE_EMAIL_VERIFICATION=0 to skip
 * (local demos only).
 */
function requireEmailVerification(): boolean {
  return process.env.AUTH_REQUIRE_EMAIL_VERIFICATION !== "0";
}

function exposeDevTokens(): boolean {
  return (
    process.env.AUTH_DEV_EXPOSE_TOKENS === "1" ||
    process.env.NODE_ENV !== "production"
  );
}

function publicOrigin(): string {
  return (process.env.AUTH_PUBLIC_ORIGIN || "http://localhost:8787").replace(/\/$/, "");
}

export function validateEmail(email: string): string {
  const normalized = normalizeEmail(email);
  if (!normalized || normalized.length > 254 || !EMAIL_RE.test(normalized)) {
    throw new AuthError(400, "invalid_email", "Enter a valid email address.");
  }
  return normalized;
}

export function validatePassword(password: string): string {
  const pw = String(password || "");
  if (pw.length < MIN_PASSWORD_LEN) {
    throw new AuthError(
      400,
      "weak_password",
      `Password must be at least ${MIN_PASSWORD_LEN} characters.`
    );
  }
  if (pw.length > MAX_PASSWORD_LEN) {
    throw new AuthError(400, "weak_password", "Password is too long.");
  }
  return pw;
}

export function validateDisplayName(name: string): string {
  const n = String(name || "").trim().replace(/\s+/g, " ");
  if (n.length < 1) {
    throw new AuthError(400, "invalid_name", "Enter your name.");
  }
  if (n.length > 80) {
    throw new AuthError(400, "invalid_name", "Name must be 80 characters or fewer.");
  }
  return n;
}

function clientMeta(req: http.IncomingMessage): { userAgent: string | null; ip: string | null } {
  const userAgent = req.headers["user-agent"] ? String(req.headers["user-agent"]).slice(0, 400) : null;
  const fwd = req.headers["x-forwarded-for"];
  const ipRaw = Array.isArray(fwd)
    ? fwd[0]
    : typeof fwd === "string"
      ? fwd.split(",")[0]
      : req.socket.remoteAddress;
  const ip = ipRaw ? String(ipRaw).trim().slice(0, 64) : null;
  return { userAgent, ip };
}

async function issueSession(
  userId: number,
  req: http.IncomingMessage
): Promise<{ token: string; cookie: string }> {
  const repo = getAuthRepository();
  const token = generateOpaqueToken(32);
  const maxAge = sessionMaxAgeSeconds();
  const expiresAt = new Date(Date.now() + maxAge * 1000);
  const meta = clientMeta(req);
  await repo.createSession({
    id: token,
    userId,
    expiresAt,
    userAgent: meta.userAgent,
    ip: meta.ip,
  });
  return { token, cookie: buildSessionCookie(token, maxAge) };
}

async function createVerificationLink(
  userId: number,
  email: string,
  name?: string | null
): Promise<string> {
  const repo = getAuthRepository();
  const raw = generateOpaqueToken(32);
  const tokenHash = await hashToken(raw);
  await repo.createAuthToken({
    userId,
    purpose: "email_verify",
    tokenHash,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 48),
  });
  const verifyUrl = `${publicOrigin()}/api/auth/verify-email?token=${encodeURIComponent(raw)}`;
  console.log(`[auth] Email verification link for ${email}: ${verifyUrl}`);
  resendCooldown.set(normalizeEmail(email), Date.now());
  await sendAuthEmail({
    kind: "verify",
    to: email,
    actionUrl: verifyUrl,
    name: name ?? null,
  });
  return verifyUrl;
}

function assertResendAllowed(emailNormalized: string): void {
  const last = resendCooldown.get(emailNormalized) ?? 0;
  const wait = RESEND_COOLDOWN_MS - (Date.now() - last);
  if (wait > 0) {
    throw new AuthError(
      429,
      "rate_limited",
      `Please wait ${Math.ceil(wait / 1000)}s before requesting another email.`
    );
  }
}

export async function ensureAuthSchema(): Promise<void> {
  await getAuthRepository().ensureSchema();
}

export async function getUserFromRequest(req: http.IncomingMessage): Promise<AppUser | null> {
  const token = getSessionTokenFromRequest(req);
  if (!token) return null;
  const hit = await getAuthRepository().findValidSession(token);
  return hit?.user ?? null;
}

/** Require a logged-in user. Throws AuthError(401) otherwise. */
export async function requireUser(req: http.IncomingMessage): Promise<AppUser> {
  const user = await getUserFromRequest(req);
  if (!user) throw new AuthError(401, "unauthenticated", "Log in to continue.");
  return user;
}

/** Require premium entitlement (server-side). Throws AuthError(403) otherwise. */
export async function requirePremiumUser(req: http.IncomingMessage): Promise<AppUser> {
  const user = await requireUser(req);
  if (!canAccessPremiumContent(user)) {
    throw new AuthError(403, "premium_required", "Premium plan required.");
  }
  return user;
}

export async function signup(
  req: http.IncomingMessage,
  input: { email: string; password: string; name?: string }
): Promise<{
  user: PublicUser;
  cookie: string;
  verifyUrl?: string;
  requiresEmailVerification: boolean;
}> {
  const repo = getAuthRepository();
  await repo.ensureSchema();

  const displayName = validateDisplayName(String(input.name || ""));
  const email = validateEmail(input.email);
  const password = validatePassword(input.password);

  const existing = await repo.findUserByEmail(email);
  if (existing) {
    // Unverified account: resend quietly and send user to check-email (no enumeration of password).
    if (!existing.emailVerifiedAt && requireEmailVerification()) {
      assertResendAllowed(email);
      const verifyUrl = await createVerificationLink(
        existing.id,
        email,
        existing.displayName || displayName
      );
      return {
        user: toPublicUser({ ...existing, displayName: existing.displayName || displayName }),
        cookie: buildClearSessionCookie(),
        requiresEmailVerification: true,
        ...(exposeDevTokens() ? { verifyUrl } : {}),
      };
    }
    throw new AuthError(409, "email_taken", "An account with this email already exists. Try logging in.");
  }

  const passwordHash = await hashPassword(password);
  const needsVerify = requireEmailVerification();
  const user = await repo.createUser({
    email,
    passwordHash,
    displayName,
    emailVerifiedAt: needsVerify ? null : new Date(),
  });

  if (needsVerify) {
    const verifyUrl = await createVerificationLink(user.id, email, displayName);
    return {
      user: toPublicUser(user),
      cookie: buildClearSessionCookie(),
      requiresEmailVerification: true,
      ...(exposeDevTokens() ? { verifyUrl } : {}),
    };
  }

  const { cookie } = await issueSession(user.id, req);
  return {
    user: toPublicUser(user),
    cookie,
    requiresEmailVerification: false,
  };
}

export async function login(
  req: http.IncomingMessage,
  input: { email: string; password: string }
): Promise<{ user: PublicUser; cookie: string }> {
  const repo = getAuthRepository();
  // Schema is applied on server startup — don't re-run DDL on every login.

  const email = validateEmail(input.email);
  const password = validatePassword(input.password);

  const existing = await repo.findUserByEmail(email);
  const invalid = () =>
    new AuthError(401, "invalid_credentials", "Invalid email or password.");

  if (!existing) {
    // Cheap timing pad (not a full password hash) so missing accounts aren't instant.
    await new Promise((r) => setTimeout(r, 80));
    throw invalid();
  }

  const ok = await verifyPassword(password, existing.passwordHash);
  if (!ok) throw invalid();

  if (requireEmailVerification() && !existing.emailVerifiedAt) {
    throw new AuthError(
      403,
      "email_unverified",
      "Verify your email before logging in. Check your inbox for the link."
    );
  }

  const { cookie } = await issueSession(existing.id, req);
  return { user: toPublicUser(existing), cookie };
}

export async function logout(req: http.IncomingMessage): Promise<{ cookie: string }> {
  const token = getSessionTokenFromRequest(req);
  if (token) {
    try {
      await getAuthRepository().deleteSession(token);
    } catch {
      /* ignore */
    }
  }
  return { cookie: buildClearSessionCookie() };
}

export async function forgotPassword(emailRaw: string): Promise<{
  message: string;
  resetUrl?: string;
}> {
  const repo = getAuthRepository();

  const email = validateEmail(emailRaw);
  const existing = await repo.findUserByEmail(email);
  const generic =
    "If an account exists for that email, you’ll receive a password reset link shortly.";

  if (!existing) {
    return { message: generic };
  }

  assertResendAllowed(`reset:${email}`);

  const raw = generateOpaqueToken(32);
  const tokenHash = await hashToken(raw);
  await repo.createAuthToken({
    userId: existing.id,
    purpose: "password_reset",
    tokenHash,
    expiresAt: new Date(Date.now() + 1000 * 60 * 60),
  });

  const resetUrl = `${publicOrigin()}/reset-password?token=${encodeURIComponent(raw)}`;
  console.log(`[auth] Password reset link for ${email}: ${resetUrl}`);
  resendCooldown.set(`reset:${email}`, Date.now());
  await sendAuthEmail({
    kind: "reset",
    to: email,
    actionUrl: resetUrl,
    name: existing.displayName,
  });

  return {
    message: generic,
    ...(exposeDevTokens() ? { resetUrl } : {}),
  };
}

export async function resetPassword(input: {
  token: string;
  password: string;
}): Promise<{ user: PublicUser }> {
  const repo = getAuthRepository();

  const token = String(input.token || "").trim();
  if (!token || token.length < 16) {
    throw new AuthError(400, "invalid_token", "Reset link is invalid or expired.");
  }
  const password = validatePassword(input.password);
  const tokenHash = await hashToken(token);
  const consumed = await repo.consumeAuthToken("password_reset", tokenHash);
  if (!consumed) {
    throw new AuthError(400, "invalid_token", "Reset link is invalid or expired.");
  }

  const passwordHash = await hashPassword(password);
  await repo.updatePassword(consumed.userId, passwordHash);
  await repo.deleteUserSessions(consumed.userId);

  const user = await repo.findUserById(consumed.userId);
  if (!user) throw new AuthError(400, "invalid_token", "Reset link is invalid or expired.");
  return { user: toPublicUser(user) };
}

export async function verifyEmail(
  req: http.IncomingMessage,
  tokenRaw: string
): Promise<{ user: PublicUser; cookie: string }> {
  const repo = getAuthRepository();

  const token = String(tokenRaw || "").trim();
  if (!token || token.length < 16) {
    throw new AuthError(400, "invalid_token", "Verification link is invalid or expired.");
  }
  const tokenHash = await hashToken(token);
  const consumed = await repo.consumeAuthToken("email_verify", tokenHash);
  if (!consumed) {
    throw new AuthError(400, "invalid_token", "Verification link is invalid or expired.");
  }
  const user = await repo.markEmailVerified(consumed.userId);
  if (!user) throw new AuthError(400, "invalid_token", "Verification link is invalid or expired.");

  // Log them in immediately and send them into the app.
  const { cookie } = await issueSession(user.id, req);
  return { user: toPublicUser(user), cookie };
}

/**
 * Resend verification email. Always returns a generic success message when the
 * account does not exist or is already verified (anti-enumeration).
 */
export async function resendVerification(emailRaw: string): Promise<{
  message: string;
  verifyUrl?: string;
}> {
  const repo = getAuthRepository();

  const email = validateEmail(emailRaw);
  const generic = "If that email needs verification, we’ve sent a new link.";
  const existing = await repo.findUserByEmail(email);

  if (!existing || existing.emailVerifiedAt) {
    return { message: generic };
  }

  assertResendAllowed(email);
  const verifyUrl = await createVerificationLink(existing.id, email, existing.displayName);
  return {
    message: generic,
    ...(exposeDevTokens() ? { verifyUrl } : {}),
  };
}
