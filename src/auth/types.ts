export type UserPlan = "free" | "premium";
export type UserRole = "user" | "admin";

export type AuthTokenPurpose = "email_verify" | "password_reset";

export interface AppUser {
  id: number;
  email: string;
  displayName: string | null;
  role: UserRole;
  plan: UserPlan;
  emailVerifiedAt: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  subscriptionStatus: string | null;
  subscriptionCurrentPeriodStart: string | null;
  subscriptionCurrentPeriodEnd: string | null;
  subscriptionCancelAtPeriodEnd: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Safe public shape — never includes password_hash or elevated claims from client. */
export interface PublicUser {
  id: number;
  email: string;
  name: string | null;
  role: UserRole;
  plan: UserPlan;
  emailVerified: boolean;
  createdAt: string;
}

export interface AuthSessionRow {
  id: string;
  userId: number;
  expiresAt: string;
}

export class AuthError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export function toPublicUser(user: AppUser): PublicUser {
  return {
    id: user.id,
    email: user.email,
    name: user.displayName,
    role: user.role === "admin" ? "admin" : "user",
    plan: user.plan,
    emailVerified: Boolean(user.emailVerifiedAt),
    createdAt: user.createdAt,
  };
}
