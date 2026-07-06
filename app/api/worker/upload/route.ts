import { NextRequest, NextResponse } from "next/server";
import { checkWorkerAuth } from "@/lib/auth";
import { guessContentType, putFile } from "@/lib/storage";

// Worker result upload fallback. Fine for local dev; on Vercel, request
// bodies are capped at 4.5MB, so the worker uses the Blob token from /claim
// for real (large) results instead.
export async function PUT(req: NextRequest) {
  if (!checkWorkerAuth(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const filename = req.nextUrl.searchParams.get("filename") ?? "result.bin";
  if (!req.body) return NextResponse.json({ error: "empty body" }, { status: 400 });
  const url = await putFile(`results/${Date.now()}-${filename}`, req.body, guessContentType(filename));
  return NextResponse.json({ url });
}
