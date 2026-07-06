"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { upload } from "@vercel/blob/client";

export default function UploadForm() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) {
      setError("Choose a walkthrough video first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const cfg = await fetch("/api/config").then((r) => r.json());
      let videoUrl: string;
      if (cfg.storage === "blob") {
        setProgress("Uploading to storage…");
        const blob = await upload(file.name, file, {
          access: "public",
          handleUploadUrl: "/api/upload",
          onUploadProgress: ({ percentage }) => setProgress(`Uploading… ${Math.round(percentage)}%`),
        });
        videoUrl = blob.url;
      } else {
        setProgress("Uploading…");
        const res = await fetch(`/api/local-upload?filename=${encodeURIComponent(file.name)}`, {
          method: "PUT",
          body: file,
        });
        if (!res.ok) throw new Error(`upload failed: ${res.status}`);
        videoUrl = (await res.json()).url;
      }
      setProgress("Creating project…");
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name || file.name.replace(/\.[^.]+$/, ""), videoUrl }),
      });
      if (!res.ok) throw new Error(`project create failed: ${res.status}`);
      const project = await res.json();
      router.push(`/p/${project.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-5">
      <h2 className="mb-3 text-lg font-medium">New walkthrough</h2>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          type="text"
          placeholder="Project name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm outline-none focus:border-blue-500"
        />
        <input
          ref={fileRef}
          type="file"
          accept="video/*"
          className="flex-1 rounded-md border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-sm file:mr-3 file:rounded file:border-0 file:bg-zinc-700 file:px-3 file:py-1 file:text-sm file:text-zinc-100"
        />
        <button
          type="submit"
          disabled={busy}
          className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium transition hover:bg-blue-500 disabled:opacity-50"
        >
          {busy ? "Working…" : "Upload"}
        </button>
      </div>
      {progress && <p className="mt-3 text-sm text-blue-300">{progress}</p>}
      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      <p className="mt-3 text-xs text-zinc-500">
        Capture tips: move slowly, keep the phone landscape, good lighting, overlap your path,
        1–3 minutes. Avoid fast pans — motion blur breaks reconstruction.
      </p>
    </form>
  );
}
