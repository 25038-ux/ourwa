import { afterEach, describe, expect, it } from 'vitest';
import {
  MODELES_FACTURATION,
  MODELE_FACTURATION_DEFAUT,
  MODES_ETUDE,
  SERVICES,
  SERVICES_CANTINE,
  SERVICES_OPTIONNELS,
  SERVICE_CODES,
  SOURCES_SERVICES,
  comparerEcheancesService,
  definitionService,
  estModeEtude,
  estModeleFacturation,
  estServiceCode,
  estServiceOptionnel,
  estSourceService,
  familleService,
  libelleMode,
  libelleService,
  libelleSourceService,
  sourceTypeService,
} from './facturation.js';

/**
 * LE CATALOGUE DE LA FACTURATION « SERVICES » — ADR-0073,
 * docs/specs/jinan-facturation.md §1, §2, §4, §5, §10.
 *
 * Ce sont des valeurs que la base contrôle aussi (CHECK de 0042) : si l'une
 * bouge ici sans bouger là-bas, l'écran propose ce que la base refuse. Le test
 * les épingle mot pour mot.
 */

describe('le modèle de facturation', () => {
  it('a deux valeurs, « famille » par défaut (El Ourwa inchangé)', () => {
    expect(MODELES_FACTURATION).toEqual(['famille', 'services']);
    expect(MODELE_FACTURATION_DEFAUT).toBe('famille');
  });

  it('reconnaît ses valeurs et rien d’autre', () => {
    expect(estModeleFacturation('famille')).toBe(true);
    expect(estModeleFacturation('services')).toBe(true);
    for (const v of ['eleve', '', null, undefined, 'Services']) {
      expect(estModeleFacturation(v)).toBe(false);
    }
  });
});

describe('les modes d’étude (§2)', () => {
  it('sont deux, fixes, dans cet ordre', () => {
    expect(MODES_ETUDE).toEqual(['8h-14h', '8h-17h']);
  });

  it('s’affichent « 8h – 14h » et « 8h – 17h » (tiret demi-cadratin)', () => {
    expect(libelleMode('8h-14h')).toBe('8h – 14h');
    expect(libelleMode('8h-17h')).toBe('8h – 17h');
  });

  it('n’affichent rien pour une inscription sans mode (école « famille »)', () => {
    expect(libelleMode(null)).toBe('');
    expect(libelleMode(undefined)).toBe('');
  });

  it('refusent toute autre valeur', () => {
    expect(estModeEtude('8h-14h')).toBe(true);
    expect(estModeEtude('8h-17h')).toBe(true);
    for (const v of ['8h-12h', '8h – 14h', '', null, undefined, 814]) {
      expect(estModeEtude(v)).toBe(false);
    }
  });
});

describe('le catalogue des services (§4)', () => {
  afterEach(() => {
    delete process.env.FEE_PHOTOCOPY_LABEL;
  });

  it('compte sept services, dans l’ordre de la spécification', () => {
    expect(SERVICE_CODES).toEqual([
      'cantine_petit_dejeuner',
      'cantine_dejeuner',
      'cantine_complet',
      'piscine',
      'docteur',
      'photocopie',
      'inscription',
    ]);
    expect(SERVICES.map((s) => s.code)).toEqual([...SERVICE_CODES]);
  });

  it('porte les libellés de la spécification', () => {
    expect(SERVICES.map((s) => [s.code, s.libelle])).toEqual([
      ['cantine_petit_dejeuner', 'Cantine — petit déjeuner'],
      ['cantine_dejeuner', 'Cantine — déjeuner'],
      ['cantine_complet', 'Cantine — petit déjeuner + déjeuner'],
      ['piscine', 'Piscine'],
      ['docteur', 'Docteur'],
      ['photocopie', 'Frais de photocopie'],
      ['inscription', "Frais d'inscription"],
    ]);
  });

  it('mensuels : les cantines, la piscine, le docteur ; annuels : photocopie et inscription', () => {
    const periodicite = Object.fromEntries(SERVICES.map((s) => [s.code, s.periodicite]));
    expect(periodicite).toEqual({
      cantine_petit_dejeuner: 'mensuel',
      cantine_dejeuner: 'mensuel',
      cantine_complet: 'mensuel',
      piscine: 'mensuel',
      docteur: 'mensuel',
      photocopie: 'annuel',
      inscription: 'annuel',
    });
  });

  it('⚠ les trois cantines forment UNE famille (exclusives), les autres la leur', () => {
    expect(SERVICES_CANTINE).toEqual(['cantine_petit_dejeuner', 'cantine_dejeuner', 'cantine_complet']);
    for (const c of SERVICES_CANTINE) expect(familleService(c)).toBe('cantine');
    for (const c of ['piscine', 'docteur', 'photocopie', 'inscription'] as const) {
      expect(familleService(c)).toBe(c);
    }
  });

  it('⚠ l’inscription seule est obligatoire, et son prix est celui du niveau', () => {
    expect(SERVICES.filter((s) => !s.optionnel).map((s) => s.code)).toEqual(['inscription']);
    expect(SERVICES.filter((s) => s.prixPar === 'niveau').map((s) => s.code)).toEqual(['inscription']);
    expect(SERVICES_OPTIONNELS).toEqual([
      'cantine_petit_dejeuner',
      'cantine_dejeuner',
      'cantine_complet',
      'piscine',
      'docteur',
      'photocopie',
    ]);
    expect(estServiceOptionnel('inscription')).toBe(false);
    expect(estServiceOptionnel('piscine')).toBe(true);
  });

  it('reconnaît ses codes et rien d’autre', () => {
    for (const c of SERVICE_CODES) expect(estServiceCode(c)).toBe(true);
    for (const v of ['transport', 'cantine', '', null, undefined, 3]) {
      expect(estServiceCode(v)).toBe(false);
      expect(estServiceOptionnel(v)).toBe(false);
    }
  });

  it('refuse bruyamment un code inconnu plutôt que de rendre undefined', () => {
    expect(definitionService('piscine').libelle).toBe('Piscine');
    expect(() => definitionService('transport' as never)).toThrow(/transport/);
  });

  it('⚠ la photocopie porte le nom de l’école, lu à l’affichage (FEE_PHOTOCOPY_LABEL)', () => {
    expect(libelleService('photocopie')).toBe('Frais de photocopie');
    process.env.FEE_PHOTOCOPY_LABEL = 'Frais Graytna';
    expect(libelleService('photocopie')).toBe('Frais Graytna');
    expect(definitionService('photocopie').libelle).toBe('Frais Graytna');
    expect(SERVICES.find((s) => s.code === 'photocopie')!.libelle).toBe('Frais Graytna');
  });

  it('accepte le nom de la photocopie en argument (le site le lit côté serveur)', () => {
    expect(libelleService('photocopie', 'Frais Graytna')).toBe('Frais Graytna');
    expect(libelleService('piscine', 'Frais Graytna')).toBe('Piscine');
  });

  it('est figé : on ne réécrit pas un service par accident', () => {
    expect(Object.isFrozen(SERVICES)).toBe(true);
    for (const s of SERVICES) expect(Object.isFrozen(s)).toBe(true);
  });
});

describe('les moyens encaissés par service (§5, §10)', () => {
  it('un source_type par famille de service, préfixé service_', () => {
    expect(SOURCES_SERVICES).toEqual([
      'service_cantine',
      'service_piscine',
      'service_docteur',
      'service_photocopie',
      'service_inscription',
    ]);
    expect(sourceTypeService('cantine_petit_dejeuner')).toBe('service_cantine');
    expect(sourceTypeService('cantine_dejeuner')).toBe('service_cantine');
    expect(sourceTypeService('cantine_complet')).toBe('service_cantine');
    expect(sourceTypeService('piscine')).toBe('service_piscine');
    expect(sourceTypeService('docteur')).toBe('service_docteur');
    expect(sourceTypeService('photocopie')).toBe('service_photocopie');
    expect(sourceTypeService('inscription')).toBe('service_inscription');
  });

  it('⚠ aucun ne recouvre un source_type existant (les revenus se sépareraient mal)', () => {
    const existants = [
      'paiement', 'frais_annuel', 'cours_soir', 'cours_soir_prof', 'depense', 'salaire',
      'salaire_prof', 'salaire_staff', 'pret_personnel', 'pret_remb', 'dette',
      'dette_creation', 'admin_retrait',
    ];
    for (const s of SOURCES_SERVICES) expect(existants).not.toContain(s);
  });

  it('se lisent dans les rapports sous les libellés de la spécification', () => {
    expect(libelleSourceService('service_cantine')).toBe('Cantine');
    expect(libelleSourceService('service_piscine')).toBe('Piscine');
    expect(libelleSourceService('service_docteur')).toBe('Docteur');
    expect(libelleSourceService('service_photocopie')).toBe('Frais de photocopie');
    expect(libelleSourceService('service_photocopie', 'Frais Graytna')).toBe('Frais Graytna');
    expect(libelleSourceService('service_inscription')).toBe("Frais d'inscription (élève)");
  });

  it('reconnaît ses source_type et rien d’autre', () => {
    for (const s of SOURCES_SERVICES) expect(estSourceService(s)).toBe(true);
    for (const v of ['paiement', 'frais_annuel', 'service_transport', '', null]) {
      expect(estSourceService(v)).toBe(false);
    }
  });
});

describe('l’ordre des échéances de service (§7)', () => {
  it('les annuels d’abord (ordre du catalogue), puis mois par mois, et dans un mois l’ordre du catalogue', () => {
    // L'ordre de la fenêtre est celui de l'allocation des moyens et celui du
    // reçu : le même partout, ou un reçu imprimé ne dirait pas quel moyen a
    // payé quelle ligne.
    const e = (service: (typeof SERVICE_CODES)[number], month: number, year: number) => ({ service, month, year });
    const melange = [
      e('piscine', 11, 2025),
      e('cantine_dejeuner', 1, 2026),
      e('inscription', 10, 2025),
      e('piscine', 10, 2025),
      e('docteur', 10, 2025),
      e('photocopie', 10, 2025),
      e('cantine_dejeuner', 10, 2025),
      e('cantine_complet', 2, 2026),
    ];
    expect([...melange].sort(comparerEcheancesService).map((x) => `${x.service} ${x.month}/${x.year}`)).toEqual([
      'photocopie 10/2025',
      'inscription 10/2025',
      'cantine_dejeuner 10/2025',
      'piscine 10/2025',
      'docteur 10/2025',
      'piscine 11/2025',
      'cantine_dejeuner 1/2026',
      'cantine_complet 2/2026',
    ]);
  });

  it('deux annuels du même service se rangent par leur échéance', () => {
    const a = { service: 'photocopie' as const, month: 2, year: 2026 };
    const b = { service: 'photocopie' as const, month: 11, year: 2025 };
    expect([a, b].sort(comparerEcheancesService)).toEqual([b, a]);
    expect(comparerEcheancesService(a, a)).toBe(0);
  });
});
