// Checks that this machine can run the skill — Node, ffmpeg with every filter the scripts use, the
// HyperFrames CLI and its browser, the transcription model — and says how to fix what's missing.
//   node <skill>/scripts/doctor.mjs [--skip-model]
// Exit code 1 if something required is missing. Then `selftest.mjs` runs the whole pipeline.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { args, gpuEncoder, HF, hasFilter, hyperframes } from "./lib.mjs";

let failed = false;
const ok = (m) => console.log(`✓ ${m}`);
const warn = (m) => console.log(`! ${m}`);
const fail = (m, fix) => { failed = true; console.log(`✗ ${m}${fix ? `\n    → ${fix}` : ""}`); };

// Node
const major = Number(process.versions.node.split(".")[0]);
// The skill's own scripts run on 18+, but the HyperFrames CLI refuses anything below 22.
major >= 22 ? ok(`Node ${process.versions.node}`) : fail(`Node ${process.versions.node} — HyperFrames needs ≥ 22`, "install Node 22 LTS or newer from nodejs.org (or nvm install 22)");

// ffmpeg / ffprobe
const FFMPEG_FIX = "Windows: winget install Gyan.FFmpeg · macOS: brew install ffmpeg · Debian/Ubuntu: sudo apt install ffmpeg";
let haveFfmpeg = true;
for (const bin of ["ffmpeg", "ffprobe"]) {
  const r = spawnSync(bin, ["-version"], { encoding: "utf8" });
  if (r.error || r.status !== 0) { fail(`${bin} not found on PATH`, FFMPEG_FIX); haveFfmpeg = false; }
  else ok(r.stdout.split(/\r?\n/)[0].replace(/ Copyright.*/, ""));
}
if (haveFfmpeg) {
  const required = ["silencedetect", "volumedetect", "loudnorm", "atempo", "afade", "aecho", "aeval", "aevalsrc", "anoisesrc",
    "asendcmd", "bandpass", "lowpass", "highpass", "afftdn", "deesser", "acompressor", "asoftclip", "amerge", "pan", "apad",
    "concat", "scale", "crop", "pad", "fps", "setsar", "setparams", "eq", "hstack", "split", "trim"];
  const missing = required.filter((f) => !hasFilter(f));
  missing.length ? fail(`ffmpeg lacks filters: ${missing.join(", ")}`, `ffmpeg is too old or minimal (needs ≥ 5.1). ${FFMPEG_FIX}`) : ok(`ffmpeg has all ${required.length} filters the scripts use`);
  hasFilter("zscale") && hasFilter("tonemap") ? ok("zscale + tonemap (iPhone HDR → SDR)")
    : warn("no zscale/tonemap — HDR phone video can't be tone-mapped and will look grey. A full build has them: " + FFMPEG_FIX);
  const enc = spawnSync("ffmpeg", ["-hide_banner", "-encoders"], { encoding: "utf8" }).stdout ?? "";
  const gpu = gpuEncoder();
  gpu ? ok(`GPU video encoder ${gpu} (render.mjs uses it: encoding ~2.5× faster)`) : warn("no hardware H.264 encoder found — renders encode on the CPU (slower, same result)");
  for (const e of ["libx264", "aac"]) new RegExp(`\\s${e}\\s`).test(enc) ? ok(`encoder ${e}`) : fail(`ffmpeg has no ${e} encoder`, FFMPEG_FIX);
}

// HyperFrames CLI (+ its own checks: browser, memory)
const doc = hyperframes(["doctor", "--json"], { stdio: ["ignore", "pipe", "ignore"] });
let checks = null;
try { checks = JSON.parse(doc.stdout).checks; } catch {}
if (!checks) fail(`npx -y ${HF} doesn't run`, "needs npm/npx (comes with Node) and internet access on first use");
else {
  const c = (name) => checks.find((x) => x.name === name);
  ok(`HyperFrames ${c("Version")?.detail ?? "?"}`);
  c("Chrome")?.ok ? ok("HyperFrames browser (headless Chrome)") : fail("HyperFrames browser missing", `npx -y ${HF} browser ensure   (may hang after finishing — see gotchas)`);
  // Whisper (Turkish, Arabic, any non-European language): whisper.cpp is compiled on first use.
  if (c("whisper-cpp")?.ok) ok("whisper.cpp (Turkish and other non-Parakeet languages)");
  else {
    const has = (bin) => spawnSync(bin, ["--version"], { encoding: "utf8", shell: process.platform === "win32" }).status === 0;
    const tools = ["git", "cmake"].map((b) => `${b} ${has(b) ? "✓" : "✗"}`).join(", ");
    warn(`whisper.cpp not built yet — only needed for Turkish/Arabic/other non-European speech. It builds on first use and needs git, cmake and a C++ compiler (${tools}${process.platform === "win32" ? "; compiler: Visual Studio Build Tools" : ""})`);
  }
  const mem = /([\d.]+) GB available/.exec(c("Memory")?.detail ?? "");
  if (mem) Number(mem[1]) < 2 ? warn(`only ${mem[1]} GB RAM free — render with --workers 1–2`) : ok(`${mem[1]} GB RAM free`);
}

// Transcription model: transcribe one second of silence and look at the answer.
if (!args["skip-model"] && checks && haveFfmpeg) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scr-doctor-"));
  const wav = path.join(dir, "silence.wav");
  spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "anullsrc=r=16000:cl=mono", "-t", "1", wav]);
  const r = hyperframes(["transcribe", wav, "-d", dir, "--engine", "parakeet", "--json"], { stdio: ["ignore", "pipe", "ignore"] });
  const text = r.stdout ?? "";
  /not installed/i.test(text) ? fail("Parakeet transcription model not installed", `npx -y ${HF} models install parakeet   (~640 MB, once)`)
    : r.status === 0 ? ok("Parakeet transcription model") : warn(`transcription test inconclusive (exit ${r.status}) — run transcribe.mjs once to see`);
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(failed ? "\nNot ready — fix the ✗ lines above." : "\nReady. Next: node selftest.mjs (add --render for a full render test).");
process.exit(failed ? 1 : 0);
