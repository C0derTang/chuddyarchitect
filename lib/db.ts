import { neon } from "@neondatabase/serverless";
import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";
import type { Project, RenderJob } from "./types";

// Dual-mode data layer: Neon Postgres when DATABASE_URL is set (production),
// otherwise a JSON file under .data/ so local dev needs zero credentials.

const DATABASE_URL = process.env.DATABASE_URL || process.env.POSTGRES_URL;

// ---------- Postgres mode ----------

let schemaReady: Promise<void> | null = null;

function sql() {
  return neon(DATABASE_URL!);
}

function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = (async () => {
      const q = sql();
      await q`CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        video_url TEXT,
        splat_url TEXT,
        log_text TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
      await q`CREATE TABLE IF NOT EXISTS render_jobs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        camera_path_json TEXT NOT NULL,
        output_video_url TEXT,
        log_text TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`;
    })();
  }
  return schemaReady;
}

// ---------- Local JSON mode ----------

interface LocalDb {
  projects: Project[];
  render_jobs: RenderJob[];
}

const DATA_DIR = path.join(process.cwd(), ".data");
const DB_FILE = path.join(DATA_DIR, "db.json");

async function readLocal(): Promise<LocalDb> {
  try {
    const raw = await fs.readFile(DB_FILE, "utf8");
    return JSON.parse(raw) as LocalDb;
  } catch {
    return { projects: [], render_jobs: [] };
  }
}

async function writeLocal(db: LocalDb): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(DB_FILE, JSON.stringify(db, null, 2), "utf8");
}

// ---------- Public API ----------

export function newId(): string {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
}

export async function createProject(name: string, videoUrl: string | null): Promise<Project> {
  const project: Project = {
    id: newId(),
    name,
    status: videoUrl ? "queued" : "uploaded",
    video_url: videoUrl,
    splat_url: null,
    log_text: "",
    created_at: new Date().toISOString(),
  };
  if (DATABASE_URL) {
    await ensureSchema();
    await sql()`INSERT INTO projects (id, name, status, video_url, splat_url, log_text, created_at)
      VALUES (${project.id}, ${project.name}, ${project.status}, ${project.video_url}, ${project.splat_url}, ${project.log_text}, ${project.created_at})`;
  } else {
    const db = await readLocal();
    db.projects.unshift(project);
    await writeLocal(db);
  }
  return project;
}

export async function listProjects(): Promise<Project[]> {
  if (DATABASE_URL) {
    await ensureSchema();
    const rows = await sql()`SELECT * FROM projects ORDER BY created_at DESC`;
    return rows.map(rowToProject);
  }
  const db = await readLocal();
  return db.projects;
}

export async function getProject(id: string): Promise<Project | null> {
  if (DATABASE_URL) {
    await ensureSchema();
    const rows = await sql()`SELECT * FROM projects WHERE id = ${id}`;
    return rows.length ? rowToProject(rows[0]) : null;
  }
  const db = await readLocal();
  return db.projects.find((p) => p.id === id) ?? null;
}

export async function updateProject(
  id: string,
  patch: Partial<Pick<Project, "status" | "video_url" | "splat_url">> & { logAppend?: string }
): Promise<Project | null> {
  if (DATABASE_URL) {
    await ensureSchema();
    const q = sql();
    if (patch.status !== undefined) await q`UPDATE projects SET status = ${patch.status} WHERE id = ${id}`;
    if (patch.video_url !== undefined) await q`UPDATE projects SET video_url = ${patch.video_url} WHERE id = ${id}`;
    if (patch.splat_url !== undefined) await q`UPDATE projects SET splat_url = ${patch.splat_url} WHERE id = ${id}`;
    if (patch.logAppend) await q`UPDATE projects SET log_text = log_text || ${patch.logAppend + "\n"} WHERE id = ${id}`;
    return getProject(id);
  }
  const db = await readLocal();
  const p = db.projects.find((x) => x.id === id);
  if (!p) return null;
  if (patch.status !== undefined) p.status = patch.status;
  if (patch.video_url !== undefined) p.video_url = patch.video_url;
  if (patch.splat_url !== undefined) p.splat_url = patch.splat_url;
  if (patch.logAppend) p.log_text += patch.logAppend + "\n";
  await writeLocal(db);
  return p;
}

export async function deleteProject(id: string): Promise<void> {
  if (DATABASE_URL) {
    await ensureSchema();
    await sql()`DELETE FROM projects WHERE id = ${id}`;
    return;
  }
  const db = await readLocal();
  db.projects = db.projects.filter((p) => p.id !== id);
  db.render_jobs = db.render_jobs.filter((j) => j.project_id !== id);
  await writeLocal(db);
}

export async function createRenderJob(projectId: string, cameraPathJson: string): Promise<RenderJob> {
  const job: RenderJob = {
    id: newId(),
    project_id: projectId,
    status: "queued",
    camera_path_json: cameraPathJson,
    output_video_url: null,
    log_text: "",
    created_at: new Date().toISOString(),
  };
  if (DATABASE_URL) {
    await ensureSchema();
    await sql()`INSERT INTO render_jobs (id, project_id, status, camera_path_json, output_video_url, log_text, created_at)
      VALUES (${job.id}, ${job.project_id}, ${job.status}, ${job.camera_path_json}, ${job.output_video_url}, ${job.log_text}, ${job.created_at})`;
  } else {
    const db = await readLocal();
    db.render_jobs.unshift(job);
    await writeLocal(db);
  }
  return job;
}

export async function listRenderJobs(projectId: string): Promise<RenderJob[]> {
  if (DATABASE_URL) {
    await ensureSchema();
    const rows = await sql()`SELECT * FROM render_jobs WHERE project_id = ${projectId} ORDER BY created_at DESC`;
    return rows.map(rowToRenderJob);
  }
  const db = await readLocal();
  return db.render_jobs.filter((j) => j.project_id === projectId);
}

export async function updateRenderJob(
  id: string,
  patch: Partial<Pick<RenderJob, "status" | "output_video_url">> & { logAppend?: string }
): Promise<RenderJob | null> {
  if (DATABASE_URL) {
    await ensureSchema();
    const q = sql();
    if (patch.status !== undefined) await q`UPDATE render_jobs SET status = ${patch.status} WHERE id = ${id}`;
    if (patch.output_video_url !== undefined)
      await q`UPDATE render_jobs SET output_video_url = ${patch.output_video_url} WHERE id = ${id}`;
    if (patch.logAppend) await q`UPDATE render_jobs SET log_text = log_text || ${patch.logAppend + "\n"} WHERE id = ${id}`;
    const rows = await q`SELECT * FROM render_jobs WHERE id = ${id}`;
    return rows.length ? rowToRenderJob(rows[0]) : null;
  }
  const db = await readLocal();
  const j = db.render_jobs.find((x) => x.id === id);
  if (!j) return null;
  if (patch.status !== undefined) j.status = patch.status;
  if (patch.output_video_url !== undefined) j.output_video_url = patch.output_video_url;
  if (patch.logAppend) j.log_text += patch.logAppend + "\n";
  await writeLocal(db);
  return j;
}

// Atomically claim the next piece of work: a queued training project, or a
// queued render job on a ready project.
export async function claimNextJob(): Promise<
  | { type: "train"; project: Project }
  | { type: "render"; job: RenderJob; project: Project }
  | null
> {
  if (DATABASE_URL) {
    await ensureSchema();
    const q = sql();
    const trainRows = await q`UPDATE projects SET status = 'processing'
      WHERE id = (SELECT id FROM projects WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1)
      RETURNING *`;
    if (trainRows.length) return { type: "train", project: rowToProject(trainRows[0]) };
    const renderRows = await q`UPDATE render_jobs SET status = 'processing'
      WHERE id = (SELECT id FROM render_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1)
      RETURNING *`;
    if (renderRows.length) {
      const job = rowToRenderJob(renderRows[0]);
      const project = await getProject(job.project_id);
      if (project) return { type: "render", job, project };
    }
    return null;
  }
  const db = await readLocal();
  const project = [...db.projects].reverse().find((p) => p.status === "queued");
  if (project) {
    project.status = "processing";
    await writeLocal(db);
    return { type: "train", project };
  }
  const job = [...db.render_jobs].reverse().find((j) => j.status === "queued");
  if (job) {
    job.status = "processing";
    await writeLocal(db);
    const proj = db.projects.find((p) => p.id === job.project_id);
    if (proj) return { type: "render", job, project: proj };
  }
  return null;
}

// ---------- Row mappers ----------

/* eslint-disable @typescript-eslint/no-explicit-any */
function rowToProject(r: any): Project {
  return {
    id: r.id,
    name: r.name,
    status: r.status,
    video_url: r.video_url,
    splat_url: r.splat_url,
    log_text: r.log_text ?? "",
    created_at: new Date(r.created_at).toISOString(),
  };
}

function rowToRenderJob(r: any): RenderJob {
  return {
    id: r.id,
    project_id: r.project_id,
    status: r.status,
    camera_path_json: r.camera_path_json,
    output_video_url: r.output_video_url,
    log_text: r.log_text ?? "",
    created_at: new Date(r.created_at).toISOString(),
  };
}
