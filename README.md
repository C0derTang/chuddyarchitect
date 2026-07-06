# Chuddy Architect

Walk through a house with your phone camera → photorealistic 3D model (Gaussian Splatting) → author and render **artificial drone shots** through the space.

## How it works

```
Phone video ──upload──> Next.js app (Vercel)
                          │  Vercel Blob (video + results)
                          │  Neon Postgres (projects/jobs)
                          ▼
              FarmShare worker (polls the app's API)
                ffmpeg frames → COLMAP → ns-train splatfacto
                → export splat → compress → upload
                          ▼
              Browser viewer + drone-path editor
                → instant WebM recording in the browser
                → or queue a high-quality MP4 render on FarmShare
```

- `app/`, `components/`, `lib/` — the Next.js web app
- `worker/` — Python + Slurm scripts you run on Stanford FarmShare

## Quick start (local, no credentials)

```bash
npm install
node scripts/generate-demo-splat.mjs   # creates public/demo.ply
npm run dev
```

Open http://localhost:3000/demo — a synthetic room splat loads and you can try the full drone-path editor: orbit around, **+ Keyframe** a few shots, **Preview flight**, **Record drone shot (WebM)**.

With no `DATABASE_URL` / `BLOB_READ_WRITE_TOKEN` set, the app stores data in `.data/` (JSON + files), so uploads and the whole project flow work locally too.

## Recording a good walkthrough video

- Move **slowly**; avoid fast pans (motion blur kills COLMAP).
- Landscape orientation, good lighting, 1–3 minutes, 1080p is plenty.
- Overlap your path — walk a loop, revisit doorways from both sides.
- Featureless white walls are hard; keep furniture/edges in frame.

## Production deployment

1. Deploy this repo to Vercel (`vercel deploy` or Git integration).
2. Add a **Blob store** (Storage tab) — sets `BLOB_READ_WRITE_TOKEN`.
3. Add **Neon Postgres** via the Vercel Marketplace — sets `DATABASE_URL`.
4. Set `WORKER_TOKEN` to a long random string (e.g. `openssl rand -hex 32`).

## FarmShare worker

```bash
ssh <sunetid>@rice.stanford.edu
git clone <this repo> chuddyarchitect && cd chuddyarchitect/worker
bash setup.sh                 # one-time: micromamba + COLMAP + nerfstudio
vi .env                       # API_URL + WORKER_TOKEN
sbatch train.sbatch           # drains queued jobs on a GPU node (L40S)
squeue -u $USER               # watch; logs land in worker/logs/<jobid>.out
```

Training takes ~30–60 min per video on an L40S. Trained artifacts persist in `~/chuddy-work/<project-id>/`, so drone-shot render jobs (also drained by `train.sbatch`) can run any time later.

## Drone shots

Open a ready project → frame a shot → **+ Keyframe** (4–8 of them) → set duration:

- **Record drone shot (WebM)** — instant, rendered in your browser at viewer quality.
- **Render high-quality MP4 (FarmShare)** — queues a `ns-render camera-path` job at 1080p with full model quality; run `sbatch train.sbatch` again to process it, then download from the project page.

If a scene loads tilted, use the **Up axis** selector in the panel (nerfstudio scenes are usually +Z up).

## Notes / known limits

- Personal MVP: no auth on the UI; worker API is protected by `WORKER_TOKEN`.
- `ns-render` interprets the camera path in the model's own coordinate space — the same space the web viewer displays — so paths authored in the viewer line up. If a server render comes out mis-oriented, check the exported `camera-path.json` against `ns-viewer` output for the same scene.
- Splats are compressed to PlayCanvas compressed PLY (~15–20× smaller) before upload; the viewer reads them natively. Raw PLY is the fallback.
