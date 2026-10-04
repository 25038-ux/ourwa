#!/usr/bin/env bash
#
# EMBALLER — le site, l'API, l'application parent (web, Android, iOS).
#
#   tools/packager.sh web          # API + site Next.js → dist/serveur-<version>.tar.gz
#   tools/packager.sh flutter-web  # application parent, version web → dist/parent-web-<version>.tar.gz
#   tools/packager.sh android      # → dist/parent-<version>.aab   (SDK Android + key.properties requis)
#   tools/packager.sh apk          # → dist/parent-<version>.apk   (le même, installable directement — démos, hors Play Store)
#   tools/packager.sh ios-projet   # → dist/ios-<version>.zip : le projet iOS marqué, prêt pour Xcode (tout poste)
#   tools/packager.sh ios          # → dist/parent-<version>.ipa   (macOS + Xcode seulement)
#   tools/packager.sh zip          # → dist/<enseigne-><version>.zip : le dépôt tel que commité, prêt à héberger (deploy/elmourad/)
#   tools/packager.sh all
#
# L'ENSEIGNE. `BRAND=elmourad tools/packager.sh apk` charge deploy/brands/elmourad.env
# (BRAND_NAME, BRAND_NAME_AR, APP_ID, APP_LABEL, SINGLE_SCHOOL_SLUG, API_URL…) :
# l'application se construit sous ce nom et cet identifiant, et les paquets
# s'appellent dist/elmourad-parent-<version>.apk, dist/elmourad-<version>.zip.
# Sans BRAND : El Ourwa, et les noms d'avant.
#
# ⚠ CE SCRIPT NE DEVINE RIEN. Une clé de signature absente, un SDK absent, une
# configuration Firebase absente : il s'arrête et le dit, avec la phrase qui
# manque, plutôt que de produire un paquet qui a l'air bon et que le magasin
# refusera — ou pire, qu'il acceptera sans notifications.
#
# Les variables Firebase (facultatives — sans elles l'application se construit
# et interroge au lieu de recevoir) :
#   FIREBASE_API_KEY  FIREBASE_APP_ID  FIREBASE_PROJECT_ID  FIREBASE_SENDER_ID
#   FIREBASE_VAPID_KEY (web seulement)
#   FIREBASE_IOS_APP_ID, FIREBASE_IOS_API_KEY (iOS seulement ; sans eux, l'iPhone interroge le serveur)
# Et l'adresse du serveur : API_URL (obligatoire pour une version publiée),
# WEB_URL (celle du site, pour les pages légales ; déduite d'API_URL sinon).

set -euo pipefail
cd "$(dirname "$0")/.."
RACINE="$(pwd)"
DIST="$RACINE/dist"
mkdir -p "$DIST"

# flutter n'est pas toujours sur le PATH de bash sur ce poste (tools/android-sdk.sh l'installe à /c/src/flutter).
[ -d /c/src/flutter/bin ] && export PATH="/c/src/flutter/bin:$PATH"

# L'enseigne : toutes les variables du fichier de marque passent dans
# l'environnement (Gradle lit APP_ID / APP_LABEL, dart_defines lit BRAND_*).
PREFIXE=""
if [ -n "${BRAND:-}" ]; then
  MARQUE_FICHIER="$RACINE/deploy/brands/$BRAND.env"
  [ -f "$MARQUE_FICHIER" ] || { printf '\033[31m✗ Enseigne inconnue : %s (attendu deploy/brands/%s.env)\033[0m\n' "$BRAND" "$BRAND" >&2; exit 2; }
  set -a; . "$MARQUE_FICHIER"; set +a
  PREFIXE="$BRAND-"
  # Une clé de signature PAR ENSEIGNE (app/build.gradle lit KEY_PROPERTIES) :
  # l'application El Mourad ne se signe plus avec la clé d'El Ourwa.
  export KEY_PROPERTIES="key-$BRAND.properties"
  printf '\033[1m── Enseigne : %s (%s)\033[0m\n' "${BRAND_NAME:-?}" "$BRAND"
fi
# WEB_URL déduite d'API_URL quand elle manque : https://api.<domaine> → https://<domaine>.
# Sans elle, les liens « Confidentialité » de l'application ouvraient l'API (404).
if [ -z "${WEB_URL:-}" ] && [ "${API_URL#https://api.}" != "${API_URL:-}" ]; then
  export WEB_URL="https://${API_URL#https://api.}"
fi

VERSION="$(grep -E '^version:' apps/mobile/pubspec.yaml | awk '{print $2}')"
# La version affichée dans le profil de l'application suit pubspec.yaml.
printf "/// La version de l'application, telle que \`pubspec.yaml\` la porte — recopiée
/// ici par \`tools/packager.sh\` à chaque construction, pour l'afficher dans le
/// profil (« est-ce bien la nouvelle version ? » se répond alors sans deviner).
const String versionApplication = '%s';
" "$VERSION" > apps/mobile/lib/src/version.dart

rouge() { printf '\033[31m✗ %s\033[0m\n' "$*" >&2; }
vert()  { printf '\033[32m✓ %s\033[0m\n' "$*"; }
titre() { printf '\n\033[1m── %s ──\033[0m\n' "$*"; }

exiger() { command -v "$1" >/dev/null 2>&1 || { rouge "« $1 » introuvable. $2"; exit 2; }; }

# pnpm n'est pas toujours sur le PATH du poste ; la version épinglée dans
# package.json (`packageManager`) l'est toujours par npx.
if ! command -v pnpm >/dev/null 2>&1 || ! pnpm --version >/dev/null 2>&1; then
  pnpm() { npx --yes pnpm@9.12.3 "$@"; }
fi

dart_defines() {
  local d=()
  [ -n "${API_URL:-}" ] && d+=(--dart-define=API_URL="$API_URL")
  [ -n "${WEB_URL:-}" ] && d+=(--dart-define=WEB_URL="$WEB_URL")
  [ -n "${BRAND_NAME:-}" ] && d+=(--dart-define=BRAND_NAME="$BRAND_NAME")
  [ -n "${BRAND_NAME_AR:-}" ] && d+=(--dart-define=BRAND_NAME_AR="$BRAND_NAME_AR")
  # FIREBASE_IOS_* : l'application iOS déclarée à part dans Firebase (sans elle,
  # l'iPhone n'initialise pas Firebase — jamais avec l'ID Android ; push.dart).
  for v in FIREBASE_API_KEY FIREBASE_APP_ID FIREBASE_PROJECT_ID FIREBASE_SENDER_ID FIREBASE_VAPID_KEY FIREBASE_IOS_APP_ID FIREBASE_IOS_API_KEY; do
    [ -n "${!v:-}" ] && d+=(--dart-define="$v=${!v}")
  done
  # Rien a definir : ne rien imprimer. Une ligne vide deviendrait un argument
  # vide, que flutter prend pour un fichier cible introuvable.
  if [ "${#d[@]}" -gt 0 ]; then printf '%s\n' "${d[@]}"; fi
  return 0
}

avertir_firebase() {
  if [ -z "${FIREBASE_PROJECT_ID:-}" ]; then
    printf '\033[33m! Sans FIREBASE_* : l’application se construit et INTERROGE le serveur au lieu de recevoir les notifications.\033[0m\n'
  fi
}

emballer_web() {
  titre "API + site"
  # ⚠ `next build` ET `next dev` ÉCRIVENT DANS LE MÊME `.next/`. Emballer pendant
  # que le serveur de développement tourne a écrasé ses morceaux sous lui :
  # « Cannot find module './836.js' », page de connexion blanche, et une suite
  # de bout en bout qui échouait pour une raison sans rapport avec le code.
  if (exec 3<>/dev/tcp/127.0.0.1/3000) 2>/dev/null; then
    exec 3>&-
    rouge "Quelque chose écoute sur :3000 — le serveur de développement, sans doute. Arrêtez-le d’abord : next build écrit dans le même .next/ et le casserait sous lui."
    exit 2
  fi
  pnpm --filter @elourwa/shared build >/dev/null 2>&1 || true
  pnpm --filter @elourwa/api build
  pnpm --filter @elourwa/web build
  local paquet="$DIST/${PREFIXE}serveur-$VERSION.tar.gz"
  # Ce qui suffit à démarrer sur un serveur : les deux `dist`, les pages
  # légales, les migrations, et le mode d'emploi. Pas les node_modules — ils
  # se réinstallent avec `pnpm install --prod --frozen-lockfile`.
  # Sans le cache de construction de Next (.next/cache), qui pese plus que tout
  # le reste et ne sert qu'a la construction suivante.
  tar -czf "$paquet" --exclude='apps/web/.next/cache' \
    package.json pnpm-lock.yaml pnpm-workspace.yaml \
    apps/api/package.json apps/api/dist \
    apps/web/package.json apps/web/.next apps/web/public apps/web/content apps/web/next.config.mjs \
    packages/shared/package.json packages/shared/src \
    packages/db/package.json packages/db/src packages/db/migrations \
    docs/RUNNING.md .env.example
  vert "$paquet"
  printf '  Sur le serveur : pnpm install --prod --frozen-lockfile · pnpm db:migrate · pnpm --filter @elourwa/api start · pnpm --filter @elourwa/web start\n'
  printf '  ⚠ Changez le mot de passe de app_user/app_reporter (0001 les crée avec « devpassword ») et posez DATABASE_URL, JWT_*, ALLOWED_ORIGIN_SUFFIX, SMTP_*, FCM_SERVICE_ACCOUNT.\n'
}

emballer_flutter_web() {
  titre "Application parent — web"
  exiger flutter "https://docs.flutter.dev/get-started/install"
  avertir_firebase
  ( cd apps/mobile
    mapfile -t D < <(dart_defines)
    flutter build web --release --pwa-strategy=none "${D[@]}"
    # Le service worker des notifications ne voit pas les --dart-define : on y
    # écrit les mêmes valeurs. Sans elles, les places vides restent et il ne
    # fait rien.
    local sw=build/web/firebase-messaging-sw.js
    for v in FIREBASE_API_KEY FIREBASE_APP_ID FIREBASE_PROJECT_ID FIREBASE_SENDER_ID; do
      sed -i "s|__${v}__|${!v:-__${v}__}|g" "$sw"
    done
    # La coquille web (index.html, manifest.json) porte « El Ourwa » en dur : l'enseigne s'y substitue.
    if [ -n "${BRAND_NAME:-}" ]; then
      sed -i "s|El Ourwa|${BRAND_NAME}|g" build/web/index.html build/web/manifest.json
    fi
  )
  local paquet="$DIST/${PREFIXE}parent-web-$VERSION.tar.gz"
  tar -czf "$paquet" -C apps/mobile/build web
  vert "$paquet  (servir le dossier web/ tel quel, derrière HTTPS)"
}

# LA CLÉ DE TÉLÉVERSEMENT, créée une fois, sur ce poste, jamais commitée.
#
#   tools/packager.sh cle          # → apps/mobile/android/elourwa-release.jks + key.properties
#
# ⚠ LE MOT DE PASSE EST TIRÉ AU SORT ET N'EST JAMAIS AFFICHÉ. Il vit dans
# `key.properties`, que git ignore. Les deux fichiers se sauvegardent HORS du
# poste, chiffrés : sans eux, plus aucune mise à jour de l'application n'est
# possible — sauf à demander à Google de réinitialiser la clé de
# téléversement, ce que Play App Signing permet, mais en quelques jours.
creer_cle() {
  titre "Clé de téléversement Android${BRAND:+ — $BRAND}"
  local dossier="apps/mobile/android"
  # Sans BRAND : les noms d'avant (El Ourwa). Avec BRAND : une clé à l'enseigne,
  # dans key-<enseigne>.properties (ignoré par git, comme tout key*.properties).
  local props="${KEY_PROPERTIES:-key.properties}"
  local nom="${BRAND:-elourwa}"
  local jks="elourwa-release.jks"
  [ -n "${BRAND:-}" ] && jks="$BRAND-upload.jks"
  local titulaire="${BRAND_NAME:-El Ourwa}"
  if [ -f "$dossier/$props" ]; then
    vert "$dossier/$props existe déjà — rien à faire"
    return 0
  fi
  local keytool
  keytool="$(command -v keytool || true)"
  if [ -z "$keytool" ] && ls -d /c/Java/jdk-17*/bin/keytool.exe >/dev/null 2>&1; then
    keytool="$(ls -d /c/Java/jdk-17*/bin/keytool.exe | head -1)"
  fi
  [ -n "$keytool" ] || { rouge "keytool introuvable : installez le JDK (tools/android-sdk.sh)"; exit 2; }
  # 32 octets d'aléa, encodés : ni devinable, ni copié d'un exemple.
  local mdp
  mdp="$(head -c 32 /dev/urandom | base64 | tr -d '=+/
' | head -c 40)"
  "$keytool" -genkeypair -v -keystore "$dossier/$jks" -storetype JKS -keyalg RSA -keysize 2048 \
    -validity 10000 -alias "$nom" -storepass "$mdp" -keypass "$mdp" \
    -dname "CN=$titulaire, O=$titulaire, L=Nouakchott, C=MR" >/dev/null 2>&1
  {
    echo "storeFile=../$jks"
    echo "storePassword=$mdp"
    echo "keyAlias=$nom"
    echo "keyPassword=$mdp"
  } > "$dossier/$props"
  chmod 600 "$dossier/$props" "$dossier/$jks" 2>/dev/null || true
  vert "$dossier/$jks et $props créés (ignorés par git)"
  printf '[33m! SAUVEGARDEZ CES DEUX FICHIERS HORS DU POSTE, CHIFFRÉS. Perdus = plus de mise à jour possible.[0m
'
}

preparer_android() {
  local cible="${1:-aab}"
  exiger flutter "https://docs.flutter.dev/get-started/install"
  # ⚠ « Unable to establish loopback connection » — DEUX HEURES PERDUES ICI.
  # Le `Pipe` de la JVM (celui qui relie le client Gradle à son démon) préfère
  # une socket AF_UNIX, dont le fichier va dans %TEMP%. Sur ce poste %TEMP% est
  # en forme courte 8.3 (C:\Users\SIDIBR~1\…) et afunix.sys refuse de s'y connecter
  # (« Invalid argument ») ; et le JDK ne retombe sur TCP que si c'est le BIND
  # qui échoue, pas la connexion. Un dossier ordinaire règle tout. JAVA_TOOL_OPTIONS
  # vaut pour chaque JVM que Gradle lance — client, démon, compilateurs.
  # (Windows seulement : ailleurs, ce chemin n'existe pas et casserait la JVM.)
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*)
      mkdir -p /c/Java/tmp 2>/dev/null || true
      export JAVA_TOOL_OPTIONS="${JAVA_TOOL_OPTIONS:-} -Djdk.net.unixdomain.tmpdir=C:\\Java\\tmp" ;;
  esac
  # ⚠ Pas de `grep -q` sous `pipefail` : il quitte à la première ligne qui
  # correspond, `flutter doctor` reçoit SIGPIPE, le tube échoue, et le SDK est
  # déclaré absent alors qu'il est là. `grep` doit lire jusqu'au bout.
  # `[√]` sous Windows, `[✓]` sous macOS et Linux.
  if ! flutter doctor 2>/dev/null | grep -E '\[(√|✓)\] Android toolchain' >/dev/null; then
    rouge "Le SDK Android n’est pas installé (flutter doctor). Lancez tools/android-sdk.sh — ~1,3 Go, sans Android Studio."
    exit 2
  fi
  if [ ! -f "apps/mobile/android/${KEY_PROPERTIES:-key.properties}" ]; then
    rouge "apps/mobile/android/${KEY_PROPERTIES:-key.properties} est absent : un .aab publié doit être signé avec la clé de l’école. Lancez : ${BRAND:+BRAND=$BRAND }tools/packager.sh cle"
    exit 2
  fi
  # ⚠ POUR LE PLAY STORE, API_URL EST OBLIGATOIRE. Le paquet 0.7.1+10, construit
  # sans elle, ne connaissait que localhost : l'examinateur de Google ne peut pas
  # se connecter, c'est un refus. Seul un .apk d'essai peut s'en passer.
  if [ "$cible" = aab ] && [ -z "${API_URL:-}" ]; then
    rouge "API_URL n’est pas défini : un .aab pour le Play Store doit connaître son serveur (ex. API_URL=https://api.elmouradarafat.cloud, ou BRAND=elmourad qui le porte)."
    exit 2
  fi
  if [ -z "${API_URL:-}" ]; then
    # ⚠ PAS UN REFUS, UN AVERTISSEMENT — depuis que l'application porte sa propre
    # porte. Il n'y a pas encore de serveur de production ; un paquet construit
    # sans API_URL démarre sur `localhost`, et la ligne « Serveur : … · modifier »
    # sous le formulaire de connexion permet de le pointer vers le vrai serveur
    # sans republier. Mais un .aab envoyé au Play Store dans cet état demanderait
    # à CHAQUE famille de saisir une adresse : on le dit, en rouge, et on continue.
    printf '[31m! API_URL n’est pas défini : le .aab démarrera sur localhost. Le serveur se saisit dans l’application (« Serveur · modifier »), ou reconstruisez avec API_URL=https://api.<domaine> avant de publier.[0m
'
  fi
  avertir_firebase
}

# LE .aab AVANT LE PLAY STORE — ce que le paquet 0.7.1+10 aurait fait refuser.
# Le manifeste d'un .aab est un protobuf : ses chaînes (noms de permissions) s'y
# lisent en clair. Le niveau d'API cible, lui, est fixé à 36 dans build.gradle.
verifier_aab() {
  local aab="$1" probleme=0 manifeste
  titre "Vérification du .aab"
  if ! command -v unzip >/dev/null 2>&1; then
    printf '\033[33m! unzip introuvable : vérification sautée (faites-la sur une autre machine).\033[0m\n'
    return 0
  fi
  manifeste="$(unzip -p "$aab" base/manifest/AndroidManifest.xml | tr -c '[:print:]' ' ')"
  for p in READ_EXTERNAL_STORAGE READ_MEDIA_IMAGES READ_MEDIA_VIDEO READ_MEDIA_AUDIO \
           MANAGE_EXTERNAL_STORAGE REQUEST_INSTALL_PACKAGES QUERY_ALL_PACKAGES \
           com.google.android.gms.permission.AD_ID; do
    if grep -qF "$p" <<< "$manifeste"; then rouge "permission $p dans le manifeste fusionné"; probleme=1; fi
  done
  if grep -qF debuggable <<< "$manifeste"; then rouge "paquet en mode débogage"; probleme=1; fi
  # ⚠ PAS `unzip -p … | grep -q` : sous `set -o pipefail`, grep -q s'arrête à la
  # première occurrence, unzip meurt de SIGPIPE (141) et le tube entier est
  # déclaré en échec — « introuvable » alors que l'adresse est là (0.7.4+13,
  # 24/09 : trouvée à l'octet 653 361 d'un libapp.so de 8 Mo). Le fichier est
  # extrait, puis cherché. (Même raison pour le manifeste : `<<<`, pas de tube.)
  local libapp
  libapp="$(mktemp)"
  unzip -p "$aab" base/lib/arm64-v8a/libapp.so > "$libapp"
  if [ -n "${API_URL:-}" ] && grep -aqF "${API_URL}" "$libapp"; then
    vert "adresse du serveur compilée : ${API_URL:-}"
  else
    rouge "API_URL (${API_URL:-vide}) introuvable dans libapp.so"; probleme=1
  fi
  rm -f "$libapp"
  if [ "$probleme" -ne 0 ]; then
    rouge "Ce .aab ne doit PAS partir au Play Store."
    exit 1
  fi
  vert "aucune permission interdite, pas de débogage — prêt pour la Play Console"
}

emballer_android() {
  titre "Application parent — Android (.aab pour le Play Store)"
  preparer_android aab
  ( cd apps/mobile
    mapfile -t D < <(dart_defines)
    flutter build appbundle --release "${D[@]}"
  )
  cp apps/mobile/build/app/outputs/bundle/release/app-release.aab "$DIST/${PREFIXE}parent-$VERSION.aab"
  verifier_aab "$DIST/${PREFIXE}parent-$VERSION.aab"
  vert "$DIST/${PREFIXE}parent-$VERSION.aab  → Play Console, test fermé puis production"
}

emballer_apk() {
  # LE MÊME PAQUET, INSTALLABLE À LA MAIN — pour une démonstration ou un essai :
  # un fichier envoyé par WhatsApp ou copié sur le téléphone, ouvert, installé
  # (« Sources inconnues » à autoriser une fois). Universel (toutes les
  # architectures) : plus lourd, mais un seul fichier qui s'installe partout.
  #
  # ⚠ PAS REMPLAÇABLE PAR LA VERSION DU PLAY STORE. Avec la signature
  # d'application Play (le réglage par défaut), Google signe ce qu'il distribue
  # avec SA clé, pas avec la clé de téléversement qui signe ce .apk : le Play
  # Store refusera de le mettre à jour, il faudra le désinstaller. Ne pas le
  # donner aux familles une fois l'application publiée.
  titre "Application parent — Android (.apk installable, démos)"
  preparer_android apk
  ( cd apps/mobile
    mapfile -t D < <(dart_defines)
    flutter build apk --release "${D[@]}"
  )
  cp apps/mobile/build/app/outputs/flutter-apk/app-release.apk "$DIST/${PREFIXE}parent-$VERSION.apk"
  vert "$DIST/${PREFIXE}parent-$VERSION.apk  → à copier sur le téléphone et ouvrir (autoriser l'installation depuis cette source)"
}

# L'ENSEIGNE SUR LE PROJET iOS — dans une COPIE, jamais dans le dépôt : l'identifiant
# de l'application (APP_ID), le nom sous l'icône (APP_LABEL) et les icônes de
# ios/brands/<enseigne>/. Sans cela, un .ipa construit pour Jinan sortait
# « El Ourwa », mr.elourwa.parent, icône par défaut (le projet ne porte que
# l'enseigne d'origine ; Android, lui, lit APP_ID / APP_LABEL dans Gradle).
appliquer_marque_ios() {
  local projet="$1"
  local id="${APP_ID:-mr.elourwa.parent}" nom="${APP_LABEL:-${BRAND_NAME:-El Ourwa}}"
  sed -i.bak -e "s/PRODUCT_BUNDLE_IDENTIFIER = mr\.elourwa\.parent/PRODUCT_BUNDLE_IDENTIFIER = $id/" \
    "$projet/ios/Runner.xcodeproj/project.pbxproj" && rm -f "$projet/ios/Runner.xcodeproj/project.pbxproj.bak"
  for f in Debug Release; do
    sed -i.bak -e "s/^APP_DISPLAY_NAME = .*/APP_DISPLAY_NAME = $nom/" "$projet/ios/Flutter/$f.xcconfig" \
      && rm -f "$projet/ios/Flutter/$f.xcconfig.bak"
  done
  if [ -n "${BRAND:-}" ] && [ -d "$projet/ios/brands/$BRAND/AppIcon.appiconset" ]; then
    rm -rf "$projet/ios/Runner/Assets.xcassets/AppIcon.appiconset"
    cp -R "$projet/ios/brands/$BRAND/AppIcon.appiconset" "$projet/ios/Runner/Assets.xcassets/AppIcon.appiconset"
  fi
  grep -q "PRODUCT_BUNDLE_IDENTIFIER = $id;" "$projet/ios/Runner.xcodeproj/project.pbxproj" \
    || { rouge "iOS : l'identifiant $id n'a pas pu être posé"; exit 2; }
}

# LE PROJET iOS PRÊT À CONSTRUIRE — sur N'IMPORTE QUEL poste (même sans Mac) :
# apps/mobile tel que commité, l'enseigne appliquée, et `construire-ios.sh` qui
# porte déjà l'adresse du serveur et les noms (dart-defines). Sur le Mac :
# dézipper, `bash construire-ios.sh`. → dist/<enseigne->ios-<version>.zip
emballer_ios_projet() {
  titre "Application parent — iOS (projet prêt pour Xcode)"
  local nom="${PREFIXE}ios-$VERSION" tmp; tmp="$(mktemp -d)"
  # Depuis la racine git, le chemin complet : lancé d'un sous-dossier (la
  # plateforme vit dans plateforme/ du dépôt ourwa), git archive filtre AUSSI
  # par ce sous-dossier, et l'archive d'un arbre sortait vide.
  local prefixe; prefixe="$(git rev-parse --show-prefix)"
  mkdir -p "$tmp/$nom"
  git -C "$(git rev-parse --show-toplevel)" archive --format=tar "HEAD:${prefixe}apps/mobile" | tar -x -C "$tmp/$nom"
  [ -f "$tmp/$nom/pubspec.yaml" ] || { rouge "iOS : le projet apps/mobile n'a pas pu être extrait"; exit 2; }
  appliquer_marque_ios "$tmp/$nom"
  mapfile -t D < <(dart_defines)
  {
    echo '#!/usr/bin/env bash'
    echo "# ${BRAND_NAME:-El Ourwa} — construire le .ipa (App Store) sur un Mac avec Xcode et Flutter."
    echo '# Une fois, dans Xcode (open ios/Runner.xcworkspace) → Runner → Signing & Capabilities :'
    echo "#   l'équipe Apple (Team), identifiant ${APP_ID:-mr.elourwa.parent} ; + Push Notifications."
    echo 'set -euo pipefail'
    echo 'cd "$(dirname "$0")"'
    echo 'flutter pub get'
    echo '( cd ios && pod install )'
    printf 'flutter build ipa --release --export-method app-store'
    # Entre apostrophes, lisibles (le nom arabe reste en clair) ; %q si une
    # apostrophe s'y trouve.
    for a in "${D[@]}"; do
      case "$a" in *"'"*) printf ' \\\n  %q' "$a" ;; *) printf " \\\\\n  '%s'" "$a" ;; esac
    done
    echo
    echo 'echo "✓ build/ios/ipa/*.ipa → Transporter (App Store Connect)"'
  } > "$tmp/$nom/construire-ios.sh"
  chmod +x "$tmp/$nom/construire-ios.sh"
  rm -f "$DIST/$nom.zip"
  ( cd "$tmp" && if command -v zip >/dev/null 2>&1; then zip -qr "$DIST/$nom.zip" "$nom"; else python3 -m zipfile -c "$DIST/$nom.zip" "$nom"; fi )
  rm -rf "$tmp"
  vert "$DIST/$nom.zip — sur un Mac : dézipper, puis bash $nom/construire-ios.sh"
}

emballer_ios() {
  titre "Application parent — iOS (.ipa pour l’App Store)"
  case "$(uname -s)" in
    Darwin) ;;
    *) rouge "Un .ipa ne se construit que sur macOS avec Xcode. Ce poste est $(uname -s)."
       echo "  Pour préparer le projet ici et le construire sur un Mac : ${BRAND:+BRAND=$BRAND }tools/packager.sh ios-projet"
       exit 2 ;;
  esac
  exiger flutter "https://docs.flutter.dev/get-started/install"
  avertir_firebase
  # Construit dans une copie marquée : le dépôt n'est jamais modifié.
  emballer_ios_projet
  local nom="${PREFIXE}ios-$VERSION" tmp; tmp="$(mktemp -d)"
  ( cd "$tmp" && unzip -q "$DIST/$nom.zip" && bash "$nom/construire-ios.sh" )
  cp "$tmp/$nom"/build/ios/ipa/*.ipa "$DIST/${PREFIXE}parent-$VERSION.ipa"
  rm -rf "$tmp"
  vert "$DIST/${PREFIXE}parent-$VERSION.ipa  → Transporter"
}

# LE ZIP DU DÉPÔT — ce qui est COMMITÉ (git archive HEAD), rien d'autre : ni
# node_modules, ni .next, ni les bases de référence. Assez pour construire et
# héberger (deploy/elmourad/install.sh construit l'image sur le serveur). Pas
# de binaire zip sur ce poste : Compress-Archive de PowerShell.
emballer_zip() {
  local enseigne="${BRAND:-elourwa}"
  titre "Le zip du dépôt — ${enseigne}"
  if [ -n "$(git status --porcelain)" ]; then
    printf '[33m! Des changements non commités ne seront PAS dans le zip (git archive HEAD).[0m\n'
  fi
  local nom="${PREFIXE}${VERSION}"
  # ⚠ git archive, pas Compress-Archive : PowerShell 5.1 écrit des barres
  # obliques INVERSES dans le zip, et unzip sur Linux en fait des noms de
  # fichiers à barres — l'archive était inutilisable sur le serveur.
  local tmp; tmp="$(mktemp -d)"
  printf 'Construit le %s depuis %s\n' "$(date -u +%Y-%m-%dT%H:%MZ)" "$(git rev-parse HEAD)" > "$tmp/VERSION.txt"
  local ajouts=(--add-file="$tmp/VERSION.txt")
  if [ -n "${BRAND:-}" ] && [ -f "deploy/$BRAND/README.md" ]; then
    cp "deploy/$BRAND/README.md" "$tmp/LISEZMOI-$BRAND.md"
    ajouts+=(--add-file="$tmp/LISEZMOI-$BRAND.md")
  fi
  rm -f "$DIST/$nom.zip"
  git archive --format=zip --prefix="$nom/" "${ajouts[@]}" -o "$DIST/$nom.zip" HEAD
  rm -rf "$tmp"
  vert "$DIST/$nom.zip  ($(du -h "$DIST/$nom.zip" | cut -f1)) — dézipper sur le serveur, puis deploy/${BRAND:-oracle}/install.sh"
}

case "${1:-}" in
  cle)          creer_cle ;;
  zip)          emballer_zip ;;
  web)         emballer_web ;;
  flutter-web) emballer_flutter_web ;;
  android)     emballer_android ;;
  apk)         emballer_apk ;;
  ios)         emballer_ios ;;
  ios-projet)  emballer_ios_projet ;;
  all)         emballer_web; emballer_flutter_web; emballer_android || true; emballer_apk || true; emballer_ios || true; emballer_zip ;;
  *) sed -n '2,20p' "$0"; exit 2 ;;
esac
