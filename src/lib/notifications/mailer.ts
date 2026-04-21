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

export function appUrl(path = "/"): string {
  const base = process.env.APP_URL || "http://localhost:3000";
  return base.replace(/\/$/, "") + path;
}

export async function sendInviteEmail(to: string, name: string, token: string) {
  const url = appUrl(`/invite/${token}`);
  await sendMail({
    to,
    subject: "BonAcademy hesabınız oluşturuldu",
    html: `<p>Merhaba ${name},</p><p>BonAcademy hesabınız oluşturuldu. Şifrenizi belirlemek için aşağıdaki bağlantıyı kullanın (72 saat geçerli):</p><p><a href="${url}">${url}</a></p>`,
  });
}

export async function sendResetEmail(to: string, name: string, token: string) {
  const url = appUrl(`/reset/${token}`);
  await sendMail({
    to,
    subject: "BonAcademy şifre sıfırlama",
    html: `<p>Merhaba ${name},</p><p>Şifrenizi sıfırlamak için aşağıdaki bağlantıyı kullanın (2 saat geçerli):</p><p><a href="${url}">${url}</a></p><p>Bu talebi siz yapmadıysanız e-postayı yok sayabilirsiniz.</p>`,
  });
}
