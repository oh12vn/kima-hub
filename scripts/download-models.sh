#!/usr/bin/env bash
# ============================================================
# Kima Hub ML Model Downloader
# ============================================================
# Downloads all ML models needed for audio analysis:
#   - MusiCNN models from essentia.upf.edu (mood, danceability, etc.)
#   - CLAP checkpoint from HuggingFace (vibe similarity)
#
# Usage (standalone):
#   bash scripts/download-models.sh
#
# Usage (with custom model directory):
#   bash scripts/download-models.sh /path/to/models
#
# The script first checks if ALL model files already exist on disk.
# If they do, it skips everything (zero-network mode).
# If any are missing, it downloads only those.
#
# Works in Docker builds too: COPY script + models/ then RUN the script.
# Compatible with bash 3.x (no associative arrays).
# ============================================================
set -euo pipefail

# --- Resolve models directory ---
if [ $# -ge 1 ]; then
    MODELS_DIR="$1"
else
    MODELS_DIR="$(cd "$(dirname "$0")/.." && pwd)/models"
fi
mkdir -p "$MODELS_DIR"

echo "=== Kima Hub ML Model Downloader ==="
echo "Target: $MODELS_DIR"
echo ""

# --------------------------------------------------
# Define the required model files
# (parallel arrays — bash 3.x compatible)
# --------------------------------------------------
MODEL_NAMES=()
MODEL_URLS=()

# Base MusiCNN embedding model
MODEL_NAMES[${#MODEL_NAMES[@]}]="msd-musicnn-1.pb"
MODEL_URLS[${#MODEL_URLS[@]}]="https://essentia.upf.edu/models/autotagging/msd/msd-musicnn-1.pb"

# Mood / classification heads
MODEL_NAMES[${#MODEL_NAMES[@]}]="mood_happy-msd-musicnn-1.pb"
MODEL_URLS[${#MODEL_URLS[@]}]="https://essentia.upf.edu/models/classification-heads/mood_happy/mood_happy-msd-musicnn-1.pb"

MODEL_NAMES[${#MODEL_NAMES[@]}]="mood_sad-msd-musicnn-1.pb"
MODEL_URLS[${#MODEL_URLS[@]}]="https://essentia.upf.edu/models/classification-heads/mood_sad/mood_sad-msd-musicnn-1.pb"

MODEL_NAMES[${#MODEL_NAMES[@]}]="mood_relaxed-msd-musicnn-1.pb"
MODEL_URLS[${#MODEL_URLS[@]}]="https://essentia.upf.edu/models/classification-heads/mood_relaxed/mood_relaxed-msd-musicnn-1.pb"

MODEL_NAMES[${#MODEL_NAMES[@]}]="mood_aggressive-msd-musicnn-1.pb"
MODEL_URLS[${#MODEL_URLS[@]}]="https://essentia.upf.edu/models/classification-heads/mood_aggressive/mood_aggressive-msd-musicnn-1.pb"

MODEL_NAMES[${#MODEL_NAMES[@]}]="mood_party-msd-musicnn-1.pb"
MODEL_URLS[${#MODEL_URLS[@]}]="https://essentia.upf.edu/models/classification-heads/mood_party/mood_party-msd-musicnn-1.pb"

MODEL_NAMES[${#MODEL_NAMES[@]}]="mood_acoustic-msd-musicnn-1.pb"
MODEL_URLS[${#MODEL_URLS[@]}]="https://essentia.upf.edu/models/classification-heads/mood_acoustic/mood_acoustic-msd-musicnn-1.pb"

MODEL_NAMES[${#MODEL_NAMES[@]}]="mood_electronic-msd-musicnn-1.pb"
MODEL_URLS[${#MODEL_URLS[@]}]="https://essentia.upf.edu/models/classification-heads/mood_electronic/mood_electronic-msd-musicnn-1.pb"

MODEL_NAMES[${#MODEL_NAMES[@]}]="danceability-msd-musicnn-1.pb"
MODEL_URLS[${#MODEL_URLS[@]}]="https://essentia.upf.edu/models/classification-heads/danceability/danceability-msd-musicnn-1.pb"

MODEL_NAMES[${#MODEL_NAMES[@]}]="deam-msd-musicnn-2.pb"
MODEL_URLS[${#MODEL_URLS[@]}]="https://essentia.upf.edu/models/classification-heads/deam/deam-msd-musicnn-2.pb"

MODEL_NAMES[${#MODEL_NAMES[@]}]="emomusic-msd-musicnn-2.pb"
MODEL_URLS[${#MODEL_URLS[@]}]="https://essentia.upf.edu/models/classification-heads/emomusic/emomusic-msd-musicnn-2.pb"

MODEL_COUNT=${#MODEL_NAMES[@]}

# CLAP checkpoint (stripped state_dict)
CLAP_FILE="music_audioset_epoch_15_esc_90.14.pt"
CLAP_URL="https://huggingface.co/lukewys/laion_clap/resolve/main/music_audioset_epoch_15_esc_90.14.pt"

# --------------------------------------------------
# Bulk availability check
# --------------------------------------------------
ALL_PRESENT=true
for ((i = 0; i < MODEL_COUNT; i++)); do
    if [ ! -f "$MODELS_DIR/${MODEL_NAMES[$i]}" ]; then
        ALL_PRESENT=false
        break
    fi
done
# Also check CLAP file
if [ ! -f "$MODELS_DIR/$CLAP_FILE" ]; then
    ALL_PRESENT=false
fi

if [ "$ALL_PRESENT" = true ]; then
    echo "All ML models already available offline at $MODELS_DIR"
    echo "Nothing to download."
    ls -lh "$MODELS_DIR/"
    exit 0
fi

# --------------------------------------------------
# MusiCNN models
# --------------------------------------------------
echo "--- MusiCNN models ($MODEL_COUNT files) ---"
for ((i = 0; i < MODEL_COUNT; i++)); do
    filename="${MODEL_NAMES[$i]}"
    url="${MODEL_URLS[$i]}"
    dest="$MODELS_DIR/$filename"
    if [ -f "$dest" ]; then
        echo "  SKIP  $filename (exists)"
    else
        echo "  DOWN  $filename"
        curl -L --retry 3 --retry-delay 5 --connect-timeout 30 --max-time 300 \
            -o "$dest" "$url"
    fi
done

# --------------------------------------------------
# CLAP checkpoint
# --------------------------------------------------
echo ""
echo "--- CLAP model ---"
CLAP_DEST="$MODELS_DIR/$CLAP_FILE"
if [ -f "$CLAP_DEST" ]; then
    echo "  SKIP  $CLAP_FILE (exists)"
else
    CLAP_RAW="$MODELS_DIR/clap_full.pt"
    echo "  DOWN  raw checkpoint (~900 MB)..."
    curl -L --retry 3 --retry-delay 5 --connect-timeout 30 --max-time 600 \
        -o "$CLAP_RAW" "$CLAP_URL"
    echo "  STRIP extracting state_dict..."
    python3 -c "
import torch, os
ckpt = torch.load('$CLAP_RAW', map_location='cpu', weights_only=False)
torch.save({'state_dict': ckpt['state_dict']}, '$CLAP_DEST')
size = os.path.getsize('$CLAP_DEST')
print(f'  Saved stripped checkpoint: {size // 1024 // 1024} MB')
"
    rm -f "$CLAP_RAW"
fi

# --------------------------------------------------
# Summary
# --------------------------------------------------
echo ""
echo "=== Download complete ==="
echo ""
ls -lh "$MODELS_DIR/"
