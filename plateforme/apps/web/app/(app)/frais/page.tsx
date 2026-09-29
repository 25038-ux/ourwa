import { requireSession } from '@/lib/session';
import { currentSchool } from '@/lib/tenant';
import { LIBELLE_FRAIS_PHOTOCOPIE } from '@/lib/brand';
import {
  anneeDesTarifs,
  COLONNES_TARIFS_NIVEAU as COLONNES,
  lireTarifs,
  montantSaisi,
  peutFixerLesTarifs,
} from '@/lib/facturation';
import { libelleService } from '@elourwa/shared/facturation';
import { PageHeader } from '@/components/page-header';
import { MessagePage } from '@/components/message-page';
import { PrixAffiche } from '@/components/prix-affiche';
import { PrixServiceCellule, TarifNiveauCellule } from '@/components/tarifs-cellules';

export const dynamic = 'force-dynamic';

const TITRE = 'Frais';
const SOUS_TITRE = 'Tarifs des niveaux et prix des services';

const STATUT: Record<string, { texte: string; classe: string }> = {
  active: { texte: 'en cours', classe: 'badge badge-success' },
  future: { texte: 'à venir', classe: 'badge badge-primary' },
  closed: { texte: 'clôturée', classe: 'badge badge-warning' },
};

/**
 * LA PAGE « FRAIS » — facturation « services » (Jinan), ADR-0073,
 * docs/specs/jinan-facturation.md §9. Sans équivalent dans El Ourwa, qui
 * facture par famille.
 *
 * Pour l'année du sélecteur de l'en-tête (défaut : l'année active) : les
 * tarifs de chaque niveau — 8h – 14h, 8h – 17h, frais d'inscription — et les
 * six prix des services. Chaque cellule s'enregistre seule (le motif de
 * « Gérer les niveaux »). Une année close se lit et ne se modifie plus.
 *
 * ⚠ UNE ÉCOLE « FAMILLE » (El Mourad, Nour, Rissala, Salam) N'A PAS CETTE PAGE :
 * elle répond 200 avec une phrase, sans appeler l'API de la facturation — jamais
 * une erreur. Direction seule (super_admin, admin) : c'est la garde de l'API
 * pour modifier (`scolarite.niveaux` + rôle), et l'entrée du menu n'est offerte
 * qu'à eux.
 */
export default async function FraisPage() {
  const { user } = await requireSession();
  const direction = user.roles.includes('super_admin') || user.roles.includes('admin');

  if (!direction) {
    return (
      <>
        <PageHeader titre={TITRE} sousTitre="Accès réservé" />
        <div className="alert alert-error">Cette page est réservée à l&apos;administration.</div>
      </>
    );
  }

  const school = await currentSchool();
  if (school?.billingModel !== 'services') {
    return (
      <>
        <PageHeader titre={TITRE} sousTitre={SOUS_TITRE} />
        <div className="alert alert-info">
          <span>
            La page « Frais » est indisponible pour cette école : elle facture par famille. Le tarif
            mensuel se règle dans <a href="/scolarite/niveaux">Gérer les niveaux</a>, les frais
            annuels dans la caisse.
          </span>
        </div>
      </>
    );
  }

  // L'année : celle que l'en-tête montre, par la même règle que lui.
  const { id: anneeId, annees } = await anneeDesTarifs();
  const { tarifs, erreur } = await lireTarifs(anneeId);

  if (!tarifs) {
    return (
      <>
        <PageHeader titre={TITRE} sousTitre={SOUS_TITRE} />
        <div className="alert alert-warning">
          <span>
            {erreur}
            {annees.length === 0 && (
              <>
                {' '}Créez-la d&apos;abord dans <a href="/annees">Années scolaires</a>.
              </>
            )}
          </span>
        </div>
      </>
    );
  }

  const { annee, niveaux, services } = tarifs;
  const modifiable = annee.modifiable && peutFixerLesTarifs(user);
  const statut = STATUT[annee.status];

  return (
    <>
      <PageHeader titre={TITRE} sousTitre={SOUS_TITRE} />
      <MessagePage>
        {!annee.modifiable && (
          <div className="alert alert-info">
            <span>
              L&apos;année <strong>{annee.label}</strong> est clôturée : ses tarifs et ses prix se
              consultent, ils ne se modifient plus.
            </span>
          </div>
        )}

        <div className="table-container">
          <div className="table-header">
            <h3>Tarifs des niveaux</h3>
            <span className="badge badge-primary">
              {niveaux.length} niveau{niveaux.length > 1 ? 'x' : ''}
            </span>
            <p className="text-muted" style={{ flexBasis: '100%', margin: 0, fontSize: '.85rem' }}>
              Le tarif mensuel dépend du mode d&apos;étude choisi à l&apos;inscription ; les frais
              d&apos;inscription se paient une fois par élève et par année. Un champ vide est « non
              défini » : l&apos;inscription dans ce mode est alors refusée. Un changement vaut pour
              les inscriptions suivantes, jamais pour un élève déjà inscrit.
            </p>
          </div>
          <div className="overflow-x">
            <table data-cartes="1">
              <thead>
                <tr>
                  <th>Niveau</th>
                  {COLONNES.map((c) => (
                    <th key={c.champ}>{c.titre}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {niveaux.map((n) => (
                  <tr key={n.id}>
                    <td data-label="Niveau">
                      <strong>{n.nom}</strong>
                    </td>
                    {COLONNES.map((c) => (
                      <td key={c.champ} data-label={c.titre}>
                        {modifiable ? (
                          <TarifNiveauCellule
                            levelId={n.id}
                            niveau={n.nom}
                            champ={c.champ}
                            libelle={c.titre}
                            valeur={montantSaisi(n[c.champ])}
                          />
                        ) : (
                          <PrixAffiche valeur={n[c.champ]} />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
                {niveaux.length === 0 && (
                  <tr>
                    <td colSpan={COLONNES.length + 1} data-message="" className="text-center text-muted">
                      Aucun niveau : créez-les dans <a href="/scolarite/niveaux">Gérer les niveaux</a>.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="table-container">
          <div className="table-header">
            <h3>Prix des services — {annee.label}</h3>
            {statut && <span className={statut.classe}>{statut.texte}</span>}
            <p className="text-muted" style={{ flexBasis: '100%', margin: 0, fontSize: '.85rem' }}>
              Le même prix pour tous les niveaux, propre à l&apos;année {annee.label}. Il est figé sur
              l&apos;abonnement de l&apos;élève quand il le prend : le changer ici ne touche aucun
              abonnement en cours. Un service « non défini » ne peut pas être souscrit.
            </p>
          </div>
          <div className="overflow-x">
            <table data-cartes="1">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Facturation</th>
                  <th>Prix</th>
                </tr>
              </thead>
              <tbody>
                {services.map((s) => {
                  const libelle = libelleService(s.code, LIBELLE_FRAIS_PHOTOCOPIE);
                  return (
                    <tr key={s.code}>
                      <td data-label="Service">
                        <strong>{libelle}</strong>
                      </td>
                      <td data-label="Facturation">{s.periodicite === 'mensuel' ? 'Chaque mois' : 'Une fois par an'}</td>
                      <td data-label="Prix">
                        {modifiable ? (
                          <PrixServiceCellule
                            academicYearId={annee.id}
                            anneeLabel={annee.label}
                            code={s.code}
                            libelle={libelle}
                            valeur={montantSaisi(s.prix)}
                          />
                        ) : (
                          <PrixAffiche valeur={s.prix} />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </MessagePage>
    </>
  );
}
