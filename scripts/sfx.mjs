// Generates the default sound effects into <project>/assets/sfx/ — synthesised with ffmpeg, so they
// are ours (no licence, no attribution, nothing to download) and built for calm content: air and
// low end, no tones or instruments.
//   node <skill>/scripts/sfx.mjs [--project <dir>] [--audition]
//   whoosh.wav  0.5 s  air whoosh sweeping left → right, peak ≈ 0.30 s   (punch-ins, title entrance)
//   swell.wav   1.0 s  soft wide swell, peak ≈ 0.60 s                    (quote cards)
//   thump.wav   0.6 s  low soft thump (audible on phones), peak at the start                (hook landing, opt-in)
// All are peak-normalised to −6 dBFS; build.mjs sets the level under the voice and finds each
// file's peak itself, so your own files (see "sfx" in project-schema.md) line up the same way.
// --audition also writes out/sfx-audition.wav: each effect three times at the level build.mjs uses.
// setup.mjs runs this.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { args, ff, p } from "./lib.mjs";

const RATE = 48000;
fs.mkdirSync(p("assets/sfx"), { recursive: true });

// Filter frequency over time as asendcmd steps every 10 ms (small enough steps to be inaudible).
const sweep = (target, dur, fn) => {
  const cmds = [];
  for (let t = 0; t <= dur + 1e-9; t += 0.01) cmds.push(`${t.toFixed(2)} ${target} f ${Math.round(fn(t / dur))}`);
  return `asendcmd=c='${cmds.join(";")}'`;
};
// Rises from a to peak (at x = at), falls to b; x in 0…1.
const bell = (x, a, peak, b, at) => x < at
  ? a + (peak - a) * Math.sin((x / at) * Math.PI / 2) ** 2
  : b + (peak - b) * Math.cos(((x - at) / (1 - at)) * Math.PI / 2) ** 2;

const recipes = {
  whoosh: {
    dur: 0.5,
    graph: (d) => `anoisesrc=color=pink:duration=${d}:sample_rate=${RATE}:amplitude=0.9:seed=7,` +
      `${sweep("bandpass@bp", d, (x) => bell(x, 350, 2300, 700, 0.6))},bandpass@bp=f=350:width_type=q:w=1.4,` +
      `afade=t=in:d=0.30:curve=hsin,afade=t=out:st=0.30:d=0.20:curve=hsin,` +
      `pan=stereo|c0=c0|c1=c0,aeval='val(0)*(1-0.6*t/${d})|val(1)*(0.4+0.6*t/${d})':c=same,` +
      `aecho=0.8:0.6:35|70:0.22|0.12`,
  },
  swell: {
    dur: 1.0,
    graph: (d) => `anoisesrc=color=pink:duration=${d}:sample_rate=${RATE}:amplitude=0.9:seed=11[l];` +
      `anoisesrc=color=pink:duration=${d}:sample_rate=${RATE}:amplitude=0.9:seed=29[r];[l][r]amerge=inputs=2,` +
      `${sweep("lowpass@lp", d, (x) => bell(x, 250, 1500, 400, 0.6))},lowpass@lp=f=250,highpass=f=90,` +
      `afade=t=in:d=0.60:curve=hsin,afade=t=out:st=0.60:d=0.40:curve=hsin,aecho=0.8:0.7:60|110:0.25|0.15`,
  },
  thump: {
    dur: 0.6,
    // pitch falls 130 → 55 Hz with a soft 2.5 ms attack; tanh saturation adds the harmonics that let
    // phone speakers (nothing below ~150 Hz) still hear it
    graph: (d) => `aevalsrc='1.6*sin(2*PI*(55*t+75/14*(1-exp(-14*t))))*exp(-8*t)*(1-exp(-400*t))':s=${RATE}:d=${d},` +
      `asoftclip=type=tanh,lowpass=f=600,pan=stereo|c0=c0|c1=c0`,
  },
};

const maxVolume = (file) => {
  const r = spawnSync("ffmpeg", ["-hide_banner", "-i", file, "-af", "volumedetect", "-f", "null", "-"], { encoding: "utf8" });
  return Number(/max_volume: ([-\d.]+) dB/.exec(r.stderr)?.[1] ?? 0);
};

for (const [name, r] of Object.entries(recipes)) {
  const raw = p(`assets/sfx/${name}.raw.wav`), out = p(`assets/sfx/${name}.wav`);
  ff(["-filter_complex", r.graph(r.dur), "-ac", "2", "-ar", String(RATE), "-c:a", "pcm_s16le", raw]);
  ff(["-i", raw, "-af", `volume=${(-6 - maxVolume(raw)).toFixed(2)}dB`, "-c:a", "pcm_s16le", out]);
  fs.rmSync(raw);
}
console.log(`assets/sfx: ${Object.keys(recipes).map((n) => `${n}.wav`).join(", ")}`);

if (args.audition) {
  // Same gains as build.mjs defaults: whoosh 0.22, swell 0.28, thump 0.5 — each three times, 1.2 s apart.
  fs.mkdirSync(p("out"), { recursive: true });
  const order = [["whoosh", 0.22], ["swell", 0.28], ["thump", 0.5]];
  const inputs = order.flatMap(([n]) => ["-i", p(`assets/sfx/${n}.wav`)]);
  const parts = order.map(([, g], i) => `[${i}:a]volume=${g},apad=pad_dur=0.7,asplit=3[a${i}0][a${i}1][a${i}2]`);
  const seq = order.flatMap((_, i) => [0, 1, 2].map((k) => `[a${i}${k}]`)).join("");
  ff([...inputs, "-filter_complex", `${parts.join(";")};${seq}concat=n=${order.length * 3}:v=0:a=1[o]`, "-map", "[o]", "-c:a", "pcm_s16le", p("out/sfx-audition.wav")]);
  console.log("out/sfx-audition.wav — whoosh ×3, swell ×3, thump ×3 at mix level");
}
