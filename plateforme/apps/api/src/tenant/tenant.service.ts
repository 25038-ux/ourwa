import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { deploiementDepuisEnv } from '@elourwa/shared/brand';
import { slugDepuisHote } from '@elourwa/shared/tenant-slug';
import { DbService } from '../db/db.service.js';
import { CacheService } from '../cache/cache.service.js';

export interface School {
  id: string;
  slug: string;
  name: string;
  name_ar: string | null;
  currency: string;
  locale: string;
  theme_color: string;
  logo_emoji: string;
  active: boolean;
}

@Injectable()
export class TenantService {
  // Explicit token injection: this project runs under esbuild in development,
  // which does not emit decorator metadata. Naming the dependency keeps DI
  // working identically in dev and in the tsc build.
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(CacheService) private readonly cache: CacheService,
  ) {}

  /**
   * Resolve the school from a Host header.
   *
   * `toujounine.localhost:3000` -> slug `toujounine`. The platform console lives
   * at `admin.`, which is deliberately NOT a school and resolves to null so a
   * caller cannot reach tenant data by pretending to be it.
   */
  slugFromHost(host: string | undefined): string | null {
    // La règle vit dans @elourwa/shared/tenant-slug — la même que le site.
    return slugDepuisHote(host, this.ecoleUnique());
  }

  /**
   * L'ÉCOLE UNIQUE, ou null : la plateforme multi-écoles.
   *
   * Quand l'installation ne sert qu'une école (`SINGLE_SCHOOL_SLUG`), tout
   * nom d'hôte la désigne — et l'en-tête `X-School-Slug` ne peut pas en
   * désigner une autre : l'intercepteur et la connexion la lisent AVANT lui.
   * Lue à chaque appel (pas mémorisée) : les tests la posent et la retirent.
   */
  ecoleUnique(): string | null {
    return deploiementDepuisEnv(process.env).ecoleUnique;
  }

  async findBySlug(slug: string): Promise<School> {
    // Lue à chaque requête par l'intercepteur ; une école change rarement.
    // Trente secondes de mémoire, la suspension d'une branche se voit donc
    // dans la demi-minute.
    const school = await this.cache.remember(`ecole:${slug}`, 30, () => this.db.registry(async (tx) => {
      const { rows } = await tx.query<School>(
        `SELECT id, slug, name, name_ar, currency, locale, theme_color, logo_emoji, active
           FROM schools WHERE slug = $1`,
        [slug],
      );
      return rows[0] ?? null;
    }));
    if (!school) throw new NotFoundException(`Aucune école pour l’identifiant « ${slug} ».`);
    if (!school.active) {
      throw new NotFoundException(`L’école « ${slug} » n’est pas active.`);
    }
    return school;
  }

  async list(): Promise<School[]> {
    return this.db.registry(async (tx) => {
      const { rows } = await tx.query<School>(
        `SELECT id, slug, name, name_ar, currency, locale, theme_color, logo_emoji, active
           FROM schools WHERE active ORDER BY name`,
      );
      return rows;
    });
  }
}
