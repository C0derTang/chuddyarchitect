import { NextRequest, NextResponse } from "next/server";
import { BLOB_MODE, guessContentType, putFile } from "@/lib/storage";

// Local-dev upload path: browser PUTs the raw file here and we write it to
// .data/blobs. Disabled in blob mode (production uses client uploads).
export async function PUT(req: NextRequest) {
  if (BLOB_MODE) return NextResponse.json({ error: "use blob client upload" }, { status: 400 });
  const filename = req.nextUrl.searchParams.get("filename") ?? "upload.bin";
  if (!req.body) return NextResponse.json({ error: "empty body" }, { status: 400 });
  const url = await putFile(`uploads/${Date.now()}-${filename}`, req.body, guessContentType(filename));
  return NextResponse.json({ url });
}
