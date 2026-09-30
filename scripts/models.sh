#!/bin/sh
# Downloads the whisper.cpp model clipper uses (small.en, ~470 MB) into ~/.cache/clipper/models,
# or into $CLIPPER_MODELS. Safe to run again: it skips a model that's already there.
set -eu
MODEL="${1:-small.en}"
DIR="${CLIPPER_MODELS:-$HOME/.cache/clipper/models}"
FILE="$DIR/ggml-$MODEL.bin"
mkdir -p "$DIR"
if [ -s "$FILE" ]; then echo "already there: $FILE"; exit 0; fi
echo "downloading ggml-$MODEL.bin to $DIR ..."
curl -fL --progress-bar -o "$FILE.part" "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$MODEL.bin"
mv "$FILE.part" "$FILE"
echo "done: $FILE"
