// End-to-end self-test on synthetic media, in a temp folder whose path has a space and an umlaut:
// setup → prep (HDR tone-map, crop, voice cleanup, music, bundled intro) → silences → audit → build (hook,
// title, quote card, punch-ins, protected span, glossary, emphasis, sound effects) → lint; with
// --render also render.mjs (render → finalize → package). No transcription model needed: the transcript is
// synthetic. Needs internet on the first run (fonts, GSAP, HyperFrames).
//   node <skill>/scripts/selftest.mjs [--render] [--keep]
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { args, hyperframes } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scr selftest ü-"));
const P = (...x) => path.join(dir, ...x);
const json = (...x) => JSON.parse(fs.readFileSync(P(...x), "utf8"));
const results = [];
let failed = false;

function step(name, fn) {
  if (failed) return results.push(["–", name, "skipped"]);
  try { const note = fn(); results.push(["✓", name, note ?? ""]); console.log(`✓ ${name}${note ? ` — ${note}` : ""}`); }
  catch (e) { failed = true; results.push(["✗", name, e.message]); console.log(`✗ ${name}\n${e.message}`); }
}
const run = (script, ...a) => {
  const r = spawnSync(process.execPath, [path.join(HERE, script), "--project", dir, ...a], { encoding: "utf8", cwd: dir });
  if (r.status !== 0) throw new Error(`${script} exited ${r.status}\n${(r.stderr || r.stdout).slice(-1500)}`);
  return r.stdout + r.stderr;
};
const ffmpeg = (...a) => {
  const r = spawnSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...a], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg ${a.join(" ").slice(0, 200)}\n${r.stderr}`);
};
const probe = (file) => JSON.parse(spawnSync("ffprobe", ["-v", "error", "-show_entries",
  "stream=codec_type,width,height,color_transfer,color_primaries,color_space", "-of", "json", file], { encoding: "utf8" }).stdout).streams;
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };

console.log(`self-test in ${dir}\n`);

step("synthetic media", () => {
  // 12 s portrait clip tagged as iPhone HLG, with three speech-like bursts over a little room noise
  ffmpeg("-f", "lavfi", "-i", "testsrc2=s=720x1280:r=30:d=12",
    "-f", "lavfi", "-i", "aevalsrc='0.25*sin(2*PI*180*t)*sin(2*PI*3*t)*(between(t,0.4,3.0)+between(t,4.0,6.6)+between(t,7.6,10.2))+0.002*(random(0)-0.5)':s=48000:d=12",
    "-vf", "setparams=color_primaries=bt2020:color_trc=arib-std-b67:colorspace=bt2020nc", "-c:v", "libx264", "-pix_fmt", "yuv420p",
    "-x264-params", "colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc", "-c:a", "aac", "-shortest", P("raw clip.mp4"));
  ffmpeg("-f", "lavfi", "-i", "sine=f=220:d=20", "-c:a", "aac", P("music.m4a"));
  expect(probe(P("raw clip.mp4"))[0].color_transfer === "arib-std-b67", "test clip did not get its HLG tag");
});

step("setup.mjs", () => { run("setup.mjs"); expect(fs.existsSync(P("assets/vendor/gsap.min.js")) && fs.existsSync(P("assets/sfx/whoosh.wav")), "fonts/GSAP/sfx missing"); });

step("prep.mjs (HDR, crop, --clean, bundled intro, music)", () => {
  const out = run("prep.mjs", "--main", P("raw clip.mp4"), "--intro", "hutbe", "--music", P("music.m4a"), "--clean");
  const m = json("edit/media.json");
  const [v] = probe(P("assets/main.mp4"));
  expect(v.width === 1080 && v.height === 1920, `main is ${v.width}x${v.height}`);
  expect(v.color_primaries === "bt709" && v.color_transfer === "bt709", `main tagged ${v.color_primaries}/${v.color_transfer}`);
  expect(probe(P("assets/intro.mp4"))[0].height === 1920, "intro not on canvas");
  expect(m.intro.bundled === "hutbe" && m.intro.hasAudio === false, `bundled intro: ${JSON.stringify({ bundled: m.intro.bundled, hasAudio: m.intro.hasAudio })}`);
  return m.main.tonemapped ? "HDR tone-mapped" : (out.match(/! .*zscale.*/)?.[0] ?? "HDR NOT tone-mapped");
});

step("silences.mjs", () => { run("silences.mjs"); const s = json("edit/silences.json"); expect(s.length >= 2, `${s.length} silences`); return `${s.length} silences`; });

step("transcript + project", () => {
  const bursts = [[0.4, "warum hört allah jedes Gebet?"], [4.0, "Allah sagt: Ich bin nahe."], [7.6, "Schick das jemandem, der es braucht."]];
  const words = [];
  for (const [t0, s] of bursts) { const ws = s.split(" "), st = 2.5 / ws.length; ws.forEach((w, i) => words.push({ text: w, start: +(t0 + i * st).toFixed(2), end: +(t0 + i * st + st * 0.85).toFixed(2) })); }
  fs.writeFileSync(P("edit/transcript.json"), JSON.stringify(words));
  fs.writeFileSync(P("edit/transcribe.json"), JSON.stringify({ language: "de", engine: "selftest" }));
  fs.writeFileSync(P("edit/glossary.json"), JSON.stringify({ allah: "Allah", warum: "Warum" }));
  fs.writeFileSync(P("edit/project.json"), JSON.stringify({
    lang: "de",
    segments: [{ in: 0.3, out: 3.2 }, { in: 3.9, out: 10.4 }],
    hook: { text: "Warum Allah *jedes* Gebet hört" },
    title: { after: "hook", offset: 0.2, dur: 2, kicker: "Selbsttest · Çğışİ", title: "Das Bittgebet" },
    quotes: [{ src: 5.0, srcEnd: 6.6, source: "Test 1:1" }],
    protect: [{ in: 4.0, out: 6.7 }],
    captionEmphasis: [15],
    zoom: { minHold: 2 },
    sfx: { hook: true },
  }));
});

step("audit.mjs", () => { const out = run("audit.mjs"); expect(/SPEECH RATE/.test(out), "no speech-rate section"); });

step("build.mjs", () => {
  const out = run("build.mjs");
  const t = json("edit/timeline.json");
  expect(t.quotes.length === 1 && t.quotes[0].text === "Ich bin nahe.", `quote card: ${JSON.stringify(t.quotes)}`);
  expect(t.captions[0].text.startsWith("Warum hört Allah"), `glossary not applied: ${t.captions[0].text}`);
  const ic = t.clips.find((c) => c.kind === "intro");
  expect(ic && Math.abs(ic.start + ic.dur - t.clips.find((c) => c.seg === 1).start) < 0.02, `intro not placed after the hook segment: ${JSON.stringify(ic)}`);
  expect(/"v":0\.8\b/.test(fs.readFileSync(P("index.html"), "utf8")), "music doesn't come up under the silent intro");
  expect(t.sfx.length >= 2, `${t.sfx.length} sound effects placed`);
  expect(/lang="de"/.test(fs.readFileSync(P("index.html"), "utf8")), "html lang missing");
  return `${t.total.toFixed(1)} s · ${t.captions.length} captions · ${t.framing.length} framing changes · ${t.sfx.length} sfx${/^! /m.test(out) ? " · warnings (expected on synthetic media)" : ""}`;
});

step("hyperframes lint", () => {
  const r = hyperframes(["lint", dir], { stdio: ["ignore", "pipe", "pipe"] });
  const out = (r.stdout + r.stderr).replace(/\x1b\[[0-9;]*m/g, "");
  expect(/0 errors?/.test(out), out.slice(-1200));
  return (out.match(/\d+ errors?,? \d+ warnings?/) ?? ["ok"])[0];
});

if (args.render) {
  step("render.mjs (render → finalize → package)", () => {
    const out = run("render.mjs", "--name", "selftest");
    const qa = json("out/selftest.final.qa.json");
    expect(qa.issues.length === 0, qa.issues.join("; "));
    expect(fs.existsSync(P("out/selftest.publish.md")) && fs.existsSync(P("out/selftest.cover.jpg")), "publish package incomplete");
    const speed = out.match(/rendered in \d+ s \([^)]*\)/)?.[0] ?? "rendered";
    return `${speed} · ${/GPU encode/.test(out) ? "GPU" : "CPU"} encode · ${qa.loudness} LUFS · ${qa.color}`;
  });
}

console.log(`\n${failed ? "FAILED" : "PASSED"}: ${results.filter((r) => r[0] === "✓").length}/${results.length} steps${args.render ? "" : " (add --render for render/finalize/package)"}`);
if (failed || args.keep) console.log(`project kept: ${dir}`);
else fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed ? 1 : 0);
