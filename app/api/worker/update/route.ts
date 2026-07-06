import { NextRequest, NextResponse } from "next/server";
import { checkWorkerAuth } from "@/lib/auth";
import { updateProject, updateRenderJob } from "@/lib/db";

// Worker status/log updates.
// Body: { type: "train"|"render", id, status?, logAppend? }
export async function POST(req: NextRequest) {
  if (!checkWorkerAuth(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json();
  const { type, id, status, logAppend } = body;
  if (type === "train") {
    const p = await updateProject(id, { status, logAppend });
    if (!p) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(p);
  }
  if (type === "render") {
    const j = await updateRenderJob(id, { status, logAppend });
    if (!j) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json(j);
  }
  return NextResponse.json({ error: "bad type" }, { status: 400 });
}
