/**
 * LES GABARITS DE NOTIFICATION — les mots d'El Ourwa, dans les deux langues.
 *
 * `includes/parent_auth.php` range une notification comme une clé et des
 * paramètres, et `includes/i18n.php` porte le texte : `notif_absence_titre`,
 * `notif_absence_corps`… L'application parent en a une copie en Dart
 * (`lib/src/i18n.dart`, « extraite de la référence ») et rend le texte
 * elle-même, dans la langue du parent.
 *
 * ⚠ LE SERVEUR EN A BESOIN AUSSI, DEPUIS QU'IL POUSSE. Une notification poussée
 * s'affiche sur l'écran verrouillé d'un téléphone où l'application ne tourne
 * pas : le texte doit donc partir DU SERVEUR, déjà rendu, dans la langue du
 * compte. D'où cette copie en TypeScript — et le test `notifications.spec.ts`
 * qui la compare à la table Dart, clé par clé, pour que les deux ne dérivent
 * jamais l'une de l'autre.
 *
 * ⚠ UN ÉCRAN VERROUILLÉ LIT À QUI TIENT LE TÉLÉPHONE. La note d'un enfant n'y a
 * rien à faire : `renduPourPousser()` remplace `{note}` par un tiret, et le
 * chiffre se lit dans l'application. Tout le reste — une absence, un exercice,
 * un paiement enregistré — est ce que la famille attend de voir, tout de suite.
 */

export type Langue = 'fr' | 'ar';

export const NOTIF: Record<string, Record<Langue, string>> = {
  notif_absence_titre: {
    fr: 'Absence signalée',
    ar: 'تسجيل غياب',
  },
  notif_absence_corps: {
    fr: '{eleve} a été marqué(e) absent(e) le {date}.',
    ar: 'تم تسجيل غياب {eleve} بتاريخ {date}.',
  },
  notif_retard_titre: {
    fr: 'Retard signalé',
    ar: 'تسجيل تأخر',
  },
  notif_retard_corps: {
    fr: '{eleve} est arrivé(e) en retard le {date}.',
    ar: 'وصل(ت) {eleve} متأخرا بتاريخ {date}.',
  },
  notif_note_titre: {
    fr: 'Nouvelle note : {matiere}',
    ar: 'نقطة جديدة : {matiere}',
  },
  notif_note_corps: {
    fr: '{eleve} a obtenu {note} en {matiere} ({trimestre}).',
    ar: 'تحصل(ت) {eleve} على {note} في مادة {matiere} ({trimestre}).',
  },
  notif_exercice_titre: {
    fr: 'Nouvel exercice : {matiere}',
    ar: 'تمرين جديد : {matiere}',
  },
  notif_exercice_corps: {
    fr: 'Exercice « {titre} » pour {eleve}.{limite}',
    ar: 'تمرين « {titre} » لـ {eleve}.{limite}',
  },
  notif_remarque_titre: {
    fr: 'Remarque du professeur',
    ar: 'ملاحظة من الأستاذ',
  },
  notif_remarque_corps: {
    fr: 'Une remarque a été ajoutée pour {eleve}.',
    ar: 'تمت إضافة ملاحظة بخصوص {eleve}.',
  },
  notif_message_titre: {
    fr: 'Nouveau message : {sujet}',
    ar: 'رسالة جديدة : {sujet}',
  },
  notif_message_corps: {
    fr: '{contenu}',
    ar: '{contenu}',
  },
  notif_paiement_titre: {
    fr: 'Paiement enregistré',
    ar: 'تم تسجيل الدفع',
  },
  notif_paiement_corps: {
    fr: 'Paiement de {montant} MRU enregistré pour {eleve}.',
    ar: 'تم تسجيل دفعة بقيمة {montant} أوقية لـ {eleve}.',
  },
  notif_rappel_titre: {
    fr: 'Rappel de paiement',
    ar: 'تذكير بالدفع',
  },
  notif_rappel_corps: {
    fr: "Le paiement de {eleve} pour {mois} n'a pas encore été enregistré. Merci de régulariser.",
    ar: 'لم يتم تسجيل دفع {eleve} لشهر {mois} بعد. يرجى التسوية.',
  },
  notif_inscription_titre: {
    fr: 'Nouvelle inscription',
    ar: 'تسجيل جديد',
  },
  notif_inscription_corps: {
    fr: '{eleve} a été inscrit(e) en {groupe}.',
    ar: 'تم تسجيل {eleve} في {groupe}.',
  },
  notif_reinscription_titre: {
    fr: 'Réinscription',
    ar: 'إعادة التسجيل',
  },
  notif_reinscription_corps: {
    fr: '{eleve} a été réinscrit(e) en {groupe}.',
    ar: 'تمت إعادة تسجيل {eleve} في {groupe}.',
  },
  notif_emploi_titre: {
    fr: 'Emploi du temps publié',
    ar: 'تم نشر جدول الحصص',
  },
  notif_emploi_corps: {
    fr: 'L\'emploi du temps de la classe {groupe} a été publié. Consultez le profil de votre enfant pour le voir.',
    ar: 'تم نشر جدول الحصص للقسم {groupe}. اطلع على ملف ابنك (ابنتك) للاطلاع عليه.',
  },
  // Poussée par le serveur à la demande du téléphone (profil → « Notifications ») :
  // si elle arrive, toute la chaîne — jeton, Firebase, canal, son, vibration — est en place.
  notif_test_titre: {
    fr: 'Test de notification',
    ar: 'اختبار الإشعار',
  },
  notif_test_corps: {
    fr: 'Si vous voyez ceci, les notifications instantanées fonctionnent sur ce téléphone.',
    ar: 'إذا رأيت هذا، فالإشعارات الفورية تعمل على هذا الهاتف.',
  },
};

/**
 * Remplace `{param}` par sa valeur. Un paramètre absent reste `{param}`,
 * DÉLIBÉRÉMENT : c'est comme cela que le trou se voit le jour où il apparaît,
 * plutôt que six mois après (c'est la règle que suit déjà l'application).
 */
export function rendre(cle: string, params: Record<string, unknown>, langue: Langue): string {
  const gabarit = NOTIF[cle]?.[langue] ?? NOTIF[cle]?.fr ?? cle;
  return gabarit.replace(/\{(\w+)\}/g, (tout, nom: string) =>
    params[nom] === undefined || params[nom] === null ? tout : String(params[nom]),
  );
}

/** Le titre et le corps d'une notification, depuis sa souche (`notif_absence`). */
export function renduPourPousser(
  souche: string,
  params: Record<string, unknown>,
  langue: Langue,
): { title: string; body: string } {
  // ⚠ Jamais une note sur un écran verrouillé.
  const surs = { ...params, note: params.note === undefined ? undefined : '—' };
  return {
    title: rendre(`${souche}_titre`, surs, langue),
    body: rendre(`${souche}_corps`, surs, langue),
  };
}
