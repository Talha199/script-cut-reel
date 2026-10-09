// Word-level transcript of the RAW main audio → edit/transcript.json [{text,start,end}]
//   node <skill>/scripts/transcribe.mjs [--language de] [--engine parakeet|whisper]
// Parakeet TDT v3 (install once: npx hyperframes models install parakeet) handles 25 European
// languages incl. German. The whisper models the CLI lists are mostly English-only (*.en).
import { execSync } from "node:child_process";
import fs from "node:fs";
import { args, exists, p, readJson, writeJson } from "./lib.mjs";

if (!exists("edit/main.wav")) throw new Error("edit/main.wav missing — run prep.mjs --main <video> first");
fs.mkdirSync(p("edit/asr"), { recursive: true });
const engine = typeof args.engine === "string" ? args.engine : "parakeet";
const lang = typeof args.language === "string" ? ` --language ${args.language}` : "";
execSync(`npx -y hyperframes@latest transcribe "${p("edit/main.wav")}" -d "${p("edit/asr")}" --engine ${engine}${lang} --json`, {
  stdio: ["ignore", "inherit", "inherit"], shell: true,
});
const words = readJson("edit/asr/transcript.json").map(({ text, start, end }) => ({ text, start, end }));
writeJson("edit/transcript.json", words);
console.log(`${words.length} words → edit/transcript.json   (next: node scripts/lines.mjs)`);
