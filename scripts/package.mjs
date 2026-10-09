// Publish package next to the finished MP4: cover frame + 3:4 grid preview, and <name>.publish.md
// with file QA, a caption/alt-text skeleton, the upload checklist and what to read in Insights later.
//   node <skill>/scripts/package.mjs out/reel.final.mp4 [--cover-at <s>]
// The agent then writes the caption, hashtags and alt text into the .publish.md (from the transcript at
// its end) and shows it to the user — nothing is posted from here.
import fs from "node:fs";
import path from "node:path";
import { args, exists, ff, p, probe, readJson } from "./lib.mjs";

const video = args._[0] ? path.resolve(args._[0]) : null;
if (!video || !fs.existsSync(video)) throw new Error("usage: package.mjs <final.mp4> [--cover-at <seconds>]");
const base = video.replace(/(\.final)?\.mp4$/i, "");
const name = path.basename(base);
const project = readJson("edit/project.json");
const timeline = exists("edit/timeline.json") ? readJson("edit/timeline.json") : {};
const qaFile = video.replace(/\.mp4$/i, ".qa.json");
const qa = fs.existsSync(qaFile) ? JSON.parse(fs.readFileSync(qaFile, "utf8")) : null;
const lang = (timeline.lang ?? project.lang ?? "en").slice(0, 2);

// Cover: the first frame already carries the hook/title when they start at 0 — that is also what the
// Reels feed shows before playback. Otherwise take a frame once the hook/title is fully in.
const firstText = Math.min(timeline.hook?.t ?? Infinity, timeline.title?.t ?? Infinity);
const coverAt = Number(args["cover-at"] ?? (firstText === Infinity || firstText < 0.04 ? 0 : firstText + 0.8));
const H = probe(video).height, W = probe(video).width;
ff(["-ss", String(coverAt), "-i", video, "-frames:v", "1", "-q:v", "2", "-update", "1", `${base}.cover.jpg`]);
if (H > W) ff(["-ss", String(coverAt), "-i", video, "-frames:v", "1", "-vf", `crop=${W}:${Math.round(W * 4 / 3)}`, "-q:v", "2", "-update", "1", `${base}.cover-grid.jpg`]);

const T = {
  de: { send: "Schick das jemandem, der das heute hören muss.", save: "Speicher dir das für später." },
  tr: { send: "Bunu duyması gereken birine gönder.", save: "Sonra tekrar dinlemek için kaydet." },
  en: { send: "Send this to someone who needs to hear this today.", save: "Save this for later." },
}[lang] ?? { send: "<send-type CTA in the video's language>", save: "<save-type CTA>" };

const transcript = (timeline.captions ?? []).map((c) => c.text).join(" ");
const dur = qa?.duration ?? timeline.total;
const flags = [
  `length ${dur?.toFixed?.(1)} s${dur > 180 ? " — OVER 3:00" : dur > 90 ? " — over 90 s" : ""}`,
  `speed ${timeline.speed ?? 1}×`,
  `protected spans ${(project.protect ?? []).length}`,
  `intro ${project.introAfter !== undefined && project.introAfter !== null ? `after segment ${project.introAfter}` : "none"}`,
  `music ${project.music ? `bed ${project.music.bed ?? 0.1}` : exists("edit/media.json") && readJson("edit/media.json").music ? "default bed" : "none"}`,
];

const md = `# Publish package — ${name}   (${lang})

## File QA
${qa ? `${qa.file} · ${qa.duration} s · ${qa.sizeMB} MB
${qa.video} · colour ${qa.color}
${qa.audio} · ${qa.loudness} LUFS · true peak ${qa.truePeak} dBTP${qa.firstWord !== undefined ? ` · first word ${qa.firstWord?.toFixed(2)} s · captions ≤ ${qa.maxCaptionCps} chars/s` : ""}
${qa.issues.length ? qa.issues.map((x) => `**! ${x}**`).join("\n") : "No QA issues."}` : "**Not finalized — run finalize.mjs on the render first (loudness, QA).**"}
Flags: ${flags.join(" · ")}

## Cover
${name}.cover.jpg (frame at ${coverAt.toFixed(2)} s)${H > W ? ` · ${name}.cover-grid.jpg = how the 3:4 profile grid crops it` : ""}
Check: face and headline both inside the grid preview; headline readable at thumbnail size.

## Caption (paste as-is)
<!-- Agent: write this from the transcript below. Line 1 ≤ ~125 characters with the topic keyword first
     (it shows before "more" and is what search indexes). 2–5 sentences of summary with natural keywords,
     speaker / organisation / date where relevant. ONE call to action. Max 5 specific hashtags.
     No "comment Amin / like if you agree" prompts: Instagram treats them as engagement bait. -->
${timeline.hook?.text ?? project.title?.title ?? "<topic keyword first: the one idea of this Reel>"}

<summary>

${T.send}

<#hashtag1 #hashtag2 #hashtag3 (max 5)>

Alternative CTA for list / teaching clips: ${T.save}

## Alt text
<!-- Agent: one sentence — who speaks, where, about what. -->
<alt text>

## Upload checklist
- [ ] Upload this file natively (not a TikTok/CapCut download — watermarks are demoted)
- [ ] Advanced settings → auto-generated captions OFF (captions are burned in; both at once are unreadable)
- [ ] Cover → upload ${name}.cover.jpg; check the grid-crop preview in the app
- [ ] ≤ 5 hashtags; no engagement-bait prompts
- [ ] Two accounts want it (mosque + speaker)? One Collab post — not two uploads of the same file
- [ ] Location tag (mosque / city) if it applies
- [ ] Music: the baked-in bed must be royalty-free/licensed; Instagram's library is Sound Collection only for business accounts
- [ ] Trial Reel (shown to non-followers first)? Good for evergreen clips and hook tests — not for dated announcements
- [ ] Meta AI translation${lang === "de" ? " (German is supported): dubbed audio would play under the German captions — decide consciously" : lang === "tr" ? ": Turkish is not supported (Oct 2026)" : ": check whether it is on, it changes the audio under your captions"}
- [ ] Political or social-issue topic? Instagram won't recommend it to non-followers — expect follower reach only
- [ ] Posting time: start with a midweek early evening (or Thursday evening before Jumu'ah for Friday topics), then iterate on your own Insights
- [ ] Cross-post the same master to TikTok / YouTube Shorts if wanted (≤ 3 min)

## After 24–48 h
Open the Reel's Insights → Skip Rate and the retention chart. Compare with your own last Reels, not
vendor benchmarks.
- Cliff in the first 3 s → the hook (spoken line, headline or first frame) didn't land.
- Dip at ${project.introAfter !== undefined && project.introAfter !== null ? "the intro" : "the title card"} → shorten or drop it.
- Slow slide → pacing; tighter cuts or a shorter Reel.
- Drop before the payoff → move the payoff earlier.
- Sends and saves per reach matter more than likes for reaching non-followers.

## Transcript (for writing the caption and alt text)
${transcript || "(timeline.json not found)"}
`;
fs.writeFileSync(`${base}.publish.md`, md);
console.log(`${name}.publish.md · ${name}.cover.jpg${H > W ? ` · ${name}.cover-grid.jpg` : ""} → ${path.dirname(base)}`);
console.log("next: fill in Caption / Alt text in the .publish.md from the transcript, then show it to the user");
