/**
 * Admin users page — grant/revoke Premium for family & friends.
 */

import {
  getCurrentAuthUser,
  refreshAuthSession,
} from "./authLoginPanel.js?v=admin-users-1";

function setNote(text, kind = "") {
  const note = document.getElementById("admin-page-note");
  if (!note) return;
  note.textContent = text || "";
  note.hidden = !text;
  note.classList.toggle("is-error", kind === "error");
  note.classList.toggle("is-success", kind === "success");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function loadUsers(q = "") {
  const loading = document.getElementById("admin-page-loading");
  const body = document.getElementById("admin-users-body");
  if (loading) loading.hidden = false;
  setNote("");
  try {
    const params = new URLSearchParams({ limit: "50" });
    if (q.trim()) params.set("q", q.trim());
    const res = await fetch(`/api/admin/users?${params}`, { credentials: "include" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.message || data.error || "Failed to load users");
    }
    const users = Array.isArray(data.users) ? data.users : [];
    if (body) {
      if (!users.length) {
        body.innerHTML = `<tr><td colspan="6" class="admin-page__empty">No users found.</td></tr>`;
      } else {
        body.innerHTML = users
          .map((u) => {
            const premium = Boolean(u.premium);
            const planLabel = premium ? "Premium" : "Free";
            const status = u.subscriptionStatus || (premium ? "active" : "—");
            const actionPlan = premium ? "free" : "premium";
            const actionLabel = premium ? "Revoke Premium" : "Grant Premium";
            const isAdmin = String(u.role || "") === "admin";
            const deleteBtn = isAdmin
              ? ""
              : `<button
                    type="button"
                    class="btn btn--ghost admin-page__delete-btn"
                    data-admin-delete="1"
                    data-user-id="${escapeHtml(u.id)}"
                    data-user-email="${escapeHtml(u.email)}"
                  >Delete</button>`;
            return `
              <tr data-user-id="${escapeHtml(u.id)}">
                <td class="mono">${escapeHtml(u.email)}</td>
                <td>${escapeHtml(u.name || "—")}</td>
                <td>${escapeHtml(u.role)}</td>
                <td><span class="admin-page__plan ${premium ? "is-premium" : ""}">${escapeHtml(planLabel)}</span></td>
                <td class="muted small">${escapeHtml(status)}</td>
                <td class="admin-page__actions-cell">
                  <button
                    type="button"
                    class="btn btn--ghost admin-page__plan-btn"
                    data-admin-plan="${actionPlan}"
                    data-user-id="${escapeHtml(u.id)}"
                  >${actionLabel}</button>
                  ${deleteBtn}
                </td>
              </tr>`;
          })
          .join("");
      }
    }
  } catch (err) {
    if (body) body.innerHTML = "";
    setNote(err instanceof Error ? err.message : String(err), "error");
  } finally {
    if (loading) loading.hidden = true;
  }
}

async function setUserPlan(userId, plan) {
  const res = await fetch(`/api/admin/users/${userId}/plan`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || "Failed to update plan");
  return data.user;
}

async function deleteUser(userId) {
  const res = await fetch(`/api/admin/users/${userId}`, {
    method: "DELETE",
    credentials: "include",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || data.error || "Failed to delete user");
  return data;
}

export async function refreshAdminPage() {
  await refreshAuthSession();
  const user = getCurrentAuthUser();
  if (!user) {
    history.replaceState({}, "", `/login?next=${encodeURIComponent("/admin")}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
    return;
  }
  if (user.role !== "admin") {
    history.replaceState({}, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
    return;
  }
  const search = document.getElementById("admin-user-search");
  await loadUsers(search?.value || "");
}

export function setupAdminPage() {
  document.addEventListener("click", (e) => {
    const a = e.target.closest?.('a[href="/admin"]');
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    history.pushState({}, "", "/admin");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });

  const search = document.getElementById("admin-user-search");
  let timer = null;
  search?.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      void loadUsers(search.value || "");
    }, 250);
  });

  document.getElementById("admin-user-refresh")?.addEventListener("click", () => {
    void loadUsers(search?.value || "");
  });

  document.getElementById("admin-users-body")?.addEventListener("click", async (e) => {
    const deleteBtn = e.target.closest?.("[data-admin-delete]");
    if (deleteBtn) {
      const userId = deleteBtn.getAttribute("data-user-id");
      const email = deleteBtn.getAttribute("data-user-email") || "this user";
      if (!userId) return;
      const ok = window.confirm(
        `Delete ${email}?\n\nThis permanently removes the account and sessions. It cannot be undone.`
      );
      if (!ok) return;
      deleteBtn.disabled = true;
      try {
        await deleteUser(userId);
        setNote(`Deleted ${email}.`, "success");
        await loadUsers(search?.value || "");
      } catch (err) {
        setNote(err instanceof Error ? err.message : String(err), "error");
        deleteBtn.disabled = false;
      }
      return;
    }

    const btn = e.target.closest?.("[data-admin-plan]");
    if (!btn) return;
    const userId = btn.getAttribute("data-user-id");
    const plan = btn.getAttribute("data-admin-plan");
    if (!userId || (plan !== "premium" && plan !== "free")) return;
    btn.disabled = true;
    try {
      await setUserPlan(userId, plan);
      setNote(
        plan === "premium" ? "Premium granted." : "Premium revoked.",
        "success"
      );
      await loadUsers(search?.value || "");
    } catch (err) {
      setNote(err instanceof Error ? err.message : String(err), "error");
      btn.disabled = false;
    }
  });
}
