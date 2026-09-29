import Link from 'next/link';
import { apiFetch, requireSession, can } from '@/lib/session';
import { PageHeader } from '@/components/page-header';
import { MessagePage } from '@/components/message-page';
import { NouvelleAnnee, PeriodeForm, ActiverForm, CloturerForm } from './forms';

export const dynamic = 'force-dynamic';

/**
 * `MOIS_FR` — ses douze libellés.
 *
 * ⚠ DÉFINIS ICI, PAS IMPORTÉS DE `forms.tsx`. Ce fichier-là porte `'use client'`,
 * et Next transforme ses exports en RÉFÉRENCES client : un tableau importé
 * depuis un composant serveur arrive alors vide, sans erreur — le bandeau
 * affichait « son dernier mois ( 2026) », mois manquant, année correcte.
 */
const MOIS = [
  'Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin',
  'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre',
];

interface Annee {
  id: string;
  label: string;
  start_year: number;
  start_month: number;
  end_month: number;
  status: 'active' | 'closed' | 'future';
  closed_at: string | null;
  enrolled: number;
  archived: number;
}

/**
 * ANNÉES SCOLAIRES — `pages/super_admin/annees_scolaires.php`.
 *
 * ⚠ CETTE PAGE ÉTAIT UN ONGLET DE `/settings`, ET C'EST UNE PAGE À ELLE. Elle a
 * sa propre entrée dans la barre latérale d'El Ourwa. La nôtre vivait sous un
 * titre « Configuration » qui n'existe nulle part, à côté de niveaux, groupes et
 * matières qui ont chacun leur propre écran ailleurs.
 *
 * ⚠ ET C'EST D'ICI QU'ON ATTEINT LES RÉINSCRIPTIONS. Chaque ligne d'année porte
 * un bouton « Réinscriptions » — c'est le chemin, et c'est pour cela qu'il n'y
 * en a aucun dans la barre latérale. Faute de l'avoir trouvé, j'avais accroché
 * un bouton sur « Réinscrire un étudiant », où sa page n'en met aucun.
 *
 * ⚠ SON TABLEAU MANQUAIT ENTIÈREMENT : six colonnes, dont « Inscrits » et
 * « Archivés » qui disent d'un coup d'œil si une année a été repeuplée.
 */
export default async function AnneesPage() {
  const { user } = await requireSession();

  if (!can(user, 'annees.gerer')) {
    return (
      <>
        <PageHeader titre="Années scolaires" />
        <div className="form-card"><p className="text-muted">Cette page demande la permission <code>annees.gerer</code>.</p></div>
      </>
    );
  }

  const annees = await apiFetch<Annee[]>('/academic-years/with-counts').catch(() => []);

  /*
   * ⚠ SON BANDEAU « L'ANNÉE EST TERMINÉE » MANQUAIT, et c'est le seul endroit
   * qui dit qu'il y a quelque chose à faire.
   *
   * Il paraît quand le dernier mois de l'année active est passé. Sans lui, une
   * année finie reste ouverte indéfiniment sans que rien ne le signale : les
   * inscriptions continuent de s'y faire, et personne ne pense à clôturer.
   *
   * Son texte au mot près, y compris la raison qu'il donne de ne pas clôturer
   * tout seul — « elle vide toutes les classes, je préfère que ce soit vous qui
   * la déclenchiez » — et la phrase qui rassure sur ce qui reste consultable.
   */
  const maintenant = new Date();
  const indexActuel = maintenant.getFullYear() * 12 + (maintenant.getMonth() + 1);
  const active = annees.find((a) => a.status === 'active');
  const finie =
    active &&
    // Le dernier mois tombe sur l'année civile suivante quand la période
    // enjambe janvier — octobre → juin donne juin de `start_year + 1`.
    indexActuel >
      (active.end_month >= active.start_month ? active.start_year : active.start_year + 1) * 12 +
        active.end_month
      ? active
      : null;

  return (
    <>
      {/* Elle ne pose que `$titre_page` : pas de sous-titre. */}
      <PageHeader titre="Années scolaires" />
      <MessagePage>

      {finie && (
        <div className="alert alert-warning">
          <strong>L’année {finie.label} est terminée</strong> — son dernier mois
          ({MOIS[finie.end_month - 1]}{' '}
          {finie.end_month >= finie.start_month ? finie.start_year : finie.start_year + 1}) est
          passé. La clôture n’est pas automatique : elle archive toutes les
          inscriptions et ouvre l’année suivante (vide, jusqu’aux réinscriptions),
          je préfère que ce soit vous qui la déclenchiez. Les notes, paiements et
          bulletins restent consultables en choisissant l’année.
        </div>
      )}

      <div className="form-card" style={{ marginBottom: '1.2rem' }}>
        <h3 style={{ marginTop: 0 }}>Nouvelle année scolaire</h3>
        <NouvelleAnnee />
        <p className="text-muted" style={{ fontSize: '.85rem', marginBottom: 0 }}>
          Le dernier mois tombe sur l’année civile suivante : octobre → juin donne
          2026-2027 d’octobre 2026 à juin 2027.
        </p>
      </div>

      <div className="table-container">
        <div className="table-header">
          <h3>Années</h3>
          <span className="badge badge-primary">{annees.length}</span>
        </div>
        <div className="overflow-x">
          <table>
            <thead>
              <tr>
                <th>Année</th>
                <th>Période</th>
                <th>Statut</th>
                <th>Inscrits</th>
                <th>Archivés</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {annees.map((a) => (
                <tr key={a.id} style={a.status === 'active' ? { background: 'rgba(198,113,57,.06)' } : undefined}>
                  <td>
                    <strong>{a.label}</strong>
                  </td>
                  <td>
                    {/* Ses deux sélecteurs et son « ✓ », sur la ligne même. */}
                    {/* Une année clôturée ne se modifie plus : ses mois s'affichent, ses
                        sélecteurs non — le serveur les refusait de toute façon
                        (correction faite aussi sur l'application PHP, 18/09). */}
                    {a.status === 'closed' ? (
                      <span>{MOIS[a.start_month - 1]} → {MOIS[a.end_month - 1]}</span>
                    ) : (
                      <PeriodeForm
                        anneeId={a.id}
                        startMonth={a.start_month}
                        endMonth={a.end_month}
                        figee={false}
                      />
                    )}
                  </td>
                  <td>
                    {a.status === 'active' ? (
                      <span className="badge badge-success">En cours</span>
                    ) : a.status === 'closed' ? (
                      <span className="badge" style={{ background: '#dcd3c4', color: '#374151' }}>Clôturée</span>
                    ) : (
                      <span className="badge badge-primary">À venir</span>
                    )}
                  </td>
                  <td>
                    <span className="badge badge-success">{a.enrolled}</span>
                  </td>
                  <td>
                    <span className="badge" style={{ background: '#dcd3c4', color: '#374151' }}>{a.archived}</span>
                  </td>
                  <td>
                    <div
                      style={{
                        display: 'flex',
                        gap: '.4rem',
                        flexWrap: 'wrap',
                        alignItems: 'center',
                      }}
                    >
                      {/* « Rendre active » seulement sur une année à venir : sur une
                          année clôturée le serveur refuse toujours (sa réouverture
                          « n'est pas une opération de routine »). */}
                      {a.status === 'future' ? (
                        <ActiverForm
                          anneeId={a.id}
                          libelle={a.label}
                          figee={false}
                          cloturera={active && active.start_year < a.start_year ? { libelle: active.label, inscrits: active.enrolled } : null}
                        />
                      ) : a.status === 'active' ? (
                        <CloturerForm anneeId={a.id} libelle={a.label} />
                      ) : null}
                      {/* ⚠ LE CHEMIN VERS LES RÉINSCRIPTIONS, sur chaque ligne. */}
                      <Link
                        href={`/re-enrol/bulk?annee=${a.id}`}
                        className="btn btn-sm btn-primary"
                      >
                        Réinscriptions
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Ses cinq puces, mot pour mot : une clôture est irréversible et la
          personne qui la déclenche doit savoir exactement ce qu'elle emporte. */}
      <div className="form-card" style={{ marginTop: '1.2rem' }}>
        <h3 style={{ marginTop: 0 }}>Ce que fait une clôture</h3>
        <ul style={{ margin: 0, paddingInlineStart: '1.2rem', lineHeight: 1.7 }}>
          <li>
            Toutes les inscriptions de l’année passent en <strong>archive</strong>.
          </li>
          <li>
            <strong>Les classes se vident</strong> : plus aucun élève n’est rattaché à une
            classe.
          </li>
          <li>L’année suivante devient active (elle est créée si elle n’existe pas).</li>
          <li>
            Rien n’est supprimé : notes, paiements et bulletins restent consultables en
            choisissant l’année.
          </li>
          <li>
            Pour repeupler les classes : <strong>Réinscriptions</strong>. Même un redoublant
            doit être réinscrit.
          </li>
        </ul>
      </div>
      </MessagePage>
    </>
  );
}
