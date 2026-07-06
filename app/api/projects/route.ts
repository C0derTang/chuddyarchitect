import { NextRequest, NextResponse } from "next/server";
import { createProject, listProjects } from "@/lib/db";

export async function GET() {
  return NextResponse.json(await listProjects());
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Untitled";
  const videoUrl = typeof body.videoUrl === "string" ? body.videoUrl : null;
  const project = await createProject(name, videoUrl);
  return NextResponse.json(project, { status: 201 });
}
