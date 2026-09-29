import { redirect } from 'next/navigation';
import { apiFetch, requireSession } from '@/lib/session';
import { anneeAffichee } from '@/lib/annee';
import { PageHeader } from '@/components/page-header';
import { DashboardCharts } from './charts';
import { ICONS } from '@/components/elourwa-icons';

export const dynamic = 'force-dynamic';

interface TableauBord {
  annee: { id: string; label: string } | null;
  totalEtudiants: number;
  totalProfesseurs: number;
  peutVoirFinance: boolean;
  revenuBrut?: string;
  chargesProfs?: string;
  chargesStaff?: string;
  depensesSup?: string;
  gainNet?: string;
  revenusNiveaux?: { name: string; revenue: string }[];
  revenusGroupes?: { name: string; revenue: string; headcount: number }[];
}

/**
 * TABLEAU DE BORD — `pages/super_admin/tableau_bord.php`, sur l'année
 * CONSULTÉE (« quand on regarde 2025-2026 le tableau de bord doit montrer
 * 2025-2026, pas les zéros de l'année à venir »).
 *
 * Les deux effectifs pour tout compte d'administration ; le revenu mensuel, le
 * gain net et les quatre graphiques pour qui peut voir la finance
 * (`est_admin_complet()`), le panneau « Bienvenue » pour les autres. Le titre
 * lui-même suit ce droit. Tous les chiffres viennent de `/reports/tableau-bord`,
 * qui reproduit ses requêtes.
 */
export default async function Dashboard() {
  const { user } = await requireSession();
  // L'administrateur de la plateforme, hors de toute école, n'a pas de tableau
  // de bord d'école : sa console.
  if (user.isPlatformAdmin && !user.schoolId) redirect('/platform');
  const year = await anneeAffichee();
  const tb = await apiFetch<TableauBord>(
    `/reports/tableau-bord${year ? `?academicYearId=${year.id}` : ''}`,
  ).catch(() => null);

  const seesFinance = tb?.peutVoirFinance ?? false;
  const gainNet = Number(tb?.gainNet ?? 0);

  return (
    <>
      <PageHeader
        titre={seesFinance ? 'Tableau de bord financier' : 'Tableau de bord'}
        sousTitre={
          seesFinance
            ? "Vue d'ensemble des finances de l'établissement"
            : "Vue d'ensemble de l'établissement"
        }
      />

      {/* KPIs */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <div className="kpi-icon" dangerouslySetInnerHTML={{ __html: ICONS.ICN_USERS! }} />
          <p className="kpi-label">Total étudiants</p>
          <p className="kpi-value">{fr(tb?.totalEtudiants ?? 0)}</p>
          <p className="kpi-detail">Inscrits — {tb?.annee?.label ?? 'toutes années'}</p>
        </div>
        <div className="kpi-card">
          <div className="kpi-icon" dangerouslySetInnerHTML={{ __html: ICONS.ICN_CAP! }} />
          <p className="kpi-label">Total professeurs</p>
          <p className="kpi-value">{fr(tb?.totalProfesseurs ?? 0)}</p>
          <p className="kpi-detail">Enseignants actifs</p>
        </div>
        {seesFinance && (
          <>
            <div className="kpi-card kpi-warning">
              <div className="kpi-icon" dangerouslySetInnerHTML={{ __html: ICONS.ICN_CASH! }} />
              <p className="kpi-label">Revenu mensuel</p>
              <p className="kpi-value">{fr(Number(tb?.revenuBrut ?? 0))}</p>
              <p className="kpi-detail">MRU / mois</p>
            </div>
            <div className={`kpi-card ${gainNet >= 0 ? 'kpi-success' : 'kpi-danger'}`}>
              <div className="kpi-icon" dangerouslySetInnerHTML={{ __html: ICONS.ICN_EXPENSE! }} />
              <p className="kpi-label">Gain net</p>
              <p className="kpi-value">{fr(gainNet)}</p>
              <p className="kpi-detail">MRU après charges</p>
            </div>
          </>
        )}
      </div>

      {seesFinance ? (
        <DashboardCharts
          byLevel={tb?.revenusNiveaux ?? []}
          byGroup={tb?.revenusGroupes ?? []}
          revenuBrut={Number(tb?.revenuBrut ?? 0)}
          chargesProfs={Number(tb?.chargesProfs ?? 0)}
          chargesStaff={Number(tb?.chargesStaff ?? 0)}
          depensesSup={Number(tb?.depensesSup ?? 0)}
          gainNet={gainNet}
        />
      ) : (
        <div className="form-card" style={{ marginTop: '1.5rem' }}>
          <h3>Bienvenue</h3>
          <p className="text-muted">
            Vous disposez d&apos;un accès administrateur complet à la gestion pédagogique
            (étudiants, groupes, niveaux, notes, absences, parents…). La gestion financière
            est réservée au Super Administrateur.
          </p>
        </div>
      )}
    </>
  );
}

/** Son `number_format($n, 0, ',', ' ')`. */
function fr(value: number): string {
  return Math.round(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
