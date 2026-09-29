'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch, ApiError } from '@/lib/session';
import { estModeEtude, estServiceOptionnel, libelleMode, libelleService } from '@elourwa/shared/facturation';
import { LIBELLE_FRAIS_PHOTOCOPIE } from '@/lib/brand';
import { MOIS_NOMS } from '@/lib/mois';

/**
 * LES SERVICES D'UN ÉLÈVE DEPUIS LA FICHE DU CORRESPONDANT — facturation
 * « services » (Jinan), spécification §4 et §7. Chaque geste appelle l'API,
 * qui garde les droits (souscrire : la caisse ; arrêter, exempter, changer de
 * mode, annuler un paiement : la direction) et les règles (cantine exclusive,
 * mois payé qui ne s'arrête pas…) ; ici on lit le formulaire et on rend la
 * phrase de l'API telle quelle.
 */

type Resultat = { ok?: string; error?: string };

function erreur(e: unknown, defaut: string): Resultat {
  return { error: e instanceof ApiError ? e.message : defaut };
}

const nom = (code: string) => (estServiceOptionnel(code) || code === 'inscription' ? libelleService(code as never, LIBELLE_FRAIS_PHOTOCOPIE) : code);

/** « 2026-11 » → { mois: 11, annee: 2026 } ; vide → rien (le défaut de l'API). */
function lireMois(v: FormDataEntryValue | null): { mois: number; annee: number } | null {
  const m = /^(\d{4})-(\d{1,2})$/.exec(String(v ?? '').trim());
  if (!m) return null;
  const mois = Number(m[2]);
  return mois >= 1 && mois <= 12 ? { mois, annee: Number(m[1]) } : null;
}

export async function souscrireServiceAction(_prev: unknown, form: FormData): Promise<Resultat> {
  const service = String(form.get('service') ?? '');
  if (!estServiceOptionnel(service)) return { error: 'Choisissez un service.' };
  const debut = lireMois(form.get('debut'));
  try {
    await apiFetch(`/finance/students/${String(form.get('studentId') ?? '')}/services`, {
      method: 'POST',
      json: {
        service,
        academicYearId: String(form.get('academicYearId') ?? '') || undefined,
        ...(debut ? { startMonth: debut.mois, startYear: debut.annee } : {}),
      },
    });
    revalidatePath('/finance', 'layout');
    return { ok: `${nom(service)} ajouté${debut ? ` à partir de ${MOIS_NOMS[debut.mois]} ${debut.annee}` : ''}.` };
  } catch (e) {
    return erreur(e, "Le service n'a pas pu être ajouté.");
  }
}

export async function arreterServiceAction(_prev: unknown, form: FormData): Promise<Resultat> {
  const depuis = lireMois(form.get('depuis'));
  try {
    await apiFetch(`/finance/student-services/${String(form.get('studentServiceId') ?? '')}/stop`, {
      method: 'POST',
      json: depuis ? { fromMonth: depuis.mois, fromYear: depuis.annee } : {},
    });
    revalidatePath('/finance', 'layout');
    return { ok: `${nom(String(form.get('service') ?? ''))} arrêté${depuis ? ` à partir de ${MOIS_NOMS[depuis.mois]} ${depuis.annee}` : ''}.` };
  } catch (e) {
    return erreur(e, "Le service n'a pas pu être arrêté.");
  }
}

export async function exempterServiceAction(_prev: unknown, form: FormData): Promise<Resultat> {
  const exempt = form.get('exempt') === '1';
  try {
    await apiFetch(`/finance/student-services/${String(form.get('studentServiceId') ?? '')}/exempt`, {
      method: 'POST',
      json: { exempt, reason: String(form.get('reason') ?? '').trim() || undefined },
    });
    revalidatePath('/finance', 'layout');
    const service = nom(String(form.get('service') ?? ''));
    return { ok: exempt ? `${service} : exempté.` : `${service} : exemption levée.` };
  } catch (e) {
    return erreur(e, "L'exemption n'a pas pu être enregistrée.");
  }
}

export async function changerModeAction(_prev: unknown, form: FormData): Promise<Resultat> {
  const mode = String(form.get('studyMode') ?? '');
  if (!estModeEtude(mode)) return { error: "Choisissez le mode d'étude : 8h – 14h ou 8h – 17h." };
  try {
    await apiFetch('/finance/concessions/study-mode', {
      method: 'POST',
      json: {
        studentId: String(form.get('studentId') ?? ''),
        academicYearId: String(form.get('academicYearId') ?? '') || undefined,
        studyMode: mode,
        reason: String(form.get('reason') ?? '').trim() || undefined,
      },
    });
    revalidatePath('/finance', 'layout');
    return { ok: `Mode d'étude changé : ${libelleMode(mode)}. Les mois non réglés suivent le nouveau tarif.` };
  } catch (e) {
    return erreur(e, "Le mode d'étude n'a pas pu être changé.");
  }
}

export async function annulerPaiementServiceAction(_prev: unknown, form: FormData): Promise<Resultat> {
  const reason = String(form.get('reason') ?? '').trim();
  if (reason.length < 3) return { error: "Indiquez le motif de l'annulation." };
  try {
    await apiFetch(`/finance/service-payments/${String(form.get('paymentId') ?? '')}/reverse`, {
      method: 'POST',
      json: { reason },
    });
    revalidatePath('/finance', 'layout');
    return { ok: 'Paiement du service annulé.' };
  } catch (e) {
    return erreur(e, "Échec de l'annulation.");
  }
}
