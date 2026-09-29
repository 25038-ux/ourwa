import 'package:flutter_test/flutter_test.dart';
import 'package:elourwa_parent/src/i18n.dart';

/// LE TEXTE D'UNE NOTIFICATION, dans la langue du parent.
///
/// ⚠ THE STREAM WAS WRITE-ONLY. Rows have been inserted since homework shipped
/// and nothing in the system read one back — no endpoint, no screen, no badge.
/// So a school sent an exercise to thirty families and none of them were told.
/// Now that they are read, they have to be readable.
///
/// El Ourwa stores a key and its parameters rather than a sentence, and its own
/// comment says why: "La clé i18n permet d'afficher la notification dans la
/// langue du parent (français OU arabe)". A family reading Arabic must not be
/// handed French because that was the language of whoever pressed the button.
void main() {
  test('renders an exercise notification in both languages', () {
    final fr = notificationTexte('notif_exercice', {'titre': 'Fractions'}, 'fr');
    expect(fr.corps, contains('Fractions'));

    final ar = notificationTexte('notif_exercice', {'titre': 'Fractions'}, 'ar');
    expect(ar.titre, isNot(fr.titre));
    expect(ar.corps, contains('Fractions'));
  });

  test('renders a published timetable, naming the class', () {
    final fr = notificationTexte('notif_emploi', {'groupe': '6ème / 6ème A'}, 'fr');
    expect(fr.titre, 'Emploi du temps publié');
    // Its own second sentence is the useful half — it says where to look.
    expect(fr.corps, contains('6ème / 6ème A'));
    expect(fr.corps, contains('profil de votre enfant'));

    final ar = notificationTexte('notif_emploi', {'groupe': '6ème / 6ème A'}, 'ar');
    expect(ar.corps, contains('6ème / 6ème A'));
  });

  test('⚠ a missing parameter leaves its placeholder visible', () {
    // "{eleve} a été marqué(e) absent(e)" with no `eleve` becomes a sentence
    // about nobody, which a parent reads as being about their own child anyway.
    // Ugly and honest beats fluent and wrong, and it surfaces the day a sender
    // forgets a parameter rather than six months later.
    final fr = notificationTexte('notif_absence', {'date': '12/03'}, 'fr');
    expect(fr.corps, contains('{eleve}'));
    expect(fr.corps, contains('12/03'));
  });

  test('⚠ an unknown stem still produces something, never a blank card', () {
    // A notification nobody can translate is still evidence that something
    // happened. An empty card is not.
    final fr = notificationTexte('notif_quelque_chose_de_neuf', const {}, 'fr');
    expect(fr.titre, 'notif_quelque_chose_de_neuf');
    expect(fr.corps, '');
  });

  test('every notification stem the API writes has both halves', () {
    // ⚠ The API writes the STEM; the app appends `_titre` / `_corps`. A stem
    // added on one side and not the other is a card that renders its own key to
    // a parent, and nothing else would catch it.
    for (final stem in ['notif_exercice', 'notif_emploi', 'notif_note', 'notif_absence']) {
      for (final lang in ['fr', 'ar']) {
        expect(t('${stem}_titre', lang), isNot('${stem}_titre'),
            reason: '$stem has no title in $lang');
        expect(t('${stem}_corps', lang), isNot('${stem}_corps'),
            reason: '$stem has no body in $lang');
      }
    }
  });
}
