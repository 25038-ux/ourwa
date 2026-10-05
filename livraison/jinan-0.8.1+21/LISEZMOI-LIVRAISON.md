# Jinan — delivery 0.8.1+21 (5 October 2026): instant notifications

This is the first build of the parents' app with Firebase. Everything in this
folder belongs together:

| File | What it is | What to do with it |
|---|---|---|
| `jinan-0.8.1+21.zip` | The whole platform (website + API + migrations), as committed | Nothing. The server is already up to date. Keep it as an archive. |
| `jinan-parent-0.8.1+21-ESSAI.apk` | The parents' Android app, **test-signed**, with Firebase | Install it on a phone to test notifications (step 2). Not for the Play Store. |
| `jinan-parent-0.8.1+21-non-signe.aab` | The parents' Android app for Google Play, **unsigned**, with Firebase | Sign it on your PC with your upload key (step 3), then upload it to Play Console. |
| `jinan-ios-0.8.1+21.zip` | The iOS project (Xcode) | On a Mac: unzip, `bash construire-ios.sh`, then Transporter (see `LISEZMOI-ios` inside). |
| `captures/` | Screenshots of the website and the app (the screens did not change since 0.8.0) | — |
| `LISEZMOI-jinan.md` | The full server installation / update guide (French) | Reference. |
| `SHA256SUMS.txt` | Checksums of every file | `sha256sum -c SHA256SUMS.txt` to check a download. |

## 1. The server: already done

`https://api.ecole-jinan.com/health` shows migration **0049** and
`"push":"firebase"`. The update ran, and the server has its Firebase key. There's
nothing to type.

## 2. Test on a phone (5 minutes)

1. Uninstall the old Jinan test app if it's on the phone. A test-signed APK can't
   replace a Play Store install, and the reverse is also true.
2. Install `jinan-parent-0.8.1+21-ESSAI.apk`, log in as a parent, and **accept the
   notification permission**.
3. **Profil → Notifications** should show four green lines:
   - *Intégrées à cette version*
   - *Ce téléphone est déclaré au serveur*
   - *Le serveur envoie par Firebase…*
   - *Notifications autorisées*
4. Press **« Recevoir une notification de test du serveur »**, then close the app
   right away. The notification should ring and vibrate within a few seconds.
5. Real proof: from the website, send that family a message (*Messagerie parents*)
   or upload one of their documents (*Documents*). The phone rings with the app
   closed.

If *« Services Google indisponibles »* appears, the phone has no Google services
(recent Huawei phones). That phone keeps the old behaviour: the app checks the
server every 15 minutes when closed.

## 3. Sign the Play Store bundle (on your PC, PowerShell)

Your upload key stays on your PC (`C:\Eduplateforme\jinan_deployement`). Put the
`.aab` next to `signer-aab.ps1` (in the zip: `plateforme/tools/signer-aab.ps1`) and run:

    powershell -ExecutionPolicy Bypass -File .\signer-aab.ps1

The script signs with `jinan-upload.jks` and checks that the certificate is the
one Play expects (SHA-256 `8D:76:DF:…:7E:F2:86`). Upload the signed file in
Play Console → Production (or internal testing) → Create a new release. The
version code is **21**, so it replaces 20 (or anything older).

Families who update from the Play Store get notifications when they open the
new version and accept the permission.

## 4. What changed in the app

- Firebase values compiled in: project `el-mourad`, app
  `1:721820198526:android:76a37c1a083d25811d9a2f`, and the project's API key.
- **About the API key:** the Firebase console doesn't show a key under the Jinan app
  because there isn't one per app. Firebase creates **one Android key for the whole
  project**, and every Android app in it shares that key. It's the same key El Mourad
  uses. That's expected, and you don't need to do anything.
- **iPhone:** Firebase on iOS needs an *iOS* app registered in Firebase and an
  Apple APNs key. Without them, the iPhone build doesn't start Firebase. It never
  receives the Android ID, which could make it crash at launch. The iPhone keeps
  checking the server (every 15–30 s while open). When the school has iPhone
  parents, register an iOS app in Firebase (bundle `mr.jinan.parent`), upload the
  APNs `.p8` key in Firebase → Cloud Messaging, and send me its App ID
  (`1:721820198526:ios:…`) so I can rebuild the iOS project.
