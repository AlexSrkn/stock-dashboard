import type http from "node:http";
import { AuthError } from "./types.js";
import { requirePremiumUser } from "./service.js";

/**
 * Assert the request has a paid Premium session (DB-backed, not client claims).
 * Writes 401/403 JSON and returns false when blocked; true when allowed.
 */
export async function assertPremiumRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse
): Promise<boolean> {
  try {
    await requirePremiumUser(req);
    return true;
  } catch (err) {
    if (err instanceof AuthError) {
      res.writeHead(err.status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "private, no-store",
      });
      res.end(JSON.stringify({ error: err.code, message: err.message }));
      return false;
    }
    const message = err instanceof Error ? err.message : String(err);
    res.writeHead(500, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
    });
    res.end(JSON.stringify({ error: "premium_gate_error", message }));
    return false;
  }
}
