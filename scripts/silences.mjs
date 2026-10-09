// Detects silent stretches in the RAW main audio → edit/silences.json [[start,end], …]
//   node <skill>/scripts/silences.mjs [--noise auto|-35] [--min 0.25]
// --noise auto (default): the room's noise floor (10th percentile of 50 ms peak levels) + 6 dB,
// clamped to −45…−30 dB — phone recordings differ too much for one fixed value. silencedetect
// compares individual samples, so the floor is measured on peaks, not RMS.
// build.mjs removes these inside kept segments (leaving a short breath). Check the result with audit.mjs.
import { spawnSync } from "node:child_process";
import { args, p, readWav, writeJson } from "./lib.mjs";

const min = args.min ?? "0.25";
let noise = args.noise ?? "auto";
if (noise === "auto") {
  const wav = readWav(p("edit/main.wav"));
  const peaks = [];
  for (let t = 0; t + 0.05 <= wav.duration; t += 0.05) {
    const v = wav.peak(t, t + 0.05);
    if (v > -90) peaks.push(v); // digital silence (muted start, gaps) isn't room noise
  }
  peaks.sort((a, b) => a - b);
  const floor = peaks[Math.floor(peaks.length * 0.1)] ?? -60;
  noise = String(Math.round(Math.min(-30, Math.max(-45, floor + 6))));
  console.log(`noise floor ≈ ${floor.toFixed(1)} dB peak → threshold ${noise} dB`);
}
const r = spawnSync("ffmpeg", ["-hide_banner", "-i", p("edit/main.wav"), "-af", `silencedetect=noise=${noise}dB:d=${min}`, "-f", "null", "-"], { encoding: "utf8" });
const out = [];
let s = null;
for (const line of r.stderr.split(/\r?\n/)) {
  const a = line.match(/silence_start: ([\d.]+)/);
  const b = line.match(/silence_end: ([\d.]+)/);
  if (a) s = Number(a[1]);
  if (b && s !== null) { out.push([+s.toFixed(3), Number(b[1])]); s = null; }
}
writeJson("edit/silences.json", out);
console.log(`${out.length} silences (< ${noise} dB, ≥ ${min}s) → edit/silences.json`);
