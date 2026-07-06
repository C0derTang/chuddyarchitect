import { put } from "@vercel/blob";
import { promises as fs } from "fs";
import path from "path";

// Dual-mode file storage: Vercel Blob when BLOB_READ_WRITE_TOKEN is set,
// otherwise files under .data/blobs served by /api/blob/[...path].

export const BLOB_MODE = Boolean(process.env.BLOB_READ_WRITE_TOKEN);

const BLOB_DIR = path.join(process.cwd(), ".data", "blobs");

export async function putFile(
  pathname: string,
  body: ReadableStream | ArrayBuffer | Buffer,
  contentType: string
): Promise<string> {
  if (BLOB_MODE) {
    const blob = await put(pathname, body as ReadableStream, {
      access: "public",
      contentType,
      addRandomSuffix: true,
    });
    return blob.url;
  }
  const safe = pathname.replace(/[^a-zA-Z0-9._/-]/g, "_");
  const filePath = path.join(BLOB_DIR, safe);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  let buf: Buffer;
  if (body instanceof Buffer) buf = body;
  else if (body instanceof ArrayBuffer) buf = Buffer.from(body);
  else buf = Buffer.from(await new Response(body as ReadableStream).arrayBuffer());
  await fs.writeFile(filePath, buf);
  return `/api/blob/${safe}`;
}

export async function readLocalBlob(parts: string[]): Promise<{ buf: Buffer; contentType: string } | null> {
  const safe = parts.join("/").replace(/\.\./g, "");
  const filePath = path.join(BLOB_DIR, safe);
  try {
    const buf = await fs.readFile(filePath);
    return { buf, contentType: guessContentType(safe) };
  } catch {
    return null;
  }
}

export function guessContentType(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "mp4":
      return "video/mp4";
    case "webm":
      return "video/webm";
    case "mov":
      return "video/quicktime";
    case "ply":
    case "splat":
    case "ksplat":
      return "application/octet-stream";
    case "json":
      return "application/json";
    default:
      return "application/octet-stream";
  }
}
