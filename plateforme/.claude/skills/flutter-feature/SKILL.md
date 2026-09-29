---
name: flutter-feature
description: Add a feature to the Flutter parent app. Use when building a screen or flow in apps/mobile — covers screen, state, API client, offline cache, RTL, and widget tests.
---

# Adding a Flutter feature

The mobile app is **parents only**. Teachers use the responsive web app; there is
no teacher mobile app.

## Layout

```
apps/mobile/lib/src/<feature>/
  <feature>_screen.dart
  <feature>_controller.dart
  <feature>_models.dart
test/<feature>_test.dart
```

## Arabic is a first-class layout, not a translation

The app ships French and Arabic. Arabic is RTL, and that drives the whole widget
tree.

- Never `EdgeInsets.only(left:)` — use `EdgeInsetsDirectional.only(start:)`
- Never `Alignment.centerLeft` — use `AlignmentDirectional.centerStart`
- Never `Row(children: [icon, text])` assuming icon-then-text visually
- Test both directions; wrap in `Directionality` in widget tests

## Notifications are keys, not sentences

The server stores a translation key plus parameters, and the client renders it in
the parent's current language. Never store a rendered sentence — a parent who
switches language would keep seeing the old one.

## Offline

Parents in Nouakchott are frequently on poor connections. Cache what has been
loaded, show it immediately, and refresh behind it. A spinner over content the
device already has is worse than slightly stale content.

## Money

Amounts arrive from the API as **strings**. Keep them as strings or parse to
`Decimal`. Never `double.parse` an amount — see the `money-handling` skill.

## Tests

```dart
testWidgets('renders the report card right-to-left in Arabic', (tester) async {
  await tester.pumpWidget(const Directionality(
    textDirection: TextDirection.rtl,
    child: ReportCardScreen(...),
  ));
  expect(find.byType(ReportCardScreen), findsOneWidget);
});
```

## Checklist

- [ ] Directional insets and alignments throughout
- [ ] Both locales exercised in tests
- [ ] Amounts never `double`
- [ ] Cached content shown before the network answers
- [ ] Guardian sees only their own children — asserted, not assumed
- [ ] `flutter test` passes
