// Word-level transcript of the RAW main audio → edit/transcript.json [{text,start,end}]
//   node <skill>/scripts/transcribe.mjs --language de|tr|en|… [--engine parakeet|whisper] [--model large-v3]
// The engine follows the language:
// - Parakeet TDT 0.6B v3 for its 25 European languages (German WER ≈ 5 % on FLEURS, fast, precise word
//   times). Install once: npx -y hyperframes@0.8 models install parakeet (~640 MB).
// - Whisper large-v3 for everything else — Turkish and Arabic among them; Parakeet has neither. The
//   HyperFrames default Whisper model (small.en) is English-only, so the model is always set here.
//   First use builds whisper.cpp and downloads the model (~3 GB).
// Neither reliably transcribes Arabic phrases inside German or Turkish speech — audit.mjs finds them.
import fs from "node:fs";
import { args, exists, HF, hyperframes, p, readJson, writeJson } from "./lib.mjs";

const PARAKEET = ["bg", "hr", "cs", "da", "nl", "en", "et", "fi", "fr", "de", "el", "hu", "it", "lv", "lt", "mt", "pl", "pt", "ro", "sk", "sl", "es", "sv", "ru", "uk"];

if (!exists("edit/main.wav")) throw new Error("edit/main.wav missing — run prep.mjs --main <video> first");
if (typeof args.language !== "string") throw new Error("--language is required (de, tr, en, …): it picks the engine and the caption language");
const language = args.language.toLowerCase();
const engine = typeof args.engine === "string" ? args.engine : PARAKEET.includes(language.slice(0, 2)) ? "parakeet" : "whisper";
if (engine === "parakeet" && !PARAKEET.includes(language.slice(0, 2))) throw new Error(`Parakeet doesn't cover "${language}" — use --engine whisper`);
const model = engine === "whisper" ? (typeof args.model === "string" ? args.model : language === "en" ? "medium.en" : "large-v3") : null;
if (model && model.endsWith(".en") && language !== "en") throw new Error(`${model} is English-only — use --model large-v3 for "${language}"`);
console.log(`transcribing (${language}) with ${engine}${model ? ` ${model}` : ""}…`);

fs.mkdirSync(p("edit/asr"), { recursive: true });
const r = hyperframes(["transcribe", p("edit/main.wav"), "-d", p("edit/asr"), "--engine", engine, ...(model ? ["--model", model] : []),
  "--language", language, "--json"], { stdio: ["ignore", "pipe", "inherit"] });
let result = null;
const out = (r.stdout ?? "").trim();
for (const chunk of [out, out.split(/\r?\n/).at(-1)]) { try { result = JSON.parse(chunk); break; } catch {} }
if (r.status !== 0 || result?.ok === false || !exists("edit/asr/transcript.json")) {
  console.error(`transcription failed: ${result?.error ?? (out.slice(-600) || r.error?.message || `exit ${r.status}`)}`);
  if (engine === "parakeet" && /not installed/i.test(result?.error ?? "")) console.error(`install the model once (~640 MB): npx -y ${HF} models install parakeet`);
  if (engine === "whisper") console.error("whisper.cpp is built on first use and needs git + cmake + a C++ compiler (Windows: Visual Studio Build Tools); run node doctor.mjs");
  process.exit(1);
}
const words = readJson("edit/asr/transcript.json").map(({ text, start, end }) => ({ text, start, end }));
writeJson("edit/transcript.json", words);
// build.mjs uses the language as the default `lang` (Turkish İ casing, quote style) and warns on a mismatch.
writeJson("edit/transcribe.json", { language, engine, model });
console.log(`${words.length} words → edit/transcript.json   (next: node scripts/lines.mjs)`);
