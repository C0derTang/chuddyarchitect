import { NextRequest, NextResponse } from "next/server";
import { createRenderJob, getProject, listRenderJobs } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return NextResponse.json(await listRenderJobs(id));
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const project = await getProject(id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (project.status !== "ready")
    return NextResponse.json({ error: "project not ready" }, { status: 400 });
  const body = await req.json();
  if (!body.cameraPath) return NextResponse.json({ error: "cameraPath required" }, { status: 400 });
  const job = await createRenderJob(id, JSON.stringify(body.cameraPath));
  return NextResponse.json(job, { status: 201 });
}
