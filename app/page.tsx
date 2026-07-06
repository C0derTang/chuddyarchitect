import Link from "next/link";
import { listProjects } from "@/lib/db";
import UploadForm from "@/components/UploadForm";
import type { ProjectStatus } from "@/lib/types";

export const dynamic = "force-dynamic";

const STATUS_STYLES: Record<ProjectStatus, string> = {
  uploaded: "bg-zinc-500/20 text-zinc-300",
  queued: "bg-amber-500/20 text-amber-300",
  processing: "bg-blue-500/20 text-blue-300",
  ready: "bg-emerald-500/20 text-emerald-300",
  failed: "bg-red-500/20 text-red-300",
};

export default async function Home() {
  const projects = await listProjects();
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-6 py-12 text-zinc-100">
      <header className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight">Chuddy Architect</h1>
        <p className="mt-2 text-zinc-400">
          Walk through a house with your phone camera. Get a photorealistic 3D model.
          Fly a virtual drone through it.
        </p>
        <Link href="/demo" className="mt-3 inline-block text-sm text-blue-400 hover:underline">
          Try the demo scene (no video needed) →
        </Link>
      </header>

      <UploadForm />

      <section className="mt-12">
        <h2 className="mb-4 text-lg font-medium text-zinc-300">Projects</h2>
        {projects.length === 0 ? (
          <p className="text-sm text-zinc-500">No projects yet. Upload a walkthrough video above.</p>
        ) : (
          <ul className="divide-y divide-zinc-800 rounded-lg border border-zinc-800">
            {projects.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/p/${p.id}`}
                  className="flex items-center justify-between px-4 py-3 transition hover:bg-zinc-900"
                >
                  <div>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-zinc-500">
                      {new Date(p.created_at).toLocaleString()}
                    </div>
                  </div>
                  <span className={`rounded-full px-2.5 py-0.5 text-xs ${STATUS_STYLES[p.status]}`}>
                    {p.status}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
