# script-cut-reel setup for Windows - everything the skill needs, then a self-test.
#
#   irm https://raw.githubusercontent.com/Talha199/script-cut-reel/main/install.ps1 | iex
#
# with options:  & ([scriptblock]::Create((irm https://raw.githubusercontent.com/Talha199/script-cut-reel/main/install.ps1))) -SkipModel
# from a clone / the installed plugin:  powershell -ExecutionPolicy Bypass -File install.ps1 [options]
#   -DepsOnly    don't install the skill folder (you installed the Claude Code plugin instead)
#   -Yes         don't ask before each install (for Claude Code to run after you agreed in chat)
#   -SkipModel   skip the Parakeet transcription model (~640 MB)
#   -SkillDir    where the skill goes (default: ~\.claude\skills\script-cut-reel)
# Safe to re-run: installs only what's missing, updates the skill folder, never touches other settings.
param([switch]$DepsOnly, [switch]$Yes, [switch]$SkipModel, [string]$SkillDir = "$HOME\.claude\skills\script-cut-reel")

$ErrorActionPreference = "Stop"
$Repo = "https://github.com/Talha199/script-cut-reel"
$HF = "hyperframes@0.8"

function Say($m) { Write-Host "`n== $m" -ForegroundColor Cyan }
function Ok($m) { Write-Host "  ok  $m" -ForegroundColor Green }
function Ask($q) { if ($Yes) { return $true }; return ((Read-Host "  $q [Y/n]") -notmatch '^(n|no)$') }
function Check($what) { if ($LASTEXITCODE -ne 0) { throw "$what failed (exit $LASTEXITCODE)." } }
function Have($c) { return [bool](Get-Command $c -ErrorAction SilentlyContinue) }
function RefreshPath { $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User") }
function WingetInstall($id, $what) {
  if (-not (Have winget)) { throw "$what is missing and winget isn't available - install it manually, then run this again." }
  if (-not (Ask "$what is missing. Install it with winget ($id)?")) { throw "$what is required." }
  winget install --id $id -e --source winget --accept-source-agreements --accept-package-agreements
  RefreshPath
}

Say "Node.js 22 or newer"
$major = 0
if (Have node) { $major = [int](node -p "process.versions.node.split('.')[0]") }
if ($major -lt 22) { WingetInstall "OpenJS.NodeJS.LTS" "Node.js 22+ (found: $(if ($major) { "v$major" } else { 'none' }))" } else { Ok "Node $(node --version)" }

Say "ffmpeg (with zscale for iPhone HDR)"
if (-not (Have ffmpeg)) { WingetInstall "Gyan.FFmpeg" "ffmpeg" }
if (-not (Have ffmpeg)) { throw "ffmpeg still not on PATH - open a new terminal and run this again." }
$filters = (ffmpeg -hide_banner -filters 2>$null) -join "`n"
if ($filters -match '\szscale\s') { Ok ((ffmpeg -hide_banner -version | Select-Object -First 1) -replace ' Copyright.*', '') }
else { Write-Host "  !   this ffmpeg has no zscale - iPhone HDR video will look grey. 'winget install Gyan.FFmpeg' provides a full build." -ForegroundColor Yellow }

if (-not $DepsOnly) {
  Say "Skill -> $SkillDir"
  if (-not (Have git)) { WingetInstall "Git.Git" "git" }
  if (Test-Path (Join-Path $SkillDir ".git")) { git -C $SkillDir pull --ff-only; Check "git pull"; Ok "updated" }
  elseif (Test-Path $SkillDir) { throw "$SkillDir exists but isn't a git clone - move it away and run this again." }
  else { New-Item -ItemType Directory -Force (Split-Path $SkillDir) | Out-Null; git clone --depth 1 $Repo $SkillDir; Check "git clone"; Ok "installed" }
  $Scripts = Join-Path $SkillDir "scripts"
} else {
  $Scripts = Join-Path $PSScriptRoot "scripts"
  if (-not $PSScriptRoot -or -not (Test-Path $Scripts)) { throw "-DepsOnly must run from the skill folder (install.ps1 next to scripts\)." }
}

Say "HyperFrames browser (headless Chrome)"
# `browser ensure` has been seen to hang after finishing; watch for the browser instead of waiting forever.
$job = Start-Job { param($hf) npx -y $hf browser ensure 2>&1 } -ArgumentList $HF
$ready = $false
for ($i = 0; $i -lt 120 -and -not $ready; $i++) {
  if ($job.State -ne "Running") { break }
  Start-Sleep -Seconds 5
  $ready = [bool](Get-ChildItem "$HOME\.cache\hyperframes\chrome" -Recurse -Filter "chrome-headless-shell.exe" -ErrorAction SilentlyContinue)
}
if ($job.State -eq "Running") { Start-Sleep -Seconds 15 }
Stop-Job $job -ErrorAction SilentlyContinue; Remove-Job $job -Force -ErrorAction SilentlyContinue
Ok "browser step done (doctor checks it below)"

if (-not $SkipModel) {
  Say "Parakeet transcription model (~640 MB, German/English/French/... - Turkish uses Whisper, see README)"
  if (Ask "Download it now?") { npx -y $HF models install parakeet; Check "Parakeet install"; Ok "installed" }
}

Say "Checking the machine"
$doctorArgs = @(Join-Path $Scripts "doctor.mjs"); if ($SkipModel) { $doctorArgs += "--skip-model" }
node @doctorArgs
if ($LASTEXITCODE -ne 0) { throw "Something required is missing - fix the lines marked with x above, then run this again." }
Say "Self-test (synthetic media, about a minute)"
node (Join-Path $Scripts "selftest.mjs") --render
if ($LASTEXITCODE -ne 0) { throw "Self-test failed - see the output above." }

Write-Host "`nReady. In Claude Code, try: `"Here's my raw video and the script - make a clean Reel.`"" -ForegroundColor Green
