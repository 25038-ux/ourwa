import { nomProfesseurAffichable } from '@/lib/professeur';

/** L'état d'un appel : fait (et ses comptes) ou à faire — `GET /attendance/jour`. */
export interface EtatAppel {
  fait: boolean;
  presents: number;
  absents: number;
  retards: number;
  par: string | null;
  le: string | null;
  /** `AAAA-MM-JJ HH:MM`, à l'horloge de l'école. */
  le_local: string | null;
}

export interface CoursDuJour extends EtatAppel {
  rang: number;
  creneau: string;
  debut: string | null;
  fin: string | null;
  enseignement_id: string;
  matiere_nom: string;
  prof_prenom: string | null;
  prof_nom: string | null;
}

export interface ClasseDuJour {
  groupe_id: string;
  groupe_nom: string;
  niveau_id: string | null;
  niveau_nom: string | null;
  inscrits: number;
  cours: CoursDuJour[];
  journee: EtatAppel;
  hors_grille: (EtatAppel & { enseignement_id: string; matiere_nom: string | null })[];
}

export interface AppelsDuJour {
  date: string;
  annee: { id: string; label: string };
  /** Les dates que l'année possède ; la fin vaut `infinity` pour la dernière année. */
  periode: [string, string];
  hors_annee: boolean;
  grille_vide: boolean;
  total: number;
  faits: number;
  classes: ClasseDuJour[];
}

const JOURS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
/** Les colonnes — et, sur téléphone, le libellé de chaque ligne de la carte. */
const COLONNES = ['Classe', 'Créneau', 'Matière', 'Professeur', 'Appel', 'Action'] as const;

const fr = (iso: string) => {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};
const nomDuJour = (iso: string) => JOURS[new Date(`${iso}T00:00:00Z`).getUTCDay()]!;
const decaler = (iso: string, jours: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
};

/** « par Untel à 08:12 » — avec le jour quand l'appel a été saisi un autre jour. */
function saisie(e: EtatAppel, date: string): string {
  const morceaux: string[] = [];
  if (e.par) morceaux.push(`par ${e.par}`);
  if (e.le_local) {
    const [jour, heure] = e.le_local.split(' ');
    morceaux.push(jour === date ? `à ${heure}` : `le ${fr(jour!).slice(0, 5)} à ${heure}`);
  }
  return morceaux.join(' ');
}

/** La pastille et les comptes d'un appel. */
function Etat({
  etat,
  inscrits,
  date,
  aFaire,
  faitLibelle,
}: {
  etat: EtatAppel;
  inscrits: number;
  date: string;
  aFaire: string;
  faitLibelle: string;
}) {
  if (inscrits === 0) return <span className="text-muted">Aucun élève inscrit</span>;
  if (!etat.fait) return <span className="badge badge-warning">{aFaire}</span>;
  const pointes = etat.presents + etat.absents + etat.retards;
  const quand = saisie(etat, date);
  return (
    <span>
      <span className="badge badge-success">{faitLibelle}</span>{' '}
      <span>
        {etat.absents} absent(s) · {etat.retards} retard(s)
      </span>
      {pointes < inscrits && (
        <>
          {' '}
          <span className="badge badge-danger">{inscrits - pointes} élève(s) non pointé(s)</span>
        </>
      )}
      {quand !== '' && (
        <>
          {' '}
          <small className="text-muted">{quand}</small>
        </>
      )}
    </span>
  );
}

/**
 * LES APPELS DU JOUR — le tableau que le collecteur d'absence descend, classe
 * après classe, cours après cours (demande du propriétaire, 07/10/2026 :
 * « roll call is per lesson; it should fetch the emploi du temps and call each
 * class »). `gerer_absence.php` n'a pas cet écran ; il s'affiche à sa place
 * tant qu'aucun groupe n'est choisi, et chaque ligne ouvre SA feuille d'appel,
 * inchangée, sur la classe, la date et le cours.
 *
 * Un tableau PLAT — une ligne par cours, la classe en première colonne, aucune
 * cellule fusionnée : `responsive.css` en fait une carte par cours sur
 * téléphone, la classe en titre.
 */
export function TableauDuJour({
  tableau,
  niveauId,
  niveauNom,
  peutSaisir,
  cloturee,
  aujourdhui,
  lienFeuille,
  lienJour,
}: {
  tableau: AppelsDuJour;
  /** Le niveau choisi dans le formulaire : le tableau s'y restreint. */
  niveauId: string;
  niveauNom: string;
  /** Faux pour qui ne fait que consulter — et pour tous sur une année clôturée. */
  peutSaisir: boolean;
  /** Une année clôturée ne reçoit plus d'appel : l'API le refuse, le tableau le dit avant. */
  cloturee: boolean;
  aujourdhui: string;
  lienFeuille: (classe: ClasseDuJour, enseignementId: string) => string;
  lienJour: (date: string) => string;
}) {
  const { date, annee } = tableau;
  const titre = `${nomDuJour(date)} ${fr(date)}`;

  // Le bandeau : le jour, la veille et le lendemain, et — quand il y a des
  // cours — la ligne de progression. Sur téléphone il fait sa propre carte.
  const bandeau = (progression?: React.ReactNode) => (
    <div className="table-header">
      <h3>Appels du {titre}</h3>
      <div style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap' }}>
        <a className="btn btn-sm btn-secondary" href={lienJour(decaler(date, -1))}>← {nomDuJour(decaler(date, -1))} {fr(decaler(date, -1)).slice(0, 5)}</a>
        {date !== aujourdhui && <a className="btn btn-sm btn-secondary" href={lienJour(aujourdhui)}>Aujourd&apos;hui</a>}
        <a className="btn btn-sm btn-secondary" href={lienJour(decaler(date, 1))}>{nomDuJour(decaler(date, 1))} {fr(decaler(date, 1)).slice(0, 5)} →</a>
      </div>
      {progression ? <div style={{ flexBasis: '100%' }}>{progression}</div> : null}
    </div>
  );
  const bandeauSeul = (
    <div className="table-container" style={{ marginBottom: '1rem' }}>
      {bandeau()}
    </div>
  );

  if (tableau.hors_annee) {
    const [debut, fin] = tableau.periode;
    return (
      <>
        {bandeauSeul}
        <div className="alert alert-warning">
          Le {fr(date)} n&apos;appartient pas à l&apos;année scolaire {annee.label} (
          {fin === 'infinity' ? `elle commence le ${fr(debut)}` : `du ${fr(debut)} au ${fr(fin)}`}). Choisissez une date de cette
          année, ou une autre année en haut de la page.
        </div>
      </>
    );
  }

  const classes = niveauId ? tableau.classes.filter((c) => c.niveau_id === niveauId) : tableau.classes;
  const appelables = classes.filter((c) => c.inscrits > 0);
  const total = appelables.reduce((n, c) => n + c.cours.length, 0);
  const faits = appelables.reduce((n, c) => n + c.cours.filter((x) => x.fait).length, 0);
  const reste = total - faits;
  const pourcent = total > 0 ? Math.round((faits * 100) / total) : 0;

  if (classes.length === 0) {
    return (
      <>
        {bandeauSeul}
        <div className="alert alert-info">
          {niveauId && tableau.classes.length > 0
            ? `Aucune classe du niveau ${niveauNom} n'a d'élève inscrit ni de matière affectée pour l'année ${annee.label}.`
            : `Aucune classe n'a d'élève inscrit ni de matière affectée pour l'année ${annee.label}.`}
        </div>
      </>
    );
  }

  const libelleAction = (fait: boolean) => (!peutSaisir ? 'Voir la feuille' : fait ? "Revoir l'appel" : "Faire l'appel");
  const classeAction = (fait: boolean) => `btn btn-sm ${peutSaisir && !fait ? 'btn-primary' : 'btn-secondary'}`;

  const progression =
    total > 0 ? (
      <>
        <p style={{ margin: '0 0 .6rem' }}>
          {niveauId ? `Niveau ${niveauNom} — ` : ''}
          <strong>{faits}</strong> cours sur <strong>{total}</strong> appelé(s)
          {reste > 0 ? ` — il en reste ${reste}.` : ' — tous les appels du jour sont faits.'}
          {niveauId && (
            <span className="text-muted">
              {' '}
              Toute l&apos;école : {tableau.faits} sur {tableau.total}.
            </span>
          )}
        </p>
        <div
          role="progressbar"
          aria-label="Appels du jour faits"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={faits}
          style={{ height: 10, background: 'var(--border)', borderRadius: 999, overflow: 'hidden' }}
        >
          <div style={{ width: `${pourcent}%`, height: '100%', background: 'var(--success)' }} />
        </div>
      </>
    ) : null;

  return (
    <>
      {cloturee && (
        <div className="alert alert-info">
          L&apos;année {annee.label} est clôturée : ses appels se consultent, ils ne se saisissent plus.
        </div>
      )}

      {tableau.grille_vide ? (
        <div className="alert alert-warning">
          Aucun emploi du temps n&apos;est saisi pour l&apos;année {annee.label}.
          {!cloturee &&
            ' L’appel se fait en « journée complète », classe par classe ; les cours paraîtront ici dès que l’emploi du temps sera rempli (onglet « Emploi du temps »).'}
        </div>
      ) : total === 0 ? (
        <div className="alert alert-info">
          Aucun cours à l&apos;emploi du temps le {titre}
          {niveauId ? ` pour le niveau ${niveauNom}` : ''}.
          {!cloturee && ' L’appel reste possible en « journée complète », classe par classe.'}
        </div>
      ) : null}

      <div className="table-container">
        {bandeau(progression)}
        {/* `data-cartes` et `data-label` sont ceux que `components/tableaux-cartes.tsx`
            poserait : écrits ici, les cartes du téléphone n'attendent pas le script. */}
        <table className="data-table" data-cartes="1">
          <thead>
            <tr>
              {COLONNES.map((titreColonne) => (
                <th key={titreColonne}>{titreColonne}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {classes.flatMap((c) => {
              const nom = (
                <td data-label={COLONNES[0]}>
                  <strong>{c.groupe_nom}</strong>
                  {c.niveau_nom ? <small className="text-muted"> · {c.niveau_nom}</small> : null}
                </td>
              );
              const lignes: React.ReactNode[] = c.cours.map((x) => (
                <tr key={`${c.groupe_id}-${x.rang}`}>
                  {nom}
                  <td data-label={COLONNES[1]}>{x.creneau}</td>
                  <td data-label={COLONNES[2]}>{x.matiere_nom}</td>
                  <td data-label={COLONNES[3]}>{nomProfesseurAffichable(x.prof_prenom, x.prof_nom)}</td>
                  <td data-label={COLONNES[4]}>
                    <Etat etat={x} inscrits={c.inscrits} date={date} aFaire="À faire" faitLibelle="Appel fait" />
                  </td>
                  <td data-label={COLONNES[5]}>
                    {c.inscrits > 0 && (
                      <a className={classeAction(x.fait)} href={lienFeuille(c, x.enseignement_id)}>
                        {libelleAction(x.fait)}
                      </a>
                    )}
                  </td>
                </tr>
              ));
              // La journée complète : la seule feuille d'une classe sans cours
              // ce jour-là ; pour les autres, elle ne paraît que si elle a été saisie.
              if (c.cours.length === 0 || c.journee.fait) {
                lignes.push(
                  <tr key={`${c.groupe_id}-journee`}>
                    {nom}
                    <td data-label={COLONNES[1]}>Journée complète</td>
                    <td data-label={COLONNES[2]}>{c.cours.length === 0 ? 'Aucun cours à l’emploi du temps ce jour-là' : 'Général'}</td>
                    <td data-label={COLONNES[3]} />
                    <td data-label={COLONNES[4]}>
                      <Etat etat={c.journee} inscrits={c.inscrits} date={date} aFaire="Journée à appeler" faitLibelle="Journée appelée" />
                    </td>
                    <td data-label={COLONNES[5]}>
                      {c.inscrits > 0 && (
                        <a className="btn btn-sm btn-secondary" href={lienFeuille(c, '')}>
                          {!peutSaisir ? 'Voir la feuille' : c.journee.fait ? "Revoir l'appel" : 'Appel de la journée'}
                        </a>
                      )}
                    </td>
                  </tr>,
                );
              }
              // Un appel saisi sur une matière qui n'est pas à l'emploi du
              // temps du jour : visible, pour qu'aucun appel ne disparaisse.
              for (const h of c.hors_grille) {
                lignes.push(
                  <tr key={`${c.groupe_id}-hors-${h.enseignement_id}`}>
                    {nom}
                    <td data-label={COLONNES[1]}>Hors emploi du temps</td>
                    <td data-label={COLONNES[2]}>{h.matiere_nom ?? ''}</td>
                    <td data-label={COLONNES[3]} />
                    <td data-label={COLONNES[4]}>
                      <Etat etat={h} inscrits={c.inscrits} date={date} aFaire="À faire" faitLibelle="Appel fait" />
                    </td>
                    <td data-label={COLONNES[5]}>
                      {/* La feuille ne propose une matière hors grille que si la classe n'a aucun cours ce jour-là. */}
                      {c.inscrits > 0 && c.cours.length === 0 && (
                        <a className="btn btn-sm btn-secondary" href={lienFeuille(c, h.enseignement_id)}>
                          {peutSaisir ? "Revoir l'appel" : 'Voir la feuille'}
                        </a>
                      )}
                    </td>
                  </tr>,
                );
              }
              return lignes;
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
