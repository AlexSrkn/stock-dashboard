/**
 * Premium gate modal — shown when a free (or logged-out) user tries to open a Premium section.
 */

import { getCurrentAuthUser } from "./authLoginPanel.js?v=account-avatar-1";

const CONTACT_EMAIL = "contact@investatlant.com";

/** Sections that require Premium (explore modes). Empty until gating is re-enabled. */
export const PREMIUM_EXPLORE_MODES = new Set();

/**
 * Client-side entitlement check (UX only — server still enforces APIs).
 * Admins always pass.
 */
export function clientHasPremiumAccess() {
  const u = getCurrentAuthUser();
  if (!u) return false;
  if (u.role === "admin") return true;
  return u.plan === "premium";
}

function featureLabel(feature) {
  const f = String(feature || "").toLowerCase();
  if (f === "tools") return "Tools";
  if (f === "signals") return "Signals";
  return feature || "this section";
}

/**
 * @param {{ feature?: string }} [opts]
 */
export function openPremiumGate(opts = {}) {
  const root = document.getElementById("premium-gate");
  if (!root) return;
  const title = document.getElementById("premium-gate-title");
  const lead = document.getElementById("premium-gate-lead");
  const label = featureLabel(opts.feature);
  const user = getCurrentAuthUser();

  if (title) title.textContent = `${label} is Premium`;
  if (lead) {
    if (!user) {
      lead.textContent =
        "Create a free account, then contact us for Premium access. Self-serve billing is not available yet.";
    } else {
      lead.textContent =
        "Your account is on the Free plan. Email us to request Premium — we assign access manually for now.";
    }
  }

  const loginCta = document.getElementById("premium-gate-login");
  const contactCta = document.getElementById("premium-gate-contact");
  if (loginCta) loginCta.hidden = Boolean(user);
  if (contactCta) {
    const subject = encodeURIComponent(`Premium access request — ${label}`);
    const body = encodeURIComponent(
      user
        ? `Hi InvestAtlant,\n\nI'd like Premium access for ${label}.\n\nAccount email: ${user.email}\n\nThanks`
        : `Hi InvestAtlant,\n\nI'd like Premium access for ${label}.\n\nThanks`
    );
    contactCta.setAttribute("href", `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`);
  }

  root.hidden = false;
  document.body.classList.add("premium-gate-open");
  const closeBtn = document.getElementById("premium-gate-close");
  closeBtn?.focus?.();
}

export function closePremiumGate() {
  const root = document.getElementById("premium-gate");
  if (root) root.hidden = true;
  document.body.classList.remove("premium-gate-open");
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

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("premium-gate-open")) {
      closePremiumGate();
    }
  });
}
