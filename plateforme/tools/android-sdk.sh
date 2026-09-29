#!/usr/bin/env bash
#
# INSTALLER LE STRICT NÉCESSAIRE POUR CONSTRUIRE L'APPLICATION ANDROID.
#
#   tools/android-sdk.sh            # JDK 17 + outils en ligne de commande + trois paquets SDK
#
# ⚠ SANS ANDROID STUDIO, SANS ÉMULATEUR, SANS NDK. Un poste à Nouakchott est sur
# une ligne comptée : Android Studio pèse 1,1 Go, une image d'émulateur 1 Go de
# plus, le NDK encore 1 Go — et aucun des trois ne sert à produire un .aab.
# Ce qu'il faut tient en ~500 Mo, plus ce que Gradle tire à la première
# construction (~700 Mo) :
#
#   JDK 17 Temurin                        ~190 Mo   → C:\Java\jdk-17
#   Outils en ligne de commande Android    ~150 Mo   → C:\Android\sdk\cmdline-tools\latest
#   platform-tools, build-tools;36.0.0,
#   platforms;android-36                   ~150 Mo   → C:\Android\sdk
#   (le Play Store exige Android 16 / API 36 depuis le 31 août 2026)
#
# Idempotent : relancé, il ne retélécharge pas ce qui est là.
#
# ⚠ `flutter.ndkVersion` dans app/build.gradle est une DÉCLARATION, pas un
# besoin : aucun greffon de l'application n'a de code natif. Si Gradle exigeait
# quand même le NDK, la ligne se retire — on ne télécharge pas 1 Go pour une
# vérification de version.

set -euo pipefail

JAVA_DIR="/c/Java"
SDK="/c/Android/sdk"
DL="/c/Android/dl"
mkdir -p "$JAVA_DIR" "$SDK" "$DL"

vert()  { printf '\033[32m✓ %s\033[0m\n' "$*"; }
rouge() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; }
titre() { printf '\n\033[1m── %s ──\033[0m\n' "$*"; }

# ── JDK 17 ────────────────────────────────────────────────────────────────
titre "JDK 17"
if ls -d "$JAVA_DIR"/jdk-17* >/dev/null 2>&1; then
  vert "déjà là : $(ls -d "$JAVA_DIR"/jdk-17* | head -1)"
else
  [ -s "$DL/jdk17.zip" ] || curl -sSL -o "$DL/jdk17.zip" \
    "https://api.adoptium.net/v3/binary/latest/17/ga/windows/x64/jdk/hotspot/normal/eclipse?project=jdk"
  unzip -q -o "$DL/jdk17.zip" -d "$JAVA_DIR"
  vert "$(ls -d "$JAVA_DIR"/jdk-17* | head -1)"
fi
JAVA_HOME_UNIX="$(ls -d "$JAVA_DIR"/jdk-17* | head -1)"
export JAVA_HOME="$(cygpath -w "$JAVA_HOME_UNIX")"
export PATH="$JAVA_HOME_UNIX/bin:$PATH"
java -version 2>&1 | head -1

# ── Outils en ligne de commande ───────────────────────────────────────────
titre "Outils en ligne de commande Android"
if [ -x "$SDK/cmdline-tools/latest/bin/sdkmanager.bat" ]; then
  vert "déjà là"
else
  [ -s "$DL/cmdline-tools.zip" ] || curl -sSL -o "$DL/cmdline-tools.zip" \
    "https://dl.google.com/android/repository/commandlinetools-win-11076708_latest.zip"
  rm -rf "$DL/ct" && mkdir -p "$DL/ct" && unzip -q -o "$DL/cmdline-tools.zip" -d "$DL/ct"
  # Google exige la disposition cmdline-tools/latest/… ; le zip livre cmdline-tools/… à plat.
  mkdir -p "$SDK/cmdline-tools" && rm -rf "$SDK/cmdline-tools/latest"
  mv "$DL/ct/cmdline-tools" "$SDK/cmdline-tools/latest"
  vert "$SDK/cmdline-tools/latest"
fi
export ANDROID_HOME="$(cygpath -w "$SDK")"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
SDKM="$SDK/cmdline-tools/latest/bin/sdkmanager.bat"

# ── Les trois paquets, et les licences ────────────────────────────────────
titre "Paquets SDK"
# ⚠ PAS `yes |`. Quand sdkmanager ferme son entrée, `yes` reçoit SIGPIPE et,
# sous `pipefail`, la ligne échoue — la première installation s'est arrêtée
# après build-tools, sans platforms et sans un mot. Trente « y » suffisent à
# toutes les licences qu'il peut présenter, et printf termine proprement.
oui() { printf 'y\n%.0s' $(seq 1 30); }
oui | "$SDKM" --sdk_root="$ANDROID_HOME" \
  "platform-tools" "build-tools;35.0.0" "build-tools;36.0.0" "platforms;android-36" "platforms;android-35" \
  2>&1 | grep -v "^\[=" | grep -v "^\s*$" || true
oui | "$SDKM" --sdk_root="$ANDROID_HOME" --licenses >/dev/null 2>&1 || true
[ -d "$SDK/platforms/android-36" ] && [ -d "$SDK/build-tools/36.0.0" ] \
  || { rouge "les paquets SDK ne sont pas tous là (platforms/android-36, build-tools/36.0.0)"; exit 2; }
vert "platform-tools, build-tools;36.0.0, platforms;android-36, platforms;android-35"

# ── Dire à Flutter où c'est ───────────────────────────────────────────────
titre "Flutter"
FLUTTER="/c/src/flutter/bin/flutter"
[ -x "$FLUTTER" ] || FLUTTER="$(command -v flutter)"
"$FLUTTER" config --android-sdk "$ANDROID_HOME" >/dev/null
"$FLUTTER" config --jdk-dir "$JAVA_HOME" >/dev/null 2>&1 || true
yes | "$FLUTTER" doctor --android-licenses >/dev/null 2>&1 || true
"$FLUTTER" doctor 2>&1 | grep -E "Android toolchain|Flutter \(" || true

mkdir -p /c/Java/tmp
printf '\nÀ mettre dans le profil du poste pour les prochaines fois :\n'
printf '  setx JAVA_HOME "%s"\n  setx ANDROID_HOME "%s"\n' "$JAVA_HOME" "$ANDROID_HOME"
# Voir tools/packager.sh (emballer_android) : sans cela Gradle meurt sur
# « Unable to establish loopback connection » quand %TEMP% est en forme courte 8.3.
printf '  setx JAVA_TOOL_OPTIONS "-Djdk.net.unixdomain.tmpdir=C:\\\\Java\\\\tmp"\n'
