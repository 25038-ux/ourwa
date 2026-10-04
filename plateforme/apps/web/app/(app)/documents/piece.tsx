'use client';

import { useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { acceptPour } from '@elourwa/shared/fichiers';
import { useActionMessage } from '@/components/message-page';
import { deposerDocumentAction, supprimerDocumentAction } from './actions';

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

/** Le bouton d'envoi : grisé pendant l'envoi, et rien d'autre (jamais bloqué hors envoi). */
function Envoyer({ texte, enCours, classe = 'btn btn-primary btn-sm' }: { texte: string; enCours: string; classe?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={classe} disabled={pending} aria-busy={pending}>
      {pending ? enCours : texte}
    </button>
  );
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
  const [etat, deposer] = useActionMessage(deposerDocumentAction);
  const [, supprimer] = useActionMessage(supprimerDocumentAction);
  const [choisi, setChoisi] = useState<string | null>(null);
  const [remplacer, setRemplacer] = useState(false);
  // Déposé : la pièce montre son document (React a déjà vidé le champ du formulaire).
  useEffect(() => {
    if (etat?.ok) {
      setChoisi(null);
      setRemplacer(false);
    }
  }, [etat]);
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
          <form
            action={supprimer}
            onSubmit={(e) => {
              if (!window.confirm(`Supprimer le document « ${p.libelle} » de ${prenom} ?\n\nLa famille ne le verra plus dans l'application.`)) e.preventDefault();
            }}
          >
            <input type="hidden" name="document_id" value={d.id} />
            <input type="hidden" name="libelle" value={`${p.libelle} — ${prenom}`} />
            <Envoyer texte="Supprimer" enCours="Suppression…" classe="btn btn-danger btn-sm" />
          </form>
        </div>
      )}

      {montrerDepot && (
        <form action={deposer} className="doc-piece__depot">
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
            <Envoyer texte={d ? 'Enregistrer le remplacement' : 'Déposer'} enCours="Envoi…" />
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
