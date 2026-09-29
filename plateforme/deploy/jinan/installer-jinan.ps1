<#
.SYNOPSIS
  FIRST installation of Jinan on its own VPS, from this PC.
  PowerShell and Windows' built-in OpenSSH only (ssh.exe, scp.exe): no Git Bash,
  no copy of the repository, no "cd" to the right folder.

.DESCRIPTION
  1. Finds the package jinan-<version>.zip by itself: next to this script, in
     the current folder, in Downloads, on the Desktop (browsers may rename the
     file: "jinan-0.7.8+18 (1).zip" is found too). Checks it carries no secret.
  2. Reads the server IP and the domain INSIDE the package
     (deploy/jinan/production.env, written by configurer-production.sh).
  3. Uploads the package and a small install script to /root/ (one scp).
  4. Runs the install on the server (one ssh): unzips to /opt/jinan, then
     deploy/jinan/install.sh (Docker, database, school, HTTPS) - 10 to 20 min.
     The direction account gets a TEMPORARY password, printed at the end.
  5. Checks https://api.<domain>/health and the login page from this PC.

  Refuses to run if Jinan is already installed (updates: mettre-a-jour.ps1),
  and refuses El Mourad's server.

  Why this script: typed by hand, "scp jinan-<version>.zip ..." only works in
  the folder that holds the zip; anywhere else it says "No such file or
  directory", nothing reaches the server, and every command after it fails.

.PARAMETER Zip
  Path to jinan-<version>.zip. Default: found automatically (see above).

.PARAMETER Server
  SSH target, e.g. root@209.74.66.223. Default: from the package.

.PARAMETER Domain
  E.g. ecole-jinan.com. Default: from the package.

.PARAMETER Email
  Direction account and HTTPS-certificate contact. Default: infoheavenly24@gmail.com

.PARAMETER Key
  Optional private SSH key. Without it, the root password is asked twice.

.PARAMETER Yes
  Skip the confirmation question.

.PARAMETER DryRun
  Find and check everything, but do not contact the server.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File "$HOME\Downloads\installer-jinan.ps1"
#>
[CmdletBinding()]
param(
  [string]$Zip = '',
  [string]$Server = '',
  [string]$Domain = '',
  [string]$Email = 'infoheavenly24@gmail.com',
  [string]$Key = '',
  [switch]$Yes,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
function Ok([string]$m)    { Write-Host "[OK] $m" -ForegroundColor Green }
function Warn([string]$m)  { Write-Host "[!]  $m" -ForegroundColor Yellow }
function Fail([string]$m)  { Write-Host "[X]  $m" -ForegroundColor Red; exit 2 }
function Title([string]$m) { Write-Host ""; Write-Host "== $m ==" -ForegroundColor Cyan }

Add-Type -AssemblyName System.IO.Compression.FileSystem

# Reads a text entry of a zip, or '' when absent.
function Read-ZipText($archive, [string]$name) {
  $entry = $archive.Entries | Where-Object { $_.FullName -eq $name } | Select-Object -First 1
  if (-not $entry) { return '' }
  $reader = New-Object System.IO.StreamReader($entry.Open())
  try { return $reader.ReadToEnd() } finally { $reader.Close() }
}

# The package: one top folder jinan-<version>/ with deploy/jinan/install.sh.
# Returns $null for anything else (the iOS project, another school, a broken download).
function Test-Package([string]$path) {
  try { $archive = [System.IO.Compression.ZipFile]::OpenRead($path) } catch { return $null }
  try {
    $names = @($archive.Entries | ForEach-Object { $_.FullName })
    $top = @($names | Where-Object { $_ -match '^[^/]+/' } | ForEach-Object { ($_ -split '/')[0] } | Select-Object -Unique)
    if ($top.Count -ne 1) { return $null }
    $top = $top[0]
    if ($names -notcontains "$top/deploy/jinan/install.sh") { return $null }
    $bad = @($names | Where-Object { $_ -match '/deploy/jinan/[.]env$|/secrets/.|[.]jks$|key-[^/]*[.]properties$' })
    return @{
      Path = $path; Top = $top; Bad = $bad
      Production = (Read-ZipText $archive "$top/deploy/jinan/production.env")
      Built = (Read-ZipText $archive "$top/VERSION.txt").Trim()
    }
  } finally { $archive.Dispose() }
}

# --- 0. Tools -------------------------------------------------------------------
foreach ($t in 'ssh.exe', 'scp.exe') {
  if (-not $DryRun -and -not (Get-Command $t -ErrorAction SilentlyContinue)) {
    Fail "$t not found. Windows: Settings > System > Optional features > add 'OpenSSH Client'."
  }
}

# --- 1. The package ---------------------------------------------------------------
Title '1. The package'
if ($Zip -ne '') {
  if (-not (Test-Path -LiteralPath $Zip)) { Fail "Zip not found: $Zip" }
  $pkg = Test-Package (Resolve-Path -LiteralPath $Zip).Path
  if (-not $pkg) { Fail "Not a Jinan server package: $Zip" }
} else {
  $places = @($PSScriptRoot, (Get-Location).Path)
  if ($env:USERPROFILE) { $places += @((Join-Path $env:USERPROFILE 'Downloads'), (Join-Path $env:USERPROFILE 'Desktop')) }
  try { $places += [Environment]::GetFolderPath('Desktop') } catch { }
  if ($PSScriptRoot) { $places += (Join-Path $PSScriptRoot '..\..\dist') }
  $candidates = @()
  foreach ($p in ($places | Where-Object { $_ } | Select-Object -Unique)) {
    if (Test-Path -LiteralPath $p) {
      $candidates += @(Get-ChildItem -LiteralPath $p -Filter 'jinan-*.zip' -File -ErrorAction SilentlyContinue)
    }
  }
  $pkg = $null
  foreach ($c in ($candidates | Sort-Object LastWriteTime -Descending)) {
    $pkg = Test-Package $c.FullName
    if ($pkg) { break }
  }
  if (-not $pkg) {
    Write-Host "Looked in:" -ForegroundColor Yellow
    $places | Where-Object { $_ } | Select-Object -Unique | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
    Fail 'No jinan-<version>.zip found. Put it next to this script, or give it: -Zip "C:\path\jinan-0.7.8+18.zip"'
  }
}
if ($pkg.Bad.Count -gt 0) { Fail "The zip carries secrets it must not: $($pkg.Bad -join ', ')" }
$version = $pkg.Top -replace '^jinan-', ''
Ok "Package: $($pkg.Path)"
Ok "Version: $version"
if ($pkg.Built -ne '') { Ok "Built:   $($pkg.Built)" }

# --- 2. The server, from the package -----------------------------------------------
Title '2. The server'
$ip = ''; $dom = ''
foreach ($line in ($pkg.Production -split "`n")) {
  if ($line -match '^\s*JINAN_IP=(.*)$') { $ip = $Matches[1].Trim() }
  if ($line -match '^\s*JINAN_DOMAINE=(.*)$') { $dom = $Matches[1].Trim() }
}
if ($Server -eq '' -and $ip -ne '') { $Server = "root@$ip" }
if ($Domain -eq '') { $Domain = $dom }
if ($Server -eq '' -or $Domain -eq '') {
  Fail 'The package names no server (production.env empty): give -Server root@<ip> -Domain <domain>.'
}
if ($Server -match '187[.]7[.]18[.]252' -or $Domain -match 'elmouradarafat') {
  Fail "That is El Mourad's server or domain. Jinan has its own VPS."
}
if ($Email -notmatch '^[^@\s]+@[^@\s]+[.][^@\s]+$') { Fail "Not an e-mail address: $Email" }
Ok "Server:  $Server"
Ok "Domain:  $Domain  (site https://$Domain, API https://api.$Domain)"
Ok "Account: $Email  (temporary password printed at the end)"

# DNS from this PC: a warning only (install.sh checks it again on the server).
$target = ($Server -split '@')[-1]
foreach ($h in @($Domain, "www.$Domain", "api.$Domain")) {
  try {
    $a = @([System.Net.Dns]::GetHostAddresses($h) | Where-Object { $_.AddressFamily -eq 'InterNetwork' } | ForEach-Object { $_.IPAddressToString })
    if ($a -contains $target) { Ok "DNS $h -> $($a -join ', ')" }
    else { Warn "DNS $h -> $($a -join ', ') (expected $target): HTTPS will wait until the A record is right." }
  } catch { Warn "DNS $h : not found yet. Create an A record -> $target (HTTPS waits for it)." }
}

# --- 3. What is uploaded -------------------------------------------------------------
# The server-side script. Plain ASCII, LF line endings (bash refuses CRLF).
$remote = @'
#!/usr/bin/env bash
# Jinan - server side of installer.ps1 (FIRST installation). Run as root.
set -euo pipefail
ZIP="$1"; DOMAIN="$2"; EMAIL="$3"
DIR=/opt/jinan
ok()   { printf '\033[32m[OK] %s\033[0m\n' "$*"; }
fail() { printf '\033[31m[X]  %s\033[0m\n' "$*" >&2; exit 2; }
step() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }

[ "$(id -u)" -eq 0 ] || fail "Run as root."
if [ -f "$DIR/deploy/jinan/.env" ]; then
  fail "Jinan is already installed in $DIR. To update: mettre-a-jour.ps1. To finish an interrupted install: cd $DIR/deploy/jinan && bash install.sh"
fi
[ -f "$ZIP" ] || fail "Package not found on the server: $ZIP"

step "1/3 Unpack"
export DEBIAN_FRONTEND=noninteractive
command -v unzip >/dev/null || { apt-get -qq update && apt-get -qq install -y unzip >/dev/null; }
rm -rf /tmp/inst-jinan && mkdir -p /tmp/inst-jinan
unzip -q "$ZIP" -d /tmp/inst-jinan
SOURCE="$(find /tmp/inst-jinan -mindepth 1 -maxdepth 1 -type d | head -n1)"
[ -f "$SOURCE/deploy/jinan/install.sh" ] || fail "Unexpected package: install.sh missing."
# A folder left by an earlier attempt (no .env: nothing was installed) is kept aside, never deleted.
if [ -e "$DIR" ]; then
  ASIDE="$DIR.before-$(date +%Y%m%d-%H%M%S)-$$"
  mv -T "$DIR" "$ASIDE"
  ok "earlier attempt moved aside: $ASIDE"
fi
mv "$SOURCE" "$DIR"
rm -rf /tmp/inst-jinan
install -d -m 700 "$DIR/deploy/jinan/secrets"
ok "$DIR ($(basename "$SOURCE"))"

step "2/3 Install (Docker, database, school, HTTPS - 10 to 20 minutes)"
cd "$DIR/deploy/jinan"
PUBLIC_DOMAIN="$DOMAIN" ACME_EMAIL="$EMAIL" ADMIN_EMAIL="$EMAIL" bash ./install.sh < /dev/null

step "3/3 Login"
if [ -f /root/jinan-installation.txt ] && grep -q 'Mot de passe provisoire' /root/jinan-installation.txt; then
  echo "  Site:      https://$DOMAIN"
  echo "  E-mail:    $EMAIL"
  grep 'Mot de passe provisoire' /root/jinan-installation.txt | sed 's/^ *Mot de passe provisoire *:/  Temporary password:/'
  echo "  (the site asks for a new password at the first login)"
fi
rm -f "$ZIP" /root/jinan-installer.sh
ok "installation finished"
'@
$remote = $remote -replace "`r`n", "`n"

$stage = Join-Path ([System.IO.Path]::GetTempPath()) ('jinan-inst-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $stage | Out-Null
$remoteScript = Join-Path $stage 'jinan-installer.sh'
$remoteZip = Join-Path $stage 'jinan-install.zip'
[System.IO.File]::WriteAllText($remoteScript, $remote, (New-Object System.Text.UTF8Encoding($false)))
# A fixed ASCII name on the server: no "+", space or "(1)" to quote.
Copy-Item -LiteralPath $pkg.Path -Destination $remoteZip

if ($DryRun) {
  Warn "Dry run: nothing sent. Files ready in $stage"
  exit 0
}

# --- 4. Confirmation -------------------------------------------------------------------
$sshOpts = @('-o', 'ConnectTimeout=20', '-o', 'ServerAliveInterval=30', '-o', 'StrictHostKeyChecking=accept-new')
if ($Key -ne '') {
  if (-not (Test-Path -LiteralPath $Key)) { Fail "SSH key not found: $Key" }
  $sshOpts += @('-i', (Resolve-Path -LiteralPath $Key).Path, '-o', 'IdentitiesOnly=yes')
}
if (-not $Yes) {
  Write-Host ""
  Write-Host "About to INSTALL Jinan $version on $Server ($Domain)." -ForegroundColor Cyan
  Write-Host "The root password of the VPS is asked twice (upload, then install)." -ForegroundColor Cyan
  $answer = Read-Host 'Continue? (y/N)'
  if ($answer -notmatch '^(y|yes|o|oui)$') { Warn 'Cancelled.'; Remove-Item -Recurse -Force $stage; exit 1 }
}

# --- 5. Upload + install ---------------------------------------------------------------
Title "3. Upload to $Server (root password)"
& scp.exe @sshOpts $remoteZip $remoteScript "${Server}:/root/"
if ($LASTEXITCODE -ne 0) { Remove-Item -Recurse -Force $stage; Fail "Upload failed (scp exit $LASTEXITCODE). Check the IP and the root password." }
Ok 'uploaded: /root/jinan-install.zip and /root/jinan-installer.sh'
Remove-Item -Recurse -Force $stage

Title '4. Install on the server (root password again; 10 to 20 minutes, keep this window open)'
& ssh.exe @sshOpts $Server "bash /root/jinan-installer.sh /root/jinan-install.zip $Domain $Email"
if ($LASTEXITCODE -ne 0) {
  Fail "The install stopped (exit $LASTEXITCODE). Copy the red lines above and send them. Running this script again is safe until the install has written /opt/jinan/deploy/jinan/.env."
}

# --- 6. Check ----------------------------------------------------------------------------
Title '5. Check (from this PC)'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$healthy = $false
for ($i = 0; $i -lt 12 -and -not $healthy; $i++) {
  try {
    $health = Invoke-RestMethod -Uri "https://api.$Domain/health" -TimeoutSec 30
    if ($health.status -eq 'ok') { $healthy = $true; Ok ("API: status ok, database " + $health.database + ", migration " + $health.migration) }
  } catch { Start-Sleep -Seconds 10 }
}
if (-not $healthy) {
  Warn "https://api.$Domain/health not answering yet (the HTTPS certificate can take a few minutes after the DNS)."
  Warn "On the server: cd /opt/jinan/deploy/jinan; docker compose ps; docker compose logs --tail=80 caddy api"
}
try {
  $page = Invoke-WebRequest -Uri "https://$Domain/login" -UseBasicParsing -TimeoutSec 30
  Ok "Site: https://$Domain/login -> $($page.StatusCode)"
} catch { Warn "Site not answering yet: $($_.Exception.Message)" }

Write-Host ""
if ($healthy) {
  Write-Host "Done: Jinan $version is installed and answering. Log in at https://$Domain with $Email and the temporary password above." -ForegroundColor Green
} else {
  Write-Host "Installed on the server, but https://api.$Domain does not answer yet: wait 5 minutes, then open https://$Domain." -ForegroundColor Yellow
  Write-Host "Still nothing? Send the output of: ssh $Server 'cd /opt/jinan/deploy/jinan; docker compose ps; docker compose logs --tail=60 caddy api'" -ForegroundColor Yellow
}
Write-Host "Then delete the copy of that password on the server: ssh $Server 'rm /root/jinan-installation.txt'" -ForegroundColor DarkGray
