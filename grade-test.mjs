// Renders one frame of the raw video with several colour grades side by side → edit/grade-test.png
//   node <skill>/scripts/grade-test.mjs --main <raw.mp4> [--at 30] [--grades "eq=gamma=1.18:brightness=0.02:saturation=1.05|eq=gamma=1.3:brightness=0.03"]
// The first panel is always the original. Pass the chosen grade to prep.mjs --grade.
import { execFileSync } from "node:child_process";
import { args, p } from "./lib.mjs";

if (typeof args.main !== "string") throw new Error("--main <raw video> required");
const grades = (typeof args.grades === "string" ? args.grades : "eq=gamma=1.12:brightness=0.01:saturation=1.04|eq=gamma=1.18:brightness=0.02:saturation=1.05|eq=gamma=1.30:brightness=0.03:saturation=1.06").split("|");
const n = grades.length + 1;
const chains = grades.map((g, i) => `[s${i + 1}]${g}[g${i + 1}]`).join(";");
const graph = `[0:v:0]trim=end_frame=1,scale=-2:960,split=${n}${Array.from({ length: n }, (_, i) => `[s${i}]`).join("")};${chains};[s0]${grades.map((_, i) => `[g${i + 1}]`).join("")}hstack=${n}[o]`;
execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-ss", String(args.at ?? 30), "-i", args.main,
  "-filter_complex", graph, "-map", "[o]", "-frames:v", "1", "-update", "1", p("edit/grade-test.png")], { stdio: "inherit" });
console.log(`edit/grade-test.png — panels: original | ${grades.join(" | ")}`);
