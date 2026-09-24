# ADR-017: iOS app (WKWebView shell, CI-built) and self-service account deletion

**Status:** Accepted (2026-09-24)

## iOS app
Same model as Android (ADR-016): a thin native shell around the PWA so there is one UI codebase. `ios/` is a
SwiftUI app (iOS 15+, iPhone, bundle `mr.forsa.app`) generated with **XcodeGen** (`project.yml`; the `.xcodeproj`
is not committed). Native parts: first-launch server setup (verified against the server's web manifest), full-screen
`WKWebView`, microphone granted only to the server's own origin, downloads (.ics, exports) opened in Quick Look,
external links handed to their apps, a `forsa` script-message bridge for haptics (`lib/motion.ts` → Taptic Engine),
offline screen, quick action "Change server", FR/EN/AR.

Build: `.github/workflows/forsa-ios.yml` on GitHub macOS runners — simulator app, unsigned archive and IPA,
Simulator screenshots (launch proof); a **signed** job runs only when the repository has an App Store Connect API
key and Team ID (cloud-managed signing via `-allowProvisioningUpdates`, optional TestFlight upload). No signing
material is stored in the repository.

Rejected: Capacitor/React Native (second UI stack); PWA-only on iOS (no App Store presence, weaker voice/downloads).
Not done yet: native push (APNs) — WKWebView has no Web Push, so iOS app users get live notifications only while
the app is open (the installed PWA still receives Web Push).

## Account deletion
Both stores require in-app account deletion. `POST /me/delete` (password-confirmed) removes or anonymises the
person — push subscriptions, assistant conversations, notifications and memberships deleted; e-mail/name replaced;
password randomised; account disabled — while **organisation records stay with the organisation** (tasks are
unassigned, bids and evidence remain). The last owner of an organisation that has other members must transfer
ownership first. Audit events keep only the user id. A public `/privacy` page (FR/EN) documents the processing; the
operator's name and contact come from `FORSA_OPERATOR_NAME` / `FORSA_PRIVACY_CONTACT`.
