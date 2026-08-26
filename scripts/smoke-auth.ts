/**
 * End-to-end auth service smoke test (no HTTP server).
 * Usage: npx tsx scripts/smoke-auth.ts
 */
import { closePool, loadEnvFile } from "../src/db/pool.js";
import {
  canAccessPremiumContent,
  ensureAuthSchema,
  forgotPassword,
  getAuthRepository,
  getUserFromRequest,
  login,
  logout,
  resetPassword,
  signup,
  verifyEmail,
} from "../src/auth/index.js";
import type http from "node:http";

loadEnvFile();
await ensureAuthSchema();

function fakeReq(cookie?: string): http.IncomingMessage {
  return {
    headers: {
      cookie: cookie || "",
      "user-agent": "smoke-auth",
    },
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as http.IncomingMessage;
}

function cookieFromSetCookie(setCookie: string): string {
  return setCookie.split(";")[0] || "";
}

const email = `smoke_${Date.now()}@example.com`;
const password = "test-password-123";

console.log("1) signup…");
const signed = await signup(fakeReq(), { email, password, name: "Smoke Tester" });
if (signed.user.plan !== "free") throw new Error("expected free plan");
if (signed.user.role !== "user") throw new Error("expected user role");
if (signed.user.name !== "Smoke Tester") throw new Error("expected display name");
if (!signed.requiresEmailVerification) throw new Error("expected email verification by default");
console.log("   ok", signed.user.email, signed.user.plan, signed.user.name);

if (!signed.verifyUrl) throw new Error("expected verifyUrl in non-production");
const verifyToken = new URL(signed.verifyUrl).searchParams.get("token");
if (!verifyToken) throw new Error("missing verify token");
await verifyEmail(fakeReq(), verifyToken);

console.log("2) login…");
const logged = await login(fakeReq(), { email, password });
const sessionCookie = cookieFromSetCookie(logged.cookie);
console.log("   ok");

console.log("3) session lookup…");
const me = await getUserFromRequest(fakeReq(sessionCookie));
if (!me || me.email.toLowerCase() !== email.toLowerCase()) throw new Error("session missing");
if (me.displayName !== "Smoke Tester") throw new Error("display name missing on session user");
console.log("   ok", me.id);

console.log("4) premium gate (free user denied)…");
if (canAccessPremiumContent(me)) throw new Error("free user should not be premium");
console.log("   ok");

console.log("5) forgot + reset password…");
const forgot = await forgotPassword(email);
if (!forgot.resetUrl) throw new Error("expected resetUrl in non-production");
const resetToken = new URL(forgot.resetUrl).searchParams.get("token");
if (!resetToken) throw new Error("missing reset token");
await resetPassword({ token: resetToken, password: "new-password-456" });
await login(fakeReq(), { email, password: "new-password-456" });
console.log("   ok");

console.log("6) logout…");
const out = await logout(fakeReq(sessionCookie));
if (!out.cookie.includes("Max-Age=0")) throw new Error("expected clear cookie");
console.log("   ok");

const repo = getAuthRepository();
const row = await repo.findUserByEmail(email);
if (row) {
  await repo.deleteUserSessions(row.id);
  const pool = (await import("../src/db/pool.js")).getPool();
  await pool.query(`DELETE FROM app_user WHERE id = $1`, [row.id]);
}

console.log("Auth smoke test passed.");
await closePool();
