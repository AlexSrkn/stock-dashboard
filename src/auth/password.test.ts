import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canAccessPremiumContent } from "./authorization.js";
import { hashPassword, verifyPassword } from "./password.js";
import type { AppUser } from "./types.js";

function user(partial: Partial<AppUser> = {}): AppUser {
  return {
    id: 1,
    email: "a@b.com",
    displayName: "Alex",
    role: "user",
    plan: "free",
    emailVerifiedAt: new Date().toISOString(),
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    subscriptionStatus: null,
    subscriptionCurrentPeriodStart: null,
    subscriptionCurrentPeriodEnd: null,
    subscriptionCancelAtPeriodEnd: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...partial,
  };
}

describe("auth password hashing", () => {
  it("hashes and verifies passwords without storing plaintext", async () => {
    const hash = await hashPassword("correct-horse-battery");
    assert.notEqual(hash, "correct-horse-battery");
    assert.match(hash, /^scrypt\$/);
    assert.equal(await verifyPassword("correct-horse-battery", hash), true);
    assert.equal(await verifyPassword("wrong-password", hash), false);
  });
});

describe("canAccessPremiumContent", () => {
  it("denies null and free users", () => {
    assert.equal(canAccessPremiumContent(null), false);
    assert.equal(canAccessPremiumContent(user({ plan: "free" })), false);
  });

  it("allows premium users without Stripe fields yet", () => {
    assert.equal(canAccessPremiumContent(user({ plan: "premium" })), true);
  });

  it("allows active Stripe subscriptions and in-period canceled", () => {
    assert.equal(
      canAccessPremiumContent(
        user({ plan: "premium", subscriptionStatus: "active" })
      ),
      true
    );
    const future = new Date(Date.now() + 86400000).toISOString();
    assert.equal(
      canAccessPremiumContent(
        user({
          plan: "premium",
          subscriptionStatus: "canceled",
          subscriptionCurrentPeriodEnd: future,
        })
      ),
      true
    );
    const past = new Date(Date.now() - 86400000).toISOString();
    assert.equal(
      canAccessPremiumContent(
        user({
          plan: "premium",
          subscriptionStatus: "canceled",
          subscriptionCurrentPeriodEnd: past,
        })
      ),
      false
    );
  });
});
