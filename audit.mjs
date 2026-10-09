// Sanity checks between the transcript and the waveform, inside the kept segments of edit/project.json
// (or the whole recording when there is no project.json yet).
//   node <skill>/scripts/audit.mjs
// 1. UNTRANSCRIBED SPEECH — transcript gaps ≥ 0.8s that are loud: speech the ASR dropped
//    (e.g. Arabic "sallallahu alayhi wa sallam" inside German speech, a name, another language).
//    Keep it in the cut, and usually add a captionInserts entry for it.
// 2. SILENCE OVER A WORD START — a detected silence covering a word's start. Usually the ASR places
//    sentence-initial words ~0.3s early (safe to cut); if the dB trail shows speech, raise --noise in silences.mjs.
import fs from "node:fs";
import { exists, p, readJson } from "./lib.mjs";

function readWav(file) {
  const b = fs.readFileSync(file);
  let off = 12, rate = 16000, data = null;
  while (off < b.length) {
    const id = b.toString("ascii", off, off + 4), size = b.readUInt32LE(off + 4);
    if (id === "fmt ") rate = b.readUInt32LE(off + 12);
    if (id === "data") { data = new Int16Array(b.buffer, b.byteOffset + off + 8, Math.floor(Math.min(size, b.length - off - 8) / 2)); break; }
    off += 8 + size + (size % 2);
  }
  return { rate, data };
}
const { rate, data } = readWav(p("edit/main.wav"));
const db = (a, b) => {
  const i0 = Math.max(0, Math.floor(a * rate)), i1 = Math.min(data.length, Math.floor(b * rate));
  let s = 0;
  for (let i = i0; i < i1; i++) s += (data[i] / 32768) ** 2;
  return 10 * Math.log10(s / Math.max(1, i1 - i0) + 1e-12);
};
const trail = (a, b) => { const o = []; for (let t = a; t < b; t += 0.05) o.push(db(t, t + 0.05).toFixed(0)); return o.join(" "); };

const words = readJson("edit/transcript.json");
const silences = exists("edit/silences.json") ? readJson("edit/silences.json") : [];
const segs = exists("edit/project.json") ? readJson("edit/project.json").segments : [{ in: 0, out: Infinity }];
const kept = (t) => segs.some((s) => t >= s.in && t <= s.out);
const speechRef = db(words[0]?.start ?? 0, words[Math.min(words.length - 1, 20)]?.end ?? 5);
console.log(`reference speech level ≈ ${speechRef.toFixed(1)} dB\n`);

console.log("1. UNTRANSCRIBED SPEECH (loud gaps between words)");
let n1 = 0;
for (let i = 1; i < words.length; i++) {
  const a = words[i - 1].end, b = words[i].start;
  if (b - a < 0.8 || !kept((a + b) / 2)) continue;
  const level = db(a, b);
  if (level > speechRef - 8) {
    n1++;
    console.log(`   ${a.toFixed(2)}–${b.toFixed(2)}  ${level.toFixed(1)} dB  after "${words[i - 1].text}" (#${i - 1}) before "${words[i].text}" (#${i})`);
  }
}
if (!n1) console.log("   none");

console.log("\n2. SILENCE OVER A WORD START (dB in 50 ms steps from 0.15s before the word)");
let n2 = 0;
for (const [s, e] of silences) {
  if (!kept((s + e) / 2)) continue;
  for (const [i, w] of words.entries()) {
    if (w.start > s + 0.03 && w.start < e - 0.08) {
      n2++;
      console.log(`   "${w.text}" (#${i}) @${w.start.toFixed(2)} in silence ${s.toFixed(2)}–${e.toFixed(2)}:  ${trail(w.start - 0.15, Math.min(e + 0.15, w.start + 0.6))}`);
    }
  }
}
if (!n2) console.log("   none");
