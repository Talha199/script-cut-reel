// Prepares raw media for the composition.
//   node <skill>/scripts/prep.mjs --main <raw.mp4> [--intro <intro.mp4>] [--music <music.mp3>]
//        [--speed 1.1] [--grade "eq=gamma=1.05:saturation=1.04"] [--clean] [--audio-only]
//        [--canvas auto|portrait|landscape] [--fit crop|pad] [--intro-fit crop|pad]
//        [--focus-x 0.5] [--focus-y 0.5] [--tonemap mobius|reinhard|hable|none]
// - probes each file into edit/media.json
// - extracts edit/main.wav (16 kHz mono, RAW timing) for transcription / silence detection
// - re-encodes videos to the canvas with a dense GOP (every frame seekable for the renderer),
//   loudness-normalised audio, and for the main video optional speed-up (pitch-preserving),
//   voice cleanup and colour grade
// - HDR sources (iPhone HLG, PQ) are tone-mapped to SDR BT.709 before any grade
// - aspect mismatches are cover-cropped (Instagram recommends Reels with borders less); --fit pad
//   letterboxes instead. --canvas portrait turns a landscape recording into a 9:16 Reel; --focus-x
//   (0 = left edge, 1 = right) keeps the speaker in frame.
// Re-run with only --main to change speed/grade; intro/music entries in media.json are kept.
import fs from "node:fs";
import path from "node:path";
import { args, exists, ff, hasFilter, isHdr, p, probe, readJson, tonemapFilter, writeJson } from "./lib.mjs";

// Everything lands at the same loudness so the music bed level means the same thing on any source.
// The finished mix gets its delivery loudness in finalize.mjs.
const LOUDNORM = "loudnorm=I=-16:TP=-1.5:LRA=11";
// Phone-voice cleanup: rumble out, gentle adaptive denoise (nf below −25 dB turns voices watery),
// light de-essing and compression.
const CLEAN = "highpass=f=80,afftdn=nf=-25:tn=1,deesser=i=0.3,acompressor=threshold=0.1:ratio=2.5:attack=10:release=200:makeup=1.5";

const canvasFor = (info, mode = "auto") => {
  const portrait = mode === "portrait" || (mode === "auto" && info.height > info.width);
  return portrait ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 };
};

function fit(info, { width: W, height: H }, mode, label) {
  const ratio = info.width / info.height / (W / H);
  if (mode === "pad") {
    if (Math.abs(ratio - 1) > 0.01) console.warn(`! ${label}: letterboxed ${info.width}x${info.height} into ${W}x${H} — Instagram shows bordered Reels less`);
    return `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30`;
  }
  const lost = Math.round((1 - Math.min(ratio, 1 / ratio)) * 100);
  if (lost > 10) console.warn(`! ${label}: cover-crop cuts ${lost}% of the ${ratio > 1 ? "width" : "height"} — check the framing (--focus-x/--focus-y), or --${label === "main" ? "" : "intro-"}fit pad`);
  const up = Math.max(W / info.width, H / info.height);
  if (up > 1.1) console.warn(`! ${label}: upscaled ${up.toFixed(2)}× — expect a softer picture`);
  const fx = Number(args["focus-x"] ?? 0.5), fy = Number(args["focus-y"] ?? 0.5);
  return `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}:(iw-ow)*${fx}:(ih-oh)*${fy},setsar=1,fps=30`;
}

const TONEMAP = typeof args.tonemap === "string" ? args.tonemap : "mobius";
// Scale/crop first, tone-map after: float tone-mapping on 4K 60 fps is several times slower.
function videoChain(info, canvas, fitMode, label, extra = []) {
  if (isHdr(info) && TONEMAP !== "none" && !(hasFilter("zscale") && hasFilter("tonemap")))
    console.warn(`! ${label} is HDR but this ffmpeg has no zscale/tonemap (built without zimg) — it will look grey. Use a full build (gyan.dev / BtbN on Windows, Homebrew, Debian/Ubuntu packages).`);
  const hdr = isHdr(info) && TONEMAP !== "none" && hasFilter("zscale") && hasFilter("tonemap");
  if (isHdr(info)) console.log(`${label}: HDR (${info.color.transfer}) → ${hdr ? `tone-mapped to BT.709 (${TONEMAP})` : "NOT tone-mapped (--tonemap none)"}`);
  // setparams: ffmpeg writes colour tags from the frames, so untagged SDR sources need the label here.
  return { hdr, vf: [...extra.slice(0, 1), fit(info, canvas, fitMode, label), hdr && tonemapFilter(info, TONEMAP), ...extra.slice(1),
    "setparams=color_primaries=bt709:color_trc=bt709:colorspace=bt709:range=tv"].filter(Boolean).join(",") };
}

const VIDEO_OUT = ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-g", "30", "-keyint_min", "30", "-pix_fmt", "yuv420p",
  "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", "-color_range", "tv"];
const AUDIO_OUT = ["-c:a", "aac", "-b:a", "192k", "-ar", "48000"];

const media = exists("edit/media.json") ? readJson("edit/media.json") : {};
fs.mkdirSync(p("assets"), { recursive: true });
fs.mkdirSync(p("edit"), { recursive: true });

if (typeof args.main === "string") {
  const info = probe(args.main);
  if (!info.hasVideo || !info.hasAudio) throw new Error(`${args.main}: needs a video and an audio track (found video: ${info.hasVideo}, audio: ${info.hasAudio})`);
  const canvas = canvasFor(info, typeof args.canvas === "string" ? args.canvas : "auto");
  const speed = Number(args.speed ?? 1);
  if (!(speed >= 0.5 && speed <= 2)) throw new Error("--speed must be between 0.5 and 2");
  const grade = typeof args.grade === "string" ? args.grade : null;
  const clean = !!args.clean;
  const fitMode = args.fit === "pad" ? "pad" : "crop";
  ff(["-i", args.main, "-map", "0:a:0", "-vn", ...(clean ? ["-af", CLEAN] : []), "-ac", "1", "-ar", "16000", p("edit/main.wav")]);
  const { hdr, vf } = videoChain(info, canvas, fitMode, "main", [`setpts=PTS/${speed}`, grade]);
  media.main = { source: path.resolve(args.main), file: "assets/main.mp4", ...info, speed, grade, clean, fit: fitMode, tonemapped: hdr, canvas };
  if (!args["audio-only"]) {
    ff(["-i", args.main, "-map", "0:v:0", "-map", "0:a:0", "-vf", vf, ...VIDEO_OUT,
      "-af", [clean && CLEAN, speed !== 1 && `atempo=${speed}`, LOUDNORM].filter(Boolean).join(","), ...AUDIO_OUT, "-movflags", "+faststart", p("assets/main.mp4")]);
  }
}

if (typeof args.intro === "string") {
  const info = probe(args.intro);
  const canvas = media.main?.canvas ?? canvasFor(info);
  const fitMode = args["intro-fit"] === "pad" ? "pad" : "crop";
  const { hdr, vf } = videoChain(info, canvas, fitMode, "intro");
  media.intro = { source: path.resolve(args.intro), file: "assets/intro.mp4", ...info, fit: fitMode, tonemapped: hdr };
  if (info.duration > 2) console.warn(`! intro is ${info.duration.toFixed(1)} s — anything over ~1.5–2 s before the talk resumes costs viewers; see SKILL.md "Intro"`);
  ff(["-i", args.intro, "-map", "0:v:0", ...(info.hasAudio ? ["-map", "0:a:0"] : []), "-vf", vf, ...VIDEO_OUT,
    ...(info.hasAudio ? ["-af", LOUDNORM, ...AUDIO_OUT] : ["-an"]), "-movflags", "+faststart", p("assets/intro.mp4")]);
}

if (typeof args.music === "string") {
  const info = probe(args.music);
  media.music = { source: path.resolve(args.music), file: "assets/music.m4a", ...info };
  ff(["-i", args.music, "-map", "0:a:0", "-vn", "-af", LOUDNORM, ...AUDIO_OUT, p("assets/music.m4a")]);
}

writeJson("edit/media.json", media);
console.log(JSON.stringify(media, null, 2));
