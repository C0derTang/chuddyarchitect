import { NextRequest, NextResponse } from "next/server";
import { readLocalBlob } from "@/lib/storage";

// Serves files stored under .data/blobs in local-dev mode.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await params;
  const file = await readLocalBlob(parts);
  if (!file) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(file.buf), {
    headers: {
      "content-type": file.contentType,
      "content-length": String(file.buf.length),
      "cache-control": "public, max-age=3600",
    },
  });
}
