import { apiFetch, requireSession, can } from '@/lib/session';
import { anneeAffichee, anneeConsultee } from '@/lib/annee';
import { nomProfesseurAffichable } from '@/lib/professeur';
import { PageHeader } from '@/components/page-header';
import { HubNav } from '@/components/hub';
import { AutoSubmitSelect } from '@/components/auto-submit-select';
import { MessagePage } from '@/components/message-page';
import { SCOLARITE_TABS } from '../tabs';
import { Appel, type Etudiant } from './appel';
import { DateAutoSubmit } from './date-auto-submit';
import { TableauDuJour, type AppelsDuJour, type ClasseDuJour } from './tableau-du-jour';

export const dynamic = 'force-dynamic';

interface Level {
  id: string;
  name: string;
}

interface Group {
  id: string;
  name: string;
  level_id: string | null;
}

interface Creneau {
  creneau: string;
  enseignement_id: string;
  matiere_nom: string;
  prof_prenom: string | null;
  prof_nom: string | null;
}

/**
 * GÉRER L'ABSENCE — `pages/super_admin/gerer_absence.php` : niveau → groupe →
 * liste des étudiants → présent / absent / retard, chaque absence notifiée
 * aussitôt au compte parent.
 *
 * Son formulaire GET : « Niveau » (soumis au changement), « Groupe » (rendu
 * seulement quand le niveau a des groupes), « Date », et « Créneau / Matière »
 * — les cases de l'emploi du temps ce jour-là, sinon toutes les matières de
 * l'année, sinon « Aucun cours ce jour-là » en rouge et une liste inerte
 * « Pas d'emploi du temps ». Puis la feuille d'appel, ou l'une de ses deux
 * phrases. Les élèves sont ceux INSCRITS dans le groupe l'année consultée.
 *
 * ⚠ TANT QU'AUCUN GROUPE N'EST CHOISI : LES APPELS DU JOUR (demande du
 * propriétaire, 07/10/2026 — « roll call is per lesson; it should fetch the
 * emploi du temps and call each class »). À la place de sa phrase
 * « Sélectionnez un niveau puis un groupe… », toutes les classes de l'année,
 * leurs cours du jour lus dans l'emploi du temps, et pour chacun si l'appel
 * est fait ; chaque ligne ouvre la feuille ci-dessus, inchangée, sur la
 * classe, la date et le cours. Le niveau choisi restreint le tableau.
 */
export default async function AttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ niveau_id?: string; groupe_id?: string; date?: string; enseignement_id?: string }>;
}) {
  const params = await searchParams;
  const { user } = await requireSession();
  const mayTake = can(user, 'absences.saisir');

  const coquille = (contenu: React.ReactNode) => (
    <>
      <PageHeader titre="Gestion de scolarité" sousTitre="Emploi du temps, absences, groupes, niveaux, exclusions et notes" />
      <div className="hub-shell">
        <HubNav tabs={SCOLARITE_TABS} active="absence" label="Sections Scolarité" />
        <div className="hub-panel">
          <MessagePage>{contenu}</MessagePage>
        </div>
      </div>
    </>
  );

  const year = await anneeAffichee();
  if (!year) {
    return coquille(<div className="alert alert-info">Aucune année scolaire.</div>);
  }

  const niveauId = params.niveau_id ?? '';
  const groupeId = params.groupe_id ?? '';
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const dateAbs = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? '') ? params.date! : aujourdhui;
  const enseignementId = params.enseignement_id ?? '';

  const [niveaux, groupsAll] = await Promise.all([
    apiFetch<Level[]>('/levels').catch(() => [] as Level[]),
    niveauId ? apiFetch<Group[]>('/groups').catch(() => [] as Group[]) : Promise.resolve([] as Group[]),
  ]);
  const groupes = groupsAll.filter((g) => g.level_id === niveauId).sort((a, b) => a.name.localeCompare(b.name, 'fr'));

  const creneauxJour = groupeId
    ? await apiFetch<Creneau[]>(`/attendance/creneaux?groupId=${groupeId}&date=${dateAbs}&academicYearId=${year.id}`).catch(() => [] as Creneau[])
    : [];
  // Un enseignement demandé qui n'est pas du jour vaut « Général ».
  const ensRetenu = creneauxJour.some((c) => c.enseignement_id === enseignementId) ? enseignementId : '';
  // ⚠ « Pas d'emploi du temps » sous une grille pleine (démo, 23/09) : quand la
  // grille du groupe a bien des cases ce jour-là mais que leurs enseignements
  // sont d'une autre année et qu'aucune matière n'est encore affectée au groupe
  // pour l'année consultée, la page le dit — et dit quoi faire.
  const jourIso = (() => {
    const j = new Date(`${dateAbs}T00:00:00Z`).getUTCDay();
    return j === 0 ? 7 : j;
  })();
  const casesAutreAnnee =
    groupeId && creneauxJour.length === 0
      ? await apiFetch<{ day_of_week: number }[]>(`/timetable/group/${groupeId}`)
          .then((cases) => cases.some((c) => Number(c.day_of_week) === jourIso))
          .catch(() => false)
      : false;

  const feuille = groupeId
    ? await apiFetch<{ etudiants: Etudiant[] }>(
        `/attendance/appel?groupId=${groupeId}&date=${dateAbs}&academicYearId=${year.id}${ensRetenu ? `&teachingId=${ensRetenu}` : ''}`,
      ).catch(() => ({ etudiants: [] as Etudiant[] }))
    : { etudiants: [] as Etudiant[] };

  const [y, m, d] = dateAbs.split('-');

  // ── Les appels du jour, tant qu'aucun groupe n'est choisi ─────────────────
  // `null` : le tableau n'a pas pu être lu — la page le dit, elle ne le tait pas.
  const tableau = groupeId
    ? null
    : await apiFetch<AppelsDuJour>(`/attendance/jour?date=${dateAbs}&academicYearId=${year.id}`).catch(() => null);
  // L'année du sélecteur d'en-tête vit dans l'adresse (`?annee_id=`) : les
  // liens du tableau et le formulaire la gardent, sinon changer de date ou
  // ouvrir une feuille ramenait sans le dire à l'année par défaut.
  const anneeChoisie = (await anneeConsultee()) === year.id ? year.id : '';
  const adresse = (champs: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const [cle, valeur] of Object.entries(champs)) if (valeur !== '') p.set(cle, valeur);
    if (anneeChoisie) p.set('annee_id', anneeChoisie);
    return `/scolarite/absence?${p.toString()}`;
  };
  const lienFeuille = (c: ClasseDuJour, ens: string) =>
    adresse({ niveau_id: c.niveau_id ?? '', groupe_id: c.groupe_id, date: dateAbs, enseignement_id: ens });
  const lienJour = (date: string) => adresse({ niveau_id: niveauId, date });

  return coquille(
    <>
      {groupeId && (
        <p style={{ margin: '0 0 1rem' }}>
          <a href={adresse({ date: dateAbs })}>← Appels du jour (toutes les classes)</a>
        </p>
      )}
      <form method="GET" className="form-card" style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
        {anneeChoisie && <input type="hidden" name="annee_id" value={anneeChoisie} />}
        <div className="form-group">
          <label>Niveau</label>
          <AutoSubmitSelect
            name="niveau_id"
            defaultValue={niveauId}
            options={[{ value: '', label: '— Choisir —' }, ...niveaux.map((n) => ({ value: n.id, label: n.name }))]}
          />
        </div>
        {groupes.length > 0 && (
          <div className="form-group">
            <label>Groupe</label>
            <AutoSubmitSelect
              name="groupe_id"
              defaultValue={groupeId}
              options={[{ value: '', label: '— Choisir —' }, ...groupes.map((g) => ({ value: g.id, label: g.name }))]}
            />
          </div>
        )}
        <div className="form-group">
          <label>Date</label>
          <DateAutoSubmit name="date" defaultValue={dateAbs} />
        </div>
        {groupeId && creneauxJour.length > 0 ? (
          <div className="form-group">
            <label>Créneau / Matière</label>
            <AutoSubmitSelect
              name="enseignement_id"
              defaultValue={ensRetenu}
              options={[
                { value: '', label: '— Général (journée complète) —' },
                ...creneauxJour.map((cr) => {
                  const p = nomProfesseurAffichable(cr.prof_prenom, cr.prof_nom);
                  return { value: cr.enseignement_id, label: `${cr.creneau} : ${cr.matiere_nom}${p !== '' ? ` (${p})` : ''}` };
                }),
              ]}
            />
          </div>
        ) : groupeId && casesAutreAnnee ? (
          <div className="form-group" style={{ flexBasis: '100%' }}>
            <label style={{ color: 'var(--error)' }}>Les cours placés ce jour-là sont des affectations d&apos;une autre année</label>
            <div className="alert alert-warning" style={{ margin: 0 }}>
              Refaites les affectations du groupe pour l&apos;année consultée (Gérer les professeurs → enseignements), et
              l&apos;emploi du temps reparaîtra ici. En attendant, l&apos;appel se fait en « Général (journée complète) ».
            </div>
          </div>
        ) : groupeId ? (
          <div className="form-group">
            <label style={{ color: 'var(--error)' }}>Aucun cours ce jour-là</label>
            <select disabled><option>Pas d&apos;emploi du temps</option></select>
          </div>
        ) : null}
      </form>

      {groupeId && feuille.etudiants.length > 0 ? (
        <Appel
          groupeId={groupeId}
          dateAbs={dateAbs}
          dateFr={`${d}/${m}/${y}`}
          academicYearId={year.id}
          enseignementId={ensRetenu}
          etudiants={feuille.etudiants}
          readOnly={!mayTake}
        />
      ) : groupeId ? (
        <div className="alert alert-info">Aucun étudiant dans ce groupe.</div>
      ) : tableau ? (
        <TableauDuJour
          tableau={tableau}
          niveauId={niveauId}
          niveauNom={niveaux.find((n) => n.id === niveauId)?.name ?? ''}
          peutSaisir={mayTake && year.status !== 'closed'}
          cloturee={year.status === 'closed'}
          aujourdhui={aujourdhui}
          lienFeuille={lienFeuille}
          lienJour={lienJour}
        />
      ) : (
        <>
          <div className="alert alert-error">
            Le tableau des appels du jour n&apos;a pas pu être chargé. Rechargez la page ; l&apos;appel classe par classe reste possible.
          </div>
          <div className="alert alert-info">Sélectionnez un niveau puis un groupe pour faire l&apos;appel.</div>
        </>
      )}
    </>,
  );
}
