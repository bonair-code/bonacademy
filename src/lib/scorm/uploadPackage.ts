import { randomUUID } from "node:crypto";
import path from "node:path";
import unzipper from "unzipper";
import { XMLParser } from "fast-xml-parser";
import { ScormVersion } from "@prisma/client";
import { putFile, contentTypeOf } from "./storage";

export type ScormUploadResult = {
  packagePath: string;
  entryPoint: string;
  version: ScormVersion;
};

// ZIP bombası koruması: tek tek dosyalar veya toplam açılmış paket aşırı
// büyük olamaz; çok fazla entry içeren paketler de reddedilir. Bu sınırlar
// makul SCORM paketleri için bolca yer bırakır.
const MAX_ENTRY_BYTES = 200 * 1024 * 1024; // tek dosya 200MB
const MAX_TOTAL_UNCOMPRESSED_BYTES = 1024 * 1024 * 1024; // toplam 1GB
const MAX_ENTRIES = 5000;

export async function uploadScormZip(zipBuffer: Buffer): Promise<ScormUploadResult> {
  const packageId = randomUUID();
  const directory = await unzipper.Open.buffer(zipBuffer);

  // Entry sayısı ve beyan edilen toplam boyut erkenden reddedilsin.
  if (directory.files.length > MAX_ENTRIES) {
    throw new Error(
      `Zip çok fazla dosya içeriyor (${directory.files.length} > ${MAX_ENTRIES})`
    );
  }
  let totalDeclared = 0;
  for (const f of directory.files) {
    const size = Number(f.uncompressedSize ?? 0);
    if (size > MAX_ENTRY_BYTES) {
      throw new Error(
        `Paket içindeki bir dosya çok büyük: ${f.path} (${size} bayt)`
      );
    }
    totalDeclared += size;
  }
  if (totalDeclared > MAX_TOTAL_UNCOMPRESSED_BYTES) {
    throw new Error(
      `Açılmış toplam boyut çok yüksek (${totalDeclared} > ${MAX_TOTAL_UNCOMPRESSED_BYTES})`
    );
  }

  let manifestXml: string | null = null;
  for (const file of directory.files) {
    if (file.path.toLowerCase().endsWith("imsmanifest.xml")) {
      manifestXml = (await file.buffer()).toString("utf8");
      break;
    }
  }
  if (!manifestXml) throw new Error("imsmanifest.xml bulunamadı — geçersiz SCORM paketi");
  const { entryPoint, version } = parseManifest(manifestXml);

  // Beyan edilen boyutlar güvenilmez olabilir — açarken de canlı sayaç tut.
  let totalActual = 0;
  for (const file of directory.files) {
    if (file.type !== "File") continue;
    const safe = path.posix.normalize(file.path).replace(/^([/\\])+/, "");
    if (safe.startsWith("..") || safe.includes("\0")) {
      throw new Error("Zip-slip veya geçersiz yol tespit edildi");
    }
    const buf = await file.buffer();
    if (buf.length > MAX_ENTRY_BYTES) {
      throw new Error(
        `Paket içindeki dosya çok büyük (açıldığında): ${safe}`
      );
    }
    totalActual += buf.length;
    if (totalActual > MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new Error(
        "Açılmış toplam boyut limiti aşıldı (olası ZIP bombası)"
      );
    }
    await putFile(`${packageId}/${safe}`, buf, contentTypeOf(safe));
  }

  return { packagePath: packageId, entryPoint, version };
}

function parseManifest(xml: string): { entryPoint: string; version: ScormVersion } {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });
  const m = parser.parse(xml);
  const schemaVersion =
    m?.manifest?.metadata?.schemaversion ||
    m?.manifest?.metadata?.["imsmd:schemaversion"] ||
    "";
  const version: ScormVersion = String(schemaVersion).includes("2004")
    ? "SCORM_2004"
    : "SCORM_12";
  const resources = m?.manifest?.resources?.resource;
  const first = Array.isArray(resources) ? resources[0] : resources;
  const entryPoint = first?.["@_href"] || "index.html";
  return { entryPoint, version };
}
