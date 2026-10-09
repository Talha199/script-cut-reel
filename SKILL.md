---
name: script-cut-reel
description: Turn a raw talking-head recording with retakes into a finished, captioned Instagram Reel / short using HyperFrames — compare the transcript against the user's script to drop false starts and repeated takes, open on the strongest hook line with a headline on the first frame, remove silent pauses (protecting recitation), tone-map iPhone HDR, optionally speed up, lay a music bed under the speech, burn in word-highlight captions inside Instagram's safe zones, then loudness-finalize and write a publish package (cover, caption skeleton, upload checklist). Use when the user hands over a raw video (often with mistakes and repeated lines), a script, and optionally an intro clip and background music, and wants a clean reel / short / sermon clip / announcement. Works in German, English, French and the other European languages Parakeet covers, and in Turkish or Arabic via Whisper large-v3.
---

# Script-cut reel

Raw recording + script (+ music, + intro) → a tight vertical (or landscape) video with retakes
removed, pauses tightened, the topic on screen from the first frame, captions that follow the voice
word by word, and restrained graphics placed clear of Instagram's interface — plus a publish package.
Built and rendered with [HyperFrames](https://www.npmjs.com/package/hyperframes) (HTML → MP4).

`<SKILL>` below means this skill's directory. Every script takes `--project <dir>` (default: cwd).
The reasoning behind the defaults, with sources and evidence grades, is in
[references/research-2026-10.md](references/research-2026-10.md).

## What the user gives you

| Input | Required | Notes |
|---|---|---|
| Raw recording | yes | Phone HEVC/HDR is fine. Retakes, "ach, okay", long silences are expected. |
| Script | yes | The text that *should* be said. It decides which takes survive, the hook, and caption spelling. |
| Music | no | Bed ~20 dB under the speech. Must be royalty-free/licensed — baked-in commercial music gets Reels muted. |
| Intro clip | no | Not recommended (see "Intro"). If the user insists: ≤ 1.5–2 s, after the hook, never before it. |

If something is missing, ask once; don't block on optional inputs.

## What decides performance (keep in mind throughout)

Instagram's own signals are watch time, likes per reach and **sends per reach** (sends weigh most for
reaching non-followers). Insights show **Skip Rate** — the share of viewers gone within 3 s — and a
per-second retention chart. So: the topic must be clear in the first 3 seconds (spoken *and* written),
every second without information costs viewers, one idea per Reel, and an ending that doesn't say
"swipe now". Reels of 30–90 s reach best; over 3:00 they aren't recommended at all.

## Workflow

### 1. Setup (first run on a machine, or when the user asks to "set up script-cut-reel")

```bash
node <SKILL>/scripts/doctor.mjs                     # what's there, what's missing, how to fix it
```

If `node` itself is missing or the doctor reports ✗ lines, tell the user in one short list what is
missing and what the installer would do (Node 22, ffmpeg via winget/Homebrew/apt, HyperFrames'
browser, the ~640 MB Parakeet model), and **ask**. After a yes, run it in the background — it is
non-interactive with `-Yes`/`--yes`, skips the skill folder with `-DepsOnly`/`--deps-only` (this
copy is already installed), and ends with the doctor and a render self-test:

```bash
powershell -ExecutionPolicy Bypass -File "<SKILL>/install.ps1" -DepsOnly -Yes   # Windows (-SkipModel: no Parakeet)
bash "<SKILL>/install.sh" --deps-only --yes                                    # macOS / Linux (--skip-model)
```

On Linux without Node 22 the installer stops and points to nodejs.org — distribution packages are
too old. When everything is ✓, `node <SKILL>/scripts/selftest.mjs --render` (~1 min) proves the
whole pipeline on this machine.

Needs Node ≥ 22 (HyperFrames' minimum), ffmpeg ≥ 5.1 with zscale (any full build), internet on first
use. Always call HyperFrames as `npx -y hyperframes@0.8 …`: without `-y` npx stops to ask before
installing, and the pinned minor version is the one this skill is tested with.

Turkish, Arabic or another non-European language: transcription uses Whisper large-v3 instead,
which HyperFrames compiles (whisper.cpp) and downloads (~3 GB) on first use — that needs git, cmake
and a C++ compiler (Windows: Visual Studio Build Tools); `doctor` shows what's missing.

Low RAM (doctor warns under ~2 GB free) → `render.mjs --workers 1` and tell the user that closing
apps helps. Long installs: run them in the background and keep working.

### 2. Project + media

```bash
node <SKILL>/scripts/setup.mjs --project <dir>      # folders, fonts (Fontsource, OFL), GSAP
node <SKILL>/scripts/prep.mjs --project <dir> --main <raw> [--music <music>] [--clean]
```

`prep` writes `edit/main.wav` first (16 kHz, raw timing), then re-encodes everything to the canvas
(portrait → 1080×1920, landscape → 1920×1080) with a 1-second GOP, BT.709 colour and −16 LUFS audio:
- **HDR** (iPhone HLG, PQ) is detected and tone-mapped to SDR automatically — untreated it looks grey.
- **Aspect mismatches are cover-cropped**, never letterboxed (Instagram recommends bordered Reels
  less). A landscape sermon recording becomes a Reel with `--canvas portrait --focus-x <0–1>` (where
  the speaker stands); it warns about upscaling.
- `--clean`: high-pass, gentle denoise, de-ess, light compression — for noisy phone audio.

The main re-encode takes minutes: run it in the background and transcribe meanwhile
(`prep --main <raw> --audio-only` gives you the WAV in seconds).

### 3. Transcribe, read it against the script, choose takes and the hook

```bash
node <SKILL>/scripts/transcribe.mjs --project <dir> --language de   # or tr, en, …
node <SKILL>/scripts/lines.mjs --project <dir>
```

The engine follows the language: Parakeet for its 25 European languages (German, English, French, …
— fast, precise word times), Whisper large-v3 for everything else, Turkish included (Parakeet has no
Turkish or Arabic). Neither transcribes Arabic phrases inside German/Turkish speech reliably —
that's what audit item 1 is for.

`lines` prints the transcript split at pauses with **raw** timestamps and word indices. Walk it
alongside the script and build a table for the user: raw range · content · keep/cut · why.

Choosing takes:
- A take is broken if it skips or garbles script words, trails off, or is followed by a restart.
- Prefer the take that matches the script best; on a tie, the **last complete** one.
- When two takes of a closing line are equal, keep the one that runs straight into the next
  section (fewer cuts).
- Cut between takes inside the silence: segment `in` ≈ 0.15–0.25 s before the first kept word,
  `out` ≈ 0.2 s after the last — never reaching into the next take's first word.

Structure (propose it in the table; the user decides):
- **Open on the hook.** The first kept sentence must stand on its own: no connective or back-reference
  ("Und…", "Also…", "dieser Punkt", "Çünkü…", "bu yüzden"). Strong types (Meta's hook guidance):
  value promise, statement of intent, question. Best: point at a *specific* gap in something the
  audience half-knows ("Den zweiten Teil dieses Verses kennen die wenigsten") — not a riddle about
  something unknown, and not the answer itself. If the strongest line sits later in the recording,
  propose moving it to the front (segments may reorder).
- **Cut preamble** ("Hallo zusammen", "liebe Geschwister") before the first real sentence — but a
  salutation, Basmala or salawat can be religiously obligatory: **ask**, and offer to move it to the
  end or into the caption instead of deleting it.
- **One idea per Reel.** If the script holds two, suggest two Reels.
- **Payoff before the last 15–20 %**, and **end on the last meaningful line** — no "das war's",
  no fade. A closing line that echoes the hook invites a rewatch.
- **One call to action**, send-type for sermons/reminders ("Schick das jemandem, der das heute hören
  muss" / "Bunu duyması gereken birine gönder"), save-type for lists/teaching. Never "comment Amin" /
  "like if you agree" — Instagram excludes engagement bait from recommendations.
- **Length:** aim for 45–75 s; say so with numbers when it runs over 90 s.

### 4. Silences + audit

```bash
node <SKILL>/scripts/silences.mjs --project <dir>   # threshold from the measured noise floor
node <SKILL>/scripts/audit.mjs --project <dir>      # after project.json has segments
```

`audit` reports three things inside the kept segments:
1. **Untranscribed speech** — loud gaps between transcript words. Typical: an Arabic phrase
   ("sallallahu alayhi wa sallam") inside German speech, a name, a quote in another language.
   That audio must stay; add a `captionInserts` entry (e.g. `"(s)"`) spanning the gap.
2. **Silence over a word start** — the 50 ms dB trail tells you whether it's really silent. In
   practice the ASR puts sentence-initial words ~0.3 s early and the waveform is right; only if the
   trail shows speech-level values inside the silence should you pass a higher `--noise` (e.g. -40).
3. **Speech rate** — syllables/s after pause removal and a suggested `--speed` (≤ 1.15). It's a
   heuristic: offer it, don't apply it silently, and **never speed up recitation**.

### 5. Author `edit/project.json`

Copy `<SKILL>/templates/project.example.json`; full field reference in
[references/project-schema.md](references/project-schema.md). Essentials:
- `segments` (raw seconds, in play order), `lang` (required — Turkish uppercase needs `"tr"`)
- `hook`: 3–6 words naming the topic, a paraphrase of the spoken hook (not a duplicate of the
  captions); `*word*` for one accent word. It is on the first frame → it is also the thumbnail.
- `title` (kicker / title / subtitle) with `"after": "hook"` — or none, if the hook says it all.
- `protect`: raw ranges of Qur'an recitation, du'a or quoted verses — no pause is cut inside.
- `captionFixes` keyed by transcript word index: script spelling, punctuation, quotation marks
  („…“ for German), `""` to drop filler/ASR artifacts; `captionInserts` for audit item 1
- `captionEmphasis`: word indices of the few keywords that carry the message (≤ 1 per phrase).
  They also trigger punch-ins.
- `zoom`: punch-ins are automatic (on jump cuts and keywords, calm spacing). Set `zoom.origin` to
  the speaker's eye position (check the frame at 0) and, optionally, `zoom.push` on the one thesis
  sentence. `"zoom": false` for a static frame.
- `quotes`: quote cards — **only for direct quotes**, see the rules below.
- `edit/glossary.json`: copy `templates/glossary.de.json` / `glossary.tr.json` and extend it with the
  speaker's names and recurring terms — fixes them in every caption without per-index fixes.
- `music.bed` (0.10 default), optional `theme`. No `introAfter` unless the user asked for the intro.
- `sfx`: off by default. If the user wants sound effects, `"sfx": true` (see "Sound effects").

Edit JSON with node/Python or the Edit tool, **never PowerShell `Get-Content`/`Set-Content`**
(mangles UTF-8 and adds a BOM — see gotchas).

**Quote cards — when, and only when.** A card says "these are someone else's exact words", so it
must be true. Add one only if **all** of these hold:
1. The script marks it as a direct quote: quotation marks, or an explicit attribution followed by the
   words themselves ("Allah sagt im Koran: …", "Der Prophet ﷺ sagte: …", "Mevlânâ diyor ki: …").
2. The speaker says the quoted words verbatim. The card shows exactly the transcript words between
   `src` and `srcEnd`: put `src` on the first quoted word, after "sagte:", and fix spelling with
   `captionFixes`. If the speaker deviates from the script's wording, it's not a card.
3. The source is known from the script or confirmed by the user — never guess a surah/verse
   number, hadith collection or author.

Not a card: paraphrases ("sinngemäß", "es heißt, dass …"), summaries, the speaker's own statements, a
quote the speaker shortens on the fly, and Arabic recitation itself (no Arabic font, and the ASR
doesn't transcribe it). If the translation that follows the recitation is read verbatim, the card
goes on the translation. Keep a card under ~220 characters (split long passages at a sentence end
into consecutive cards) and the cards together under ~35 % of the Reel. `full` (default) suits a
verse or hadith as a moment of its own; `lower` keeps the face visible for shorter quotes.

### 6. Build, check, look

```bash
node <SKILL>/scripts/build.mjs --project <dir> --guides   # safe-zone overlay for checking only
cd <dir> && npx -y hyperframes@0.8 lint
npx -y hyperframes@0.8 snapshot --at "0,1.5,6.0,30.0,60.0" --no-end
node <SKILL>/scripts/build.mjs --project <dir>            # rebuild WITHOUT guides before rendering
```

`build` prints a QA line — length, first word, wpm, caption reading speed, longest pause — and
warnings: over 90 s / over 3:00, first word after 0.3 s, a pause > 0.7 s, phrases over 20 chars/s,
segment edges inside a word, hook/title/refs overlapping in the top band, intro > 2 s. Fix or explain
each one.

Pick snapshot times from `edit/timeline.json`: **0 (the thumbnail)**, the hook, the title, a quote, the
inserted caption, a two-line caption, the ending. Read `snapshots/contact-sheet.jpg` with the guides
on and check:
- nothing that matters in the red zones (top 14 %, bottom 35 %, sides) or under the dashed
  button rail (bottom right);
- hook/title and the face inside the blue **3:4 grid** lines (that crop is the profile grid);
- captions readable and clear of the mouth (if the speaker is framed low, `captions.bottom` 600);
- after a punch-in the eyes stay put and nothing important is cropped (else adjust `zoom.origin`,
  or lower `zoom.punch`); quote cards show the exact words, marks and source;
- correct characters („ “ · ş ğ İ), keywords emphasised sparingly.
One `lint` warning (`composition_file_too_large`) is expected.

### 7. Render, finalize, package

```bash
node <SKILL>/scripts/render.mjs --project <dir> --name <name>   # render → finalize → package
node <SKILL>/scripts/render.mjs --project <dir> --draft         # quick low-quality preview only
```

`render.mjs` picks the fastest settings the machine supports — workers calibrated by HyperFrames,
GPU encoding (NVENC / VideoToolbox / Quick Sync) when one works — never overwrites an earlier export
(`<name>.mp4`, `<name>-2.mp4`, …), refuses a build that still has `--guides`, then runs `finalize`
and `package`. Run it in the background. Time is dominated by HyperFrames capturing one browser
screenshot per frame: ~0.3× realtime for clean frames on a mid-range desktop (a 60 s Reel ≈ 3–4 min),
slower for grainy footage — much slower than an NLE like Resolve, by design. For review, prefer
Studio (`preview`) or `--draft` over full renders.

`finalize` normalises the finished mix in two passes to −14 LUFS / −1 dBTP (`--lufs -16` for a
quieter master; no platform publishes a target), copies the video stream (fixing incomplete colour
tags; re-encoding only above 25 Mbit/s) and checks size, frame rate, codec, colour tags and loudness. `package` grabs the cover (frame 0 when the hook is on
it) plus a preview of the 3:4 grid crop, and writes `<name>.publish.md`. **Fill in its Caption and
Alt text sections** from the transcript at its end: line 1 ≤ ~125 characters with the topic keyword
first, 2–5 sentences, one send/save CTA, ≤ 5 specific hashtags (Instagram's limit). Then show the
user the package — the upload checklist matters (auto-captions off, Collab instead of a second upload,
Trial Reel or not). Nothing is posted by the skill.

If the user wants to render themselves, start Studio (`npx -y hyperframes@0.8 preview <dir>` — in
desktop apps use a launch config with `--foreground --no-open --port 3002`), point them to
**Export** (top right), then run `finalize.mjs <export>` and `package.mjs <export>.final.mp4` on it.

## Sound effects

Off by default: there is no evidence that effects help retention, and on sermons they can feel
cheap. When the user wants them, `"sfx": true` puts quiet accents only where the picture already
moves — punch-ins, the title's entrance, quote cards (and the hook with `"hook": true`). Sources:
- **Defaults** — `assets/sfx/whoosh.wav`, `swell.wav`, `thump.wav`, synthesised by `sfx.mjs`
  (setup runs it): our own, no licence, no tones or instruments. `sfx.mjs --audition` writes
  `out/sfx-audition.wav` to listen to them at mix level.
- **Libraries**, when the user wants a different character: Pixabay sound effects (free, commercial
  use, no attribution), or the HyperFrames media library —
  `npx -y hyperframes@0.8 media-use resolve --type sfx --intent "soft whoosh" --project <dir>`: offline it
  picks from a small bundled Pixabay set (mostly UI/"tech" sounds); signed in to the HeyGen CLI it
  searches HeyGen's large catalog. Put the file in `assets/sfx/` and point the cue at it
  (`"sfx": {"punch": "assets/sfx/air.mp3"}`). Licence-free or royalty-free only — anything baked
  into the video must be cleared, or Instagram may mute the Reel. No music stingers or chimes on
  religious content unless the user asks (instruments).
- Listen on a phone speaker: what is subtle on headphones can vanish there, and the reverse.

## Decisions that belong to the user

Propose a default, explain the trade-off in one line, and ask:

| Decision | Default to propose | Why it's theirs |
|---|---|---|
| Opening greeting / Basmala / salawat | Move out of the first 3 s (to the end or the caption) | Religious and cultural obligation outweighs retention advice |
| Speed-up or pause cuts on recitation, scripture, du'a | `protect` it; speed 1.0 | Tempo and pauses are part of correct recitation |
| Instrumental music | Offer voice-only or a non-instrumental bed too | Many Muslim audiences avoid instruments |
| Brand intro clip | None — the kicker carries the brand; ≤ 1.5–2 s if wanted | The organisation's call; the retention chart can settle it |
| Images / B-roll for spiritual statements | Typographic cards only | Aniconism and tone |
| Call-to-action wording | One send- or save-type line | Some congregations dislike "share" asks |
| Political / social-issue topics | Flag it | Instagram won't recommend it to non-followers |
| Trial Reel, AI dubbing, Collab partner | Suggest per Reel | Audience and account relationships |

## Common follow-up requests

| Ask | Do |
|---|---|
| "Faster" | `audit.mjs` shows the suggested speed; `prep.mjs --main <raw> --speed 1.1`, rebuild. All authored times stay raw. Not with recitation. |
| "Back to normal speed" | `prep.mjs --main <raw> --speed 1`, rebuild. |
| "Brighter / darker" | First check `media.json` → `main.tonemapped` (HDR handled?). Then `grade-test.mjs --main <raw>` → `edit/grade-test.png` → `prep.mjs --main <raw> --grade "<filter>"`. After tone-mapping, gamma 1.0–1.1 is usually enough. |
| "Sounds noisy / boomy" | `prep.mjs --main <raw> --clean`, then re-run `silences.mjs` (the WAV changes too). |
| "Remove the pauses" / "keep pauses" | on by default when `edit/silences.json` exists; `"silence": false` disables, `keepAfter`/`keepBefore` tune the breath, `protect` keeps them in a range. |
| "Add our intro" | Say once what it likely costs (viewers leave in the first seconds); then `prep --intro`, `"introAfter": 0`, warn if > 2 s. `introMuted` + `music.intro` 0.8–0.9 if its sound is unwanted. |
| "No zooms" / "more zooms" | `"zoom": false` / `zoom.minHold` 3 (never below 3 s); `zoom.punch` 1.15 for a stronger punch (≤ 1.2 — the picture softens beyond). |
| "Zoom in on this line" | `captionEmphasis` on its key word (punch-in at that word) or `zoom.push` across the sentence (one per Reel). |
| "Show the verse/quote on screen" | Only if it passes the quote-card rules; otherwise say why (paraphrase, unknown source) and offer the caption emphasis instead. |
| "Add sound effects" / "louder" / "quieter" / "no whoosh on zooms" | `"sfx": true`; `sfx.level` 0.5–1.5; `"sfx": {"punch": false}`. Different sound → see "Sound effects". |
| "Music louder/quieter" | `music.bed` (0.06–0.15; 0.10 ≈ −20 dB under the voice), `music.intro`. |
| "Captions higher/lower" | `captions.bottom` (680 default; ≥ 600 keeps clear of Instagram's caption text). |
| "Make a TikTok/Shorts version" | Upload the same final file: the caption band and title clear TikTok's and Shorts' interfaces too (third-party measurements). |
| "Two hook versions to test" | Build twice with different first segment / `hook`, render both, suggest a Trial Reel for one. |
| "It's longer than the 60 s the hook promises" | say so with numbers; offer speed-up, dropping a paragraph, or tighter silences. |

Re-running `prep --main` keeps the intro/music entries in `edit/media.json`; close Studio first
on Windows (the server can hold the file open).

## Design defaults (restrained on purpose)

Geometry follows Meta's Reels safe zones (top 14 %, bottom 35 %, sides 6 % of 1080×1920) and the 3:4
profile-grid crop (y 240–1680):
- **Hook**: Inter 800, 84 px, centred at y≈330, dark scrim, on the first frame, gone when the spoken
  hook ends. One accent word at most.
- **Captions**: Inter 700, 64 px, ≤ 22 characters per line, block ending at y≈1240 (bottom 680),
  860 px wide, 52 % scrim; ≥ 0.85 s on screen; over-long phrases go to two lines (longer line
  below). The spoken word changes colour only — scaling it eats the neighbouring space. Keywords
  (`captionEmphasis`) are bold + accent; the running highlight then becomes a softer tint.
- **Title**: Cormorant Garamond 700 with a kicker and a growing rule, top-left at y=310, after the hook.
- **Punch-ins**: hard cuts between 100 % and 112 %, on jump cuts (hiding the jump) and keywords, at
  least 4 s apart, anchored at the eyes; none during recitation or quote cards; one optional slow push.
- **Quote cards**: Cormorant Garamond with the language's quotation marks in accent, the source in
  small caps under a short rule; full-frame dim or a lower panel; words brighten as spoken.
- **Motion**: decelerating entrances (`power2.out`, 180–600 ms), no bounce or overshoot.
- **No** progress line, **no** fade to black, **no** default intro. Accent `#e6bf63` (gold) on a dark
  green-black scrim; `theme` changes it.

## References

- [references/project-schema.md](references/project-schema.md) — every `project.json` field
- [references/gotchas.md](references/gotchas.md) — failures already hit (Windows, ASR, HDR, lint, rendering)
- [references/research-2026-10.md](references/research-2026-10.md) — the research behind the defaults
  (hooks, retention, captions, safe zones, loudness, ranking), with sources and evidence grades
