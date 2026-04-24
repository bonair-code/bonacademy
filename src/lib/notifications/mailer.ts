import nodemailer from "nodemailer";

let cached: nodemailer.Transporter | null = null;

export function mailer() {
  if (cached) return cached;
  cached = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
  });
  return cached;
}

export async function sendMail(opts: {
  to: string;
  subject: string;
  html: string;
  attachments?: nodemailer.SendMailOptions["attachments"];
}) {
  if (!process.env.SMTP_HOST) {
    console.log("[mail:dev] to=%s subject=%s\n%s", opts.to, opts.subject, opts.html);
    return;
  }
  await mailer().sendMail({
    from: process.env.SMTP_FROM || "BonAcademy <noreply@bonair.com.tr>",
    ...opts,
  });
}

/**
 * E-posta HTML şablonlarında kullanıcı-kontrollü metinleri (isim, e-posta,
 * kurs başlığı) inline etmeden önce HTML-escape etmek şart. Aksi hâlde
 * kötü niyetli bir kullanıcı `name = "<script>..."` yazarak admin/yönetici
 * inbox'ında HTML render ettirebilir.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function appUrl(path = "/"): string {
  const base = process.env.APP_URL || "http://localhost:3000";
  return base.replace(/\/$/, "") + path;
}

type Locale = "en" | "tr";
function normLocale(l?: string | null): Locale {
  return l === "tr" ? "tr" : "en";
}

export async function sendInviteEmail(to: string, name: string, token: string, locale?: string) {
  const url = appUrl(`/invite/${token}`);
  const L = normLocale(locale);
  const safeName = escapeHtml(name);
  const subject =
    L === "tr" ? "BonAcademy hesabınız oluşturuldu" : "Your BonAcademy account has been created";
  const html =
    L === "tr"
      ? `<p>Merhaba ${safeName},</p><p>BonAcademy hesabınız oluşturuldu. Şifrenizi belirlemek için aşağıdaki bağlantıyı kullanın (72 saat geçerli):</p><p><a href="${url}">${url}</a></p>`
      : `<p>Hi ${safeName},</p><p>Your BonAcademy account has been created. Please use the link below to set your password (valid for 72 hours):</p><p><a href="${url}">${url}</a></p>`;
  await sendMail({ to, subject, html });
}

export async function sendResetEmail(to: string, name: string, token: string, locale?: string) {
  const url = appUrl(`/reset/${token}`);
  const L = normLocale(locale);
  const safeName = escapeHtml(name);
  const subject =
    L === "tr" ? "BonAcademy şifre sıfırlama" : "BonAcademy password reset";
  const html =
    L === "tr"
      ? `<p>Merhaba ${safeName},</p><p>Şifrenizi sıfırlamak için aşağıdaki bağlantıyı kullanın (2 saat geçerli):</p><p><a href="${url}">${url}</a></p><p>Bu talebi siz yapmadıysanız e-postayı yok sayabilirsiniz.</p>`
      : `<p>Hi ${safeName},</p><p>Please use the link below to reset your password (valid for 2 hours):</p><p><a href="${url}">${url}</a></p><p>If you did not request this, you can safely ignore this email.</p>`;
  await sendMail({ to, subject, html });
}
