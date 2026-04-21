/**
 * Storage backend abstraction. Uses Azure Blob if AZURE_STORAGE_CONNECTION_STRING is set,
 * otherwise falls back to local filesystem at ./uploads/scorm.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { BlobServiceClient } from "@azure/storage-blob";

const useAzure = !!process.env.AZURE_STORAGE_CONNECTION_STRING;
const LOCAL_ROOT = path.join(process.cwd(), "uploads", "scorm");
const CONTAINER = process.env.AZURE_STORAGE_CONTAINER || "scorm-packages";

export async function putFile(relPath: string, data: Buffer, contentType: string) {
  if (useAzure) {
    const svc = BlobServiceClient.fromConnectionString(
      process.env.AZURE_STORAGE_CONNECTION_STRING!
    );
    const c = svc.getContainerClient(CONTAINER);
    await c.createIfNotExists();
    await c.getBlockBlobClient(relPath).uploadData(data, {
      blobHTTPHeaders: { blobContentType: contentType },
    });
    return;
  }
  const full = path.join(LOCAL_ROOT, relPath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, data);
}

export async function getFile(relPath: string): Promise<{ body: Buffer; contentType: string } | null> {
  if (useAzure) {
    try {
      const svc = BlobServiceClient.fromConnectionString(
        process.env.AZURE_STORAGE_CONNECTION_STRING!
      );
      const c = svc.getContainerClient(CONTAINER);
      const blob = c.getBlockBlobClient(relPath);
      const dl = await blob.download();
      const chunks: Buffer[] = [];
      for await (const chunk of dl.readableStreamBody as AsyncIterable<Buffer>) chunks.push(chunk);
      return { body: Buffer.concat(chunks), contentType: dl.contentType || "application/octet-stream" };
    } catch {
      return null;
    }
  }
  try {
    const full = path.join(LOCAL_ROOT, relPath);
    const buf = await fs.readFile(full);
    return { body: buf, contentType: contentTypeOf(relPath) };
  } catch {
    return null;
  }
}

export function contentTypeOf(p: string) {
  const ext = path.extname(p).toLowerCase();
  return (
    {
      ".html": "text/html",
      ".htm": "text/html",
      ".js": "application/javascript",
      ".css": "text/css",
      ".json": "application/json",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".svg": "image/svg+xml",
      ".mp4": "video/mp4",
      ".mp3": "audio/mpeg",
      ".xml": "application/xml",
    } as Record<string, string>
  )[ext] || "application/octet-stream";
}
