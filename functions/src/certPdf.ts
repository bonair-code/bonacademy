/**
 * Sertifika PDF'i — sunucuda, e-postaya eklemek için.
 *
 * web/src/components/CertificateSheet.tsx'in birebir karşılığı: yatay A4,
 * lacivert çerçeve + altın ince çizgi ve köşe süsleri, soluk uçak filigranı,
 * ortada künye, altta numara/tarih ve doğrulama QR'ı, en altta form künyesi.
 * Ekrandaki ölçüler `cqw` (kabın genişliğinin %1'i) ile verildiği için
 * burada da aynı birim kullanılıyor: U = sayfa genişliği / 100. Tasarım
 * değişirse İKİ dosya birlikte güncellenmeli.
 *
 * Yazı tipleri (Inter, Source Serif 4 — OFL) ve görseller functions/assets
 * altında; sitenin kullandığı dosyaların aynısı.
 */
import path from "path";
import fs from "fs";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

export type CertData = {
  serialNo: string;
  userName: string;
  courseTitle: string;
  courseRevisionNo?: string | null;
  courseRevisionDate?: string | null; // YYYY-MM-DD
  birthPlace?: string | null;
  birthDate?: string | null; // YYYY-MM-DD
  durationHours?: number | null;
  trainingStartedAt?: Date | null;
  trainingCompletedAt?: Date | null;
  issuedAt?: Date | null;
  heldIn?: string | null;
  verifyUrl?: string | null;
};

/** web/src/lib/org.ts ile aynı. */
const ORG = {
  website: "www.capella.aero",
  issuedBy: "Capella Aviation",
  footer: { formNo: "CPL-TRN-FRM-002", revisionNo: "01", revisionDate: "15.08.2026" },
};

const GOLD = "#b08d45";
const NAVY = "#2b4685";
const NAVY_D = "#18284b";
const SLATE = { 300: "#cbd5e1", 500: "#64748b", 600: "#475569", 700: "#334155", 800: "#1e293b", 900: "#0f172a" };

const ASSETS = path.join(__dirname, "..", "assets");
let cache: { fonts: Record<string, Buffer>; logo: Buffer; watermark: Buffer } | null = null;
function assets() {
  if (cache) return cache;
  const f = (n: string) => fs.readFileSync(path.join(ASSETS, "fonts", n));
  cache = {
    fonts: {
      sans: f("Inter-Regular.ttf"),
      sansSemi: f("Inter-SemiBold.ttf"),
      sansBold: f("Inter-Bold.ttf"),
      serif: f("SourceSerif4-Regular.ttf"),
      serifSemi: f("SourceSerif4-SemiBold.ttf"),
      serifBold: f("SourceSerif4-Bold.ttf"),
    },
    logo: fs.readFileSync(path.join(ASSETS, "Logo.png")),
    watermark: fs.readFileSync(path.join(ASSETS, "cert-watermark.jpg")),
  };
  return cache;
}

/** Sitede toLocaleDateString("tr-TR") → GG.AA.YYYY, İstanbul saatine göre. */
const dmy = (d?: Date | null) =>
  d ? d.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
/** YYYY-MM-DD → GG.AA.YYYY */
const fmtISO = (d?: string | null) => {
  if (!d) return null;
  const [y, m, day] = d.split("-");
  return y && m && day ? `${day}.${m}.${y}` : d;
};

const titleCaseTr = (s: string) =>
  s
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toLocaleUpperCase("tr") + w.slice(1).toLocaleLowerCase("tr"))
    .join(" ");

/** "Ad Soyad - Eğitim adı - Tarih.pdf" — sitedeki "PDF olarak kaydet" adıyla aynı. */
export function certificateFileName(c: CertData) {
  return (
    [titleCaseTr(c.userName ?? ""), (c.courseTitle ?? "").trim(), c.issuedAt ? dmy(c.issuedAt) : ""]
      .filter(Boolean)
      .join(" - ")
      .replace(/[\\/:*?"<>|]+/g, " - ")
      .replace(/\s*-\s*(-\s*)+/g, " - ")
      .replace(/\s+/g, " ")
      .trim() + ".pdf"
  );
}

type Run = { text: string; font: string; size: number; color: string; spacing?: number };

export async function renderCertificatePdf(c: CertData): Promise<Buffer> {
  const A = assets();
  const doc = new PDFDocument({
    size: "A4",
    layout: "landscape",
    margin: 0,
    info: { Title: `Training Certificate ${c.serialNo}`, Author: "Capella Aviation Solutions" },
  });
  for (const [k, v] of Object.entries(A.fonts)) doc.registerFont(k, v);
  const chunks: Buffer[] = [];
  doc.on("data", (b: Buffer) => chunks.push(b));
  const done = new Promise<Buffer>((res, rej) => {
    doc.on("end", () => res(Buffer.concat(chunks)));
    doc.on("error", rej);
  });

  const W = doc.page.width;
  const H = doc.page.height;
  const U = W / 100;

  /* ── Çerçeve ─────────────────────────────────────────── */
  const pad = 1.4 * U;
  const navyW = 0.55 * U;
  // lacivert çerçeve (CSS kenarlığı kutunun İÇİNE çizilir → çizgi ortası yarım kalınlık içeride)
  doc.lineWidth(navyW).strokeColor(NAVY)
    .rect(pad + navyW / 2, pad + navyW / 2, W - 2 * pad - navyW, H - 2 * pad - navyW).stroke();
  const gx = pad + navyW + 0.45 * U;
  const gy = gx;
  const gw = W - 2 * gx;
  const gh = H - 2 * gy;
  const goldW = 0.1 * U;
  doc.lineWidth(goldW).strokeColor(GOLD).rect(gx + goldW / 2, gy + goldW / 2, gw - goldW, gh - goldW).stroke();
  // içerik kutusu (altın çizginin içi)
  const bx = gx + goldW;
  const by = gy + goldW;
  const bw = gw - 2 * goldW;
  const bh = gh - 2 * goldW;

  // köşe süsleri
  const cs = 3.2 * U;
  const ci = 0.8 * U;
  const cw = 0.25 * U;
  doc.lineWidth(cw).strokeColor(GOLD).lineCap("butt");
  const corner = (x: number, y: number, dx: number, dy: number) => {
    const o = cw / 2;
    doc.moveTo(x + dx * o, y + dy * cs).lineTo(x + dx * o, y + dy * o).lineTo(x + dx * cs, y + dy * o).stroke();
  };
  corner(bx + ci, by + ci, 1, 1);
  corner(bx + bw - ci, by + ci, -1, 1);
  corner(bx + ci, by + bh - ci, 1, -1);
  corner(bx + bw - ci, by + bh - ci, -1, -1);

  /* ── Filigran: ortada (%50, %52), 66U genişlik, en çok %66 yükseklik ── */
  {
    const fw = 66 * U;
    const fh = 0.66 * bh;
    // Sitedeki gibi multiply: JPEG'in kirli beyaz zemini kutu gibi görünmesin.
    // pdfkit karışım kipi sunmuyor; grafik durumu elle ekleniyor.
    doc.save();
    const gs = doc.ref({ Type: "ExtGState", ca: 0.1, CA: 0.1, BM: "Multiply" });
    gs.end(undefined as any);
    (doc.page as any).ext_gstates.GsWatermark = gs;
    doc.addContent("/GsWatermark gs");
    doc.image(A.watermark, bx + bw / 2 - fw / 2, by + bh * 0.52 - fh / 2, {
      fit: [fw, fh],
      align: "center",
      valign: "center",
    });
    doc.restore();
  }

  /* ── Metin yardımcıları ─────────────────────────────── */
  // Tailwind tabanı satır yüksekliğini 1.5 yapıyor; özel verilenler ayrıca.
  const runWidth = (r: Run) => {
    doc.font(r.font).fontSize(r.size);
    // CSS letter-spacing her harften SONRA eklenir (sondaki dahil)
    return doc.widthOfString(r.text) + (r.spacing ?? 0) * [...r.text].length;
  };
  /** Bir satırı (bir ya da birkaç parça) satır kutusunun içinde dikey ortalı çizer. */
  const drawLine = (runs: Run[], cx: number, top: number, lineH: number, align: "center" | "left" | "right" = "center") => {
    const total = runs.reduce((s, r) => s + runWidth(r), 0);
    let x = align === "center" ? cx - total / 2 : align === "left" ? cx : cx - total;
    for (const r of runs) {
      doc.font(r.font).fontSize(r.size).fillColor(r.color);
      const content = doc.currentLineHeight(false);
      doc.text(r.text, x, top + (lineH - content) / 2, {
        lineBreak: false,
        characterSpacing: r.spacing ?? 0,
      });
      x += runWidth(r);
    }
  };
  const wrap = (r: Run, maxW: number) => {
    const words = r.text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let cur = "";
    for (const w of words) {
      const t = cur ? `${cur} ${w}` : w;
      if (cur && runWidth({ ...r, text: t }) > maxW) {
        lines.push(cur);
        cur = w;
      } else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
  };

  /* ── Gövde blokları (yukarıdan aşağı) ───────────────── */
  const birth = [c.birthPlace, fmtISO(c.birthDate)].filter(Boolean).join(" & ");
  const start = dmy(c.trainingStartedAt);
  const end = dmy(c.trainingCompletedAt);
  const heldRange = start !== "—" && end !== "—" && start !== end ? `${start} - ${end}` : end !== "—" ? end : null;
  const location = (c.heldIn ?? "").trim();
  const placeText = !location ? null : location.toUpperCase() === "ONLINE" ? "online" : `in ${location}`;
  const heldText = heldRange
    ? placeText
      ? `On ${heldRange} held ${placeText}`
      : `On ${heldRange}`
    : placeText
    ? `Delivered ${placeText}`
    : null;

  type Block = { h: number; mt: number; draw: (top: number) => void };
  const cx = bx + bw / 2;
  const bodyW = bw - 12 * U; // yatay iç boşluk 6U + 6U
  const blocks: Block[] = [];
  const textBlock = (runs: Run[], mt: number, lh = 1.5) => {
    const h = Math.max(...runs.map((r) => r.size)) * lh;
    blocks.push({ h, mt, draw: (top) => drawLine(runs, cx, top, h) });
  };

  // logo
  {
    const lh = 5.4 * U;
    const img = (doc as any).openImage(A.logo);
    const lw = (img.width / img.height) * lh;
    blocks.push({ h: lh, mt: 0, draw: (top) => doc.image(A.logo, cx - lw / 2, top, { height: lh }) });
  }
  textBlock([{ text: ORG.website, font: "sans", size: 1.05 * U, color: SLATE[500], spacing: 0.12 * 1.05 * U }], 0.4 * U);
  textBlock([{ text: "Training Certificate", font: "serif", size: 4.2 * U, color: NAVY_D }], 0.9 * U, 1.05);
  // ince altın çizgi + yıldız
  {
    const size = 1.2 * U;
    const h = size * 1.5;
    blocks.push({
      h,
      mt: 0.6 * U,
      draw: (top) => {
        const w = 24 * U;
        const gap = 1 * U;
        doc.font("sans").fontSize(size);
        const sw = doc.widthOfString("★");
        const lineW = (w - sw - 2 * gap) / 2;
        const y = top + h / 2;
        doc.rect(cx - w / 2, y - 0.05 * U, lineW, 0.1 * U).fill(GOLD);
        doc.rect(cx + w / 2 - lineW, y - 0.05 * U, lineW, 0.1 * U).fill(GOLD);
        drawLine([{ text: "★", font: "sans", size, color: GOLD }], cx, top, h);
      },
    });
  }
  const mbAfterRule = 0.5 * U;
  textBlock([{ text: "This is to certify that", font: "sans", size: 1.4 * U, color: SLATE[600] }], mbAfterRule);
  textBlock(
    [{ text: c.userName.toLocaleUpperCase("tr"), font: "serifBold", size: 3 * U, color: NAVY_D, spacing: 0.05 * 3 * U }],
    0.3 * U
  );
  if (birth) {
    textBlock([{ text: "PLACE & DATE OF BIRTH", font: "sansSemi", size: 1 * U, color: SLATE[500], spacing: 0.08 * U }], 0.5 * U);
    textBlock([{ text: birth, font: "sans", size: 1.3 * U, color: SLATE[700] }], 0);
  }
  textBlock([{ text: "has successfully completed", font: "sans", size: 1.4 * U, color: SLATE[600] }], 0.8 * U);
  {
    const r: Run = { text: c.courseTitle, font: "serifSemi", size: 2.4 * U, color: SLATE[900] };
    const lines = wrap(r, bodyW * 0.88);
    const lh = r.size * 1.2;
    blocks.push({
      h: lh * lines.length,
      mt: 0.6 * U,
      draw: (top) => lines.forEach((t, i) => drawLine([{ ...r, text: t }], cx, top + i * lh, lh)),
    });
  }
  if (c.courseRevisionNo) {
    const rd = c.courseRevisionDate ? ` · ${c.courseRevisionDate.split("-").reverse().join(".")}` : "";
    textBlock(
      [{ text: `Training Revision ${c.courseRevisionNo}${rd}`, font: "sans", size: 1.1 * U, color: SLATE[500] }],
      0.3 * U
    );
  }
  const dur = [c.durationHours != null ? `Duration: ${c.durationHours} Hours` : null, heldText].filter(Boolean).join(" · ");
  if (dur) textBlock([{ text: dur, font: "sans", size: 1.3 * U, color: SLATE[700] }], 0.8 * U);
  textBlock([{ text: `By ${ORG.issuedBy}`, font: "sans", size: 1.3 * U, color: SLATE[700] }], 0);

  /* ── Alt kısım: form künyesi (en alt) ve üstünde numara + QR şeridi ── */
  const footSize = 0.95 * U;
  const footH = footSize * 1.5 + 2 * 0.5 * U;
  const footTop = by + bh - footH;
  doc.rect(bx, footTop, bw, 0.75).fill(SLATE[300]);
  {
    const fy = footTop + 0.5 * U;
    const lh = footSize * 1.5;
    const run = (text: string): Run => ({ text, font: "sans", size: footSize, color: SLATE[500] });
    const left = bx + 5.5 * U;
    const right = bx + bw - 5.5 * U;
    drawLine([run(`Form No: ${ORG.footer.formNo}`)], left, fy, lh, "left");
    // justify-between: ortadaki parça kalan boşluğun ortasında
    const a = runWidth(run(`Form No: ${ORG.footer.formNo}`));
    const b = runWidth(run(`Revision No: ${ORG.footer.revisionNo}`));
    const cW = runWidth(run(`Revision Date: ${ORG.footer.revisionDate}`));
    const gapEach = (right - left - a - b - cW) / 2;
    drawLine([run(`Revision No: ${ORG.footer.revisionNo}`)], left + a + gapEach, fy, lh, "left");
    drawLine([run(`Revision Date: ${ORG.footer.revisionDate}`)], right, fy, lh, "right");
  }

  // şerit: padding 0 5U 1U; sağ sütun %26 genişlik (QR 6.6U + "Scan to verify")
  const stripBottom = footTop - 1 * U;
  const qrSize = 6.6 * U;
  const scanSize = 0.9 * U;
  const scanH = scanSize * 1.25;
  const qrColH = qrSize + 0.3 * U + scanH;
  const infoSize = 1.35 * U;
  const infoLH = infoSize * 1.55;
  const stripH = Math.max(qrColH, infoLH * 2);
  const stripTop = stripBottom - stripH;
  {
    const innerL = bx + 5 * U;
    const innerW = bw - 10 * U;
    const gap = 2 * U;
    const sideW = innerW * 0.26; // sol boş sütun ve sağ QR sütunu %26
    const midL = innerL + sideW + gap;
    const midW = innerW - 2 * sideW - 2 * gap;
    const infoTop = stripBottom - infoLH * 2; // items-end
    const lbl = (t: string): Run => ({ text: t, font: "sans", size: infoSize, color: SLATE[800] });
    const val = (t: string): Run => ({ text: t, font: "sansBold", size: infoSize, color: SLATE[800] });
    drawLine([lbl("Certificate No: "), val(c.serialNo)], midL + midW / 2, infoTop, infoLH);
    drawLine([lbl("Certificate Date: "), val(dmy(c.issuedAt))], midL + midW / 2, infoTop + infoLH, infoLH);

    const qcx = innerL + innerW - sideW / 2;
    const qTop = stripBottom - qrColH;
    if (c.verifyUrl) {
      const qr = QRCode.create(c.verifyUrl, { errorCorrectionLevel: "M" });
      const n = qr.modules.size;
      const m = qrSize / n;
      const x0 = qcx - qrSize / 2;
      doc.fillColor(NAVY_D);
      for (let y = 0; y < n; y++) {
        let x = 0;
        while (x < n) {
          if (!qr.modules.get(y, x)) {
            x++;
            continue;
          }
          let run = 1;
          while (x + run < n && qr.modules.get(y, x + run)) run++;
          // komşu kareler arasında ince beyaz çizgi kalmasın diye çok az taşırılır
          doc.rect(x0 + x * m, qTop + y * m, run * m + 0.05, m + 0.05);
          x += run;
        }
      }
      doc.fill(NAVY_D);
    }
    drawLine([{ text: "Scan to verify", font: "sans", size: scanSize, color: SLATE[500] }], qcx, qTop + qrSize + 0.3 * U, scanH);
  }

  /* ── Gövdeyi kalan alanda dikey ortala ──────────────── */
  {
    const areaTop = by + 1.4 * U;
    const areaBottom = stripTop;
    const total = blocks.reduce((s, b) => s + b.mt + b.h, 0);
    let y = areaTop + Math.max(0, (areaBottom - areaTop - total) / 2);
    for (const b of blocks) {
      y += b.mt;
      b.draw(y);
      y += b.h;
    }
  }

  doc.end();
  return done;
}
