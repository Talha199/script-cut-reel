// Shared helpers. Every script works on a project directory: --project <dir>, default cwd.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function parseArgs(argv = process.argv.slice(2)) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { out._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

export const args = parseArgs();
export const root = path.resolve(typeof args.project === "string" ? args.project : process.cwd());
export const p = (...parts) => path.join(root, ...parts);

// trimStart() also drops a UTF-8 BOM (Windows PowerShell 5.1 writes one with -Encoding utf8).
export const readJson = (rel) => JSON.parse(fs.readFileSync(p(rel), "utf8").trimStart());
export const writeJson = (rel, data) => fs.writeFileSync(p(rel), JSON.stringify(data, null, 2) + "\n", "utf8");
export const exists = (rel) => fs.existsSync(p(rel));

export function ff(argv) {
  console.log("ffmpeg", argv.join(" "));
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...argv], { stdio: "inherit" });
}

export function probe(file) {
  const out = execFileSync("ffprobe", [
    "-v", "error", "-show_entries",
    "stream=codec_type,codec_name,profile,width,height,r_frame_rate,avg_frame_rate,pix_fmt,color_range,color_space,color_transfer,color_primaries,sample_rate,channels:stream_side_data=rotation:format=duration,size",
    "-of", "json", file,
  ]).toString();
  const j = JSON.parse(out);
  // Phone recordings can carry extra streams (thumbnails as mjpeg "video", metadata data streams):
  // the first video stream is the real one, and every ffmpeg call maps 0:v:0 / 0:a:0 explicitly.
  const v = j.streams.find((s) => s.codec_type === "video");
  const a = j.streams.find((s) => s.codec_type === "audio");
  let width = v?.width, height = v?.height;
  const rot = Math.abs(v?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0);
  if (rot === 90 || rot === 270) [width, height] = [height, width];
  const rate = (r) => { const [n, d] = (r ?? "0/1").split("/").map(Number); return d ? +(n / d).toFixed(3) : 0; };
  const info = { duration: Number(j.format.duration), width, height, fps: v ? rate(v.r_frame_rate) : null, hasVideo: !!v, hasAudio: !!a };
  if (v) info.color = { transfer: v.color_transfer ?? null, primaries: v.color_primaries ?? null, space: v.color_space ?? null, range: v.color_range ?? null, pixFmt: v.pix_fmt };
  // Not stored in media.json (non-enumerable): codec details for finalize.mjs QA.
  Object.defineProperty(info, "raw", { value: { v, a, avgFps: v ? rate(v.avg_frame_rate) : null, size: Number(j.format.size) } });
  return info;
}

// iPhones record HLG HDR by default; PQ comes from some Android phones and cameras. Scaling either
// straight to 8-bit SDR gives the grey, washed-out look that "make it brighter" used to compensate for.
export const isHdr = (info) => ["arib-std-b67", "smpte2084"].includes(info.color?.transfer);
// HDR reference white (203 nits, BT.2408) becomes linear 1.0 and the 1000-nit peak 4.93; mobius keeps
// everything below ~0.3 linear (faces, mid-tones) as a straight conversion would and rolls off only
// the highlights. Measured on HLG test patches 25/50/75/100 %: → 28/56/85/100 % SDR. The often-quoted
// npl=100 + hable recipe gives 26/49/76/100 % — as grey as no conversion — because phone HLG carries no
// mastering metadata for tonemap to find the peak in.
export function tonemapFilter(info, op = "mobius") {
  const { transfer, primaries, space } = info.color;
  return `zscale=tin=${transfer}:pin=${primaries ?? "bt2020"}:min=${space ?? "bt2020nc"}:t=linear:npl=203,format=gbrpf32le,` +
    `zscale=p=bt709,tonemap=tonemap=${op}:desat=0:peak=4.93,zscale=t=bt709:m=bt709:r=tv,format=yuv420p`;
}

// 16-bit PCM WAV reader with RMS / peak level of a window, for audit.mjs and silences.mjs.
export function readWav(file) {
  const b = fs.readFileSync(file);
  let off = 12, rate = 16000, data = null;
  while (off < b.length) {
    const id = b.toString("ascii", off, off + 4), size = b.readUInt32LE(off + 4);
    if (id === "fmt ") rate = b.readUInt32LE(off + 12);
    if (id === "data") { data = new Int16Array(b.buffer, b.byteOffset + off + 8, Math.floor(Math.min(size, b.length - off - 8) / 2)); break; }
    off += 8 + size + (size % 2);
  }
  const span = (a, c) => [Math.max(0, Math.floor(a * rate)), Math.min(data.length, Math.floor(c * rate))];
  const rms = (a, c) => {
    const [i0, i1] = span(a, c);
    let s = 0;
    for (let i = i0; i < i1; i++) s += (data[i] / 32768) ** 2;
    return 10 * Math.log10(s / Math.max(1, i1 - i0) + 1e-12);
  };
  const peak = (a, c) => {
    const [i0, i1] = span(a, c);
    let m = 0;
    for (let i = i0; i < i1; i++) m = Math.max(m, Math.abs(data[i]));
    return 20 * Math.log10(m / 32768 + 1e-9);
  };
  return { rate, data, duration: data.length / rate, rms, peak };
}

// Rough syllable count (vowel groups): language-neutral enough to compare speech rate in de/tr/en,
// where words-per-minute targets don't transfer (German compounds, Turkish suffixes).
export const syllables = (w) => Math.max(/\p{L}/u.test(w) ? 1 : 0, (w.toLowerCase().match(/[aeiouyäöüıâîûéèêàáíóúœæ]+/g) ?? []).length);
