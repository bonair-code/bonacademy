/**
 * Storage backend abstraction for SCORM package files.
 *
 * Priority:
 *   1. Vercel Blob (if BLOB_READ_WRITE_TOKEN is set) — used in production on Vercel.
 *   2. Azure Blob (if AZURE_STORAGE_CONNECTION_STRING is set) — legacy.
 *   3. Local filesystem at ./uploads/scorm — dev fallback.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { BlobServiceClient } from "@azure/storage-blob";
import { put as vercelPut, head as vercelHead, del as vercelDel } from "@vercel/blob";

const useVercel = !!process.env.BLOB_READ_WRITE_TOKEN;
const useAzure = !useVercel && !!process.env.AZURE_STORAGE_CONNECTION_STRING;
const LOCAL_ROOT = path.join(process.cwd(), "uploads", "scorm");
const CONTAINER = process.env.AZURE_STORAGE_CONTAINER || "scorm-packages";

export async function putFile(relPath: string, data: Buffer, contentType: string) {
  if (useVercel) {
    await vercelPut(relPath, data, {
      access: "public",
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    return;
  }
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

export async function getFile(
  relPath: string
): Promise<{ body: Buffer; contentType: string } | null> {
  if (useVercel) {
    try {
      const meta = await vercelHead(relPath, {
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      const res = await fetch(meta.downloadUrl);
      if (!res.ok) return null;
      const ab = await res.arrayBuffer();
      return {
        body: Buffer.from(ab),
        contentType: meta.contentType || contentTypeOf(relPath),
      };
    } catch {
      return null;
    }
  }
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
      return {
        body: Buffer.concat(chunks),
        contentType: dl.contentType || "application/octet-stream",
      };
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

/**
 * Delete every object under a package prefix. Used when a course's SCORM
 * package is replaced so we don't leak blob storage over time.
 */
export async function deletePackage(packagePath: string) {
  if (useVercel) {
    // Vercel Blob has no "delete by prefix" in a single call; we use list().
    const { list } = await import("@vercel/blob");
    let cursor: string | undefined;
    do {
      const page = await list({
        prefix: `${packagePath}/`,
        cursor,
        token: process.env.BLOB_READ_WRITE_TOKEN,
      });
      if (page.blobs.length) {
        await vercelDel(
          page.blobs.map((b) => b.url),
          { token: process.env.BLOB_READ_WRITE_TOKEN }
        );
      }
      cursor = page.cursor;
    } while (cursor);
    return;
  }
  if (useAzure) {
    const svc = BlobServiceClient.fromConnectionString(
      process.env.AZURE_STORAGE_CONNECTION_STRING!
    );
    const c = svc.getContainerClient(CONTAINER);
    for await (const blob of c.listBlobsFlat({ prefix: `${packagePath}/` })) {
      await c.deleteBlob(blob.name).catch(() => {});
    }
    return;
  }
  const full = path.join(LOCAL_ROOT, packagePath);
  await fs.rm(full, { recursive: true, force: true }).catch(() => {});
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
      ".woff": "font/woff",
      ".woff2": "font/woff2",
      ".ttf": "font/ttf",
      ".otf": "font/otf",
    } as Record<string, string>
  )[ext] || "application/octet-stream";
}

export function activeBackend(): "vercel-blob" | "azure-blob" | "local-fs" {
  if (useVercel) return "vercel-blob";
  if (useAzure) return "azure-blob";
  return "local-fs";
}
