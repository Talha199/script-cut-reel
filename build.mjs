// Builds <project>/index.html (the HyperFrames composition) from:
//   edit/media.json       — probed media (prep.mjs)
//   edit/transcript.json  — word timings of the RAW main video [{text,start,end}] (transcribe.mjs)
//   edit/silences.json    — optional, silent stretches in RAW time (silences.mjs)
//   edit/project.json     — the edit: kept segments, intro slot, music, title, captions (see references/project-schema.md)
// Writes index.html + edit/timeline.json. Then: npx hyperframes lint / snapshot / render (or preview → Export).
import { exists, p, readJson } from "./lib.mjs";
import fs from "node:fs";

const media = readJson("edit/media.json");
const project = readJson("edit/project.json");
const words = readJson("edit/transcript.json");

const FPS = 30;
const q = (t) => Math.round(t * FPS) / FPS; // frame-quantized seconds
const f = (t) => q(t).toFixed(4);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const W = media.main.canvas.width;
const H = media.main.canvas.height;
const portrait = H > W;
const theme = { accent: "#e6bf63", text: "#fbf8f1", ink: "8,16,13", ...(project.theme ?? {}) }; // ink = "r,g,b" of the scrims

// ── 1. Timeline: kept segments of the main video, intro slotted after `introAfter` ──
// All authored times (segments, words, refs, inserts) are RAW source seconds. The proxy in
// assets/main.mp4 may be sped up (media.main.speed), so media time = raw / speed.
const SP = media.main.speed ?? 1;

// Silence removal: each kept segment is split around silent stretches, leaving a short breath on
// either side so speech doesn't sound clipped. "silence": false in project.json turns it off.
const sil = { minGap: 0.25, keepAfter: 0.1, keepBefore: 0.08, ...(project.silence || {}) };
const silences = project.silence === false || !exists("edit/silences.json") ? [] : readJson("edit/silences.json");
function splitSegment(a, b) {
  const pieces = [];
  let cur = a;
  for (const [s, e] of silences) {
    if (e - s < sil.minGap || e <= a || s >= b) continue;
    const cutA = s <= a ? a : s + sil.keepAfter;
    const cutB = e >= b ? b : e - sil.keepBefore;
    if (cutB - cutA < 0.08 || cutA < cur) continue;
    if (cutA - cur > 0.12) pieces.push([cur, cutA]);
    cur = cutB;
  }
  if (b - cur > 0.12) pieces.push([cur, b]);
  return pieces;
}

const clips = [];
let t = 0;
let intro = null;
project.segments.forEach((seg, i) => {
  splitSegment(seg.in, seg.out).forEach(([a, b], k) => {
    const dur = q((b - a) / SP);
    clips.push({ id: `seg-${i}-${k}`, seg: i, kind: "main", start: q(t), dur, mediaStart: a / SP, srcIn: a, srcOut: b });
    t = q(t + dur);
  });
  if (media.intro && project.introAfter === i) {
    intro = { id: "intro", kind: "intro", start: q(t), dur: q(media.intro.duration) };
    clips.push(intro);
    t = q(t + intro.dur);
  }
});
const total = q(t);
const mainClips = clips.filter((c) => c.kind === "main");
const rawKept = project.segments.reduce((s, x) => s + x.out - x.in, 0);
console.log(`segments ${rawKept.toFixed(1)}s raw → ${mainClips.reduce((s, c) => s + c.dur, 0).toFixed(1)}s after silence removal + ${SP}x`);

// Raw source time → composition time. Times inside a removed pause snap to the nearest kept piece
// of the same segment; times outside every kept segment return null.
function nearestClip(src) {
  const segIdx = project.segments.findIndex((s) => src >= s.in - 1e-6 && src <= s.out + 1e-6);
  if (segIdx < 0) return null;
  let best = null, bestD = Infinity;
  for (const c of mainClips) {
    if (c.seg !== segIdx) continue;
    const d = src < c.srcIn ? c.srcIn - src : src > c.srcOut ? src - c.srcOut : 0;
    if (d < bestD) (best = c), (bestD = d);
  }
  return best;
}
const mapIn = (c, src) => c.start + (Math.min(Math.max(src, c.srcIn), c.srcOut) - c.srcIn) / SP;
function toTimeline(src) {
  const c = nearestClip(src);
  return c ? q(mapIn(c, src)) : null;
}

// ── 2. Caption words: keep words inside kept segments, remap to timeline ──
const fixes = project.captionFixes ?? {}; // { "<word index>": "corrected text" | "" (drop) }
// captionInserts: words the ASR missed (e.g. an Arabic salawat inside German speech), in RAW time
const srcWords = [...words.map((w, i) => ({ ...w, text: fixes[i] ?? w.text })), ...(project.captionInserts ?? [])]
  .sort((a, b) => a.start - b.start);
const capWords = [];
srcWords.forEach((w) => {
  if (!w.text) return;
  const clip = nearestClip((w.start + w.end) / 2);
  if (!clip) return;
  const start = mapIn(clip, w.start);
  const end = Math.max(mapIn(clip, w.end), start + 0.08);
  capWords.push({ text: w.text.trim(), start, end, seg: clip.seg });
});

// Group into short readable phrases: break on punctuation, pauses, segment cuts, and length.
const cap = {
  enabled: true,
  maxChars: portrait ? 28 : 42,
  maxWords: portrait ? 5 : 7,
  size: portrait ? 64 : 52,
  bottom: portrait ? 520 : 110, // portrait: clear of Reels/TikTok/Shorts UI
  ...(project.captions ?? {}),
};
const groups = [];
let g = [];
const close = () => g.length && (groups.push(g), (g = []));
if (cap.enabled) capWords.forEach((w, i) => {
  const prev = capWords[i - 1];
  if (g.length && prev) {
    const chars = g.map((x) => x.text).join(" ").length + 1 + w.text.length;
    const gap = w.start - prev.end;
    if (prev.seg !== w.seg || gap > 0.45 || /[.?!:]["“”»]?$/.test(prev.text) || g.length >= cap.maxWords || chars > cap.maxChars ||
        (/[,;]$/.test(prev.text) && g.length >= 2)) close();
  }
  g.push(w);
});
close();
const capGroups = groups.map((ws, i) => {
  const next = groups[i + 1];
  const inT = Math.max(0, ws[0].start - 0.06);
  let outT = ws[ws.length - 1].end + 0.3;
  if (next) outT = Math.min(outT, next[0].start - 0.06);
  outT = Math.max(outT, inT + 0.5);
  return { id: `cap-${i}`, words: ws, in: q(inT), out: q(outT) };
});

// ── 3. Graphics, authored in RAW source time (or relative to the intro) and remapped ──
const at = (spec) => (spec.src !== undefined ? toTimeline(spec.src) : spec.after === "intro" && intro ? q(intro.start + intro.dur + (spec.offset ?? 0)) : spec.t);
const title = project.title && { ...project.title, t: at(project.title) };
const refs = (project.refs ?? []).map((r, i) => {
  const t0 = at(r);
  const dur = r.srcEnd !== undefined && t0 !== null ? toTimeline(r.srcEnd) - t0 : r.dur;
  return { ...r, id: `ref-${i}`, t: t0, dur };
}).filter((r) => r.t !== null);
const showProgress = project.progress !== false;
const endFade = project.endFade ?? 0.8;

// ── 4. Music bed: level under speech, its own level during the intro, fade in/out ──
const m = { bed: 0.12, intro: 0.0, fadeIn: 1.0, fadeOut: 2.5, ...(project.music ?? {}) };
const musicPts = [{ t: 0, v: 0 }, { t: m.fadeIn, v: m.bed }];
if (intro) {
  musicPts.push({ t: Math.max(m.fadeIn, intro.start - 0.25), v: m.bed }, { t: intro.start, v: m.intro });
  musicPts.push({ t: intro.start + intro.dur, v: m.intro }, { t: intro.start + intro.dur + 0.5, v: m.bed });
}
musicPts.push({ t: total - m.fadeOut, v: m.bed }, { t: total, v: 0 });
const musicLane = JSON.stringify({ version: 1, lanes: [{ target: "volume", points: musicPts.map((x) => ({ t: +q(x.t).toFixed(3), v: x.v })) }] });
const musicSrcStart = m.start ?? 0;
if (media.music && media.music.duration - musicSrcStart < total) console.warn(`! music (${media.music.duration}s) shorter than video (${total}s)`);

// ── 5. HTML ──
const S = portrait
  ? { capWidth: 920, titleTop: 210, titleSize: 96, refTop: 200, pad: 60 }
  : { capWidth: 1500, titleTop: 70, titleSize: 76, refTop: 70, pad: 90 };

// Adjacent clips alternate tracks 0/1: same-track neighbours trip lint's duplicate_audio_track on rounding.
const videoTags = clips.map((c, ci) => c.kind === "main"
  ? `    <video id="${c.id}" class="clip vid" src="${media.main.file}" data-start="${f(c.start)}" data-duration="${f(c.dur)}" data-media-start="${c.mediaStart.toFixed(3)}" data-fade-in="0.03" data-fade-out="0.03" data-track-index="${ci % 2}" playsinline data-has-audio="true"></video>`
  : `    <video id="intro" class="clip vid" src="${media.intro.file}" data-start="${f(c.start)}" data-duration="${f(c.dur)}" data-track-index="${ci % 2}" playsinline ${media.intro.hasAudio && !project.introMuted ? 'data-has-audio="true"' : "muted"}></video>`).join("\n");

const capHtml = capGroups.map((cg) => `      <div class="cap" id="${cg.id}"><span class="cap-inner">${cg.words.map((w, j) => `<span class="w" id="${cg.id}-w${j}">${esc(w.text)}</span>`).join(" ")}</span></div>`).join("\n");

const star = `<svg class="star" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.5l2.6 4.2 4.8-1.2-1.2 4.8 4.3 2.7-4.3 2.7 1.2 4.8-4.8-1.2L12 22.5l-2.6-4.2-4.8 1.2 1.2-4.8L1.5 12l4.3-2.7-1.2-4.8 4.8 1.2z"/></svg>`;

// Fontsource unicode ranges: latin (Western European) + latin-ext (Turkish, Polish, …).
const RANGES = {
  latin: "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
  "latin-ext": "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
};
const faces = [];
for (const subset of ["latin-ext", "latin"]) {
  for (const w of [500, 700, 800]) faces.push(`  @font-face { font-family: "Inter"; src: url("assets/fonts/inter-${subset}-${w}-normal.woff2") format("woff2"); font-weight: ${w}; font-display: block; unicode-range: ${RANGES[subset]}; }`);
  for (const w of [400, 700]) faces.push(`  @font-face { font-family: "Cormorant Garamond"; src: url("assets/fonts/cormorant-garamond-${subset}-${w}-normal.woff2") format("woff2"); font-weight: ${w}; font-display: block; unicode-range: ${RANGES[subset]}; }`);
}

const html = `<!doctype html>
<html lang="${esc(project.lang ?? "en")}">
<head>
<meta charset="utf-8" />
<style>
${faces.join("\n")}
  :root { --accent: ${theme.accent}; --text: ${theme.text}; --ink: rgba(${theme.ink},.62); }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: ${W}px; height: ${H}px; overflow: hidden; background: #000; font-family: "Inter", sans-serif; }
  #root { position: relative; width: ${W}px; height: ${H}px; overflow: hidden; background: #000; }
  .vid { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; object-fit: cover; }
  .layer { position: absolute; inset: 0; pointer-events: none; }

  /* progress line across the top — fills over the talk, hidden during the intro */
  #progress { position: absolute; left: 0; top: 0; height: ${portrait ? 8 : 6}px; width: ${W}px; background: var(--accent); transform-origin: 0 50%; transform: scaleX(0); opacity: .9; }

  /* title card (top, clear of captions) */
  #title { position: absolute; left: ${S.pad}px; top: ${S.titleTop}px; max-width: ${W - 2 * S.pad}px; opacity: 0; }
  #title .bg { position: absolute; inset: -34px -44px; background: linear-gradient(100deg, rgba(${theme.ink},.78), rgba(${theme.ink},.35) 70%, rgba(${theme.ink},0)); border-radius: 18px; }
  #title .kicker { position: relative; color: var(--accent); font: 700 ${portrait ? 28 : 22}px/1 "Inter", sans-serif; letter-spacing: .2em; text-transform: uppercase; }
  #title .rule { position: relative; height: 3px; width: ${portrait ? 180 : 150}px; background: var(--accent); margin: ${portrait ? 22 : 16}px 0; transform-origin: 0 50%; }
  #title h1 { position: relative; color: var(--text); font: 700 ${S.titleSize}px/1.02 "Cormorant Garamond", serif; text-shadow: 0 4px 24px rgba(0,0,0,.45); }
  #title h2 { position: relative; color: var(--text); opacity: .92; font: 500 ${portrait ? 40 : 32}px/1.25 "Inter", sans-serif; margin-top: 12px; }

  /* reference chips (e.g. a quoted source) */
  .ref { position: absolute; left: ${S.pad}px; top: ${S.refTop}px; display: flex; align-items: center; gap: 16px; padding: ${portrait ? "16px 28px 16px 20px" : "12px 22px 12px 16px"};
    border-radius: 14px; background: var(--ink); border-left: 4px solid var(--accent); color: var(--text); opacity: 0; }
  .ref .star { width: ${portrait ? 34 : 26}px; height: ${portrait ? 34 : 26}px; fill: var(--accent); flex: none; }
  .ref .k { display: block; color: var(--accent); font: 700 ${portrait ? 22 : 17}px/1 "Inter", sans-serif; letter-spacing: .18em; text-transform: uppercase; margin-bottom: 8px; }
  .ref .v { display: block; font: 700 ${portrait ? 34 : 27}px/1.1 "Inter", sans-serif; }

  /* captions — colour-only word highlight: scaling the active word eats the space next to it */
  .cap { position: absolute; left: 50%; bottom: ${cap.bottom}px; width: ${S.capWidth}px; margin-left: -${S.capWidth / 2}px; text-align: center; opacity: 0; }
  .cap-inner { display: inline; padding: .12em .42em; line-height: 1.42; background: rgba(${theme.ink},.38); border-radius: 14px;
    -webkit-box-decoration-break: clone; box-decoration-break: clone;
    color: var(--text); font: 700 ${cap.size}px/1.42 "Inter", sans-serif; text-shadow: 0 2px 10px rgba(0,0,0,.55); }
  .w { display: inline-block; }

  #fade { position: absolute; inset: 0; background: #000; opacity: 0; }
</style>
</head>
<body>
  <div id="root" data-composition-id="root" data-start="0" data-duration="${f(total)}" data-fps="${FPS}" data-width="${W}" data-height="${H}">
${videoTags}
${media.music ? `    <audio id="music" src="${media.music.file}" data-start="0" data-duration="${f(total)}" data-media-start="${musicSrcStart}" data-track-index="10" data-volume="1" data-automation='${musicLane}'></audio>` : ""}
    <div class="layer" id="gfx">
${showProgress ? `      <div id="progress"></div>` : ""}
${title ? `      <div id="title"><div class="bg"></div>${title.kicker ? `<div class="kicker">${esc(title.kicker)}</div>` : ""}<div class="rule"></div><h1>${esc(title.title)}</h1>${title.subtitle ? `<h2>${esc(title.subtitle)}</h2>` : ""}</div>` : ""}
${refs.map((r) => `      <div class="ref" id="${r.id}">${star}<span><span class="k">${esc(r.kicker ?? "")}</span><span class="v">${esc(r.text)}</span></span></div>`).join("\n")}
${capHtml}
      <div id="fade"></div>
    </div>
    <script src="assets/vendor/gsap.min.js"></script>
    <script>
      (function () {
        const tl = gsap.timeline({ paused: true });
        const ACCENT = ${JSON.stringify(theme.accent)}, TEXT = ${JSON.stringify(theme.text)};

${showProgress ? `        // progress: one step per kept clip (each ends a frame early so steps never overlap)
${mainClips.map((c, i) => {
  const before = mainClips.slice(0, i).reduce((s, x) => s + x.dur, 0);
  const all = mainClips.reduce((s, x) => s + x.dur, 0);
  return `        tl.fromTo("#progress", { scaleX: ${(before / all).toFixed(5)} }, { scaleX: ${((before + c.dur) / all).toFixed(5)}, duration: ${f(c.dur - 1 / FPS)}, ease: "none", immediateRender: false }, ${f(c.start)});`;
}).join("\n")}
${intro ? `        tl.to("#progress", { opacity: 0, duration: 0.2 }, ${f(intro.start)}).to("#progress", { opacity: 0.9, duration: 0.3 }, ${f(intro.start + intro.dur)});` : ""}` : ""}

${title ? `        // title
        tl.fromTo("#title", { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.6, ease: "power3.out" }, ${f(title.t)});
        tl.fromTo("#title .rule", { scaleX: 0 }, { scaleX: 1, duration: 0.7, ease: "power2.inOut" }, ${f(title.t + 0.2)});
        tl.from("#title h1, #title h2", { opacity: 0, y: 16, duration: 0.5, stagger: 0.12, ease: "power2.out" }, ${f(title.t + 0.3)});
        tl.to("#title", { opacity: 0, x: -20, duration: 0.4, ease: "power2.in" }, ${f(title.t + (title.dur ?? 4.5))});` : ""}

${refs.map((r) => `        tl.fromTo("#${r.id}", { opacity: 0, x: -24 }, { opacity: 1, x: 0, duration: 0.45, ease: "power2.out" }, ${f(r.t)});
        tl.fromTo("#${r.id} .star", { rotation: -90, scale: 0.4 }, { rotation: 0, scale: 1, duration: 0.7, ease: "back.out(1.7)" }, ${f(r.t + 0.05)});
        tl.to("#${r.id}", { opacity: 0, x: -16, duration: 0.35, ease: "power2.in" }, ${f(r.t + (r.dur ?? 4))});`).join("\n")}

        // captions: phrase fades up, the spoken word takes the accent colour
${capGroups.map((cg) => {
  const lines = [`        tl.fromTo("#${cg.id}", { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.18, ease: "power2.out" }, ${f(cg.in)});`];
  cg.words.forEach((w, j) => {
    const next = cg.words[j + 1];
    const off = next ? next.start : Math.min(w.end + 0.25, cg.out);
    lines.push(`        tl.to("#${cg.id}-w${j}", { color: ACCENT, duration: 0.08 }, ${f(w.start)}).to("#${cg.id}-w${j}", { color: TEXT, duration: 0.12 }, ${f(Math.max(off, w.start + 0.1))});`);
  });
  lines.push(`        tl.to("#${cg.id}", { opacity: 0, duration: 0.14, ease: "power1.in" }, ${f(cg.out - 0.14)});`);
  return lines.join("\n");
}).join("\n")}

${endFade > 0 ? `        // end: fade to black
        tl.to("#fade", { opacity: 1, duration: ${endFade}, ease: "power1.in" }, ${f(total - endFade)});` : ""}

        window.__timelines = window.__timelines || {};
        window.__timelines["root"] = tl;
      })();
    </script>
  </div>
</body>
</html>
`;

fs.writeFileSync(p("index.html"), html);
fs.writeFileSync(p("edit/timeline.json"), JSON.stringify({ total, clips, captions: capGroups.map((c) => ({ in: c.in, out: c.out, text: c.words.map((w) => w.text).join(" ") })) }, null, 2));
console.log(`index.html written · ${W}x${H} · ${total.toFixed(2)}s · ${clips.length} clips · ${capGroups.length} caption groups · ${refs.length} refs`);
