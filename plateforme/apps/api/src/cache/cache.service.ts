import { Injectable } from '@nestjs/common';
import { maybeTenant } from '../tenant/tenant.context.js';

/**
 * LE CACHE LÉGER — le port de `includes/cache.php`.
 *
 * El Ourwa s'en sert à DEUX endroits, et à deux seulement :
 *
 *   - `api/parent/notifications.php` : le nombre de non-lus d'un parent, 60 s,
 *     et un verrou de 20 s contre un client qui interrogerait en boucle ;
 *   - `includes/acces_examens.php` : la dette totale d'une famille, 60 s, parce
 *     que la calculer coûte — son écran « Impayés » mettait 2,7 s — et que la
 *     porte des examens la demande à chaque ouverture de page.
 *
 * Le reste de l'application lit la base directement, et c'est voulu : un cache
 * devant de l'argent est une occasion de montrer un chiffre périmé. Ces deux-là
 * sont bornés à la minute et INVALIDÉS là où la valeur change — après un
 * encaissement, après une remise, après une lecture de notification.
 *
 * ⚠ EN MÉMOIRE, COMME SON APCu. Son choix par défaut pour un serveur unique est
 * APCu, avec Redis en option multi-serveurs et un repli sans cache « l'app
 * fonctionne quand même ». Une école, un serveur : la mémoire du processus est
 * exactement APCu. L'interface — `remember`, `forget`, `forgetPrefix` — est la
 * sienne, pour qu'un dos Redis se glisse derrière le jour où il y aura deux
 * instances, sans toucher aux appelants.
 *
 * ⚠ TOUTE CLÉ EST PRÉFIXÉE PAR L'ÉCOLE. Un cache est de la mémoire partagée
 * entre requêtes, donc entre locataires : sans le préfixe, le nombre de non-lus
 * d'un parent de Nour pourrait s'afficher à un parent de Rissala qui aurait le
 * même identifiant de correspondant. La règle 1 vaut pour le cache aussi.
 */
@Injectable()
export class CacheService {
  private readonly entries = new Map<string, { value: unknown; expiresAt: number }>();

  /** Bornage mémoire : au-delà, les entrées échues sont balayées. */
  private static readonly SWEEP_AT = 5000;

  private key(k: string): string {
    const tenant = maybeTenant();
    return `${tenant?.schoolId ?? '∅'}:${k}`;
  }

  get<T>(k: string): T | undefined {
    const e = this.entries.get(this.key(k));
    if (!e) return undefined;
    if (e.expiresAt <= Date.now()) {
      this.entries.delete(this.key(k));
      return undefined;
    }
    return e.value as T;
  }

  set<T>(k: string, value: T, ttlSeconds: number): void {
    if (this.entries.size >= CacheService.SWEEP_AT) this.sweep();
    this.entries.set(this.key(k), { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  /** Son `cache_remember()` : lit, sinon calcule et garde. */
  async remember<T>(k: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
    const hit = this.get<T>(k);
    if (hit !== undefined) return hit;
    const value = await compute();
    this.set(k, value, ttlSeconds);
    return value;
  }

  forget(k: string): void {
    this.entries.delete(this.key(k));
  }

  /** Son `cache_forget_prefix()` — pour vider, par exemple, tout ce qui touche un parent. */
  forgetPrefix(prefix: string): void {
    const full = this.key(prefix);
    for (const k of this.entries.keys()) if (k.startsWith(full)) this.entries.delete(k);
  }

  private sweep(): void {
    const now = Date.now();
    for (const [k, e] of this.entries) if (e.expiresAt <= now) this.entries.delete(k);
  }
}
