/**
 * Premium gate modal — shown when a free (or logged-out) user tries to open a Premium section.
 */

import { getCurrentAuthUser, getServerPremiumAccess } from "./authLoginPanel.js?v=admin-users-1";

/** Subsection / route keys that require Premium. */
export const PREMIUM_SECTIONS = new Set([
  // Stocks — ownership intelligence
  "ownership-changes",
  "ownership-history",
  "screener",
  // Sector
  "institutional-concentration",
  // Signals — whole hub
  "signals",
  "top-institution-entries",
  "double-signal",
  "triple-signal",
  "conflict-signals",
  "smart-money",
  "hidden-gems",
  "conviction-score",
  "institutional-discovery",
  // Institutions — ranked views (directory + notable stay free)
  "institution-performance",
  "institution-new-positions",
  "institution-completely-sold",
  // Insiders — ranked views (recent trades stay free)
  "insider-clusters",
  "insider-conviction-buys",
  "insider-repeat-buyers",
  // Politicians — ranked views (all trades stay free)
  "politician-repeat-buyers",
  "politician-first-time-buyers",
  "politician-heavy-selling",
  "politician-sector-exposure",
]);

/** @deprecated use PREMIUM_SECTIONS */
export const PREMIUM_EXPLORE_MODES = PREMIUM_SECTIONS;

/**
 * Client-side entitlement check (UX only — server still enforces APIs).
 * Uses the server-computed `premium` flag from /api/auth/me (DB-backed).
 */
export function clientHasPremiumAccess() {
  return getServerPremiumAccess();
}

export function isPremiumSection(section) {
  return PREMIUM_SECTIONS.has(String(section || ""));
}

/**
 * Start Stripe Hosted Checkout. Logged-out users are sent to /login.
 * @param {{ button?: HTMLButtonElement | null, onError?: (message: string) => void }} [opts]
 */
export async function startPremiumCheckoutFlow(opts = {}) {
  const user = getCurrentAuthUser();
  if (!user) {
    closePremiumGate();
    history.pushState({}, "", "/login?next=%2Fpremium");
    window.dispatchEvent(new PopStateEvent("popstate"));
    return;
  }

  const button = opts.button || null;
  const prevLabel = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = "Redirecting…";
  }

  try {
    const res = await fetch("/api/create-checkout-session", {
      method: "POST",
      credentials: "include",
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.url) {
      throw new Error(data.message || data.error || "Could not start checkout");
    }
    window.location.href = data.url;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (button) {
      button.disabled = false;
      button.textContent = prevLabel || "Unlock Premium";
    }
    if (typeof opts.onError === "function") opts.onError(message);
    else console.warn("[premium]", message);
  }
}

/**
 * If the section is Premium and the user lacks access, open the gate and return false.
 * @param {string} [section]
 * @returns {boolean}
 */
export function requirePremiumAccess(section = "") {
  if (!isPremiumSection(section)) return true;
  if (clientHasPremiumAccess()) return true;
  // Already open — ignore double-clicks / repeat navigations.
  if (document.body.classList.contains("premium-gate-open")) return false;
  openPremiumGate({ feature: section });
  return false;
}

/**
 * Soft-block a deep link: show gate and send the user back to a safe hub path.
 * @param {string} section
 * @param {string} fallbackPath
 * @returns {boolean} true if allowed to continue
 */
export function guardPremiumRoute(section, fallbackPath) {
  if (requirePremiumAccess(section)) return true;
  const next = fallbackPath || "/stocks";
  if (window.location.pathname !== next) {
    history.replaceState({}, "", next);
  }
  return false;
}

/**
 * @param {{ feature?: string }} [opts]
 */
export function openPremiumGate(opts = {}) {
  const root = document.getElementById("premium-gate");
  if (!root) return;
  const title = document.getElementById("premium-gate-title");
  const lead = document.getElementById("premium-gate-lead");
  const body = document.getElementById("premium-gate-body");
  const user = getCurrentAuthUser();

  if (title) title.textContent = "Unlock Premium Research";
  if (lead) {
    lead.textContent = "This section is available with InvestAtlant Premium.";
  }
  if (body) {
    body.textContent =
      "Get deeper access to trade data, advanced research views, and the tools you need to follow capital flows across markets.";
  }

  const loginCta = document.getElementById("premium-gate-login");
  const unlockBtn = document.getElementById("premium-gate-unlock");
  if (loginCta) loginCta.hidden = Boolean(user);
  if (unlockBtn) {
    unlockBtn.hidden = false;
    unlockBtn.disabled = false;
    unlockBtn.textContent = "Unlock Premium";
  }

  root.hidden = false;
  document.body.classList.add("premium-gate-open");
  unlockBtn?.focus?.() || document.getElementById("premium-gate-close")?.focus?.();
  void opts;
}

export function closePremiumGate() {
  const root = document.getElementById("premium-gate");
  if (root) root.hidden = true;
  document.body.classList.remove("premium-gate-open");
}

export function isPremiumGateOpen() {
  return document.body.classList.contains("premium-gate-open");
}

export function setupPremiumGate() {
  const root = document.getElementById("premium-gate");
  if (!root) return;

  root.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (t.closest("[data-premium-gate-close]")) {
      e.preventDefault();
      closePremiumGate();
    }
  });

  document.getElementById("premium-gate-unlock")?.addEventListener("click", () => {
    const unlockBtn = document.getElementById("premium-gate-unlock");
    void startPremiumCheckoutFlow({
      button: unlockBtn instanceof HTMLButtonElement ? unlockBtn : null,
      onError: (message) => {
        const lead = document.getElementById("premium-gate-lead");
        if (lead) lead.textContent = message;
      },
    });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("premium-gate-open")) {
      closePremiumGate();
    }
  });
}
