import { NextRequest, NextResponse } from "next/server";
import { checkWorkerAuth } from "@/lib/auth";
import { claimNextJob } from "@/lib/db";
import { BLOB_MODE } from "@/lib/storage";

// Worker polls this to grab the next queued job. Returns the job payload plus
// how the worker should upload results:
//  - "blob": direct to Vercel Blob REST API using the token we hand back
//  - "api":  POST to /api/worker/upload (local dev only; small files)
export async function POST(req: NextRequest) {
  if (!checkWorkerAuth(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const claimed = await claimNextJob();
  if (!claimed) return NextResponse.json({ job: null });
  const upload = BLOB_MODE
    ? { mode: "blob", token: process.env.BLOB_READ_WRITE_TOKEN }
    : { mode: "api" };
  return NextResponse.json({ job: claimed, upload });
}
