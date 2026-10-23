# Downloads a private copy of Node.js (LTS, zip, no admin rights needed) into -Dest.
# Used by START.bat only when Node.js 18+ is not installed on the PC.
param([Parameter(Mandatory = $true)][string]$Dest)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'   # the progress bar makes downloads 10x slower in Windows PowerShell
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }

$arch = 'x64'
if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { $arch = 'arm64' }
elseif (-not [Environment]::Is64BitOperatingSystem) { $arch = 'x86' }

function Get-Text([string]$url) {
  try { return (Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 60).Content }
  catch { return (& curl.exe -sSL --max-time 60 $url) -join "`n" }
}

function Get-File([string]$url, [string]$out) {
  try { Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $out -TimeoutSec 600 }
  catch { & curl.exe -sSL --max-time 600 -o $out $url; if ($LASTEXITCODE -ne 0) { throw "download failed: $url" } }
}

$version = $null
try {
  $index = Get-Text 'https://nodejs.org/dist/index.json' | ConvertFrom-Json
  $version = ($index | Where-Object { $_.lts -and ($_.files -contains "win-$arch-zip") } | Select-Object -First 1).version
} catch { }
if (-not $version) { $version = 'v24.22.1' }

$name = "node-$version-win-$arch"
$zip = Join-Path $env:TEMP "$name.zip"
$unpack = Join-Path $env:TEMP "$name-unpack"

for ($attempt = 1; $attempt -le 3; $attempt++) {
  try {
    Write-Host "Downloading Node.js $version ($arch), attempt $attempt/3..."
    Get-File "https://nodejs.org/dist/$version/$name.zip" $zip

    # Check the download against the official checksum
    $sums = Get-Text "https://nodejs.org/dist/$version/SHASUMS256.txt"
    $line = ($sums -split "`n") | Where-Object { $_ -match " $([regex]::Escape("$name.zip"))\s*$" } | Select-Object -First 1
    if ($line) {
      $expected = ($line -split '\s+')[0].ToLower()
      $actual = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLower()
      if ($expected -ne $actual) { throw 'checksum mismatch (corrupted download)' }
    }

    if (Test-Path $unpack) { Remove-Item -Recurse -Force $unpack }
    Expand-Archive -Path $zip -DestinationPath $unpack -Force
    if (Test-Path $Dest) { Remove-Item -Recurse -Force $Dest }
    New-Item -ItemType Directory -Force -Path (Split-Path $Dest) | Out-Null
    Move-Item (Join-Path $unpack $name) $Dest
    Remove-Item -Force $zip -ErrorAction SilentlyContinue
    Remove-Item -Recurse -Force $unpack -ErrorAction SilentlyContinue
    if (Test-Path (Join-Path $Dest 'node.exe')) { Write-Host 'Node.js is ready.'; exit 0 }
    throw 'node.exe missing after unpacking (antivirus?)'
  } catch {
    Write-Host "  failed: $($_.Exception.Message)"
    Start-Sleep -Seconds (5 * $attempt)
  }
}
exit 1
