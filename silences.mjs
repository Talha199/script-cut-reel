// Detects silent stretches in the RAW main audio → edit/silences.json [[start,end], …]
//   node <skill>/scripts/silences.mjs [--noise -35] [--min 0.25]
// build.mjs removes these inside kept segments (leaving a short breath). Check the result with audit.mjs.
import { spawnSync } from "node:child_process";
import { args, p, writeJson } from "./lib.mjs";

const noise = args.noise ?? "-35";
const min = args.min ?? "0.25";
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
