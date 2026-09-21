/**
 * Create Tradepile Premium product + recurring price via current STRIPE_SECRET_KEY mode.
 * Usage:
 *   npm run stripe:create-premium-price
 * Uses $9.99/month USD. Safe to re-run only if you want another price (does not deactivate old ones).
 */
import Stripe from "stripe";
import { loadEnvFile } from "../src/db/pool.js";

loadEnvFile();

const key = String(process.env.STRIPE_SECRET_KEY || "").trim();
if (!key) {
  console.error("STRIPE_SECRET_KEY is not set");
  process.exit(1);
}

const stripe = new Stripe(key);
const livemode = key.startsWith("sk_live_");

const product = await stripe.products.create({
  name: "Tradepile Premium",
  description: "Monthly Premium access to Tradepile research features.",
  statement_descriptor: "TRADEPILE PREMIUM",
  metadata: { plan: "premium" },
  default_price_data: {
    currency: "usd",
    unit_amount: 999,
    recurring: { interval: "month", interval_count: 1 },
  },
  expand: ["default_price"],
});

const price =
  typeof product.default_price === "string"
    ? await stripe.prices.retrieve(product.default_price)
    : product.default_price;

console.log(
  JSON.stringify(
    {
      livemode,
      productId: product.id,
      priceId: price && typeof price === "object" ? price.id : product.default_price,
      amount: 999,
      currency: "usd",
      interval: "month",
      next: `Set STRIPE_PRICE_ID=${price && typeof price === "object" ? price.id : product.default_price} in your ${livemode ? "production" : "local/test"} .env and restart.`,
    },
    null,
    2
  )
);
