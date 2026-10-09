# script-cut-reel

An agent skill (Claude Code / any agent that reads `SKILL.md`) that turns a **raw talking-head
recording with retakes** into a **finished, captioned short video** — using your script to decide
what stays.

```
raw recording ─┐
script ────────┼─►  retakes & false starts cut · pauses removed · optional speed-up / brightening
intro clip ────┤    intro after the hook · music bed · word-by-word captions · title card
music ─────────┘                                  ─►  1080×1920 MP4 (or 1920×1080)
```

Built on [HyperFrames](https://www.npmjs.com/package/hyperframes) (HTML compositions rendered to MP4)
with local, offline transcription (Parakeet TDT v3, 25 European languages).

## What it does

- **Take selection from the script** — the transcript is printed with timestamps next to your script;
  the agent keeps the last complete take of each passage and cuts restarts ("Ach, okay…").
- **Silence removal from the waveform**, not the ASR, keeping a short breath at each cut.
- **Audit** that catches speech the ASR dropped (e.g. an Arabic salawat inside German speech) so
  it is never cut, and confirms every silence cut is really silent.
- **Captions** that follow the voice word by word (accent colour on the spoken word), with spelling
  and punctuation corrected against the script. Latin + Latin-Extended fonts (German, Turkish, …).
- **Intro** slotted after any segment (optionally muted), **music bed** with its own intro level and
  fades, everything loudness-normalised to −16 LUFS.
- **Speed** (pitch-preserving) and **colour grade** as one-flag re-encodes; restrained graphics:
  title card, progress line, optional source chips, fade to black.

## Requirements

- Node.js ≥ 18, ffmpeg + ffprobe on `PATH`
- `npx hyperframes` (fetched on demand), its headless browser and the Parakeet model:
  ```bash
  npx -y hyperframes@latest browser ensure
  npx -y hyperframes@latest models install parakeet
  ```

## Install as a skill

```bash
# Claude Code (personal skills)
git clone https://github.com/Talha199/script-cut-reel ~/.claude/skills/script-cut-reel
```

Then just ask: *"Here's my raw video, the script, an intro and some music — make a clean reel."*

## Use the scripts directly

```bash
S=~/.claude/skills/script-cut-reel/scripts
node $S/setup.mjs      --project my-reel
node $S/prep.mjs       --project my-reel --main raw.mp4 --intro intro.mp4 --music music.mp3
node $S/transcribe.mjs --project my-reel --language de
node $S/lines.mjs      --project my-reel            # read against the script, choose segments
node $S/silences.mjs   --project my-reel
cp $S/../templates/project.example.json my-reel/edit/project.json   # edit segments, fixes, title
node $S/audit.mjs      --project my-reel
node $S/build.mjs      --project my-reel
cd my-reel && npx hyperframes lint && npx hyperframes render -o out/reel.mp4 --workers 2
```

Or open the HyperFrames Studio (`npx hyperframes preview my-reel`) and press **Export**.

| Script | Purpose |
|---|---|
| `setup.mjs` | project folders, fonts (Fontsource, OFL) and GSAP from npm |
| `prep.mjs` | probe + re-encode main/intro/music; `--speed`, `--grade`, `--audio-only` |
| `transcribe.mjs` | word-level transcript via `hyperframes transcribe` (Parakeet) |
| `lines.mjs` | transcript as timed lines with word indices |
| `silences.mjs` | silent stretches from the waveform |
| `audit.mjs` | untranscribed speech + silence-over-word checks |
| `grade-test.mjs` | side-by-side brightness/colour candidates on one frame |
| `build.mjs` | generates the HyperFrames `index.html` from `edit/project.json` |

Field reference: [`references/project-schema.md`](references/project-schema.md) ·
Known pitfalls: [`references/gotchas.md`](references/gotchas.md)

## License

MIT for the code in this repository. Fonts are downloaded at setup time from Fontsource
(Inter, Cormorant Garamond — SIL Open Font License); GSAP is downloaded from npm under its own license.
