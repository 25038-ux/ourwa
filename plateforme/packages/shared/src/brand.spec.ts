import { describe, expect, it } from 'vitest';
import {
  LIBELLE_FRAIS_PHOTOCOPIE_DEFAUT,
  MARQUE_DEFAUT,
  deploiementDepuisEnv,
  libelleFraisPhotocopie,
  marqueDepuisEnv,
  slugDeMarque,
} from './brand.js';

describe('le nom du frais annuel « photocopie »', () => {
  it('est celui d’El Ourwa quand rien n’est dit', () => {
    expect(libelleFraisPhotocopie({})).toBe('Frais de photocopie');
    expect(LIBELLE_FRAIS_PHOTOCOPIE_DEFAUT).toBe('Frais de photocopie');
  });

  it('prend le nom de l’école (El Mourad : « Frais Graytna »)', () => {
    expect(libelleFraisPhotocopie({ FEE_PHOTOCOPY_LABEL: 'Frais Graytna' })).toBe('Frais Graytna');
  });

  it('ignore une valeur vide ou faite d’espaces', () => {
    expect(libelleFraisPhotocopie({ FEE_PHOTOCOPY_LABEL: '   ' })).toBe('Frais de photocopie');
    expect(libelleFraisPhotocopie({ FEE_PHOTOCOPY_LABEL: '  Frais Graytna ' })).toBe('Frais Graytna');
  });
});

describe('la marque', () => {
  it('est El Ourwa quand rien n’est dit', () => {
    expect(marqueDepuisEnv({})).toEqual(MARQUE_DEFAUT);
  });

  it('se renomme entièrement depuis l’environnement', () => {
    const m = marqueDepuisEnv({ BRAND_NAME: 'El Mourad', BRAND_NAME_AR: 'المراد' });
    expect(m.nom).toBe('El Mourad');
    expect(m.nomAr).toBe('المراد');
    expect(m.slug).toBe('elmourad');
    expect(m.expediteur).toBe('no-reply@elmourad.mr');
    expect(m.sousTitre).toBe('Plateforme de gestion scolaire');
  });

  it('un autre nom sans arabe garde le nom latin, pas l’arabe d’El Ourwa', () => {
    expect(marqueDepuisEnv({ BRAND_NAME: 'École Test' }).nomAr).toBe('École Test');
  });

  it('dérive le slug des seules lettres et chiffres', () => {
    expect(slugDeMarque('El Mourad')).toBe('elmourad');
    expect(slugDeMarque('École Nour 2')).toBe('ecolenour2');
    expect(slugDeMarque('!!!')).toBe('elourwa');
  });

  it('refuse un slug de marque mal formé', () => {
    expect(() => marqueDepuisEnv({ BRAND_SLUG: 'El Mourad' })).toThrow(/BRAND_SLUG/);
    expect(() => marqueDepuisEnv({ BRAND_SLUG: '1abc' })).toThrow(/BRAND_SLUG/);
  });

  it('ignore les espaces autour des valeurs', () => {
    expect(marqueDepuisEnv({ BRAND_NAME: '  El Mourad  ' }).nom).toBe('El Mourad');
    expect(marqueDepuisEnv({ BRAND_NAME: '   ' })).toEqual(MARQUE_DEFAUT);
  });
});

describe('le déploiement', () => {
  it('est multi-écoles avec console par défaut', () => {
    expect(deploiementDepuisEnv({})).toEqual({ ecoleUnique: null, console: true });
  });

  it('une école unique retire la console', () => {
    expect(deploiementDepuisEnv({ SINGLE_SCHOOL_SLUG: 'elmourad' })).toEqual({ ecoleUnique: 'elmourad', console: false });
  });

  it('la console peut être gardée ou retirée explicitement', () => {
    expect(deploiementDepuisEnv({ SINGLE_SCHOOL_SLUG: 'elmourad', PLATFORM_CONSOLE: 'on' }).console).toBe(true);
    expect(deploiementDepuisEnv({ PLATFORM_CONSOLE: 'off' })).toEqual({ ecoleUnique: null, console: false });
  });

  it('refuse un slug d’école unique invalide au lieu de l’ignorer', () => {
    expect(() => deploiementDepuisEnv({ SINGLE_SCHOOL_SLUG: 'admin' })).toThrow(/SINGLE_SCHOOL_SLUG/);
    expect(() => deploiementDepuisEnv({ SINGLE_SCHOOL_SLUG: '123' })).toThrow(/SINGLE_SCHOOL_SLUG/);
    expect(() => deploiementDepuisEnv({ SINGLE_SCHOOL_SLUG: 'El Mourad' })).toThrow(/SINGLE_SCHOOL_SLUG/);
    expect(() => deploiementDepuisEnv({ PLATFORM_CONSOLE: 'peut-être' })).toThrow(/PLATFORM_CONSOLE/);
  });
});
