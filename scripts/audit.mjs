// Sanity checks between the transcript and the waveform, inside the kept segments of edit/project.json
// (or the whole recording when there is no project.json yet).
//   node <skill>/scripts/audit.mjs [--target 4.2]
// 1. UNTRANSCRIBED SPEECH — transcript gaps ≥ 0.8s that are loud: speech the ASR dropped
//    (e.g. Arabic "sallallahu alayhi wa sallam" inside German speech, a name, another language).
//    Keep it in the cut, and usually add a captionInserts entry for it.
// 2. SILENCE OVER A WORD START — a detected silence covering a word's start. Usually the ASR places
//    sentence-initial words ~0.3s early (safe to cut); if the dB trail shows speech, raise --noise in silences.mjs.
// 3. SPEECH RATE — syllables per second once pauses are cut, and the speed-up that would bring it to
//    --target (default 4.2 syl/s ≈ 155 wpm in English). A heuristic: suggest it, never apply it silently,
//    and never speed up recitation.
import { args, exists, p, readJson, readWav, syllables } from "./lib.mjs";

const wav = readWav(p("edit/main.wav"));
const db = wav.rms;
const trail = (a, b) => { const o = []; for (let t = a; t < b; t += 0.05) o.push(db(t, t + 0.05).toFixed(0)); return o.join(" "); };

const words = readJson("edit/transcript.json");
const silences = exists("edit/silences.json") ? readJson("edit/silences.json") : [];
const project = exists("edit/project.json") ? readJson("edit/project.json") : null;
const segs = project?.segments ?? [{ in: 0, out: wav.duration }];
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

console.log("\n3. SPEECH RATE (kept segments, pauses cut as build.mjs would)");
const sil = { minGap: 0.3, keepAfter: 0.15, keepBefore: 0.1, ...(project?.silence || {}) };
const keptWords = words.filter((w) => kept((w.start + w.end) / 2));
const segTime = segs.reduce((s, x) => s + Math.max(0, Math.min(x.out, wav.duration) - x.in), 0);
const cutTime = project?.silence === false ? 0 : silences.reduce((s, [a, e]) =>
  s + (kept((a + e) / 2) && e - a >= sil.minGap ? Math.max(0, e - a - sil.keepAfter - sil.keepBefore) : 0), 0);
const speak = segTime - cutTime;
if (keptWords.length && speak > 1) {
  const sps = keptWords.reduce((s, w) => s + syllables(w.text), 0) / speak;
  const target = Number(args.target ?? 4.2);
  const speed = Math.min(1.15, Math.max(1, target / sps));
  console.log(`   ${(keptWords.length / speak * 60).toFixed(0)} wpm · ${sps.toFixed(2)} syllables/s over ${speak.toFixed(1)} s of speech`);
  console.log(speed < 1.03
    ? "   no speed-up needed"
    : `   suggested: prep.mjs --speed ${speed.toFixed(2)} (target ${target} syl/s, capped at 1.15) — ask first; keep 1.0 if the clip contains recitation`);
}
