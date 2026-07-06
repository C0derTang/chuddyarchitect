import { NextRequest, NextResponse } from "next/server";
import { checkWorkerAuth } from "@/lib/auth";
import { updateProject, updateRenderJob } from "@/lib/db";

// Worker marks a job finished after uploading its result file.
// Body: { type: "train", id, splatUrl } or { type: "render", id, videoUrl }
export async function POST(req: NextRequest) {
  if (!checkWorkerAuth(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();
  if (body.type === "train") {
    const p = await updateProject(body.id, { status: "ready", splat_url: body.splatUrl });
    if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(p);
  }
  if (body.type === "render") {
    const j = await updateRenderJob(body.id, { status: "done", output_video_url: body.videoUrl });
    if (!j) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(j);
  }
  return NextResponse.json({ error: "bad type" }, { status: 400 });
}
