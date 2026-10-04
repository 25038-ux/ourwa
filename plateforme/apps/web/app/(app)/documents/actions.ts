'use server';

import { revalidatePath } from 'next/cache';
import { verifierFichier } from '@elourwa/shared/fichiers';
import { apiFetch, ApiError } from '@/lib/session';

type Etat = { ok?: string; error?: string } | null;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * DÉPOSER OU REMPLACER le document signé d'une pièce (ADR-0080). Le fichier
 * est jugé ici avec LA règle de l'API (PDF ou image, 10 Mo) pour que le refus
 * se lise tout de suite, puis relayé à l'API, qui juge à nouveau.
 */
export async function deposerDocumentAction(_prev: unknown, form: FormData): Promise<Etat> {
  const eleve = String(form.get('eleve_id') ?? '');
  const annee = String(form.get('annee_id') ?? '');
  const piece = String(form.get('piece') ?? '');
  const libelle = String(form.get('libelle') ?? 'le document');
  const prenom = String(form.get('prenom') ?? '');
  if (!UUID.test(eleve) || !UUID.test(annee) || !/^[a-z_]{3,40}$/.test(piece)) return { error: 'Pièce invalide.' };
  // Un champ de fichier laissé vide arrive comme un fichier de 0 octet sans vrai nom.
  const fichier = form
    .getAll('fichier')
    .filter((f): f is File => f instanceof File)
    .find((f) => !(f.size === 0 && ['', 'blob', 'undefined'].includes(f.name ?? '')));
  if (!fichier) return { error: 'Choisissez le fichier du document signé (PDF ou photo).' };
  const verdict = verifierFichier(new Uint8Array(await fichier.arrayBuffer()), fichier.name, ['pdf', 'image']);
  if ('refus' in verdict) return { error: `${fichier.name} : ${verdict.refus}` };

  try {
    const corps = new FormData();
    corps.append('file', fichier, fichier.name);
    const r = await apiFetch<{ remplace: boolean }>(
      `/documents/eleves/${eleve}/${piece}?academicYearId=${annee}`,
      { method: 'POST', body: corps },
    );
    revalidatePath('/documents');
    return {
      ok: `${libelle}${prenom ? ` — ${prenom}` : ''} : document ${r.remplace ? 'remplacé' : 'déposé'}. La famille le voit dans l’application.`,
    };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'Le dépôt a échoué. Réessayez.' };
  }
}

/** SUPPRIMER : la pièce redevient « en attente » ; la famille ne voit plus le document. */
export async function supprimerDocumentAction(_prev: unknown, form: FormData): Promise<Etat> {
  const id = String(form.get('document_id') ?? '');
  const libelle = String(form.get('libelle') ?? 'Le document');
  if (!UUID.test(id)) return { error: 'Document invalide.' };
  try {
    await apiFetch(`/documents/${id}`, { method: 'DELETE' });
    revalidatePath('/documents');
    return { ok: `${libelle} : document supprimé.` };
  } catch (error) {
    return { error: error instanceof ApiError ? error.message : 'La suppression a échoué. Réessayez.' };
  }
}
