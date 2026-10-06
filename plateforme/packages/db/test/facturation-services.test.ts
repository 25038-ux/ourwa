import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { withTenant, type Queryable } from '../src/client.js';

/**
 * LA FACTURATION « SERVICES » — CE QUE LA BASE GARANTIT D'ELLE-MÊME (0042).
 *
 * ADR-0073, docs/specs/jinan-facturation.md §1–§5. Le code des services
 * vérifiera tout cela aussi ; ces tests tiennent ce qui reste vrai quand un
 * import, un script de reprise ou un `psql` passe à côté du code :
 *
 *   - le modèle de facturation est par école, `famille` par défaut ;
 *   - un seul abonnement cantine actif par élève et par année ;
 *   - l'inscription ne s'arrête pas ;
 *   - le grand livre des services est signé (positif, ou négatif s'il annule),
 *     annulé une fois au plus, et ne peut pas désigner un autre élève que
 *     celui de l'abonnement ;
 *   - de l'argent encaissé ne disparaît pas avec un élève ou un abonnement ;
 *     supprimer une ÉCOLE reste possible (NO ACTION, voir 0025).
 *
 * Écrites sous `app_user`, dans `withTenant` : l'isolation joue pour de vrai.
 */

let owner: pg.Pool;
let app: pg.Pool;
let jinan: string;
let nour: string;
let guardian: string;
let annee: string;
let niveau: string;
let eleve: string;
let eleve2: string;

const J = <T>(fn: (tx: Queryable) => Promise<T>) => withTenant(jinan, fn, app);
const N = <T>(fn: (tx: Queryable) => Promise<T>) => withTenant(nour, fn, app);

async function one<T>(tx: Queryable, sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await tx.query(sql, params);
  return rows[0] as T;
}

/** Un abonnement, directement en base. */
async function abonner(
  tx: Queryable,
  studentId: string,
  service: string,
  amount = '1000.00',
): Promise<string> {
  const r = await one<{ id: string }>(
    tx,
    `INSERT INTO student_services
       (school_id, student_id, academic_year_id, service, amount, start_month, start_year)
     VALUES ($1, $2, $3, $4, $5, 10, 2026) RETURNING id`,
    [jinan, studentId, annee, service, amount],
  );
  return r.id;
}

/** Un reçu groupé, le parent de toute ligne encaissée. */
async function recu(tx: Queryable, numero: string, amount: string): Promise<string> {
  const r = await one<{ id: string }>(
    tx,
    `INSERT INTO receipts (school_id, academic_year_id, guardian_id, receipt_number, amount)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [jinan, annee, guardian, numero, amount],
  );
  return r.id;
}

async function payer(
  tx: Queryable,
  abonnement: string,
  studentId: string,
  amount: string,
  opts: { receiptId?: string | null; reversesId?: string | null; numero?: string } = {},
): Promise<string> {
  const r = await one<{ id: string }>(
    tx,
    `INSERT INTO service_payments
       (school_id, student_service_id, student_id, academic_year_id,
        calendar_month, calendar_year, amount, receipt_number, receipt_id, reverses_id)
     VALUES ($1, $2, $3, $4, 10, 2026, $5, $6, $7, $8) RETURNING id`,
    [
      jinan, abonnement, studentId, annee, amount,
      opts.numero ?? `JIN-2026-${Math.random().toString(36).slice(2, 9)}`,
      opts.receiptId ?? null, opts.reversesId ?? null,
    ],
  );
  return r.id;
}

beforeAll(async () => {
  owner = new pg.Pool({ connectionString: process.env.DATABASE_ADMIN_URL });
  app = new pg.Pool({ connectionString: process.env.DATABASE_APP_URL });

  const s = await owner.query<{ id: string; slug: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix, billing_model) VALUES
       ('fact-jinan', 'Jinan (test)', 'FJN', 'services')
     RETURNING id, slug`,
  );
  jinan = s.rows[0]!.id;
  // École « famille » : la colonne n'est PAS nommée — c'est le défaut qui est éprouvé.
  const n = await owner.query<{ id: string }>(
    `INSERT INTO schools (slug, name, receipt_prefix) VALUES ('fact-nour', 'Nour (test)', 'FNR')
     RETURNING id`,
  );
  nour = n.rows[0]!.id;
  const g = await owner.query<{ id: string }>(
    `INSERT INTO users (email, password_hash, full_name)
     VALUES ('fact.parent@test', 'x', 'Famille Services') RETURNING id`,
  );
  guardian = g.rows[0]!.id;

  await J(async (tx) => {
    annee = (await one<{ id: string }>(
      tx,
      `INSERT INTO academic_years (school_id, label, start_year, status)
       VALUES ($1, '2026-2027', 2026, 'active') RETURNING id`,
      [jinan],
    )).id;
    niveau = (await one<{ id: string }>(
      tx,
      `INSERT INTO levels (school_id, name, monthly_rate_8h14, monthly_rate_8h17, student_enrolment_fee)
       VALUES ($1, '6ème', 3000, 4500, 2000) RETURNING id`,
      [jinan],
    )).id;
    eleve = (await one<{ id: string }>(
      tx,
      `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
       VALUES ($1, $2, 'FJ-RIM-1', 'FJ-NID-1', 'Aminetou', 'Services') RETURNING id`,
      [jinan, guardian],
    )).id;
    eleve2 = (await one<{ id: string }>(
      tx,
      `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
       VALUES ($1, $2, 'FJ-RIM-2', 'FJ-NID-2', 'Mohamed', 'Services') RETURNING id`,
      [jinan, guardian],
    )).id;
  });
});

afterAll(async () => {
  await app?.end();
  await owner?.end();
});

describe('le modèle de facturation, par école (§1)', () => {
  it('vaut « famille » par défaut — les écoles existantes ne changent pas', async () => {
    const { rows } = await owner.query<{ billing_model: string }>(
      'SELECT billing_model FROM schools WHERE id = $1',
      [nour],
    );
    expect(rows[0]!.billing_model).toBe('famille');
  });

  it('garde « services » quand l’école est créée ainsi', async () => {
    const { rows } = await owner.query<{ billing_model: string }>(
      'SELECT billing_model FROM schools WHERE id = $1',
      [jinan],
    );
    expect(rows[0]!.billing_model).toBe('services');
  });

  it('refuse toute autre valeur', async () => {
    await expect(
      owner.query("UPDATE schools SET billing_model = 'eleve' WHERE id = $1", [nour]),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      owner.query('UPDATE schools SET billing_model = NULL WHERE id = $1', [nour]),
    ).rejects.toThrow(/null value/i);
  });
});

describe('niveaux et inscriptions (§2, §3)', () => {
  it('un niveau créé sans tarifs par mode les laisse « non définis » (NULL)', async () => {
    const r = await J((tx) =>
      one<{ a: string | null; b: string | null; f: string | null; m: string }>(
        tx,
        `INSERT INTO levels (school_id, name, monthly_rate) VALUES ($1, 'CP', 1500)
         RETURNING monthly_rate_8h14 AS a, monthly_rate_8h17 AS b,
                   student_enrolment_fee AS f, monthly_rate::text AS m`,
        [jinan],
      ),
    );
    expect(r).toEqual({ a: null, b: null, f: null, m: '1500.00' });
  });

  it('rend les tarifs en chaînes, au centime', async () => {
    const r = await J((tx) =>
      one<{ a: string; b: string; f: string }>(
        tx,
        `SELECT monthly_rate_8h14 AS a, monthly_rate_8h17 AS b, student_enrolment_fee AS f
           FROM levels WHERE id = $1`,
        [niveau],
      ),
    );
    expect(r).toEqual({ a: '3000.00', b: '4500.00', f: '2000.00' });
  });

  it('refuse un tarif négatif', async () => {
    await expect(
      J((tx) => tx.query('UPDATE levels SET monthly_rate_8h17 = -1 WHERE id = $1', [niveau])),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      J((tx) => tx.query('UPDATE levels SET student_enrolment_fee = -1 WHERE id = $1', [niveau])),
    ).rejects.toThrow(/check constraint/i);
  });

  it('une inscription n’a pas de mode par défaut, et n’accepte que les deux modes', async () => {
    const id = await J(async (tx) => {
      const e = await one<{ id: string; study_mode: string | null }>(
        tx,
        `INSERT INTO enrollments (school_id, student_id, academic_year_id, level_id, monthly_fee, full_rate)
         VALUES ($1, $2, $3, $4, 3000, 3000) RETURNING id, study_mode`,
        [jinan, eleve, annee, niveau],
      );
      expect(e.study_mode).toBeNull();
      return e.id;
    });
    for (const mode of ['8h-14h', '8h-17h']) {
      await J((tx) => tx.query('UPDATE enrollments SET study_mode = $2 WHERE id = $1', [id, mode]));
    }
    await expect(
      J((tx) => tx.query("UPDATE enrollments SET study_mode = '8h-12h' WHERE id = $1", [id])),
    ).rejects.toThrow(/check constraint/i);
  });
});

describe('les prix des services (§4)', () => {
  it('un prix par école, par année et par service', async () => {
    await J((tx) =>
      tx.query(
        `INSERT INTO service_prices (school_id, academic_year_id, service, amount)
         VALUES ($1, $2, 'piscine', 1500)`,
        [jinan, annee],
      ),
    );
    await expect(
      J((tx) =>
        tx.query(
          `INSERT INTO service_prices (school_id, academic_year_id, service, amount)
           VALUES ($1, $2, 'piscine', 1800)`,
          [jinan, annee],
        ),
      ),
    ).rejects.toThrow(/duplicate key/i);
  });

  it('accepte 0 (gratuit) et refuse un prix négatif', async () => {
    await J((tx) =>
      tx.query(
        `INSERT INTO service_prices (school_id, academic_year_id, service, amount)
         VALUES ($1, $2, 'docteur', 0)`,
        [jinan, annee],
      ),
    );
    await expect(
      J((tx) =>
        tx.query(
          `INSERT INTO service_prices (school_id, academic_year_id, service, amount)
           VALUES ($1, $2, 'cantine_dejeuner', -5)`,
          [jinan, annee],
        ),
      ),
    ).rejects.toThrow(/check constraint/i);
  });

  it('n’a pas de prix d’inscription (il est par niveau) ni de service inconnu', async () => {
    for (const service of ['inscription', 'bus']) {
      await expect(
        J((tx) =>
          tx.query(
            `INSERT INTO service_prices (school_id, academic_year_id, service, amount)
             VALUES ($1, $2, $3, 100)`,
            [jinan, annee, service],
          ),
        ),
      ).rejects.toThrow(/check constraint/i);
    }
  });
});

describe('les abonnements (§4)', () => {
  it('rangent les trois cantines dans une même famille, les autres dans la leur', async () => {
    const familles = await J(async (tx) => {
      const a = await abonner(tx, eleve2, 'cantine_petit_dejeuner');
      const b = await abonner(tx, eleve2, 'piscine');
      const { rows } = await tx.query<{ service: string; famille: string }>(
        'SELECT service, famille FROM student_services WHERE id = ANY($1) ORDER BY service',
        [[a, b]],
      );
      return rows;
    });
    expect(familles).toEqual([
      { service: 'cantine_petit_dejeuner', famille: 'cantine' },
      { service: 'piscine', famille: 'piscine' },
    ]);
  });

  it('⚠ refuse une deuxième cantine active pour le même élève et la même année', async () => {
    await expect(J((tx) => abonner(tx, eleve2, 'cantine_complet'))).rejects.toThrow(/duplicate key/i);
  });

  it('changer de formule = arrêter l’une, commencer l’autre', async () => {
    await J(async (tx) => {
      await tx.query(
        `UPDATE student_services SET ended_at = now()
          WHERE student_id = $1 AND service = 'cantine_petit_dejeuner'`,
        [eleve2],
      );
      await abonner(tx, eleve2, 'cantine_complet');
    });
    const n = await J((tx) =>
      one<{ n: number }>(
        tx,
        `SELECT count(*)::int AS n FROM student_services
          WHERE student_id = $1 AND famille = 'cantine'`,
        [eleve2],
      ),
    );
    expect(n.n).toBe(2);
  });

  it('⚠ l’inscription ne s’arrête pas, et n’existe qu’une fois par élève et par année', async () => {
    const id = await J((tx) => abonner(tx, eleve2, 'inscription', '2000.00'));
    await expect(
      J((tx) => tx.query('UPDATE student_services SET ended_at = now() WHERE id = $1', [id])),
    ).rejects.toThrow(/check constraint/i);
    await expect(J((tx) => abonner(tx, eleve2, 'inscription', '2000.00'))).rejects.toThrow(/duplicate key/i);
  });

  it('refuse un service inconnu, un montant négatif, un mois hors calendrier', async () => {
    await expect(J((tx) => abonner(tx, eleve2, 'bus'))).rejects.toThrow(/check constraint/i);
    await expect(J((tx) => abonner(tx, eleve, 'docteur', '-1'))).rejects.toThrow(/check constraint/i);
    await expect(
      J((tx) =>
        tx.query(
          `INSERT INTO student_services
             (school_id, student_id, academic_year_id, service, amount, start_month, start_year)
           VALUES ($1, $2, $3, 'docteur', 100, 13, 2026)`,
          [jinan, eleve, annee],
        ),
      ),
    ).rejects.toThrow(/check constraint/i);
  });

  it('un échéancier : un mois une fois, jamais négatif', async () => {
    const abo = await J((tx) => abonner(tx, eleve, 'docteur', '500.00'));
    await J((tx) =>
      tx.query(
        `INSERT INTO student_service_months
           (school_id, student_service_id, calendar_month, calendar_year, amount_due)
         VALUES ($1, $2, 10, 2026, 500), ($1, $2, 11, 2026, 500)`,
        [jinan, abo],
      ),
    );
    await expect(
      J((tx) =>
        tx.query(
          `INSERT INTO student_service_months
             (school_id, student_service_id, calendar_month, calendar_year, amount_due)
           VALUES ($1, $2, 10, 2026, 500)`,
          [jinan, abo],
        ),
      ),
    ).rejects.toThrow(/duplicate key/i);
    await expect(
      J((tx) =>
        tx.query(
          `INSERT INTO student_service_months
             (school_id, student_service_id, calendar_month, calendar_year, amount_due)
           VALUES ($1, $2, 12, 2026, -1)`,
          [jinan, abo],
        ),
      ),
    ).rejects.toThrow(/check constraint/i);
  });
});

describe('le grand livre des services (§5)', () => {
  let abo: string;
  let recuId: string;
  let paiement: string;

  beforeAll(async () => {
    await J(async (tx) => {
      abo = await abonner(tx, eleve, 'piscine', '1500.00');
      recuId = await recu(tx, 'FJN-2026-00001', '1500.00');
      paiement = await payer(tx, abo, eleve, '1500.00', { receiptId: recuId, numero: 'FJN-2026-00001' });
    });
  });

  it('rend le montant en chaîne, au centime', async () => {
    const r = await J((tx) =>
      one<{ amount: string }>(tx, 'SELECT amount FROM service_payments WHERE id = $1', [paiement]),
    );
    expect(r.amount).toBe('1500.00');
  });

  it('refuse un encaissement nul ou négatif', async () => {
    for (const amount of ['0', '-10']) {
      await expect(
        J((tx) => payer(tx, abo, eleve, amount, { receiptId: recuId })),
      ).rejects.toThrow(/check constraint/i);
    }
  });

  it('refuse une ligne encaissée hors de tout reçu', async () => {
    await expect(J((tx) => payer(tx, abo, eleve, '100.00'))).rejects.toThrow(/check constraint/i);
  });

  it('⚠ refuse une ligne dont l’élève n’est pas celui de l’abonnement', async () => {
    await expect(
      J((tx) => payer(tx, abo, eleve2, '100.00', { receiptId: recuId })),
    ).rejects.toThrow(/foreign key/i);
  });

  it('une annulation est négative, et n’arrive qu’une fois', async () => {
    await expect(
      J((tx) => payer(tx, abo, eleve, '1500.00', { reversesId: paiement, numero: 'FJN-2026-00002' })),
    ).rejects.toThrow(/check constraint/i);
    await J((tx) => payer(tx, abo, eleve, '-1500.00', { reversesId: paiement, numero: 'FJN-2026-00002' }));
    await expect(
      J((tx) => payer(tx, abo, eleve, '-1500.00', { reversesId: paiement, numero: 'FJN-2026-00003' })),
    ).rejects.toThrow(/duplicate key/i);
    const net = await J((tx) =>
      one<{ net: string }>(
        tx,
        'SELECT sum(amount)::text AS net FROM service_payments WHERE student_service_id = $1',
        [abo],
      ),
    );
    expect(net.net).toBe('0.00');
  });

  it('un numéro de reçu hors reçu groupé n’existe qu’une fois', async () => {
    const autre = await J(async (tx) => {
      const r = await recu(tx, 'FJN-2026-00004', '200.00');
      return payer(tx, abo, eleve, '200.00', { receiptId: r, numero: 'FJN-2026-00004' });
    });
    await J((tx) => payer(tx, abo, eleve, '-200.00', { reversesId: autre, numero: 'FJN-2026-00005' }));
    const autre2 = await J(async (tx) => {
      const r = await recu(tx, 'FJN-2026-00006', '300.00');
      return payer(tx, abo, eleve, '300.00', { receiptId: r, numero: 'FJN-2026-00006' });
    });
    await expect(
      J((tx) => payer(tx, abo, eleve, '-300.00', { reversesId: autre2, numero: 'FJN-2026-00005' })),
    ).rejects.toThrow(/duplicate key/i);
  });

  it('⚠ de l’argent encaissé ne disparaît ni avec l’abonnement, ni avec l’élève', async () => {
    await expect(
      owner.query('DELETE FROM student_services WHERE id = $1', [abo]),
    ).rejects.toThrow(/foreign key/i);
    await expect(owner.query('DELETE FROM students WHERE id = $1', [eleve])).rejects.toThrow(/foreign key/i);
    const r = await owner.query('SELECT 1 FROM service_payments WHERE student_service_id = $1', [abo]);
    expect(r.rows.length).toBeGreaterThan(0);
  });

  it('un abonnement jamais encaissé se supprime, et son échéancier avec', async () => {
    const libre = await J(async (tx) => {
      const id = await abonner(tx, eleve, 'cantine_dejeuner', '2500.00');
      await tx.query(
        `INSERT INTO student_service_months
           (school_id, student_service_id, calendar_month, calendar_year, amount_due)
         VALUES ($1, $2, 10, 2026, 2500)`,
        [jinan, id],
      );
      return id;
    });
    await J((tx) => tx.query('DELETE FROM student_services WHERE id = $1', [libre]));
    const r = await owner.query(
      'SELECT count(*)::int AS n FROM student_service_months WHERE student_service_id = $1',
      [libre],
    );
    expect(r.rows[0]!.n).toBe(0);
  });
});

describe('isolation (règles 1 et 5)', () => {
  it('une autre école ne voit rien des services de Jinan', async () => {
    const r = await N(async (tx) => {
      const out: Record<string, number> = {};
      for (const t of ['service_prices', 'student_services', 'student_service_months', 'service_payments']) {
        out[t] = (await one<{ n: number }>(tx, `SELECT count(*)::int AS n FROM ${t}`)).n;
      }
      return out;
    });
    expect(r).toEqual({
      service_prices: 0,
      student_services: 0,
      student_service_months: 0,
      service_payments: 0,
    });
  });

  it('⚠ une autre école ne peut pas abonner un élève de Jinan, même en connaissant son id', async () => {
    const annee2 = await N((tx) =>
      one<{ id: string }>(
        tx,
        `INSERT INTO academic_years (school_id, label, start_year, status)
         VALUES ($1, '2026-2027', 2026, 'active') RETURNING id`,
        [nour],
      ),
    );
    await expect(
      N((tx) =>
        tx.query(
          `INSERT INTO student_services
             (school_id, student_id, academic_year_id, service, amount, start_month, start_year)
           VALUES ($1, $2, $3, 'piscine', 100, 10, 2026)`,
          [nour, eleve, annee2.id],
        ),
      ),
    ).rejects.toThrow(/foreign key/i);
    // Et écrire au nom de Jinan depuis Nour : la politique refuse.
    await expect(
      N((tx) =>
        tx.query(
          `INSERT INTO service_prices (school_id, academic_year_id, service, amount)
           VALUES ($1, $2, 'photocopie', 100)`,
          [jinan, annee],
        ),
      ),
    ).rejects.toThrow(/row-level security|foreign key/i);
  });
});

describe('supprimer une école reste possible (0025 : NO ACTION, pas RESTRICT)', () => {
  it('efface abonnements, échéanciers, encaissements et annulations d’un seul geste', async () => {
    const s = await owner.query<{ id: string }>(
      `INSERT INTO schools (slug, name, receipt_prefix, billing_model)
       VALUES ('fact-ferme', 'Fermée (test)', 'FFE', 'services') RETURNING id`,
    );
    const ecole = s.rows[0]!.id;
    await withTenant(
      ecole,
      async (tx) => {
        const y = await one<{ id: string }>(
          tx,
          `INSERT INTO academic_years (school_id, label, start_year, status)
           VALUES ($1, '2026-2027', 2026, 'active') RETURNING id`,
          [ecole],
        );
        const st = await one<{ id: string }>(
          tx,
          `INSERT INTO students (school_id, guardian_id, rim, national_id, first_name, last_name)
           VALUES ($1, $2, 'FF-RIM', 'FF-NID', 'Enfant', 'Fermee') RETURNING id`,
          [ecole, guardian],
        );
        const ab = await one<{ id: string }>(
          tx,
          `INSERT INTO student_services
             (school_id, student_id, academic_year_id, service, amount, start_month, start_year)
           VALUES ($1, $2, $3, 'cantine_dejeuner', 2500, 10, 2026) RETURNING id`,
          [ecole, st.id, y.id],
        );
        await tx.query(
          `INSERT INTO student_service_months
             (school_id, student_service_id, calendar_month, calendar_year, amount_due)
           VALUES ($1, $2, 10, 2026, 2500)`,
          [ecole, ab.id],
        );
        await tx.query(
          `INSERT INTO service_prices (school_id, academic_year_id, service, amount)
           VALUES ($1, $2, 'cantine_dejeuner', 2500)`,
          [ecole, y.id],
        );
        const rc = await one<{ id: string }>(
          tx,
          `INSERT INTO receipts (school_id, academic_year_id, guardian_id, receipt_number, amount)
           VALUES ($1, $2, $3, 'FFE-2026-00001', 2500) RETURNING id`,
          [ecole, y.id, guardian],
        );
        const p = await one<{ id: string }>(
          tx,
          `INSERT INTO service_payments
             (school_id, student_service_id, student_id, academic_year_id,
              calendar_month, calendar_year, amount, receipt_number, receipt_id)
           VALUES ($1, $2, $3, $4, 10, 2026, 2500, 'FFE-2026-00001', $5) RETURNING id`,
          [ecole, ab.id, st.id, y.id, rc.id],
        );
        await tx.query(
          `INSERT INTO service_payments
             (school_id, student_service_id, student_id, academic_year_id,
              calendar_month, calendar_year, amount, receipt_number, reverses_id)
           VALUES ($1, $2, $3, $4, 10, 2026, -2500, 'FFE-2026-00002', $5)`,
          [ecole, ab.id, st.id, y.id, p.id],
        );
      },
      app,
    );

    await expect(owner.query('DELETE FROM schools WHERE id = $1', [ecole])).resolves.toBeTruthy();
    for (const t of ['service_prices', 'student_services', 'student_service_months', 'service_payments']) {
      const r = await owner.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${t} WHERE school_id = $1`, [ecole]);
      expect(r.rows[0]!.n, t).toBe(0);
    }
  });
});

describe('0047 — le transport, les remises', () => {
  it('le transport est un service connu de la base (prix et abonnement)', async () => {
    const { rows } = await owner.query<{ c: string }>(
      `SELECT pg_get_constraintdef(oid) AS c FROM pg_constraint WHERE conname IN ('service_prices_service_check', 'student_services_service_check')`,
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.c).toContain("'transport'");
  });

  it('⚠ une remise : jamais négative, jamais plus que le prix, jamais sur un service annuel', async () => {
    const { rows } = await owner.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE conrelid = 'student_services'::regclass AND contype = 'c' AND conname LIKE 'student_services_remise%' ORDER BY conname`,
    );
    expect(rows.map((r) => r.conname)).toEqual(['student_services_remise_bornee', 'student_services_remise_mensuelle']);
  });
});

describe('0050 — la plateforme (mensuelle, d’office) et les fournitures (annuelles, au choix)', () => {
  it('sont des services connus de la base : un prix, un abonnement', async () => {
    await J(async (tx) => {
      for (const [service, amount] of [['plateforme', 200], ['fourniture', 1500]] as const) {
        await tx.query(
          `INSERT INTO service_prices (school_id, academic_year_id, service, amount) VALUES ($1, $2, $3, $4)`,
          [jinan, annee, service, amount],
        );
      }
      const p = await abonner(tx, eleve2, 'plateforme', '200.00');
      const f = await abonner(tx, eleve2, 'fourniture', '1500.00');
      const { rows } = await tx.query<{ service: string; famille: string }>(
        'SELECT service, famille FROM student_services WHERE id = ANY($1) ORDER BY service',
        [[p, f]],
      );
      expect(rows).toEqual([
        { service: 'fourniture', famille: 'fourniture' },
        { service: 'plateforme', famille: 'plateforme' },
      ]);
    });
  });

  it('⚠ une remise sur la plateforme (mensuelle), jamais sur les fournitures (annuelles)', async () => {
    const id = async (service: string) =>
      (await owner.query<{ id: string }>(
        'SELECT id FROM student_services WHERE student_id = $1 AND service = $2',
        [eleve2, service],
      )).rows[0]!.id;
    const plateforme = await id('plateforme');
    const fourniture = await id('fourniture');
    await J((tx) => tx.query('UPDATE student_services SET remise = 40 WHERE id = $1', [plateforme]));
    await expect(
      J((tx) => tx.query('UPDATE student_services SET remise = 100 WHERE id = $1', [fourniture])),
    ).rejects.toThrow(/student_services_remise_mensuelle/);
    const { rows } = await owner.query<{ c: string }>(
      `SELECT pg_get_constraintdef(oid) AS c FROM pg_constraint WHERE conname = 'student_services_remise_mensuelle'`,
    );
    expect(rows[0]!.c).toContain("'fourniture'");
    expect(rows[0]!.c).not.toContain("'plateforme'");
  });
});

