<#
.SYNOPSIS
  Sign an UNSIGNED Android App Bundle (.aab) with the school's Play upload key,
  on the PC that holds the key. PowerShell only: no Git Bash, no repository,
  no Flutter, no "cd" to the right folder.

.DESCRIPTION
  1. Finds <brand>-parent-<version>-non-signe.aab by itself (next to this
     script, in the current folder, in Downloads, on the Desktop). When it was
     sent in parts (.001, .002), joins them first. Same for the test APK
     (<brand>-parent-<version>-ESSAI.apk.001/.002), joined for convenience.
  2. Checks the bundle: complete (every entry readable), really an app bundle,
     not already signed.
  3. Finds key-<brand>.properties and the keystore it names (default:
     C:\Eduplateforme\<brand>_deployement\, or the repository's
     apps\mobile\android\), and the JDK's jarsigner/keytool.
  4. REFUSES a key whose certificate is not the one registered in the Play
     Console (Jinan: SHA-256 8D:76:DF:C8:...:CE:7E:F2:86): Google would reject
     the bundle anyway, after the upload.
  5. Signs -> <brand>-parent-<version>.aab next to the input, verifies it.

  The passwords are read from key-<brand>.properties and handed to the JDK
  through environment variables, never on a command line.

.PARAMETER Aab
  The unsigned .aab, or its first part (.001). Default: found automatically.

.PARAMETER Brand
  jinan (default) or another brand with a key-<brand>.properties.

.PARAMETER Properties
  Path to key-<brand>.properties when it is not in the usual places.

.PARAMETER Fingerprint
  Expected SHA-256 of the upload certificate. Default: the one registered for
  the brand (Jinan). Required for a brand without a registered value.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File "$HOME\Downloads\signer-aab.ps1"
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\signer-aab.ps1 -Properties D:\cles\key-jinan.properties
#>
[CmdletBinding()]
param(
  [string]$Aab = '',
  [string]$Brand = 'jinan',
  [string]$Properties = '',
  [string]$Fingerprint = ''
)

$ErrorActionPreference = 'Stop'
function Ok([string]$m)    { Write-Host "[OK] $m" -ForegroundColor Green }
function Warn([string]$m)  { Write-Host "[!]  $m" -ForegroundColor Yellow }
function Fail([string]$m)  { Write-Host "[X]  $m" -ForegroundColor Red; exit 2 }
function Title([string]$m) { Write-Host ""; Write-Host "== $m ==" -ForegroundColor Cyan }

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

# The upload certificate registered in the Play Console, per brand.
$registered = @{
  'jinan' = '8D:76:DF:C8:3D:1E:13:67:CF:B5:99:C6:AF:DA:D7:CD:D5:A8:84:02:FD:F8:65:EB:6E:DA:1A:31:CE:7E:F2:86'
}
if ($Fingerprint -eq '') { $Fingerprint = $registered[$Brand] }
if (-not $Fingerprint) { Fail "No registered upload certificate for '$Brand': give -Fingerprint AA:BB:... (Play Console > App integrity > Upload key certificate, SHA-256)." }
$Fingerprint = $Fingerprint.ToUpperInvariant()

# A native tool, its output captured. Windows PowerShell 5.1 turns a native
# program's stderr into errors when it is redirected: with 'Stop' that aborts
# the script on a mere notice ("Certificate stored in file ..."), so 'Continue'
# here, and the exit code decides.
function Invoke-Tool([string]$exe, [string[]]$argv) {
  $old = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try { $out = & $exe @argv 2>&1 | ForEach-Object { "$_" } } finally { $ErrorActionPreference = $old }
  return @{ Code = $LASTEXITCODE; Out = (@($out) -join "`n") }
}

function Get-Sha256([string]$path) {
  return (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToUpperInvariant()
}

# "name.aab.001" (or "name.aab (1).001", as browsers rename a second download)
# -> the parts in order, and the joined name.
function Join-Parts([string]$first) {
  $parts = @($first)
  for ($n = 2; $n -lt 100; $n++) {
    $next = $first -replace '[.]001$', ('.{0:D3}' -f $n)
    if (-not (Test-Path -LiteralPath $next)) { break }
    $parts += $next
  }
  if ($parts.Count -lt 2) { Fail "Only one part found: $first. Download the .002 part into the same folder." }
  $name = [System.IO.Path]::GetFileName($first) -replace '[.]001$', '' -replace ' [(][0-9]+[)]', ''
  $dest = Join-Path ([System.IO.Path]::GetDirectoryName($first)) $name
  $out = [System.IO.File]::Create($dest)
  try {
    foreach ($p in $parts) {
      $in = [System.IO.File]::OpenRead($p)
      try { $in.CopyTo($out) } finally { $in.Close() }
    }
  } finally { $out.Close() }
  Ok ("joined " + $parts.Count + " parts -> $dest")
  return $dest
}

# Every entry read to the end: a truncated or damaged download fails here, not
# in the Play Console. Returns the entry names.
function Test-Archive([string]$path) {
  try {
    $zip = [System.IO.Compression.ZipFile]::OpenRead($path)
  } catch { Fail "$path is not a complete archive (download it again): $($_.Exception.Message)" }
  try {
    $names = @()
    $buffer = New-Object byte[] 65536
    foreach ($e in $zip.Entries) {
      $names += $e.FullName
      $s = $e.Open()
      try { while ($s.Read($buffer, 0, $buffer.Length) -gt 0) { } } finally { $s.Close() }
    }
    return $names
  } catch {
    Fail "$path is damaged (download it again): $($_.Exception.Message)"
  } finally { $zip.Dispose() }
}

# --- 1. Where to look ---------------------------------------------------------------
$places = @($PSScriptRoot, (Get-Location).Path)
if ($env:USERPROFILE) { $places += @((Join-Path $env:USERPROFILE 'Downloads'), (Join-Path $env:USERPROFILE 'Desktop')) }
try { $places += [Environment]::GetFolderPath('Desktop') } catch { }
if ($PSScriptRoot) { $places += (Join-Path $PSScriptRoot '..\dist') }
$places = @($places | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | ForEach-Object { (Resolve-Path -LiteralPath $_).Path } | Select-Object -Unique)

function Find-Newest([string]$filter) {
  $found = @()
  foreach ($p in $places) { $found += @(Get-ChildItem -LiteralPath $p -Filter $filter -File -ErrorAction SilentlyContinue) }
  return ($found | Sort-Object LastWriteTime -Descending | Select-Object -First 1)
}

# --- 2. The bundle --------------------------------------------------------------------
Title '1. The unsigned bundle'
if ($Aab -ne '') {
  if (-not (Test-Path -LiteralPath $Aab)) { Fail "Not found: $Aab" }
  $Aab = (Resolve-Path -LiteralPath $Aab).Path
  if ($Aab -match '[.]001$') { $Aab = Join-Parts $Aab }
} else {
  $whole = Find-Newest "$Brand-parent-*non-signe*.aab"
  $part = Find-Newest "$Brand-parent-*non-signe*.001"
  if ($part -and (-not $whole -or $part.LastWriteTime -gt $whole.LastWriteTime)) {
    $Aab = Join-Parts $part.FullName
  } elseif ($whole) {
    $Aab = $whole.FullName
  } else {
    Write-Host 'Looked in:' -ForegroundColor Yellow
    $places | ForEach-Object { Write-Host "  $_" -ForegroundColor Yellow }
    Fail "No $Brand-parent-...-non-signe.aab (or its .001/.002 parts) found. Put them next to this script, or give -Aab <file>."
  }
}
$names = Test-Archive $Aab
if ($names -notcontains 'BundleConfig.pb' -or $names -notcontains 'base/manifest/AndroidManifest.xml') {
  Fail "$Aab is not an Android App Bundle."
}
$signed = @($names | Where-Object { $_ -match '^META-INF/[^/]+[.](SF|RSA|EC|DSA)$' })
if ($signed.Count -gt 0) { Fail "$Aab is already signed ($($signed -join ', ')): start from the -non-signe file." }
Ok "bundle: $Aab"
Ok ("complete: " + $names.Count + " entries, SHA-256 " + (Get-Sha256 $Aab))

# The test APK, when its parts are here too: joined, nothing else.
$apkPart = Find-Newest "$Brand-parent-*ESSAI*.apk*.001"
if ($apkPart) {
  $apk = Join-Parts $apkPart.FullName
  $null = Test-Archive $apk
  Ok ("test APK: $apk (SHA-256 " + (Get-Sha256 $apk) + ") - for a test phone only, never for the Play Store")
}

# --- 3. The key -------------------------------------------------------------------------
Title '2. The upload key'
$propName = "key-$Brand.properties"
if ($Properties -eq '') {
  $patterns = @(
    "C:\Eduplateforme\${Brand}_deployement\$propName",
    "C:\Eduplateforme\${Brand}_deployment\$propName",
    "C:\Eduplateforme\*\$propName",
    "C:\Eduplateforme\*\apps\mobile\android\$propName",
    "C:\Eduplateforme\*\*\apps\mobile\android\$propName"
  )
  if ($PSScriptRoot) { $patterns += @((Join-Path $PSScriptRoot "..\apps\mobile\android\$propName"), (Join-Path $PSScriptRoot $propName)) }
  foreach ($p in $places) { $patterns += (Join-Path $p $propName) }
  foreach ($pat in $patterns) {
    $hit = @(Resolve-Path -Path $pat -ErrorAction SilentlyContinue | Select-Object -First 1)
    if ($hit.Count -gt 0 -and $hit[0]) { $Properties = $hit[0].Path; break }
  }
  if ($Properties -eq '') { Fail "$propName not found (looked in C:\Eduplateforme\${Brand}_deployement and the repository). Give -Properties <path>." }
}
if (-not (Test-Path -LiteralPath $Properties)) { Fail "Not found: $Properties" }
$Properties = (Resolve-Path -LiteralPath $Properties).Path
$props = @{}
foreach ($line in (Get-Content -LiteralPath $Properties)) {
  if ($line -match '^\s*([A-Za-z]+)\s*=(.*)$') { $props[$Matches[1]] = $Matches[2].Trim() }
}
foreach ($k in 'keyAlias', 'storePassword', 'keyPassword', 'storeFile') {
  if (-not $props[$k]) { Fail "$Properties has no $k=" }
}
# storeFile is relative to apps\mobile\android\app for Gradle; in a copy (the
# _deployement folder) the keystore usually sits next to the properties file.
$propDir = Split-Path -Parent $Properties
$storeCandidates = @()
if ([System.IO.Path]::IsPathRooted($props.storeFile)) { $storeCandidates += $props.storeFile }
$storeCandidates += @(
  (Join-Path (Join-Path $propDir 'app') $props.storeFile),
  (Join-Path $propDir $props.storeFile),
  (Join-Path $propDir (Split-Path -Leaf $props.storeFile))
)
$store = ''
foreach ($c in $storeCandidates) { if (Test-Path -LiteralPath $c) { $store = (Resolve-Path -LiteralPath $c).Path; break } }
if ($store -eq '') { Fail "Keystore '$($props.storeFile)' named in $Properties not found (looked next to it and in app\)." }
Ok "properties: $Properties"
Ok "keystore:   $store (alias $($props.keyAlias))"

# The JDK tools.
function Find-JdkTool([string]$name) {
  foreach ($n in @("$name.exe", $name)) {
    $c = Get-Command $n -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($c -and $c.Path) { return $c.Path }
  }
  $dirs = @()
  if ($env:JAVA_HOME) { $dirs += (Join-Path $env:JAVA_HOME 'bin') }
  $dirs += @('C:\Java\jdk*\bin', 'C:\Program Files\Java\jdk*\bin', 'C:\Program Files\Eclipse Adoptium\jdk*\bin',
             'C:\Program Files\Microsoft\jdk*\bin', 'C:\Program Files\Zulu\zulu*\bin',
             'C:\Program Files\Android\Android Studio\jbr\bin', 'C:\Program Files\Android\Android Studio\jre\bin')
  foreach ($d in $dirs) {
    $hit = @(Resolve-Path -Path (Join-Path $d "$name.exe") -ErrorAction SilentlyContinue | Sort-Object Path -Descending | Select-Object -First 1)
    if ($hit.Count -gt 0 -and $hit[0]) { return $hit[0].Path }
  }
  return ''
}
$jarsigner = Find-JdkTool 'jarsigner'
$keytool = Find-JdkTool 'keytool'
if ($jarsigner -eq '' -or $keytool -eq '') { Fail 'jarsigner/keytool not found: install a JDK 17 (e.g. Eclipse Temurin) or set JAVA_HOME.' }
Ok "JDK: $jarsigner"

$env:ELOURWA_STOREPASS = $props.storePassword
$env:ELOURWA_KEYPASS = $props.keyPassword
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('signer-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
  # --- 4. The right key? Hash of the certificate itself: no parsing of keytool's
  # (translated) text.
  $cer = Join-Path $tmp 'upload.cer'
  $r = Invoke-Tool $keytool @('-exportcert', '-alias', $props.keyAlias, '-keystore', $store, '-storepass:env', 'ELOURWA_STOREPASS', '-file', $cer)
  if ($r.Code -ne 0 -or -not (Test-Path -LiteralPath $cer)) { Fail "keytool could not read the key (wrong password or alias?):`n$($r.Out)" }
  $hex = Get-Sha256 $cer
  $actual = (($hex -split '(..)' | Where-Object { $_ }) -join ':')
  if ($actual -ne $Fingerprint) {
    Fail "This key is NOT the Play upload key.`n     key:      $actual`n     expected: $Fingerprint`n     Google would refuse the bundle. Use the key registered in the Play Console."
  }
  Ok "certificate SHA-256 = $actual (the one registered in the Play Console)"

  # --- 5. Sign, then verify.
  Title '3. Sign'
  $outName = ([System.IO.Path]::GetFileName($Aab)) -replace '-non-signe', '' -replace ' [(][0-9]+[)]', ''
  if ($outName -eq [System.IO.Path]::GetFileName($Aab)) { $outName = $outName -replace '[.]aab$', '-signe.aab' }
  $out = Join-Path (Split-Path -Parent $Aab) $outName
  $r = Invoke-Tool $jarsigner @('-J-Duser.language=en', '-keystore', $store, '-storepass:env', 'ELOURWA_STOREPASS',
                                '-keypass:env', 'ELOURWA_KEYPASS', '-signedjar', $out, $Aab, $props.keyAlias)
  if ($r.Code -ne 0) { Fail "jarsigner failed:`n$($r.Out)" }
  $r = Invoke-Tool $jarsigner @('-J-Duser.language=en', '-verify', $out)
  if ($r.Code -ne 0 -or $r.Out -notmatch 'jar verified') { Fail "The signed bundle does not verify:`n$($r.Out)" }
  Ok "signed and verified: $out"
} finally {
  Remove-Item Env:\ELOURWA_STOREPASS -ErrorAction SilentlyContinue
  Remove-Item Env:\ELOURWA_KEYPASS -ErrorAction SilentlyContinue
  Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}

Write-Host ""
Write-Host "Done. Upload $out in the Play Console:" -ForegroundColor Green
Write-Host "  Test and release > Testing > Closed testing > Create new release > Upload." -ForegroundColor Green
