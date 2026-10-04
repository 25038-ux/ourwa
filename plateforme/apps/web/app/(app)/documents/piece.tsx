'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { acceptPour } from '@elourwa/shared/fichiers';
import { useMessagePage } from '@/components/message-page';

export interface PieceVue {
  piece: string;
  libelle: string;
  souscrit: boolean;
  document: {
    id: string;
    nom: string;
    mime: string;
    octets: number;
    deposeLe: string;
    deposePar: string | null;
  } | null;
}

const ACCEPT = acceptPour(['pdf', 'image']);

function taille(o: number): string {
  if (o < 1024) return `${o} o`;
  if (o < 1024 * 1024) return `${(o / 1024).toFixed(0)} Ko`;
  return `${(o / 1024 / 1024).toFixed(1)} Mo`;
}

function dateCourte(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/**
 * UNE PIÈCE — l'emplacement d'un document signé (ADR-0080) : « en attente »
 * avec « Déposer », ou le document avec « Voir », « Remplacer » et
 * « Supprimer ». Le résultat monte dans le message de la page.
 */
export function PieceDocument({
  p,
  eleveId,
  prenom,
  anneeId,
}: {
  p: PieceVue;
  eleveId: string;
  prenom: string;
  anneeId: string;
}) {
  const router = useRouter();
  const [choisi, setChoisi] = useState<string | null>(null);
  const [remplacer, setRemplacer] = useState(false);
  const [envoi, setEnvoi] = useState<null | 'depot' | 'suppression'>(null);
  const [resultat, setResultat] = useState<{ ok?: string; error?: string } | null>(null);
  useMessagePage(resultat);

  // Quitter la page pendant qu'un document monte l'interromprait : le navigateur le dit.
  useEffect(() => {
    if (envoi !== 'depot') return;
    const retenir = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', retenir);
    return () => window.removeEventListener('beforeunload', retenir);
  }, [envoi]);

  /**
   * Une requête ordinaire vers `/documents/envoi` (pas une action serveur) :
   * elle part tout de suite, à côté des autres, et ne bloque aucun autre
   * bouton de la page. Toujours une réponse : succès, refus, ou « pas de
   * réponse » — le bouton revient dans tous les cas.
   */
  async function envoyer(e: FormEvent<HTMLFormElement>, operation: 'depot' | 'suppression') {
    e.preventDefault();
    if (envoi) return;
    if (
      operation === 'suppression' &&
      !window.confirm(`Supprimer le document « ${p.libelle} » de ${prenom} ?\n\nLa famille ne le verra plus dans l'application.`)
    ) {
      return;
    }
    const form = new FormData(e.currentTarget);
    form.set('operation', operation === 'suppression' ? 'supprimer' : 'deposer');
    setEnvoi(operation);
    try {
      const r = await fetch('/documents/envoi', { method: 'POST', body: form, signal: AbortSignal.timeout(180_000) });
      const corps = (await r.json().catch(() => null)) as { ok?: string; error?: string } | null;
      setResultat(corps ?? { error: 'Le serveur a répondu sans message. Rechargez la page pour vérifier.' });
      if (corps?.ok) {
        setChoisi(null);
        setRemplacer(false);
        router.refresh();
      }
    } catch {
      setResultat({ error: "Le serveur n'a pas répondu. Vérifiez la connexion, rechargez la page, puis réessayez." });
    } finally {
      setEnvoi(null);
    }
  }

  const d = p.document;
  const montrerDepot = !d || remplacer;

  return (
    <div className={`doc-piece${d ? ' doc-piece--ok' : ''}`} data-testid={`piece-${p.piece}`}>
      <div className="doc-piece__tete">
        <span className="doc-piece__icone" aria-hidden="true">{d ? '✓' : '⏳'}</span>
        <div style={{ minWidth: 0 }}>
          <div className="doc-piece__titre">{p.libelle}</div>
          <div className="doc-piece__etat">
            {d ? (
              <>
                <span className="badge badge-success">Document signé</span>{' '}
                <span className="text-muted">
                  {dateCourte(d.deposeLe)} · {taille(d.octets)}
                  {d.deposePar ? ` · ${d.deposePar}` : ''}
                </span>
              </>
            ) : (
              <span className="badge badge-warning">En attente du document signé</span>
            )}
          </div>
          {d && <div className="doc-piece__nom" title={d.nom}>{d.nom}</div>}
        </div>
      </div>

      {d && !remplacer && (
        <div className="doc-piece__actions">
          <a className="btn btn-secondary btn-sm" href={`/documents/fichier/${d.id}`} target="_blank" rel="noopener">
            Voir
          </a>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRemplacer(true)}>
            Remplacer
          </button>
          <form onSubmit={(e) => envoyer(e, 'suppression')}>
            <input type="hidden" name="document_id" value={d.id} />
            <input type="hidden" name="libelle" value={`${p.libelle} — ${prenom}`} />
            <button type="submit" className="btn btn-danger btn-sm" disabled={envoi !== null} aria-busy={envoi === 'suppression'}>
              {envoi === 'suppression' ? 'Suppression…' : 'Supprimer'}
            </button>
          </form>
        </div>
      )}

      {montrerDepot && (
        <form onSubmit={(e) => envoyer(e, 'depot')} className="doc-piece__depot">
          <input type="hidden" name="eleve_id" value={eleveId} />
          <input type="hidden" name="annee_id" value={anneeId} />
          <input type="hidden" name="piece" value={p.piece} />
          <input type="hidden" name="libelle" value={p.libelle} />
          <input type="hidden" name="prenom" value={prenom} />
          <label className="doc-piece__fichier">
            <input
              type="file"
              name="fichier"
              accept={ACCEPT}
              aria-label={`Fichier signé : ${p.libelle} — ${prenom}`}
              onChange={(e) => setChoisi(e.target.files?.[0]?.name ?? null)}
            />
            <span>{choisi ?? 'Choisir le PDF ou la photo signé(e)…'}</span>
          </label>
          <div className="doc-piece__actions">
            <button type="submit" className="btn btn-primary btn-sm" disabled={envoi !== null} aria-busy={envoi === 'depot'}>
              {envoi === 'depot' ? 'Envoi…' : d ? 'Enregistrer le remplacement' : 'Déposer'}
            </button>
            {remplacer && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setRemplacer(false); setChoisi(null); }}>
                Annuler
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
