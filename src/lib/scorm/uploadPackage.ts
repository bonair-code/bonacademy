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

export async function uploadScormZip(zipBuffer: Buffer): Promise<ScormUploadResult> {
  const packageId = randomUUID();
  const directory = await unzipper.Open.buffer(zipBuffer);

  let manifestXml: string | null = null;
  for (const file of directory.files) {
    if (file.path.toLowerCase().endsWith("imsmanifest.xml")) {
      manifestXml = (await file.buffer()).toString("utf8");
      break;
    }
  }
  if (!manifestXml) throw new Error("imsmanifest.xml bulunamadı — geçersiz SCORM paketi");
  const { entryPoint, version } = parseManifest(manifestXml);

  for (const file of directory.files) {
    if (file.type !== "File") continue;
    const safe = path.posix.normalize(file.path).replace(/^([/\\])+/, "");
    if (safe.startsWith("..")) throw new Error("Zip-slip tespit edildi");
    const buf = await file.buffer();
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
