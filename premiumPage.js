/**
 * Premium pricing page — load Stripe offer, start Hosted Checkout.
 */

import {
  getCurrentAuthUser,
  refreshAuthSession,
} from "./authLoginPanel.js?v=admin-users-1";
import { clientHasPremiumAccess, startPremiumCheckoutFlow } from "./premiumGate.js";

async function loadPremiumOffer() {
  const amountEl = document.getElementById("premium-price-amount");
  const intervalEl = document.getElementById("premium-price-interval");
  try {
    const res = await fetch("/api/stripe/premium-offer", { credentials: "same-origin" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || "Failed to load price");
    if (amountEl) amountEl.textContent = data.formatted || "—";
    if (intervalEl) {
      if (data.interval === "month" && data.intervalCount === 1) intervalEl.textContent = "per month";
      else if (data.interval === "year" && data.intervalCount === 1) intervalEl.textContent = "per year";
      else if (data.interval) {
        intervalEl.textContent =
          data.intervalCount > 1
            ? `every ${data.intervalCount} ${data.interval}s`
            : `per ${data.interval}`;
      } else {
        intervalEl.textContent = "";
      }
    }
  } catch (err) {
    if (amountEl) amountEl.textContent = "—";
    if (intervalEl) intervalEl.textContent = "Price unavailable";
    console.warn("[premium]", err);
  }
}

function setPremiumNote(text, kind = "") {
  const note = document.getElementById("premium-page-note");
  if (!note) return;
  note.textContent = text || "";
  note.hidden = !text;
  note.classList.toggle("is-error", kind === "error");
  note.classList.toggle("is-success", kind === "success");
}

function updatePremiumCtaState() {
  const user = getCurrentAuthUser();
  const upgradeBtn = document.getElementById("premium-checkout-btn");
  const portalBtn = document.getElementById("premium-portal-btn");
  const loginLink = document.getElementById("premium-login-link");
  const exploreLink = document.getElementById("premium-explore-link");
  const status = document.getElementById("premium-page-status");

  const isPremium = clientHasPremiumAccess();

  if (status) {
    if (isPremium) {
      status.hidden = false;
      status.textContent = "Your account is on Premium.";
    } else {
      status.hidden = true;
      status.textContent = "";
    }
  }

  if (upgradeBtn) {
    upgradeBtn.hidden = isPremium;
    upgradeBtn.disabled = false;
    upgradeBtn.textContent = "Upgrade to Premium";
  }
  if (portalBtn) {
    portalBtn.hidden = !isPremium;
    portalBtn.disabled = false;
  }
  if (loginLink) loginLink.hidden = Boolean(user) || isPremium;
  if (exploreLink) exploreLink.hidden = false;
}

async function startPremiumCheckout() {
  const upgradeBtn = document.getElementById("premium-checkout-btn");
  setPremiumNote("");
  await startPremiumCheckoutFlow({
    button: upgradeBtn instanceof HTMLButtonElement ? upgradeBtn : null,
    onError: (message) => setPremiumNote(message, "error"),
  });
}

async function startBillingPortal() {
  const portalBtn = document.getElementById("premium-portal-btn");
  setPremiumNote("");
  const prev = portalBtn?.textContent;
  if (portalBtn) {
    portalBtn.disabled = true;
    portalBtn.textContent = "Opening…";
  }
  try {
    const res = await fetch("/api/create-portal-session", {
      method: "POST",
      credentials: "include",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.message || data.error || "Could not open billing portal");
    if (!data.url) throw new Error("Billing portal URL missing");
    window.location.href = data.url;
  } catch (err) {
    setPremiumNote(err instanceof Error ? err.message : String(err), "error");
    if (portalBtn) {
      portalBtn.disabled = false;
      portalBtn.textContent = prev || "Manage billing";
    }
  }
}

async function handleCheckoutReturn() {
  const params = new URLSearchParams(window.location.search);
  const checkout = params.get("checkout");
  if (!checkout) return;

  if (checkout === "success") {
    await refreshAuthSession();
    setPremiumNote("Payment received. Premium is now active on your account.", "success");
  } else if (checkout === "cancel") {
    setPremiumNote("Checkout canceled. You can upgrade anytime.", "error");
  }

  // Clean query params without leaving the premium view.
  history.replaceState({}, "", "/premium");
  updatePremiumCtaState();
}

export function setupPremiumPage() {
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.('a[href="/pricing"], a[href="/premium"]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    history.pushState({}, "", a.getAttribute("href") || "/pricing");
    void handleRouteChangeSafe();
  });

  const upgradeBtn = document.getElementById("premium-checkout-btn");
  upgradeBtn?.addEventListener("click", () => {
    void startPremiumCheckout();
  });
  const portalBtn = document.getElementById("premium-portal-btn");
  portalBtn?.addEventListener("click", () => {
    void startBillingPortal();
  });

  void (async () => {
    await loadPremiumOffer();
    await refreshAuthSession();
    await handleCheckoutReturn();
    updatePremiumCtaState();
  })();
}

function handleRouteChangeSafe() {
  // app.js owns handleRouteChange; dispatch popstate so the SPA router runs.
  window.dispatchEvent(new PopStateEvent("popstate"));
}

/** Call when navigating to /premium so CTA/price stay in sync. */
export async function refreshPremiumPage() {
  await loadPremiumOffer();
  await refreshAuthSession();
  updatePremiumCtaState();
  await handleCheckoutReturn();
}
