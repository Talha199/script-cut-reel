// Word-level transcript of the RAW main audio → edit/transcript.json [{text,start,end}]
//   node <skill>/scripts/transcribe.mjs [--language de] [--engine parakeet|whisper]
// Parakeet TDT v3 (install once: npx -y hyperframes@0.8 models install parakeet) handles 25 European
// languages incl. German. The whisper models the CLI lists are mostly English-only (*.en).
import fs from "node:fs";
import { args, exists, HF, hyperframes, p, readJson, writeJson } from "./lib.mjs";

if (!exists("edit/main.wav")) throw new Error("edit/main.wav missing — run prep.mjs --main <video> first");
fs.mkdirSync(p("edit/asr"), { recursive: true });
const engine = typeof args.engine === "string" ? args.engine : "parakeet";
const lang = typeof args.language === "string" ? ["--language", args.language] : [];
const r = hyperframes(["transcribe", p("edit/main.wav"), "-d", p("edit/asr"), "--engine", engine, ...lang, "--json"],
  { stdio: ["ignore", "pipe", "inherit"] });
let result = null;
const out = (r.stdout ?? "").trim();
for (const chunk of [out, out.split(/\r?\n/).at(-1)]) { try { result = JSON.parse(chunk); break; } catch {} }
if (r.status !== 0 || result?.ok === false || !exists("edit/asr/transcript.json")) {
  console.error(`transcription failed: ${result?.error ?? (out.slice(-600) || r.error?.message || `exit ${r.status}`)}`);
  if (/not installed/i.test(result?.error ?? "")) console.error(`install the model once (~640 MB): npx -y ${HF} models install ${engine}`);
  process.exit(1);
}
const words = readJson("edit/asr/transcript.json").map(({ text, start, end }) => ({ text, start, end }));
writeJson("edit/transcript.json", words);
// build.mjs uses the language as the default `lang` (Turkish İ casing, quote style) and warns on a mismatch.
writeJson("edit/transcribe.json", { language: typeof args.language === "string" ? args.language : null, engine });
console.log(`${words.length} words → edit/transcript.json   (next: node scripts/lines.mjs)`);
