import { NextResponse } from "next/server";
import { BLOB_MODE } from "@/lib/storage";

export async function GET() {
  return NextResponse.json({ storage: BLOB_MODE ? "blob" : "local" });
}
