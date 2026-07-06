export type ProjectStatus =
  | "uploaded"
  | "queued"
  | "processing"
  | "ready"
  | "failed";

export type RenderJobStatus = "queued" | "processing" | "done" | "failed";

export interface Project {
  id: string;
  name: string;
  status: ProjectStatus;
  video_url: string | null;
  splat_url: string | null;
  log_text: string;
  created_at: string;
}

export interface RenderJob {
  id: string;
  project_id: string;
  status: RenderJobStatus;
  camera_path_json: string;
  output_video_url: string | null;
  log_text: string;
  created_at: string;
}

export type ClaimedJob =
  | { type: "train"; project: Project }
  | {
      type: "render";
      job: RenderJob;
      project: Project;
    }
  | null;
