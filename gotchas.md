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
  build — simpler and more predictable than `data-playback-rate`.
- Grade: compare candidates on one frame (`grade-test.mjs`) before a minutes-long re-encode.
  `eq=gamma=1.3` already looks milky on dark clothing; ~1.18 is a safe "a bit brighter".

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
