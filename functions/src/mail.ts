/**
 * E-posta gönderimi — CAPELLA'nın kendi posta sunucusu üzerinden (SMTP).
 *
 * Sağlayıcı: Brevo SMTP relay (smtp-relay.brevo.com:587, STARTTLS).
 * capella.aero'nun kendi posta sağlayıcısı (isimtescil / mailmatik) şifreli
 * gönderim sunmuyor — 465 kapalı, 587'de STARTTLS yok; o yoldan kutu şifresi
 * ve mail içeriği açık metin giderdi (08.10.2026'da denendi). Brevo için
 * capella.aero'ya SPF/DKIM kayıtları eklenir; gönderen yine
 * noreply@capella.aero görünür. Kod sağlayıcıdan bağımsız: yalnız ayar değişir.
 *
 * Ayarlar (gizli olmayan): functions/.env → SMTP_HOST, SMTP_PORT, SMTP_USER
 * (sağlayıcının giriş adı), MAIL_FROM (görünen gönderen), APP_URL.
 * Şifre / SMTP anahtarı Secret Manager'da: SMTP_PASSWORD
 *   npx firebase functions:secrets:set SMTP_PASSWORD --project capella-academy-v2
 * Mail gönderen her fonksiyon `secrets: [SMTP_PASSWORD]` taşımalı.
 *
 * Gönderim hatası asıl işlemi BOZMAZ (kullanıcı açılır, atama yapılır);
 * sonuç `notifications` koleksiyonuna yazılır ve çağırana döner.
 */
import nodemailer from "nodemailer";
import { defineSecret } from "firebase-functions/params";
import { FieldValue, getFirestore } from "firebase-admin/firestore";

export const SMTP_PASSWORD = defineSecret("SMTP_PASSWORD");

const env = (k: string, d: string) => (process.env[k] || d).trim();
export const appUrl = () => env("APP_URL", "https://academy.capella.aero").replace(/\/+$/, "");
/** Görünen gönderen. Brevo gibi sağlayıcılarda giriş adı (SMTP_USER) farklıdır. */
const fromAddress = () => env("MAIL_FROM", "noreply@capella.aero");
const REPLY_TO = "info@capella.aero";

let transport: ReturnType<typeof nodemailer.createTransport> | null = null;
function getTransport() {
  if (transport) return transport;
  const port = Number(env("SMTP_PORT", "465"));
  transport = nodemailer.createTransport({
    host: env("SMTP_HOST", "smtp-relay.brevo.com"),
    port,
    secure: port === 465, // 465: doğrudan TLS; 587: STARTTLS
    // Şifresiz bağlantıya asla düşme: şifre ve içerik açık metin gitmesin.
    requireTLS: port !== 465,
    auth: { user: env("SMTP_USER", ""), pass: SMTP_PASSWORD.value() },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
  });
  return transport;
}

export type MailResult = { ok: boolean; error?: string };

export async function sendMail(m: {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** INVITE, ASSIGNMENT … — kayıt ve raporlama için. */
  type: string;
  userId?: string | null;
  meta?: Record<string, unknown>;
}): Promise<MailResult> {
  const log = getFirestore().collection("notifications").doc();
  const base = {
    channel: "EMAIL",
    type: m.type,
    userId: m.userId ?? null,
    to: m.to,
    subject: m.subject,
    createdAt: FieldValue.serverTimestamp(),
    ...(m.meta ?? {}),
  };
  try {
    await getTransport().sendMail({
      from: { name: "Capella Academy", address: fromAddress() },
      replyTo: REPLY_TO,
      to: m.to,
      subject: m.subject,
      html: m.html,
      text: m.text,
    });
    await log.set({ ...base, status: "SENT", sentAt: FieldValue.serverTimestamp() });
    return { ok: true };
  } catch (e) {
    const error = (e as Error).message.slice(0, 500);
    console.error(`sendMail ${m.type} → ${m.to} failed:`, error);
    await log.set({ ...base, status: "FAILED", error });
    return { ok: false, error };
  }
}

/* ── Şablonlar ──────────────────────────────────────────────
 * Tablo + satır içi stil: e-posta istemcileri (Outlook dahil) CSS dosyası ve
 * çoğu modern CSS'i okumaz. Tasarım CAPELLA/eposta-sablonlari.html'de onaylandı.
 */

export type MailLang = "tr" | "en";
export const mailLang = (locale: unknown): MailLang => (String(locale).toLowerCase() === "en" ? "en" : "tr");

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

function shell(inner: string, lang: MailLang) {
  const foot =
    lang === "en"
      ? `This is an automated message. For questions please write to <a href="mailto:${REPLY_TO}" style="color:#64748b">${REPLY_TO}</a>`
      : `Bu e-posta otomatik gönderilmiştir. Sorularınız için <a href="mailto:${REPLY_TO}" style="color:#64748b">${REPLY_TO}</a>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f6f9">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;border:1px solid #e2e8f0;font-family:${FONT};color:#1e293b">
<tr><td style="padding:26px 32px 18px;border-bottom:1px solid #eef2f7"><img src="${appUrl()}/Logo.png" alt="Capella Aviation Solutions" height="38" style="display:block;height:38px;border:0"></td></tr>
<tr><td style="padding:26px 32px 30px;font-size:15px;line-height:1.6">${inner}</td></tr>
<tr><td style="padding:16px 32px 22px;border-top:1px solid #eef2f7;font-size:12px;line-height:1.6;color:#94a3b8">Capella Aviation Solutions · <a href="https://www.capella.aero" style="color:#94a3b8">www.capella.aero</a><br>${foot}</td></tr>
</table></td></tr></table></body></html>`;
}

const button = (href: string, text: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0 8px"><tr><td style="background:#2b4685;border-radius:10px"><a href="${esc(href)}" style="display:inline-block;padding:13px 26px;color:#ffffff;font-weight:600;font-size:15px;text-decoration:none;font-family:${FONT}">${esc(text)}</a></td></tr></table>`;

/**
 * Butonun altında linkin açık hali. Kişi nereye gideceğini görür; spam
 * filtreleri de "buton yazısı başka, adres başka" durumunu oltalama sayıyor
 * (davet maili ilk denemede gereksize düştü).
 */
const plainLink = (href: string, label: string) =>
  `<p style="margin:12px 0 0;font-size:12px;color:#94a3b8">${esc(label)}<br><span style="color:#475569;word-break:break-all">${esc(href)}</span></p>`;

const fmtDate = (d: Date | null | undefined) =>
  d ? d.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul" }) : "";

export function inviteMail(lang: MailLang, p: { name: string; email: string; link: string; days: number }) {
  const host = appUrl().replace(/^https?:\/\//, "");
  if (lang === "en") {
    const subject = "Your Capella Academy account has been created";
    const html = shell(
      `<p style="margin:0 0 14px">Dear <b>${esc(p.name)}</b>,</p>
<p style="margin:0 0 14px">An account has been created for you on <b>Capella Academy</b>, the training platform of Capella Aviation Solutions.</p>
<p style="margin:0">Your sign-in email: <b>${esc(p.email)}</b></p>
${button(p.link, "Activate my account")}
${plainLink(p.link, "If the button does not work, copy this address into your browser:")}
<p style="margin:14px 0 0;font-size:13px;color:#64748b">The link is valid for ${p.days} days and can be used once. Afterwards you can sign in at <a href="${appUrl()}" style="color:#2b4685">${host}</a>.</p>`,
      lang
    );
    const text = `Dear ${p.name},\n\nAn account has been created for you on Capella Academy, the training platform of Capella Aviation Solutions.\nYour sign-in email: ${p.email}\n\nActivate your account: ${p.link}\n\nThe link is valid for ${p.days} days and can be used once.\n\nCapella Aviation Solutions · ${REPLY_TO}`;
    return { subject, html, text };
  }
  const subject = "Capella Academy hesabınız oluşturuldu";
  const html = shell(
    `<p style="margin:0 0 14px">Sayın <b>${esc(p.name)}</b>,</p>
<p style="margin:0 0 14px">Capella Aviation Solutions eğitim platformu <b>Capella Academy</b>'de sizin için bir hesap oluşturulmuştur.</p>
<p style="margin:0">Giriş e-postanız: <b>${esc(p.email)}</b></p>
${button(p.link, "Hesabımı etkinleştir")}
${plainLink(p.link, "Buton çalışmazsa bu adresi tarayıcınıza yapıştırın:")}
<p style="margin:14px 0 0;font-size:13px;color:#64748b">Bağlantı ${p.days} gün geçerlidir ve bir kez kullanılabilir. Sonrasında <a href="${appUrl()}" style="color:#2b4685">${host}</a> adresinden giriş yapabilirsiniz.</p>`,
    lang
  );
  const text = `Sayın ${p.name},\n\nCapella Aviation Solutions eğitim platformu Capella Academy'de sizin için bir hesap oluşturulmuştur.\nGiriş e-postanız: ${p.email}\n\nHesabınızı etkinleştirin: ${p.link}\n\nBağlantı ${p.days} gün geçerlidir ve bir kez kullanılabilir.\n\nCapella Aviation Solutions · ${REPLY_TO}`;
  return { subject, html, text };
}

export type AssignedItem = { title: string; dueDate: Date | null; examRequired: boolean };

export function assignmentMail(lang: MailLang, p: { name: string; items: AssignedItem[]; link: string }) {
  const one = p.items.length === 1;
  const card = p.items
    .map((it, i) => {
      const bits = [
        it.dueDate ? (lang === "en" ? `Due: <b style="color:#334155">${fmtDate(it.dueDate)}</b>` : `Son tarih: <b style="color:#334155">${fmtDate(it.dueDate)}</b>`) : "",
        "Online",
        it.examRequired ? (lang === "en" ? "Includes an exam" : "Sınavlı") : "",
      ].filter(Boolean);
      return `<tr><td style="padding:14px 16px;${i ? "border-top:1px solid #e2e8f0;" : ""}"><div style="font-weight:600;font-size:15px;color:#0f172a">${esc(it.title)}</div><div style="font-size:13px;color:#64748b;margin-top:3px">${bits.join(" · ")}</div></td></tr>`;
    })
    .join("");
  const list = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px">${card}</table>`;

  if (lang === "en") {
    const subject = one ? `New training: ${p.items[0].title}` : `${p.items.length} new trainings assigned`;
    const html = shell(
      `<p style="margin:0 0 14px">Dear <b>${esc(p.name)}</b>,</p>
<p style="margin:0 0 16px">The following training ${one ? "has" : "have"} been assigned to you on Capella Academy:</p>
${list}
${button(p.link, "Start training")}
<p style="margin:0;font-size:13px;color:#64748b">You can stop at any time and continue where you left off.</p>`,
      lang
    );
    const text = `Dear ${p.name},\n\nThe following training has been assigned to you on Capella Academy:\n${p.items.map((it) => `- ${it.title}${it.dueDate ? ` (due ${fmtDate(it.dueDate)})` : ""}`).join("\n")}\n\nStart: ${p.link}\n\nCapella Aviation Solutions · ${REPLY_TO}`;
    return { subject, html, text };
  }
  const subject = one ? `Yeni eğitim: ${p.items[0].title}` : `${p.items.length} yeni eğitim atandı`;
  const html = shell(
    `<p style="margin:0 0 14px">Sayın <b>${esc(p.name)}</b>,</p>
<p style="margin:0 0 16px">Capella Academy'de size aşağıdaki ${one ? "eğitim" : "eğitimler"} atanmıştır:</p>
${list}
${button(p.link, "Eğitime başla")}
<p style="margin:0;font-size:13px;color:#64748b">Eğitimi istediğiniz zaman bırakıp kaldığınız yerden devam edebilirsiniz.</p>`,
    lang
  );
  const text = `Sayın ${p.name},\n\nCapella Academy'de size aşağıdaki eğitim atanmıştır:\n${p.items.map((it) => `- ${it.title}${it.dueDate ? ` (son tarih ${fmtDate(it.dueDate)})` : ""}`).join("\n")}\n\nBaşlamak için: ${p.link}\n\nCapella Aviation Solutions · ${REPLY_TO}`;
  return { subject, html, text };
}

/**
 * Hatırlatma: atanmış ama bitmemiş eğitim. Yönetici Assign Training'den elle
 * gönderir. Son tarih yaklaştı mı / geçti mi ve ne kadarının bittiği yazar.
 */
export function reminderMail(
  lang: MailLang,
  p: { name: string; title: string; dueDate: Date | null; done: number; total: number; started: boolean; link: string }
) {
  const now = Date.now();
  const days = p.dueDate ? Math.ceil((p.dueDate.getTime() - now) / 86_400_000) : null;
  const late = days !== null && days < 0;
  const dueTxt =
    p.dueDate === null
      ? ""
      : lang === "en"
      ? late
        ? `<b style="color:#b91c1c">Overdue since ${fmtDate(p.dueDate)}</b>`
        : `Due: <b style="color:#334155">${fmtDate(p.dueDate)}</b>${days !== null && days <= 14 ? ` (${days === 0 ? "today" : `${days} day${days === 1 ? "" : "s"} left`})` : ""}`
      : late
      ? `<b style="color:#b91c1c">Son tarih geçti (${fmtDate(p.dueDate)})</b>`
      : `Son tarih: <b style="color:#334155">${fmtDate(p.dueDate)}</b>${days !== null && days <= 14 ? ` (${days === 0 ? "bugün" : `${days} gün kaldı`})` : ""}`;
  const progTxt =
    p.total > 0
      ? lang === "en"
        ? `${p.done} of ${p.total} sections completed`
        : `${p.total} bölümden ${p.done} tamamlandı`
      : "";
  const card = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e2e8f0;border-radius:10px"><tr><td style="padding:14px 16px"><div style="font-weight:600;font-size:15px;color:#0f172a">${esc(p.title)}</div><div style="font-size:13px;color:#64748b;margin-top:3px">${[dueTxt, progTxt].filter(Boolean).join(" · ")}</div></td></tr></table>`;

  if (lang === "en") {
    const subject = late ? `Overdue training: ${p.title}` : `Reminder: ${p.title}`;
    const html = shell(
      `<p style="margin:0 0 14px">Dear <b>${esc(p.name)}</b>,</p>
<p style="margin:0 0 16px">This is a reminder that the following training assigned to you on Capella Academy has not been completed yet:</p>
${card}
${button(p.link, p.started ? "Continue training" : "Start training")}
${plainLink(p.link, "If the button does not work, copy this address into your browser:")}`,
      lang
    );
    const text = `Dear ${p.name},\n\nReminder: the training "${p.title}" assigned to you on Capella Academy has not been completed yet.${p.dueDate ? ` Due: ${fmtDate(p.dueDate)}.` : ""}\n\n${p.link}\n\nCapella Aviation Solutions · ${REPLY_TO}`;
    return { subject, html, text };
  }
  const subject = late ? `Son tarihi geçen eğitim: ${p.title}` : `Hatırlatma: ${p.title}`;
  const html = shell(
    `<p style="margin:0 0 14px">Sayın <b>${esc(p.name)}</b>,</p>
<p style="margin:0 0 16px">Capella Academy'de size atanan aşağıdaki eğitim henüz tamamlanmamıştır:</p>
${card}
${button(p.link, p.started ? "Eğitime devam et" : "Eğitime başla")}
${plainLink(p.link, "Buton çalışmazsa bu adresi tarayıcınıza yapıştırın:")}`,
    lang
  );
  const text = `Sayın ${p.name},\n\nHatırlatma: Capella Academy'de size atanan "${p.title}" eğitimi henüz tamamlanmamıştır.${p.dueDate ? ` Son tarih: ${fmtDate(p.dueDate)}.` : ""}\n\n${p.link}\n\nCapella Aviation Solutions · ${REPLY_TO}`;
  return { subject, html, text };
}

/**
 * Yönetici şifreyi sıfırladı (Users → Reset password): geçici şifre kişiye
 * gider. Kişi ilk girişte kendi şifresini belirlemek zorunda
 * (mustChangePassword), geçici şifre o anda geçersiz olur.
 */
export function tempPasswordMail(lang: MailLang, p: { name: string; email: string; password: string }) {
  const login = `${appUrl()}/login`;
  const pwBox = `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:6px 0 0"><tr><td style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:10px 16px;font-family:Menlo,Consolas,monospace;font-size:17px;letter-spacing:.04em;color:#0f172a">${esc(p.password)}</td></tr></table>`;
  if (lang === "en") {
    const subject = "Your temporary Capella Academy password";
    const html = shell(
      `<p style="margin:0 0 14px">Dear <b>${esc(p.name)}</b>,</p>
<p style="margin:0 0 14px">A temporary password has been set for your <b>Capella Academy</b> account.</p>
<p style="margin:0">Sign-in email: <b>${esc(p.email)}</b></p>
<p style="margin:12px 0 0">Temporary password:</p>
${pwBox}
${button(login, "Sign in")}
<p style="margin:0;font-size:13px;color:#64748b">When you sign in you will be asked to choose your own password; the temporary one stops working then. If you did not expect this email, please write to ${REPLY_TO}.</p>`,
      lang
    );
    const text = `Dear ${p.name},\n\nA temporary password has been set for your Capella Academy account.\nSign-in email: ${p.email}\nTemporary password: ${p.password}\n\nSign in: ${login}\nYou will be asked to choose your own password when you sign in.\n\nCapella Aviation Solutions · ${REPLY_TO}`;
    return { subject, html, text };
  }
  const subject = "Capella Academy geçici şifreniz";
  const html = shell(
    `<p style="margin:0 0 14px">Sayın <b>${esc(p.name)}</b>,</p>
<p style="margin:0 0 14px"><b>Capella Academy</b> hesabınız için geçici bir şifre oluşturulmuştur.</p>
<p style="margin:0">Giriş e-postanız: <b>${esc(p.email)}</b></p>
<p style="margin:12px 0 0">Geçici şifreniz:</p>
${pwBox}
${button(login, "Giriş yap")}
<p style="margin:0;font-size:13px;color:#64748b">Giriş yaptığınızda kendi şifrenizi belirlemeniz istenecektir; geçici şifre o anda geçersiz olur. Bu e-postayı beklemiyorsanız lütfen ${REPLY_TO} adresine yazınız.</p>`,
    lang
  );
  const text = `Sayın ${p.name},\n\nCapella Academy hesabınız için geçici bir şifre oluşturulmuştur.\nGiriş e-postanız: ${p.email}\nGeçici şifreniz: ${p.password}\n\nGiriş: ${login}\nGiriş yaptığınızda kendi şifrenizi belirlemeniz istenecektir.\n\nCapella Aviation Solutions · ${REPLY_TO}`;
  return { subject, html, text };
}
