/**
 * Transactional email via Resend.
 * Falls back to console logging when RESEND_API_KEY is unset (local/dev).
 */

export type AuthEmailKind = "verify" | "reset";

export interface SendAuthEmailInput {
  kind: AuthEmailKind;
  to: string;
  actionUrl: string;
  name?: string | null;
}

export interface SendContactEmailInput {
  name: string;
  email: string;
  subject: string;
  message: string;
}

function fromAddress(): string {
  return (
    process.env.AUTH_EMAIL_FROM?.trim() ||
    "InvestAtlant <onboarding@resend.dev>"
  );
}

function contactInbox(): string {
  return process.env.CONTACT_INBOX?.trim() || "contact@investatlant.com";
}

function isConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

function escapeHtml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildContent(input: SendAuthEmailInput): { subject: string; html: string; text: string } {
  const greeting = input.name ? `Hi ${input.name},` : "Hi,";
  if (input.kind === "verify") {
    return {
      subject: "Verify your InvestAtlant email",
      text: `${greeting}\n\nConfirm your email to finish creating your InvestAtlant account:\n${input.actionUrl}\n\nThis link expires in 48 hours. If you didn't sign up, you can ignore this email.\n`,
      html: `
        <div style="font-family:DM Sans,Segoe UI,sans-serif;line-height:1.5;color:#0c1017;max-width:520px;margin:0 auto;padding:24px">
          <p style="margin:0 0 8px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#0f766e;font-weight:700">InvestAtlant</p>
          <h1 style="margin:0 0 12px;font-size:22px;letter-spacing:-.02em">Verify your email</h1>
          <p style="margin:0 0 16px;color:#334155">${greeting}</p>
          <p style="margin:0 0 20px;color:#334155">Confirm your email to finish creating your account.</p>
          <p style="margin:0 0 24px">
            <a href="${input.actionUrl}" style="display:inline-block;background:#14b8a6;color:#042f2e;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:10px">Verify email</a>
          </p>
          <p style="margin:0 0 8px;font-size:13px;color:#64748b">Or paste this link into your browser:</p>
          <p style="margin:0;font-size:12px;word-break:break-all;color:#64748b">${input.actionUrl}</p>
          <p style="margin:24px 0 0;font-size:12px;color:#94a3b8">This link expires in 48 hours. If you didn’t create an account, ignore this email.</p>
        </div>
      `.trim(),
    };
  }

  return {
    subject: "Reset your InvestAtlant password",
    text: `${greeting}\n\nReset your InvestAtlant password using this link:\n${input.actionUrl}\n\nThis link expires in 1 hour. If you didn't request a reset, you can ignore this email.\n`,
    html: `
      <div style="font-family:DM Sans,Segoe UI,sans-serif;line-height:1.5;color:#0c1017;max-width:520px;margin:0 auto;padding:24px">
        <p style="margin:0 0 8px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#0f766e;font-weight:700">InvestAtlant</p>
        <h1 style="margin:0 0 12px;font-size:22px;letter-spacing:-.02em">Reset your password</h1>
        <p style="margin:0 0 16px;color:#334155">${greeting}</p>
        <p style="margin:0 0 20px;color:#334155">Click below to choose a new password.</p>
        <p style="margin:0 0 24px">
          <a href="${input.actionUrl}" style="display:inline-block;background:#14b8a6;color:#042f2e;text-decoration:none;font-weight:700;padding:12px 18px;border-radius:10px">Reset password</a>
        </p>
        <p style="margin:0 0 8px;font-size:13px;color:#64748b">Or paste this link into your browser:</p>
        <p style="margin:0;font-size:12px;word-break:break-all;color:#64748b">${input.actionUrl}</p>
        <p style="margin:24px 0 0;font-size:12px;color:#94a3b8">This link expires in 1 hour. If you didn’t request a reset, ignore this email.</p>
      </div>
    `.trim(),
  };
}

/**
 * Send an auth email. Never throws to the request path for provider failures —
 * logs instead so signup/reset still succeed (user can resend).
 */
export async function sendAuthEmail(input: SendAuthEmailInput): Promise<{ sent: boolean; error?: string }> {
  const content = buildContent(input);
  const apiKey = process.env.RESEND_API_KEY?.trim();

  if (!apiKey) {
    console.log(`[auth:email] RESEND_API_KEY unset — ${input.kind} link for ${input.to}: ${input.actionUrl}`);
    return { sent: false, error: "email_not_configured" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [input.to],
        subject: content.subject,
        html: content.html,
        text: content.text,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const message = `Resend HTTP ${res.status}: ${body.slice(0, 400)}`;
      console.error(`[auth:email] Failed to send ${input.kind} to ${input.to}:`, message);
      return { sent: false, error: message };
    }

    const data = (await res.json().catch(() => ({}))) as { id?: string };
    console.log(`[auth:email] Sent ${input.kind} to ${input.to}${data.id ? ` (id=${data.id})` : ""}`);
    return { sent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[auth:email] Failed to send ${input.kind} to ${input.to}:`, message);
    return { sent: false, error: message };
  }
}

/** Site contact form → CONTACT_INBOX (default contact@investatlant.com). */
export async function sendContactEmail(
  input: SendContactEmailInput
): Promise<{ sent: boolean; error?: string }> {
  const to = contactInbox();
  const subject = `[Contact] ${input.subject}`.slice(0, 200);
  const text = [`Name: ${input.name}`, `Email: ${input.email}`, "", input.message].join("\n");
  const html = `
    <div style="font-family:DM Sans,Segoe UI,sans-serif;line-height:1.5;color:#0c1017;max-width:560px;margin:0 auto;padding:24px">
      <p style="margin:0 0 8px;font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#0f766e;font-weight:700">InvestAtlant Contact</p>
      <h1 style="margin:0 0 16px;font-size:20px;letter-spacing:-.02em">${escapeHtml(input.subject)}</h1>
      <p style="margin:0 0 6px;color:#334155"><strong>From:</strong> ${escapeHtml(input.name)}</p>
      <p style="margin:0 0 16px;color:#334155"><strong>Email:</strong> ${escapeHtml(input.email)}</p>
      <div style="margin:0;padding:14px 16px;border-radius:10px;background:#f8fafc;border:1px solid #e2e8f0;white-space:pre-wrap;color:#0f172a">${escapeHtml(input.message)}</div>
    </div>
  `.trim();

  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    console.log(`[contact:email] RESEND_API_KEY unset — message from ${input.email}:\n${text}`);
    return { sent: false, error: "email_not_configured" };
  }

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [to],
        reply_to: input.email,
        subject,
        html,
        text,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      const message = `Resend HTTP ${res.status}: ${body.slice(0, 400)}`;
      console.error(`[contact:email] Failed to send contact mail:`, message);
      return { sent: false, error: message };
    }

    const data = (await res.json().catch(() => ({}))) as { id?: string };
    console.log(
      `[contact:email] Sent contact form from ${input.email} to ${to}${data.id ? ` (id=${data.id})` : ""}`
    );
    return { sent: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[contact:email] Failed to send contact mail:`, message);
    return { sent: false, error: message };
  }
}

export function authEmailConfigured(): boolean {
  return isConfigured();
}
