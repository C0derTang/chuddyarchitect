"use client";

import Link from "next/link";
import dynamic from "next/dynamic";

const SplatViewer = dynamic(() => import("@/components/SplatViewer"), { ssr: false });

export default function DemoPage() {
  return (
    <div className="flex h-screen flex-col">
      <div className="flex items-center gap-4 border-b border-zinc-800 px-4 py-2 text-sm">
        <Link href="/" className="text-blue-400 hover:underline">
          ← Projects
        </Link>
        <span className="text-zinc-400">
          Demo scene — synthetic room splat. Use it to try the drone-path editor.
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <SplatViewer splatUrl="/demo.ply" />
      </div>
    </div>
  );
}
