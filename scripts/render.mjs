// Renders the project with the fastest settings this machine supports, then runs finalize + package.
//   node <skill>/scripts/render.mjs [--project <dir>] [--name reel] [--draft] [--workers auto|N] [--no-gpu]
// - workers: auto — HyperFrames calibrates per machine (4 on an 8-core/16 GB PC). A fixed 2 left most
//   of the CPU idle.
// - GPU encoding (NVENC / VideoToolbox / Quick Sync) when one actually works: encoding ~2.5× faster.
// - Never overwrites an earlier export: out/<name>.mp4, then <name>-2.mp4, … ; --draft writes a quick
//   preview (out/<name>-draft.mp4, lower quality, no finalize/package).
// - Refuses a build that still carries the --guides overlay.
// Capture (one browser screenshot per frame) dominates the time and doesn't scale much further:
// expect ~25 frames/s for clean frames, ~8 for grainy footage on a mid-range desktop.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { args, exists, gpuEncoder, hyperframes, p, readJson, root } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
if (!exists("index.html") || !exists("edit/timeline.json")) throw new Error("no build yet — run build.mjs first");
const timeline = readJson("edit/timeline.json");
if (timeline.guides) throw new Error("index.html still has the --guides overlay — run build.mjs without --guides first");

const name = typeof args.name === "string" ? args.name : "reel";
fs.mkdirSync(p("out"), { recursive: true });
let out = p("out", args.draft ? `${name}-draft.mp4` : `${name}.mp4`);
for (let i = 2; !args.draft && fs.existsSync(out); i++) out = p("out", `${name}-${i}.mp4`);

const gpu = args["no-gpu"] ? null : gpuEncoder();
const flags = ["render", root, "-o", out, "--fps", "30", "--quality", args.draft ? "draft" : "high",
  "--workers", typeof args.workers === "string" ? args.workers : "auto", ...(gpu ? ["--gpu"] : [])];
console.log(`rendering ${path.relative(root, out)} · ${timeline.total.toFixed(1)} s · workers ${flags[flags.indexOf("--workers") + 1]} · ${gpu ? `GPU encode (${gpu})` : "CPU encode"}`);
const t0 = Date.now();
const r = hyperframes(flags, { stdio: ["ignore", "pipe", "pipe"] });
const log = `${r.stdout}${r.stderr}`.replace(/\x1b\[[0-9;]*m/g, "");
if (r.status !== 0 || !fs.existsSync(out)) {
  console.error(log.split(/\r?\n/).filter((l) => /✗|error|failed/i.test(l)).slice(-12).join("\n") || log.slice(-2000));
  process.exit(1);
}
const secs = (Date.now() - t0) / 1000;
console.log(`rendered in ${secs.toFixed(0)} s (${(timeline.total / secs).toFixed(2)}× realtime)  ${(log.match(/(beginframe|screenshot) capture[^\n]*/) ?? [""])[0].trim()}`);
if (args.draft) process.exit(0);

for (const [script, file] of [["finalize.mjs", out], ["package.mjs", out.replace(/\.mp4$/, ".final.mp4")]]) {
  const s = spawnSync(process.execPath, [path.join(HERE, script), file, "--project", root], { stdio: "inherit", cwd: root });
  if (s.status !== 0) process.exit(s.status ?? 1);
}
