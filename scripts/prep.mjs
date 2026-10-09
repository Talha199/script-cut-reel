// Prepares raw media for the composition.
//   node <skill>/scripts/prep.mjs --main <raw.mp4> [--intro <intro.mp4>] [--music <music.mp3>]
//        [--speed 1.15] [--grade "eq=gamma=1.18:brightness=0.02:saturation=1.05"] [--audio-only]
// - probes each file into edit/media.json
// - extracts edit/main.wav (16 kHz mono, RAW timing) for transcription / silence detection
// - re-encodes videos to the canvas with a dense GOP (every frame seekable for the renderer),
//   loudness-normalised audio, and optional speed-up (pitch-preserving) / colour grade for the main video
// Re-run with only --main to change speed/grade; intro/music entries in media.json are kept.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { args, exists, p, readJson, writeJson } from "./lib.mjs";

function probe(file) {
  const out = execFileSync("ffprobe", [
    "-v", "error", "-show_entries",
    "stream=codec_type,width,height,r_frame_rate:stream_side_data=rotation:format=duration",
    "-of", "json", file,
  ]).toString();
  const j = JSON.parse(out);
  // Phone recordings can carry extra streams (thumbnails as mjpeg "video", metadata data streams):
  // the first video stream is the real one, and every ffmpeg call maps 0:v:0 / 0:a:0 explicitly.
  const v = j.streams.find((s) => s.codec_type === "video");
  const a = j.streams.find((s) => s.codec_type === "audio");
  let width = v?.width, height = v?.height;
  const rot = Math.abs(v?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0);
  if (rot === 90 || rot === 270) [width, height] = [height, width];
  const [n, d] = (v?.r_frame_rate ?? "30/1").split("/").map(Number);
  return { duration: Number(j.format.duration), width, height, fps: v ? +(n / d).toFixed(3) : null, hasVideo: !!v, hasAudio: !!a };
}

// Everything lands at the same loudness so the music bed level means the same thing on any source.
const LOUDNORM = "loudnorm=I=-16:TP=-1.5:LRA=11";

function ff(argv) {
  console.log("ffmpeg", argv.join(" "));
  execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...argv], { stdio: "inherit" });
}

const fit = (W, H) => `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30`;
// Canvas follows the main video: portrait → 1080x1920, landscape → 1920x1080.
const canvasFor = (info) => (info.height > info.width ? { width: 1080, height: 1920 } : { width: 1920, height: 1080 });
const VIDEO_OUT = ["-c:v", "libx264", "-preset", "medium", "-crf", "18", "-g", "30", "-keyint_min", "30", "-pix_fmt", "yuv420p"];
const AUDIO_OUT = ["-c:a", "aac", "-b:a", "192k", "-ar", "48000"];

const media = exists("edit/media.json") ? readJson("edit/media.json") : {};
fs.mkdirSync(p("assets"), { recursive: true });
fs.mkdirSync(p("edit"), { recursive: true });

if (typeof args.main === "string") {
  const info = probe(args.main);
  const canvas = canvasFor(info);
  const speed = Number(args.speed ?? 1);
  const grade = typeof args.grade === "string" ? args.grade : null;
  ff(["-i", args.main, "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", p("edit/main.wav")]);
  media.main = { source: path.resolve(args.main), file: "assets/main.mp4", ...info, speed, grade, canvas };
  if (!args["audio-only"]) {
    const vf = [`setpts=PTS/${speed}`, grade, fit(canvas.width, canvas.height)].filter(Boolean).join(",");
    ff(["-i", args.main, "-map", "0:v:0", "-map", "0:a:0", "-vf", vf, ...VIDEO_OUT,
      "-af", `atempo=${speed},${LOUDNORM}`, ...AUDIO_OUT, "-movflags", "+faststart", p("assets/main.mp4")]);
  }
}

if (typeof args.intro === "string") {
  const info = probe(args.intro);
  const canvas = media.main?.canvas ?? canvasFor(info);
  media.intro = { source: path.resolve(args.intro), file: "assets/intro.mp4", ...info };
  ff(["-i", args.intro, "-map", "0:v:0", ...(info.hasAudio ? ["-map", "0:a:0"] : []), "-vf", fit(canvas.width, canvas.height), ...VIDEO_OUT,
    ...(info.hasAudio ? ["-af", LOUDNORM, ...AUDIO_OUT] : ["-an"]), "-movflags", "+faststart", p("assets/intro.mp4")]);
}

if (typeof args.music === "string") {
  const info = probe(args.music);
  media.music = { source: path.resolve(args.music), file: "assets/music.m4a", ...info };
  ff(["-i", args.music, "-map", "0:a:0", "-vn", "-af", LOUDNORM, ...AUDIO_OUT, p("assets/music.m4a")]);
}

writeJson("edit/media.json", media);
console.log(JSON.stringify(media, null, 2));
