#!/usr/bin/env python3
# bin/gen-image.py "<prompt>" "<dest_path>" [size]
# Direct gpt-image-1 generation (bypasses Codex, which doesn't expose an image tool here).
# Loads OPENAI_API_KEY from the nearest .env walking up from this file.
import base64
import os
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None


def _find_env(start: Path):
    for d in (start, *start.parents):
        if (d / ".env").is_file():
            return d / ".env"
    return None


def main():
    if len(sys.argv) < 3:
        sys.exit("usage: gen-image.py <prompt> <dest_path> [size]")
    prompt = sys.argv[1]
    dest = Path(sys.argv[2])
    size = sys.argv[3] if len(sys.argv) > 3 else "1024x1024"

    if load_dotenv:
        env = _find_env(Path(__file__).resolve())
        if env:
            load_dotenv(env)

    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        sys.exit("OPENAI_API_KEY missing (not in env and no .env found)")

    try:
        from openai import OpenAI
    except ImportError:
        sys.exit("openai SDK missing — install it in the python used by GEN_IMAGE_PY")

    client = OpenAI(api_key=api_key)
    # Cost control: medium ≈ ~4¢/img, low ≈ ~1¢. Override with GEN_IMAGE_QUALITY=low|medium|high|auto.
    quality = os.environ.get("GEN_IMAGE_QUALITY", "medium")
    resp = client.images.generate(model="gpt-image-1", prompt=prompt, size=size, quality=quality, n=1)
    item = resp.data[0]

    dest.parent.mkdir(parents=True, exist_ok=True)
    b64 = getattr(item, "b64_json", None)
    url = getattr(item, "url", None)
    if b64:
        dest.write_bytes(base64.b64decode(b64))
    elif url:
        import urllib.request
        urllib.request.urlretrieve(url, dest)
    else:
        sys.exit("no image data (b64_json/url) in OpenAI response")

    print(str(dest))


if __name__ == "__main__":
    main()
