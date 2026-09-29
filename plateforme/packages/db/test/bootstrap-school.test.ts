import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { bootstrapSchool, lireOptions } from '../src/bootstrap-school.js';

/**
 * INSTALLER UNE ÉCOLE — le modèle de facturation (0042, ADR-0073).
 *
 * `--billing-model famille|services`, « famille » par défaut : une école
 * installée comme El Mourad l'a été ne change pas. Posé à la création, jamais
 * changé ensuite : relancer l'installation (elle est idempotente) ne le
 * réécrit pas, et le relancer avec un AUTRE modèle est refusé — une école
 * qui a déjà encaissé sous un modèle ne peut pas basculer dans l'autre.
 */

let owner: pg.Pool;
const url = () => process.env.DATABASE_ADMIN_URL!;
const quiet = console.log;

const options = (slug: string, extra: string[] = []) =>
  lireOptions([
    '--slug', slug, '--name', `École ${slug}`, '--prefix', 'BTS',
    '--admin-email', `direction.${slug}@ecole.test`, ...extra,
  ]);

async function modele(slug: string): Promise<string | undefined> {
  const { rows } = await owner.query<{ billing_model: string }>(
    'SELECT billing_model FROM schools WHERE slug = $1',
    [slug],
  );
  return rows[0]?.billing_model;
}

beforeAll(() => {
  owner = new pg.Pool({ connectionString: url() });
  console.log = () => undefined;
});

afterAll(async () => {
  console.log = quiet;
  await owner?.end();
});

describe('lireOptions --billing-model', () => {
  it('absent : non précisé (null), l’école neuve sera « famille »', () => {
    expect(options('bt-a').billingModel).toBeNull();
  });

  it('accepte famille et services', () => {
    expect(options('bt-a', ['--billing-model', 'famille']).billingModel).toBe('famille');
    expect(options('bt-a', ['--billing-model', 'services']).billingModel).toBe('services');
    expect(options('bt-a', ['--billing-model', ' Services ']).billingModel).toBe('services');
  });

  it('refuse toute autre valeur, avec la phrase exacte', () => {
    expect(() => options('bt-a', ['--billing-model', 'eleve'])).toThrow(/--billing-model.*famille.*services/);
    expect(() => options('bt-a', ['--billing-model'])).toThrow(/--billing-model/);
  });
});

describe('bootstrapSchool et le modèle de facturation', () => {
  it('une école installée sans le préciser facture « famille » (El Mourad inchangé)', async () => {
    await bootstrapSchool(url(), options('bt-famille'));
    expect(await modele('bt-famille')).toBe('famille');
  });

  it('une école installée avec --billing-model services facture « services » (Jinan)', async () => {
    await bootstrapSchool(url(), options('bt-jinan', ['--billing-model', 'services']));
    expect(await modele('bt-jinan')).toBe('services');
  });

  it('relancer l’installation est sans effet — avec le même modèle ou sans le préciser', async () => {
    await bootstrapSchool(url(), options('bt-jinan', ['--billing-model', 'services']));
    await bootstrapSchool(url(), options('bt-jinan'));
    expect(await modele('bt-jinan')).toBe('services');
    const { rows } = await owner.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM schools WHERE slug = 'bt-jinan'",
    );
    expect(rows[0]!.n).toBe(1);
  });

  it('⚠ relancer avec un AUTRE modèle est refusé, et rien ne change', async () => {
    await expect(
      bootstrapSchool(url(), options('bt-jinan', ['--billing-model', 'famille'])),
    ).rejects.toThrow(/services.*jamais changé|jamais changé.*services/);
    expect(await modele('bt-jinan')).toBe('services');

    await expect(
      bootstrapSchool(url(), options('bt-famille', ['--billing-model', 'services'])),
    ).rejects.toThrow(/famille/);
    expect(await modele('bt-famille')).toBe('famille');
  });
});
