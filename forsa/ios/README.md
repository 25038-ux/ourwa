# FORSA for iPhone

A native SwiftUI shell around the FORSA web app (the same model as the Android app — ADR-016): the organisation's
server does all the work, the app adds what a phone should feel like.

| Native feature | How |
|---|---|
| First-launch server setup | `SetupView` — checks that `https://…/manifest.webmanifest` is a FORSA server before saving it |
| Full-screen web app | `WKWebView`, edge to edge (the web app handles the safe areas), swipe back/forward, pull to refresh |
| Voice dictation | Microphone granted only to the FORSA server's own origin |
| Calendar (.ics) and exports | Downloaded, then opened in Quick Look (offers *Add to Calendar* and *Share*) |
| WhatsApp / e-mail / official notices | Opened in their own apps; FORSA stays on your server |
| Haptics | The web app's `haptic()` calls the native Taptic Engine through the `forsa` message handler |
| Offline screen | Retry or change server; splash while the first page loads |
| Home-screen quick action | Long-press the icon → *Change server* |
| Languages | French (default), English, Arabic (right-to-left) |

Bundle id `mr.forsa.app`, iOS 15+, iPhone. Privacy: no tracking, no third-party SDK, no analytics.

## Build without a Mac — GitHub Actions
`.github/workflows/forsa-ios.yml` runs on every push that touches `forsa/ios/**` (or manually: *Actions → forsa-ios
→ Run workflow*). The **build** job produces the artifact `FORSA-iOS-1.0.0-build`:

* `FORSA-1.0.0-simulator.app.zip` — runs in the iOS Simulator (`xcrun simctl install booted FORSA.app`);
* `FORSA-1.0.0-unsigned.ipa` and `FORSA-1.0.0-unsigned.xcarchive.zip` — device build, **not signed**: iPhones only
  install apps signed by an Apple Developer account, so it must be signed (below) or re-signed before install;
* `simulator-screenshots/` — the app launched in the Simulator (FR/EN/AR), proof that it starts.

### Signed build and TestFlight (needs an Apple Developer account, 99 USD/year)
1. In App Store Connect create the app with bundle id `mr.forsa.app` (Certificates, Identifiers & Profiles →
   Identifiers first if needed).
2. App Store Connect → Users and Access → Integrations → **App Store Connect API** → generate a key with the
   *Admin* role (needed for cloud-managed certificates). Note the *Key ID* and *Issuer ID*, download the `.p8`.
3. GitHub → repository → Settings → Secrets and variables → Actions:
   * variable `IOS_TEAM_ID` = your 10-character Team ID (developer.apple.com → Membership);
   * optional variable `FORSA_DEFAULT_SERVER` = `https://forsa.your-domain.mr` (skips the setup screen);
   * secrets `IOS_ASC_KEY_ID`, `IOS_ASC_ISSUER_ID`, `IOS_ASC_KEY_P8` (the full text of the `.p8` file).
4. Actions → forsa-ios → Run workflow (tick *Upload to TestFlight* to send it straight to TestFlight). The
   **signed** job produces `FORSA-iOS-1.0.0-appstore-signed` (a signed `FORSA.ipa`). The build number is the
   workflow run number, so every upload is unique.

## Build on a Mac
```bash
brew install xcodegen
cd forsa/ios && xcodegen generate && open FORSA.xcodeproj
```
In Xcode: target FORSA → Signing & Capabilities → pick your Team → Run on a phone, or Product → Archive →
Distribute App. `ci/ExportOptions-AppStore.plist` and `ci/ExportOptions-AdHoc.plist` serve `xcodebuild
-exportArchive` (add your `teamID`). To bake your server in, set `FORSA_DEFAULT_SERVER` in `project.yml`.

## Before submitting to the App Store
* Privacy policy URL: `https://<your server>/privacy` (public page of the web app).
* Account deletion (guideline 5.1.1(v)): in the app, *Settings → Delete my account*.
* Give App Review a demo account and server address in the review notes (see the iOS attachments pack).
* Guideline 4.2 (minimum functionality): the app is more than a website — native setup, voice, calendar, haptics,
  offline handling — but review outcomes are Apple's decision.
* Push notifications: the iOS app shows notifications live while it is open (server-sent events). Native
  background push (APNs) is **not implemented yet**.
