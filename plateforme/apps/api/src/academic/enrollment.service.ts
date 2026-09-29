import {
  BadRequestException,
  forwardRef,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { firstOwedMonthOrder, type Queryable } from '@elourwa/db';
import { money, toStorage, type ModeEtude, type ServiceOptionnel } from '@elourwa/shared';
import { DbService } from '../db/db.service.js';
import { NotificationsService } from '../parent/notifications.service.js';
import { AuditService } from '../audit/audit.service.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { AcademicYearService, type AcademicYear } from './academic-year.service.js';
import { DebtService } from '../finance/debt.service.js';
import { BillingModelService } from '../finance/billing-model.service.js';
import { FAMILLE_REFUS, TarifsService, type PlanInscription } from '../finance/tarifs.service.js';
import {
  StudentServicesService,
  type AbonnementCree,
} from '../finance/student-services.service.js';

export interface EnrolInput {
  studentId: string;
  academicYearId: string;
  groupId: string;
  /** Omit to take the level's rate. Supplying it IS the negotiated fee. */
  monthlyFee?: string;
  isFree?: boolean;
  /** Real entry into this year. Drives the rule of the 25th. */
  entryDate?: string;
  enrolmentFee?: string;
  documentFee?: string;
  suppliesFee?: string;
  /**
   * École « services » (ADR-0073) : OBLIGATOIRE — le tarif du niveau pour ce
   * mode devient `full_rate`. Refusé dans une école « famille ».
   */
  studyMode?: ModeEtude;
  /**
   * École « services » : les services cochés, souscrits dans la MÊME
   * transaction que l'inscription. `inscription` n'y figure pas : elle est
   * ajoutée d'office. Refusé dans une école « famille ».
   */
  services?: ServiceOptionnel[];
}

const CYCLE_ORDER: Record<string, number> = {
  fondamental: 1,
  college: 2,
  lycee: 3,
  autre: 9,
};

@Injectable()
export class EnrollmentService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AcademicYearService) private readonly years: AcademicYearService,
    @Inject(AuditService) private readonly audit: AuditService,
    /**
     * ⚠ The debt gate needs the same figure the till shows. Recomputing it here
     * would let the two drift, and a family refused re-enrolment over a number
     * the caisse does not recognise is an argument nobody can settle.
     */
    @Inject(forwardRef(() => DebtService)) private readonly debts: DebtService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(BillingModelService) private readonly billing: BillingModelService,
    @Inject(TarifsService) private readonly tarifs: TarifsService,
    @Inject(StudentServicesService) private readonly abonnements: StudentServicesService,
  ) {}

  /**
   * LA FACTURATION D'UNE INSCRIPTION, VÉRIFIÉE AVANT TOUTE ÉCRITURE (ADR-0073).
   *
   * École « famille » : rien à vérifier — sauf qu'un mode ou un service n'y a
   * pas sa place (refus), et `null`. École « services » : le mode, le tarif du
   * mode, les frais d'inscription du niveau, le prix de chaque service coché —
   * le plan que l'inscription figera, ou le refus qui dit quoi poser.
   *
   * L'admission l'appelle AVANT de créer l'élève (sa transaction est distincte
   * de celle de l'inscription) ; la réinscription en lot, une fois pour tout le
   * lot. `enrol` refait la même vérification pour lui-même.
   */
  async verifierFacturation(input: {
    academicYearId: string;
    groupId: string;
    studyMode?: string | null;
    services?: readonly string[];
  }): Promise<PlanInscription | null> {
    if ((await this.billing.current()) === 'famille') {
      if (input.studyMode != null || (input.services?.length ?? 0) > 0) {
        throw new BadRequestException(FAMILLE_REFUS);
      }
      return null;
    }
    const year = await this.years.byId(input.academicYearId);
    const group = await this.db.query(async (tx) => {
      const { rows } = await tx.query<{ name: string; level_id: string | null }>(
        'SELECT name, level_id FROM groups WHERE id = $1',
        [input.groupId],
      );
      return rows[0];
    });
    if (!group) throw new NotFoundException('Groupe introuvable.');
    return this.tarifs.planInscription({
      year,
      group,
      studyMode: input.studyMode,
      services: input.services,
    });
  }

  /**
   * ⚠ PROGRESSION RULE — a held-back student does not move up a level.
   *
   * The end-of-year decision is carried by the enrolment of the year that ended.
   * Making a student repeat or pass is the direction's call, not the cash desk's:
   * an accountant or secretary cannot enrol a held-back student into a level
   * above their own.
   *
   * Cycle outranks `sort_order` — fondamental → collège is a promotion even
   * though the ordering restarts within each cycle.
   *
   * @returns a refusal reason, or null when the move is permitted
   */
  async refuseProgression(
    studentId: string,
    targetYear: AcademicYear,
    targetLevelId: string | null,
    permissions: string[],
  ): Promise<string | null> {
    if (!targetLevelId) return null;
    // The administration can decide on an exceptional promotion.
    if (permissions.includes('scolarite.niveaux')) return null;

    return this.db.query(async (tx) => {
      const { rows: prevRows } = await tx.query<{
        outcome: string;
        sort_order: number | null;
        cycle: string | null;
        name: string | null;
      }>(
        `SELECT e.outcome, l.sort_order, l.cycle, l.name
           FROM enrollments e
           LEFT JOIN levels l ON l.id = e.level_id
           JOIN academic_years y ON y.id = e.academic_year_id
          WHERE e.student_id = $1 AND y.start_year < $2 AND e.status <> 'cancelled'
          ORDER BY y.start_year DESC LIMIT 1`,
        [studentId, targetYear.start_year],
      );
      const previous = prevRows[0];
      if (!previous || previous.outcome !== 'held_back') return null;

      const { rows: targetRows } = await tx.query<{
        sort_order: number;
        cycle: string;
        name: string;
      }>('SELECT sort_order, cycle, name FROM levels WHERE id = $1', [targetLevelId]);
      const target = targetRows[0];
      if (!target || previous.sort_order === null) return null;

      const previousCycle = CYCLE_ORDER[previous.cycle ?? 'autre'] ?? 9;
      const targetCycle = CYCLE_ORDER[target.cycle] ?? 9;
      const movingUp =
        targetCycle > previousCycle ||
        (targetCycle === previousCycle && target.sort_order > previous.sort_order);

      if (!movingUp) return null;

      // ⚠ EN FRANÇAIS : ce refus est lu par le comptable, pas par nous. La page
      // de réinscription le récite tel quel dans sa liste des élèves écartés,
      // et sa formule à elle est « passage au niveau supérieur réservé à la
      // direction ».
      return (
        `Élève ajourné en ${previous.name ?? 'son niveau précédent'} : ` +
        `le passage en ${target.name} est réservé à la direction.`
      );
    });
  }

  /**
   * Enrol a student into a year, and build their month schedule.
   *
   * Idempotent: re-running restores the enrolment and fills missing months
   * without duplicating or overwriting one already invoiced.
   */
  async enrol(
    input: EnrolInput,
    actorId: string,
    permissions: string[],
    /**
     * ⚠ LES RÔLES, PAS SEULEMENT LES PERMISSIONS. `scolarite.inscrire` est
     * détenue par le comptable et la secrétaire ; ce qu'une famille PAIERA
     * n'est pas leur décision. El Ourwa branche sur le rôle
     * (`est_comptable() || est_secretaire()`), pas sur la permission.
     */
    roles: string[] = [],
  ) {
    const { schoolId } = currentTenant();
    const year = await this.years.assertWritable(input.academicYearId);
    if (year.status !== 'active') {
      throw new BadRequestException(
        `L’année ${year.label} n’accepte pas d’inscription : seule l’année en cours en accepte.`,
      );
    }

    const group = await this.db.query(async (tx) => {
      const { rows } = await tx.query<{ id: string; level_id: string | null; name: string }>(
        'SELECT id, level_id, name FROM groups WHERE id = $1',
        [input.groupId],
      );
      return rows[0];
    });
    if (!group) throw new NotFoundException('Groupe introuvable.');

    const refusal = await this.refuseProgression(
      input.studentId,
      year,
      group.level_id,
      permissions,
    );
    if (refusal) throw new ForbiddenException(refusal);

    /**
     * ⚠ LE MODÈLE DE FACTURATION DE L'ÉCOLE (ADR-0073). « famille » : le chemin
     * d'El Ourwa, inchangé — `levels.monthly_rate`, aucun mode, aucun service.
     * « services » (Jinan) : le tarif DU MODE choisi, et un plan — frais
     * d'inscription du niveau, prix des services cochés — vérifié ici, avant
     * que la moindre ligne soit écrite.
     */
    let plan: PlanInscription | null = null;
    if ((await this.billing.current()) === 'services') {
      plan = await this.tarifs.planInscription({
        year,
        group,
        studyMode: input.studyMode,
        services: input.services,
      });
    } else if (input.studyMode != null || (input.services?.length ?? 0) > 0) {
      throw new BadRequestException(FAMILLE_REFUS);
    }

    const level = !plan && group.level_id
      ? await this.db.query(async (tx) => {
          const { rows } = await tx.query<{ monthly_rate: string }>(
            'SELECT monthly_rate FROM levels WHERE id = $1',
            [group.level_id],
          );
          return rows[0];
        })
      : undefined;

    // École « services » : le tarif du niveau POUR CE MODE. C'est aussi lui que
    // compare la substitution du comptable ci-dessous — comparer à
    // `monthly_rate` remplacerait chaque inscription 8h – 17h par un autre prix
    // et enverrait une fausse demande à la direction.
    const fullRate = plan ? plan.fullRate : (level?.monthly_rate ?? '0');
    // The supplied fee IS the amount owed. The gap to the level's full rate is
    // a negotiated rate, never a debt to be claimed later.
    let monthlyFee = input.isFree ? '0' : (input.monthlyFee ?? fullRate);

    /**
     * ⚠ LE TARIF OFFICIEL S'APPLIQUE EN ATTENDANT — `inscrire_etudiant.php`.
     *
     * La caisse et le secrétariat ne fixent pas ce qu'une famille paiera. El
     * Ourwa ne les REFUSE pas — il **substitue** le tarif du niveau et envoie une
     * demande à l'administration : « Le frais mensuel saisi diffère du tarif du
     * niveau : une demande a été envoyée à l'administrateur. Le tarif officiel
     * s'applique en attendant sa validation. »
     *
     * Refuser bloquerait l'inscription d'un enfant devant le guichet pour une
     * question de tarif ; substituer l'inscrit au bon prix et laisse la
     * négociation suivre son cours. C'est la différence entre une garde qui
     * protège l'école et une garde qui empêche de travailler.
     *
     * ⚠ LA GRATUITÉ N'EST PAS CONCERNÉE : elle passe par l'exemption, qui a sa
     * propre garde de direction. Substituer ici ferait payer un boursier.
     */
    /**
     * ⚠ ON TESTE POSITIVEMENT LES DEUX RÔLES RESTREINTS, comme lui —
     * `$est_role_limite = est_comptable() || est_secretaire();` — et NON
     * « tout sauf la direction ».
     *
     * La différence n'est pas cosmétique : `roles` a une valeur par défaut, et
     * avec la forme négative un appelant qui l'omet serait traité comme
     * restreint. C'est ce qui est arrivé — un test d'inscription à tarif
     * négocié, appelé sans rôles, s'est vu substituer le tarif du niveau.
     *
     * ⚠ LE REVERS À CONNAÎTRE : un rôle restreint ajouté plus tard et détenteur
     * de `scolarite.inscrire` ne serait pas couvert tant qu'on ne l'ajoute pas
     * ici. C'est le comportement d'El Ourwa, qui ne nomme que ces deux-là ; la
     * vraie garde reste `@RequireRole` sur les gestes de dette.
     */
    const roleLimite = roles.includes('comptable') || roles.includes('secretaire');
    let feeRequested: string | undefined;
    if (roleLimite && !input.isFree && input.monthlyFee !== undefined) {
      const demande = money(input.monthlyFee);
      const officiel = money(fullRate);
      // Sa tolérance : `abs($frais - $tarif_niveau) > 0.01`.
      if (demande.minus(officiel).abs().greaterThan('0.01')) {
        feeRequested = input.monthlyFee;
        monthlyFee = fullRate;
      }
    }
    const entryDate = input.entryDate ?? `${year.start_year}-${String(year.start_month).padStart(2, '0')}-01`;

    return this.db.query(async (tx) => {
      /*
       * study_mode : NULL pour une école « famille » (toujours), si bien que la
       * reprise ON CONFLICT y laisse study_mode ET full_rate tels quels — le
       * comportement d'avant 0042. Pour une école « services », le mode fourni
       * et le tarif de ce mode remplacent les anciens (§2).
       */
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO enrollments
           (school_id, student_id, academic_year_id, group_id, level_id, status,
            monthly_fee, full_rate, is_free, enrolment_fee, document_fee,
            supplies_fee, entry_date, study_mode)
         VALUES ($1, $2, $3, $4, $5, 'enrolled', $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (school_id, student_id, academic_year_id) DO UPDATE
           SET status = 'enrolled', group_id = EXCLUDED.group_id,
               level_id = EXCLUDED.level_id, monthly_fee = EXCLUDED.monthly_fee,
               study_mode = COALESCE(EXCLUDED.study_mode, enrollments.study_mode),
               full_rate = CASE WHEN EXCLUDED.study_mode IS NULL THEN enrollments.full_rate
                                ELSE EXCLUDED.full_rate END
         RETURNING id`,
        [
          schoolId, input.studentId, input.academicYearId, input.groupId, group.level_id,
          monthlyFee, fullRate, input.isFree ?? false,
          input.enrolmentFee ?? '0', input.documentFee ?? '0', input.suppliesFee ?? '0',
          entryDate, plan?.studyMode ?? null,
        ],
      );
      const enrollmentId = rows[0]!.id;

      await this.buildSchedule(tx, enrollmentId, year, monthlyFee, input.isFree ?? false, entryDate);

      // École « services » : l'inscription (frais du niveau, figés) et les
      // services cochés, dans CETTE transaction — ils tiennent ou tombent avec
      // l'inscription.
      const services = plan
        ? await this.souscrireALInscription(tx, input.studentId, year, plan, entryDate, actorId)
        : undefined;

      await this.audit.record({
        actorId,
        schoolId,
        action: 'student_enrolled',
        entity: 'enrollment',
        entityId: enrollmentId,
        after: plan
          ? { studentId: input.studentId, year: year.label, monthlyFee, studyMode: plan.studyMode }
          : { studentId: input.studentId, year: year.label, monthlyFee },
      }, tx);

      /**
       * La demande part DANS la même transaction que l'inscription. Chez lui
       * elle est dans un `try` séparé dont l'échec n'est qu'un message ajouté —
       * si bien qu'une inscription pouvait exister au tarif officiel sans que
       * personne sache qu'un autre montant avait été négocié. Ici les deux
       * tiennent ou tombent ensemble.
       */
      if (feeRequested !== undefined) {
        const { rows: qui } = await tx.query<{ full_name: string }>(
          'SELECT full_name FROM users WHERE id = $1',
          [actorId],
        );
        const { rows: eleve } = await tx.query<{ first_name: string; last_name: string; matricule: string | null }>(
          'SELECT first_name, last_name, matricule FROM students WHERE id = $1',
          [input.studentId],
        );
        const nom = eleve[0] ? `${eleve[0].first_name} ${eleve[0].last_name}`.trim() : '';
        // Sa description et son `metadata` — c'est lui que « Demandes » exécute à l'approbation.
        await tx.query(
          `INSERT INTO approval_requests
             (school_id, raised_by, raiser_name, kind, description, amount, metadata)
           VALUES ($1, $2, $3, 'frais_mensuel', $4, $5, $6::jsonb)`,
          [
            schoolId,
            actorId,
            qui[0]?.full_name ?? 'Inconnu',
            `Modification du frais mensuel de ${nom} (matricule ${eleve[0]?.matricule ?? ''}) : ` +
              `${fr(money(fullRate))} MRU → ${fr(money(feeRequested))} MRU`,
            toStorage(money(feeRequested)),
            JSON.stringify({
              etudiant_id: input.studentId,
              etudiant_nom: nom,
              frais_demande: toStorage(money(feeRequested)),
              frais_actuel: toStorage(money(fullRate)),
            }),
          ],
        );
      }

      // Une école « famille » reçoit exactement la réponse d'avant 0042.
      return plan
        ? { id: enrollmentId, monthlyFee, entryDate, feeRequested, studyMode: plan.studyMode, services: services! }
        : { id: enrollmentId, monthlyFee, entryDate, feeRequested };
    });
  }

  /**
   * LES ABONNEMENTS D'UNE (RÉ)INSCRIPTION — école « services » (§3, §4, §8).
   *
   * Tous partent du PREMIER MOIS DÛ DE LA SCOLARITÉ (`firstOwedMonthOrder`, la
   * règle du 25 sur la date d'entrée), parmi les mois payables de l'année :
   * la fenêtre d'encaissement qui suit montre ainsi le premier mois, ses
   * services et l'inscription ensemble.
   *
   * L'inscription d'abord, d'office, au montant du niveau FIGÉ maintenant — s'il
   * est > 0 (0 = gratuit : aucun abonnement) — puis chaque service coché.
   * Idempotent : un abonnement actif de la même famille n'est pas recréé.
   */
  private async souscrireALInscription(
    tx: Queryable,
    studentId: string,
    year: AcademicYear,
    plan: PlanInscription,
    entryDate: string,
    actorId: string,
  ): Promise<AbonnementCree[]> {
    const months = await this.years.payableMonthsIn(tx, year);
    const firstOwed = firstOwedMonthOrder(
      { startYear: year.start_year, startMonth: year.start_month, endMonth: year.end_month },
      entryDate,
    );
    // Une sélection de mois qui saute la fin de l'année ne laisse aucun mois
    // après l'entrée : le dernier mois payable porte alors l'échéance.
    const start = months.find((m) => m.order >= firstOwed) ?? months[months.length - 1]!;

    const lignes: { service: 'inscription' | ServiceOptionnel; amount: string }[] = [];
    if (money(plan.enrolmentFee).greaterThan(0)) {
      lignes.push({ service: 'inscription', amount: plan.enrolmentFee });
    }
    lignes.push(...plan.services);

    const out: AbonnementCree[] = [];
    for (const l of lignes) {
      out.push(
        await this.abonnements.souscrireIn(tx, {
          studentId,
          year,
          months,
          service: l.service,
          amount: l.amount,
          start,
          actorId,
          via: 'inscription',
        }),
      );
    }
    return out;
  }

  /**
   * The month-by-month billing plan.
   *
   * ⚠ THE RULE OF THE 25th. Entered on or before the 25th → the entry month is
   * owed. After the 25th → the first owed month is the next one.
   *
   * Months before entry are still written, marked free at 0, so the cash desk
   * grid stays complete and readable while weighing nothing. A month already
   * invoiced is never touched — that would be rewriting accounts.
   */
  private async buildSchedule(
    tx: Queryable,
    enrollmentId: string,
    year: AcademicYear,
    monthlyFee: string,
    isFree: boolean,
    entryDate: string,
  ): Promise<void> {
    const { schoolId } = currentTenant();
    // ⚠ The year's OWN selection, not the bare range: a school that skips a
    // month must not have it billed back to every family by the generator.
    const months = await this.years.payableMonthsFor(year);
    const firstOwed = firstOwedMonthOrder(
      { startYear: year.start_year, startMonth: year.start_month, endMonth: year.end_month },
      entryDate,
    );

    for (const month of months) {
      const owed = !isFree && month.order >= firstOwed;
      await tx.query(
        `INSERT INTO enrollment_months
           (school_id, enrollment_id, month_order, month_label, calendar_month,
            calendar_year, status, amount_due)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (school_id, enrollment_id, month_order) DO UPDATE
           SET month_label = EXCLUDED.month_label
           WHERE enrollment_months.status <> 'invoiced'`,
        [
          schoolId, enrollmentId, month.order, month.label, month.month, month.year,
          owed ? 'billable' : 'free', owed ? monthlyFee : '0',
        ],
      );
    }
  }

  /** Re-enrol a returning student into the new year. */
  /**
   * RÉINSCRIRE — and ⚠ ITS HEADER IS THE SPECIFICATION: "with debt check, admin
   * bypass, and payment integration".
   *
   * We had none of the three. This checked only that the child was not already
   * enrolled, so a family owing 40 000 MRU was re-enrolled with nothing said —
   * and the one moment the school reliably has a family's attention was spent.
   *
   * Its rule:
   *
   *   owes, no bypass         → refused, with the figure named
   *   owes, bypass, not admin → refused: "Seul un administrateur peut
   *                             autoriser la réinscription malgré la dette."
   *   owes, bypass, admin     → allowed, and the journal records it
   *
   * ⚠ THE DEBT IS THE CORRESPONDENT'S, NOT THE CHILD'S. A family of four owes
   * one debt and every one of the four meets the same gate.
   */
  /**
   * A live « autorisée malgré dette » for this child and this year.
   *
   * ⚠ REVOKED ROWS DO NOT COUNT, and they are kept rather than deleted: who
   * allowed something and then changed their mind is a fact somebody will want.
   */
  async hasLiveAuthorisation(studentId: string, academicYearId: string): Promise<boolean> {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT 1 FROM reenrolment_authorisations
          WHERE student_id = $1 AND academic_year_id = $2 AND revoked_at IS NULL
          LIMIT 1`,
        [studentId, academicYearId],
      );
      return rows.length > 0;
    });
  }

  /**
   * AUTORISER LA RÉINSCRIPTION MALGRÉ LA DETTE — `reinscriptions.php`,
   * action `autoriser`.
   *
   * ⚠ THIS WAS A FLAG ON A CALL AND IT HAS TO BE A RECORD. El Ourwa's bulk
   * screen prints « Autorisée malgré dette » as a STATE of the family, sorts the
   * still-blocked ones to the top because those are the ones needing a decision,
   * and stops asking once the decision is taken. None of that is possible
   * against a parameter that lives for the length of one request.
   *
   * ⚠ AND THE AMOUNT IS FROZEN AT THE MOMENT. The question an auditor asks is
   * "how much was owed when somebody waved this through?" — and the debt moves
   * afterwards, in both directions, so reading it back later answers a different
   * question.
   */
  async authoriseDespiteDebt(
    studentId: string,
    academicYearId: string,
    reason: string | null,
    actorId: string,
    permissions: string[],
  ) {
    if (!permissions.includes('scolarite.niveaux')) {
      throw new ForbiddenException(
        'Seul un administrateur peut autoriser la réinscription malgré la dette.',
      );
    }
    const { schoolId } = currentTenant();

    const guardianId = await this.db.query(async (tx) => {
      const { rows } = await tx.query<{ guardian_id: string | null }>(
        'SELECT guardian_id FROM students WHERE id = $1',
        [studentId],
      );
      if (rows.length === 0) throw new NotFoundException('Étudiant introuvable.');
      return rows[0]!.guardian_id;
    });

    const owed = guardianId ? await this.debts.outstandingAcrossYears(guardianId) : null;
    const frozen = owed ? owed.toFixed(2) : '0.00';

    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `INSERT INTO reenrolment_authorisations
           (school_id, student_id, academic_year_id, amount_owed, reason, authorised_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (school_id, student_id, academic_year_id)
         DO UPDATE SET amount_owed = EXCLUDED.amount_owed,
                       reason = EXCLUDED.reason,
                       authorised_by = EXCLUDED.authorised_by,
                       authorised_at = now(),
                       revoked_at = NULL,
                       revoked_by = NULL
         RETURNING id`,
        [schoolId, studentId, academicYearId, frozen, reason?.trim() || null, actorId],
      );

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'reenrolment_authorised',
          entity: 'student',
          entityId: studentId,
          after: { amount_owed: frozen, reason: reason?.trim() ?? '' },
        },
        tx,
      );
      return { id: rows[0]!.id, amountOwed: frozen };
    });
  }

  /** RETIRER L'AUTORISATION. The row stays; only the decision is withdrawn. */
  async revokeAuthorisation(
    studentId: string,
    academicYearId: string,
    actorId: string,
    permissions: string[],
  ): Promise<void> {
    if (!permissions.includes('scolarite.niveaux')) {
      throw new ForbiddenException(
        'Seul un administrateur peut retirer une autorisation de réinscription.',
      );
    }
    const { schoolId } = currentTenant();

    await this.db.query(async (tx) => {
      const { rows } = await tx.query<{ id: string }>(
        `UPDATE reenrolment_authorisations
            SET revoked_at = now(), revoked_by = $3
          WHERE student_id = $1 AND academic_year_id = $2 AND revoked_at IS NULL
        RETURNING id`,
        [studentId, academicYearId, actorId],
      );
      if (rows.length === 0) {
        throw new NotFoundException('Aucune autorisation active pour cet étudiant.');
      }

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'reenrolment_authorisation_revoked',
          entity: 'student',
          entityId: studentId,
        },
        tx,
      );
    });
  }

  /**
   * RETIRER UN ÉLÈVE DE SA CLASSE — le « Supprimer » de `gestion_groupes.php`.
   *
   * ⚠ SON GESTE, PAS SA DESTRUCTION. Sa confirmation annonce ce qu'il fait :
   * « Supprimer cet étudiant ? Ses notes et paiements seront aussi supprimés. »
   * — et son code enchaîne bien trois DELETE : `notes`, `paiements`, `etudiants`.
   *
   * La règle 7 l'interdit : les écritures financières sont append-only. Un reçu
   * remis à une famille ne peut pas cesser d'avoir existé parce qu'on s'est
   * trompé de classe. L'inscription passe donc à `cancelled`, que TOUTES les
   * requêtes excluent déjà (`status <> 'cancelled'`) : l'élève quitte la liste,
   * la dette, les listes d'appel et les bulletins, et rien n'est perdu.
   */
  async cancelEnrolment(studentId: string, academicYearId: string, actorId: string) {
    const { schoolId } = currentTenant();
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ id: string; group_id: string | null }>(
        `UPDATE enrollments SET status = 'cancelled'
          WHERE student_id = $1 AND academic_year_id = $2 AND status <> 'cancelled'
          RETURNING id, group_id`,
        [studentId, academicYearId],
      );
      const enrolment = rows[0];
      if (!enrolment) {
        throw new NotFoundException("Cet élève n'est pas inscrit sur cette année.");
      }

      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'enrollment_cancelled',
          entity: 'enrollment',
          entityId: enrolment.id,
          before: { status: 'enrolled', groupId: enrolment.group_id },
          after: { status: 'cancelled' },
        },
        tx,
      );
      return { id: enrolment.id, cancelled: true };
    });
  }

  async reEnrol(
    studentId: string,
    groupId: string,
    actorId: string,
    permissions: string[],
    opts: {
      monthlyFee?: string;
      entryDate?: string;
      bypassDebt?: boolean;
      /** École « services » : obligatoire (voir `enrol`). */
      studyMode?: ModeEtude;
      /** École « services » : les services cochés ; l'inscription est ajoutée d'office. */
      services?: ServiceOptionnel[];
    } = {},
    /** Voir `enrol` : le tarif d'une réinscription obéit à la même règle. */
    roles: string[] = [],
  ) {
    const target = await this.years.enrolmentTarget();

    const guardianId = await this.db.query(async (tx) => {
      const { rows } = await tx.query<{ guardian_id: string | null }>(
        'SELECT guardian_id FROM students WHERE id = $1',
        [studentId],
      );
      return rows[0]?.guardian_id ?? null;
    });

    // Son ordre : déjà inscrit, puis la progression, puis la dette.
    const dejaInscrit = await this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT 1 FROM enrollments
          WHERE student_id = $1 AND academic_year_id = $2 AND status <> 'cancelled'`,
        [studentId, target.id],
      );
      return rows[0];
    });
    if (dejaInscrit) {
      throw new ConflictException(
        `Cet élève est déjà inscrit pour ${target.label}. Ouvrez sa caisse pour encaisser, ou changez sa classe depuis sa fiche.`,
      );
    }
    const cible = await this.db.query(async (tx) => {
      const { rows } = await tx.query<{ level_id: string | null }>('SELECT level_id FROM groups WHERE id = $1', [groupId]);
      return rows[0] ?? null;
    });
    const refusNiveau = await this.refuseProgression(studentId, target, cible?.level_id ?? null, permissions);
    if (refusNiveau) throw new ForbiddenException(refusNiveau);

    // What was actually waived, if anything. Set only when a real debt was let
    // through — an admin re-enrolling a family that owes nothing has waived
    // nothing, and an audit line saying otherwise is a false trail.
    let waived: string | null = null;

    if (guardianId) {
      /**
       * ⚠ ACROSS EVERY YEAR, not just the one being enrolled into. What stops a
       * family coming back in October is what they still owe from LAST year —
       * which is the entire purpose of this gate. El Ourwa calls
       * `obtenir_dette_parent_detaillee()` with no year here for the same
       * reason, though the same function takes one everywhere else.
       */
      const owed = await this.debts.outstandingAcrossYears(guardianId);

      if (owed.greaterThan(0.01)) {
        /**
         * ⚠ A STORED AUTHORISATION SATISFIES THE GATE, AND THAT IS THE POINT.
         * The decision is the direction's, taken once on the bulk screen and
         * recorded; the office then does the work — often days later, often for
         * four siblings — without needing them again. A gate that accepted only
         * a flag on the same call would put an administrator behind every
         * re-enrolment of every child of every family in arrears.
         */
        const authorised = await this.hasLiveAuthorisation(studentId, target.id);
        waived = fr(owed);

        if (!authorised) {
          // ⚠ The bypass is an ADMIN's decision, not a checkbox's. Anyone can
          // tick a box; only `scolarite.niveaux` — the direction's own
          // permission — makes it authority.
          const mayBypass = permissions.includes('scolarite.niveaux');

          if (!opts.bypassDebt) {
            throw new BadRequestException(
              'Réinscription impossible : le correspondant a une dette de ' +
                `${fr(owed)} MRU.`,
            );
          }
          if (!mayBypass) {
            throw new ForbiddenException(
              'Seul un administrateur peut autoriser la réinscription malgré la dette.',
            );
          }
        }
      }
    }

    const result = await this.enrol(
      { studentId, academicYearId: target.id, groupId, ...opts },
      actorId,
      permissions,
      roles,
    );

    /**
     * ⚠ A WAIVED GATE MUST BE FINDABLE AFTERWARDS. Its journal writes
     * "(dette ignorée par admin)" on exactly this. Without the record nobody
     * can answer who let a family back in while they still owed, which is the
     * question that gets asked when the debt is still there in June.
     */
    if (waived) {
      await this.audit.record({
        actorId,
        schoolId: currentTenant().schoolId,
        action: 'student_re_enrolled',
        entity: 'student',
        entityId: studentId,
        after: { debtBypassed: waived, year: target.label },
      });
    }

    // Son `notifier_parent_de_etudiant(…, 'Réinscription', …, 'reinscription', ['eleve', 'groupe' => annee])`.
    if (guardianId) {
      await this.db.query(async (tx) => {
        const { rows } = await tx.query<{ nom: string }>(
          "SELECT first_name || ' ' || last_name AS nom FROM students WHERE id = $1",
          [studentId],
        );
        await this.notifications.notifier(tx, {
          guardianId,
          studentId,
          academicYearId: target.id,
          kind: 'info',
          souche: 'notif_reinscription',
          params: { eleve: rows[0]?.nom ?? '', groupe: target.label },
          route: 'reinscription',
        });
      });
    }

    return result;
  }

  /** Record the end-of-year decision on the enrolment of the year that ended. */
  /**
   * Re-enrol a whole class at once — El Ourwa's `reinscriptions.php`.
   *
   * Every student goes through the SAME writer as a single enrolment, schedule
   * included. El Ourwa records a bug here worth not repeating: this page once
   * wrote only the enrolment row, so a re-enrolled child had no billable months,
   * therefore no debt and no line at the till, and the whole re-enrolment looked
   * like it had done nothing.
   *
   * One student's refusal does not sink the others. Each is attempted on its
   * own and reported by name, because a silent count of "3 blocked" tells the
   * office nothing they can act on.
   */
  async bulkReEnrol(
    studentIds: string[],
    groupId: string,
    actorId: string,
    permissions: string[],
    /**
     * École « services » : le mode choisi s'applique à TOUS les élèves cochés
     * (§2), et il est obligatoire. Refusé dans une école « famille ».
     */
    opts: { studyMode?: ModeEtude } = {},
  ) {
    /**
     * ⚠ VÉRIFIÉ UNE FOIS, POUR LE LOT ENTIER, AVANT LE PREMIER ÉLÈVE. Un mode
     * manquant, ou un tarif de mode non défini pour la classe, vaut pour chacun :
     * le laisser tomber élève par élève compterait trente « bloqués » là où il
     * n'y a qu'un réglage à poser, et c'est ce que l'écran afficherait.
     */
    if (opts.studyMode != null || (await this.billing.isServices())) {
      const target = await this.years.enrolmentTarget();
      await this.verifierFacturation({ academicYearId: target.id, groupId, studyMode: opts.studyMode });
    }

    const done: { studentId: string; name: string }[] = [];
    const skipped: { studentId: string; name: string; reason: string }[] = [];
    // Ses compteurs : `$bloques`, `$deja`, `$ajournes` — et le dernier réinscrit,
    // pour ouvrir sa caisse quand il n'y en a qu'un.
    let bloques = 0;
    let deja = 0;
    let ajournes = 0;
    let dernier: { studentId: string; guardianId: string | null } | null = null;

    for (const studentId of studentIds) {
      const { name, guardianId } = await this.db.query(async (tx) => {
        const { rows } = await tx.query<{ n: string; guardian_id: string | null }>(
          "SELECT first_name || ' ' || last_name AS n, guardian_id FROM students WHERE id = $1",
          [studentId],
        );
        return { name: rows[0]?.n ?? studentId, guardianId: rows[0]?.guardian_id ?? null };
      });

      try {
        /**
         * ⚠ UN ADMINISTRATEUR QUI RÉINSCRIT ASSUME LA DÉCISION. Its gate reads
         * `$du > 0.009 && !$peut_autoriser && !reinscription_autorisee(...)`, so
         * the direction passes without a stored authorisation and the journal
         * records "décision administrateur". The authorisation exists so that
         * the OFFICE can do the work afterwards — it was never a second lock on
         * the direction itself.
         *
         * The screen still greys out a blocked child's checkbox, exactly as its
         * own does, so this branch is reached only when the debt appeared
         * between the page being drawn and the form being sent.
         */
        await this.reEnrol(studentId, groupId, actorId, permissions, {
          bypassDebt: permissions.includes('scolarite.niveaux'),
          ...(opts.studyMode ? { studyMode: opts.studyMode } : {}),
        });
        done.push({ studentId, name });
        dernier = { studentId, guardianId };
      } catch (error) {
        const reason = error instanceof Error ? error.message : 'Refusé';
        // 1) déjà inscrit ; 2) progression refusée ; 3) dette non autorisée.
        if (error instanceof ConflictException) deja += 1;
        else if (error instanceof ForbiddenException && !reason.startsWith('Seul un administrateur')) ajournes += 1;
        else bloques += 1;
        skipped.push({ studentId, name, reason });
      }
    }

    return {
      enrolled: done.length,
      skipped: skipped.length,
      done,
      refused: skipped,
      bloques,
      deja,
      ajournes,
      dernier: done.length === 1 ? dernier : null,
    };
  }

  async setOutcome(
    enrollmentId: string,
    outcome: 'pending' | 'passed' | 'held_back' | 'expelled',
    actorId: string,
  ) {
    const { schoolId } = currentTenant();
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ id: string; academic_year_id: string }>(
        'UPDATE enrollments SET outcome = $2 WHERE id = $1 RETURNING id, academic_year_id',
        [enrollmentId, outcome],
      );
      if (!rows[0]) throw new NotFoundException('Inscription introuvable.');
      await this.audit.record({
        actorId,
        schoolId,
        action: 'enrolment_outcome_set',
        entity: 'enrollment',
        entityId: enrollmentId,
        after: { outcome },
      }, tx);
      return rows[0];
    });
  }

  async monthsFor(enrollmentId: string) {
    return this.db.query(async (tx) => {
      const { rows } = await tx.query(
        `SELECT month_order, month_label, calendar_month, calendar_year, status, amount_due
           FROM enrollment_months WHERE enrollment_id = $1 ORDER BY month_order`,
        [enrollmentId],
      );
      return rows;
    });
  }
}

/** El Ourwa's `number_format($x, 0, ',', ' ')`. */
function fr(value: { toFixed(n: number): string }): string {
  return value.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}
