#!/bin/bash
# bin/gen-image.sh "<scene>" <destPath>
#   Default: a clean, photorealistic preparedness/home-safety lifestyle photo, NO text/watermark.
# bin/gen-image.sh --meme --top "<TOP>" --bottom "<BOTTOM>" "<scene>" <destPath>
#   Meme: a relatable, wholesome preparedness meme with classic top/bottom caption text (bold white
#   Impact font, black outline, ALL CAPS) rendered INTO the image. Positive tone, never scary.
# Generates one image with codex (the PROVEN invocation: prompt as arg, stdin from /dev/null),
# then locates the saved file (newest ig_*.png by mtime — codex stdout is unreliable) and copies
# it to dest. Prints the dest path on success; exits non-zero on failure.
set -u

MEME=0; STORY=0; TOP=""; BOTTOM=""
POSITIONAL=()
while [ $# -gt 0 ]; do
  case "$1" in
    --meme) MEME=1; shift ;;
    --story) STORY=1; shift ;;
    --top) TOP="${2:-}"; shift 2 ;;
    --bottom) BOTTOM="${2:-}"; shift 2 ;;
    *) POSITIONAL+=("$1"); shift ;;
  esac
done
SCENE="${POSITIONAL[0]:-}"; DEST="${POSITIONAL[1]:-}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
if [ -z "$SCENE" ] || [ -z "$DEST" ]; then
  echo "usage: gen-image.sh [--meme --top T --bottom B] <scene> <destPath>" >&2; exit 2
fi

if [ "$MEME" -eq 1 ]; then
  PROMPT="Use your gpt-image tool to create a relatable, wholesome meme in the classic meme format about home emergency-preparedness life: a warm, lightly humorous, photorealistic image of ${SCENE}. Keep it positive and reassuring — no disasters in progress, no injuries, no distress, no gore, no real public figures. Overlay the caption text directly on the image as bold WHITE text in the Impact meme font with a thick black outline, ALL CAPS, centered horizontally. Top caption: \"${TOP}\". Bottom caption: \"${BOTTOM}\". Render the captions large, clearly legible, and spelled exactly as given. No brand logos, no watermark. Save it and print the absolute path."
elif [ "$STORY" -eq 1 ]; then
  PROMPT="Use your gpt-image tool to create a vertical 9:16 full-screen, portrait (1024x1536) photorealistic Story image of ${SCENE}. Warm, reassuring, calm and aspirational home setting; keep clear negative space near the top and bottom for Story UI. No text, no logos, no watermark, no disasters in progress, no injuries, no real public figures. Save it and print the absolute path."
else
  PROMPT="Use your gpt-image tool to create a clean, photorealistic lifestyle photo (no text, no logos, no watermark) of ${SCENE}. Warm, reassuring, well-lit home setting; calm and aspirational, never alarming — no disasters in progress, no injuries, no distress, no real public figures. Save it and print the absolute path."
fi

# Image backend: direct gpt-image-1 via Python + OPENAI_API_KEY (Codex doesn't expose an image
# tool in this environment). Override the interpreter with GEN_IMAGE_PY if the venv path differs.
SIZE="1024x1024"; [ "$STORY" -eq 1 ] && SIZE="1024x1536"
PYBIN="${GEN_IMAGE_PY:-/Users/matte/Desktop/ClaudeCode/US-Project/us-brands-pipeline/.venv/bin/python}"
mkdir -p "$DIR/state"
"$PYBIN" "$DIR/bin/gen-image.py" "$PROMPT" "$DEST" "$SIZE" >>"$DIR/state/codex.log" 2>&1
RC=$?
if [ "$RC" -ne 0 ]; then echo "image gen exited $RC (see state/codex.log)" >&2; exit 1; fi
[ -s "$DEST" ] || { echo "no image produced (see state/codex.log)" >&2; exit 1; }
echo "$DEST"
