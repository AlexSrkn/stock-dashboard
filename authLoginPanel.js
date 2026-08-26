/**
 * Dedicated auth screens: /login /register /check-email /forgot-password /reset-password
 */

/** @typedef {{ id: number, email: string, name: string|null, role: string, plan: string, emailVerified: boolean, createdAt: string }} PublicUser */

/** @type {PublicUser | null} */
let currentUser = null;

const AUTH_PATHS = new Set([
  "/login",
  "/register",
  "/check-email",
  "/forgot-password",
  "/reset-password",
]);

const EYE_OPEN = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.6"/></svg>`;
const EYE_OFF = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 3l18 18M10.6 10.6A3 3 0 0 0 12 15a3 3 0 0 0 2.4-1.2M9.9 5.1A10.5 10.5 0 0 1 12 5c6.5 0 10 7 10 7a18.4 18.4 0 0 1-4.2 4.8M6.1 6.1C3.7 7.8 2 12 2 12a18.5 18.5 0 0 0 7.2 5.6" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`;

export function isAuthPath(pathname = location.pathname) {
  const p = String(pathname || "/").replace(/\/+$/, "") || "/";
  return AUTH_PATHS.has(p);
}

export function getCurrentAuthUser() {
  return currentUser;
}

async function authFetch(path, options = {}) {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = new Error(data?.message || `Request failed (${res.status})`);
    err.code = data?.error || "request_failed";
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

function qs(root, sel) {
  return root.querySelector(sel);
}

function setMsg(el, message, show) {
  if (!el) return;
  if (!show || !message) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.textContent = message;
  el.hidden = false;
}

function setBusy(form, busy, labelIdle, labelBusy) {
  const btn = form?.querySelector('[type="submit"]');
  form?.querySelectorAll("input, button").forEach((el) => {
    if (el instanceof HTMLInputElement || el instanceof HTMLButtonElement) {
      el.disabled = busy;
    }
  });
  if (btn) btn.textContent = busy ? labelBusy : labelIdle;
}

function passwordScore(pw) {
  let score = 0;
  if (pw.length >= 8) score += 1;
  if (pw.length >= 12) score += 1;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score += 1;
  if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) score += 1;
  return Math.min(4, score);
}

function updateStrength(root, password) {
  const wrap =
    root?.matches?.("[data-auth-strength]") ? root : qs(root, "[data-auth-strength]");
  if (!wrap) return;
  const score = password ? passwordScore(password) : 0;
  const bars = [...wrap.querySelectorAll(".auth-strength__bar")];
  const label = qs(wrap, ".auth-strength__label");
  const labels = ["", "Weak", "Fair", "Good", "Strong"];
  bars.forEach((bar, i) => {
    const on = i < score;
    bar.classList.toggle("is-on", on);
    bar.classList.toggle("is-weak", on && score <= 1);
    bar.classList.toggle("is-warn", on && score === 2);
  });
  if (label) label.textContent = password ? `Strength: ${labels[score] || "Weak"}` : "Password strength";

  const reqs = {
    len: password.length >= 8,
    case: /[a-z]/.test(password) && /[A-Z]/.test(password),
    num: /\d/.test(password),
    special: /[^A-Za-z0-9]/.test(password),
  };
  wrap.querySelectorAll("[data-req]").forEach((li) => {
    const key = li.getAttribute("data-req");
    li.classList.toggle("is-met", Boolean(reqs[key]));
  });
}

function wirePasswordToggles(root) {
  root.querySelectorAll("[data-toggle-password]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-toggle-password");
      const input = id ? document.getElementById(id) : null;
      if (!(input instanceof HTMLInputElement)) return;
      const show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
      btn.innerHTML = show ? EYE_OFF : EYE_OPEN;
    });
    btn.innerHTML = EYE_OPEN;
  });
}

function showScreen(name) {
  const page = document.getElementById("view-auth");
  if (!page) return;
  page.querySelectorAll("[data-auth-screen]").forEach((el) => {
    el.hidden = el.getAttribute("data-auth-screen") !== name;
  });
}

function pendingVerifyEmail() {
  try {
    return sessionStorage.getItem("ta_pending_verify_email") || "";
  } catch {
    return "";
  }
}

function setPendingVerifyEmail(email) {
  try {
    if (email) sessionStorage.setItem("ta_pending_verify_email", email);
    else sessionStorage.removeItem("ta_pending_verify_email");
  } catch {
    /* ignore */
  }
}

export function showAuthRoute() {
  const landing = document.getElementById("view-landing");
  const shell = document.getElementById("app-shell");
  const auth = document.getElementById("view-auth");
  if (landing) landing.hidden = true;
  if (shell) shell.hidden = true;
  if (auth) auth.hidden = false;
  document.body.classList.add("is-auth");
  document.body.classList.remove("is-landing");

  const path = (location.pathname || "/").replace(/\/+$/, "") || "/";
  const params = new URLSearchParams(location.search);

  if (path === "/register") {
    showScreen("register");
    document.title = "Create account — TradeAtlant";
    qs(auth, "#auth-register-name")?.focus();
  } else if (path === "/check-email") {
    showScreen("check-email");
    document.title = "Check your email — TradeAtlant";
    const email = params.get("email") || pendingVerifyEmail();
    const el = qs(auth, "#auth-check-email-address");
    if (el) el.textContent = email || "your inbox";
    if (email) setPendingVerifyEmail(email);
  } else if (path === "/forgot-password") {
    showScreen("forgot");
    document.title = "Reset password — TradeAtlant";
    qs(auth, "#auth-forgot-email")?.focus();
  } else if (path === "/reset-password") {
    showScreen("reset");
    document.title = "Choose a new password — TradeAtlant";
    const tokenInput = qs(auth, "#auth-reset-token");
    if (tokenInput) tokenInput.value = params.get("token") || "";
    qs(auth, "#auth-reset-password")?.focus();
  } else {
    showScreen("login");
    document.title = "Log in — TradeAtlant";
    if (params.get("verified") === "1") {
      setMsg(qs(auth, "#auth-login-success"), "Email verified. You can log in now.", true);
    }
    qs(auth, "#auth-login-email")?.focus();
  }
}

export function hideAuthRoute() {
  const auth = document.getElementById("view-auth");
  if (auth) {
    auth.hidden = true;
    auth.setAttribute("hidden", "");
  }
  document.body.classList.remove("is-auth");
}

function navigate(path) {
  history.pushState({ auth: true }, "", path);
  showAuthRoute();
}

function renderTopbarUser() {
  const root = document.getElementById("topbar-login");
  if (!root) return;
  const guest = qs(root, "#topbar-login-guest");
  const user = qs(root, "#topbar-login-user");
  const nameEl = qs(root, "#topbar-login-user-name");
  const planEl = qs(root, "#topbar-login-user-plan");
  const emailMenuEl = qs(root, "#topbar-login-user-email-menu");

  if (currentUser) {
    guest?.setAttribute("hidden", "");
    user?.removeAttribute("hidden");
    // Prefer profile name; fall back to email only if name was never set.
    const label =
      String(currentUser.name || currentUser.displayName || "").trim() ||
      currentUser.email;
    if (nameEl) nameEl.textContent = label;
    if (emailMenuEl) {
      emailMenuEl.textContent = currentUser.email;
      emailMenuEl.hidden = false;
    }
    if (planEl) {
      planEl.textContent = currentUser.plan === "premium" ? "Premium" : "Free plan";
      planEl.hidden = false;
    }
  } else {
    user?.setAttribute("hidden", "");
    guest?.removeAttribute("hidden");
  }
}

export async function refreshAuthSession() {
  try {
    const data = await authFetch("/api/auth/me");
    currentUser = data?.user || null;
  } catch {
    currentUser = null;
  }
  renderTopbarUser();
  return currentUser;
}

export function setupAuthLoginPanel() {
  const root = document.getElementById("topbar-login");
  const authView = document.getElementById("view-auth");
  if (!root || !authView) return;

  root.hidden = false;
  document.body.classList.add("has-auth-login");
  wirePasswordToggles(authView);

  const userTrigger = qs(root, "#topbar-login-user-trigger");
  const userPanel = qs(root, "#topbar-login-user-menu");
  const logoutBtn = qs(root, "#topbar-login-logout");

  void refreshAuthSession();

  userTrigger?.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!userPanel) return;
    const open = userPanel.hidden;
    userPanel.hidden = !open;
    userTrigger.setAttribute("aria-expanded", String(open));
  });

  logoutBtn?.addEventListener("click", async () => {
    try {
      await authFetch("/api/auth/logout", { method: "POST", body: "{}" });
    } catch {
      /* ignore */
    }
    currentUser = null;
    renderTopbarUser();
    if (userPanel) {
      userPanel.hidden = true;
      userTrigger?.setAttribute("aria-expanded", "false");
    }
  });

  document.addEventListener("click", (e) => {
    if (!userPanel || userPanel.hidden) return;
    if (root.contains(e.target)) return;
    userPanel.hidden = true;
    userTrigger?.setAttribute("aria-expanded", "false");
  });

  // --- Login ---
  const loginForm = qs(authView, "#auth-login-form");
  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = qs(authView, "#auth-login-error");
    const okEl = qs(authView, "#auth-login-success");
    setMsg(errEl, "", false);
    const email = String(qs(authView, "#auth-login-email")?.value || "").trim();
    const password = String(qs(authView, "#auth-login-password")?.value || "");
    try {
      setBusy(loginForm, true, "Log in", "Signing in…");
      const data = await authFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      currentUser = data.user;
      renderTopbarUser();
      history.pushState({}, "", "/stocks");
      hideAuthRoute();
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (err) {
      if (err?.code === "email_unverified") {
        setPendingVerifyEmail(email);
        navigate(`/check-email?email=${encodeURIComponent(email)}`);
        return;
      }
      setMsg(okEl, "", false);
      setMsg(errEl, err instanceof Error ? err.message : "Could not log in.", true);
    } finally {
      setBusy(loginForm, false, "Log in", "Signing in…");
    }
  });

  // --- Register ---
  const registerForm = qs(authView, "#auth-register-form");
  const regPassword = qs(authView, "#auth-register-password");
  regPassword?.addEventListener("input", () => updateStrength(authView, regPassword.value));

  registerForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = qs(authView, "#auth-register-error");
    setMsg(errEl, "", false);
    const name = String(qs(authView, "#auth-register-name")?.value || "").trim();
    const email = String(qs(authView, "#auth-register-email")?.value || "").trim();
    const password = String(regPassword?.value || "");
    const confirm = String(qs(authView, "#auth-register-confirm")?.value || "");
    const terms = qs(authView, "#auth-register-terms");
    if (terms instanceof HTMLInputElement && !terms.checked) {
      setMsg(errEl, "Please accept the terms to continue.", true);
      return;
    }
    if (password !== confirm) {
      setMsg(errEl, "Passwords do not match.", true);
      return;
    }
    try {
      setBusy(registerForm, true, "Create account", "Creating…");
      const data = await authFetch("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({ name, email, password }),
      });
      if (data.requiresEmailVerification) {
        setPendingVerifyEmail(email);
        if (data.verifyUrl) {
          console.info("[auth] Verify email URL:", data.verifyUrl);
          try {
            sessionStorage.setItem("ta_dev_verify_url", data.verifyUrl);
          } catch {
            /* ignore */
          }
        }
        navigate(`/check-email?email=${encodeURIComponent(email)}`);
        return;
      }
      currentUser = data.user;
      renderTopbarUser();
      history.pushState({}, "", "/stocks");
      hideAuthRoute();
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch (err) {
      setMsg(errEl, err instanceof Error ? err.message : "Could not create account.", true);
    } finally {
      setBusy(registerForm, false, "Create account", "Creating…");
    }
  });

  // --- Check email / resend ---
  const resendBtn = qs(authView, "#auth-resend-verification");
  resendBtn?.addEventListener("click", async () => {
    const errEl = qs(authView, "#auth-check-error");
    const okEl = qs(authView, "#auth-check-success");
    const email = pendingVerifyEmail() || String(qs(authView, "#auth-check-email-address")?.textContent || "");
    setMsg(errEl, "", false);
    setMsg(okEl, "", false);
    if (!email || email === "your inbox") {
      setMsg(errEl, "Missing email. Go back and register again.", true);
      return;
    }
    try {
      resendBtn.disabled = true;
      resendBtn.textContent = "Sending…";
      const data = await authFetch("/api/auth/resend-verification", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setMsg(okEl, data.message || "If needed, a new link was sent.", true);
      if (data.verifyUrl) {
        console.info("[auth] Verify email URL:", data.verifyUrl);
        const hint = qs(authView, "#auth-check-dev-hint");
        if (hint) {
          hint.hidden = false;
          hint.innerHTML = `Dev link: <a href="${data.verifyUrl}">${data.verifyUrl}</a>`;
        }
      }
    } catch (err) {
      setMsg(errEl, err instanceof Error ? err.message : "Could not resend.", true);
    } finally {
      resendBtn.disabled = false;
      resendBtn.textContent = "Resend verification email";
    }
  });

  // Show stored dev verify URL on check-email
  const devHint = qs(authView, "#auth-check-dev-hint");
  try {
    const url = sessionStorage.getItem("ta_dev_verify_url");
    if (url && devHint) {
      devHint.hidden = false;
      devHint.innerHTML = `Dev link: <a href="${url}">Open verification link</a>`;
    }
  } catch {
    /* ignore */
  }

  // --- Forgot ---
  const forgotForm = qs(authView, "#auth-forgot-form");
  forgotForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = qs(authView, "#auth-forgot-error");
    const okEl = qs(authView, "#auth-forgot-success");
    setMsg(errEl, "", false);
    setMsg(okEl, "", false);
    const email = String(qs(authView, "#auth-forgot-email")?.value || "").trim();
    try {
      setBusy(forgotForm, true, "Send reset link", "Sending…");
      const data = await authFetch("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email }),
      });
      setMsg(okEl, data.message || "Check your email for a reset link.", true);
      if (data.resetUrl) {
        console.info("[auth] Reset URL:", data.resetUrl);
        const hint = qs(authView, "#auth-forgot-dev-hint");
        if (hint) {
          hint.hidden = false;
          hint.innerHTML = `Dev link: <a href="${data.resetUrl}">Open reset link</a>`;
        }
      }
    } catch (err) {
      setMsg(errEl, err instanceof Error ? err.message : "Could not send reset link.", true);
    } finally {
      setBusy(forgotForm, false, "Send reset link", "Sending…");
    }
  });

  // --- Reset ---
  const resetForm = qs(authView, "#auth-reset-form");
  const resetPw = qs(authView, "#auth-reset-password");
  resetPw?.addEventListener("input", () =>
    updateStrength(qs(authView, "#auth-reset-strength"), resetPw.value)
  );

  resetForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const errEl = qs(authView, "#auth-reset-error");
    setMsg(errEl, "", false);
    const token = String(qs(authView, "#auth-reset-token")?.value || "").trim();
    const password = String(resetPw?.value || "");
    const confirm = String(qs(authView, "#auth-reset-confirm")?.value || "");
    if (!token) {
      setMsg(errEl, "This reset link is missing a token. Request a new one.", true);
      return;
    }
    if (password !== confirm) {
      setMsg(errEl, "Passwords do not match.", true);
      return;
    }
    try {
      setBusy(resetForm, true, "Update password", "Updating…");
      await authFetch("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, password }),
      });
      navigate("/login?verified=0");
      showAuthRoute();
      setMsg(qs(authView, "#auth-login-success"), "Password updated. Log in with your new password.", true);
    } catch (err) {
      setMsg(errEl, err instanceof Error ? err.message : "Could not update password.", true);
    } finally {
      setBusy(resetForm, false, "Update password", "Updating…");
    }
  });

  // SPA navigation for auth links (topbar + auth footers)
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.(
      'a[href="/login"], a[href="/register"], a[href="/forgot-password"], a[href="/check-email"], a[href="/reset-password"]'
    );
    if (!a) return;
    const href = a.getAttribute("href");
    if (!href || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    navigate(href);
  });
}
