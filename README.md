# script-cut-reel

An agent skill (Claude Code / any agent that reads `SKILL.md`) that turns a **raw talking-head
recording with retakes** into a **finished, captioned Instagram Reel / short** — using your script to
decide what stays — and hands you a publish package with it.

```
raw recording ─┐    retakes & false starts cut · hook first, headline on frame 0 · pauses removed
script ────────┤ ─► (recitation protected) · iPhone HDR tone-mapped · word-by-word captions inside
music ─────────┘    Instagram's safe zones · music bed · −14 LUFS master
                    ─►  1080×1920 MP4  +  cover  +  caption/hashtag/upload checklist
```

Built on [HyperFrames](https://www.npmjs.com/package/hyperframes) (HTML compositions rendered to MP4)
with local, offline transcription (Parakeet TDT v3 for 25 European languages, Whisper large-v3 for
Turkish, Arabic and others).

## Install (Claude Code)

**One command** — installs what's missing (Node 22, ffmpeg, HyperFrames' browser, the transcription
model; it asks before each), puts the skill in `~/.claude/skills/script-cut-reel`, then runs a
one-minute self-test. Re-run it any time to update.

Windows (PowerShell):

```powershell
irm https://raw.githubusercontent.com/Talha199/script-cut-reel/main/install.ps1 | iex
```

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/Talha199/script-cut-reel/main/install.sh | bash
```

**Or as a Claude Code plugin** (managed and updated through `/plugin`). In a Claude Code session:

```text
/plugin marketplace add Talha199/script-cut-reel
/plugin install script-cut-reel@talha199
```

(from a terminal: `claude plugin marketplace add Talha199/script-cut-reel`, then
`claude plugin install script-cut-reel@talha199`). Then tell Claude *"set up script-cut-reel on this
machine"* — it checks the machine and installs what's missing after you agree. Updates: `/plugin` →
Marketplaces → talha199 → Update marketplace (or Enable auto-update; it's off by default for
third-party marketplaces).

Use one of the two, not both — otherwise the skill loads twice.

**Then** just ask Claude: *"Here's my raw video, the script and some music — make a clean Reel."*

Turkish (or Arabic) recordings need one more thing once: transcription uses Whisper large-v3, which
HyperFrames compiles on first use — install CMake and a C++ compiler (Windows: `winget install
Kitware.CMake` plus Visual Studio Build Tools with "Desktop development with C++"; macOS:
`xcode-select --install && brew install cmake`; Debian/Ubuntu: `sudo apt install build-essential cmake git`).
`node scripts/doctor.mjs` shows whether it's ready.

Claude Code asks before running each new kind of command; choose "don't ask again" for `node`,
`npx -y hyperframes@0.8` and `ffmpeg` commands to make edits flow.

## What it does

- **Take selection from the script** — the transcript is printed with timestamps next to your script;
  the agent keeps the best complete take of each passage, cuts restarts ("Ach, okay…") and opens on
  the strongest standalone hook line.
- **Hook headline on the first frame** — 3–6 words naming the topic, while the hook is spoken.
  Instagram measures how many viewers skip within 3 s; the first frame is also the thumbnail.
- **Silence removal from the waveform**, threshold set from the room's noise floor, keeping a short
  breath at each cut — never inside protected ranges (Qur'an recitation, du'a, quoted verses).
- **Audit** that catches speech the ASR dropped (e.g. an Arabic salawat inside German speech) so
  it is never cut, confirms every silence cut is really silent, and suggests a speed from the
  measured speech rate.
- **Captions** that follow the voice word by word, ≤ 22 characters per line, two-line pyramid for long
  phrases, keyword emphasis, a reusable spelling glossary, reading-speed checks. Latin + Latin-Extended
  fonts (German, Turkish, …).
- **Automatic punch-ins** — 100 % ↔ 112 % on jump cuts (hiding the jump) and on keywords, calmly
  spaced, anchored at the eyes; never during recitation or quotes; one optional slow push on the
  thesis line.
- **Quote cards for direct quotes only** — the exact spoken words in quotation marks with a named
  source (a verse, a hadith, a cited author), brightening as they're spoken; paraphrases never get one.
- **Layout inside Instagram's safe zones** (top 14 %, bottom 35 %, sides 6 %, button rail) and the
  3:4 profile-grid crop; `build.mjs --guides` overlays them for checking.
- **Correct picture**: iPhone HLG HDR tone-mapped to BT.709, aspect mismatches cover-cropped (never
  letterboxed — Instagram recommends bordered Reels less), landscape recordings reframed to 9:16.
- **Audio**: optional phone-voice cleanup, music bed ~20 dB under the voice, optional quiet sound
  effects on punch-ins, title and quote cards (our own synthesised set, or your files — peaks aligned
  to the moment), two-pass loudness finalize to −14 LUFS / −1 dBTP, oversized renders re-encoded.
- **Publish package**: cover + 3:4 grid preview, caption skeleton (keyword-first line, one send/save
  CTA, ≤ 5 hashtags), alt text, upload checklist (auto-captions off, Collab, Trial Reels), and what to
  read in Insights afterwards.
- Restrained graphics: hook headline, serif title card, quote cards, optional source chips. No progress bar
  or fade to black by default. Bundled intros live in `intros/` (`prep.mjs --intro hutbe`; plays after the hook).

Why these defaults: [`references/research-2026-10.md`](references/research-2026-10.md) (sources and
evidence grades — what Instagram confirmed vs. creator folklore).

## Requirements (what the installer sets up)

- Node.js ≥ 22 (HyperFrames' minimum), ffmpeg ≥ 5.1 + ffprobe on `PATH` with `zscale` (Windows:
  `winget install Gyan.FFmpeg`, macOS: `brew install ffmpeg`, Debian/Ubuntu: `apt install ffmpeg`)
- HyperFrames 0.8 via `npx` (fetched on demand), its headless browser and the Parakeet model:
  ```bash
  npx -y hyperframes@0.8 browser ensure
  npx -y hyperframes@0.8 models install parakeet
  ```
- Check a machine: `node scripts/doctor.mjs` (lists what's missing and how to fix it), then
  `node scripts/selftest.mjs --render` (the whole pipeline on synthetic media, about a minute).

Tested on Windows 11 (PowerShell and Git Bash, paths with spaces and umlauts) and Debian 12 (Node 22,
Debian's ffmpeg 5.1); macOS not yet. HyperFrames 0.8.143.

## Use the scripts directly

```bash
S=~/.claude/skills/script-cut-reel/scripts
node $S/setup.mjs      --project my-reel
node $S/prep.mjs       --project my-reel --main raw.mp4 --music music.mp3
node $S/transcribe.mjs --project my-reel --language de
node $S/lines.mjs      --project my-reel            # read against the script, choose segments + hook
node $S/silences.mjs   --project my-reel
cp $S/../templates/project.example.json my-reel/edit/project.json   # segments, hook, fixes, title
cp $S/../templates/glossary.de.json     my-reel/edit/glossary.json  # optional
node $S/audit.mjs      --project my-reel
node $S/build.mjs      --project my-reel --guides   # check snapshots against the safe zones…
node $S/build.mjs      --project my-reel            # …then rebuild without guides
npx -y hyperframes@0.8 lint my-reel
node $S/render.mjs     --project my-reel --name reel  # render (GPU when available) → finalize → package
```

Or open the HyperFrames Studio (`npx -y hyperframes@0.8 preview my-reel`), press **Export**, and run
`finalize` / `package` on the export.

| Script | Purpose |
|---|---|
| `setup.mjs` | project folders, fonts (Fontsource, OFL) and GSAP from npm, default sound effects |
| `sfx.mjs` | synthesises the default sound effects (whoosh, swell, thump); `--audition` to listen |
| `prep.mjs` | probe + re-encode main/intro/music; HDR tone-map, cover-crop; `--speed`, `--grade`, `--clean`, `--canvas`, `--fit`, `--audio-only` |
| `transcribe.mjs` | word-level transcript via `hyperframes transcribe` — Parakeet for European languages, Whisper large-v3 for Turkish and others |
| `lines.mjs` | transcript as timed lines with word indices |
| `silences.mjs` | silent stretches from the waveform (auto threshold) |
| `audit.mjs` | untranscribed speech, silence-over-word, speech rate → suggested speed |
| `grade-test.mjs` | side-by-side colour candidates on one frame (naive vs tone-mapped for HDR) |
| `build.mjs` | generates the HyperFrames `index.html` from `edit/project.json`, prints QA; `--guides` |
| `render.mjs` | render with the machine's best settings (auto workers, GPU encode), then finalize + package |
| `finalize.mjs` | two-pass loudness on the render, video copied (re-encoded only above 25 Mbit/s), QA report |
| `package.mjs` | cover + grid preview + `publish.md` (caption skeleton, checklist) |
| `doctor.mjs` | checks Node, ffmpeg filters, HyperFrames, browser, transcription model; prints fixes |
| `selftest.mjs` | end-to-end run on synthetic media (`--render` for render/finalize/package) |

Field reference: [`references/project-schema.md`](references/project-schema.md) ·
Known pitfalls: [`references/gotchas.md`](references/gotchas.md) ·
Research: [`references/research-2026-10.md`](references/research-2026-10.md)

## License

MIT for the code in this repository. Fonts are downloaded at setup time from Fontsource
(Inter, Cormorant Garamond — SIL Open Font License); GSAP is downloaded from npm under its own license.
