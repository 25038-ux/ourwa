<#
.SYNOPSIS
  Update the El Mourad server (Hostinger VPS) from this PC, over SSH only.
  No git, no Git Bash: PowerShell and Windows' built-in OpenSSH (ssh.exe, scp.exe).

.DESCRIPTION
  1. Checks the zip (elmourad-<version>.zip, as built by tools/packager.sh zip).
  2. Asks for confirmation.
  3. Uploads the zip and a small update script to /root/ on the server (one scp).
  4. Runs the update on the server (one ssh):
       - backup first: database + attachments -> /root/sauvegardes-elmourad
       - replaces the code in /opt/elmourad, KEEPING deploy/elmourad/.env
         (passwords, keys) and deploy/elmourad/secrets/ (Firebase key)
       - re-runs install.sh: rebuilds images, applies migrations, restarts
     The database and attachments live in Docker volumes: they are not touched.
  5. Checks https://api.<domain>/health and the login page from this PC.

  Never runs `docker compose down -v`, never seeds demo data, never touches the
  school or the direction account (install.sh only creates them if missing).

.PARAMETER Zip
  Path to elmourad-<version>.zip. Default: the newest elmourad-*.zip found in
  ..\..\dist (the repository), next to this script, or in Downloads.

.PARAMETER Server
  SSH target. Default: root@187.7.18.252

.PARAMETER Key
  Optional path to the PRIVATE half of an SSH key added to the VPS
  (hPanel -> VPS -> SSH keys). Without it, the root password is asked twice.

.PARAMETER Yes
  Skip the confirmation question.

.PARAMETER DryRun
  Check the zip and prepare the upload, but do not contact the server.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\mettre-a-jour.ps1
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\mettre-a-jour.ps1 -Zip C:\Users\me\Downloads\elmourad-0.7.4+13.zip -Key C:\Users\me\.ssh\id_ed25519
#>
[CmdletBinding()]
param(
  [string]$Zip = '',
  [string]$Server = 'root@187.7.18.252',
  [string]$Domain = 'elmouradarafat.cloud',
  [string]$Key = '',
  [switch]$Yes,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
function Ok([string]$m)    { Write-Host "[OK] $m" -ForegroundColor Green }
function Warn([string]$m)  { Write-Host "[!]  $m" -ForegroundColor Yellow }
function Fail([string]$m)  { Write-Host "[X]  $m" -ForegroundColor Red; exit 2 }
function Title([string]$m) { Write-Host ""; Write-Host "== $m ==" -ForegroundColor Cyan }

# --- 0. Tools ---------------------------------------------------------------
foreach ($t in 'ssh.exe', 'scp.exe') {
  if (-not (Get-Command $t -ErrorAction SilentlyContinue)) {
    Fail "$t not found. Windows: Settings > System > Optional features > add 'OpenSSH Client'."
  }
}

# --- 1. The zip -------------------------------------------------------------
Title '1. The package'
if ($Zip -eq '') {
  $places = @(
    (Join-Path $PSScriptRoot '..\..\dist'),
    $PSScriptRoot,
    (Join-Path $env:USERPROFILE 'Downloads')
  )
  $found = @()
  foreach ($p in $places) {
    if (Test-Path $p) {
      $found += Get-ChildItem -Path $p -Filter 'elmourad-*.zip' -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Name -notlike '*parent*' }
    }
  }
  if ($found.Count -eq 0) { Fail 'No elmourad-*.zip found. Give it with -Zip C:\path\elmourad-<version>.zip' }
  $Zip = ($found | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
}
if (-not (Test-Path $Zip)) { Fail "Zip not found: $Zip" }
$Zip = (Resolve-Path $Zip).Path

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($Zip)
try {
  $names = $archive.Entries | ForEach-Object { $_.FullName }
  $top = ($names | Where-Object { $_ -match '^[^/]+/' } | ForEach-Object { ($_ -split '/')[0] } | Select-Object -Unique)
  if (@($top).Count -ne 1) { Fail "Unexpected zip layout (expected one top folder): $Zip" }
  $top = @($top)[0]
  if ($names -notcontains "$top/deploy/elmourad/install.sh") { Fail "Not an El Mourad package: $top/deploy/elmourad/install.sh is missing." }
  $bad = $names | Where-Object { $_ -match '/deploy/elmourad/\.env$|/secrets/|\.jks$|key-[^/]*\.properties$' }
  if ($bad) { Fail "The zip contains secrets it must not carry: $($bad -join ', ')" }
  $built = ''
  $entry = $archive.Entries | Where-Object { $_.FullName -eq "$top/VERSION.txt" } | Select-Object -First 1
  if ($entry) {
    $reader = New-Object System.IO.StreamReader($entry.Open())
    $built = $reader.ReadToEnd().Trim()
    $reader.Close()
  }
} finally {
  $archive.Dispose()
}
$version = $top -replace '^elmourad-', ''
Ok "Package: $Zip"
Ok "Version: $version"
if ($built -ne '') { Ok "Built:   $built" }

# --- 2. What will be uploaded ------------------------------------------------
# The server-side script. Plain ASCII, LF line endings (bash refuses CRLF).
$remote = @'
#!/usr/bin/env bash
# El Mourad - server side of mettre-a-jour.ps1. Run as root.
set -euo pipefail
ZIP="$1"
DIR=/opt/elmourad
ok()   { printf '\033[32m[OK] %s\033[0m\n' "$*"; }
fail() { printf '\033[31m[X]  %s\033[0m\n' "$*" >&2; exit 2; }
step() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }

[ "$(id -u)" -eq 0 ] || fail "Run as root."
[ -f "$DIR/deploy/elmourad/.env" ] || fail "No El Mourad installation in $DIR (first install: deploy/elmourad/README.md)."
[ -f "$ZIP" ] || fail "Package not found on the server: $ZIP"
command -v unzip >/dev/null || apt-get -qq install -y unzip >/dev/null
command -v rsync >/dev/null || apt-get -qq install -y rsync >/dev/null

step "1/4 Backup (database + attachments)"
cd "$DIR/deploy/elmourad"
if [ -f ./sauvegarde.sh ]; then
  bash ./sauvegarde.sh < /dev/null
  ok "backup in /root/sauvegardes-elmourad"
else
  fail "sauvegarde.sh missing in $DIR/deploy/elmourad: refusing to update without a backup."
fi

step "2/4 Unpack"
rm -rf /tmp/maj-elmourad && mkdir -p /tmp/maj-elmourad
unzip -q "$ZIP" -d /tmp/maj-elmourad
SOURCE="$(find /tmp/maj-elmourad -mindepth 1 -maxdepth 1 -type d | head -n1)"
[ -f "$SOURCE/deploy/elmourad/install.sh" ] || fail "Unexpected package: install.sh missing."
ok "$(basename "$SOURCE")"

step "3/4 Replace the code (keeping .env and secrets/)"
rsync -a --delete \
  --exclude '/deploy/elmourad/.env' \
  --exclude '/deploy/elmourad/secrets/' \
  "$SOURCE/" "$DIR/"
[ -f "$DIR/deploy/elmourad/.env" ] || fail ".env disappeared - stop and restore from /root/sauvegardes-elmourad"
ok "code replaced; .env and secrets/ kept"

step "4/4 Rebuild and restart (install.sh - 5 to 15 minutes)"
cd "$DIR/deploy/elmourad"
bash ./install.sh < /dev/null
rm -rf /tmp/maj-elmourad
ok "update finished"
'@
$remote = $remote -replace "`r`n", "`n"

$stage = Join-Path $env:TEMP ("elmourad-maj-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $stage | Out-Null
$remoteScript = Join-Path $stage 'elmourad-maj.sh'
$remoteZip = Join-Path $stage 'elmourad-update.zip'
[System.IO.File]::WriteAllText($remoteScript, $remote, (New-Object System.Text.UTF8Encoding($false)))
Copy-Item -LiteralPath $Zip -Destination $remoteZip
Ok "Prepared: $stage"

if ($DryRun) {
  Warn "Dry run: nothing sent. Files ready in $stage"
  exit 0
}

# --- 3. Confirmation ----------------------------------------------------------
$sshOpts = @('-o', 'ConnectTimeout=20')
if ($Key -ne '') {
  if (-not (Test-Path $Key)) { Fail "SSH key not found: $Key" }
  $sshOpts += @('-i', (Resolve-Path $Key).Path, '-o', 'IdentitiesOnly=yes')
}
if (-not $Yes) {
  Write-Host ""
  Write-Host "About to update $Server ($Domain) to El Mourad $version." -ForegroundColor Cyan
  Write-Host "A backup is taken first; .env and secrets/ are kept." -ForegroundColor Cyan
  $answer = Read-Host 'Continue? (y/N)'
  if ($answer -notmatch '^(y|yes|o|oui)$') { Warn 'Cancelled.'; Remove-Item -Recurse -Force $stage; exit 1 }
}

# --- 4. Upload + run ----------------------------------------------------------
# The build stamp the live site serves now (/elourwa/*.css?v=<stamp>, one per
# build — apps/web/next.config.mjs). Step 4 requires a DIFFERENT one after the
# update: on 24/09 the script said "Done" and a phone still showed the old site,
# with nothing to tell whether the server or the browser was behind.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
# NO BACKSLASHES in these patterns ([.] and [?], not their escaped forms): on
# 25/09 a patch tool ate them, the pattern stopped matching anything, and a
# SUCCESSFUL update was reported as failed.
function Get-BuildStamp {
  try {
    $html = (Invoke-WebRequest -Uri "https://$Domain/login" -UseBasicParsing -TimeoutSec 30 -Headers @{ 'Cache-Control' = 'no-cache' }).Content
    if ($html -match 'responsive[.]css[?]v=([0-9]{8}T[0-9]{6})') { return $Matches[1] }
    return 'none'
  } catch { return 'unreachable' }
}
# The package's own build time ("Construit le 2026-09-25T17:46Z ..."), as a
# stamp: the site built on the server from this package cannot be older. This
# also accepts re-sending the SAME package (Docker reuses its cached build, so
# the stamp does not change although the site is the right one).
$pkgStamp = ''
if ($built -match '([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2})') {
  $pkgStamp = $Matches[1] + $Matches[2] + $Matches[3] + 'T' + $Matches[4] + $Matches[5] + '00'
}
function Test-NewBuild([string]$s) {
  if ($s -notmatch '^[0-9]{8}T[0-9]{6}$') { return $false }
  if ($pkgStamp -ne '') { return ($s -ge $pkgStamp) }
  return ($s -ne $stampBefore)
}
$stampBefore = Get-BuildStamp
Write-Host "Live site build before the update: $stampBefore" -ForegroundColor DarkGray

Title "2. Upload to $Server (password asked if no key)"
& scp.exe @sshOpts $remoteZip $remoteScript "${Server}:/root/"
if ($LASTEXITCODE -ne 0) { Remove-Item -Recurse -Force $stage; Fail "Upload failed (scp exit $LASTEXITCODE)." }
Ok 'uploaded: /root/elmourad-update.zip and /root/elmourad-maj.sh'
Remove-Item -Recurse -Force $stage

Title '3. Update on the server (password asked again if no key)'
& ssh.exe @sshOpts $Server 'bash /root/elmourad-maj.sh /root/elmourad-update.zip'
if ($LASTEXITCODE -ne 0) {
  Fail "The server update stopped (exit $LASTEXITCODE). The previous site keeps running until the restart step; the backup is in /root/sauvegardes-elmourad."
}

# --- 5. Check -----------------------------------------------------------------
Title '4. Check (from this PC)'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
try {
  $health = Invoke-RestMethod -Uri "https://api.$Domain/health" -TimeoutSec 30
  if ($health.status -eq 'ok') { Ok ("API: status ok, database " + $health.database + ", migration " + $health.migration + ", push " + $health.push) }
  else { Warn ("API answered: " + ($health | ConvertTo-Json -Compress)) }
} catch {
  Warn "API not answering yet: $($_.Exception.Message). On the server: cd /opt/elmourad/deploy/elmourad; docker compose logs --tail=80 api"
}
try {
  $page = Invoke-WebRequest -Uri "https://$Domain/login" -UseBasicParsing -TimeoutSec 30
  Ok "Site: https://$Domain/login -> $($page.StatusCode)"
} catch {
  Warn "Site not answering yet: $($_.Exception.Message)"
}

# The proof: the live site must serve the build that was just made.
$stampAfter = 'unreachable'
for ($i = 0; $i -lt 12; $i++) {
  $stampAfter = Get-BuildStamp
  if (Test-NewBuild $stampAfter) { break }
  Start-Sleep -Seconds 10
}
if (Test-NewBuild $stampAfter) {
  $liveAt = $stampAfter.Substring(0,4) + '-' + $stampAfter.Substring(4,2) + '-' + $stampAfter.Substring(6,2) + ' ' + $stampAfter.Substring(9,2) + ':' + $stampAfter.Substring(11,2) + ' UTC'
  Ok "Live site is the NEW build (built $liveAt; before: $stampBefore)"
  Write-Host "If a phone still shows the old look: close the tab and open the site again (or pull to refresh)." -ForegroundColor DarkGray
} else {
  Fail "The live site still serves the previous build ($stampAfter). The update did not reach the site: on the server, cd /opt/elmourad/deploy/elmourad; docker compose ps; docker compose logs --tail=80 web"
}

Write-Host ""
Write-Host "Done: El Mourad $version is deployed on $Domain." -ForegroundColor Green
Write-Host "Backup taken before the update: /root/sauvegardes-elmourad (on the server)."
