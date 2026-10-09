// Prints edit/transcript.json as readable lines (split at pauses) with RAW timestamps and word
// indices, so takes can be compared against the script and cut points chosen.
//   node <skill>/scripts/lines.mjs [--pause 0.35]
import { args, readJson } from "./lib.mjs";

const words = readJson("edit/transcript.json");
const pause = Number(args.pause ?? 0.35);

let line = [];
const flush = () => {
  if (!line.length) return;
  const a = line[0], b = line[line.length - 1];
  console.log(`[${a.i}-${b.i}] ${a.start.toFixed(2)}–${b.end.toFixed(2)}  ${line.map((w) => w.text).join(" ")}`);
  line = [];
};
words.forEach((w, i) => {
  const prev = words[i - 1];
  if (prev && w.start - prev.end > pause) {
    flush();
    console.log(`        · ${(w.start - prev.end).toFixed(2)}s pause`);
  }
  line.push({ ...w, i });
});
flush();
