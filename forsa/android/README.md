# FORSA for Android

A native Android app that opens FORSA as a **Trusted Web Activity** (Chrome renders the web app full-screen:
push notifications, voice dictation, uploads — identical to the web). If the phone has no compatible browser, the
app uses its own WebView shell (microphone, uploads, calendar downloads, pull-to-refresh, offline screen).

* Package: `mr.forsa.app` · minSdk 24 (Android 7) · targetSdk 35 · languages: French (default), English, Arabic
* First launch asks for the organisation's FORSA address (verified by reading its web-app manifest).
  To ship a build locked to your server: `./gradlew assembleRelease -PforsaUrl=https://forsa.example.mr`.

## Files delivered
| File | Use |
|---|---|
| `FORSA-1.0.0.apk` | Signed release APK — install directly on phones (sideload) or distribute via MDM |
| `FORSA-1.0.0.aab` | Android App Bundle — upload to Google Play Console |
| `FORSA-debug.apk` | Debug build (allows `http://` servers for local testing) |
| `keystore/forsa-release.jks` + `keystore.properties` | **Signing key** — store it safely (password manager + offline copy). Losing it means you can no longer update the app outside Play App Signing. |

## Full-screen (remove the browser bar)
Chrome shows the app full-screen only when your website vouches for the app:
1. Get the signing certificate fingerprint:
   `keytool -list -v -keystore keystore/forsa-release.jks | grep SHA256` (delivered key:
   `13:3C:1C:48:7C:AE:3E:DB:77:AB:28:C0:85:84:44:7B:0F:A1:F8:2C:74:21:1E:FF:8C:C6:A0:72:70:13:62:01`).
   With Google Play App Signing, also add the *App signing key* SHA-256 from Play Console → App integrity.
2. Put it in the server's `.env`: `FORSA_ANDROID_SHA256=<fingerprint>[,<play fingerprint>]` and restart the API.
3. Check `https://<your domain>/.well-known/assetlinks.json` lists it.

## Build it yourself
Requirements: JDK 17+, Android SDK (platform 35, build-tools 35.0.0).
```bash
cd android
cp keystore.properties.example keystore.properties   # point it to your keystore
./gradlew assembleRelease bundleRelease
```
