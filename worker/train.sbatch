#!/usr/bin/env bash
#SBATCH --job-name=chuddy
#SBATCH --partition=gpu
#SBATCH --qos=gpu
#SBATCH --gres=gpu:1
#SBATCH --cpus-per-task=8
#SBATCH --mem=32G
#SBATCH --time=4:00:00
#SBATCH --output=logs/%j.out

# Drains the app's job queue (training + drone-shot renders), then exits.
# Submit with:  sbatch train.sbatch

export MAMBA_ROOT_PREFIX="$HOME/micromamba"
eval "$("$HOME/bin/micromamba" shell hook -s bash)"
micromamba activate chuddy

cd "$SLURM_SUBMIT_DIR"
python worker.py --once
