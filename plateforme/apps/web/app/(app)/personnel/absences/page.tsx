import { apiFetch, requireSession, can } from '@/lib/session';
import { MOIS_NOMS } from '@/lib/mois';
import { dureeLisible } from '@elourwa/shared/emploi-du-temps';
import { PageHeader } from '@/components/page-header';
import { HubNav, type HubTab } from '@/components/hub';
import { MessagePage } from '@/components/message-page';
import { DateAutoSubmit } from '../../scolarite/absence/date-auto-submit';
import {
  FeuilleAgent,
  FeuilleProfesseur,
  HorairesAgent,
  type AgentDuJour,
  type ProfesseurDuJour,
} from './feuille';

export const dynamic = 'force-dynamic';

const TITRE = 'Absences du personnel';
const SOUS_TITRE = "Professeurs et agents, d'après leur emploi du temps";

interface Journee {
  date: string;
  jour: number;
  libelleJour: string;
  annee: { id: string; label: string } | null;
  professeurs: ProfesseurDuJour[];
  agents: AgentDuJour[];
  agentsSansHoraires: { staffId: string; nom: string; fonction: string }[];
}

interface LigneSynthese {
  kind: 'teacher' | 'staff';
  personId: string;
  nom: string;
  fonction: string;
  absences: number;
  justifiees: number;
  minutes: number;
  minutesJustifiees: number;
  sansDuree: number;
}

interface Horaires {
  staffId: string;
  nom: string;
  fonction: string;
  actif: boolean;
  periodes: { jour: number; debut: string; fin: string }[];
}

function decaler(date: string, jours: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}

function dateLongue(date: string, libelleJour: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return `${libelleJour} ${d} ${MOIS_NOMS[m!]?.toLowerCase() ?? ''} ${y}`;
}

/**
 * LES ABSENCES DU PERSONNEL — ADR-0074. Sans équivalent dans El Ourwa, qui ne
 * suit que les élèves.
 *
 *   - « Journée » : pour une date, chaque professeur avec les séances que
 *     l'emploi du temps lui donne ce jour-là, chaque agent avec ses périodes
 *     de travail ; on coche ce qui a été manqué. La direction justifie.
 *   - « Synthèse du mois » : par personne, séances / périodes manquées et
 *     heures, justifiées ou non. Information pour la paie, jamais une retenue.
 *   - « Horaires des agents » : l'emploi du temps des agents, qui n'en avaient
 *     pas ; sans lui, on ne peut leur déclarer aucune absence.
 *
 * Qui : `absences.saisir` (direction, collecteur d'absence) déclare ;
 * `finance.salaires` lit ; `comptes.staff` fixe les horaires. L'API le vérifie.
 */
export default async function AbsencesPersonnelPage({
  searchParams,
}: {
  searchParams: Promise<{ vue?: string; date?: string; mois?: string; annee?: string }>;
}) {
  const params = await searchParams;
  const { user } = await requireSession();
  const peutSaisir = can(user, 'absences.saisir');
  const peutLire = peutSaisir || can(user, 'finance.salaires');
  const peutFixerHoraires = can(user, 'comptes.staff');
  const direction = user.roles.includes('super_admin') || user.roles.includes('admin');

  if (!peutLire && !peutFixerHoraires) {
    return (
      <>
        <PageHeader titre={TITRE} sousTitre={SOUS_TITRE} />
        <div className="form-card">
          <p className="text-muted">Cette page demande la permission <code>absences.saisir</code>.</p>
        </div>
      </>
    );
  }

  const vue = params.vue === 'mois' || params.vue === 'horaires' ? params.vue : peutLire ? 'jour' : 'horaires';
  const onglets: HubTab[] = [
    ...(peutLire
      ? [
          { key: 'jour', label: 'Journée', href: '/personnel/absences', ico: '📅' },
          { key: 'mois', label: 'Synthèse du mois', href: '/personnel/absences?vue=mois', ico: '📊' },
        ]
      : []),
    { key: 'horaires', label: 'Horaires des agents', href: '/personnel/absences?vue=horaires', ico: '🕘' },
  ];

  const coquille = (contenu: React.ReactNode) => (
    <>
      <PageHeader titre={TITRE} sousTitre={SOUS_TITRE} />
      <div className="hub-shell">
        <HubNav tabs={onglets} active={vue} label="Sections Absences du personnel" />
        <div className="hub-panel">
          <MessagePage>{contenu}</MessagePage>
        </div>
      </div>
    </>
  );

  // ── Horaires des agents ──────────────────────────────────────────────────
  if (vue === 'horaires') {
    const horaires = await apiFetch<Horaires[]>('/personnel/horaires').catch(() => [] as Horaires[]);
    return coquille(
      <>
        <div className="alert alert-info">
          <span>
            L&apos;emploi du temps des agents (surveillance, gardiennage, cuisine, secrétariat…) : les
            absences ne se déclarent que sur ces périodes. Les professeurs n&apos;ont rien à saisir ici — leur
            emploi du temps est celui des classes.
            {!peutFixerHoraires && ' Seul le super administrateur (comptes du personnel) modifie les horaires.'}
          </span>
        </div>
        {horaires.length === 0 ? (
          <div className="form-card">
            <p className="text-muted">Aucun agent. Ajoutez-en dans « Ajouter Staff ».</p>
          </div>
        ) : (
          horaires.map((a) => <HorairesAgent key={a.staffId} agent={a} modifiable={peutFixerHoraires} />)
        )}
      </>,
    );
  }

  // ── Synthèse du mois ─────────────────────────────────────────────────────
  if (vue === 'mois') {
    const maintenant = new Date();
    const mois = Math.min(12, Math.max(1, Number(params.mois) || maintenant.getMonth() + 1));
    const annee = Math.min(2100, Math.max(2000, Number(params.annee) || maintenant.getFullYear()));
    const { lignes } = await apiFetch<{ lignes: LigneSynthese[] }>(
      `/personnel/absences/synthese?mois=${mois}&annee=${annee}`,
    ).catch(() => ({ lignes: [] as LigneSynthese[] }));
    const prec = mois === 1 ? { m: 12, a: annee - 1 } : { m: mois - 1, a: annee };
    const suiv = mois === 12 ? { m: 1, a: annee + 1 } : { m: mois + 1, a: annee };
    const total = lignes.reduce((t, l) => t + l.minutes, 0);
    return coquille(
      <>
        <div className="form-card" style={{ display: 'flex', gap: '.75rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <a className="btn btn-sm btn-secondary" href={`/personnel/absences?vue=mois&mois=${prec.m}&annee=${prec.a}`}>← {MOIS_NOMS[prec.m]}</a>
          <strong style={{ fontSize: '1.1rem' }}>{MOIS_NOMS[mois]} {annee}</strong>
          <a className="btn btn-sm btn-secondary" href={`/personnel/absences?vue=mois&mois=${suiv.m}&annee=${suiv.a}`}>{MOIS_NOMS[suiv.m]} →</a>
        </div>
        <div className="table-container">
          <div className="table-header">
            <h3>Absences de {MOIS_NOMS[mois]?.toLowerCase()} {annee}</h3>
            <span className="badge badge-primary">{lignes.length} personne{lignes.length > 1 ? 's' : ''}</span>
            {total > 0 && <span className="badge badge-danger">{dureeLisible(total)} manquées</span>}
          </div>
          <div className="overflow-x">
            <table>
              <thead>
                <tr>
                  <th>Nom</th>
                  <th>Fonction</th>
                  <th style={{ textAlign: 'right' }}>Absences</th>
                  <th style={{ textAlign: 'right' }}>dont justifiées</th>
                  <th style={{ textAlign: 'right' }}>Heures manquées</th>
                  <th style={{ textAlign: 'right' }}>dont justifiées</th>
                  <th style={{ textAlign: 'right' }}>Non justifiées</th>
                </tr>
              </thead>
              <tbody>
                {lignes.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center text-muted" style={{ padding: '2rem' }}>
                      Aucune absence du personnel ce mois-ci.
                    </td>
                  </tr>
                ) : (
                  lignes.map((l) => (
                    <tr key={`${l.kind}-${l.personId}`}>
                      <td><strong>{l.nom}</strong></td>
                      <td>{l.fonction}</td>
                      <td style={{ textAlign: 'right' }}>
                        {l.absences} {l.kind === 'teacher' ? `séance${l.absences > 1 ? 's' : ''}` : `période${l.absences > 1 ? 's' : ''}`}
                      </td>
                      <td style={{ textAlign: 'right' }}>{l.justifiees}</td>
                      <td style={{ textAlign: 'right' }}>
                        {dureeLisible(l.minutes)}
                        {l.sansDuree > 0 && <><br /><small className="text-muted">+ {l.sansDuree} sans durée connue</small></>}
                      </td>
                      <td style={{ textAlign: 'right' }}>{dureeLisible(l.minutesJustifiees)}</td>
                      <td style={{ textAlign: 'right' }}>
                        <strong>{dureeLisible(l.minutes - l.minutesJustifiees)}</strong>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
        <p className="text-muted" style={{ fontSize: '.85rem' }}>
          Information pour la direction et la paie : aucune retenue n&apos;est calculée automatiquement. Un
          professeur tenu par la grille dans deux classes au même créneau manque deux séances, mais ses heures ne
          comptent qu&apos;une fois.
        </p>
      </>,
    );
  }

  // ── Journée ──────────────────────────────────────────────────────────────
  const aujourdhui = new Date().toISOString().slice(0, 10);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(params.date ?? '') ? params.date! : aujourdhui;
  let journee: Journee | null = null;
  let erreur: string | null = null;
  try {
    journee = await apiFetch<Journee>(`/personnel/absences/journee?date=${date}`);
  } catch (e) {
    erreur = e instanceof Error ? e.message : 'La journée est indisponible.';
  }

  return coquille(
    <>
      <form method="GET" className="form-card" style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div className="form-group" style={{ margin: 0 }}>
          <label>Date</label>
          <DateAutoSubmit name="date" defaultValue={date} />
        </div>
        <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap' }}>
          <a className="btn btn-sm btn-secondary" href={`/personnel/absences?date=${decaler(date, -1)}`}>← Veille</a>
          {date !== aujourdhui && <a className="btn btn-sm btn-secondary" href="/personnel/absences">Aujourd&apos;hui</a>}
          <a className="btn btn-sm btn-secondary" href={`/personnel/absences?date=${decaler(date, 1)}`}>Lendemain →</a>
        </div>
        {journee && (
          <p style={{ margin: 0, flexBasis: '100%' }}>
            <strong>{dateLongue(journee.date, journee.libelleJour)}</strong>
            {journee.annee && <span className="text-muted"> · emploi du temps {journee.annee.label}</span>}
          </p>
        )}
      </form>

      {erreur && <div className="alert alert-error">{erreur}</div>}

      {journee && (
        <>
          <div className="section-title-row" style={{ margin: '1.5rem 0 .6rem', justifyContent: 'flex-start' }}>
            <h3 style={{ margin: 0, fontSize: '1.25rem' }}>Professeurs</h3>
            <span className="badge badge-primary">
              {journee.professeurs.reduce((n, p) => n + p.seances.length, 0)} séance
              {journee.professeurs.reduce((n, p) => n + p.seances.length, 0) > 1 ? 's' : ''} au programme
            </span>
          </div>
          {journee.professeurs.length === 0 ? (
            <div className="form-card">
              <p className="text-muted" style={{ margin: 0 }}>
                Aucune séance le {journee.libelleJour.toLowerCase()} dans l&apos;emploi du temps
                {journee.annee ? ` de ${journee.annee.label}` : ''}.
              </p>
            </div>
          ) : (
            journee.professeurs.map((p) => (
              <FeuilleProfesseur key={p.teacherId} date={journee.date} prof={p} peutSaisir={peutSaisir} direction={direction} />
            ))
          )}

          <div className="section-title-row" style={{ margin: '1.75rem 0 .6rem', justifyContent: 'flex-start' }}>
            <h3 style={{ margin: 0, fontSize: '1.25rem' }}>Agents</h3>
            <span className="badge badge-primary">{journee.agents.length} au travail ce jour</span>
          </div>
          {journee.agentsSansHoraires.length > 0 && (
            <div className="alert alert-warning">
              <span>
                Sans horaires, donc sans absence possible :{' '}
                {journee.agentsSansHoraires.map((a) => `${a.nom} (${a.fonction})`).join(', ')}.{' '}
                <a href="/personnel/absences?vue=horaires">Fixer leurs horaires</a>.
              </span>
            </div>
          )}
          {journee.agents.length === 0 ? (
            <div className="form-card">
              <p className="text-muted" style={{ margin: 0 }}>Aucun agent ne travaille le {journee.libelleJour.toLowerCase()}.</p>
            </div>
          ) : (
            journee.agents.map((a) => (
              <FeuilleAgent key={a.staffId} date={journee.date} agent={a} peutSaisir={peutSaisir} direction={direction} />
            ))
          )}
        </>
      )}
    </>,
  );
}
