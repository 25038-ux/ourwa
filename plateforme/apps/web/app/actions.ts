'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import {
  apiFetch,
  ApiError,
  readRefreshToken,
  requireSession,
  writeSession,
} from '@/lib/session';
import { clientIdentityHeaders } from '@/lib/client-identity';
import { currentSlug, estEcoleServices } from '@/lib/tenant';
import { MOIS_NOMS } from '@/lib/mois';
import { validatePassword } from '@elourwa/shared/password';
import { verifierFichier as verifierRegleFichier, type FamilleFichier } from '@elourwa/shared/fichiers';
import { money, toStorage } from '@elourwa/shared/money';
import { estServiceOptionnel, libelleMode, libelleService } from '@elourwa/shared/facturation';
import { hoteAvecSlug, LIBELLE_FRAIS_PHOTOCOPIE } from '@/lib/brand';
import { CHAMPS_TARIF_NIVEAU, type ChampTarifNiveau, type PrixService, type TarifNiveau } from '@/lib/facturation';

/** L'année consultée, telle que le formulaire la porte, pour la garder après la redirection. */
function anneeConservee(form: FormData): string {
  const annee = String(form.get('annee_id') ?? '').trim();
  return /^[0-9a-f-]{36}$/i.test(annee) ? `&annee_id=${annee}` : '';
}

/** Un montant saisi, en décimal — `null` s'il n'en est pas un. */
function montantDecimal(brut: string): ReturnType<typeof money> | null {
  const t = String(brut ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  return money(t);
}

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

/** Record a tuition payment. Tender lines must sum exactly to the amount. */
// `recordPaymentAction` retirée (22/09) : elle appelait une route de caisse sans les gardes du guichet, et rien ne l'appelait.

/**
 * ENCAISSER — the collection window's one submission.
 *
 * ⚠ ONE TOTAL, THREE DEBTS. The window shows the month and both annexe fees
 * together, and the API splits what is taken: the annexe fees first, the
 * remainder to the month. This action does no arithmetic of its own beyond
 * unpacking the form — a second implementation of the split here would be a
 * second thing to keep right.
 *
 * The period arrives as "YYYY-M" because a bare month number does not say which
 * civil year it belongs to, and the server validates it against the year's own
 * payable months rather than trusting the form.
 */
// `collectAction` retirée (22/09) : elle appelait une route de caisse sans les gardes du guichet, et rien ne l'appelait.

/**
 * ACCORDER UNE REMISE — lower or cancel what a family owes.
 *
 * ⚠ NOT A DISPLAY ADJUSTMENT. It really reduces the debt, flows through to
 * Impayés and unblocks re-enrolment. Author, amount and reason are recorded by
 * the API, and revoking it is a second recorded act rather than an edit.
 */
export async function writeOffAction(_prev: unknown, form: FormData) {
  // Son `remise_dette` : le motif est facultatif ; un montant nul ou absent en
  // mode partiel est refusé avec ses mots.
  const mode = String(form.get('mode') ?? 'partiel') === 'total' ? 'total' : 'partiel';
  const reason = String(form.get('reason') ?? '').trim();
  const guardianId = String(form.get('guardianId') ?? '');
  // `reinscriptions.php` a ses propres mots (accentués) ; `gestion_caisse.php` les siens.
  const reinscriptions = String(form.get('page') ?? '') === 'reinscriptions';
  if (!guardianId) return { error: reinscriptions ? 'Famille introuvable.' : 'Correspondant introuvable.' };
  const amount = String(form.get('amount') ?? '').trim();
  if (mode === 'partiel' && !(Number(amount) > 0)) {
    return { error: reinscriptions ? 'Indiquez le montant à retirer de la dette.' : 'Indiquez le montant a retirer de la dette.' };
  }

  try {
    await apiFetch('/finance/write-offs', {
      method: 'POST',
      json: {
        guardianId,
        reason: reason || undefined,
        // ⚠ The typed string, not `Number(amount).toFixed(2)`. A remise is a
        // real reduction of what a family owes; sending it through a float is
        // how a debt ends up a centime out and a reconciliation fails.
        ...(mode === 'total' ? { clearsAll: true } : { amount: /^\d+(\.\d{1,2})?$/.test(amount) ? amount : Number(amount).toFixed(2) }),
      },
    });
    revalidatePath('/finance');
    revalidatePath(`/finance/${guardianId}`);
    revalidatePath('/re-enrol/bulk');
    const [entier, cents] = Number(amount).toFixed(2).split('.');
    if (reinscriptions) {
      return {
        ok:
          mode === 'total'
            ? 'Dette annulée : la famille peut réinscrire.'
            : `Remise de ${mruMsg(entier ?? '0')},${cents ?? '00'} MRU enregistrée.`,
      };
    }
    return {
      ok:
        mode === 'total'
          ? 'Dette annulee pour ce correspondant.'
          : `Remise de ${mruMsg(entier ?? '0')},${cents ?? '00'} MRU enregistree.`,
    };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : "La remise n'a pas pu etre enregistree." };
  }
}

/**
 * ANNULER UNE REMISE — its `annuler_remise`.
 *
 * ⚠ A SECOND RECORDED ACT, NEVER AN EDIT OF THE FIRST. The original write-off
 * stays in the journal struck through, with who revoked it, when and why. A
 * remise commits the school; erasing the record of one is how a family is told
 * two different things a year apart.
 *
 * ⚠ AND THE DEBT COMES BACK. Its own confirm says so: "Annuler cette remise ?
 * La dette sera rétablie."
 */
export async function revokeWriteOffAction(_prev: unknown, form: FormData) {
  const guardianId = String(form.get('guardianId') ?? '');
  try {
    await apiFetch(`/finance/write-offs/${String(form.get('writeOffId') ?? '')}/revoke`, {
      method: 'POST',
      json: { reason: String(form.get('reason') ?? '').trim() || undefined },
    });
    revalidatePath('/finance');
    revalidatePath(`/finance/${guardianId}`);
    return { ok: 'Remise annulée : la dette est rétablie.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : "Échec de l'annulation." };
  }
}

/**
 * PAYER UN PROFESSEUR DE COURS DU SOIR.
 *
 * Money OUT, so it sits behind `finance.depenser` on the API rather than
 * `finance.encaisser` — taking money in and paying it out are different
 * authorities, and the accountant holds neither by default.
 *
 * The amount is not sent: it is the sum of the tender lines, computed once by
 * the API. A separate "amount" field would be a second number that could
 * disagree with them.
 */
export async function payEveningTeacherAction(_prev: unknown, form: FormData) {
  const tender = lireLignesPaiement(form);
  if (tender.length === 0) {
    return { error: 'Veuillez indiquer au moins un moyen de paiement avec un montant.' };
  }
  try {
    await apiFetch('/evening/teachers/payments', {
      method: 'POST',
      json: {
        eveningTeachingId: String(form.get('eveningTeachingId') ?? ''),
        calendarMonth: Number(form.get('calendarMonth')),
        calendarYear: Number(form.get('calendarYear')),
        tender,
      },
    });
    revalidatePath('/evening/professeurs');
    return { ok: 'Paiement du professeur enregistré avec succès.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Erreur lors du paiement.' };
  }
}

/**
 * SET A LEVEL'S REPORT-CARD FORMULA — all three terms at once.
 *
 * ⚠ IT DECIDES THE MARK ON EVERY BULLETIN OF THAT LEVEL. El Ourwa posts the
 * three terms together and reports how many were saved, because they are one
 * decision about how that level is assessed rather than three settings.
 */
export async function setFormulaAction(_prev: unknown, form: FormData) {
  const levelId = String(form.get('levelId') ?? '');
  if (!levelId) return { error: 'Choisissez un niveau.' };

  const terms: {
    term: number;
    courseworkWeight: string;
    examWeight: string;
    divisor: string;
  }[] = [];

  for (const t of [1, 2, 3]) {
    const a = String(form.get(`coursework_${t}`) ?? '').trim();
    const b = String(form.get(`exam_${t}`) ?? '').trim();
    const c = String(form.get(`divisor_${t}`) ?? '').trim();
    if (a === '' || b === '' || c === '') continue;
    // Sa règle : une ligne au diviseur nul n'est pas enregistrée, les autres le sont.
    if (!(Number(a) >= 0 && Number(b) >= 0 && Number(c) > 0)) continue;
    terms.push({
      term: t,
      courseworkWeight: Number(a).toFixed(2),
      examWeight: Number(b).toFixed(2),
      divisor: Number(c).toFixed(2),
    });
  }
  if (terms.length === 0) return { error: 'Valeurs invalides (le diviseur doit être > 0).' };

  try {
    const result = await apiFetch<{ saved: number }>('/grades/formulas', {
      method: 'POST',
      json: { levelId, terms },
    });
    revalidatePath('/scolarite/notes');
    return {
      ok: `Formule de calcul enregistrée pour les ${result.saved} trimestres de ce niveau.`,
    };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec de l’enregistrement.' };
  }
}

/**
 * ASSIGNER — le POST `assigner` de `gerer_professeurs.php` : ses champs, ses
 * refus (« Professeur, groupe et matière sont obligatoires. », « Le nombre
 * d'heures par semaine doit être entre 0.5 et 40. »), « Assignation créée avec
 * succès ! », « Cette assignation existe déjà. ». Le taux d'assignation ne part
 * que rempli : vide = le taux du professeur, ce qui n'est pas zéro.
 */
export async function assignTeachingAction(_prev: unknown, form: FormData) {
  const teacherId = String(form.get('professeur_id') ?? '');
  const groupId = String(form.get('groupe_id') ?? '');
  const subjectId = String(form.get('matiere_id') ?? '');
  if (!teacherId || !groupId || !subjectId) return { error: 'Professeur, groupe et matière sont obligatoires.' };
  const heures = Number(String(form.get('heures_par_semaine') ?? '').replace(',', '.'));
  if (!(heures > 0) || heures > 40) return { error: "Le nombre d'heures par semaine doit être entre 0.5 et 40." };
  const rate = String(form.get('prix_par_heure_assignation') ?? '').trim();

  try {
    await apiFetch('/teachings', {
      method: 'POST',
      json: {
        teacherId,
        groupId,
        subjectId,
        academicYearId: String(form.get('academicYearId') ?? ''),
        hoursPerWeek: String(heures),
        ...(rate !== '' && Number(rate) >= 0 ? { hourlyRate: rate } : {}),
      },
    });
    revalidatePath('/comptes/professeurs');
    return { ok: 'Assignation créée avec succès !' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : "Erreur : l'assignation a échoué." };
  }
}

/** Remove one assignment. */
export async function removeTeachingAction(_prev: unknown, form: FormData) {
  try {
    await apiFetch(`/teachings/${String(form.get('teachingId') ?? '')}`, { method: 'DELETE' });
    revalidatePath('/comptes/professeurs');
    return { ok: 'Assignation supprimée.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec de la suppression.' };
  }
}

/**
 * MODIFIER MON NOM — `modifier_profil.php`, action `changer_nom` : ses deux
 * refus viennent de l'API ; « Nom modifié avec succès. ».
 */
export async function changeOwnNameAction(_prev: unknown, form: FormData) {
  try {
    await apiFetch('/auth/change-name', {
      method: 'POST',
      json: { prenom: String(form.get('prenom') ?? ''), nom: String(form.get('nom') ?? '') },
    });
    // Le nom est sur la coquille : toute la mise en page se rafraîchit.
    revalidatePath('/', 'layout');
    return { ok: 'Nom modifié avec succès.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

/**
 * MODIFIER MON IDENTIFIANT DE CONNEXION — `modifier_profil.php`, action
 * `changer_identifiant` : ses refus viennent de l'API, dans son ordre ;
 * « Identifiant modifié avec succès. Utilisez le nouveau pour vos prochaines
 * connexions. ». La session courante est conservée (son `$_SESSION` suit).
 */
/** LE DOSSIER DE LA FAMILLE : corriger la fiche d'un enfant (décision du propriétaire, 20/09). */
export async function modifierEleveAction(_prev: unknown, form: FormData) {
  const studentId = String(form.get('studentId') ?? '');
  try {
    await apiFetch(`/students/${studentId}`, {
      method: 'POST',
      json: {
        firstName: String(form.get('prenom') ?? '').trim(),
        lastName: String(form.get('nom') ?? '').trim(),
        sex: ['M', 'F'].includes(String(form.get('sexe') ?? '')) ? String(form.get('sexe')) : null,
        dateOfBirth: String(form.get('date_naissance') ?? '').trim() || null,
        placeOfBirth: String(form.get('lieu_naissance') ?? '').trim() || null,
        nationalId: String(form.get('nni') ?? '').trim() || undefined,
        rim: String(form.get('rim') ?? '').trim() || undefined,
      },
    });
    revalidatePath('/finance');
    return { ok: `Fiche de ${String(form.get('prenom') ?? '').trim()} ${String(form.get('nom') ?? '').trim()} mise à jour.` };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'La fiche n’a pas pu être modifiée.' };
  }
}

/** LE DOSSIER DE LA FAMILLE : corriger le correspondant — nom, téléphone, e-mail. */
export async function modifierCorrespondantAction(_prev: unknown, form: FormData) {
  const userId = String(form.get('userId') ?? '');
  const fullName = String(form.get('nom_complet') ?? '').trim();
  const phone = String(form.get('telephone') ?? '').trim();
  const email = String(form.get('email') ?? '').trim();
  try {
    if (fullName) await apiFetch(`/accounts/guardians/${userId}/name`, { method: 'POST', json: { fullName } });
    // Le téléphone est l'identifiant de connexion : sa règle (numéro mauritanien, unicité) vit dans l'API.
    await apiFetch(`/accounts/guardians/${userId}/identifier`, { method: 'POST', json: { phone, email } });
    revalidatePath('/finance');
    return { ok: 'Correspondant mis à jour.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Le correspondant n’a pas pu être modifié.' };
  }
}

export async function changeIdentifierAction(_prev: unknown, form: FormData) {
  const slug = await currentSlug();
  try {
    await apiFetch('/auth/change-identifier', {
      method: 'POST',
      json: {
        newIdentifier: String(form.get('nouvel_identifiant') ?? '').trim(),
        currentPassword: String(form.get('mdp_actuel_id') ?? ''),
        refreshToken: await readRefreshToken(slug),
      },
    });
    revalidatePath('/profile');
    return { ok: 'Identifiant modifié avec succès. Utilisez le nouveau pour vos prochaines connexions.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

/**
 * CHANGER L'IDENTIFIANT — `changer_identifiant`, on all four of its account
 * pages.
 *
 * ⚠ NOTHING COULD CHANGE HOW SOMEBODY SIGNS IN. A parent's telephone IS their
 * identifier here, and telephone numbers change: a lost SIM, a new operator, a
 * digit written down wrong at the counter. Any of those locked a family out of
 * their own account permanently.
 *
 * ⚠ AN EMPTY FIELD IS REMOVAL, not "leave it alone" — so a field left blank is
 * NOT sent, and one deliberately cleared is. The API refuses to leave an
 * account with neither.
 */
export async function setIdentifierAction(_prev: unknown, form: FormData) {
  const phone = form.get('phone');
  const email = form.get('email');
  try {
    await apiFetch(`/accounts/users/${String(form.get('userId') ?? '')}/identifier`, {
      method: 'POST',
      json: {
        ...(phone === null ? {} : { phone: String(phone).trim() }),
        ...(email === null ? {} : { email: String(email).trim() }),
      },
    });
    revalidatePath('/comptes', 'layout');
    revalidatePath('/accounts');
    return { ok: 'Identifiant mis à jour. Toutes les sessions ont été fermées.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

/**
 * METTRE À JOUR LA RÉMUNÉRATION — `gerer_professeurs.php`, `mettre_a_jour_tarif`.
 *
 * ⚠ THE ENDPOINT EXISTED AND NOTHING CALLED IT. A teacher's salary or hourly
 * rate could not be changed from anywhere in the application — a raise, a move
 * from intérimaire to permanent, a rate agreed in September, all needed a
 * migration.
 *
 * ⚠ THE CONTRACT DECIDES WHICH FIELD IS SENT, and the API clears the other. A
 * permanent teacher has a salary and no rate; an intérimaire has a rate and no
 * salary. Sending both would leave a number from a contract the person no
 * longer has sitting in a live money column.
 */
export async function updateTeacherPayAction(_prev: unknown, form: FormData) {
  const employment = String(form.get('employment') ?? '');
  try {
    await apiFetch(`/accounts/teachers/${String(form.get('teacherId') ?? '')}`, {
      method: 'POST',
      json: {
        employment,
        ...(employment === 'permanent'
          ? { salary: String(form.get('salary') ?? '0').trim() }
          : { hourlyRate: String(form.get('hourlyRate') ?? '0').trim() }),
      },
    });
    revalidatePath('/comptes/professeurs');
    revalidatePath('/finance/dettes');
    revalidatePath('/finance/staff');
    return { ok: 'Rémunération du professeur mise à jour.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

/**
 * MODIFIER LES HEURES ET LE TAUX D'UNE ASSIGNATION — its `modifier_heures`.
 *
 * ⚠ THIS HAD NO ROUTE. An assignment could be created and deleted and never
 * corrected, so a teacher given 4 h/week by mistake had to be unassigned and
 * reassigned — and in between the class has no teaching at all: no subject on
 * the mark sheet, no subject in the timetable cells, nothing on the payroll.
 *
 * ⚠ Both values travel as STRINGS. hours × rate is what an intérimaire is paid.
 */
export async function updateTeachingAction(_prev: unknown, form: FormData) {
  try {
    await apiFetch(`/teachings/${String(form.get('teachingId') ?? '')}`, {
      method: 'PATCH',
      json: {
        hoursPerWeek: String(form.get('hoursPerWeek') ?? '').trim(),
        // Empty means "the teacher's own rate", and must be sent as empty
        // rather than omitted — omitting it would leave the old one in place.
        hourlyRate: String(form.get('hourlyRate') ?? '').trim(),
      },
    });
    revalidatePath('/comptes/professeurs');
    revalidatePath('/scolarite/emploi');
    return { ok: 'Assignation mise à jour (heures et taux horaire).' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

/** REPORTER LES AFFECTATIONS onto the open year. */
export async function carryForwardTeachingsAction(_prev: unknown, form: FormData) {
  try {
    const result = await apiFetch<{ copied: number; skipped: number; from: string | null }>(
      '/teachings/carry-forward',
      { method: 'POST', json: { academicYearId: String(form.get('academicYearId') ?? '') } },
    );
    revalidatePath('/comptes/professeurs');
    revalidatePath('/notes');
    // Ses mots : « Aucune année source ne contient d'affectation. » et
    // « N affectation(s) reportée(s) sur X. Les matières sont désormais proposées dans « Saisir les notes ». »
    if (!result.from) {
      return { error: "Aucune année source ne contient d'affectation." };
    }
    const n = result.copied;
    return {
      ok:
        `${n} affectation${n > 1 ? 's' : ''} reportée${n > 1 ? 's' : ''} sur ${String(form.get('cible_libelle') ?? result.from)}. ` +
        'Les matières sont désormais proposées dans « Saisir les notes ».',
    };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec du report.' };
  }
}

/**
 * ENCAISSER UN RÈGLEMENT / AVANCE — a lump sum against a whole family.
 *
 * ⚠ No month, no child: the API spreads it. Sending a month here would be this
 * action deciding something the till decides, and the two would disagree the
 * first time a family part-paid.
 */
export async function payGlobalAction(_prev: unknown, form: FormData) {
  // Avec la référence du reçu de l'application de paiement (0038) : la
  // reconstruire ici sans elle la perdait en silence.
  const tender = lireLignesPaiement(form);
  if (tender.length === 0) {
    return { error: 'Indiquez comment la somme est arrivée : au moins un moyen de paiement.' };
  }

  try {
    const result = await apiFetch<{ message: string }>('/finance/collection/global', {
      method: 'POST',
      json: {
        guardianId: String(form.get('guardianId') ?? ''),
        academicYearId: String(form.get('academicYearId') ?? ''),
        tender,
        paperReference: String(form.get('paperReference') ?? '') || undefined,
      },
    });
    revalidatePath('/finance');
    return { ok: result.message };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : "Échec de l'encaissement." };
  }
}

/**
 * EXEMPTER un élève — totale, or one named month.
 *
 * ⚠ The two are not the same concession. "Totale" means this child never pays;
 * "mensuelle" excuses one month. The form asks which, and the month field is
 * ignored for the first rather than quietly applied.
 */
export async function exemptStudentAction(_prev: unknown, form: FormData) {
  const kind = String(form.get('kind') ?? 'monthly');
  const [year, month] = String(form.get('periode') ?? '').split('-');

  if (kind === 'monthly' && (!year || !month)) {
    return { error: 'Choisissez le mois à exempter.' };
  }

  try {
    await apiFetch('/finance/concessions/exemptions', {
      method: 'POST',
      json: {
        studentId: String(form.get('studentId') ?? ''),
        kind,
        ...(kind === 'monthly'
          ? { calendarMonth: Number(month), calendarYear: Number(year) }
          : {}),
        reason: String(form.get('reason') ?? '').trim() || undefined,
      },
    });
    revalidatePath('/finance');
    return {
      ok:
        kind === 'full'
          ? 'Exemption totale appliquée.'
          : `Exemption appliquée pour ${MOIS_FR[Number(month) - 1]} ${year}.`,
    };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : "Échec de l'exemption." };
  }
}

/** Lift an exemption. The debt comes back. */
export async function liftExemptionAction(_prev: unknown, form: FormData) {
  try {
    await apiFetch(`/finance/concessions/exemptions/${String(form.get('exemptionId') ?? '')}`, {
      method: 'DELETE',
    });
    revalidatePath('/finance');
    return { ok: 'Exemption retirée.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

/**
 * APPLIQUER UNE RÉDUCTION — one month costs less.
 *
 * ⚠ The API refuses a reduction that would take the month below what has
 * already been paid, and names the figure. That refusal is the interesting one:
 * without it a concession conjures a credit the school never agreed to.
 */
export async function applyDiscountAction(_prev: unknown, form: FormData) {
  const [year, month] = String(form.get('periode') ?? '').split('-');
  const amount = String(form.get('amount') ?? '').trim();
  if (!year || !month) return { error: 'Choisissez le mois à réduire.' };
  if (!(Number(amount) > 0)) return { error: 'Indiquez le montant de la réduction.' };

  try {
    await apiFetch('/finance/concessions/discounts', {
      method: 'POST',
      json: {
        studentId: String(form.get('studentId') ?? ''),
        calendarMonth: Number(month),
        calendarYear: Number(year),
        amount: Number(amount).toFixed(2),
        reason: String(form.get('reason') ?? '').trim() || undefined,
      },
    });
    revalidatePath('/finance');
    return {
      ok:
        `Réduction de ${mruMsg(amount)} MRU appliquée pour ${MOIS_FR[Number(month) - 1]} ${year}` +
        `${String(form.get('studentName') ?? '').trim() ? ` (${String(form.get('studentName')).trim()})` : ''}.`,
    };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Réduction refusée.' };
  }
}

/**
 * MODIFIER LE FRAIS MENSUEL.
 *
 * ⚠ Only months with nothing paid against them move. A month somebody has
 * settled keeps the price it was settled at — re-pricing it would create a debt
 * or a credit against a receipt the family is holding.
 */
export async function changeMonthlyFeeAction(_prev: unknown, form: FormData) {
  const amount = String(form.get('amount') ?? '').trim();
  if (!(Number(amount) >= 0)) return { error: 'Montant invalide.' };

  try {
    const result = await apiFetch<{ from: string; to: string; monthsRepriced: number }>(
      '/finance/concessions/monthly-fee',
      {
        method: 'POST',
        json: {
          studentId: String(form.get('studentId') ?? ''),
          academicYearId: String(form.get('academicYearId') ?? ''),
          amount: Number(amount).toFixed(2),
          reason: String(form.get('reason') ?? '').trim() || undefined,
        },
      },
    );
    revalidatePath('/finance');
    return {
      ok:
        `Frais mensuel de ${String(form.get('studentName') ?? '').trim() || 'l’élève'} mis à jour : ` +
        `${mruMsg(result.from)} → ${mruMsg(result.to)} MRU.`,
    };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Modification impossible.' };
  }
}

/**
 * NOTIFIER LES IMPAYÉS — a payment reminder for one month.
 *
 * ⚠ Irreversible. The screen counts the recipients and confirms before this is
 * reached; the action itself only reports how many were actually written.
 */
export async function notifyUnpaidAction(_prev: unknown, form: FormData) {
  try {
    const result = await apiFetch<{ sent: number; month: string; year: number }>(
      '/finance/notify-unpaid',
      {
        method: 'POST',
        json: {
          academicYearId: String(form.get('academicYearId') ?? ''),
          calendarMonth: Number(form.get('calendarMonth')),
          calendarYear: Number(form.get('calendarYear')),
        },
      },
    );
    revalidatePath('/finance/impayes');
    return {
      ok:
        `Notification envoyée à ${result.sent} correspondant(s) pour les impayés de ` +
        `${result.month} ${result.year}.`,
    };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : "Échec de l'envoi." };
  }
}

/**
 * ANNULER UN PAIEMENT — from the month card.
 *
 * ⚠ A REVERSAL, NOT A DELETE. The original row stays and a negating entry points
 * at it, so the ledger still explains what happened and when (standing rule 7).
 * El Ourwa's own button is a ✕ and its confirmation is "Annuler ce paiement ?" —
 * both kept, because the office knows that gesture.
 */
export async function reversePaymentAction(_prev: unknown, form: FormData) {
  try {
    const r = await apiFetch<{ amount: string; calendarMonth: number; calendarYear: number }>(
      `/finance/payments/${String(form.get('paymentId') ?? '')}/reverse`,
      {
        method: 'POST',
        json: { reason: String(form.get('reason') ?? 'Annulation depuis la fiche') },
      },
    );
    revalidatePath('/finance');
    const [entier, cents] = String(Math.abs(Number(r.amount)).toFixed(2)).split('.');
    return {
      ok:
        `Paiement annulé : ${mruMsg(entier ?? '0')},${cents ?? '00'} MRU, mois ` +
        `${String(r.calendarMonth).padStart(2, '0')}/${r.calendarYear}.`,
    };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : "Échec de l'annulation." };
  }
}

/**
 * ANNULER L'EXEMPTION AUTOMATIQUE — the months before a child arrived.
 *
 * ⚠ Its confirmation says what this does, and it is not obvious: "Ce mois
 * deviendra dû et comptera dans la dette." The month was free because the child
 * was not yet enrolled; making it billable creates a debt that did not exist.
 */
export async function liftAutoExemptionAction(_prev: unknown, form: FormData) {
  try {
    await apiFetch('/finance/concessions/restore-month', {
      method: 'POST',
      json: {
        studentId: String(form.get('studentId') ?? ''),
        academicYearId: String(form.get('academicYearId') ?? ''),
        calendarMonth: Number(form.get('calendarMonth')),
        calendarYear: Number(form.get('calendarYear')),
      },
    });
    revalidatePath('/finance', 'layout');
    const m = Number(form.get('calendarMonth'));
    return {
      ok: `Exemption automatique annulée : le mois de ${MOIS_FR[m - 1]} ${form.get('calendarYear')} est désormais dû.`,
    };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

/**
 * RÉTABLIR L'EXEMPTION AUTOMATIQUE — its `retablir_exemption_auto`.
 *
 * ⚠ THE INVERSE DID NOT EXIST. A month made billable by mistake stayed billable
 * for ever: the family owed money they did not owe, and the only remedy was
 * editing the database. El Ourwa carries both buttons on the same month card.
 */
export async function reExemptMonthAction(_prev: unknown, form: FormData) {
  try {
    await apiFetch('/finance/concessions/re-exempt-month', {
      method: 'POST',
      json: {
        studentId: String(form.get('studentId') ?? ''),
        academicYearId: String(form.get('academicYearId') ?? ''),
        calendarMonth: Number(form.get('calendarMonth')),
        calendarYear: Number(form.get('calendarYear')),
      },
    });
    revalidatePath('/finance', 'layout');
    return {
      ok: `Exemption automatique rétablie pour ${MOIS_FR[Number(form.get('calendarMonth')) - 1]} ${form.get('calendarYear')}.`,
    };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}


/**
 * CONFIRMER LE PAIEMENT D'UN MOIS — `gestion_caisse.php`, action
 * `confirmer_paiement`. Le montant est la somme des moyens ; les refus, le
 * message de succès et le reçu viennent du service.
 */
export async function caissePaiementAction(_prev: unknown, form: FormData) {
  const tender = lireLignesPaiement(form);
  if (tender.length === 0) {
    return { error: 'Veuillez indiquer au moins un moyen de paiement avec un montant.' };
  }
  try {
    const r = await apiFetch<{ message: string }>('/finance/caisse/paiement', {
      method: 'POST',
      json: {
        studentId: String(form.get('studentId') ?? ''),
        mois: Number(form.get('mois')),
        annee: Number(form.get('annee')),
        tender,
      },
    });
    revalidatePath('/finance', 'layout');
    return { ok: r.message };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Données de paiement invalides.' };
  }
}

/** PAYER UN FRAIS ANNUEL — `payer_frais_annuel`. */
export async function payerFraisAnnuelAction(_prev: unknown, form: FormData) {
  const tender = lireLignesPaiement(form);
  if (tender.length === 0) {
    return { error: 'Veuillez indiquer au moins un moyen de paiement avec un montant.' };
  }
  try {
    const r = await apiFetch<{ message: string }>(
      `/finance/annual-fees/${String(form.get('guardianId') ?? '')}/pay`,
      {
        method: 'POST',
        json: {
          academicYearId: String(form.get('academicYearId') ?? ''),
          kind: String(form.get('kind') ?? ''),
          montant: Number(String(form.get('montant') ?? '0')).toFixed(2),
          tender,
        },
      },
    );
    revalidatePath('/finance', 'layout');
    return { ok: r.message };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Erreur.' };
  }
}

/** RETIRER UNE RÉDUCTION — `retirer_reduction`. */
export async function removeDiscountAction(_prev: unknown, form: FormData) {
  try {
    await apiFetch(
      `/finance/concessions/discounts/${String(form.get('studentId') ?? '')}/` +
        `${Number(form.get('calendarYear'))}/${Number(form.get('calendarMonth'))}`,
      { method: 'DELETE' },
    );
    revalidatePath('/finance', 'layout');
    return { ok: 'Réduction retirée.' };
  } catch (error) {
    return {
      error: error instanceof ApiError ? error.message : 'Impossible de retirer cette réduction.',
    };
  }
}

/** Ajouter un moyen de paiement. */
export async function addPaymentMethodAction(_prev: unknown, form: FormData) {
  try {
    const nom = String(form.get('name') ?? '').trim();
    if (nom.length < 2) return { error: 'Nom de moyen de paiement invalide.' };
    await apiFetch('/payment-methods', {
      method: 'POST',
      json: { name: nom },
    });
    revalidatePath('/finance');
    return { ok: `Moyen de paiement « ${nom} » ajouté.` };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Ce moyen de paiement existe déjà.' };
  }
}

/**
 * Activer / désactiver un moyen.
 *
 * ⚠ Never a delete. Payments point at the method and the history must keep
 * rendering — El Ourwa's own note on the panel says exactly this.
 */
export async function togglePaymentMethodAction(_prev: unknown, form: FormData) {
  try {
    const r = await apiFetch<{ isActive: boolean; name: string }>(
      `/payment-methods/${String(form.get('methodId') ?? '')}/toggle`,
      { method: 'POST' },
    );
    revalidatePath('/finance');
    return { ok: `Moyen de paiement « ${r.name} » ${r.isActive ? 'activé' : 'désactivé'}.` };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

/** Créer un groupe de cours du soir. */
export async function createEveningGroupAction(_prev: unknown, form: FormData) {
  try {
    const group = await apiFetch<{ name: string }>('/evening/groups', {
      method: 'POST',
      json: {
        name: String(form.get('name') ?? '').trim(),
        monthlyRate: Number(form.get('monthlyRate') ?? 0).toFixed(2),
        description: String(form.get('description') ?? '').trim() || undefined,
      },
    });
    revalidatePath('/evening');
    return { ok: `Groupe « ${group.name} » créé.` };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec de la création.' };
  }
}

/**
 * Les mois où un groupe tourne.
 *
 * ⚠ None ticked means EVERY month — its `empty($mois_grp) ? true`. The
 * confirmation says which state was saved, because "aucun mois" and "tous les
 * mois" being the same submission is exactly the kind of thing somebody needs
 * told rather than left to infer.
 */
export async function setEveningMonthsAction(_prev: unknown, form: FormData) {
  const months = form.getAll('months').map((m) => Number(m)).filter((m) => m >= 1 && m <= 12);
  try {
    await apiFetch(`/evening/groups/${String(form.get('groupId') ?? '')}/months`, {
      method: 'POST',
      json: { calendarYear: Number(form.get('calendarYear')), months },
    });
    revalidatePath('/evening');
    return { ok: 'Mois de paiement configurés pour ce groupe.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

/**
 * Les mois payables d'une année scolaire.
 *
 * ⚠ None ticked means the DEFAULT RANGE, not "no months" — the set is an
 * override. The confirmation names which state was saved, because the two
 * submit identically.
 */
export async function setYearMonthsAction(_prev: unknown, form: FormData) {
  const months = form.getAll('months').map((m) => Number(m)).filter((m) => m >= 1 && m <= 12);
  try {
    await apiFetch(`/academic-years/${String(form.get('yearId') ?? '')}/months`, {
      method: 'POST',
      json: { months },
    });
    revalidatePath('/settings');
    return {
      ok:
        months.length === 0
          ? 'Aucun mois coché : la période par défaut de l’année s’applique.'
          : `${months.length} mois payables enregistrés.`,
    };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

/**
 * Créer un professeur externe — someone who teaches evening classes only.
 *
 * ⚠ Not hiring. An external tutor never reaches the payroll, the staff
 * headcount or the statistics — that is the whole reason the evening school
 * keeps its own teacher table.
 */
export async function createEveningTeacherAction(_prev: unknown, form: FormData) {
  try {
    await apiFetch('/evening/teachers', {
      method: 'POST',
      json: {
        firstName: String(form.get('firstName') ?? '').trim(),
        lastName: String(form.get('lastName') ?? '').trim(),
        phone: String(form.get('phone') ?? '').trim() || undefined,
      },
    });
    revalidatePath('/evening/professeurs');
    return { ok: 'Professeur externe ajouté.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

/** Its `$mois_noms`. */
const MOIS_FR = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

/**
 * ENREGISTRER LES NOTES — le POST de `saisir_notes.php` : `devoirs[<eleve>][]`
 * (effacés puis réécrits en séquence) et `examens[<eleve>]` (mis à jour s'il
 * est renseigné). Puis sa redirection : `?enseignement_id=…&trimestre=…&succes=1`.
 */
export async function recordMarksAction(_prev: unknown, form: FormData) {
  const teachingId = String(form.get('enseignement_id') ?? '');
  const trimestre = Number(form.get('trimestre') ?? 1);

  const eleves = new Map<string, { studentId: string; devoirs: string[]; examen: string | null }>();
  for (const [key, value] of form.entries()) {
    const d = /^devoirs\[(.+)\]\[\]$/.exec(key);
    if (d) {
      const e = eleves.get(d[1]!) ?? { studentId: d[1]!, devoirs: [], examen: null };
      e.devoirs.push(String(value).trim());
      eleves.set(d[1]!, e);
      continue;
    }
    const x = /^examens\[(.+)\]$/.exec(key);
    if (x) {
      const e = eleves.get(x[1]!) ?? { studentId: x[1]!, devoirs: [], examen: null };
      e.examen = String(value).trim() || null;
      eleves.set(x[1]!, e);
    }
  }
  if (eleves.size === 0) return { error: 'Aucune note saisie.' };

  try {
    await apiFetch(`/grades/sheet/${teachingId}`, {
      method: 'POST',
      json: { term: trimestre, eleves: [...eleves.values()] },
    });
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec de la saisie.' };
  }
  redirect(`/notes?enseignement_id=${teachingId}&trimestre=${trimestre}&succes=1${anneeConservee(form)}`);
}

/**
 * SAISIR LES NOTES — LE PROFESSEUR (décision du propriétaire, 2026-09-17) :
 * le même formulaire que la direction, envoyé à `POST /teacher/sheet/:id`,
 * dont la porte est « cet enseignement est le mien ». Retour sur `/prof/notes`.
 */
export async function recordOwnMarksAction(_prev: unknown, form: FormData) {
  const teachingId = String(form.get('enseignement_id') ?? '');
  const trimestre = Number(form.get('trimestre') ?? 1);
  const eleves = new Map<string, { studentId: string; devoirs: string[]; examen: string | null }>();
  for (const [key, value] of form.entries()) {
    const d = /^devoirs\[(.+)\]\[\]$/.exec(key);
    if (d) {
      const e = eleves.get(d[1]!) ?? { studentId: d[1]!, devoirs: [], examen: null };
      e.devoirs.push(String(value).trim());
      eleves.set(d[1]!, e);
      continue;
    }
    const x = /^examens\[(.+)\]$/.exec(key);
    if (x) {
      const e = eleves.get(x[1]!) ?? { studentId: x[1]!, devoirs: [], examen: null };
      e.examen = String(value).trim() || null;
      eleves.set(x[1]!, e);
    }
  }
  if (eleves.size === 0) return { error: 'Aucune note saisie.' };
  try {
    await apiFetch(`/teacher/sheet/${teachingId}`, {
      method: 'POST',
      json: { term: trimestre, eleves: [...eleves.values()] },
    });
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec de la saisie.' };
  }
  redirect(`/prof/notes?enseignement_id=${teachingId}&trimestre=${trimestre}&succes=1${anneeConservee(form)}`);
}

/**
 * ENREGISTRER L'APPEL — le POST de `gerer_absence.php` : `statut[<id>]` par
 * élève, `groupe_id`, `date_abs`, `enseignement_id` (vide = journée
 * complète). « Appel enregistré. N absence(s)/retard(s) signalé(s) aux
 * parents. »
 */
export async function enregistrerAppelAction(_prev: unknown, form: FormData) {
  const statuts: { studentId: string; statut: string }[] = [];
  for (const [key, value] of form.entries()) {
    const m = /^statut\[(.+)\]$/.exec(key);
    if (!m) continue;
    const st = String(value);
    statuts.push({ studentId: m[1]!, statut: ['present', 'absent', 'retard'].includes(st) ? st : 'present' });
  }
  if (statuts.length === 0) return { error: 'Aucun élève à enregistrer.' };

  try {
    const r = await apiFetch<{ nbAbs: number }>('/attendance/appel', {
      method: 'POST',
      json: {
        groupId: String(form.get('groupe_id') ?? ''),
        date: String(form.get('date_abs') ?? ''),
        academicYearId: String(form.get('academicYearId') ?? ''),
        teachingId: String(form.get('enseignement_id') ?? '') || null,
        statuts,
      },
    });
    revalidatePath('/scolarite/absence');
    return { ok: `Appel enregistré. ${r.nbAbs} absence(s)/retard(s) signalé(s) aux parents.` };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : "Échec de l'appel." };
  }
}

/** Enrol someone into an evening group — a student, or an outside person. */
export async function eveningEnrolAction(_prev: unknown, form: FormData) {
  const eveningGroupId = String(form.get('eveningGroupId') ?? '');
  const kind = String(form.get('kind') ?? 'outsider');

  const payload =
    kind === 'student'
      ? { eveningGroupId, studentId: String(form.get('studentId') ?? '') }
      : {
          eveningGroupId,
          outsiderName: String(form.get('outsiderName') ?? '').trim(),
          outsiderPhone: String(form.get('outsiderPhone') ?? '').trim() || undefined,
          outsiderSex: (String(form.get('outsiderSex') ?? '') || undefined) as
            | 'M'
            | 'F'
            | undefined,
        };

  try {
    const result = await apiFetch<{ isOutsider: boolean }>('/evening/enrolments', {
      method: 'POST',
      json: payload,
    });
    revalidatePath('/evening');
    return {
      ok: result.isOutsider ? 'Élève externe inscrit.' : 'Étudiant (école) inscrit au cours du soir.',
    };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : "Échec de l'inscription." };
  }
}

/** Collect an evening-class payment. */
export async function eveningCollectAction(_prev: unknown, form: FormData) {
  const tender = lireLignesPaiement(form);
  if (tender.length === 0) {
    return { error: 'Veuillez indiquer au moins un moyen de paiement avec un montant.' };
  }
  const total = tender.reduce((a, l) => a + Number(l.amount), 0).toFixed(2);
  let id = '';
  try {
    const result = await apiFetch<{ id: string }>('/evening/payments', {
      method: 'POST',
      json: {
        enrolmentId: String(form.get('enrolmentId') ?? ''),
        calendarMonth: Number(form.get('calendarMonth')),
        calendarYear: Number(form.get('calendarYear')),
        amount: total,
        tender,
      },
    });
    id = result.id;
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Données de paiement invalides.' };
  }
  // Son `header('Location: cours_du_soir.php?print_recu_cs=…')`.
  redirect(`/evening/recu/${id}`);
}

/** Create a branch. Live the moment the row exists — no provisioning step. */
/**
 * CRÉER UN ADMINISTRATEUR DE LA PLATEFORME — décision du propriétaire
 * (2026-09-14) : les mêmes privilèges que l'appelant. Les refus viennent de
 * l'API (nom, identifiant, politique du mot de passe, identifiant pris).
 */
export async function createPlatformAdminAction(_prev: unknown, form: FormData) {
  try {
    const r = await apiFetch<{ id: string; identifier: string }>('/platform/admins', {
      method: 'POST',
      json: {
        fullName: String(form.get('fullName') ?? ''),
        identifier: String(form.get('identifier') ?? ''),
        password: String(form.get('password') ?? ''),
      },
    });
    revalidatePath('/platform');
    return { ok: `Administrateur créé : « ${r.identifier} » — il devra changer son mot de passe à sa première connexion.` };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec de la création.' };
  }
}

export async function setPlatformAdminActiveAction(_prev: unknown, form: FormData) {
  const active = String(form.get('active') ?? '') === '1';
  try {
    await apiFetch(`/platform/admins/${String(form.get('adminId') ?? '')}/active`, {
      method: 'POST',
      json: { active },
    });
    revalidatePath('/platform');
    return { ok: active ? 'Administrateur réactivé.' : 'Administrateur désactivé : ses sessions sont fermées.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

export async function createBranchAction(_prev: unknown, form: FormData) {
  try {
    const branch = await apiFetch<{ slug: string; name: string }>('/platform/branches', {
      method: 'POST',
      json: {
        slug: String(form.get('slug') ?? '').trim().toLowerCase(),
        name: String(form.get('name') ?? '').trim(),
        nameAr: String(form.get('nameAr') ?? '').trim() || undefined,
        currency: String(form.get('currency') ?? '') || undefined,
        themeColor: String(form.get('themeColor') ?? '') || undefined,
        logoEmoji: String(form.get('logoEmoji') ?? '') || undefined,
      },
    });
    revalidatePath('/');
    const entetes = await headers();
    const hote = hoteAvecSlug(entetes.get('x-forwarded-host') ?? entetes.get('host') ?? 'localhost:3000', branch.slug);
    return { ok: `${branch.name} est en ligne sur ${hote}` };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec de la création.' };
  }
}

/**
 * CHANGER LE TARIF PAR ÉLÈVE.
 *
 * ⚠ IL N'Y AVAIT AUCUN FORMULAIRE. La console lisait le tarif et l'affichait sur
 * une tuile ; la route pour le changer existait, gardée, auditée, et rien ne
 * l'appelait. Le nombre qui facture toutes les écoles ne pouvait donc être
 * modifié qu'en écrivant dans la base — c'est mieux que le `define()` d'El Ourwa,
 * qui demande de modifier du PHP sur le serveur, mais de justesse.
 *
 * Le montant part en CHAÎNE : c'est de l'argent (règle 6).
 */
export async function setTariffAction(_prev: unknown, form: FormData) {
  try {
    const result = await apiFetch<{ tariff: string }>('/platform/tariff', {
      method: 'POST',
      json: { amount: String(form.get('amount') ?? '').trim() },
    });
    revalidatePath('/');
    return { ok: `Tarif fix\u00e9 \u00e0 ${result.tariff} par \u00e9l\u00e8ve.` };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : '\u00c9chec du changement.' };
  }
}

// ── Payroll ─────────────────────────────────────────────────────────────────

/** `lire_lignes_paiement()` — les lignes du widget, telles que le formulaire les porte. */
function lireLignesPaiement(form: FormData): { paymentMethodId: string; amount: string; reference?: string }[] {
  try {
    return (JSON.parse(String(form.get('tender') ?? '[]')) as { moyenId: string; montant: string; reference?: string }[])
      // En décimal (règle 6) : un montant mal formé est ignoré, jamais arrondi en flottant.
      .filter((l) => l.moyenId && montantDecimal(l.montant)?.greaterThan(0))
      .map((l) => ({
        paymentMethodId: l.moyenId,
        amount: montantDecimal(l.montant)!.toFixed(2),
        // Le numéro de reçu de l'application de paiement, s'il y en a un (0038).
        ...(l.reference?.trim() ? { reference: l.reference.trim().slice(0, 60) } : {}),
      }));
  } catch {
    return [];
  }
}

/**
 * PAYER UN SALAIRE — `paiement_staff.php`, action `payer_salaire`.
 *
 * Le montant est la somme des moyens de paiement ; les refus viennent du
 * service, avec ses mots. Réussi, on revient sur la page avec
 * `print_recu_salaire=` — son `header('Location: …')`.
 */
export async function paySalaryAction(_prev: unknown, form: FormData) {
  const btype = String(form.get('beneficiaire_type') ?? '') === 'professeur' ? 'teacher' : 'staff';
  const mois = Number(form.get('mois'));
  const annee = Number(form.get('annee'));
  const tender = lireLignesPaiement(form);
  if (tender.length === 0) {
    return { error: 'Veuillez indiquer au moins un moyen de paiement avec un montant.' };
  }

  let id: string;
  try {
    const result = await apiFetch<{ id: string }>('/payroll/salaries', {
      method: 'POST',
      json: {
        payeeKind: btype,
        payeeId: String(form.get('beneficiaire_id') ?? ''),
        calendarMonth: mois,
        calendarYear: annee,
        note: String(form.get('motif') ?? '').trim() || 'Salaire',
        tender,
      },
    });
    id = result.id;
  } catch (error) {
    return {
      error:
        error instanceof ApiError ? error.message : "Erreur lors de l'enregistrement du paiement.",
    };
  }
  revalidatePath('/finance/staff');
  redirect(
    `/finance/staff?type=${btype === 'teacher' ? 'profs' : 'staff'}&mois=${mois}&annee=${annee}` +
      `&print_recu_salaire=${id}`,
  );
}

/**
 * ACCORDER UN PRÊT — `dette.php`, action `creer_pret`.
 *
 * Les mois cochés (`pret_mois[]`, « M-AAAA »), la remise des fonds par moyens
 * de paiement ; les refus viennent du service avec ses mots ; réussi, on va au
 * contrat : `dette.php?print_recu_pret=`.
 */
export async function grantLoanAction(_prev: unknown, form: FormData) {
  const btype = String(form.get('pret_type') ?? '') === 'professeur' ? 'teacher' : 'staff';
  const months = form
    .getAll('pret_mois[]')
    .map(String)
    .filter((v) => /^\d{1,2}-\d{4}$/.test(v))
    .map((v) => {
      const [m, y] = v.split('-');
      return { month: Number(m), year: Number(y) };
    });
  const montant = String(form.get('pret_montant') ?? '').trim();

  let id: string;
  try {
    const r = await apiFetch<{ id: string }>('/payroll/loans', {
      method: 'POST',
      json: {
        payeeKind: btype,
        payeeId: String(form.get('pret_beneficiaire_id') ?? ''),
        principal: Number(montant) > 0 ? Number(montant).toFixed(2) : '0.00',
        months,
        reason: String(form.get('pret_motif') ?? '').trim() || undefined,
        tender: lireLignesPaiement(form),
      },
    });
    id = r.id;
  } catch (error) {
    return {
      error: error instanceof ApiError ? error.message : 'Erreur lors de la création du prêt.',
    };
  }
  revalidatePath('/finance/dettes');
  redirect(`/finance/dettes?print_recu_pret=${id}`);
}

/** AVANCE DE REMBOURSEMENT — `dette.php`, action `avance_pret` ; réussi, le reçu. */
export async function repayLoanAction(_prev: unknown, form: FormData) {
  let id: string;
  try {
    const r = await apiFetch<{ id: string }>(
      `/payroll/loans/${String(form.get('pret_id') ?? '')}/repay`,
      { method: 'POST', json: { tender: lireLignesPaiement(form) } },
    );
    id = r.id;
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Erreur lors du remboursement.' };
  }
  revalidatePath('/finance/dettes');
  revalidatePath('/finance/staff');
  redirect(`/finance/dettes?print_recu_avance=${id}`);
}

/**
 * ENREGISTRER UN RETRAIT — `paiement_staff.php`, action `retirer_admin`.
 *
 * Le montant est la somme des moyens de paiement ; le dépassement est refusé
 * par le SERVICE, avec ses mots. Réussi, on va au reçu :
 * `administrateurs.php?print_recu_retrait=`.
 */
export async function withdrawAction(_prev: unknown, form: FormData) {
  const tender = lireLignesPaiement(form);
  if (tender.length === 0) {
    return { error: 'Veuillez indiquer au moins un moyen de paiement avec un montant.' };
  }

  let id: string;
  try {
    const result = await apiFetch<{ id: string }>('/payroll/withdrawals', {
      method: 'POST',
      json: {
        fundHolderId: String(form.get('fundHolderId') ?? ''),
        calendarMonth: Number(form.get('mois')),
        calendarYear: Number(form.get('annee')),
        reason: String(form.get('motif') ?? '').trim() || undefined,
        tender,
      },
    });
    id = result.id;
  } catch (error) {
    return {
      error:
        error instanceof ApiError ? error.message : "Erreur lors de l'enregistrement du retrait.",
    };
  }
  revalidatePath('/finance/staff');
  revalidatePath('/finance/administrateurs');
  redirect(`/finance/administrateurs?print_recu_retrait=${id}`);
}

// ── Messaging and requests ──────────────────────────────────────────────────

/**
 * ENVOYER — le POST de `messagerie.php` : ses champs (`sujet`, `contenu`,
 * `parent_id`, `niveau_id`, `groupe_id`) et ses refus dans son ordre — « Sujet
 * et contenu obligatoires. », « Veuillez choisir un parent OU un niveau (au
 * moins une option requise). », « Vous ne pouvez pas combiner « parent ciblé »
 * et « diffusion par niveau ». Choisissez UNE des deux options. », « Aucun
 * destinataire trouvé pour ces critères. » — puis « N message(s) envoyé(s). ».
 */
export async function sendMessageAction(_prev: unknown, form: FormData) {
  const sujet = String(form.get('sujet') ?? '').trim();
  const contenu = String(form.get('contenu') ?? '').trim();
  const parentId = String(form.get('parent_id') ?? '').trim();
  const niveauId = String(form.get('niveau_id') ?? '').trim();
  const groupeId = String(form.get('groupe_id') ?? '').trim();
  const academicYearId = String(form.get('academicYearId') ?? '').trim();

  const modeIndividuel = parentId !== '';
  const modeDiffusion = niveauId !== '';
  if (sujet === '' || contenu === '') return { error: 'Sujet et contenu obligatoires.' };
  if (!modeIndividuel && !modeDiffusion) {
    return { error: 'Veuillez choisir un parent OU un niveau (au moins une option requise).' };
  }
  if (modeIndividuel && modeDiffusion) {
    return { error: 'Vous ne pouvez pas combiner « parent ciblé » et « diffusion par niveau ». Choisissez UNE des deux options.' };
  }

  try {
    const result = await apiFetch<{ sent: number }>('/messages', {
      method: 'POST',
      json: {
        subject: sujet,
        body: contenu,
        ...(modeIndividuel
          ? { guardianId: parentId }
          : { levelId: niveauId, ...(groupeId ? { groupId: groupeId } : {}), ...(academicYearId ? { academicYearId } : {}) }),
      },
    });
    revalidatePath('/messages');
    return { ok: `${result.sent} message(s) envoyé(s).` };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : "Échec de l'envoi." };
  }
}

/**
 * SOUMETTRE UNE DEMANDE — son action `soumettre` : « Type de demande
 * invalide. », « La description doit contenir au moins 5 caractères. »,
 * « Demande soumise avec succès. ».
 */
export async function raiseRequestAction(_prev: unknown, form: FormData) {
  const type = String(form.get('type_demande') ?? '');
  const description = String(form.get('description') ?? '').trim();
  const montant = String(form.get('montant') ?? '').trim();
  if (!['depense', 'dette', 'reduction', 'frais_mensuel', 'derogation', 'autre'].includes(type)) {
    return { error: 'Type de demande invalide.' };
  }
  if (description.length < 5) return { error: 'La description doit contenir au moins 5 caractères.' };
  try {
    await apiFetch('/requests', {
      method: 'POST',
      json: {
        kind: type,
        description,
        amount: montant !== '' ? Number(montant).toFixed(2) : undefined,
      },
    });
    revalidatePath('/requests');
    return { ok: 'Demande soumise avec succès.' };
  } catch (error) {
    return { error: error instanceof ApiError ? `Erreur lors de la soumission : ${error.message}` : 'Erreur lors de la soumission.' };
  }
}

/**
 * DÉCIDER — son action `decider` : `approuve` exécute la demande (dépense,
 * frais mensuel, dette) dans la même transaction ; « Demande approuvée et
 * exécutée. » / « Demande rejetée. » ; sinon « Erreur : … ».
 */
export async function decideRequestAction(_prev: unknown, form: FormData) {
  const decision = String(form.get('decision') ?? '') === 'approuve' ? 'approved' : 'refused';
  try {
    const result = await apiFetch<{ status: string; message: string }>(
      `/requests/${String(form.get('demande_id') ?? '')}/decision`,
      {
        method: 'POST',
        json: { decision, comment: String(form.get('commentaire') ?? '').trim() || undefined },
      },
    );
    revalidatePath('/requests');
    revalidatePath('/finance', 'layout');
    return { ok: result.message ?? (result.status === 'approved' ? 'Demande approuvée et exécutée.' : 'Demande rejetée.') };
  } catch (error) {
    return { error: error instanceof ApiError ? `Erreur : ${error.message}` : 'Erreur : la décision a échoué.' };
  }
}

// ── Admissions ──────────────────────────────────────────────────────────────

/**
 * INSCRIRE UN ÉTUDIANT — le POST `inscrire` de `inscrire_etudiant.php`, avec ses
 * validations dans son ordre (« Nom invalide. Prénom invalide. Veuillez
 * choisir un groupe. » — ses « Le RIM / Le NNI est obligatoire » retirés : le
 * NNI et le RIM sont facultatifs depuis le 30/09/2026, migration 0044), son
 * message « Étudiant inscrit avec succès ! Matricule : … » et, pour un
 * comptable ou un secrétaire, l'avertissement de la demande de frais. Réussie,
 * la fenêtre d'encaissement s'ouvre avec les données de `encaissement_fenetre()`.
 */
/**
 * LE MODE D'ÉTUDE ET LES SERVICES D'UN FORMULAIRE D'INSCRIPTION (Jinan, §8) —
 * `{ champs: {} }` pour une école « famille », sans rien lire du formulaire ;
 * pour une école « services », le mode (obligatoire, la phrase de l'API) et
 * les services cochés (`services`, JSON), filtrés sur le catalogue.
 */
async function lireChoixFacturation(
  form: FormData,
  opts: { avecServices?: boolean } = {},
): Promise<
  | { error: string }
  | { studyMode: '8h-14h' | '8h-17h' | null; champs: { studyMode?: '8h-14h' | '8h-17h'; services?: string[] } }
> {
  if (!(await estEcoleServices())) return { studyMode: null, champs: {} };
  const mode = String(form.get('study_mode') ?? '');
  if (mode !== '8h-14h' && mode !== '8h-17h') {
    return { error: "Choisissez le mode d'étude : 8h – 14h ou 8h – 17h." };
  }
  if (opts.avecServices === false) return { studyMode: mode, champs: { studyMode: mode } };
  let services: string[] = [];
  try {
    const brut = JSON.parse(String(form.get('services') ?? '[]')) as unknown;
    services = Array.isArray(brut) ? brut.filter((c): c is string => estServiceOptionnel(c)) : [];
  } catch {
    return { error: 'Services illisibles.' };
  }
  return { studyMode: mode, champs: { studyMode: mode, services: [...new Set(services)] } };
}

export async function admitStudentAction(_prev: unknown, form: FormData) {
  const nom = String(form.get('nom') ?? '').trim();
  const prenom = String(form.get('prenom') ?? '').trim();
  const rim = String(form.get('rim') ?? '').trim();
  const nni = String(form.get('nni') ?? '').trim();
  const groupeId = String(form.get('groupe_id') ?? '');
  const mode = String(form.get('mode_parent') ?? 'existant');
  const academicYearId = String(form.get('academicYearId') ?? '');
  if (!academicYearId) return { error: "Aucune année scolaire n'est ouverte. Ouvrez-en une dans « Années scolaires »." };

  const erreurs: string[] = [];
  if (nom.length < 2) erreurs.push('Nom invalide.');
  if (prenom.length < 2) erreurs.push('Prénom invalide.');
  if (!groupeId) erreurs.push('Veuillez choisir un groupe.');
  const parentId = String(form.get('parent_id') ?? '');
  if (erreurs.length === 0 && mode !== 'nouveau' && !parentId) erreurs.push('Veuillez sélectionner un correspondant existant.');
  if (erreurs.length) return { error: erreurs.join(' ') };

  const sexe = String(form.get('sexe') ?? '');
  const pTel = String(form.get('p_tel') ?? '').trim();
  // École « services » (Jinan, §8) : le mode est obligatoire, les services
  // cochés partent avec l'inscription. Rien de tout cela pour une école
  // « famille » — l'API le refuserait (400).
  const facturation = await lireChoixFacturation(form);
  if ('error' in facturation) return { error: facturation.error };
  const fraisSaisi = String(form.get('frais_mensuel') ?? '').trim();
  try {
    const result = await apiFetch<{
      studentId: string;
      temporaryPassword: string | null;
      parentDejaExistant: boolean;
      matricule: string;
      enrolmentId: string | null;
      monthlyFee: string | null;
      feeRequested: string | null;
    }>('/admissions/students', {
      method: 'POST',
      json: {
        firstName: prenom,
        lastName: nom,
        rim: rim || undefined,
        nationalId: nni || undefined,
        sex: sexe === 'M' || sexe === 'F' ? sexe : undefined,
        dateOfBirth: String(form.get('date_naissance') ?? '') || undefined,
        placeOfBirth: String(form.get('lieu_naissance') ?? '').trim() || undefined,
        ...(mode === 'nouveau'
          ? {
              newGuardian: {
                fullName: String(form.get('p_nom') ?? '').trim(),
                email: String(form.get('p_email') ?? '').trim() || undefined,
                phone: pTel || undefined,
                initialPassword: String(form.get('p_mdp') ?? ''),
              },
            }
          : { guardianId: parentId }),
        academicYearId,
        groupId: groupeId,
        // École « services » : un champ vidé veut dire « le tarif du mode »
        // (l'API le prend), jamais « gratuit ».
        ...(facturation.studyMode && fraisSaisi === ''
          ? {}
          : { monthlyFee: Number(fraisSaisi || '0').toFixed(2) }),
        ...facturation.champs,
      },
    });

    let message = `Étudiant inscrit avec succès ! Matricule : ${result.matricule}`;
    if (result.feeRequested !== null && result.monthlyFee !== null) {
      message +=
        ` ⚠️ Le frais mensuel saisi (${mruMsg(result.feeRequested)}) diffère du tarif du niveau (${mruMsg(result.monthlyFee)}) : ` +
        "une demande a été envoyée à l'administrateur. Le tarif officiel s'applique en attendant sa validation.";
    }
    const fenetre = await apiFetch<import('@/components/fenetre-encaissement').FenetreData>(
      `/finance/caisse/encaissement-inscription/${result.studentId}`,
    ).catch(() => undefined);
    revalidatePath('/students');
    return {
      ok: message,
      password: result.temporaryPassword,
      guardianPhone: pTel || null,
      fenetre,
    };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : "Erreur lors de l'inscription." };
  }
}

/**
 * ENCAISSER CE QUE LA FENÊTRE A COLLECTÉ — `encaissement_encaisser()` : réussi
 * avec un paiement de scolarité, on part sur son reçu (`gestion_caisse.php?print_recu=`).
 */
/**
 * UN SEUL REÇU pour les mois cochés et les frais cochés (0040) — la fenêtre
 * d'encaissement de l'inscription, de la réinscription et de la caisse.
 */
export async function encaisserGroupeAction(_prev: unknown, form: FormData) {
  const tender = lireLignesPaiement(form);
  if (tender.length === 0) return { error: 'Veuillez indiquer au moins un moyen de paiement avec un montant.' };
  let mois: { mois: number; annee: number }[] = [];
  // École « services » (Jinan, §7) : les échéances de service cochées ; le
  // champ n'existe pas dans la fenêtre d'une école « famille ».
  let services: { studentServiceId: string; mois?: number; annee?: number }[] | undefined;
  try {
    mois = (JSON.parse(String(form.get('mois') ?? '[]')) as { mois: number; annee: number }[]).filter((m) => m.mois >= 1 && m.mois <= 12);
    if (form.has('services')) {
      services = (JSON.parse(String(form.get('services') ?? '[]')) as { studentServiceId: string; mois?: number; annee?: number }[])
        .filter((l) => typeof l.studentServiceId === 'string')
        .map((l) => ({
          studentServiceId: l.studentServiceId,
          ...(typeof l.mois === 'number' && typeof l.annee === 'number' ? { mois: l.mois, annee: l.annee } : {}),
        }));
    }
  } catch {
    return { error: 'Mois illisibles.' };
  }
  let r: { receiptId: string; message: string };
  try {
    r = await apiFetch('/finance/caisse/encaissement', {
      method: 'POST',
      json: {
        studentId: String(form.get('studentId') ?? ''),
        academicYearId: String(form.get('academicYearId') ?? '') || undefined,
        mois,
        fraisInscription: form.get('frais_inscription') === '1',
        fraisPhotocopie: form.get('frais_photocopie') === '1',
        ...(services && services.length > 0 ? { services } : {}),
        tender,
      },
    });
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : "Le paiement n'a pas pu être enregistré." };
  }
  revalidatePath('/finance');
  redirect(`/finance/recu/groupe/${r.receiptId}`);
}

export async function encaisserInscriptionAction(_prev: unknown, form: FormData) {
  const tender = lireLignesPaiement(form);
  if (tender.length === 0) return { error: 'Veuillez indiquer au moins un moyen de paiement avec un montant.' };
  let r: { ok: boolean; message: string; paiementId: string | null };
  try {
    r = await apiFetch('/finance/caisse/encaissement-inscription', {
      method: 'POST',
      json: {
        studentId: String(form.get('studentId') ?? ''),
        periode: String(form.get('periode') ?? ''),
        fraisInscription: String(form.get('frais_inscription') ?? '') || undefined,
        fraisPhotocopie: String(form.get('frais_photocopie') ?? '') || undefined,
        tender,
      },
    });
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : "Ce mois est déjà réglé pour cet élève, ou le paiement n'a pas pu être enregistré." };
  }
  if (r.paiementId) redirect(`/finance/recu/${r.paiementId}`);
  return { ok: r.message };
}

export async function moveGroupAction(_prev: unknown, form: FormData) {
  try {
    const result = await apiFetch<{ group: string }>(
      `/admissions/enrolments/${String(form.get('enrolmentId') ?? '')}/group`,
      { method: 'POST', json: { groupId: String(form.get('groupId') ?? '') } },
    );
    revalidatePath('/students');
    return { ok: `Déplacé vers ${result.group}.` };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec du déplacement.' };
  }
}

// ── Expenses ────────────────────────────────────────────────────────────────

/**
 * NOUVELLE DÉPENSE — `depenses.php`, action `ajouter`, ses refus dans son ordre.
 *
 * L'administration crée la dépense avec ses moyens de paiement ; le comptable
 * soumet une demande (`demandes`, type `depense`) qui porte les mêmes lignes
 * en `metadata`, et que l'administration exécutera depuis « Demandes ».
 */
export async function recordExpenseAction(_prev: unknown, form: FormData) {
  const montant = String(form.get('montant') ?? '').trim();
  const description = String(form.get('description') ?? '').trim();
  if (!(Number(montant) > 0)) return { error: 'Le montant doit être supérieur à 0.' };
  if (!description) return { error: 'La description est obligatoire.' };

  const tender = lireLignesPaiement(form);
  if (tender.length === 0) {
    return { error: 'Veuillez indiquer au moins un moyen de paiement avec un montant.' };
  }
  const total = tender.reduce((a, l) => a + Math.round(Number(l.amount) * 100), 0);
  if (Math.abs(total - Math.round(Number(montant) * 100)) > 1) {
    return {
      error:
        `La somme des moyens de paiement (${mruMsg(total / 100)} MRU) doit égaler le montant dû ` +
        `(${mruMsg(montant)} MRU).`,
    };
  }

  const { user } = await requireSession();
  try {
    if (user.roles.includes('comptable')) {
      await apiFetch('/requests', {
        method: 'POST',
        json: {
          kind: 'depense',
          description,
          amount: Number(montant).toFixed(2),
          metadata: { montant: Number(montant).toFixed(2), description, lignes: tender },
        },
      });
      revalidatePath('/requests');
      return {
        ok: `Votre demande de dépense de ${mruMsg(montant)} MRU a été soumise à l'administrateur pour validation.`,
      };
    }
    await apiFetch('/expenses', {
      method: 'POST',
      json: { amount: Number(montant).toFixed(2), description, tender },
    });
    revalidatePath('/finance/depenses');
    return { ok: `Dépense de ${mruMsg(montant)} MRU ajoutée avec succès.` };
  } catch (error) {
    return {
      error:
        error instanceof ApiError ? error.message : "Erreur lors de l'enregistrement de la dépense.",
    };
  }
}

/** Son « Supprimer » — chez nous une écriture inverse (règle 7), son message. */
export async function reverseExpenseAction(_prev: unknown, form: FormData) {
  try {
    const r = await apiFetch<{ amount: string }>(
      `/expenses/${String(form.get('expenseId') ?? '')}/reverse`,
      { method: 'POST', json: { reason: 'Supprimée' } },
    );
    revalidatePath('/finance/depenses');
    const [entier, cents] = r.amount.split('.');
    return { ok: `Dépense supprimée : ${mruMsg(entier ?? '0')},${cents ?? '00'} MRU.` };
  } catch (error) {
    return {
      error:
        error instanceof ApiError ? error.message : "La suppression a échoué, rien n'a été modifié.",
    };
  }
}

// ── Own account ─────────────────────────────────────────────────────────────

/**
 * RENOUVELER LA SESSION COURANTE après un changement de mot de passe : le
 * sceau du jeton d'accès (son `sceau_compte()`) ne vaut plus ; le jeton de
 * rafraîchissement, épargné par la révocation, en fait émettre un nouveau —
 * la même identité de client qu'à la connexion, sinon l'empreinte de session
 * ne correspond plus et toute la famille est révoquée.
 */
async function renouvelerSession(slug: string | null): Promise<void> {
  const refresh = await readRefreshToken(slug);
  if (!refresh) return;
  try {
    const response = await fetch(`${API}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(slug ? { 'X-School-Slug': slug } : {}),
        ...clientIdentityHeaders(await headers()),
      },
      body: JSON.stringify({ refreshToken: refresh }),
      cache: 'no-store',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return;
    const body = (await response.json()) as { accessToken?: string; refreshToken?: string };
    if (body.accessToken && body.refreshToken) {
      await writeSession(slug, body.accessToken, body.refreshToken);
    }
  } catch {
    // L'API injoignable : la page suivante le dira ; rien à faire ici.
  }
}

/**
 * MODIFIER MON MOT DE PASSE — `modifier_profil.php`, action `changer_mdp` :
 * ses quatre refus viennent de l'API, dans son ordre ; « Mot de passe modifié
 * avec succès. ». Les autres sessions tombent ; la courante est renouvelée
 * (chez lui la session PHP survit à la requête, puis le sceau la ferme).
 */
export async function changePasswordAction(_prev: unknown, form: FormData) {
  const slug = await currentSlug();
  try {
    await apiFetch('/auth/change-password', {
      method: 'POST',
      json: {
        currentPassword: String(form.get('ancien_mdp') ?? ''),
        newPassword: String(form.get('nouveau_mdp') ?? ''),
        confirmPassword: String(form.get('confirmer_mdp') ?? ''),
        refreshToken: await readRefreshToken(slug),
      },
    });
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec du changement.' };
  }
  await renouvelerSession(slug);
  // Le drapeau « doit changer » est levé : la coquille se rafraîchit.
  revalidatePath('/', 'layout');
  return { ok: 'Mot de passe modifié avec succès.' };
}

// ── Emploi du temps — `emploi_du_temps.php` : `placer`, `effacer_case`, `valider` ──

export async function assignSlotAction(_prev: unknown, form: FormData) {
  try {
    await apiFetch('/timetable', {
      method: 'POST',
      json: {
        groupId: String(form.get('groupId') ?? ''),
        teachingId: String(form.get('teachingId') ?? ''),
        dayOfWeek: Number(form.get('dayOfWeek')),
        slot: Number(form.get('slot')),
      },
    });
    revalidatePath('/scolarite/emploi');
    return { ok: 'Case enregistrée.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec du placement.' };
  }
}

export async function clearSlotAction(_prev: unknown, form: FormData) {
  try {
    const groupId = String(form.get('groupId') ?? '');
    await apiFetch(
      `/timetable/group/${groupId}?day=${Number(form.get('day'))}&slot=${Number(form.get('slot'))}`,
      { method: 'DELETE' },
    );
    revalidatePath('/scolarite/emploi');
    return { ok: 'Case effacée.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec du retrait.' };
  }
}

// ── The expulsion register ──────────────────────────────────────────────────

/**
 * Block a person by identity.
 *
 * NNI and RIM, never a student id: the block has to outlive the deletion of the
 * student record, or deleting and re-creating a child walks straight past it.
 */
export async function expelAction(_prev: unknown, form: FormData) {
  // L'un ou l'autre peut manquer (0044) ; sans aucun des deux, l'API refuse.
  const nniBloque = String(form.get('nationalId') ?? '').trim();
  const rimBloque = String(form.get('rim') ?? '').trim();
  try {
    await apiFetch('/expulsions', {
      method: 'POST',
      json: {
        nationalId: nniBloque || undefined,
        rim: rimBloque || undefined,
        firstName: String(form.get('firstName') ?? '').trim(),
        lastName: String(form.get('lastName') ?? '').trim(),
        reason: String(form.get('reason') ?? '').trim() || undefined,
      },
    });
    revalidatePath('/scolarite/exclusions');
    // Son message : « Étudiant expulsé. Ce NNI (X) et RIM (Y) ne pourront plus être réinscrits. »
    return {
      ok: `Étudiant expulsé. ${[nniBloque && `Ce NNI (${nniBloque})`, rimBloque && `${nniBloque ? 'et ce' : 'Ce'} RIM (${rimBloque})`].filter(Boolean).join(' ')} ne pourr${nniBloque && rimBloque ? 'ont' : 'a'} plus être réinscrit${nniBloque && rimBloque ? 's' : ''}.`,
    };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec du blocage.' };
  }
}

/** ✓ Débloquer — son `debloquer` : « « Prénom Nom » débloqué(e). L'inscription est de nouveau possible. » */
export async function liftExpulsionAction(_prev: unknown, form: FormData) {
  try {
    const r = await apiFetch<{ prenom: string; nom: string }>(`/expulsions/${String(form.get('expulsionId') ?? '')}/lift`, {
      method: 'POST',
      json: {},
    });
    revalidatePath('/scolarite/exclusions');
    return { ok: `« ${r.prenom} ${r.nom} » débloqué(e). L'inscription est de nouveau possible.` };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec de la levée.' };
  }
}

// ── Accounts ────────────────────────────────────────────────────────────────

export async function resetAccountPasswordAction(_prev: unknown, form: FormData) {
  try {
    const result = await apiFetch<{ temporaryPassword: string }>(
      `/accounts/users/${String(form.get('userId') ?? '')}/reset-password`,
      { method: 'POST', json: {} },
    );
    revalidatePath('/accounts');
    return {
      ok: 'Mot de passe réinitialisé. Toutes les sessions ont été fermées.',
      password: result.temporaryPassword,
    };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec de la réinitialisation.' };
  }
}

export async function setAccountActiveAction(_prev: unknown, form: FormData) {
  const active = String(form.get('active') ?? '') === 'true';
  try {
    await apiFetch(`/accounts/users/${String(form.get('userId') ?? '')}/active`, {
      method: 'POST',
      json: { active },
    });
    revalidatePath('/accounts');
    return { ok: active ? 'Compte réactivé.' : 'Compte suspendu et sessions fermées.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

export async function setAccountRolesAction(_prev: unknown, form: FormData) {
  const roles = form.getAll('roles').map(String).filter(Boolean);
  try {
    await apiFetch(`/accounts/users/${String(form.get('userId') ?? '')}/roles`, {
      method: 'POST',
      json: { roles },
    });
    revalidatePath('/accounts');
    return { ok: `Rôles enregistrés : ${roles.join(', ')}.` };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

// ── Reference data ──────────────────────────────────────────────────────────

/**
 * CRÉER UN NIVEAU — `gerer_niveaux.php`, `creer_niveau` : « Le nom du niveau
 * est obligatoire. », « Le tarif mensuel doit être positif. », « Ce niveau
 * existe déjà. », « Niveau « X » créé avec succès ! ». Le seuil hors de 0..20
 * retombe à 10, comme chez lui ; le cycle n'est pas demandé (« autre »).
 */
export async function createLevelAction(_prev: unknown, form: FormData) {
  // `/settings` (sans contrepartie chez lui) poste encore `name` / `monthlyRate` / `cycle`.
  const nom = String(form.get('nom_niveau') ?? form.get('name') ?? '').trim();
  const tarif = String(form.get('tarif_mensuel') ?? form.get('monthlyRate') ?? '0').trim() || '0';
  if (!nom) return { error: 'Le nom du niveau est obligatoire.' };
  if (Number(tarif) < 0) return { error: 'Le tarif mensuel doit être positif.' };
  const seuilBrut = Number(String(form.get('seuil_eliminatoire') ?? '10'));
  const seuil = Number.isFinite(seuilBrut) && seuilBrut >= 0 && seuilBrut <= 20 ? seuilBrut : 10;
  try {
    const level = await apiFetch<{ name: string }>('/levels', {
      method: 'POST',
      json: {
        name: nom,
        monthlyRate: tarif,
        cycle: String(form.get('cycle') ?? '') || 'autre',
        // La case « Niveau fondamental » décide seule du bulletin quand le
        // formulaire la porte (page Niveaux : `bareme_explicite`) ; le cycle
        // « Fondamentales » ne fait que classer (30/09/2026). `/settings`, qui
        // n'a pas la case, garde l'ancien raccourci.
        isFondamental:
          String(form.get('fondamental') ?? '') === '1' ||
          (form.get('bareme_explicite') !== '1' && form.get('cycle') === 'fondamental'),
        passMark: seuil.toFixed(2),
        sortOrder: Number(form.get('sortOrder') ?? 0),
      },
    });
    revalidatePath('/settings');
    revalidatePath('/scolarite/niveaux');
    return { ok: `Niveau « ${level.name} » créé avec succès !` };
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) return { error: 'Ce niveau existe déjà.' };
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

/** CRÉER UN GROUPE — `creer_groupe` : « Tous les champs sont obligatoires. », « Groupe « X » créé avec succès ! ». */
export async function createGroupAction(_prev: unknown, form: FormData) {
  if (!String(form.get('levelId') ?? '') || !String(form.get('name') ?? '').trim() || Number(form.get('capacity') ?? 0) < 1) {
    return { error: 'Tous les champs sont obligatoires.' };
  }
  try {
    const group = await apiFetch<{ name: string }>('/groups', {
      method: 'POST',
      json: {
        name: String(form.get('name') ?? '').trim(),
        levelId: String(form.get('levelId') ?? ''),
        capacity: Number(form.get('capacity') ?? 40),
      },
    });
    revalidatePath('/settings');
    revalidatePath('/classes');
    revalidatePath('/scolarite/niveaux');
    revalidatePath('/scolarite/groupes');
    return { ok: `Groupe « ${group.name} » créé avec succès !` };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

/**
 * MODIFIER UN GROUPE DU SOIR — its `modifier_groupe`.
 *
 * ⚠ A GROUP COULD BE CREATED AND NEVER CORRECTED. Its name, its rate and its
 * description were fixed at creation, so a rate typed wrong was what every
 * enrolee was billed for the whole year.
 */
export async function updateEveningGroupAction(_prev: unknown, form: FormData) {
  try {
    const r = await apiFetch<{ name: string }>(
      `/evening/groups/${String(form.get('groupId') ?? '')}`,
      {
        method: 'POST',
        json: {
          name: String(form.get('name') ?? '').trim(),
          // ⚠ A STRING. This is what every enrolee in the group is billed.
          monthlyRate: String(form.get('monthlyRate') ?? '').trim(),
          description: String(form.get('description') ?? '').trim() || undefined,
        },
      },
    );
    revalidatePath('/evening', 'layout');
    return { ok: `Groupe « ${r.name} » mis à jour.` };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

/** SUPPRIMER UN GROUPE DU SOIR — refused once anybody has been enrolled. */
export async function deleteEveningGroupAction(_prev: unknown, form: FormData) {
  try {
    await apiFetch(`/evening/groups/${String(form.get('groupId') ?? '')}`, { method: 'DELETE' });
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec de la suppression.' };
  }
  // Son `header("Location: cours_du_soir.php")`.
  redirect('/evening');
}

// ── Cours du soir : la réduction, et l'annulation d'un salaire ──────────────

/**
 * APPLIQUER UNE RÉDUCTION — its `appliquer_reduction_cs`.
 *
 * ⚠ NOT THE TILL'S. El Ourwa refuses it to the accountant in so many words:
 * "Les réductions sont réservées à l'administration." Lowering what a family
 * owes is a decision; taking their money is a task.
 */
export async function applyEveningDiscountAction(_prev: unknown, form: FormData) {
  try {
    await apiFetch('/evening/discounts', {
      method: 'POST',
      json: {
        enrolmentId: String(form.get('enrolmentId') ?? ''),
        calendarMonth: Number(form.get('month') ?? 0),
        calendarYear: Number(form.get('year') ?? 0),
        // ⚠ The typed string. A reduction is money.
        amount: String(form.get('amount') ?? '').trim(),
        reason: String(form.get('reason') ?? '').trim() || undefined,
      },
    });
    revalidatePath('/evening');
    return {
      ok: `Réduction de ${mruMsg(String(form.get('amount') ?? '0'))} appliquée pour ${MOIS_FR[Number(form.get('month')) - 1]} ${String(form.get('year') ?? '')}.`,
    };
  } catch (error) {
    return { error: `Réduction refusée : ${error instanceof ApiError ? error.message : 'Données de réduction invalides.'}` };
  }
}

/** RETIRER LA RÉDUCTION — its `retirer_reduction_cs`. */
export async function removeEveningDiscountAction(_prev: unknown, form: FormData) {
  const enrolment = String(form.get('enrolmentId') ?? '');
  const year = String(form.get('year') ?? '');
  const month = String(form.get('month') ?? '');
  try {
    await apiFetch(`/evening/discounts/${enrolment}/${year}/${month}`, { method: 'DELETE' });
    revalidatePath('/evening');
    return { ok: 'Réduction retirée.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

/**
 * ANNULER UN PAIEMENT DE PROFESSEUR — its `annuler_paiement_prof_cs`.
 *
 * ⚠ A REVERSING ENTRY, NOT A DELETE. El Ourwa deletes the payment and its
 * tender lines, so cash that left the drawer leaves no trace of having left.
 * The reason is required: an unexplained cancellation of a salary is the one
 * entry an auditor will ask about.
 */
export async function reverseEveningTeacherPaymentAction(_prev: unknown, form: FormData) {
  // Il n'en demande pas ; la ligne inverse en garde la trace.
  const reason = String(form.get('reason') ?? '').trim() || 'Annulation depuis Paiement des Professeurs';

  try {
    await apiFetch(
      `/evening/teacher-payments/${String(form.get('paymentId') ?? '')}/reverse`,
      { method: 'POST', json: { reason } },
    );
    revalidatePath('/evening/professeurs');
    revalidatePath('/evening');
    return { ok: 'Paiement du professeur annulé.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : "Échec de l'annulation." };
  }
}

// ── Cours du soir : les professeurs d'un groupe ─────────────────────────────
//
// ⚠ `evening_teachings` was READ by the payroll and WRITTEN by nothing. The
// "Paiement des Professeurs" tab was built on a table no screen could fill.

/** ASSIGNER UN PROFESSEUR — its `assigner_prof`. */
export async function assignEveningTeacherAction(_prev: unknown, form: FormData) {
  const source = String(form.get('source') ?? 'interne');
  const payKind = String(form.get('payKind') === 'fixe' ? 'fixed' : 'hourly');
  if (!String(form.get('subject') ?? '').trim()) return { error: 'Indiquez la matiere enseignee.' };

  // Son « [ + Créer un nouveau professeur externe ] » : créé ici, puis assigné.
  let eveningTeacherId = String(form.get('eveningTeacherId') ?? '');
  if (source === 'externe' && eveningTeacherId === 'nouveau') {
    const nom = String(form.get('ext_nom') ?? '').trim();
    const prenom = String(form.get('ext_prenom') ?? '').trim();
    if (!nom || !prenom) return { error: 'Le nom et le prénom du professeur externe sont requis.' };
    try {
      const cree = await apiFetch<{ id: string }>('/evening/teachers', {
        method: 'POST',
        json: { firstName: prenom, lastName: nom, phone: String(form.get('ext_tel') ?? '').trim() || undefined },
      });
      eveningTeacherId = cree.id;
    } catch (error) {
      return { error: error instanceof ApiError ? error.message : "L'affectation n'a pas pu etre enregistree." };
    }
  }
  if (source === 'interne' ? !String(form.get('teacherId') ?? '') : !eveningTeacherId) {
    return { error: "Selectionnez un professeur : de l'ecole, ou externe." };
  }

  try {
    await apiFetch('/evening/teachings', {
      method: 'POST',
      json: {
        eveningGroupId: String(form.get('eveningGroupId') ?? ''),
        // ⚠ Exactly one. The table's CHECK is exclusive-or, and sending both
        // would surface a constraint name instead of a sentence.
        ...(source === 'interne'
          ? { teacherId: String(form.get('teacherId') ?? '') || undefined }
          : { eveningTeacherId }),
        subject: String(form.get('subject') ?? '').trim(),
        payKind,
        // The unused half is not sent: the service clears it anyway, and
        // sending a stale rate beside a fixed salary is how one gets stored.
        ...(payKind === 'hourly'
          ? {
              hourlyRate: String(form.get('hourlyRate') ?? '0').trim(),
              hoursPerMonth: Number(form.get('hoursPerMonth') ?? 0),
            }
          : { fixedSalary: String(form.get('fixedSalary') ?? '0').trim() }),
      },
    });
    revalidatePath('/evening');
    revalidatePath('/evening/professeurs');
    return { ok: 'Professeur assigné avec succès.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : "L'affectation n'a pas pu etre enregistree." };
  }
}

/** RETIRER — its `retirer_prof`. */
/**
 * POSER UN CRÉNEAU — `cours_du_soir.php`, `placer_creneau`.
 *
 * ⚠ LE SERVEUR VÉRIFIE QUE LA MATIÈRE EST L'UNE DE CELLES DU GROUPE. La modale
 * n'offre que celles-là, mais la liste d'un <select> n'est pas une garantie :
 * c'est le service qui refuse, et son message est celui de l'écran d'origine.
 */
export async function placeEveningSlotAction(_prev: unknown, form: FormData) {
  const groupId = String(form.get('groupId') ?? '');
  const subject = String(form.get('subject') ?? '').trim();
  const teachingId = String(form.get('eveningTeachingId') ?? '').trim();

  if (!subject && !teachingId) {
    return {
      error:
        'Données du créneau invalides : choisissez au moins une matière ou un enseignant.',
    };
  }

  try {
    const result = await apiFetch<{ subject: string }>(
      `/evening/groups/${groupId}/timetable`,
      {
        method: 'POST',
        json: {
          dayOfWeek: Number(form.get('dayOfWeek')),
          slot: Number(form.get('slot')),
          ...(subject ? { subject } : {}),
          ...(teachingId ? { eveningTeachingId: teachingId } : {}),
        },
      },
    );
    revalidatePath('/evening');
    return { ok: `Créneau enregistré : ${result.subject} (${String(form.get('jourLabel') ?? '')} ${String(form.get('creneauLabel') ?? '')}).` };
  } catch (error) {
    return {
      error: error instanceof ApiError ? error.message : "Échec de l'enregistrement du créneau.",
    };
  }
}

/** LIBÉRER UN CRÉNEAU — son `effacer_creneau`. « Créneau libéré. » */
export async function clearEveningSlotAction(_prev: unknown, form: FormData) {
  const groupId = String(form.get('groupId') ?? '');
  try {
    await apiFetch(`/evening/groups/${groupId}/timetable/clear`, {
      method: 'POST',
      json: {
        dayOfWeek: Number(form.get('dayOfWeek')),
        slot: Number(form.get('slot')),
      },
    });
    revalidatePath('/evening');
    return { ok: 'Créneau libéré.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

export async function removeEveningTeachingAction(_prev: unknown, form: FormData) {
  try {
    await apiFetch(`/evening/teachings/${String(form.get('teachingId') ?? '')}`, {
      method: 'DELETE',
    });
    revalidatePath('/evening');
    revalidatePath('/evening/professeurs');
    return { ok: 'Assignation du professeur retirée.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

/** `valider` — « Emploi du temps validé et notifié à N parent(s). » */
export async function publishTimetableAction(_prev: unknown, form: FormData) {
  try {
    const r = await apiFetch<{ notified: number; label: string }>('/timetable/publish', {
      method: 'POST',
      json: {
        groupId: String(form.get('groupId') ?? ''),
        academicYearId: String(form.get('academicYearId') ?? ''),
      },
    });
    revalidatePath('/scolarite/emploi');
    return {
      ok: `Emploi du temps validé et notifié à ${r.notified} parent(s).`,
    };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec de la publication.' };
  }
}

// ── Les frais annuels ───────────────────────────────────────────────────────
//
// ⚠ Three of the four things `gestion_caisse.php` can do with an annual fee had
// no route at all: the exemption table has been READ by the debt query since it
// existed, and nothing could write a row into it.

/** EXEMPTER — `exempter_frais_annuel`. Behind `finance.dette`, not the till's. */
export async function exemptAnnualFeeAction(_prev: unknown, form: FormData) {
  try {
    await apiFetch(`/finance/annual-fees/${String(form.get('guardianId') ?? '')}/exempt`, {
      method: 'POST',
      json: {
        kind: String(form.get('kind') ?? ''),
        academicYearId: String(form.get('academicYearId') ?? '') || undefined,
      },
    });
    revalidatePath(`/finance/${String(form.get('guardianId') ?? '')}`);
    return { ok: `Exemption accordée pour l'année ${String(form.get('anneeLabel') ?? '')}.` };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

/** RETIRER L'EXEMPTION — `retirer_exemption_frais_annuel`. */
export async function removeAnnualFeeExemptionAction(_prev: unknown, form: FormData) {
  try {
    await apiFetch(
      `/finance/annual-fees/${String(form.get('guardianId') ?? '')}/remove-exemption`,
      {
        method: 'POST',
        json: {
          kind: String(form.get('kind') ?? ''),
          academicYearId: String(form.get('academicYearId') ?? '') || undefined,
        },
      },
    );
    revalidatePath(`/finance/${String(form.get('guardianId') ?? '')}`);
    return { ok: 'Exemption retirée.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

/**
 * CONFIGURER LES MONTANTS — `configurer_frais_annuels`.
 *
 * ⚠ Both amounts travel as STRINGS. `Number('1500.50')` is a float, and a float
 * is how a fee ends up one centime out for every family in the school.
 */
export async function setAnnualFeeScaleAction(_prev: unknown, form: FormData) {
  try {
    await apiFetch('/finance/annual-fees/scale', {
      method: 'POST',
      json: {
        enrolment: String(form.get('enrolment') ?? '').trim() || undefined,
        photocopy: String(form.get('photocopy') ?? '').trim() || undefined,
        academicYearId: String(form.get('academicYearId') ?? '') || undefined,
      },
    });
    revalidatePath('/finance', 'layout');
    return { ok: `Barème des frais mis à jour pour l'année ${String(form.get('anneeLabel') ?? '')}.` };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

// ── Les éditions en ligne de « Gérer les Niveaux » ──────────────────────────
//
// Its levels table is a row of small forms, each posting on its own and each
// answering with its own sentence. These four are those forms.

/**
 * MODIFIER LE TARIF MENSUEL — its `modifier_tarif`.
 *
 * ⚠ Sent as a STRING, never `Number(...)`. A rate of 12500.50 through a JS
 * number is 12500.5 on a good day and 12500.499999999998 on a bad one, and this
 * value is what every family in the level is billed at.
 */
export async function setLevelRateAction(_prev: unknown, form: FormData) {
  try {
    await apiFetch(`/levels/${String(form.get('levelId') ?? '')}/rate`, {
      method: 'PATCH',
      json: { monthlyRate: String(form.get('monthlyRate') ?? '').trim() },
    });
    revalidatePath('/scolarite/niveaux');
    return { ok: 'Tarif mensuel mis à jour.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

/** MODIFIER LE SEUIL D'ADMISSION — its `modifier_seuil`. Always out of 20. */
export async function setLevelPassMarkAction(_prev: unknown, form: FormData) {
  try {
    await apiFetch(`/levels/${String(form.get('levelId') ?? '')}/pass-mark`, {
      method: 'PATCH',
      json: { passMark: String(form.get('passMark') ?? '') },
    });
    revalidatePath('/scolarite/niveaux');
    return { ok: "Seuil d'admission mis à jour." };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

/** LE CYCLE ET LE RANG D'UN NIVEAU (demande de Jinan, 30/09/2026). */
export async function setLevelClassificationAction(_prev: unknown, form: FormData) {
  const niveau = String(form.get('niveau') ?? '').trim();
  try {
    await apiFetch(`/levels/${String(form.get('levelId') ?? '')}/classement`, {
      method: 'PATCH',
      json: { cycle: String(form.get('cycle') ?? ''), sortOrder: Number(form.get('sortOrder') ?? 0) },
    });
    revalidatePath('/scolarite/niveaux');
    return { ok: `Niveau « ${niveau} » classé.` };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

/** RENDRE FONDAMENTAL / RENDRE NORMAL — its `basculer_fondamental`. */
export async function toggleFondamentalAction(_prev: unknown, form: FormData) {
  try {
    await apiFetch(`/levels/${String(form.get('levelId') ?? '')}/toggle-fondamental`, {
      method: 'POST',
      json: {},
    });
    revalidatePath('/scolarite/niveaux');
    return { ok: 'Statut « fondamental » du niveau mis à jour.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

/** MODIFIER LE BARÈME — its `modifier_note_sur`, offered on fondamental only. */
export async function setSubjectMaxScoreAction(_prev: unknown, form: FormData) {
  try {
    const raw = String(form.get('maxScore') ?? '').trim();
    await apiFetch(`/subjects/${String(form.get('subjectId') ?? '')}/max-score`, {
      method: 'PATCH',
      json: { maxScore: raw },
    });
    revalidatePath('/scolarite/niveaux');
    return { ok: `Barème de la matière mis à jour (notée sur ${String(Number(raw))}).` };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

/**
 * SUPPRIMER UN NIVEAU — its `supprimer_niveau`.
 *
 * The API refuses unless the level is empty, and says which of the two reasons
 * applies. Its own screen only renders the button when the level shows zero
 * groups and zero children, so the refusal is only ever reached by a stale page.
 */
export async function deleteLevelAction(_prev: unknown, form: FormData) {
  try {
    await apiFetch(`/levels/${String(form.get('levelId') ?? '')}`, { method: 'DELETE' });
    revalidatePath('/scolarite/niveaux');
    return { ok: 'Niveau supprimé avec succès.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec de la suppression.' };
  }
}

/**
 * SUPPRIMER UNE CLASSE — its `supprimer_groupe`.
 *
 * ⚠ Refused as soon as anyone has ever been enrolled in it, because deleting
 * the class would take their payments, their marks and their absences with it.
 * El Ourwa stopped its own cascade here and left the reason in the source.
 */
export async function deleteGroupAction(_prev: unknown, form: FormData) {
  try {
    await apiFetch(`/groups/${String(form.get('groupId') ?? '')}`, { method: 'DELETE' });
    revalidatePath('/scolarite/niveaux');
    revalidatePath('/scolarite/groupes');
    // Deux pages, deux phrases : `gerer_niveaux.php` et `gestion_groupes.php`.
    return { ok: form.get('page') === 'niveaux' ? 'Classe supprimée (elle était vide).' : 'Groupe supprimé avec succès.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec de la suppression.' };
  }
}

// ── La facturation « services » (Jinan) : la page « Frais » ─────────────────
//
// ADR-0073, docs/specs/jinan-facturation.md §9. Ces trois actions n'existent
// que pour une école « services ». Chacune le revérifie AVANT d'appeler l'API —
// qui refuse de toute façon une école « famille » (400) — pour que rien de
// tout cela ne parte jamais vers El Mourad, Nour, Rissala ou Salam.
//
// ⚠ Les montants voyagent en CHAÎNES, jamais par `Number(...)` : un prix est
// ce que chaque famille du niveau paiera, au centime.

const FRAIS_INDISPONIBLES =
  "La page « Frais » est indisponible pour cette école : elle facture par famille (tarif mensuel du niveau, frais annuels de la caisse).";

/** Le nom d'un tarif de niveau dans les messages — celui que l'API emploie. */
const QUOI_TARIF: Record<ChampTarifNiveau, string> = {
  tarif8h14: `Tarif ${libelleMode('8h-14h')}`,
  tarif8h17: `Tarif ${libelleMode('8h-17h')}`,
  fraisInscription: "Frais d'inscription",
};

/**
 * Un prix saisi, prêt pour l'API : sans espace, virgule → point ; `''` =
 * « non défini ». `null` quand ce n'est pas un montant — la règle de l'API,
 * numeric(14,2) : douze chiffres au plus, deux décimales, jamais de signe.
 */
function prixSaisi(brut: FormDataEntryValue | null): string | null {
  const t = String(brut ?? '').trim().replace(/\s/g, '').replace(',', '.');
  if (t === '') return '';
  return /^\d{1,12}(\.\d{1,2})?$/.test(t) ? t : null;
}

const montantInvalide = (quoi: string) =>
  `${quoi} : indiquez un montant positif, en chiffres, deux décimales au plus.`;

/** « 3 000 MRU » ou « non défini » — pour les messages seulement. */
function prixMsg(v: string | null | undefined): string {
  return v === null || v === undefined ? 'non défini' : `${mruMsg(v)} MRU`;
}

/**
 * UN TARIF D'UN NIVEAU — `PATCH /levels/:id/tarifs`, un champ à la fois (la
 * cellule de la page « Frais » ou de « Gérer les niveaux »). Vide = « non
 * défini ». Jamais rétroactif : un élève déjà inscrit garde son tarif.
 */
export async function setLevelTarifAction(_prev: unknown, form: FormData) {
  const levelId = String(form.get('levelId') ?? '');
  const champ = String(form.get('champ') ?? '') as ChampTarifNiveau;
  if (!(CHAMPS_TARIF_NIVEAU as readonly string[]).includes(champ)) return { error: 'Tarif inconnu.' };
  const montant = prixSaisi(form.get('montant'));
  if (montant === null) return { error: montantInvalide(QUOI_TARIF[champ]) };
  if (!(await estEcoleServices())) return { error: FRAIS_INDISPONIBLES };
  try {
    const niveau = await apiFetch<TarifNiveau>(`/levels/${encodeURIComponent(levelId)}/tarifs`, {
      method: 'PATCH',
      json: { [champ]: montant },
    });
    revalidatePath('/frais');
    revalidatePath('/scolarite/niveaux');
    return { ok: `${QUOI_TARIF[champ]} du niveau « ${niveau.nom} » : ${prixMsg(niveau[champ])}.` };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

/**
 * LE PRIX D'UN SERVICE POUR UNE ANNÉE — `POST /finance/tarifs/services`, un
 * service à la fois. Vide = « non défini » (on ne peut plus y souscrire). Une
 * année close est refusée par l'API. Les abonnements déjà pris gardent leur prix.
 */
export async function setServicePriceAction(_prev: unknown, form: FormData) {
  const academicYearId = String(form.get('academicYearId') ?? '');
  const code = String(form.get('code') ?? '');
  if (!estServiceOptionnel(code)) return { error: 'Service inconnu.' };
  const libelle = libelleService(code, LIBELLE_FRAIS_PHOTOCOPIE);
  const montant = prixSaisi(form.get('prix'));
  if (montant === null) return { error: montantInvalide(libelle) };
  if (!(await estEcoleServices())) return { error: FRAIS_INDISPONIBLES };
  try {
    const prix = await apiFetch<PrixService[]>('/finance/tarifs/services', {
      method: 'POST',
      json: { academicYearId, prix: { [code]: montant } },
    });
    revalidatePath('/frais');
    const annee = String(form.get('anneeLabel') ?? '').trim();
    return { ok: `${libelle}${annee ? ` (${annee})` : ''} : ${prixMsg(prix.find((p) => p.code === code)?.prix)}.` };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

/**
 * CRÉER UN NIVEAU, ÉCOLE « SERVICES » — le « Créer un Niveau » de
 * `gerer_niveaux.php` avec, à la place du tarif mensuel unique, les tarifs
 * 8h – 14h / 8h – 17h et les frais d'inscription (tous facultatifs : vide =
 * « non défini »).
 *
 * `POST /levels` exige toujours `monthlyRate` : il part à '0' (la colonne des
 * écoles « famille », que Jinan ne lit pas), puis `PATCH /levels/:id/tarifs`
 * pose ce qui a été saisi. Les montants sont vérifiés AVANT la création : un
 * montant mal tapé ne laisse pas un niveau à moitié créé.
 */
export async function createLevelServicesAction(_prev: unknown, form: FormData) {
  const nom = String(form.get('nom_niveau') ?? '').trim();
  if (!nom) return { error: 'Le nom du niveau est obligatoire.' };
  const tarifs: Partial<Record<ChampTarifNiveau, string>> = {};
  for (const champ of CHAMPS_TARIF_NIVEAU) {
    const v = prixSaisi(form.get(champ));
    if (v === null) return { error: montantInvalide(QUOI_TARIF[champ]) };
    if (v !== '') tarifs[champ] = v;
  }
  if (!(await estEcoleServices())) return { error: FRAIS_INDISPONIBLES };
  const seuilBrut = Number(String(form.get('seuil_eliminatoire') ?? '10'));
  const seuil = Number.isFinite(seuilBrut) && seuilBrut >= 0 && seuilBrut <= 20 ? seuilBrut : 10;

  let level: { id: string; name: string };
  try {
    level = await apiFetch<{ id: string; name: string }>('/levels', {
      method: 'POST',
      json: {
        name: nom,
        monthlyRate: '0',
        cycle: String(form.get('cycle') ?? '') || 'autre',
        // La case « Niveau fondamental » décide seule du bulletin quand le
        // formulaire la porte (page Niveaux : `bareme_explicite`) ; le cycle
        // « Fondamentales » ne fait que classer (30/09/2026). `/settings`, qui
        // n'a pas la case, garde l'ancien raccourci.
        isFondamental:
          String(form.get('fondamental') ?? '') === '1' ||
          (form.get('bareme_explicite') !== '1' && form.get('cycle') === 'fondamental'),
        passMark: seuil.toFixed(2),
        sortOrder: Number(form.get('sortOrder') ?? 0),
      },
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) return { error: 'Ce niveau existe déjà.' };
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
  revalidatePath('/scolarite/niveaux');
  revalidatePath('/frais');

  if (Object.keys(tarifs).length === 0) {
    return {
      ok: `Niveau « ${level.name} » créé avec succès ! Ses tarifs sont « non définis » : posez-les sur sa ligne ou par le bouton « Frais ».`,
    };
  }
  try {
    await apiFetch(`/levels/${level.id}/tarifs`, { method: 'PATCH', json: tarifs });
    return { ok: `Niveau « ${level.name} » créé avec succès !` };
  } catch (error) {
    const pourquoi = error instanceof ApiError ? error.message : 'le serveur ne répond pas.';
    return {
      error: `Niveau « ${level.name} » créé, mais ses tarifs n'ont pas été enregistrés (${pourquoi}). Posez-les sur sa ligne ou par le bouton « Frais ».`,
    };
  }
}

/** AJOUTER UNE MATIÈRE — `creer_matiere` : « Données invalides. », « Cette matière existe déjà dans ce niveau. », « Matière « X » ajoutée au niveau ! ». */
export async function createSubjectAction(_prev: unknown, form: FormData) {
  const coef = Number(form.get('coefficient') ?? 1);
  if (!String(form.get('levelId') ?? '') || !String(form.get('name') ?? '').trim() || coef < 1 || coef > 10) {
    return { error: 'Données invalides.' };
  }
  try {
    const subject = await apiFetch<{ name: string }>('/subjects', {
      method: 'POST',
      json: {
        name: String(form.get('name') ?? '').trim(),
        nameAr: String(form.get('nameAr') ?? '').trim() || undefined,
        levelId: String(form.get('levelId') ?? ''),
        coefficient: Number(form.get('coefficient') ?? 1),
        maxScore: String(form.get('maxScore') ?? '').trim() || undefined,
      },
    });
    revalidatePath('/scolarite/niveaux');
    revalidatePath('/settings');
    return { ok: `Matière « ${subject.name} » ajoutée au niveau !` };
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) return { error: 'Cette matière existe déjà dans ce niveau.' };
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

/** Change a subject's coefficient in place — its `modifier_coef`. */
export async function setSubjectCoefficientAction(_prev: unknown, form: FormData) {
  try {
    await apiFetch(`/subjects/${String(form.get('subjectId') ?? '')}/coefficient`, {
      method: 'PATCH',
      json: { coefficient: Number(form.get('coefficient') ?? 1) },
    });
    revalidatePath('/scolarite/niveaux');
    return { ok: 'Coefficient modifié.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

/**
 * Delete a subject.
 *
 * ⚠ The API refuses when it is taught, and the refusal is the point: the
 * foreign key cascades, so deleting a taught subject would take every teaching
 * of it and every mark hanging off those teachings.
 */
export async function deleteSubjectAction(_prev: unknown, form: FormData) {
  try {
    await apiFetch(`/subjects/${String(form.get('subjectId') ?? '')}`, { method: 'DELETE' });
    revalidatePath('/scolarite/niveaux');
    return { ok: 'Matière supprimée.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec de la suppression.' };
  }
}

export async function createYearAction(_prev: unknown, form: FormData) {
  try {
    const year = await apiFetch<{ label: string }>('/academic-years', {
      method: 'POST',
      json: {
        startYear: Number(form.get('startYear')),
        // ⚠ UNE ANNÉE SCOLAIRE EST UNE PÉRIODE, et son formulaire la demande
        // ainsi : « Premier mois » → « Dernier mois ». Ces deux nombres partaient
        // absents, donc l'année naissait sur la période par défaut du serveur
        // quoi que l'opérateur ait choisi à l'écran.
        startMonth: Number(form.get('startMonth')) || undefined,
        endMonth: Number(form.get('endMonth')) || undefined,
      },
    });
    revalidatePath('/annees');
    revalidatePath('/settings');
    void year;
    return { ok: 'Année créée.' };
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) return { error: 'Cette année existe déjà.' };
    return { error: error instanceof ApiError ? error.message : 'Cette année existe déjà.' };
  }
}

/**
 * RENDRE UNE ANNÉE ACTIVE — `annees_scolaires.php`, action `activer`.
 *
 * ⚠ CE N'EST PAS UNE CLÔTURE : rien n'est archivé, rien n'est vidé. On déplace
 * l'année de travail, et c'est pourquoi sa confirmation tient en une phrase là
 * où la clôture exige un mot tapé à la main.
 */
export async function activateYearAction(_prev: unknown, form: FormData) {
  try {
    const year = await apiFetch<{ label: string }>(
      `/academic-years/${String(form.get('anneeId') ?? '')}/activate`,
      { method: 'POST', json: {} },
    );
    revalidatePath('/', 'layout');
    void year;
    return { ok: 'Année active mise à jour : toutes les pages, tableaux et rapports suivent désormais cette année.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

/** MODIFIER LA PÉRIODE d'une année — son action `modifier_mois`. */
export async function setYearPeriodAction(_prev: unknown, form: FormData) {
  const debut = Number(form.get('startMonth'));
  const fin = Number(form.get('endMonth'));
  try {
    await apiFetch(`/academic-years/${String(form.get('anneeId') ?? '')}/period`, {
      method: 'POST',
      json: { startMonth: debut, endMonth: fin },
    });
    revalidatePath('/annees');
    return { ok: 'Mois mis à jour.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

/**
 * Close a year.
 *
 * Irreversible: a closed year refuses every financial and academic write. The
 * confirmation is the typed label, not a checkbox — an accidental close would
 * freeze the school's current books.
 */
export async function closeYearAction(_prev: unknown, form: FormData) {
  const libelle = String(form.get('libelle') ?? form.get('label') ?? '');
  const tape = String(form.get('confirmation') ?? form.get('confirm') ?? '').trim();
  // ⚠ SON MOT EST « CLOTURER », pas le libellé de l'année — c'est ce que dit
  // son `placeholder`. Demander « 2025-2026 » obligeait à recopier un libellé
  // que la ligne affiche juste à côté, ce qui se fait sans lire.
  if (tape !== 'CLOTURER') {
    return { error: 'Tapez CLOTURER pour confirmer : cette action archive toutes les inscriptions de l’année.' };
  }
  try {
    await apiFetch(
      `/academic-years/${String(form.get('anneeId') ?? form.get('yearId') ?? '')}/close`,
      { method: 'POST', json: {} },
    );
    revalidatePath('/', 'layout');
    return {
      ok:
        `Année ${libelle} clôturée : ses inscriptions sont archivées et l'année suivante est ouverte. ` +
        "Aucun élève n'y est inscrit tant que vous n'avez pas fait les réinscriptions. " +
        "Notes, paiements et bulletins restent consultables en choisissant l'année.",
    };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec de la clôture.' };
  }
}

/**
 * LES TROIS ACTIONS D'`administrateurs.php` — `ajouter_admin`, `modifier_admin`,
 * `basculer_admin`.
 *
 * ⚠ UN « ADMINISTRATEUR » ICI EST UN PORTEUR DE FONDS, pas un compte. Quelqu'un
 * à qui l'école remet de l'argent, avec un plafond mensuel. Il ne se connecte
 * nulle part (GLOSSAIRE §4).
 */
/** Son `number_format($x, 0, ',', ' ')`, pour ses messages. */
function mruMsg(v: string | number): string {
  return String(Math.round(Number(v))).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** `ajouter_admin` — ses deux refus, son message. */
export async function addFundHolderAction(_prev: unknown, form: FormData) {
  const nom = String(form.get('fullName') ?? '').trim();
  const limite = String(form.get('monthlyLimit') ?? '0').trim();
  if (nom.length < 3) return { error: 'Nom complet invalide (3 caractères minimum).' };
  if (Number(limite) < 0) return { error: 'La limite mensuelle ne peut pas être négative.' };
  try {
    await apiFetch('/payroll/fund-holders', {
      method: 'POST',
      json: {
        fullName: nom,
        phone: String(form.get('phone') ?? '').trim() || undefined,
        monthlyLimit: Number(limite).toFixed(2),
      },
    });
    revalidatePath('/finance/administrateurs');
    return {
      ok: `Administrateur « ${nom} » ajouté avec une limite de ${mruMsg(limite)} MRU/mois.`,
    };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Données invalides.' };
  }
}

/** `modifier_admin`. */
export async function updateFundHolderAction(_prev: unknown, form: FormData) {
  const limite = String(form.get('monthlyLimit') ?? '').trim();
  if (limite === '' || Number.isNaN(Number(limite)) || Number(limite) < 0) {
    return { error: 'Données invalides.' };
  }
  try {
    await apiFetch(`/payroll/fund-holders/${String(form.get('adminId') ?? '')}`, {
      method: 'POST',
      json: {
        monthlyLimit: Number(limite).toFixed(2),
        phone: String(form.get('phone') ?? '').trim() || undefined,
      },
    });
    revalidatePath('/finance/administrateurs');
    return { ok: `Limite mensuelle mise à jour : ${mruMsg(limite)} MRU/mois.` };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Données invalides.' };
  }
}

/** `basculer_admin` — désactiver, jamais supprimer : les retraits pointent cette fiche. */
export async function toggleFundHolderAction(_prev: unknown, form: FormData) {
  try {
    await apiFetch<{ active: boolean }>(
      `/payroll/fund-holders/${String(form.get('adminId') ?? '')}/toggle`,
      { method: 'POST', json: {} },
    );
    revalidatePath('/finance/administrateurs');
    return { ok: "Statut de l'administrateur mis à jour." };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Données invalides.' };
  }
}

/**
 * AJOUTER UNE FICHE DE PERSONNEL — `ajouter_staff.php`.
 *
 * ⚠ Aucune connexion n'est créée. Qui a besoin d'un accès passe par « Créer un
 * utilisateur », qui crée la fiche ET le login.
 */
export async function addStaffAction(_prev: unknown, form: FormData) {
  const nom = String(form.get('nom') ?? '').trim();
  const prenom = String(form.get('prenom') ?? '').trim();
  const fonction = String(form.get('fonction') ?? '').trim();
  // Son refus : « Le nom, le prénom et la fonction sont obligatoires. »
  if (nom === '' || prenom === '' || fonction === '') {
    return { error: 'Le nom, le prénom et la fonction sont obligatoires.' };
  }
  const sexe = String(form.get('sexe') ?? '');
  try {
    await apiFetch('/accounts/staff', {
      method: 'POST',
      json: {
        firstName: prenom,
        lastName: nom,
        jobTitle: fonction,
        sex: sexe === 'M' || sexe === 'F' ? sexe : undefined,
        phone: String(form.get('telephone') ?? '').trim() || undefined,
        salary: Number(String(form.get('salaire') ?? '0') || '0').toFixed(2),
        // Son `$_POST['date_embauche'] ?? date('Y-m-d')`.
        hiredOn: String(form.get('date_embauche') ?? '') || new Date().toISOString().slice(0, 10),
        // Les mois où ce membre est payé (décision du propriétaire, 2026-09-17) ;
        // aucune case cochée = les douze.
        paidMonths: form.getAll('mois_payes').map((m) => Number(m)).filter((m) => m >= 1 && m <= 12),
      },
    });
    revalidatePath('/comptes/staff');
    return { ok: `Personnel "${prenom} ${nom}" ajouté avec succès !` };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

/** Son `supprimer` : `DELETE FROM staff`, « Personnel supprimé. » */
export async function deleteStaffAction(_prev: unknown, form: FormData) {
  try {
    await apiFetch(`/accounts/staff/${String(form.get('staff_id') ?? '')}`, { method: 'DELETE' });
    revalidatePath('/comptes/staff');
    return { ok: 'Personnel supprimé.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec de la suppression.' };
  }
}

// ── Bulk re-enrolment ───────────────────────────────────────────────────────

/**
 * RÉINSCRIRE UN ENFANT — one child, one class.
 *
 * ⚠ The debt gate lives on the server. Sending `bypassDebt` from a form does not
 * authorise anything: `reEnrol()` refuses it unless the caller holds the
 * direction's permission, so tampering with the checkbox changes nothing.
 */
/**
 * RÉINSCRIRE — le POST `reinscrire` de `reinscrire_etudiant.php` : ses champs
 * (`etudiant_id`, `nouveau_groupe_id`, `frais_personnalise`, `bypass_dette`),
 * son refus « Veuillez sélectionner un étudiant et un nouveau groupe. », les
 * refus du serveur dans son ordre (déjà inscrit, progression, dette, admin),
 * et son message : « Étudiant réinscrit avec succès dans la nouvelle classe.
 * [⚠️ frais soumis…] Échéancier créé pour X : vous pouvez encaisser le premier
 * mois ci-dessous. » Réussie, la fenêtre d'encaissement s'ouvre (`$reinscrit`).
 */
export async function reEnrolAction(_prev: unknown, form: FormData) {
  const studentId = String(form.get('etudiant_id') ?? '');
  const groupId = String(form.get('nouveau_groupe_id') ?? '');
  if (!studentId || !groupId) {
    return { error: 'Veuillez sélectionner un étudiant et un nouveau groupe.' };
  }
  const brutFrais = String(form.get('frais_personnalise') ?? '').trim();
  const fraisPerso =
    brutFrais !== '' && Number.isFinite(Number(brutFrais)) && Number(brutFrais) >= 0
      ? Number(brutFrais).toFixed(2)
      : undefined;
  // École « services » (Jinan, §8) : mode obligatoire, services cochés.
  const facturation = await lireChoixFacturation(form);
  if ('error' in facturation) return { error: facturation.error };

  try {
    const result = await apiFetch<{ id: string; monthlyFee: string; feeRequested?: string }>(
      '/enrollments/re-enrol',
      {
        method: 'POST',
        json: {
          studentId,
          groupId,
          monthlyFee: fraisPerso,
          bypassDebt: form.get('bypass_dette') === '1',
          ...facturation.champs,
        },
      },
    );
    let message = 'Étudiant réinscrit avec succès dans la nouvelle classe.';
    if (result.feeRequested !== undefined && result.feeRequested !== null) {
      message +=
        ` ⚠️ Le frais personnalisé (${mruMsg(result.feeRequested)} MRU) a été soumis à l'administrateur pour validation ; ` +
        'le tarif officiel du niveau s\'applique en attendant.';
    }
    const fenetre = await apiFetch<import('@/components/fenetre-encaissement').FenetreData>(
      `/finance/caisse/encaissement-inscription/${studentId}`,
    ).catch(() => undefined);
    if (fenetre) {
      message += ` Échéancier créé pour ${fenetre.annee.label} : vous pouvez encaisser le premier mois ci-dessous.`;
    }
    revalidatePath('/re-enrol');
    return { ok: message, fenetre };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Erreur : la réinscription a échoué.' };
  }
}

/**
 * PAYER UNE DETTE DE SCOLARITÉ (UN MOIS PRÉCIS) — son POST `payer_dette_mois` :
 * son refus « Le montant (X MRU) dépasse le reste dû (Y MRU). » et son message
 * « Paiement de N MRU enregistré pour Mois Année. ». L'écriture passe par le
 * même chemin que la caisse (année close refusée, reçu numéroté, parent notifié).
 */
export async function payerDetteMoisAction(_prev: unknown, form: FormData) {
  const tender = lireLignesPaiement(form);
  if (tender.length === 0) return { error: 'Veuillez indiquer au moins un moyen de paiement avec un montant.' };
  const mois = Number(form.get('mois'));
  const annee = Number(form.get('annee'));
  if (!(mois >= 1 && mois <= 12) || !(annee >= 2020)) return { error: 'Données de paiement invalides.' };
  const total = tender.reduce((a, l) => a + Number(l.amount), 0);
  const reste = Number(form.get('reste') ?? '0');
  if (total > reste + 0.01) {
    return { error: `Le montant (${mruMsg(total)} MRU) dépasse le reste dû (${mruMsg(reste)} MRU).` };
  }
  try {
    await apiFetch('/finance/caisse/paiement', {
      method: 'POST',
      json: { studentId: String(form.get('etudiant_id') ?? ''), mois, annee, tender },
    });
    revalidatePath('/re-enrol');
    revalidatePath('/finance', 'layout');
    return { ok: `Paiement de ${mruMsg(total)} MRU enregistré pour ${MOIS_NOMS[mois]} ${annee}.` };
  } catch (error) {
    return { error: error instanceof ApiError ? `Erreur lors du paiement : ${error.message}` : 'Erreur lors du paiement.' };
  }
}

/**
 * ARRÊTER LA DETTE D'UNE FAMILLE — son POST `arreter_dette` (administrateur) :
 * l'écart entre la dette actuelle et le montant convenu est enregistré comme
 * REMISE, « les créances d'origine restent intactes, la trace demeure ».
 */
export async function arreterDetteAction(_prev: unknown, form: FormData) {
  const guardianId = String(form.get('parent_id') ?? '');
  const motif = String(form.get('motif') ?? '').trim();
  // Règle 6 : l'écart se calcule en Decimal, jamais en `number` — c'est le
  // montant de la remise qui part à l'API.
  let vers: ReturnType<typeof money>;
  try {
    vers = money(String(form.get('montant') ?? '').replace(',', '.').trim() || 'x');
  } catch {
    return { error: 'Famille ou montant invalide.' };
  }
  if (!guardianId || vers.lessThan(0)) return { error: 'Famille ou montant invalide.' };

  try {
    const d = await apiFetch<{ total: string }>(`/finance/debt/${guardianId}/all`);
    const ecart = money(d.total).minus(vers);
    if (ecart.lessThanOrEqualTo('0.005')) {
      return { error: "Le montant demandé n'est pas inférieur à la dette actuelle : rien à faire." };
    }
    await apiFetch('/finance/write-offs', {
      method: 'POST',
      json: {
        guardianId,
        reason: motif !== '' ? motif : 'Dette arrêtée depuis la réinscription',
        ...(vers.lessThanOrEqualTo('0.005') ? { clearsAll: true } : { amount: toStorage(ecart) }),
      },
    });
    revalidatePath('/re-enrol');
    revalidatePath('/finance', 'layout');
    return {
      ok:
        `Dette ramenée à ${mruMsg(toStorage(vers))} MRU. ` +
        "L'écart est enregistré comme remise ; les créances d'origine sont conservées.",
    };
  } catch (error) {
    if (error instanceof ApiError && error.status === 403) {
      return { error: 'Seul un administrateur peut modifier une dette.' };
    }
    return { error: error instanceof ApiError ? error.message : "La remise n'a pas pu être enregistrée." };
  }
}

/**
 * RÉINSCRIRE LA SÉLECTION — le POST `reinscrire` de `reinscriptions.php` : ses
 * champs (`groupe_id`, `eleves[]`), ses refus (« Choisissez la classe de
 * destination. », « Aucun élève sélectionné. »), son message « N élève(s)
 * réinscrit(s) — X bloqué(s) pour dette non autorisée, Y déjà inscrit(s) dans
 * 2026-2027, Z ajourné(s) — passage au niveau supérieur réservé à la
 * direction. », et son enchaînement : UN seul élève réinscrit → sa caisse, sur
 * l'année cible, le message porté avec (`$_SESSION['flash_reinscription']`).
 */
export async function bulkReEnrolAction(_prev: unknown, form: FormData) {
  const groupId = String(form.get('groupe_id') ?? '');
  if (!groupId) return { error: 'Choisissez la classe de destination.' };
  const studentIds = form.getAll('eleves[]').map(String).filter(Boolean);
  if (studentIds.length === 0) return { error: 'Aucun élève sélectionné.' };
  const cible = { label: String(form.get('cible_libelle') ?? ''), startYear: String(form.get('cible_annee') ?? '') };
  // École « services » (Jinan, §2) : un mode pour tout le lot, obligatoire.
  const facturation = await lireChoixFacturation(form, { avecServices: false });
  if ('error' in facturation) return { error: facturation.error };

  let r: {
    enrolled: number;
    bloques: number;
    deja: number;
    ajournes: number;
    dernier: { studentId: string; guardianId: string | null } | null;
  };
  try {
    r = await apiFetch('/enrollments/re-enrol/bulk', {
      method: 'POST',
      json: { studentIds, groupId, ...facturation.champs },
    });
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : "La réinscription a échoué, rien n'a été enregistré." };
  }
  const faits = r.enrolled;
  let message = `${faits} élève${faits > 1 ? 's' : ''} réinscrit${faits > 1 ? 's' : ''}`;
  const details: string[] = [];
  if (r.bloques) details.push(`${r.bloques} bloqué${r.bloques > 1 ? 's' : ''} pour dette non autorisée`);
  if (r.deja) details.push(`${r.deja} déjà inscrit${r.deja > 1 ? 's' : ''} dans ${cible.label}`);
  if (r.ajournes) details.push(`${r.ajournes} ajourné${r.ajournes > 1 ? 's' : ''} — passage au niveau supérieur réservé à la direction`);
  if (details.length) message += ' — ' + details.join(', ');
  message += '.';
  revalidatePath('/re-enrol/bulk');
  if (faits === 1 && r.dernier?.guardianId) {
    redirect(`/finance/${r.dernier.guardianId}?annee=${encodeURIComponent(cible.startYear)}&flash=${encodeURIComponent(message)}`);
  }
  return { ok: message };
}

/**
 * AUTORISER LA RÉINSCRIPTION MALGRÉ LA DETTE — `reinscriptions.php`, action
 * `autoriser`.
 *
 * ⚠ CE N'EST PAS UNE REMISE. Its own screen states the difference in as many
 * words: "Contrairement à l'autorisation, la remise réduit réellement la dette."
 * Authorising leaves every millime owed and lifts only the block, which is why
 * the family still shows its debt afterwards.
 */
export async function authoriseReEnrolAction(_prev: unknown, form: FormData) {
  const studentId = String(form.get('studentId') ?? '');
  if (!studentId) return { error: 'Choisissez l\u2019élève.' };

  try {
    const result = await apiFetch<{ amountOwed: string }>('/enrollments/re-enrol/authorise', {
      method: 'POST',
      json: { studentId, reason: String(form.get('reason') ?? '').trim() || undefined },
    });
    revalidatePath('/re-enrol/bulk');
    void result;
    return { ok: 'Réinscription autorisée. La décision est tracée dans le journal.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec de l\u2019autorisation.' };
  }
}

/** RETIRER L'AUTORISATION. La ligne reste : la décision, elle, est retirée. */
export async function revokeReEnrolAuthorisationAction(_prev: unknown, form: FormData) {
  try {
    await apiFetch('/enrollments/re-enrol/authorise/revoke', {
      method: 'POST',
      json: { studentId: String(form.get('studentId') ?? '') },
    });
    revalidatePath('/re-enrol/bulk');
    return { ok: 'Autorisation retirée. Le blocage pour dette s\u2019applique de nouveau.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

/**
 * LES TROIS ACTIONS DE CRÉANCE, PAR UN SEUL CHEMIN — son `envoyerDette(action,
 * champs)` et son unique `<form id="form-dette">` avec un champ `action`.
 *
 * ⚠ UN FORMULAIRE PAR OPÉRATION DONNERAIT TROIS ÉTATS, donc trois bandeaux,
 * et le plus ancien succès masquerait le plus récent : après une annulation
 * l'écran affichait encore « Dette mise à jour ». Une seule opération à la fois,
 * un seul message.
 */
export async function creanceAction(_prev: unknown, form: FormData) {
  const op = String(form.get('op') ?? '');
  if (op === 'corriger') return correctMiscDebtAction(_prev, form);
  if (op === 'annuler') return cancelMiscDebtAction(_prev, form);
  if (op === 'creer') return addFamilyDebtAction(_prev, form);
  return { error: 'Opération inconnue.' };
}

/**
 * CORRIGER UNE CRÉANCE — `dette_modifier`.
 *
 * ⚠ LE MOTIF EST OBLIGATOIRE, comme sur son écran : "Le motif est
 * obligatoire." Un solde qui a changé sans raison attachée est la ligne sur
 * laquelle un vérificateur s'arrête.
 */
export async function correctMiscDebtAction(_prev: unknown, form: FormData) {
  const remaining = String(form.get('remaining') ?? '').trim().replace(',', '.');
  const reason = String(form.get('reason') ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(remaining)) return { error: 'Montant invalide.' };
  if (reason.length < 3) return { error: 'Le motif est obligatoire.' };

  try {
    // Son `correction_motif` : « Corrigée manuellement — motif ».
    await apiFetch<{ remaining: string }>(
      `/finance/misc-debts/${String(form.get('id') ?? '')}/correct`,
      { method: 'POST', json: { remaining, reason: `Corrigée manuellement — ${reason}` } },
    );
    revalidatePath('/re-enrol');
    revalidatePath('/re-enrol/bulk');
    revalidatePath('/finance/dettes');
    return { ok: 'Dette mise à jour.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec de la correction.' };
  }
}

/**
 * ANNULER UNE CRÉANCE — `dette_annuler`, et sa raison de ne rien supprimer :
 * "Supprimer la ligne detruirait la trace comptable de ce qui avait ete reclame
 * a la famille."
 */
export async function cancelMiscDebtAction(_prev: unknown, form: FormData) {
  const reason = String(form.get('reason') ?? '').trim();
  if (reason.length < 3) return { error: 'Le motif est obligatoire.' };

  try {
    // Son `correction_motif` : « Annulée — motif ».
    await apiFetch(`/finance/misc-debts/${String(form.get('id') ?? '')}/cancel`, {
      method: 'POST',
      json: { reason: `Annulée — ${reason}` },
    });
    revalidatePath('/re-enrol');
    revalidatePath('/re-enrol/bulk');
    revalidatePath('/finance/dettes');
    return { ok: "Dette annulée. La ligne est conservée pour l'historique." };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : "Échec de l'annulation." };
  }
}

/**
 * AJOUTER UNE CRÉANCE À UNE FAMILLE — `dette_creer`, depuis l'écran de
 * réinscription : "arriere constate hors facturation : accord de rattrapage,
 * report d'une annee anterieure..."
 */
export async function addFamilyDebtAction(_prev: unknown, form: FormData) {
  const total = String(form.get('total') ?? '').trim().replace(',', '.');
  const reason = String(form.get('reason') ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(total) || Number(total) <= 0) {
    return { error: 'Le montant de la dette doit être supérieur à zéro.' };
  }
  if (reason.length < 3) return { error: 'Le motif est obligatoire.' };

  /*
   * ⚠ L'ANNÉE EST FACULTATIVE, ET C'EST DÉLIBÉRÉ. La colonne « Année » du
   * tableau des créances existe depuis la migration 0026 ; une créance reprise
   * de l'ancien système a souvent une année que personne ne connaît, et la
   * déduire d'aujourd'hui serait faux dans le cas qui compte — un arriéré de
   * 2024-2025 saisi en septembre 2026 se lirait 2026. Vide part comme absente,
   * et s'affiche « — ».
   */
  const brutAnnee = String(form.get('startYear') ?? '').trim();
  if (brutAnnee !== '' && !/^\d{4}$/.test(brutAnnee)) {
    return { error: 'Indiquez une année de début à quatre chiffres, ou laissez vide.' };
  }

  try {
    await apiFetch('/finance/misc-debts', {
      method: 'POST',
      json: {
        debtorName: String(form.get('debtorName') ?? '').trim(),
        guardianId: String(form.get('guardianId') ?? ''),
        total,
        // Son `correction_motif` : « Créée manuellement — motif ».
        reason: `Créée manuellement — ${reason}`,
        ...(brutAnnee ? { startYear: Number(brutAnnee) } : {}),
      },
    });
    revalidatePath('/re-enrol');
    revalidatePath('/re-enrol/bulk');
    revalidatePath('/finance/dettes');
    // Son `number_format($mt, 2, ',', ' ')`.
    const [entier, cents] = Number(total).toFixed(2).split('.');
    return { ok: `Dette de ${mruMsg(entier ?? '0')},${cents ?? '00'} MRU enregistrée.` };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

// ── Homework and remarks ────────────────────────────────────────────────────

/** Les cinq fichiers d'El Ourwa ; dix mégaoctets chacun depuis le 04/10/2026. */
const MAX_FICHIERS = 5;

/**
 * Son `valider_et_deplacer_upload()`, la partie qui juge : taille, type réel
 * (les octets), extension — LA règle de l'API (`@elourwa/shared/fichiers`),
 * appliquée avant d'envoyer pour que le refus se lise ici, nommé. Depuis le
 * 04/10/2026 : Word, Excel, PowerPoint, OpenDocument et RTF en plus.
 */
async function verifierFichier(fichier: File, familles?: readonly FamilleFichier[]): Promise<string | null> {
  const verdict = verifierRegleFichier(new Uint8Array(await fichier.arrayBuffer()), fichier.name, familles);
  return 'refus' in verdict ? verdict.refus : null;
}

/**
 * Les fichiers réellement choisis dans un champ `<input type="file">`.
 *
 * Son `if (empty($_FILES['fichiers']['name'][$i])) continue;` : un champ
 * laissé vide arrive quand même, comme un fichier de 0 octet — nommé « » ou
 * « blob », et, depuis que le corps traverse le middleware avec sa borne
 * relevée (04/10/2026), nommé « undefined ». Sans ce filtre, un exercice
 * SANS pièce jointe répondait « Échec des téléversements : undefined :
 * Fichier vide. » et ne partait pas.
 */
function fichiersJoints(form: FormData, champ: string): File[] {
  return form
    .getAll(champ)
    .filter((f): f is File => f instanceof File)
    .filter((f) => !(f.size === 0 && ['', 'blob', 'undefined'].includes(f.name ?? '')));
}

/**
 * ENVOYER UN EXERCICE — `pages/professeur/envoyer_exercice.php` : ses refus
 * viennent de l'API dans son ordre (« Enseignement invalide. », « Titre et
 * description obligatoires. », « Date limite invalide. ») ; validation AVANT
 * téléversement ; « Échec des téléversements : … » quand tous échouent (et
 * pas d'exercice) ; « Exercice envoyé. N parent(s) notifié(s)[ avec N
 * fichier(s) joint(s)][. ⚠ N fichier(s) rejeté(s) : …]. » — en `warning`
 * (rendu `alert-info`) si un fichier a été rejeté.
 *
 * Son ordre : l'exercice d'abord, les fichiers ensuite — chaque fichier est
 * rattaché à une ligne qui existe (son commentaire sur l'orphelin).
 */
export async function sendHomeworkAction(_prev: unknown, form: FormData) {
  const fichiers = fichiersJoints(form, 'fichiers').slice(0, MAX_FICHIERS);
  const limite = String(form.get('date_limite') ?? '').trim();
  // Ses refus, dans son ordre, servis en tête de page (plus de `required` côté
  // navigateur : un champ vide n'avalait plus l'envoi en silence).
  if (!/^[0-9a-f-]{36}$/i.test(String(form.get('enseignement_id') ?? ''))) return { error: 'Choisissez une classe.' };
  if (String(form.get('titre') ?? '').trim() === '' || String(form.get('description') ?? '').trim() === '') {
    return { error: 'Titre et description obligatoires.' };
  }
  try {
    // Son `valider_et_deplacer_upload()` avant l'insertion.
    const aTeleverser: File[] = [];
    const erreursUpload: string[] = [];
    for (const fichier of fichiers) {
      const refus = await verifierFichier(fichier);
      if (refus) erreursUpload.push(`${fichier.name} : ${refus}`);
      else aTeleverser.push(fichier);
    }
    if (fichiers.length > 0 && aTeleverser.length === 0) {
      return { error: `Échec des téléversements : ${erreursUpload.join(' ')}` };
    }

    const { id, notified } = await apiFetch<{ id: string; notified: number }>(
      `/homework/${String(form.get('enseignement_id') ?? '')}`,
      {
        method: 'POST',
        json: {
          title: String(form.get('titre') ?? '').trim(),
          body: String(form.get('description') ?? '').trim(),
          dueOn: limite || undefined,
          academicYearId: String(form.get('academicYearId') ?? '') || undefined,
        },
      },
    );

    const piecesJointes: string[] = [];
    for (const fichier of aTeleverser) {
      try {
        const corps = new FormData();
        corps.append('file', fichier, fichier.name);
        await apiFetch(`/attachments/homework/${id}`, { method: 'POST', body: corps });
        piecesJointes.push(fichier.name);
      } catch (error) {
        erreursUpload.push(`${fichier.name} : ${error instanceof ApiError ? error.message : "Erreur d'upload inconnue."}`);
      }
    }

    revalidatePath('/homework');

    let msgFinal = `Exercice envoyé. ${notified} parent(s) notifié(s)`;
    if (piecesJointes.length > 0) msgFinal += ` avec ${piecesJointes.length} fichier(s) joint(s)`;
    if (erreursUpload.length > 0) msgFinal += `. ⚠ ${erreursUpload.length} fichier(s) rejeté(s) : ${erreursUpload.join(' / ')}`;
    msgFinal += '.';
    return erreursUpload.length > 0 ? { info: msgFinal } : { ok: msgFinal };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : "Échec de l'envoi." };
  }
}

/**
 * REMARQUE — `remarques.php` : ses gravités (`info`, `positif`,
 * `avertissement`, `grave` → les nôtres, `info` à défaut), ses refus servis
 * par l'API (« Élève non autorisé. », « La remarque ne peut pas être
 * vide. »), « Remarque enregistrée et envoyée au parent. ».
 */
export async function addRemarkAction(_prev: unknown, form: FormData) {
  const gravites: Record<string, string> = { info: 'info', positif: 'positive', avertissement: 'warning', grave: 'serious' };
  try {
    await apiFetch(`/remarks/student/${String(form.get('etudiant_id') ?? '')}`, {
      method: 'POST',
      json: {
        body: String(form.get('contenu') ?? '').trim(),
        severity: gravites[String(form.get('gravite') ?? 'info')] ?? 'info',
        academicYearId: String(form.get('academicYearId') ?? '') || undefined,
      },
    });
    revalidatePath('/remarks');
    return { ok: 'Remarque enregistrée et envoyée au parent.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

/**
 * LES QUATRE ACTIONS DE `derogations.php` — `accorder`, `revoquer`,
 * `fermer_trimestre`, `rouvrir_trimestre` — avec ses phrases.
 */
export async function grantDerogationAction(_prev: unknown, form: FormData) {
  const guardianId = String(form.get('parent_id') ?? '');
  const academicYearId = String(form.get('academicYearId') ?? '');
  const tri = Number(form.get('trimestre') ?? 0);
  const motif = String(form.get('motif') ?? '').trim();
  const exp = String(form.get('expire_le') ?? '').trim();
  if (!guardianId || !academicYearId) return { error: 'Famille ou année invalide.' };
  if (motif === '') return { error: 'Le motif est obligatoire : indiquez pourquoi cette famille est autorisée.' };
  try {
    await apiFetch('/exam-access/derogations', {
      method: 'POST',
      json: {
        guardianId,
        academicYearId,
        term: tri >= 1 && tri <= 3 ? tri : undefined,
        reason: motif.slice(0, 190),
        // Son `expire_le . ' 23:59:59'`.
        expiresAt: exp ? new Date(`${exp}T23:59:59`).toISOString() : undefined,
      },
    });
    revalidatePath('/derogations');
    return { ok: 'Dérogation accordée.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : "La dérogation n'a pas pu être enregistrée." };
  }
}

export async function revokeDerogationAction(_prev: unknown, form: FormData) {
  try {
    await apiFetch(`/exam-access/derogations/${String(form.get('id') ?? '')}/revoke`, {
      method: 'POST',
      json: {},
    });
    revalidatePath('/derogations');
    return { ok: 'Dérogation révoquée : les examens redeviennent masqués.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

export async function closeTermAction(_prev: unknown, form: FormData) {
  const guardianId = String(form.get('parent_id') ?? '');
  const tri = Number(form.get('trimestre') ?? 0);
  const motif = String(form.get('motif_fermeture') ?? '').trim();
  if (!guardianId || tri < 1 || tri > 3) return { error: 'Famille ou trimestre invalide.' };
  if (motif === '') return { error: 'Le motif est obligatoire pour refermer un trimestre.' };
  try {
    await apiFetch('/exam-access/terms/close', {
      method: 'POST',
      json: { guardianId, academicYearId: String(form.get('academicYearId') ?? '') || undefined, term: tri, reason: motif },
    });
    revalidatePath('/derogations');
    return { ok: `Trimestre ${tri} refermé pour cette famille.` };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

export async function reopenTermAction(_prev: unknown, form: FormData) {
  const guardianId = String(form.get('parent_id') ?? '');
  const tri = Number(form.get('trimestre') ?? 0);
  if (!guardianId || tri < 1 || tri > 3) return { error: 'Famille ou trimestre invalide.' };
  try {
    await apiFetch('/exam-access/terms/reopen', {
      method: 'POST',
      json: { guardianId, academicYearId: String(form.get('academicYearId') ?? '') || undefined, term: tri },
    });
    revalidatePath('/derogations');
    return { ok: `Trimestre ${tri} de nouveau ouvert pour cette famille.` };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

// ── Dettes diverses ─────────────────────────────────────────────────────────

export async function createMiscDebtAction(_prev: unknown, form: FormData) {
  try {
    await apiFetch('/finance/misc-debts', {
      method: 'POST',
      json: {
        debtorName: String(form.get('debtorName') ?? '').trim(),
        phone: String(form.get('phone') ?? '').trim() || undefined,
        months: Number(form.get('months') ?? 1),
        total: String(form.get('total') ?? '').trim(),
        reason: String(form.get('reason') ?? '').trim() || undefined,
      },
    });
    revalidatePath('/finance/dettes');
    return { ok: 'Dette enregistrée.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

/**
 * REMBOURSER UNE DETTE — `dette.php`, action `rembourser` : les lignes du
 * widget des moyens, puis son `header('Location: dette.php?dette_id=…&print_recu_remb=…')`.
 */
export async function repayMiscDebtAction(_prev: unknown, form: FormData) {
  const detteId = String(form.get('id') ?? '');
  let id: string;
  try {
    const r = await apiFetch<{ id: string }>(`/finance/misc-debts/${detteId}/repay`, {
      method: 'POST',
      json: { tender: lireLignesPaiement(form) },
    });
    id = r.id;
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Erreur lors du remboursement.' };
  }
  revalidatePath('/finance/dettes');
  redirect(`/finance/dettes?dette_id=${detteId}&print_recu_remb=${id}`);
}

/**
 * RETIRER UN ÉLÈVE DE SA CLASSE — le « Supprimer » de `gestion_groupes.php`.
 *
 * ⚠ Son geste, pas sa destruction : voir `RetirerEleve` et la règle 7.
 */
export async function cancelEnrolmentAction(_prev: unknown, form: FormData) {
  try {
    await apiFetch('/enrollments/cancel', {
      method: 'POST',
      json: {
        studentId: String(form.get('studentId') ?? ''),
        academicYearId: String(form.get('academicYearId') ?? ''),
      },
    });
    revalidatePath('/scolarite/groupes');
    return { ok: 'Élève retiré de la classe.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec du retrait.' };
  }
}

/**
 * SUPPRIMER UN PROFESSEUR — le « Supprimer » de `gerer_professeurs.php`.
 *
 * ⚠ Le refus vient du SCHÉMA quand des notes en dépendent, et son message le
 * dit à l'opérateur mot pour mot. On le laisse passer tel quel.
 */
export async function deleteTeacherAction(_prev: unknown, form: FormData) {
  try {
    const r = await apiFetch<{ name?: string }>(`/teachers/${String(form.get('teacherId') ?? '')}`, { method: 'DELETE' });
    revalidatePath('/comptes/professeurs');
    const nom = r.name ?? String(form.get('nom') ?? '');
    return { ok: `Professeur « ${nom} » supprimé.` };
  } catch (error) {
    return { error: error instanceof ApiError ? `Erreur : ${error.message}` : 'Erreur : la suppression a échoué.' };
  }
}

/**
 * SUSPENDRE OU RÉOUVRIR UNE BRANCHE.
 *
 * ⚠ La console affichait « active / suspendue » depuis toujours sans qu'aucune
 * commande ne puisse changer l'état. Voir `setBranchActive` côté service.
 */
export async function setBranchActiveAction(_prev: unknown, form: FormData) {
  const active = String(form.get('active') ?? '') === 'true';
  try {
    await apiFetch(`/platform/branches/${String(form.get('branchId') ?? '')}/active`, {
      method: 'POST',
      json: { active },
    });
    revalidatePath('/platform');
    return { ok: active ? 'Branche réouverte.' : 'Branche suspendue.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

// ── Comptes du personnel — `comptes_staffs.php` ─────────────────────────────

/** Son action `modifier` : « Le prénom et le nom sont obligatoires. » / « Informations mises à jour. » */
export async function staffIdentiteAction(_prev: unknown, form: FormData) {
  const prenom = String(form.get('prenom') ?? '').trim();
  const nom = String(form.get('nom') ?? '').trim();
  if (prenom === '' || nom === '') return { error: 'Le prénom et le nom sont obligatoires.' };
  try {
    await apiFetch(`/accounts/users/${String(form.get('utilisateur_id') ?? '')}/identity`, {
      method: 'POST',
      json: {
        prenom,
        nom,
        telephone: String(form.get('telephone') ?? '').trim() || undefined,
        fonction: String(form.get('fonction') ?? '').trim() || undefined,
      },
    });
    revalidatePath('/comptes');
    return { ok: 'Informations mises à jour.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Compte introuvable ou non modifiable ici.' };
  }
}

/** Son action `roles` : « Rôles mis à jour : a, b. » */
export async function staffRolesAction(_prev: unknown, form: FormData) {
  const roles = form.getAll('roles[]').map(String).filter(Boolean);
  if (roles.length === 0) {
    return { error: 'Un compte doit garder au moins un rôle. Pour retirer tous ses accès, désactivez-le.' };
  }
  try {
    const r = await apiFetch<{ roles: string[] }>(`/accounts/users/${String(form.get('utilisateur_id') ?? '')}/roles`, {
      method: 'POST',
      json: { roles },
    });
    revalidatePath('/comptes');
    return { ok: `Rôles mis à jour : ${r.roles.join(', ')}.` };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'La modification des rôles a échoué.' };
  }
}

/** Son action `mdp` : le mot de passe provisoire, affiché une seule fois. */
export async function staffMdpAction(_prev: unknown, form: FormData) {
  try {
    const r = await apiFetch<{ temporaryPassword: string }>(
      `/accounts/users/${String(form.get('utilisateur_id') ?? '')}/reset-password`,
      { method: 'POST', json: {} },
    );
    revalidatePath('/comptes');
    return {
      ok: "Mot de passe réinitialisé. Il n'est affiché qu'une seule fois.",
      mdp: { identifiant: String(form.get('identifiant') ?? ''), mdp: r.temporaryPassword, nom: String(form.get('nom_complet') ?? '') },
    };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Compte introuvable.' };
  }
}

/** Son action `identifiant` : « Identifiant modifié. L'agent doit désormais se connecter avec « X ». » */
export async function staffIdentifiantAction(_prev: unknown, form: FormData) {
  const idf = String(form.get('identifiant') ?? '').trim();
  if (idf === '' || idf.length < 3) return { error: "L'identifiant doit faire au moins 3 caractères." };
  if (idf.length > 100) return { error: "L'identifiant est trop long (100 caractères maximum)." };
  if (!/^[A-Za-z0-9._@-]+$/.test(idf)) {
    return { error: "L'identifiant n'accepte que lettres, chiffres, point, tiret, souligné et arobase." };
  }
  try {
    await apiFetch(`/accounts/users/${String(form.get('utilisateur_id') ?? '')}/username`, {
      method: 'POST',
      json: { identifiant: idf },
    });
    revalidatePath('/comptes');
    return { ok: `Identifiant modifié. L'agent doit désormais se connecter avec « ${idf} ».` };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Compte introuvable.' };
  }
}

/** Son action `actif` : « Compte réactivé : l'agent peut se reconnecter. » / « Compte désactivé : … » */
export async function staffActifAction(_prev: unknown, form: FormData) {
  const vers = String(form.get('vers') ?? '') === '1';
  try {
    await apiFetch(`/accounts/users/${String(form.get('utilisateur_id') ?? '')}/active`, {
      method: 'POST',
      json: { active: vers },
    });
    revalidatePath('/comptes');
    return {
      ok: vers
        ? "Compte réactivé : l'agent peut se reconnecter."
        : "Compte désactivé : la connexion est refusée. L'historique est conservé.",
    };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Compte introuvable.' };
  }
}

// ── Comptes des parents — `comptes_parents.php` ──────────────────────────────

/** Son `changer_identifiant` : le téléphone, « Numéro de téléphone invalide. », « Ce numéro est déjà utilisé par un autre parent. », « Identifiant (téléphone) mis à jour. » */
export async function parentTelephoneAction(_prev: unknown, form: FormData) {
  const tel = String(form.get('nouveau_telephone') ?? '').trim();
  if (tel === '') return { error: 'Numéro de téléphone invalide.' };
  try {
    await apiFetch(`/accounts/users/${String(form.get('parent_id') ?? '')}/identifier`, {
      method: 'POST',
      json: { phone: tel },
    });
    revalidatePath('/comptes/parents');
    return { ok: 'Identifiant (téléphone) mis à jour.' };
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      return { error: 'Ce numéro est déjà utilisé par un autre parent.' };
    }
    return { error: error instanceof ApiError ? error.message : 'Numéro de téléphone invalide.' };
  }
}

/**
 * LES NUMÉROS SUPPLÉMENTAIRES D'UNE FAMILLE (0041) : ajouter, retirer. La
 * règle (numéro mauritanien, un numéro pour un seul compte) vit dans l'API.
 * Les deux pages qui portent le composant sont revalidées.
 */
export async function parentTelephoneAjouterAction(_prev: unknown, form: FormData) {
  const tel = String(form.get('telephone') ?? '').trim();
  const libelle = String(form.get('libelle') ?? '').trim();
  if (tel === '') return { error: 'Numéro de téléphone invalide.' };
  try {
    await apiFetch(`/accounts/guardians/${String(form.get('parent_id') ?? '')}/phones`, {
      method: 'POST',
      json: { phone: tel, ...(libelle ? { label: libelle } : {}) },
    });
    revalidatePath('/comptes/parents');
    revalidatePath('/finance');
    return { ok: `Numéro ${tel} ajouté : il ouvre désormais le compte de la famille.` };
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) {
      return { error: error.message || 'Ce numéro est déjà utilisé par un autre compte.' };
    }
    return { error: error instanceof ApiError ? error.message : 'Numéro de téléphone invalide.' };
  }
}

export async function parentTelephoneRetirerAction(_prev: unknown, form: FormData) {
  const tel = String(form.get('telephone') ?? '').trim();
  try {
    await apiFetch(
      `/accounts/guardians/${String(form.get('parent_id') ?? '')}/phones/${encodeURIComponent(tel)}`,
      { method: 'DELETE' },
    );
    revalidatePath('/comptes/parents');
    revalidatePath('/finance');
    return { ok: `Numéro ${tel} retiré.` };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Le numéro n’a pas pu être retiré.' };
  }
}

/** Son `reset_mdp` : le mot de passe tapé, validé par `valider_mot_de_passe()`, à changer à la prochaine connexion. */
export async function parentMdpAction(_prev: unknown, form: FormData) {
  const mdp = String(form.get('nouveau_mdp') ?? '');
  const refus = validatePassword(mdp);
  if (refus !== '') return { error: refus };
  try {
    await apiFetch(`/accounts/users/${String(form.get('parent_id') ?? '')}/reset-password`, {
      method: 'POST',
      json: { password: mdp },
    });
    revalidatePath('/comptes/parents');
    // Le mot de passe (généré ou tapé) reste lisible une fois la fenêtre fermée : c'est lui qu'on remet au parent.
    return { ok: `Mot de passe réinitialisé : ${mdp} — le parent devra le changer à la prochaine connexion.` };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec de la réinitialisation.' };
  }
}

/** Son `toggle_actif` : « Compte désactivé. » / « Compte réactivé. » */
export async function parentActifAction(_prev: unknown, form: FormData) {
  const vers = String(form.get('vers') ?? '') === '1';
  try {
    await apiFetch(`/accounts/users/${String(form.get('parent_id') ?? '')}/active`, {
      method: 'POST',
      json: { active: vers },
    });
    revalidatePath('/comptes/parents');
    return { ok: vers ? 'Compte réactivé.' : 'Compte désactivé.' };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Échec.' };
  }
}

/**
 * CRÉER UN UTILISATEUR — le POST de `creer_utilisateur.php` : ses champs, ses
 * refus dans son ordre (identifiant, mot de passe ≥ 6, rôle, nom et prénom,
 * unicité), sa fonction selon le rôle (« Super Administrateur », la fonction
 * tapée ou « Administrateur », « Collecteur d'absence », « Secrétaire »,
 * « Comptable »), ses rôles supplémentaires (jamais pour un professeur), et
 * son message « Utilisateur "Prénom Nom" créé avec succès ! ».
 */
export async function creerUtilisateurAction(_prev: unknown, form: FormData) {
  const identifiant = String(form.get('identifiant') ?? '').trim();
  const mdp = String(form.get('mot_de_passe') ?? '');
  const role = String(form.get('role') ?? '');
  const nom = String(form.get('nom') ?? '').trim();
  const prenom = String(form.get('prenom') ?? '').trim();
  const sexe = String(form.get('sexe') ?? '');
  const telephone = String(form.get('telephone') ?? '').trim();

  if (!/^[A-Za-z0-9._@-]{3,100}$/.test(identifiant)) {
    return { error: 'Identifiant invalide (3-100 caractères, lettres, chiffres, @, ., -, _).' };
  }
  if (mdp.length < 6) return { error: 'Le mot de passe doit contenir au moins 6 caractères.' };
  if (!['admin', 'professeur', 'collecteur_absence', 'secretaire', 'comptable'].includes(role)) {
    return { error: 'Rôle invalide.' };
  }
  if (nom === '' || prenom === '') return { error: 'Le nom et le prénom sont obligatoires.' };

  const palier = String(form.get('palier_admin') ?? 'restreint');
  const situation = String(form.get('situation') ?? 'permanent') === 'interim' ? 'interim' : 'permanent';
  let fonction: string | undefined;
  if (role === 'admin') {
    fonction = palier === 'complet' ? 'Super Administrateur' : (String(form.get('fonction') ?? '').trim() || 'Administrateur');
  } else if (role === 'collecteur_absence') fonction = "Collecteur d'absence";
  else if (role === 'secretaire') fonction = 'Secrétaire';
  else if (role === 'comptable') fonction = 'Comptable';

  const rolesSup = role !== 'professeur' && role !== 'admin'
    ? form.getAll('roles_sup[]').map(String).filter((r) => ['comptable', 'secretaire', 'collecteur_absence'].includes(r) && r !== role)
    : [];

  try {
    const result = await apiFetch<{ attached?: boolean }>('/accounts', {
      method: 'POST',
      json: {
        role: role === 'admin' && palier === 'complet' ? 'super_admin' : role,
        firstName: prenom,
        lastName: nom,
        sex: sexe === 'M' || sexe === 'F' ? sexe : undefined,
        username: identifiant,
        password: mdp,
        phone: telephone || undefined,
        extraRoles: rolesSup.length > 0 ? rolesSup : undefined,
        jobTitle: fonction,
        ...(role === 'professeur'
          ? {
              employment: situation,
              ...(situation === 'permanent'
                ? { salary: Number(String(form.get('salaire') ?? '0') || '0').toFixed(2) }
                : { hourlyRate: Number(String(form.get('prix_par_heure') ?? '0') || '0').toFixed(2) }),
            }
          : {}),
      },
    });
    revalidatePath('/comptes');
    if (result.attached) {
      return {
        ok:
          `Compte existant rattaché à cette école : ${prenom} ${nom} garde le mot de passe qu'il connaît ` +
          "(le mot de passe provisoire saisi n'a pas été appliqué).",
      };
    }
    return { ok: `Utilisateur "${prenom} ${nom}" créé avec succès !` };
  } catch (error) {
    return { error: error instanceof ApiError ? (error.status === 409 ? error.message : `Erreur lors de la création : ${error.message}`) : 'Erreur lors de la création.' };
  }
}
