#!/usr/bin/env python3
"""FarmShare worker for Chuddy Architect.

Polls the web app for queued jobs and runs the reconstruction pipeline:
  train:  video -> ns-process-data (ffmpeg + COLMAP) -> ns-train splatfacto
          -> ns-export gaussian-splat -> compress -> upload splat
  render: nerfstudio camera path json -> ns-render camera-path -> upload mp4

Usage:
  python worker.py --once   # drain the queue, then exit (used by sbatch)
  python worker.py --loop   # poll forever (interactive GPU session)

Config comes from worker/.env (API_URL, WORKER_TOKEN).
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
WORK_DIR = Path(os.environ.get("CHUDDY_WORK_DIR", Path.home() / "chuddy-work"))


def load_env():
    env_file = HERE / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


load_env()
API_URL = os.environ.get("API_URL", "").rstrip("/")
WORKER_TOKEN = os.environ.get("WORKER_TOKEN", "")

if not API_URL:
    sys.exit("API_URL not set. Copy .env.example to .env and fill it in.")

SESSION = requests.Session()
if WORKER_TOKEN:
    SESSION.headers["Authorization"] = f"Bearer {WORKER_TOKEN}"


def api(path, payload=None, method="POST"):
    url = f"{API_URL}{path}"
    r = SESSION.request(method, url, json=payload, timeout=120)
    r.raise_for_status()
    return r.json()


def absolutize(url):
    """DB may store app-relative URLs in local-dev mode."""
    return url if url.startswith("http") else f"{API_URL}{url}"


def update(job_type, job_id, status=None, log=None):
    if log:
        print(log, flush=True)
    payload = {"type": job_type, "id": job_id}
    if status:
        payload["status"] = status
    if log:
        payload["logAppend"] = log
    try:
        api("/api/worker/update", payload)
    except Exception as e:  # log updates must never kill the pipeline
        print(f"(update failed: {e})", flush=True)


def run(cmd, job_type, job_id, cwd=None):
    update(job_type, job_id, log=f"$ {' '.join(cmd)}")
    proc = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    tail = (proc.stdout + "\n" + proc.stderr)[-3000:]
    if proc.returncode != 0:
        update(job_type, job_id, log=f"command failed (exit {proc.returncode}):\n{tail}")
        raise RuntimeError(f"{cmd[0]} failed")
    return proc


def download(url, dest: Path, job_type, job_id):
    update(job_type, job_id, log=f"downloading {url}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    with SESSION.get(absolutize(url), stream=True, timeout=600) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            shutil.copyfileobj(r.raw, f)


def upload_result(local_path: Path, remote_name: str, upload_cfg, job_type, job_id) -> str:
    size_mb = local_path.stat().st_size / 1e6
    update(job_type, job_id, log=f"uploading {remote_name} ({size_mb:.1f} MB)")
    if upload_cfg.get("mode") == "blob":
        import vercel_blob

        os.environ["BLOB_READ_WRITE_TOKEN"] = upload_cfg["token"]
        resp = vercel_blob.put(f"results/{remote_name}", local_path.read_bytes())
        return resp["url"]
    # api mode (local dev only; large files won't fit through Vercel functions)
    with open(local_path, "rb") as f:
        r = SESSION.put(
            f"{API_URL}/api/worker/upload", params={"filename": remote_name}, data=f, timeout=1800
        )
    r.raise_for_status()
    return r.json()["url"]


def latest_config(project_dir: Path) -> Path:
    configs = sorted(project_dir.glob("outputs/**/config.yml"), key=lambda p: p.stat().st_mtime)
    if not configs:
        raise RuntimeError("no trained model (config.yml) found")
    return configs[-1]


def handle_train(project, upload_cfg):
    pid = project["id"]
    pdir = WORK_DIR / pid
    pdir.mkdir(parents=True, exist_ok=True)
    video = pdir / "input_video.mp4"
    processed = pdir / "processed"
    export_dir = pdir / "export"

    update("train", pid, log=f"=== training project {pid} on {os.uname().nodename} ===")
    download(project["video_url"], video, "train", pid)

    update("train", pid, log="step 1/3: frame extraction + COLMAP (ns-process-data)")
    run(
        ["ns-process-data", "video", "--data", str(video), "--output-dir", str(processed),
         "--num-frames-target", "300"],
        "train", pid,
    )

    update("train", pid, log="step 2/3: training gaussian splats (ns-train splatfacto)")
    run(
        ["ns-train", "splatfacto", "--data", str(processed), "--output-dir", str(pdir / "outputs"),
         "--max-num-iterations", "30000", "--viewer.quit-on-train-completion", "True",
         "--vis", "tensorboard"],
        "train", pid,
    )

    update("train", pid, log="step 3/3: exporting splat (ns-export gaussian-splat)")
    config = latest_config(pdir)
    run(["ns-export", "gaussian-splat", "--load-config", str(config), "--output-dir", str(export_dir)],
        "train", pid)

    plys = sorted(export_dir.glob("*.ply"), key=lambda p: p.stat().st_size, reverse=True)
    if not plys:
        raise RuntimeError("export produced no .ply")
    ply = plys[0]

    # Compress (PlayCanvas compressed ply, ~15-20x smaller; the web viewer reads it natively).
    compressed = export_dir / "splat.compressed.ply"
    try:
        run(["npx", "--yes", "@playcanvas/splat-transform", str(ply), str(compressed)], "train", pid)
        result = compressed
    except Exception:
        update("train", pid, log="compression failed; uploading raw ply")
        result = ply

    url = upload_result(result, f"{pid}.{'compressed.' if result == compressed else ''}ply",
                        upload_cfg, "train", pid)
    api("/api/worker/complete", {"type": "train", "id": pid, "splatUrl": url})
    update("train", pid, log=f"done: {url}")


def handle_render(job, project, upload_cfg):
    jid, pid = job["id"], project["id"]
    pdir = WORK_DIR / pid
    update("render", jid, log=f"=== rendering drone shot for project {pid} ===")
    try:
        config = latest_config(pdir)
    except RuntimeError:
        raise RuntimeError(
            f"train artifacts for project {pid} not found under {pdir}. "
            "Render jobs must run where training artifacts persist (FarmShare home dir)."
        )

    path_file = pdir / f"camera-path-{jid}.json"
    path_file.write_text(job["camera_path_json"])
    out_mp4 = pdir / f"drone-{jid}.mp4"

    run(
        ["ns-render", "camera-path", "--load-config", str(config),
         "--camera-path-filename", str(path_file), "--output-path", str(out_mp4)],
        "render", jid,
    )

    url = upload_result(out_mp4, f"{pid}-drone-{jid}.mp4", upload_cfg, "render", jid)
    api("/api/worker/complete", {"type": "render", "id": jid, "videoUrl": url})
    update("render", jid, log=f"done: {url}")


def process_one() -> bool:
    resp = api("/api/worker/claim", {})
    claimed = resp.get("job")
    if not claimed:
        return False
    upload_cfg = resp.get("upload", {"mode": "api"})
    if claimed["type"] == "train":
        project = claimed["project"]
        try:
            handle_train(project, upload_cfg)
        except Exception as e:
            update("train", project["id"], status="failed", log=f"FAILED: {e}")
        return True
    if claimed["type"] == "render":
        job, project = claimed["job"], claimed["project"]
        try:
            handle_render(job, project, upload_cfg)
        except Exception as e:
            update("render", job["id"], status="failed", log=f"FAILED: {e}")
        return True
    return False


def main():
    ap = argparse.ArgumentParser()
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--once", action="store_true", help="drain queue, then exit")
    mode.add_argument("--loop", action="store_true", help="poll forever")
    args = ap.parse_args()

    WORK_DIR.mkdir(parents=True, exist_ok=True)
    if args.once:
        worked = False
        while process_one():
            worked = True
        print("queue empty, exiting" if worked else "no queued jobs")
        return
    print(f"polling {API_URL} every 30s (ctrl-c to stop)")
    while True:
        try:
            if not process_one():
                time.sleep(30)
        except KeyboardInterrupt:
            break
        except Exception as e:
            print(f"poll error: {e}", flush=True)
            time.sleep(30)


if __name__ == "__main__":
    main()
