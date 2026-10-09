// Renders one frame of the raw video with several colour grades side by side → edit/grade-test.png
//   node <skill>/scripts/grade-test.mjs --main <raw.mp4> [--at 30] [--tonemap mobius|reinhard|hable]
//        [--grades "eq=gamma=1.05:saturation=1.03|eq=gamma=1.12:brightness=0.01:saturation=1.04"]
// Panels: original | each grade. For HDR sources (iPhone HLG): naive SDR | tone-mapped | tone-mapped + each
// grade — prep.mjs always tone-maps first, so judge the grades against the tone-mapped panel. Pass the
// chosen grade (and --tonemap if not mobius) to prep.mjs.
import { execFileSync } from "node:child_process";
import { args, isHdr, p, probe, tonemapFilter } from "./lib.mjs";

if (typeof args.main !== "string") throw new Error("--main <raw video> required");
const info = probe(args.main);
const hdr = isHdr(info);
const op = typeof args.tonemap === "string" ? args.tonemap : "mobius";
const grades = (typeof args.grades === "string" ? args.grades : "eq=gamma=1.05:saturation=1.03|eq=gamma=1.10:brightness=0.01:saturation=1.04|eq=gamma=1.18:brightness=0.02:saturation=1.05").split("|");
const n = grades.length + 1;
const head = `[0:v:0]trim=end_frame=1,scale=-2:960,setsar=1` + (hdr ? `,split=2[raw][hdr];[raw]format=yuv420p[naive];[hdr]${tonemapFilter(info, op)}` : "");
const graph = `${head},split=${n}${Array.from({ length: n }, (_, i) => `[s${i}]`).join("")};` +
  grades.map((g, i) => `[s${i + 1}]${g}[g${i + 1}]`).join(";") +
  `;${hdr ? "[naive]" : ""}[s0]${grades.map((_, i) => `[g${i + 1}]`).join("")}hstack=${n + (hdr ? 1 : 0)}[o]`;
execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-ss", String(args.at ?? 30), "-i", args.main,
  "-filter_complex", graph, "-map", "[o]", "-frames:v", "1", "-update", "1", p("edit/grade-test.png")], { stdio: "inherit" });
console.log(`edit/grade-test.png — panels: ${hdr ? `naive SDR (what an untreated HLG clip looks like) | tone-mapped (${op}) | ` : "original | "}${grades.join(" | ")}`);
