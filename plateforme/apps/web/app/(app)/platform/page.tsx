import { notFound } from 'next/navigation';
import { apiFetch, requireSession } from '@/lib/session';
import { DEPLOIEMENT } from '@/lib/brand';
import { PageHeader } from '@/components/page-header';
import { Facturation, type Billing } from './facturation';
import { Empty, Metric } from '@/components/states';
import { CreateBranchForm, EnterBranchButton } from './forms';
import { SuspendreBranche } from './suspendre';

import { TableauBordPlateforme, type TableauBord } from './tableau-bord';
import { AdminsPlateforme, type AdminPlateforme } from './admins';
import { sum, toStorage } from '@elourwa/shared/money';
import { headers } from 'next/headers';
import { hoteAvecSlug } from '@/lib/brand';

export const dynamic = 'force-dynamic';

interface Branch {
  id: string;
  slug: string;
  name: string;
  name_ar: string | null;
  currency: string;
  theme_color: string;
  logo_emoji: string;
  active: boolean;
}

interface Combined {
  branches: {
    slug: string;
    name: string;
    currency: string;
    students: number;
    collected: string;
    expenses: string;
  }[];
}

export default async function PlatformPage({
  searchParams,
}: {
  searchParams: Promise<{ mois?: string; annee?: string }>;
}) {
  // Pas de console dans cette installation : la page n'existe pas.
  if (!DEPLOIEMENT.console) notFound();
  // ⚠ Sa propre garde (la mise en page et la page se rendent EN PARALLÈLE :
  // la redirection de la mise en page n'empêche pas la page de s'exécuter).
  // Une console est à l'administrateur de la plateforme, à personne d'autre.
  const { user } = await requireSession();
  if (!user.isPlatformAdmin || user.schoolId) notFound();
  const sp = await searchParams;
  const now = new Date();
  const mois = Math.min(12, Math.max(1, Number(sp.mois ?? now.getMonth() + 1) || now.getMonth() + 1));
  const annee = Number(sp.annee ?? now.getFullYear()) || now.getFullYear();
  const [tableau, admins] = await Promise.all([
    apiFetch<TableauBord>(`/platform/tableau-bord?mois=${mois}&annee=${annee}`).catch(() => null),
    apiFetch<AdminPlateforme[]>('/platform/admins').catch(() => [] as AdminPlateforme[]),
  ]);
  const [branches, combined, billing] = await Promise.all([
    apiFetch<Branch[]>('/platform/branches').catch(() => [] as Branch[]),
    apiFetch<Combined>('/platform/finance').catch(() => ({ branches: [] })),
    apiFetch<Billing>('/platform/billing').catch(
      () => ({ tariff: '500.00', branches: [], totals: { students: 0, monthly: '0.00', annual: '0.00' } }) as Billing,
    ),
  ]);

  const totalStudents = combined.branches.reduce((sum, b) => sum + b.students, 0);
  const totalCollected = toStorage(sum(combined.branches.map((b) => b.collected)));
  const entetes = await headers();
  const hoteConsole = entetes.get('x-forwarded-host') ?? entetes.get('host') ?? 'localhost:3000';

  return (
    <>
      {/**
        * ⚠ THIS CARRIED `administrateurs.php`'s TITLE — "Administrateurs /
        * Plafonds mensuels de retrait & rapports détaillés" — which belongs to
        * a different page entirely, one about withdrawal ceilings for staff.
        * Somebody arriving here read the name of a screen they were not on.
        *
        * The console is OURS: El Ourwa has one school and no console above it.
        * So it gets a name of its own rather than a borrowed one, in the same
        * chrome as everything else.
        */}
      <PageHeader
        titre="Console des branches"
        sousTitre="Au-dessus des établissements — créer une branche, suivre les effectifs et les encaissements"
      />
      <div className="form-card" style={{ marginBottom: '1.5rem' }}>
        <p className="text-muted" style={{ margin: 0, fontSize: '.88rem' }}>
          Créer une branche la met en ligne immédiatement : une seule
          application sert tous les sites, et le nom d&apos;hôte est résolu à
          chaque requête — il n&apos;y a aucune étape de déploiement.
        </p>
      </div>

      <div className="kpi-grid">
        <Metric label="Branches" value={branches.length} />
        <Metric label="Élèves, toutes branches" value={totalStudents.toLocaleString('fr-FR')} />
        <Metric
          label="Encaissé, toutes branches"
          value={Number(totalCollected).toLocaleString('fr-FR')}
          foot={combined.branches[0]?.currency ?? 'MRU'}
        />
      </div>

      {tableau && <TableauBordPlateforme tb={tableau} />}

      <Facturation billing={billing} />

      <section className="table-container" style={{ marginBottom: '1.5rem' }}>
        <div className="table-header">
          <h3>Administrateurs de la plateforme</h3>
          <span className="badge badge-primary">{admins.filter((a) => a.active).length} actif{admins.filter((a) => a.active).length > 1 ? 's' : ''}</span>
        </div>
        <div style={{ padding: 'var(--s-4)' }}>
          <p className="text-muted note">
            Un administrateur de la plateforme voit et gère toutes les branches, exactement comme vous. Ce n&apos;est pas un rôle d&apos;école.
          </p>
          <AdminsPlateforme admins={admins} />
        </div>
      </section>

      <section className="table-container">
        <div className="table-header">
          <h3>Branches</h3>
        </div>
        {branches.length === 0 ? (
          <Empty mark="🏛️" title="Aucune branche">
            Créez la première pour commencer.
          </Empty>
        ) : (
          <div className="overflow-x">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="sticky-col">Branche</th>
                  <th>Identifiant</th>
                  <th className="num">Élèves</th>
                  <th className="num">Encaissé</th>
                  <th>État</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {branches.map((b) => {
                  const figures = combined.branches.find((f) => f.slug === b.slug);
                  return (
                    <tr key={b.id}>
                      <td className="sticky-col name">
                        <span
                          className="swatch"
                          style={{ background: b.theme_color }}
                          aria-hidden="true"
                        />
                        {b.logo_emoji} {b.name}
                        {b.name_ar && (
                          <span className="text-muted micro" dir="rtl" lang="ar" style={{ marginInlineStart: 'var(--s-2)' }}>
                            {b.name_ar}
                          </span>
                        )}
                      </td>
                      <td className="text-muted micro">
                        <code>{hoteAvecSlug(hoteConsole, b.slug)}</code>
                      </td>
                      <td className="num">{figures?.students ?? '—'}</td>
                      <td className="num strong">
                        {figures ? Number(figures.collected).toLocaleString('fr-FR') : '—'}
                      </td>
                      <td>
                        <span className={`badge badge-primary ${b.active ? 'is-ok' : 'is-warn'}`}>
                          {b.active ? 'active' : 'suspendue'}
                        </span>
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap' }}>
                          <EnterBranchButton id={b.id} slug={b.slug} name={b.name} />
                          {/* ⚠ La commande que cette console affichait sans
                              l'avoir : la colonne d'à côté rend
                              « active / suspendue » depuis le début. */}
                          <SuspendreBranche branchId={b.id} nom={b.name} active={b.active} />
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="table-container">
        <div className="table-header">
          <h3>Créer une branche</h3>
          <span className="badge badge-primary">en ligne immédiatement</span>
        </div>
        <div style={{ padding: 'var(--s-4)' }}>
          <CreateBranchForm />
        </div>
      </section>

      <section className="table-container">
        <div className="table-header">
          <h3>Entrer dans une branche</h3>
          <span className="badge badge-warning">tracé</span>
        </div>
        <div style={{ padding: 'var(--s-4)' }}>
          <p className="text-muted note">
            Entrer dans une branche est limité à 30 minutes, journalisé à
            l&apos;entrée comme à la sortie, et passe par le cloisonnement normal
            — jamais par <code>BYPASSRLS</code>. Un administrateur à
            l&apos;intérieur d&apos;une école est soumis exactement aux mêmes
            règles que n&apos;importe qui d&apos;autre.
          </p>
        </div>
      </section>
    </>
  );
}
