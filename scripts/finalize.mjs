// Delivery pass on a rendered MP4: two-pass loudness normalisation of the finished mix (the sources were
// only normalised one by one), video stream copied untouched, faststart — plus a QA report that
// package.mjs reads.
//   node <skill>/scripts/finalize.mjs out/reel.mp4 [--out out/reel.final.mp4] [--lufs -14] [--tp -1]
// No platform publishes a loudness target; −14 LUFS / −1 dBTP is the common short-form practice and
// keeps a Reel as loud as the ones around it. --lufs -16 for a quieter, more conservative master.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { args, exists, ff, p, probe, readJson } from "./lib.mjs";

const input = args._[0] ? path.resolve(args._[0]) : null;
if (!input || !fs.existsSync(input)) throw new Error("usage: finalize.mjs <rendered.mp4> [--out file] [--lufs -14] [--tp -1]");
const output = path.resolve(typeof args.out === "string" ? args.out : input.replace(/(\.final)?\.mp4$/i, ".final.mp4"));
if (output === input) throw new Error("--out must differ from the input");
const I = Number(args.lufs ?? -14), TP = Number(args.tp ?? -1), LRA = 11;

const measure = (file, af) => {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-map", "0:a:0", "-af", af, "-f", "null", "-"], { encoding: "utf8" });
  const json = r.stderr.slice(r.stderr.lastIndexOf("{"), r.stderr.lastIndexOf("}") + 1);
  if (!json) throw new Error(`loudnorm measurement failed:\n${r.stderr.slice(-800)}`);
  return JSON.parse(json);
};

const m1 = measure(input, `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}:print_format=json`);
console.log(`measured: ${m1.input_i} LUFS · ${m1.input_tp} dBTP · LRA ${m1.input_lra}`);
ff(["-i", input, "-map", "0:v:0", "-map", "0:a:0", "-c:v", "copy",
  "-af", `loudnorm=I=${I}:TP=${TP}:LRA=${LRA}:measured_I=${m1.input_i}:measured_TP=${m1.input_tp}:measured_LRA=${m1.input_lra}:measured_thresh=${m1.input_thresh}:offset=${m1.target_offset}:linear=true`,
  "-c:a", "aac", "-b:a", "192k", "-ar", "48000", "-ac", "2", "-movflags", "+faststart", output]);

// ── QA ──
const info = probe(output);
const { v, a, avgFps, size } = info.raw;
const out = measure(output, `loudnorm=I=${I}:TP=${TP}:print_format=json`);
const qa = {
  file: path.relative(p(), output).replace(/\\/g, "/"),
  duration: +info.duration.toFixed(2),
  sizeMB: +(size / 1e6).toFixed(1),
  video: `${info.width}x${info.height} · ${info.fps} fps${Math.abs(info.fps - avgFps) > 0.01 ? ` (avg ${avgFps}: variable!)` : ""} · ${v.codec_name} ${v.profile ?? ""} · ${v.pix_fmt}`,
  color: `${v.color_space ?? "untagged"}/${v.color_primaries ?? "untagged"}/${v.color_transfer ?? "untagged"} · range ${v.color_range ?? "?"}`,
  audio: `${a.codec_name} · ${a.sample_rate} Hz · ${a.channels} ch`,
  loudness: +Number(out.input_i).toFixed(1),
  truePeak: +Number(out.input_tp).toFixed(1),
};
const timeline = exists("edit/timeline.json") ? readJson("edit/timeline.json") : null;
if (timeline) Object.assign(qa, {
  firstWord: timeline.firstWord, speed: timeline.speed,
  maxCaptionCps: Math.max(0, ...timeline.captions.map((c) => c.cps ?? 0)),
});
const issues = [];
if (timeline?.guides) issues.push("rendered WITH --guides overlays — rebuild without --guides and render again");
if (info.height > info.width && (info.width !== 1080 || info.height !== 1920)) issues.push(`portrait but ${info.width}x${info.height} (expected 1080x1920)`);
if (info.duration > 180) issues.push("longer than 3:00 — not recommended by Instagram");
if (!/bt709/.test(qa.color)) issues.push(`colour not tagged BT.709 (${qa.color})`);
if (v.codec_name !== "h264") issues.push(`video codec ${v.codec_name} — H.264 is the safe upload codec`);
if (Math.abs(qa.loudness - I) > 1) issues.push(`loudness ${qa.loudness} LUFS, target ${I}`);
if (qa.truePeak > TP + 0.5) issues.push(`true peak ${qa.truePeak} dBTP over ${TP}`);
qa.issues = issues;
const qaFile = output.replace(/\.mp4$/i, ".qa.json");
fs.writeFileSync(qaFile, JSON.stringify(qa, null, 2) + "\n");
console.log(`\n${qa.file} · ${qa.duration}s · ${qa.sizeMB} MB\n  ${qa.video}\n  colour ${qa.color}\n  ${qa.audio} · ${qa.loudness} LUFS · ${qa.truePeak} dBTP`);
console.log(issues.length ? issues.map((x) => `! ${x}`).join("\n") : "QA ok");
