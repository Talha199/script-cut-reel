---
name: script-cut-reel
description: Turn a raw talking-head recording with retakes into a finished, captioned short video using HyperFrames — compare the transcript against the user's script to drop false starts and repeated takes, remove silent pauses, optionally speed up / brighten, slot a branded intro after the hook line, lay a music bed under the speech, and burn in word-highlight captions plus a title card. Use when the user hands over a raw video (often with mistakes and repeated lines), a script, and optionally an intro clip and background music, and wants a clean reel / short / sermon clip / announcement. Works in any language Parakeet transcribes (German, English, Turkish, French, …).
---

# Script-cut reel

Raw recording + script (+ intro, + music) → a tight vertical (or landscape) video with retakes
removed, pauses tightened, captions that follow the voice word by word, and restrained graphics.
Built and rendered with [HyperFrames](https://www.npmjs.com/package/hyperframes) (HTML → MP4).

`<SKILL>` below means this skill's directory. Every script takes `--project <dir>` (default: cwd).

## What the user gives you

| Input | Required | Notes |
|---|---|---|
| Raw recording | yes | Phone HEVC is fine. Retakes, "ach, okay", long silences are expected. |
| Script | yes | The text that *should* be said. It decides which takes survive and fixes caption spelling. |
| Intro clip | no | Plays after a segment you choose (usually the hook line). Its own sound can be muted. |
| Music | no | Bed under the speech, own level during the intro, fades in and out. |

If something is missing, ask once; don't block on optional inputs.

## Workflow

### 1. Environment (first run on a machine)

```bash
npx -y hyperframes@latest doctor
npx -y hyperframes@latest browser ensure          # see gotchas: may hang AFTER finishing
npx -y hyperframes@latest models install parakeet # ~640 MB, multilingual ASR
```

Low RAM (doctor warns under ~2 GB free) → render with `--workers 2` and tell the user that
closing apps helps. Long installs: run them in the background and keep working.

### 2. Project + media

```bash
node <SKILL>/scripts/setup.mjs --project <dir>      # folders, fonts (Fontsource, OFL), GSAP
node <SKILL>/scripts/prep.mjs --project <dir> --main <raw> --intro <intro> --music <music>
```

`prep` writes `edit/main.wav` first (16 kHz, raw timing), then re-encodes everything to the canvas
(portrait source → 1080×1920, landscape → 1920×1080) with a 1-second GOP and −16 LUFS audio. The
main re-encode takes minutes: run it in the background and transcribe meanwhile
(`prep --main <raw> --audio-only` gives you the WAV in seconds).

### 3. Transcribe and read it against the script

```bash
node <SKILL>/scripts/transcribe.mjs --project <dir> --language de
node <SKILL>/scripts/lines.mjs --project <dir>
```

`lines` prints the transcript split at pauses with **raw** timestamps and word indices. Walk it
alongside the script and build a table for the user: raw range · content · keep/cut · why.

Choosing takes:
- A take is broken if it skips or garbles script words, trails off, or is followed by a restart.
- Prefer the **last complete** take — unless an earlier one is complete and the later one isn't.
- When two takes of a closing line are equal, keep the one that runs straight into the next
  section (fewer cuts).
- Cut between takes inside the silence: segment `in` ≈ 0.15–0.25 s before the first kept word,
  `out` ≈ 0.2 s after the last — never reaching into the next take's first word.

### 4. Silences + audit

```bash
node <SKILL>/scripts/silences.mjs --project <dir>   # -35 dB, ≥ 0.25 s
node <SKILL>/scripts/audit.mjs --project <dir>      # after project.json has segments
```

`audit` reports two things inside the kept segments:
1. **Untranscribed speech** — loud gaps between transcript words. Typical: an Arabic phrase
   ("sallallahu alayhi wa sallam") inside German speech, a name, a quote in another language.
   That audio must stay; add a `captionInserts` entry (e.g. `"(s)"`) spanning the gap.
2. **Silence over a word start** — the 50 ms dB trail tells you whether it's really silent. In
   practice the ASR puts sentence-initial words ~0.3 s early and the waveform is right; only if the
   trail shows speech-level values (> −35 dB) inside the silence should you raise `--noise`.

### 5. Author `edit/project.json`

Copy `<SKILL>/templates/project.example.json`; full field reference in
[references/project-schema.md](references/project-schema.md). Essentials:
- `segments` (raw seconds, in play order), `introAfter` (segment index), `introMuted`
- `captionFixes` keyed by transcript word index: script spelling, punctuation, quotation marks
  („…“ for German), `""` to drop filler/ASR artifacts; `captionInserts` for audit item 1
- `title` card (kicker / title / subtitle), `music` levels, `lang`, optional `theme`

Edit JSON with node/Python or the Edit tool, **never PowerShell `Get-Content`/`Set-Content`**
(mangles UTF-8 and adds a BOM — see gotchas).

### 6. Build, check, look

```bash
node <SKILL>/scripts/build.mjs --project <dir>
cd <dir> && npx hyperframes lint
npx hyperframes snapshot --at "1.5,6.0,9.0,30.0,60.0" --no-end
```

Pick snapshot times from `edit/timeline.json` (clip starts, caption `in`s): hook, intro, title,
a quote, the inserted caption, the ending. Read `snapshots/contact-sheet.jpg` and check: captions
readable and clear of the face, title doesn't collide with anything, correct characters
(„ “ · ş ğ), intro where expected. One `lint` warning (`composition_file_too_large`) is expected.

### 7. Render — or hand over the Studio

```bash
npx hyperframes render -o out/<name>.mp4 --fps 30 --quality high --workers 2
```

Render in the background (~8 min per 75 s of 1080×1920 on a laptop iGPU). Verify after:
`ffprobe` duration/size, and `volumedetect` on a speech window vs the intro window. Write each
new version to a new file name so earlier exports survive.

If the user wants to render themselves, start Studio (`npx hyperframes preview <dir>` — in
desktop apps use a launch config with `--foreground --no-open --port 3002`) and point them to
**Export** (top right).

## Common follow-up requests

| Ask | Do |
|---|---|
| "Faster" | `prep.mjs --main <raw> --speed 1.15` (pitch-preserving atempo), rebuild. All authored times stay raw. |
| "Back to normal speed" | `prep.mjs --main <raw> --speed 1`, rebuild. |
| "Brighter / darker" | `grade-test.mjs --main <raw>` → look at `edit/grade-test.png` → `prep.mjs --main <raw> --grade "<filter>"`. Gamma ~1.15–1.2 lifts faces without milky blacks. |
| "Remove the pauses" / "keep pauses" | on by default when `edit/silences.json` exists; `"silence": false` disables, `keepAfter`/`keepBefore` tune the breath. |
| "Mute the intro's own sound" | `"introMuted": true`; raise `music.intro` (0.8–0.9 ≈ speech loudness) so it isn't silent. |
| "Music louder/quieter" | `music.bed` (0.10–0.15 under speech), `music.intro`. |
| "No source tags" | `"refs": []`. |
| "It's longer than the 60 s the hook promises" | say so with numbers; offer speed-up, dropping a paragraph, or tighter silences. |

Re-running `prep --main` keeps the intro/music entries in `edit/media.json`; close Studio first
on Windows (the server can hold the file open).

## Design defaults (restrained on purpose)

Captions: Inter 700, centred, lower-middle (portrait bottom 520 px, clear of platform UI), soft
scrim, ≤ 5 words / 28 chars per phrase, the spoken word turns the accent colour (colour only —
scaling it eats the neighbouring space). Title: Cormorant Garamond with a kicker and a growing
rule, top-left, ~4.5 s after the intro. A thin accent progress line across the top. Fade to black
at the end. Accent default `#e6bf63` (gold) on a dark green-black scrim; `theme` changes it.

## References

- [references/project-schema.md](references/project-schema.md) — every `project.json` field
- [references/gotchas.md](references/gotchas.md) — failures already hit (Windows, ASR, lint, rendering)
