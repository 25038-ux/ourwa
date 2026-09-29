import { describe, expect, it, vi } from 'vitest';
import { CacheService } from './cache.service.js';
import { runInTenant } from '../tenant/tenant.context.js';

/**
 * LE CACHE EST DEVANT DE L'ARGENT — la dette d'une famille à la porte des
 * examens — donc il se teste comme de l'argent (règle 15). Les deux fautes
 * qu'il pourrait commettre sont silencieuses : montrer un chiffre périmé après
 * un encaissement, ou montrer le chiffre d'une AUTRE école.
 */

const NOUR = { schoolId: '11111111-1111-7111-8111-111111111111', slug: 'nour' };
const RISSALA = { schoolId: '22222222-2222-7222-8222-222222222222', slug: 'rissala' };

describe('remember', () => {
  it('calcule une fois, puis rend la valeur gardée', async () => {
    const cache = new CacheService();
    const calcul = vi.fn(async () => '42.00');
    await runInTenant(NOUR, async () => {
      expect(await cache.remember('k', 60, calcul)).toBe('42.00');
      expect(await cache.remember('k', 60, calcul)).toBe('42.00');
    });
    expect(calcul).toHaveBeenCalledTimes(1);
  });

  it('recalcule une fois le délai passé', async () => {
    vi.useFakeTimers();
    try {
      const cache = new CacheService();
      let n = 0;
      const calcul = async () => String(++n);
      await runInTenant(NOUR, async () => {
        expect(await cache.remember('k', 60, calcul)).toBe('1');
        vi.advanceTimersByTime(61_000);
        expect(await cache.remember('k', 60, calcul)).toBe('2');
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('⚠ oublie sur demande — un encaissement vient de changer la dette', async () => {
    const cache = new CacheService();
    let n = 0;
    const calcul = async () => String(++n);
    await runInTenant(NOUR, async () => {
      expect(await cache.remember('dette:p1', 60, calcul)).toBe('1');
      cache.forget('dette:p1');
      expect(await cache.remember('dette:p1', 60, calcul)).toBe('2');
    });
  });

  it('oublie par préfixe — tout ce qui touche un parent', async () => {
    const cache = new CacheService();
    await runInTenant(NOUR, async () => {
      cache.set('non-lus:p1:a1', 3, 60);
      cache.set('non-lus:p1:a2', 5, 60);
      cache.set('non-lus:p2:a1', 7, 60);
      cache.forgetPrefix('non-lus:p1:');
      expect(cache.get('non-lus:p1:a1')).toBeUndefined();
      expect(cache.get('non-lus:p1:a2')).toBeUndefined();
      expect(cache.get('non-lus:p2:a1')).toBe(7);
    });
  });
});

describe('⚠ cloisonnement', () => {
  it('la même clé dans deux écoles est deux entrées', async () => {
    const cache = new CacheService();
    await runInTenant(NOUR, async () => cache.set('dette:p1', '1000.00', 60));
    await runInTenant(RISSALA, async () => {
      // Le même identifiant de correspondant, une autre école : rien à voir.
      expect(cache.get('dette:p1')).toBeUndefined();
      cache.set('dette:p1', '0.00', 60);
    });
    await runInTenant(NOUR, async () => expect(cache.get('dette:p1')).toBe('1000.00'));
  });

  it('oublier dans une école ne touche pas l’autre', async () => {
    const cache = new CacheService();
    await runInTenant(NOUR, async () => cache.set('dette:p1', '1000.00', 60));
    await runInTenant(RISSALA, async () => cache.set('dette:p1', '0.00', 60));
    await runInTenant(RISSALA, async () => cache.forget('dette:p1'));
    await runInTenant(NOUR, async () => expect(cache.get('dette:p1')).toBe('1000.00'));
  });
});
