import Link from 'next/link';
import { apiFetch, ApiError, can, requireSession } from '@/lib/session';
import { anneeAffichee } from '@/lib/annee';
import { PageHeader } from '@/components/page-header';
import { MessagePage } from '@/components/message-page';
import { PieceDocument, type PieceVue } from './piece';

export const dynamic = 'force-dynamic';

const TITRE = 'Documents';
const SOUS_TITRE = 'Les documents signés de chaque famille — inscription, photocopie et services';

interface FamilleTrouvee {
  id: string;
  nom: string;
  telephone: string | null;
  autresTelephones: string[];
  enfants: number;
}

interface FicheFamille {
  famille: { id: string; nom: string; telephone: string | null; autresTelephones: string[] };
  annee: { id: string; label: string } | null;
  enfants: {
    id: string;
    prenom: string;
    nom: string;
    matricule: string | null;
    classe: string | null;
    pieces: PieceVue[];
  }[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * DOCUMENTS — les documents signés (ADR-0080, demande de Jinan du
 * 04/10/2026). Sans équivalent chez El Ourwa.
 *
 * 1. « Search button for parents by name and number » : un formulaire GET,
 *    rendu par le serveur — aucun script à attendre, rien qui puisse rester
 *    « en cours ». Le nom du parent, celui d'un enfant, ou un numéro.
 * 2. La famille choisie : chaque enfant inscrit cette année (celle du
 *    sélecteur de l'en-tête), et pour chacun une PIÈCE par document attendu —
 *    l'inscription et la photocopie toujours, chaque service souscrit ensuite.
 *    Une pièce vide attend son document (« Déposer ») ; une pièce remplie se
 *    voit, se remplace et se supprime. La famille, elle, ne fait que lire,
 *    dans l'application.
 */
export default async function DocumentsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; famille?: string }>;
}) {
  const { user } = await requireSession();
  if (!can(user, 'documents.gerer')) {
    return (
      <>
        <PageHeader titre={TITRE} sousTitre={SOUS_TITRE} />
        <div className="alert alert-error">
          Cette page demande le droit de gérer les documents (direction ou secrétariat).
        </div>
      </>
    );
  }

  const sp = await searchParams;
  const q = (sp.q ?? '').trim().slice(0, 100);
  const familleId = sp.famille && UUID.test(sp.famille) ? sp.famille : null;
  const annee = await anneeAffichee();

  const [trouvees, fiche] = await Promise.all([
    q.length >= 2
      ? apiFetch<FamilleTrouvee[]>(`/documents/familles?q=${encodeURIComponent(q)}`).catch(() => null)
      : Promise.resolve([] as FamilleTrouvee[]),
    familleId
      ? apiFetch<FicheFamille>(`/documents/familles/${familleId}${annee ? `?academicYearId=${annee.id}` : ''}`).catch(
          (e: unknown) => (e instanceof ApiError ? e.message : 'Le serveur ne répond pas.'),
        )
      : Promise.resolve(null),
  ]);

  return (
    <>
      <PageHeader titre={TITRE} sousTitre={SOUS_TITRE} />
      <MessagePage>
        <div className="form-card doc-recherche">
          <form method="get" action="/documents" role="search">
            <label htmlFor="doc-q">Rechercher une famille</label>
            <div className="doc-recherche__ligne">
              <input
                id="doc-q"
                name="q"
                type="search"
                defaultValue={q}
                minLength={2}
                placeholder="Nom du parent, d’un enfant, ou numéro de téléphone"
                autoComplete="off"
              />
              <button type="submit" className="btn btn-primary">Rechercher</button>
            </div>
          </form>

          {q.length > 0 && q.length < 2 && <p className="text-muted">Deux caractères au moins.</p>}
          {trouvees === null && <div className="alert alert-error">La recherche est indisponible. Réessayez.</div>}
          {q.length >= 2 && trouvees && trouvees.length === 0 && (
            <p className="text-muted">Aucune famille trouvée pour « {q} ».</p>
          )}
          {trouvees && trouvees.length > 0 && (
            <ul className="doc-resultats">
              {trouvees.map((f) => (
                <li key={f.id}>
                  <Link
                    href={`/documents?famille=${f.id}&q=${encodeURIComponent(q)}`}
                    className={`doc-resultat${f.id === familleId ? ' doc-resultat--actif' : ''}`}
                  >
                    <strong>{f.nom}</strong>
                    <span className="text-muted">
                      {[f.telephone, ...f.autresTelephones].filter(Boolean).join(' · ') || 'sans téléphone'} ·{' '}
                      {f.enfants} enfant{f.enfants > 1 ? 's' : ''}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {typeof fiche === 'string' && <div className="alert alert-error">{fiche}</div>}

        {fiche && typeof fiche !== 'string' && (
          <section className="doc-famille" aria-label={`Documents de ${fiche.famille.nom}`}>
            <header className="doc-famille__tete">
              <div>
                <h2>{fiche.famille.nom}</h2>
                <p className="text-muted">
                  {[fiche.famille.telephone, ...fiche.famille.autresTelephones].filter(Boolean).join(' · ')}
                  {fiche.annee ? ` · année ${fiche.annee.label}` : ''}
                </p>
              </div>
            </header>

            {!fiche.annee && <div className="alert alert-info">Aucune année scolaire : rien à classer.</div>}
            {fiche.annee && fiche.enfants.length === 0 && (
              <div className="alert alert-info">
                Aucun enfant de cette famille n’est inscrit en {fiche.annee.label}. Changez d’année dans l’en-tête.
              </div>
            )}

            {fiche.annee &&
              fiche.enfants.map((e) => (
                <article key={e.id} className="doc-enfant">
                  <h3>
                    {e.prenom} {e.nom}
                    {e.classe && <span className="badge badge-primary">{e.classe}</span>}
                    {e.matricule && <span className="text-muted doc-enfant__matricule">{e.matricule}</span>}
                  </h3>
                  <div className="doc-pieces">
                    {e.pieces.map((p) => (
                      <PieceDocument key={p.piece} p={p} eleveId={e.id} prenom={e.prenom} anneeId={fiche.annee!.id} />
                    ))}
                  </div>
                </article>
              ))}
          </section>
        )}

        {!fiche && q.length === 0 && (
          <div className="doc-aide">
            <p>
              Cherchez une famille, ouvrez-la : chaque enfant y a une case par document signé — l’inscription et la
              photocopie toujours, puis chaque service souscrit (cantine, piscine, docteur, transport).
            </p>
            <p className="text-muted">
              PDF ou photo, 10 Mo au plus. La famille voit ces documents dans l’application, sans pouvoir les modifier.
            </p>
          </div>
        )}
      </MessagePage>
    </>
  );
}
