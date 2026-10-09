#!/usr/bin/env bash
# script-cut-reel setup for macOS and Linux - everything the skill needs, then a self-test.
#
#   curl -fsSL https://raw.githubusercontent.com/Talha199/script-cut-reel/main/install.sh | bash
#   curl -fsSL https://raw.githubusercontent.com/Talha199/script-cut-reel/main/install.sh | bash -s -- --skip-model
#
# or from a clone / the installed plugin:  bash install.sh [options]
#   --deps-only    don't install the skill folder (you installed the Claude Code plugin instead)
#   --yes          don't ask before each install (for Claude Code to run after you agreed in chat)
#   --skip-model   skip the Parakeet transcription model (~640 MB)
#   --skill-dir D  where the skill goes (default: ~/.claude/skills/script-cut-reel)
# Safe to re-run: installs only what's missing, updates the skill folder, never touches other settings.
set -euo pipefail

REPO="https://github.com/Talha199/script-cut-reel"
HF="hyperframes@0.8"
DEPS_ONLY=0 YES=0 SKIP_MODEL=0
SKILL_DIR="$HOME/.claude/skills/script-cut-reel"
while [ $# -gt 0 ]; do
  case "$1" in
    --deps-only) DEPS_ONLY=1 ;;
    --yes) YES=1 ;;
    --skip-model) SKIP_MODEL=1 ;;
    --skill-dir) SKILL_DIR="$2"; shift ;;
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
  shift
done

say() { printf '\n== %s\n' "$1"; }
ok() { printf '  ok  %s\n' "$1"; }
die() { printf '\n  x   %s\n' "$1" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }
ask() {
  [ "$YES" = 1 ] && return 0
  local a
  # No terminal to ask on (CI, Claude Code): never assume yes - that's what --yes is for.
  { read -r -p "  $1 [Y/n] " a </dev/tty; } 2>/dev/null || { echo "  $1 -> no terminal to ask; re-run with --yes to allow it"; return 1; }
  case "$a" in n|N|no|No) return 1 ;; *) return 0 ;; esac
}
SUDO=""; [ "$(id -u)" != 0 ] && have sudo && SUDO="sudo"
OS="$(uname -s)"
pkg_install() { # $1 = what, then brew / apt package names
  local what="$1" brewpkg="$2" aptpkg="$3"
  if [ "$OS" = Darwin ]; then
    have brew || die "$what is missing - install Homebrew (https://brew.sh) or $what yourself, then run this again."
    ask "$what is missing. Install it with Homebrew ($brewpkg)?" || die "$what is required."
    brew install $brewpkg
  elif have apt-get; then
    ask "$what is missing. Install it with apt ($aptpkg)?" || die "$what is required."
    $SUDO apt-get update -qq && $SUDO apt-get install -y $aptpkg
  else
    die "$what is missing - install it with your package manager, then run this again."
  fi
}

say "Node.js 22 or newer"
major=0; have node && major="$(node -p "process.versions.node.split('.')[0]")"
if [ "$major" -lt 22 ]; then
  if [ "$OS" = Darwin ]; then pkg_install "Node.js 22+" node ""
  else die "Node.js 22+ is required (found: ${major/#0/none}). Debian/Ubuntu ship older versions - install 22 LTS via https://nodejs.org/en/download (nvm or NodeSource), then run this again."
  fi
fi
ok "Node $(node --version)"

say "ffmpeg (with zscale for iPhone HDR)"
have ffmpeg || pkg_install "ffmpeg" ffmpeg ffmpeg
if ffmpeg -hide_banner -filters 2>/dev/null | grep -qE '^\s*\S+\s+zscale\s'; then ok "$(ffmpeg -hide_banner -version | head -1 | sed 's/ Copyright.*//')"
else echo "  !   this ffmpeg has no zscale - iPhone HDR video will look grey. Homebrew and Debian/Ubuntu builds include it."; fi

if [ "$OS" = Linux ] && have apt-get; then
  # Libraries headless Chrome needs on a bare Debian/Ubuntu (desktops usually have them already).
  libs="libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 fonts-liberation"
  missing=""; for l in $libs; do dpkg -s "$l" >/dev/null 2>&1 || missing="$missing $l"; done
  dpkg -s libasound2 >/dev/null 2>&1 || dpkg -s libasound2t64 >/dev/null 2>&1 || missing="$missing $(apt-cache show libasound2t64 >/dev/null 2>&1 && echo libasound2t64 || echo libasound2)"
  if [ -n "$missing" ]; then
    ask "Headless Chrome needs:$missing. Install with apt?" && { $SUDO apt-get update -qq && $SUDO apt-get install -y --no-install-recommends $missing; } || echo "  !   skipped - rendering may fail"
  fi
fi

if [ "$DEPS_ONLY" = 0 ]; then
  say "Skill -> $SKILL_DIR"
  have git || pkg_install "git" git git
  if [ -d "$SKILL_DIR/.git" ]; then git -C "$SKILL_DIR" pull --ff-only; ok "updated"
  elif [ -e "$SKILL_DIR" ]; then die "$SKILL_DIR exists but isn't a git clone - move it away and run this again."
  else mkdir -p "$(dirname "$SKILL_DIR")"; git clone --depth 1 "$REPO" "$SKILL_DIR"; ok "installed"; fi
  SCRIPTS="$SKILL_DIR/scripts"
else
  SCRIPTS="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd)/scripts"
  [ -f "$SCRIPTS/doctor.mjs" ] || die "--deps-only must run from the skill folder (install.sh next to scripts/)."
fi

say "HyperFrames browser (headless Chrome)"
# `browser ensure` has been seen to hang after finishing; watch for the browser instead of waiting forever.
npx -y "$HF" browser ensure >/tmp/scr-browser.log 2>&1 &
pid=$!
for _ in $(seq 1 120); do
  kill -0 "$pid" 2>/dev/null || break
  sleep 5
  if find "$HOME/.cache/hyperframes/chrome" -name 'chrome-headless-shell' -type f 2>/dev/null | grep -q .; then sleep 15; break; fi
done
kill "$pid" 2>/dev/null || true
ok "browser step done (doctor checks it below)"

if [ "$SKIP_MODEL" = 0 ]; then
  say "Parakeet transcription model (~640 MB, German/English/French/... - Turkish uses Whisper, see README)"
  if ask "Download it now?"; then npx -y "$HF" models install parakeet; ok "installed"; fi
fi

say "Checking the machine"
node "$SCRIPTS/doctor.mjs" $([ "$SKIP_MODEL" = 1 ] && echo --skip-model) || die "Something required is missing - fix the lines marked with x above, then run this again."
say "Self-test (synthetic media, about a minute)"
node "$SCRIPTS/selftest.mjs" --render || die "Self-test failed - see the output above."

printf '\nReady. In Claude Code, try: "Here'"'"'s my raw video and the script - make a clean Reel."\n'
