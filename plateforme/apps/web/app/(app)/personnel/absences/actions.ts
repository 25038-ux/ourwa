'use server';

import { revalidatePath } from 'next/cache';
import { apiFetch, ApiError } from '@/lib/session';

/**
 * LES ABSENCES DU PERSONNEL — les gestes de la page (ADR-0074). Chacun appelle
 * l'API, qui vérifie l'emploi du temps, les horaires et les droits ; ici on ne
 * fait que lire le formulaire et rendre sa phrase.
 */

type Resultat = { ok?: string; error?: string; info?: string };

const CHEMIN = '/personnel/absences';

function erreur(e: unknown, defaut: string): Resultat {
  return { error: e instanceof ApiError ? e.message : defaut };
}

function lireJson<T>(form: FormData, cle: string, defaut: T): T {
  try {
    return JSON.parse(String(form.get(cle) ?? '')) as T;
  } catch {
    return defaut;
  }
}

function bilan(r: { creees: number; dejaDeclarees: number }, quoi: string): Resultat {
  if (r.creees === 0) return { info: `Rien de nouveau : ${quoi} déjà déclarée${r.dejaDeclarees > 1 ? 's' : ''}.` };
  return {
    ok:
      `${r.creees} ${quoi}${r.creees > 1 ? 's' : ''} déclarée${r.creees > 1 ? 's' : ''}` +
      (r.dejaDeclarees > 0 ? ` (${r.dejaDeclarees} l'étai${r.dejaDeclarees > 1 ? 'ent' : 't'} déjà).` : '.'),
  };
}

export async function declarerProfesseurAction(_prev: unknown, form: FormData): Promise<Resultat> {
  const touteLaJournee = form.get('toute_la_journee') === '1';
  const seances = lireJson<{ slot: number; groupId: string }[]>(form, 'seances', []);
  if (!touteLaJournee && seances.length === 0) return { error: 'Cochez au moins une séance.' };
  try {
    const r = await apiFetch<{ creees: number; dejaDeclarees: number }>('/personnel/absences/professeur', {
      method: 'POST',
      json: {
        date: String(form.get('date') ?? ''),
        teacherId: String(form.get('teacherId') ?? ''),
        ...(touteLaJournee ? { touteLaJournee: true } : { seances }),
        reason: String(form.get('motif') ?? '').trim() || null,
      },
    });
    revalidatePath(CHEMIN);
    return bilan(r, 'séance manquée');
  } catch (e) {
    return erreur(e, "L'absence n'a pas pu être enregistrée.");
  }
}

export async function declarerAgentAction(_prev: unknown, form: FormData): Promise<Resultat> {
  const touteLaJournee = form.get('toute_la_journee') === '1';
  const debut = String(form.get('debut') ?? '').trim();
  const fin = String(form.get('fin') ?? '').trim();
  try {
    const r = await apiFetch<{ creees: number; dejaDeclarees: number }>('/personnel/absences/agent', {
      method: 'POST',
      json: {
        date: String(form.get('date') ?? ''),
        staffId: String(form.get('staffId') ?? ''),
        ...(touteLaJournee
          ? { touteLaJournee: true }
          : {
              periodes: [
                {
                  workHoursId: String(form.get('workHoursId') ?? ''),
                  ...(debut ? { debut } : {}),
                  ...(fin ? { fin } : {}),
                },
              ],
            }),
        reason: String(form.get('motif') ?? '').trim() || null,
      },
    });
    revalidatePath(CHEMIN);
    return bilan(r, 'période manquée');
  } catch (e) {
    return erreur(e, "L'absence n'a pas pu être enregistrée.");
  }
}

export async function justifierAbsenceAction(_prev: unknown, form: FormData): Promise<Resultat> {
  const justified = form.get('justified') === '1';
  try {
    await apiFetch(`/personnel/absences/${String(form.get('id') ?? '')}/justifier`, {
      method: 'POST',
      json: { justified, ...(form.has('motif') ? { reason: String(form.get('motif') ?? '').trim() || null } : {}) },
    });
    revalidatePath(CHEMIN);
    return { ok: justified ? 'Absence justifiée.' : 'Justification retirée.' };
  } catch (e) {
    return erreur(e, "La justification n'a pas pu être enregistrée.");
  }
}

export async function retirerAbsenceAction(_prev: unknown, form: FormData): Promise<Resultat> {
  try {
    await apiFetch(`/personnel/absences/${String(form.get('id') ?? '')}`, { method: 'DELETE' });
    revalidatePath(CHEMIN);
    return { ok: 'Absence retirée.' };
  } catch (e) {
    return erreur(e, "L'absence n'a pas pu être retirée.");
  }
}

export async function definirHorairesAction(_prev: unknown, form: FormData): Promise<Resultat> {
  const periodes = lireJson<{ jour: number; debut: string; fin: string }[]>(form, 'periodes', []);
  try {
    await apiFetch(`/personnel/horaires/${String(form.get('staffId') ?? '')}`, {
      method: 'PUT',
      json: { periodes },
    });
    revalidatePath(CHEMIN);
    return { ok: `Horaires enregistrés (${periodes.length} période${periodes.length > 1 ? 's' : ''}).` };
  } catch (e) {
    return erreur(e, "Les horaires n'ont pas pu être enregistrés.");
  }
}
