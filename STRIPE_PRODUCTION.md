# Stripe → production checklist

Account connected via MCP: **InvestAtlant** (`acct_1UEn5n6JIN2dfRzj`).

## Already done in code

- Hosted Checkout → unlocks Premium on `checkout.session.completed`
- Webhooks sync `customer.subscription.updated` / `deleted` (revoke/keep Premium through period end)
- Customer Portal: `POST /api/create-portal-session` + **Manage billing** on `/premium`
- Live-key guards: webhook secret required; `DOMAIN` must be `https://`

## Your Dashboard / ops steps (in order)

### 1. Finish one successful **test-mode** payment (if not done)

1. Keep `sk_test_…` / `pk_test_…` / test `STRIPE_PRICE_ID` in `.env`
2. Local webhook: `stripe listen --forward-to localhost:8787/api/stripe/webhook` → put `whsec_…` in `.env`
3. Subscribe with test card `4242 4242 4242 4242`
4. Confirm `app_user.plan = premium` + Stripe IDs set
5. Click **Manage billing** → cancel → confirm Premium drops after period end / deleted event

### 2. Create **live** Product + Price ($9.99 / month)

Live mode currently has **no products/prices**. Easiest options:

**A. Dashboard (recommended)**  
1. Open [Products (Test mode OFF)](https://dashboard.stripe.com/products/create)  
2. Name: `Tradepile Premium`  
3. Price: `9.99` USD, recurring **Monthly**  
4. Save → copy Price ID (`price_…`) into production `STRIPE_PRICE_ID`

**B. Script with live secret key**  
Temporarily set `STRIPE_SECRET_KEY=sk_live_…` in `.env`, then:

```bash
npm run stripe:create-premium-price
```

Copy the printed `priceId` into production `STRIPE_PRICE_ID`, then restore your env and restart.

### 3. Enable Customer Portal (live)

[Settings → Billing → Customer portal](https://dashboard.stripe.com/settings/billing/portal)

Enable at least: cancel subscription, update payment method.

### 4. Live webhook endpoint

[Workbench → Webhooks](https://dashboard.stripe.com/workbench/webhooks) (live mode):

- URL: `https://YOUR_DOMAIN/api/stripe/webhook`
- Events:
  - `checkout.session.completed`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
- Copy signing secret → `STRIPE_WEBHOOK_SECRET=whsec_…`

### 5. Flip production `.env`

```bash
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...   # live endpoint secret
STRIPE_PRICE_ID=price_...         # live price
DOMAIN=https://YOUR_PRODUCTION_HOST
AUTH_PUBLIC_ORIGIN=https://YOUR_PRODUCTION_HOST
```

Restart the server. Never mix test prices with live keys.

### 6. Smoke test live

1. Real checkout with a real card (or Stripe live test if available in your region)
2. Confirm Premium unlocks
3. Open **Manage billing**, cancel, confirm webhook updates the user

## If you want me to create the live Product/Price

Say the amount + interval (e.g. `$29 / month`) and I can create them on **InvestAtlant** live via Stripe MCP (write). I will not create live charges without you asking.
