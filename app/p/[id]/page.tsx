"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { Project, RenderJob } from "@/lib/types";

const SplatViewer = dynamic(() => import("@/components/SplatViewer"), { ssr: false });

export default function ProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [project, setProject] = useState<Project | null>(null);
  const [renderJobs, setRenderJobs] = useState<RenderJob[]>([]);
  const [notFound, setNotFound] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/projects/${id}`, { cache: "no-store" });
    if (res.status === 404) {
      setNotFound(true);
      return;
    }
    const p: Project = await res.json();
    setProject(p);
    if (p.status === "ready") {
      const jobs = await fetch(`/api/projects/${id}/render`, { cache: "no-store" }).then((r) => r.json());
      setRenderJobs(jobs);
    }
  }, [id]);

  useEffect(() => {
    const initial = setTimeout(refresh, 0);
    const interval = setInterval(refresh, 5000);
    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [refresh]);

  if (notFound)
    return (
      <Shell>
        <p className="text-zinc-400">Project not found.</p>
      </Shell>
    );
  if (!project)
    return (
      <Shell>
        <p className="text-zinc-400">Loading…</p>
      </Shell>
    );

  if (project.status === "ready" && project.splat_url) {
    return (
      <div className="flex h-screen flex-col">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2 text-sm">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-blue-400 hover:underline">
              ← Projects
            </Link>
            <span className="font-medium">{project.name}</span>
          </div>
          <RenderJobsInline jobs={renderJobs} />
        </div>
        <div className="min-h-0 flex-1">
          <SplatViewer splatUrl={project.splat_url} projectId={project.id} />
        </div>
      </div>
    );
  }

  return (
    <Shell>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">{project.name}</h1>
        <StatusBadge status={project.status} />
      </div>
      {project.status === "queued" && (
        <p className="mb-4 text-zinc-400">
          Video uploaded and queued. Start the worker on FarmShare to process it:
          <code className="mt-2 block rounded bg-zinc-900 p-3 text-sm text-zinc-300">
            ssh rice.stanford.edu{"\n"}cd ~/chuddyarchitect-worker && sbatch train.sbatch
          </code>
        </p>
      )}
      {project.status === "processing" && (
        <p className="mb-4 text-zinc-400">Reconstruction running on FarmShare — this takes 30–60 minutes.</p>
      )}
      {project.status === "failed" && (
        <p className="mb-4 text-red-400">Processing failed. Check the log below and worker output on FarmShare.</p>
      )}
      {project.log_text && (
        <pre className="max-h-96 overflow-auto rounded bg-zinc-900 p-4 text-xs text-zinc-400">
          {project.log_text}
        </pre>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12 text-zinc-100">
      <Link href="/" className="mb-6 inline-block text-sm text-blue-400 hover:underline">
        ← Projects
      </Link>
      {children}
    </main>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="rounded-full bg-zinc-800 px-3 py-1 text-sm capitalize text-zinc-300">{status}</span>
  );
}

function RenderJobsInline({ jobs }: { jobs: RenderJob[] }) {
  if (!jobs.length) return null;
  return (
    <div className="flex items-center gap-3 text-xs">
      {jobs.slice(0, 3).map((j) =>
        j.status === "done" && j.output_video_url ? (
          <a
            key={j.id}
            href={j.output_video_url}
            download
            className="rounded bg-emerald-600/20 px-2 py-1 text-emerald-300 hover:bg-emerald-600/30"
          >
            ⬇ MP4 {new Date(j.created_at).toLocaleTimeString()}
          </a>
        ) : (
          <span key={j.id} className="rounded bg-zinc-800 px-2 py-1 text-zinc-400">
            render: {j.status}
          </span>
        )
      )}
    </div>
  );
}
