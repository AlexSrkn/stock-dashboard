import type pg from "pg";
import { getPool } from "../db/pool.js";
import { loadAuthSchemaSql } from "../db/schema.js";
import type { AppUser, AuthTokenPurpose, UserPlan } from "./types.js";

function toIso(v: string | Date | null | undefined): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function mapUser(row: Record<string, unknown>): AppUser {
  const roleRaw = String(row.role || "user").toLowerCase();
  return {
    id: Number(row.id),
    email: String(row.email),
    displayName: row.display_name != null && String(row.display_name).trim()
      ? String(row.display_name).trim()
      : null,
    role: roleRaw === "admin" ? "admin" : "user",
    plan: (String(row.plan || "free").toLowerCase() === "premium" ? "premium" : "free") as UserPlan,
    emailVerifiedAt: toIso(row.email_verified_at as string | Date | null),
    stripeCustomerId: row.stripe_customer_id != null ? String(row.stripe_customer_id) : null,
    stripeSubscriptionId:
      row.stripe_subscription_id != null ? String(row.stripe_subscription_id) : null,
    subscriptionStatus:
      row.subscription_status != null ? String(row.subscription_status) : null,
    subscriptionCurrentPeriodStart: toIso(
      row.subscription_current_period_start as string | Date | null
    ),
    subscriptionCurrentPeriodEnd: toIso(
      row.subscription_current_period_end as string | Date | null
    ),
    subscriptionCancelAtPeriodEnd: Boolean(row.subscription_cancel_at_period_end),
    createdAt: toIso(row.created_at as string | Date) || new Date().toISOString(),
    updatedAt: toIso(row.updated_at as string | Date) || new Date().toISOString(),
  };
}

export function normalizeEmail(email: string): string {
  return String(email || "").trim().toLowerCase();
}

export class AuthRepository {
  constructor(private readonly pool: pg.Pool = getPool()) {}

  private schemaReady: Promise<void> | null = null;

  async ensureSchema(): Promise<void> {
    if (!this.schemaReady) {
      this.schemaReady = this.pool
        .query(loadAuthSchemaSql())
        .then(() => undefined)
        .catch((err) => {
          this.schemaReady = null;
          throw err;
        });
    }
    await this.schemaReady;
  }

  async findUserByEmail(email: string): Promise<(AppUser & { passwordHash: string }) | null> {
    const emailNormalized = normalizeEmail(email);
    const res = await this.pool.query(
      `SELECT * FROM app_user WHERE email_normalized = $1 LIMIT 1`,
      [emailNormalized]
    );
    if (!res.rows[0]) return null;
    const user = mapUser(res.rows[0]);
    return { ...user, passwordHash: String(res.rows[0].password_hash) };
  }

  async findUserById(id: number): Promise<AppUser | null> {
    const res = await this.pool.query(`SELECT * FROM app_user WHERE id = $1 LIMIT 1`, [id]);
    if (!res.rows[0]) return null;
    return mapUser(res.rows[0]);
  }

  async createUser(input: {
    email: string;
    passwordHash: string;
    displayName: string;
    plan?: UserPlan;
    emailVerifiedAt?: Date | null;
  }): Promise<AppUser> {
    const email = String(input.email || "").trim();
    const emailNormalized = normalizeEmail(email);
    // plan/role are server-controlled — never accept elevated values from clients
    const plan = "free";
    const role = "user";
    const displayName = String(input.displayName || "").trim().slice(0, 80) || null;
    const res = await this.pool.query(
      `INSERT INTO app_user (
         email, email_normalized, password_hash, display_name, role, plan, email_verified_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
       RETURNING *`,
      [email, emailNormalized, input.passwordHash, displayName, role, plan, input.emailVerifiedAt ?? null]
    );
    return mapUser(res.rows[0]);
  }

  async updatePassword(userId: number, passwordHash: string): Promise<void> {
    await this.pool.query(
      `UPDATE app_user SET password_hash = $2, updated_at = NOW() WHERE id = $1`,
      [userId, passwordHash]
    );
  }

  async markEmailVerified(userId: number): Promise<AppUser | null> {
    const res = await this.pool.query(
      `UPDATE app_user
       SET email_verified_at = COALESCE(email_verified_at, NOW()), updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [userId]
    );
    if (!res.rows[0]) return null;
    return mapUser(res.rows[0]);
  }

  async createSession(input: {
    id: string;
    userId: number;
    expiresAt: Date;
    userAgent?: string | null;
    ip?: string | null;
  }): Promise<void> {
    await this.pool.query(
      `INSERT INTO app_session (id, user_id, expires_at, user_agent, ip)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        input.id,
        input.userId,
        input.expiresAt.toISOString(),
        input.userAgent ?? null,
        input.ip ?? null,
      ]
    );
  }

  async findValidSession(
    sessionId: string
  ): Promise<{ sessionId: string; user: AppUser } | null> {
    const res = await this.pool.query(
      `SELECT s.id AS session_id, s.expires_at, u.*
       FROM app_session s
       INNER JOIN app_user u ON u.id = s.user_id
       WHERE s.id = $1 AND s.expires_at > NOW()
       LIMIT 1`,
      [sessionId]
    );
    if (!res.rows[0]) return null;
    // Touch last_seen (best-effort)
    void this.pool.query(`UPDATE app_session SET last_seen_at = NOW() WHERE id = $1`, [
      sessionId,
    ]);
    return {
      sessionId: String(res.rows[0].session_id),
      user: mapUser(res.rows[0]),
    };
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.pool.query(`DELETE FROM app_session WHERE id = $1`, [sessionId]);
  }

  async deleteUserSessions(userId: number): Promise<void> {
    await this.pool.query(`DELETE FROM app_session WHERE user_id = $1`, [userId]);
  }

  async createAuthToken(input: {
    userId: number;
    purpose: AuthTokenPurpose;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    // Invalidate prior unused tokens of the same purpose
    await this.pool.query(
      `UPDATE app_auth_token
       SET used_at = NOW()
       WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`,
      [input.userId, input.purpose]
    );
    await this.pool.query(
      `INSERT INTO app_auth_token (user_id, purpose, token_hash, expires_at)
       VALUES ($1, $2, $3, $4)`,
      [input.userId, input.purpose, input.tokenHash, input.expiresAt.toISOString()]
    );
  }

  async consumeAuthToken(
    purpose: AuthTokenPurpose,
    tokenHash: string
  ): Promise<{ userId: number } | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const res = await client.query(
        `SELECT id, user_id FROM app_auth_token
         WHERE purpose = $1 AND token_hash = $2
           AND used_at IS NULL AND expires_at > NOW()
         LIMIT 1
         FOR UPDATE`,
        [purpose, tokenHash]
      );
      if (!res.rows[0]) {
        await client.query("ROLLBACK");
        return null;
      }
      await client.query(`UPDATE app_auth_token SET used_at = NOW() WHERE id = $1`, [
        res.rows[0].id,
      ]);
      await client.query("COMMIT");
      return { userId: Number(res.rows[0].user_id) };
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore */
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async deleteExpiredSessions(): Promise<number> {
    const res = await this.pool.query(`DELETE FROM app_session WHERE expires_at <= NOW()`);
    return res.rowCount ?? 0;
  }
}

let repo: AuthRepository | null = null;

export function getAuthRepository(): AuthRepository {
  if (!repo) repo = new AuthRepository();
  return repo;
}
