"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as THREE from "three";

interface Keyframe {
  position: [number, number, number];
  quaternion: [number, number, number, number]; // x y z w
  fov: number;
}

interface Props {
  splatUrl: string;
  projectId?: string; // enables the server-side "Render on FarmShare" button
}

// Minimal structural typings for @mkkellogg/gaussian-splats-3d (no bundled types).
interface GsViewer {
  camera: THREE.PerspectiveCamera;
  controls: { enabled: boolean; target: THREE.Vector3; update: () => void };
  renderer: THREE.WebGLRenderer;
  addSplatScene: (url: string, opts: Record<string, unknown>) => Promise<void>;
  start: () => void;
  dispose: () => Promise<void>;
}

export default function SplatViewer({ splatUrl, projectId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<GsViewer | null>(null);
  const playbackRef = useRef<{ raf: number; cancel: () => void } | null>(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [keyframes, setKeyframes] = useState<Keyframe[]>([]);
  const [duration, setDuration] = useState(10);
  const [playing, setPlaying] = useState(false);
  const [recording, setRecording] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // ---------- viewer lifecycle ----------

  useEffect(() => {
    let disposed = false;
    let viewer: GsViewer | null = null;
    (async () => {
      const GS = await import("@mkkellogg/gaussian-splats-3d");
      if (disposed || !containerRef.current) return;
      viewer = new GS.Viewer({
        rootElement: containerRef.current,
        sharedMemoryForWorkers: false,
        cameraUp: [0, 1, 0],
        initialCameraPosition: [0.8, 1.7, 2.6],
        initialCameraLookAt: [-0.5, 0.9, -1.5],
        selfDrivenMode: true,
      }) as unknown as GsViewer;
      viewerRef.current = viewer;
      try {
        await viewer.addSplatScene(splatUrl, {
          showLoadingUI: true,
          progressiveLoad: false,
        });
        if (disposed) return;
        viewer.start();
        setLoading(false);
      } catch (err) {
        if (!disposed) setLoadError((err as Error).message ?? String(err));
      }
    })();
    return () => {
      disposed = true;
      playbackRef.current?.cancel();
      const v = viewer;
      viewerRef.current = null;
      if (v) v.dispose().catch(() => {});
    };
  }, [splatUrl]);

  // ---------- keyframes ----------

  const addKeyframe = useCallback(() => {
    const v = viewerRef.current;
    if (!v) return;
    const kf: Keyframe = {
      position: v.camera.position.toArray() as [number, number, number],
      quaternion: [v.camera.quaternion.x, v.camera.quaternion.y, v.camera.quaternion.z, v.camera.quaternion.w],
      fov: v.camera.fov,
    };
    setKeyframes((ks) => [...ks, kf]);
  }, []);

  const removeKeyframe = useCallback((i: number) => {
    setKeyframes((ks) => ks.filter((_, j) => j !== i));
  }, []);

  const goToKeyframe = useCallback((i: number) => {
    const v = viewerRef.current;
    if (!v) return;
    setKeyframes((ks) => {
      const kf = ks[i];
      if (kf) {
        v.camera.position.fromArray(kf.position);
        v.camera.quaternion.fromArray(kf.quaternion);
        syncControlsToCamera(v);
      }
      return ks;
    });
  }, []);

  // Sample the camera pose along the path at t in [0,1]:
  // Catmull-Rom for position, per-segment slerp for orientation.
  const samplePath = useCallback(
    (ks: Keyframe[], t: number, out: { pos: THREE.Vector3; quat: THREE.Quaternion }) => {
      t = Math.min(Math.max(t, 0), 1 - 1e-7);
      if (ks.length === 2) {
        out.pos.fromArray(ks[0].position).lerp(new THREE.Vector3(...ks[1].position), t);
      } else {
        const curve = new THREE.CatmullRomCurve3(
          ks.map((k) => new THREE.Vector3(...k.position)),
          false,
          "centripetal"
        );
        curve.getPoint(t, out.pos);
      }
      const segs = ks.length - 1;
      const f = Math.min(t * segs, segs - 1e-6);
      const i = Math.floor(f);
      const local = f - i;
      const qa = new THREE.Quaternion().fromArray(ks[i].quaternion);
      const qb = new THREE.Quaternion().fromArray(ks[i + 1].quaternion);
      out.quat.slerpQuaternions(qa, qb, local);
    },
    []
  );

  // ---------- playback / recording ----------

  const stopPlayback = useCallback(() => {
    playbackRef.current?.cancel();
    playbackRef.current = null;
    setPlaying(false);
  }, []);

  const playPath = useCallback(
    (ks: Keyframe[], seconds: number, onDone?: () => void) => {
      const v = viewerRef.current;
      if (!v || ks.length < 2) return;
      stopPlayback();
      v.controls.enabled = false;
      setPlaying(true);
      const out = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
      const start = performance.now();
      let raf = 0;
      const finish = () => {
        v.controls.enabled = true;
        syncControlsToCamera(v);
        setPlaying(false);
        playbackRef.current = null;
        onDone?.();
      };
      const tick = (now: number) => {
        const t = Math.min((now - start) / (seconds * 1000), 1);
        samplePath(ks, t, out);
        v.camera.position.copy(out.pos);
        v.camera.quaternion.copy(out.quat);
        if (t < 1) {
          raf = requestAnimationFrame(tick);
          playbackRef.current = { raf, cancel };
        } else {
          finish();
        }
      };
      const cancel = () => {
        cancelAnimationFrame(raf);
        v.controls.enabled = true;
        syncControlsToCamera(v);
      };
      raf = requestAnimationFrame(tick);
      playbackRef.current = { raf, cancel };
    },
    [samplePath, stopPlayback]
  );

  const recordPath = useCallback(() => {
    const v = viewerRef.current;
    if (!v || keyframes.length < 2) return;
    const canvas = v.renderer.domElement;
    const stream = canvas.captureStream(30);
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
      ? "video/webm;codecs=vp9"
      : "video/webm";
    const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: "video/webm" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "drone-shot.webm";
      a.click();
      URL.revokeObjectURL(a.href);
      setRecording(false);
      setMessage("Drone shot downloaded (WebM).");
    };
    setRecording(true);
    setMessage(null);
    recorder.start(250);
    playPath(keyframes, duration, () => setTimeout(() => recorder.stop(), 300));
  }, [keyframes, duration, playPath]);

  // ---------- nerfstudio camera-path export / server render ----------

  const buildNerfstudioPath = useCallback(() => {
    const v = viewerRef.current!;
    const fps = 30;
    const frames = Math.max(2, Math.round(fps * duration));
    const out = { pos: new THREE.Vector3(), quat: new THREE.Quaternion() };
    const m = new THREE.Matrix4();
    const aspect = v.camera.aspect;
    const cameraPath = [];
    for (let f = 0; f < frames; f++) {
      const t = f / (frames - 1);
      samplePath(keyframes, t, out);
      m.compose(out.pos, out.quat, new THREE.Vector3(1, 1, 1));
      // nerfstudio stores camera_to_world row-major; three.js Matrix4 is column-major
      const rowMajor = m.clone().transpose().toArray();
      cameraPath.push({ camera_to_world: rowMajor, fov: v.camera.fov, aspect });
    }
    return {
      camera_type: "perspective",
      render_height: 1080,
      render_width: 1920,
      fps,
      seconds: duration,
      is_cycle: false,
      smoothness_value: 0,
      camera_path: cameraPath,
    };
  }, [keyframes, duration, samplePath]);

  const requestServerRender = useCallback(async () => {
    if (!projectId || keyframes.length < 2) return;
    setMessage(null);
    const res = await fetch(`/api/projects/${projectId}/render`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cameraPath: buildNerfstudioPath() }),
    });
    if (res.ok) setMessage("Render job queued. Run the worker on FarmShare to produce the MP4.");
    else setMessage(`Render request failed: ${(await res.json()).error ?? res.status}`);
  }, [projectId, keyframes, buildNerfstudioPath]);

  const downloadPathJson = useCallback(() => {
    const blob = new Blob([JSON.stringify(buildNerfstudioPath(), null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "camera-path.json";
    a.click();
    URL.revokeObjectURL(a.href);
  }, [buildNerfstudioPath]);

  // ---------- UI ----------

  return (
    <div className="relative h-full w-full">
      <div ref={containerRef} className="h-full w-full" />
      {loading && !loadError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-zinc-300">
          Loading 3D scene…
        </div>
      )}
      {loadError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/80 p-6 text-center text-red-400">
          Failed to load scene: {loadError}
        </div>
      )}

      <div className="absolute right-3 top-3 w-72 rounded-lg border border-zinc-700 bg-zinc-950/85 p-4 text-sm text-zinc-200 backdrop-blur">
        <h3 className="mb-2 font-semibold">Drone path</h3>
        <p className="mb-3 text-xs text-zinc-400">
          Drag to orbit, scroll to zoom, right-drag to pan. Frame a shot, then add a keyframe.
        </p>
        <div className="mb-3 flex gap-2">
          <button onClick={addKeyframe} className="flex-1 rounded bg-blue-600 px-2 py-1.5 font-medium hover:bg-blue-500">
            + Keyframe
          </button>
          <button
            onClick={() => setKeyframes([])}
            disabled={!keyframes.length}
            className="rounded bg-zinc-700 px-2 py-1.5 hover:bg-zinc-600 disabled:opacity-40"
          >
            Clear
          </button>
        </div>

        {keyframes.length > 0 && (
          <ol className="mb-3 max-h-32 space-y-1 overflow-y-auto">
            {keyframes.map((kf, i) => (
              <li key={i} className="flex items-center justify-between rounded bg-zinc-800/70 px-2 py-1">
                <button onClick={() => goToKeyframe(i)} className="text-left hover:text-blue-400">
                  #{i + 1}{" "}
                  <span className="text-xs text-zinc-500">
                    ({kf.position.map((x) => x.toFixed(1)).join(", ")})
                  </span>
                </button>
                <button onClick={() => removeKeyframe(i)} className="text-zinc-500 hover:text-red-400">
                  ✕
                </button>
              </li>
            ))}
          </ol>
        )}

        <label className="mb-2 flex items-center gap-2 text-xs text-zinc-400">
          Up axis
          <select
            defaultValue="0,1,0"
            onChange={(e) => {
              const v = viewerRef.current;
              if (!v) return;
              const [x, y, z] = e.target.value.split(",").map(Number);
              v.camera.up.set(x, y, z);
              v.controls.update();
            }}
            className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5"
          >
            <option value="0,1,0">+Y</option>
            <option value="0,-1,0">−Y</option>
            <option value="0,0,1">+Z</option>
            <option value="0,0,-1">−Z</option>
          </select>
          <span className="text-zinc-600">(fix tilted scenes)</span>
        </label>

        <label className="mb-3 flex items-center gap-2 text-xs text-zinc-400">
          Duration
          <input
            type="range"
            min={3}
            max={60}
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="flex-1"
          />
          {duration}s
        </label>

        <div className="flex flex-col gap-2">
          {!playing ? (
            <button
              onClick={() => playPath(keyframes, duration)}
              disabled={keyframes.length < 2}
              className="rounded bg-zinc-700 px-2 py-1.5 hover:bg-zinc-600 disabled:opacity-40"
            >
              ▶ Preview flight
            </button>
          ) : (
            <button onClick={stopPlayback} className="rounded bg-zinc-700 px-2 py-1.5 hover:bg-zinc-600">
              ■ Stop
            </button>
          )}
          <button
            onClick={recordPath}
            disabled={keyframes.length < 2 || recording}
            className="rounded bg-emerald-600 px-2 py-1.5 font-medium hover:bg-emerald-500 disabled:opacity-40"
          >
            {recording ? "Recording…" : "⏺ Record drone shot (WebM)"}
          </button>
          {projectId && (
            <button
              onClick={requestServerRender}
              disabled={keyframes.length < 2}
              className="rounded bg-purple-600 px-2 py-1.5 font-medium hover:bg-purple-500 disabled:opacity-40"
            >
              ☁ Render high-quality MP4 (FarmShare)
            </button>
          )}
          <button
            onClick={downloadPathJson}
            disabled={keyframes.length < 2}
            className="rounded bg-zinc-800 px-2 py-1.5 text-xs text-zinc-400 hover:bg-zinc-700 disabled:opacity-40"
          >
            Download nerfstudio camera-path.json
          </button>
        </div>
        {message && <p className="mt-3 text-xs text-emerald-300">{message}</p>}
      </div>
    </div>
  );
}

// Keep OrbitControls coherent after we move the camera manually: aim the
// orbit target a couple of meters in front of the camera.
function syncControlsToCamera(v: GsViewer) {
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(v.camera.quaternion);
  v.controls.target.copy(v.camera.position).addScaledVector(dir, 2);
  v.controls.update();
}
