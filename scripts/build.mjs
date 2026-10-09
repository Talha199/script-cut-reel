// Builds <project>/index.html (the HyperFrames composition) from:
//   edit/media.json       — probed media (prep.mjs)
//   edit/transcript.json  — word timings of the RAW main video [{text,start,end}] (transcribe.mjs)
//   edit/silences.json    — optional, silent stretches in RAW time (silences.mjs)
//   edit/glossary.json    — optional, {"word": "Spelling"} applied to every caption word
//   edit/project.json     — the edit: kept segments, hook, title, music, captions (see references/project-schema.md)
// Writes index.html + edit/timeline.json and prints QA (length, first word, reading speed, pauses).
//   node <skill>/scripts/build.mjs [--guides]
// --guides overlays Instagram's safe zones and grid crops for `hyperframes snapshot`. Rebuild without
// it before rendering.
import fs from "node:fs";
import { args, exists, p, readJson } from "./lib.mjs";

const media = readJson("edit/media.json");
const project = readJson("edit/project.json");
const words = readJson("edit/transcript.json");

const FPS = 30;
const q = (t) => Math.round(t * FPS) / FPS; // frame-quantized seconds
const f = (t) => q(t).toFixed(4);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const warn = (msg) => console.warn(`! ${msg}`);

const W = media.main.canvas.width;
const H = media.main.canvas.height;
const portrait = H > W;
const theme = { accent: "#e6bf63", text: "#fbf8f1", ink: "8,16,13", ...(project.theme ?? {}) }; // ink = "r,g,b" of the scrims
// Colour of the word being spoken. With keyword emphasis in use, a softer tint (accent mixed halfway
// into the text colour) so gold keeps one meaning: "this word matters".
const mix = (a, b) => "#" + [1, 3, 5].map((i) => Math.round((parseInt(a.slice(i, i + 2), 16) + parseInt(b.slice(i, i + 2), 16)) / 2).toString(16).padStart(2, "0")).join("");
const HL = theme.highlight ?? ((project.captionEmphasis ?? []).length || (project.captionInserts ?? []).some((w) => w.emph)
  ? mix(theme.accent, theme.text) : theme.accent);

// The page language drives uppercase rules (Turkish i → İ in the kicker) and must match the speech.
const asrLang = exists("edit/transcribe.json") ? readJson("edit/transcribe.json").language : null;
const lang = project.lang ?? asrLang;
if (!lang) throw new Error('set "lang" in edit/project.json ("de", "tr", "en", …) — it decides casing rules such as Turkish i → İ');
if (project.lang && asrLang && project.lang.slice(0, 2).toLowerCase() !== asrLang.slice(0, 2).toLowerCase())
  warn(`lang "${project.lang}" but the transcript was made with --language ${asrLang}`);

// ── 1. Timeline: kept segments of the main video, intro slotted after `introAfter` ──
// All authored times (segments, words, refs, inserts) are RAW source seconds. The proxy in
// assets/main.mp4 may be sped up (media.main.speed), so media time = raw / speed.
const SP = media.main.speed ?? 1;

// Silence removal: each kept segment is split around silent stretches, leaving a short breath on
// either side so speech doesn't sound clipped. "silence": false in project.json turns it off.
const sil = { minGap: 0.3, keepAfter: 0.15, keepBefore: 0.1, ...(project.silence || {}) };
const silences = project.silence === false || !exists("edit/silences.json") ? [] : readJson("edit/silences.json");
// protect: raw ranges whose pauses are part of the delivery (recitation, du'a, a quoted verse) — no cuts inside.
const protect = project.protect ?? [];
// Only the part of a pause outside every protected range may be cut.
function unprotected(s, e) {
  for (const r of protect) {
    if (s >= r.in && e <= r.out) return null;
    if (s < r.in && e > r.in) e = r.in;
    else if (s < r.out && e > r.out) s = r.out;
  }
  return [s, e];
}
if (SP !== 1 && protect.length) warn(`speed ${SP}× is global and also applies to the ${protect.length} protected span(s); use 1.0 if they hold recitation`);
function splitSegment(a, b) {
  const pieces = [];
  let cur = a;
  for (const span of silences) {
    const [s, e] = unprotected(...span) ?? [0, 0];
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
if (intro && intro.dur > 2) warn(`intro is ${intro.dur.toFixed(1)} s — over ~1.5–2 s it reads as "skip"; shorten it or use none`);

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

// ── 2. Graphics, authored in RAW source time, timeline time, or after the hook/intro ──
// Hook headline: 3–6 words naming the topic, on screen from frame 0 while the hook is spoken.
// Viewers decide within ~3 s (Instagram's Skip Rate window), so the topic must be visible before that.
const hookSpec = typeof project.hook === "string" ? { text: project.hook } : project.hook;
let hook = null;
if (hookSpec?.text) {
  const firstSeg = mainClips.filter((c) => c.seg === 0).at(-1);
  const t0 = hookSpec.t ?? (hookSpec.src !== undefined ? toTimeline(hookSpec.src) : 0);
  const end = hookSpec.dur !== undefined ? t0 + hookSpec.dur
    : hookSpec.srcEnd !== undefined ? toTimeline(hookSpec.srcEnd)
    : Math.min(Math.max(firstSeg ? firstSeg.start + firstSeg.dur : 3, t0 + 2.5), t0 + 6); // the spoken hook, 2.5–6 s
  hook = { ...hookSpec, t: q(t0), end: q(end) };
  const n = hookSpec.text.replace(/\*/g, "").trim().split(/\s+/).length;
  if (n > 7) warn(`hook text has ${n} words — 3–6 can be read at a glance`);
}
// "after hook" skips an intro clip that follows the hook directly — graphics never sit on the intro.
const hookDone = hook && (intro && Math.abs(intro.start - hook.end) < 0.2 ? intro.start + intro.dur : hook.end);
const at = (spec) => (spec.src !== undefined ? toTimeline(spec.src)
  : spec.after === "intro" && intro ? q(intro.start + intro.dur + (spec.offset ?? 0))
  : spec.after === "hook" && hook ? q(hookDone + (spec.offset ?? 0))
  : q(spec.t ?? 0));
const title = project.title && { dur: 4.5, ...project.title, t: at(project.title) };
const refs = (project.refs ?? []).map((r, i) => {
  const t0 = at(r);
  const dur = r.srcEnd !== undefined && t0 !== null ? toTimeline(r.srcEnd) - t0 : r.dur;
  return { ...r, id: `ref-${i}`, t: t0, dur };
}).filter((r) => r.t !== null);
// Anything at t = 0 is drawn on the first frame without an entrance: that frame is the feed thumbnail.
const hookStatic = hook && hook.t < 1 / FPS;
const titleStatic = title && title.t < 1 / FPS;
const showProgress = project.progress === true;
const endFade = project.endFade ?? 0;

// Hook, title and ref chips share the top band — they must take turns.
const topItems = [hook && ["hook", hook.t, hook.end], title && ["title", title.t, title.t + title.dur + 0.4],
  ...refs.map((r) => [r.id, r.t, r.t + (r.dur ?? 4) + 0.35])].filter(Boolean);
for (let i = 0; i < topItems.length; i++) for (let j = i + 1; j < topItems.length; j++) {
  const [a, a0, a1] = topItems[i], [b, b0, b1] = topItems[j];
  if (a0 < b1 && b0 < a1) warn(`${a} (${a0.toFixed(1)}–${a1.toFixed(1)} s) and ${b} (${b0.toFixed(1)}–${b1.toFixed(1)} s) overlap in the top band — use title.after: "hook" or move one`);
}

// ── 3. Caption words: keep words inside kept segments, remap to timeline ──
const fixes = project.captionFixes ?? {}; // { "<word index>": "corrected text" | "" (drop) }
const emphasis = new Set((project.captionEmphasis ?? []).map(String)); // word indices drawn bold + accent
// Glossary: recurring spellings (names, religious terms) fixed in every project; case-insensitive, keeps punctuation.
const gloss = new Map(Object.entries({ ...(exists("edit/glossary.json") ? readJson("edit/glossary.json") : {}), ...(project.glossary ?? {}) })
  .map(([k, v]) => [k.toLocaleLowerCase(lang), v]));
const glossed = (text) => gloss.size ? text.replace(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu, (w) => gloss.get(w.toLocaleLowerCase(lang)) ?? w) : text;
// captionInserts: words the ASR missed (e.g. an Arabic salawat inside German speech), in RAW time
const srcWords = [
  ...words.map((w, i) => ({ ...w, text: fixes[i] ?? glossed(w.text), em: emphasis.has(String(i)) })),
  ...(project.captionInserts ?? []).map((w) => ({ ...w, em: !!w.emph })),
].sort((a, b) => a.start - b.start);
const capWords = [];
srcWords.forEach((w) => {
  if (!w.text) return;
  const clip = nearestClip((w.start + w.end) / 2);
  if (!clip) return;
  const start = mapIn(clip, w.start);
  const end = Math.max(mapIn(clip, w.end), start + 0.08);
  capWords.push({ text: w.text.trim(), start, end, seg: clip.seg, em: w.em });
});

// Group into short readable phrases: break on punctuation, pauses, segment cuts, and length.
const cap = {
  enabled: true,
  maxChars: portrait ? 22 : 42, // per line; Inter 700 at 64 px fits ~22 characters in 860 px
  maxWords: portrait ? 5 : 7,
  size: portrait ? 64 : 52,
  bottom: portrait ? 680 : 110, // portrait: block ends at y≈1240, above Meta's bottom-35% zone
  width: portrait ? 860 : 1500,
  offsetX: 0,
  minDur: 0.85, // shortest time a phrase stays readable
  scrim: 0.52,
  startAfter: null, // "hook": no captions while the hook headline is on screen
  ...(project.captions ?? {}),
};
const textOf = (ws) => ws.map((w) => w.text).join(" ");
const sentenceEnd = (w) => /[.?!]["“”»]?$/.test(w.text);
const groups = [];
let g = [];
const close = () => g.length && (groups.push(g), (g = []));
if (cap.enabled) capWords.forEach((w, i) => {
  const prev = capWords[i - 1];
  if (g.length && prev) {
    const chars = textOf(g).length + 1 + w.text.length;
    const gap = w.start - prev.end;
    if (prev.seg !== w.seg || gap > 0.45 || /[.?!:]["“”»]?$/.test(prev.text) || g.length >= cap.maxWords || chars > cap.maxChars ||
        (/[,;]$/.test(prev.text) && g.length >= 2)) close();
  }
  g.push(w);
});
close();
// A phrase on screen for less than minDur (until the next one replaces it) merges into a neighbour of
// the same sentence when the two fit on two lines: forward first, else back ("… der | Allerbarmer.").
const joinable = (a, b) => a.at(-1).seg === b[0].seg && b[0].start - a.at(-1).end <= 0.45 && !sentenceEnd(a.at(-1)) &&
  textOf([...a, ...b]).length <= 2 * cap.maxChars;
for (let i = 0; i < groups.length; i++) {
  const a = groups[i], next = groups[i + 1], prev = groups[i - 1];
  if ((next ? next[0].start : a.at(-1).end + 0.3) - a[0].start >= cap.minDur) continue;
  if (next && joinable(a, next)) { groups.splice(i, 2, [...a, ...next]); i--; }
  else if (prev && joinable(prev, a)) { groups.splice(i - 1, 2, [...prev, ...a]); i -= 2; }
}
// Over-long phrases break into two lines, the longer one at the bottom; a single word that is still
// too long (German compounds) shrinks instead.
function layout(ws) {
  let lines = [ws];
  if (textOf(ws).length > cap.maxChars && ws.length > 1) {
    let best = null;
    for (let k = 1; k < ws.length; k++) {
      const l1 = textOf(ws.slice(0, k)).length, l2 = textOf(ws.slice(k)).length;
      const score = Math.max(l1, l2) + (l1 > l2 ? 0.5 : 0);
      if (!best || score < best.score) best = { k, score };
    }
    lines = [ws.slice(0, best.k), ws.slice(best.k)];
  }
  const longest = Math.max(...lines.map((l) => textOf(l).length));
  return { lines, scale: Math.max(0.7, Math.min(1, cap.maxChars / longest)) };
}
let capGroups = groups.map((ws, i) => {
  const next = groups[i + 1];
  const inT = Math.max(0, ws[0].start - 0.06);
  let outT = Math.max(ws.at(-1).end + 0.3, inT + cap.minDur);
  if (next) outT = Math.min(outT, next[0].start - 0.06);
  outT = Math.max(outT, inT + 0.2);
  return { id: `cap-${i}`, words: ws, ...layout(ws), in: q(inT), out: q(outT) };
});
if (cap.startAfter === "hook" && hook) {
  capGroups = capGroups.filter((c) => c.out - Math.max(c.in, hook.end) >= cap.minDur / 2); // no slivers
  capGroups.forEach((c) => (c.in = Math.max(c.in, hook.end)));
}
const cps = capGroups.map((c) => textOf(c.words).length / Math.max(0.1, c.out - c.in));

// ── 4. Music bed: level under speech, its own level during the intro, fade in/out ──
// Linear gains on −16 LUFS tracks: bed 0.10 ≈ −20 dB under the voice (accessibility guidance: ≥ 20 dB).
const m = { bed: 0.1, intro: 0.0, fadeIn: 0.4, fadeOut: 1.2, ...(project.music ?? {}) };
const musicPts = [{ t: 0, v: 0 }, { t: m.fadeIn, v: m.bed }];
if (intro) {
  musicPts.push({ t: Math.max(m.fadeIn, intro.start - 0.25), v: m.bed }, { t: intro.start, v: m.intro });
  musicPts.push({ t: intro.start + intro.dur, v: m.intro }, { t: intro.start + intro.dur + 0.5, v: m.bed });
}
musicPts.push({ t: total - m.fadeOut, v: m.bed }, { t: total, v: 0 });
const musicLane = JSON.stringify({ version: 1, lanes: [{ target: "volume", points: musicPts.map((x) => ({ t: +q(x.t).toFixed(3), v: x.v })) }] });
const musicSrcStart = m.start ?? 0;
if (media.music && media.music.duration - musicSrcStart < total) warn(`music (${media.music.duration}s) shorter than video (${total}s)`);

// ── 5. QA ──
const speech = mainClips.reduce((s, c) => s + c.dur, 0);
const firstWord = capWords[0]?.start ?? null;
let pause = { len: 0, at: 0 };
for (let i = 1; i < capWords.length; i++) {
  const a = capWords[i - 1], b = capWords[i];
  if (intro && a.end <= intro.start + 1e-3 && b.start >= intro.start + intro.dur - 1e-3) continue;
  if (b.start - a.end > pause.len) pause = { len: b.start - a.end, at: a.end };
}
const maxCps = Math.max(0, ...cps);
const mmss = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
console.log(`QA  ${mmss(total)} · first word ${firstWord?.toFixed(2)} s · ${(capWords.length / speech * 60).toFixed(0)} wpm · ` +
  `captions ≤ ${maxCps.toFixed(1)} chars/s (${cps.filter((c) => c > 17).length} over 17) · longest pause ${pause.len.toFixed(2)} s @ ${pause.at.toFixed(1)} s`);
if (portrait && total > 180) warn(`${mmss(total)} is over 3:00 — Instagram doesn't recommend Reels longer than 3 minutes`);
else if (portrait && total > 90) warn(`${mmss(total)} — 30–90 s Reels reach best; drop a passage or tighten pauses if the content allows`);
if (firstWord !== null && firstWord > 0.3) warn(`first word at ${firstWord.toFixed(2)} s — open on speech`);
if (pause.len > 0.7) warn(`${pause.len.toFixed(2)} s without speech at ${pause.at.toFixed(1)} s — intended?`);
const tooFast = cps.filter((c) => c > 20).length;
if (tooFast) warn(`${tooFast} caption phrase(s) over 20 chars/s — too fast to read; consider less speed-up`);
project.segments.forEach((s, i) => {
  for (const [edge, which] of [[s.in, "in"], [s.out, "out"]]) {
    const k = words.findIndex((w) => edge > w.start + 0.04 && edge < w.end - 0.04);
    if (k >= 0) warn(`segment ${i} ${which} ${edge}s falls inside "${words[k].text}" (#${k} ${words[k].start}–${words[k].end}) — check the waveform (ASR word ends often run into the pause)`);
  }
});

// ── 6. HTML ──
const S = portrait
  ? { titleTop: 310, titleSize: 96, refTop: 310, pad: 72, hookTop: 330, hookSize: 84, progressTop: 262 }
  : { titleTop: 70, titleSize: 76, refTop: 70, pad: 90, hookTop: 80, hookSize: 64, progressTop: 0 };

// Adjacent clips alternate tracks 0/1: same-track neighbours trip lint's duplicate_audio_track on rounding.
const videoTags = clips.map((c, ci) => c.kind === "main"
  ? `    <video id="${c.id}" class="clip vid" src="${media.main.file}" data-start="${f(c.start)}" data-duration="${f(c.dur)}" data-media-start="${c.mediaStart.toFixed(3)}" data-fade-in="0.03" data-fade-out="0.03" data-track-index="${ci % 2}" playsinline data-has-audio="true"></video>`
  : `    <video id="intro" class="clip vid" src="${media.intro.file}" data-start="${f(c.start)}" data-duration="${f(c.dur)}" data-track-index="${ci % 2}" playsinline ${media.intro.hasAudio && !project.introMuted ? 'data-has-audio="true"' : "muted"}></video>`).join("\n");

let wi = 0;
const capHtml = capGroups.map((cg) => {
  wi = 0;
  const size = cg.scale < 1 ? ` style="font-size:${Math.round(cap.size * cg.scale)}px"` : "";
  const lines = cg.lines.map((l) => l.map((w) => `<span class="w${w.em ? " em" : ""}" id="${cg.id}-w${wi++}">${esc(w.text)}</span>`).join(" "));
  return `      <div class="cap" id="${cg.id}"><span class="cap-inner"${size}>${lines.join("<br>")}</span></div>`;
}).join("\n");
const hookHtml = hook && `      <div id="hook"><span class="hook-inner">${esc(hook.text).replace(/\*([^*]+)\*/g, "<em>$1</em>")}</span></div>`;

const star = `<svg class="star" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 1.5l2.6 4.2 4.8-1.2-1.2 4.8 4.3 2.7-4.3 2.7 1.2 4.8-4.8-1.2L12 22.5l-2.6-4.2-4.8 1.2 1.2-4.8L1.5 12l4.3-2.7-1.2-4.8 4.8 1.2z"/></svg>`;

// Safe zones (Meta's Reels ad guidance — the only official numbers): top 14 %, bottom 35 %, sides 6 %;
// the like/comment/share rail ≈ right 21 % of the bottom 40 %. Crops: profile grid 3:4, feed 4:5, square 1:1.
let guidesHtml = "";
if (args.guides) {
  if (!portrait) warn("--guides only covers portrait canvases");
  else {
    const top = Math.round(H * 0.14), bot = Math.round(H * 0.35), side = Math.round(W * 0.06), railW = Math.round(W * 0.21), railH = Math.round(H * 0.4);
    const crop = (r) => Math.round((H - W * r) / 2);
    const zone = (l, tp, w, h) => `<div class="g-zone" style="left:${l}px;top:${tp}px;width:${w}px;height:${h}px"></div>`;
    const line = (y, label, cls) => `<div class="g-line ${cls}" style="top:${y}px"><span>${label}</span></div>`;
    guidesHtml = `    <div class="layer" id="guides">${zone(0, 0, W, top)}${zone(0, H - bot, W, bot)}${zone(0, top, side, H - top - bot)}${zone(W - side, top, side, H - top - bot)}` +
      `<div class="g-rail" style="left:${W - railW}px;top:${H - railH}px;width:${railW}px;height:${railH}px"><span>buttons</span></div>` +
      `${line(crop(4 / 3), "3:4 grid", "c34")}${line(H - crop(4 / 3), "3:4 grid", "c34")}${line(crop(1), "1:1", "c11")}${line(H - crop(1), "1:1", "c11")}</div>`;
    warn("GUIDES ON — snapshot only; rebuild without --guides before rendering");
  }
}

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
<html lang="${esc(lang)}">
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

  /* progress line (opt-in) — just under Instagram's header, hidden during the intro */
  #progress { position: absolute; left: 0; top: ${S.progressTop}px; height: ${portrait ? 4 : 6}px; width: ${W}px; background: var(--accent); transform-origin: 0 50%; transform: scaleX(0); opacity: .5; }

  /* hook headline: big, centred, upper third — inside the 3:4 grid crop so it also works as the cover */
  #hook { position: absolute; left: ${S.pad}px; right: ${S.pad}px; top: ${S.hookTop}px; text-align: center; text-wrap: balance; opacity: ${hookStatic ? 1 : 0}; }
  #hook .hook-inner { display: inline; padding: .06em .32em; background: var(--ink); border-radius: 18px; -webkit-box-decoration-break: clone; box-decoration-break: clone;
    color: var(--text); font: 800 ${S.hookSize}px/1.24 "Inter", sans-serif; text-shadow: 0 2px 12px rgba(0,0,0,.45); }
  #hook em { font-style: normal; color: var(--accent); }

  /* title card (top, below Instagram's header, clear of captions) */
  #title { position: absolute; left: ${S.pad}px; top: ${S.titleTop}px; max-width: ${W - 2 * S.pad}px; opacity: ${titleStatic ? 1 : 0}; }
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

  /* captions — colour-only word highlight: scaling the active word eats the space next to it.
     Emphasised keywords are bold + accent for the whole phrase (static, so nothing reflows). */
  .cap { position: absolute; left: 50%; bottom: ${cap.bottom}px; width: ${cap.width}px; margin-left: ${-cap.width / 2 + cap.offsetX}px; text-align: center; opacity: 0; }
  .cap-inner { display: inline; padding: .07em .42em; background: rgba(${theme.ink},${cap.scrim}); border-radius: 14px;
    -webkit-box-decoration-break: clone; box-decoration-break: clone;
    color: var(--text); font: 700 ${cap.size}px/1.36 "Inter", sans-serif; text-shadow: 0 2px 10px rgba(0,0,0,.55); }
  .w { display: inline-block; }
  .w.em { font-weight: 800; color: var(--accent); }

  #fade { position: absolute; inset: 0; background: #000; opacity: 0; }
${guidesHtml ? `
  /* --guides (snapshot only) */
  .g-zone { position: absolute; background: rgba(255,0,60,.22); }
  .g-rail { position: absolute; border: 3px dashed rgba(255,0,60,.85); background: rgba(255,0,60,.10); }
  .g-line { position: absolute; left: 0; width: ${W}px; height: 0; border-top: 3px dashed; }
  .g-line.c34 { border-color: rgba(0,210,255,.95); } .g-line.c11 { border-color: rgba(255,210,0,.95); }
  #guides span { position: absolute; left: 12px; top: 4px; font: 700 22px/1 "Inter", sans-serif; color: #fff; text-shadow: 0 1px 3px #000; }` : ""}
</style>
</head>
<body>
  <div id="root" data-composition-id="root" data-start="0" data-duration="${f(total)}" data-fps="${FPS}" data-width="${W}" data-height="${H}">
${videoTags}
${media.music ? `    <audio id="music" src="${media.music.file}" data-start="0" data-duration="${f(total)}" data-media-start="${musicSrcStart}" data-track-index="10" data-volume="1" data-automation='${musicLane}'></audio>` : ""}
    <div class="layer" id="gfx">
${showProgress ? `      <div id="progress"></div>` : ""}
${hookHtml ?? ""}
${title ? `      <div id="title"><div class="bg"></div>${title.kicker ? `<div class="kicker">${esc(title.kicker)}</div>` : ""}<div class="rule"></div><h1>${esc(title.title)}</h1>${title.subtitle ? `<h2>${esc(title.subtitle)}</h2>` : ""}</div>` : ""}
${refs.map((r) => `      <div class="ref" id="${r.id}">${star}<span><span class="k">${esc(r.kicker ?? "")}</span><span class="v">${esc(r.text)}</span></span></div>`).join("\n")}
${capHtml}
      <div id="fade"></div>
    </div>
${guidesHtml}
    <script src="assets/vendor/gsap.min.js"></script>
    <script>
      (function () {
        const tl = gsap.timeline({ paused: true });
        const HL = ${JSON.stringify(HL)}, TEXT = ${JSON.stringify(theme.text)};

${showProgress ? `        // progress: one step per kept clip (each ends a frame early so steps never overlap)
${mainClips.map((c, i) => {
  const before = mainClips.slice(0, i).reduce((s, x) => s + x.dur, 0);
  const all = mainClips.reduce((s, x) => s + x.dur, 0);
  return `        tl.fromTo("#progress", { scaleX: ${(before / all).toFixed(5)} }, { scaleX: ${((before + c.dur) / all).toFixed(5)}, duration: ${f(c.dur - 1 / FPS)}, ease: "none", immediateRender: false }, ${f(c.start)});`;
}).join("\n")}
${intro ? `        tl.to("#progress", { opacity: 0, duration: 0.2 }, ${f(intro.start)}).to("#progress", { opacity: 0.5, duration: 0.3 }, ${f(intro.start + intro.dur)});` : ""}` : ""}

${hook ? `        // hook headline${hookStatic ? " (on the first frame)" : ""}
${hookStatic ? "" : `        tl.fromTo("#hook", { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.25, ease: "power2.out" }, ${f(hook.t)});\n`}        tl.to("#hook", { opacity: 0, duration: 0.25, ease: "power1.in" }, ${f(hook.end - 0.25)});` : ""}

${title ? `        // title${titleStatic ? " (on the first frame)" : ""}
${titleStatic ? "" : `        tl.fromTo("#title", { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: 0.6, ease: "power3.out" }, ${f(title.t)});
        tl.fromTo("#title .rule", { scaleX: 0 }, { scaleX: 1, duration: 0.7, ease: "power2.inOut" }, ${f(title.t + 0.2)});
        tl.from("#title h1, #title h2", { opacity: 0, y: 16, duration: 0.5, stagger: 0.12, ease: "power2.out" }, ${f(title.t + 0.3)});
`}        tl.to("#title", { opacity: 0, x: -20, duration: 0.4, ease: "power2.in" }, ${f(title.t + title.dur)});` : ""}

${refs.map((r) => `        tl.fromTo("#${r.id}", { opacity: 0, x: -24 }, { opacity: 1, x: 0, duration: 0.45, ease: "power2.out" }, ${f(r.t)});
        tl.fromTo("#${r.id} .star", { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1, duration: 0.4, ease: "power2.out" }, ${f(r.t + 0.05)});
        tl.to("#${r.id}", { opacity: 0, x: -16, duration: 0.35, ease: "power2.in" }, ${f(r.t + (r.dur ?? 4))});`).join("\n")}

        // captions: phrase fades up, the spoken word takes the highlight colour
${capGroups.map((cg) => {
  const lines = [`        tl.fromTo("#${cg.id}", { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.18, ease: "power2.out" }, ${f(cg.in)});`];
  cg.words.forEach((w, j) => {
    if (w.em) return;
    const next = cg.words[j + 1];
    const off = next ? next.start : Math.min(w.end + 0.25, cg.out);
    lines.push(`        tl.to("#${cg.id}-w${j}", { color: HL, duration: 0.08 }, ${f(Math.max(w.start, cg.in))}).to("#${cg.id}-w${j}", { color: TEXT, duration: 0.12 }, ${f(Math.max(off, w.start + 0.1, cg.in + 0.1))});`);
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
fs.writeFileSync(p("edit/timeline.json"), JSON.stringify({
  total, lang, speed: SP, firstWord, guides: !!guidesHtml,
  hook: hook && { text: hook.text.replace(/\*/g, ""), t: hook.t, end: hook.end },
  title: title && { kicker: title.kicker, title: title.title, subtitle: title.subtitle, t: title.t, dur: title.dur },
  clips,
  captions: capGroups.map((c, i) => ({ in: c.in, out: c.out, cps: +cps[i].toFixed(1), text: textOf(c.words) })),
}, null, 2));
console.log(`index.html written · ${W}x${H} · ${total.toFixed(2)}s · ${clips.length} clips · ${capGroups.length} caption groups · ${refs.length} refs${hook ? " · hook" : ""}`);
