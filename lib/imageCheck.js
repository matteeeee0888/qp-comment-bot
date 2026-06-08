// lib/imageCheck.js — a record may only publish with an image if the file is real.
import { readFile } from "node:fs/promises";

const MIN_BYTES = 1024; // a real photo is far bigger; this only catches empty/broken files.

export async function isValidImage(filePath) {
  let buf;
  try {
    buf = await readFile(filePath);
  } catch {
    return false;
  }
  if (buf.length < MIN_BYTES) return false;
  const isPng = buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  const isJpeg = buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  return isPng || isJpeg;
}
