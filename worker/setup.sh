#!/usr/bin/env bash
# One-time environment setup on Stanford FarmShare.
# Run from the worker/ directory:  bash setup.sh
set -euo pipefail
cd "$(dirname "$0")"

# 1. micromamba (self-contained conda; no admin rights needed)
if [ ! -x "$HOME/bin/micromamba" ]; then
  echo "installing micromamba..."
  mkdir -p "$HOME/bin"
  curl -Ls https://micro.mamba.pm/api/micromamba/linux-64/latest | tar -xj -C "$HOME" bin/micromamba
fi
export MAMBA_ROOT_PREFIX="$HOME/micromamba"
eval "$("$HOME/bin/micromamba" shell hook -s bash)"

# 2. env with COLMAP + ffmpeg + node (for splat compression) + python
if ! micromamba env list | grep -q chuddy; then
  micromamba create -y -n chuddy -c conda-forge python=3.10 colmap ffmpeg nodejs pip
fi
micromamba activate chuddy

# 3. PyTorch (CUDA 12.1 wheels work on the L40S nodes) + nerfstudio
pip install --upgrade pip --trusted-host pypi.org --trusted-host files.pythonhosted.org

pip install --user torch==2.4.1 torchvision==0.19.1 \
  --index-url https://download.pytorch.org/whl/cu121 \
  --trusted-host download.pytorch.org

pip install --user gsplat \
  --extra-index-url https://docs.gsplat.studio/whl/pt24cu121 \
  --trusted-host docs.gsplat.studio || pip install gsplat --trusted-host pypi.org --trusted-host files.pythonhosted.org

pip install --user nerfstudio requests vercel_blob \
  --trusted-host pypi.org \
  --trusted-host files.pythonhosted.org

# 4. config
if [ ! -f .env ]; then
  cp .env.example .env
  echo ""
  echo ">>> Edit worker/.env and set API_URL + WORKER_TOKEN before running jobs."
fi
mkdir -p logs
echo "setup complete. Queue a job in the web app, then:  sbatch train.sbatch"
