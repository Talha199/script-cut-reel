# Gotchas (all hit in real runs)

## Setup / environment

- **`hyperframes browser ensure` can hang after it has finished.** The download reaches 100 %, the
  files are extracted, and the process sits forever on "Re-downloading the managed browser…" with
  no CPU use. Check `~/.cache/hyperframes/chrome/chrome-headless-shell/<ver>/…/chrome-headless-shell(.exe) --version`;
  if it prints a version, kill the installer — `hyperframes doctor` then shows Chrome ✓. Don't sit
  in a wait loop on it; check the extracted files' size/mtime instead.
- **System Chrome may time out** in `doctor` (`SIGKILL, ETIMEDOUT`); the managed headless shell
  avoids it.
- **Low RAM** (8 GB laptops with ~1 GB free): renders work with `--workers 2`; expect ~8–10 min per
  75 s of 1080×1920 at 30 fps.
- **npm walks up the tree**: installing into a temp folder without its own `package.json` installs
  into the nearest parent project (or nothing). `setup.mjs` writes one first.

## Windows / PowerShell

- `Get-Content` without `-Encoding UTF8` reads UTF-8 as ANSI and `Set-Content -Encoding utf8` writes
  a BOM — together they turn `·` into `Â·`, `„` into `â€ž`, `î` into `Ã®`. Edit JSON with node,
  Python or the Edit tool. `lib.mjs` strips a BOM on read anyway.
- `--at 1.0,9.0,10.0` unquoted becomes a PowerShell array → only the first frame is captured.
  Quote it: `--at "1.0,9.0,10.0"`.
- In `node -e '…'` from Git Bash, `"﻿"` becomes a real BOM character, not the escape — write
  real files for anything non-trivial.
- A preview server can keep `assets/main.mp4` open; stop Studio before re-running `prep --main`.

## Media

- iPhone recordings: HEVC 1728×3072 @ 59.94 plus extra streams (an mjpeg thumbnail counted as
  "video", several data streams). Always `-map 0:v:0 -map 0:a:0`.
- Re-encode with `-g 30 -keyint_min 30`; sparse-GOP sources freeze on seek in the renderer.
- Speed: do it in prep (`setpts` + `atempo`, pitch preserved) and divide raw times by the speed in
  build — simpler and more predictable than `data-playback-rate`. It is global: protected recitation
  spans get sped up too, so keep 1.0 when there is recitation.
- SFX: a whoosh's loudest moment, not its start, belongs on the cut — `build.mjs` measures each file
  and offsets it. A recipe's fade curve matters: `afade curve=qsin` rises steeply (sounds like a hard
  start); `hsin` swells. Sub-bass (< 150 Hz) is inaudible on phone speakers — the thump gets tanh
  harmonics for that.
- Windows SAPI `SpeakProgress.AudioPosition` reports 3× too large with a 48 kHz output format (it
  assumes 16 kHz) — only relevant when faking a test transcript from TTS.
- `silencedetect` compares individual samples, not RMS: an auto threshold must be measured on window
  peaks (`silences.mjs` uses the 10th-percentile 50 ms peak + 6 dB, clamped −45…−30).
- **iPhone video is HLG HDR** (`color_transfer=arib-std-b67`, BT.2020). Converted naively to 8-bit SDR
  it looks grey and flat — which is why "a bit brighter" (gamma 1.18) used to be a standing request.
  `prep.mjs` now tone-maps HLG/PQ to BT.709 automatically. The common recipe (`npl=100` + `hable`)
  does **not** fix it: phone HLG has no mastering metadata, so `tonemap` finds no peak and reference
  white stays at ~76 %. Measured on HLG patches 25/50/75/100 %: naive 25/50/75/100, npl=100 hable
  26/49/76/100, **npl=203 mobius peak=4.93 → 28/56/85/100** (the default). Not yet checked on real
  iPhone footage — look at `grade-test.mjs` (naive | tone-mapped | grades) the first time.
- Grade: compare candidates on one frame (`grade-test.mjs`) before a minutes-long re-encode, always
  against the tone-mapped panel. `eq=gamma=1.3` already looks milky on dark clothing; after tone-mapping
  1.0–1.1 is usually enough.
- Aspect mismatches are cover-cropped, not letterboxed (Instagram recommends bordered Reels less). A
  16:9 intro on a 9:16 Reel loses 68 % of its width — `prep` warns; get a vertical version or use
  `--intro-fit pad` knowingly.
- ffmpeg writes colour tags from the frames, not only from `-color_primaries`: untagged SDR sources need
  `setparams=…bt709` in the chain or the output is tagged "unknown".

## ASR / timing

- Parakeet TDT v3 is excellent on German but **drops Arabic phrases** (salawat after "der
  Prophet") — the gap is ~2 s at normal speech level. Never cut it; `audit.mjs` finds it.
- Sentence-initial word **starts are often ~0.3 s early**, and word **ends stretch into the
  following pause** (e.g. a 1.3 s "Herzen."). The waveform is the truth for silence cuts; mapping a
  word inside a removed pause snaps it to the nearest kept piece, which also fixes early captions.
- Small words get dropped ("Hier ist [es] in 60 Sekunden", "sondern [mit dem] Herzen") — repair
  with `captionFixes` from the script, but only if the audio actually contains them.
- Filler artifacts at the end ("barakato **and** und") → `captionFixes: ""`.

## HyperFrames lint / render

- `gsap_css_transform_conflict`: an element with CSS `transform: translateX(-50%)` that GSAP also
  moves. Centre with `left:0; right:0; margin:0 auto; width:max-content` instead.
- `duplicate_audio_track`: adjacent clips of the same file on one track overlap after frame
  rounding → alternate `data-track-index` 0/1.
- `overlapping_gsap_tweens` at clip boundaries: end each step one frame early.
- Scaling the highlighted caption word (`scale: 1.06`) visually eats the space to its neighbour —
  highlight by colour only.
- Removing a multi-line CSS rule with `sed '/selector/d'` leaves its continuation line behind →
  `css_parse_error`. Edit generator source with a real editor.
- `composition_file_too_large` (one long generated file) is expected and harmless here.
- `build.mjs --guides` writes the safe-zone overlay **into index.html**. Rebuild without it before
  rendering; `finalize.mjs` flags a render that still has guides (from `edit/timeline.json`).
- `render --quality high` has no bitrate cap: grainy footage came out at ~270 Mbit/s (963 MB for 28 s).
  `finalize.mjs` re-encodes above 25 Mbit/s (CRF 18, ≤ 16 Mbit/s); Instagram serves ~3–4 Mbit/s anyway.
- HyperFrames already encodes BT.709 / TV range and tags it; `finalize.mjs` copies the video stream
  and only re-encodes audio (two-pass loudnorm), so the picture is never encoded twice.
