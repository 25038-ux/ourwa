import { sum, toStorage } from '@elourwa/shared/money';
import { apiFetch, requireSession, can } from '@/lib/session';
import { anneeAffichee, type Annee } from '@/lib/annee';
import { PageHeader } from '@/components/page-header';
import type { FenetreData } from '@/components/fenetre-encaissement';
import { DossierFamille, type FicheEleve } from './dossier-famille';
import { HubNav } from '@/components/hub';
import { LIBELLE_FRAIS_PHOTOCOPIE } from '@/lib/brand';
import { estEcoleServices } from '@/lib/tenant';
import { catalogueFacturation } from '@/lib/facturation';
import { financeTabsFor } from '../tabs';
import {
  CaisseProfil,
  type Enfant,
  type Frais,
  type PaiementAnnuel,
  type Remise,
} from './caisse-profil';

export const dynamic = 'force-dynamic';

interface Family {
  guardian: { id: string; full_name: string; phone: string | null; email?: string | null } | null;
  years: { id: string; label: string; start_year: number; status: string; children: number }[];
  children: { studentId: string; name: string; fee: string; free: boolean; className: string | null }[];
  monthlyTotal: string;
  freeCount: number;
  year?: { id: string; label: string; startYear: number };
}

interface DebtAll {
  tuition: { outstanding: string }[];
  misc: { outstanding: string }[];
  annualFees: { outstanding: string }[];
  /** École « services » (§6) : les échéances de service dues ; [] ou absent sinon. */
  services?: { outstanding: string }[];
  total: string;
}

interface LedgerChild extends Omit<Enfant, 'exemptFullId' | 'exemptMonthIds' | 'discountReasons'> {}

interface Concessions {
  exemptions: { id: string; kind: 'full' | 'monthly'; calendar_month: number | null; calendar_year: number | null }[];
  discounts: { calendar_month: number; calendar_year: number; amount: string; reason: string | null }[];
}

/**
 * PROFIL DE PAIEMENT — `gestion_caisse.php?parent_id=…`.
 *
 * `annee` (année civile de début) est résolue AVANT tout, comme chez lui ;
 * défaut `annee_defaut()`. Les enfants et leurs tarifs viennent de
 * l'INSCRIPTION de l'année, jamais de la fiche élève ; la dette est celle de
 * TOUTES les années (`obtenir_dette_parent_detaillee($db, $pid)` sans année).
 */
export default async function ProfilCorrespondantPage({
  params,
  searchParams,
}: {
  params: Promise<{ guardianId: string }>;
  searchParams: Promise<{ annee?: string; flash?: string }>;
}) {
  const { guardianId } = await params;
  const sp = await searchParams;
  const { user } = await requireSession();
  const comptable = user.roles.includes('comptable');
  const peutAdministrer = user.roles.includes('super_admin') || user.roles.includes('admin');

  // L'année consultée : `annee` civile de début, sinon `annee_defaut()`.
  const [annees, vue] = await Promise.all([
    apiFetch<Annee[]>('/academic-years').catch(() => [] as Annee[]),
    anneeAffichee(),
  ]);
  const demandee = /^\d{4}$/.test(sp.annee ?? '') ? Number(sp.annee) : null;
  const anneeCourante =
    demandee && demandee >= 2020 && demandee <= 2100 ? demandee : (vue?.start_year ?? new Date().getFullYear());
  const anneeObj = annees.find((a) => a.start_year === anneeCourante) ?? vue ?? null;
  const q = anneeObj ? `?academicYearId=${anneeObj.id}` : '';

  // École « services » (Jinan, §7) : la fiche montre modes et services ; le
  // catalogue de l'année sert à « Ajouter un service ». Rien pour « famille ».
  const facturationServices = await estEcoleServices();
  const [family, ledger, debt, remises, fees, paiementsAnnuels, moyens, catalogue] = await Promise.all([
    apiFetch<Family>(`/finance/family/${guardianId}${q}`),
    apiFetch<{ children: LedgerChild[] }>(`/finance/ledger/${guardianId}${q}`).catch(() => null),
    // ⚠ Une dette illisible n'est PAS une dette nulle : « 0,00 » ici faisait
    // dire au guichet « à jour » à une famille qui devait — l'erreur est montrée.
    apiFetch<DebtAll>(`/finance/debt/${guardianId}/all`).catch(() => null),
    apiFetch<Remise[]>(`/finance/write-offs/${guardianId}`).catch(() => [] as Remise[]),
    apiFetch<{ fees: Frais[] }>(`/finance/annual-fees/${guardianId}${q}`).then((r) => r.fees).catch(() => [] as Frais[]),
    apiFetch<{ payments: PaiementAnnuel[] }>(`/finance/annual-fees/${guardianId}/payments${q}`)
      .then((r) => r.payments)
      .catch(() => [] as PaiementAnnuel[]),
    apiFetch<{ id: string; name: string }[]>('/payment-methods').catch(() => []),
    facturationServices && anneeObj ? catalogueFacturation(anneeObj.id) : Promise.resolve(null),
  ]);

  // Le dossier de la famille se corrige sur place : la fiche de chaque enfant —
  // et les numéros supplémentaires de la famille (0041).
  const fiches: FicheEleve[] = [];
  let telephones: { phone: string; label: string | null }[] = [];
  if (ledger && can(user, 'scolarite.inscrire', 'scolarite.reinscrire')) {
    telephones = await apiFetch<{ phones: { phone: string; label: string | null }[] }>(`/accounts/guardians/${guardianId}/phones`)
      .then((r) => r.phones)
      .catch(() => []);
    await Promise.all(
      ledger.children.map(async (c) => {
        const f = await apiFetch<FicheEleve>(`/students/${c.studentId}/identite`).catch(() => null);
        if (f) fiches.push(f);
      }),
    );
    fiches.sort((a, b) => a.last_name.localeCompare(b.last_name, 'fr') || a.first_name.localeCompare(b.first_name, 'fr'));
  }

  // La fenêtre d'encaissement de chaque enfant de l'année affichée (0040) :
  // ses mois avec leur état, les frais annuels de la famille.
  const fenetres: Record<string, FenetreData> = {};
  if (ledger && anneeObj) {
    await Promise.all(
      ledger.children.map(async (c) => {
        const f = await apiFetch<FenetreData>(`/finance/caisse/encaissement-inscription/${c.studentId}?academicYearId=${anneeObj.id}`).catch(() => null);
        if (f) fenetres[c.studentId] = f;
      }),
    );
  }

  if (ledger === null || debt === null) {
    return (
      <>
        <PageHeader titre="Finance" sousTitre="Caisse, revenus, salaires, dettes et dépenses" />
        <div className="hub-shell">
          <HubNav tabs={financeTabsFor(user.roles)} active="caisse" label="Sections Finance" />
          <div className="hub-panel">
            <div className="alert alert-danger" role="alert">
              {ledger === null ? 'Le relevé' : 'La dette'} de {family.guardian?.full_name ?? 'ce correspondant'} n’a pas pu être lu(e) :
              le serveur n’a pas répondu. <a href="">Réessayez</a> avant d’encaisser ou de conclure que la famille est à jour.
            </div>
          </div>
        </div>
      </>
    );
  }

  // Les exemptions et réductions de chaque enfant, avec leurs identifiants.
  const concessions = new Map<string, Concessions>();
  await Promise.all(
    ledger.children.map(async (c) => {
      concessions.set(
        c.studentId,
        await apiFetch<Concessions>(`/finance/concessions/${c.studentId}`).catch(() => ({ exemptions: [], discounts: [] })),
      );
    }),
  );
  const enfants: Enfant[] = ledger.children.map((c) => {
    const cx = concessions.get(c.studentId) ?? { exemptions: [], discounts: [] };
    const exemptMonthIds: Record<string, string> = {};
    for (const x of cx.exemptions) {
      if (x.kind === 'monthly' && x.calendar_year && x.calendar_month) {
        exemptMonthIds[`${x.calendar_year}-${x.calendar_month}`] = x.id;
      }
    }
    const discountReasons: Record<string, string | null> = {};
    for (const d of cx.discounts) discountReasons[`${d.calendar_year}-${d.calendar_month}`] = d.reason;
    return {
      ...c,
      exemptFullId: cx.exemptions.find((x) => x.kind === 'full')?.id ?? null,
      exemptMonthIds,
      discountReasons,
    };
  });

  // Les années scolaires où cette famille a un enfant inscrit, plus l'année
  // ouverte et l'année consultée ; « — aucun inscrit » et « • en cours ».
  const active = annees.find((a) => a.status === 'active');
  const parAnnee = new Map<number, number>();
  for (const y of family.years) parAnnee.set(y.start_year, y.children);
  for (const y of [anneeCourante, active?.start_year ?? 0]) {
    if (y > 0 && !parAnnee.has(y)) parAnnee.set(y, 0);
  }
  const anneesPar = [...parAnnee.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([annee, nb]) => ({
      annee,
      tag: (nb === 0 ? ' — aucun inscrit' : '') + (active && annee === active.start_year ? ' • en cours' : ''),
    }));

  // Les mois de l'année scolaire consultée, avec leur année civile.
  const md = anneeObj?.start_month ?? 10;
  const mf = anneeObj?.end_month ?? 6;
  const moisPeriode: { mois: number; annee: number }[] = [];
  for (let m = md; m <= 12; m++) moisPeriode.push({ mois: m, annee: anneeCourante });
  for (let m = 1; m <= mf; m++) moisPeriode.push({ mois: m, annee: anneeCourante + 1 });

  // En décimal, jamais en nombre JS (règle 6) — arrondi une fois, à l'affichage.
  const scolarite = sum(debt.tuition.map((l) => l.outstanding));
  // Ses « Divers » : les créances des familles et les frais annuels non réglés.
  const divers = sum([...debt.misc, ...debt.annualFees].map((l) => l.outstanding));
  // École « services » : les services dus, comptés à part (compris dans le total).
  const services = sum((debt.services ?? []).map((l) => l.outstanding));

  return (
    <>
      <PageHeader titre="Finance" sousTitre="Caisse, revenus, salaires, dettes et dépenses" />
      <div className="hub-shell">
        <HubNav tabs={financeTabsFor(user.roles)} active="caisse" label="Sections Finance" />
        <div className="hub-panel">
          <CaisseProfil
            libellePhotocopie={LIBELLE_FRAIS_PHOTOCOPIE}
            flash={sp.flash ?? null}
            guardianId={guardianId}
            peutAdministrer={peutAdministrer}
            comptable={comptable}
            parent={{ full_name: family.guardian?.full_name ?? 'Correspondant', phone: family.guardian?.phone ?? null }}
            anneeCourante={anneeCourante}
            academicYearId={anneeObj?.id ?? ''}
            yearLabel={anneeObj?.label ?? ''}
            anneesPar={anneesPar}
            enfAn={family.children.map((c) => ({ id: c.studentId, nom: c.name, frais: c.fee, gratuit: c.free, classe: c.className }))}
            mensAn={family.monthlyTotal}
            nbGratuits={family.freeCount}
            dette={{
              total: debt.total,
              scolarite: toStorage(scolarite),
              divers: toStorage(divers),
              ...(facturationServices ? { services: toStorage(services) } : {}),
            }}
            facturationServices={facturationServices}
            catalogue={catalogue}
            peutEncaisser={can(user, 'finance.encaisser')}
            remises={remises}
            frais={fees}
            paiementsAnnuels={paiementsAnnuels}
            enfants={enfants}
            moisPeriode={moisPeriode}
            moyens={moyens}
            fenetres={fenetres}
            dossier={
              family.guardian ? (
                <DossierFamille
                  guardian={{ id: family.guardian.id, full_name: family.guardian.full_name, phone: family.guardian.phone, email: family.guardian.email ?? null }}
                  eleves={fiches}
                  telephones={telephones}
                  peutModifier={can(user, 'scolarite.inscrire', 'scolarite.reinscrire')}
                />
              ) : null
            }
          />
        </div>
      </div>
    </>
  );
}
