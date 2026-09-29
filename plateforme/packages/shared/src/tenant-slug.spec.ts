import { describe, expect, it } from 'vitest';
import { hoteAvecSlug, slugDepuisHote } from './tenant-slug.js';

describe('l’école dans le nom d’hôte', () => {
  it('lit la première étiquette', () => {
    expect(slugDepuisHote('nour.localhost:3000')).toBe('nour');
    expect(slugDepuisHote('rissala.elourwa.duckdns.org')).toBe('rissala');
    expect(slugDepuisHote('Ecole-1.example.com')).toBe('ecole-1');
  });

  it('ne fait pas une école d’admin, de www, d’une IP ou d’un hôte nu', () => {
    expect(slugDepuisHote('admin.localhost:3000')).toBeNull();
    expect(slugDepuisHote('www.example.com')).toBeNull();
    expect(slugDepuisHote('127.0.0.1:3000')).toBeNull();
    expect(slugDepuisHote('[::1]:3000')).toBeNull();
    expect(slugDepuisHote('localhost:3000')).toBeNull();
    expect(slugDepuisHote('123.example.com')).toBeNull();
    expect(slugDepuisHote('_x.example.com')).toBeNull();
    expect(slugDepuisHote(null)).toBeNull();
    expect(slugDepuisHote(undefined)).toBeNull();
  });

  it('en école unique, tout hôte est cette école', () => {
    for (const h of ['elmourad.mr', 'www.elmourad.mr', 'admin.elmourad.mr', '10.0.0.5:3000', 'localhost:3000', 'autre.elmourad.mr', null]) {
      expect(slugDepuisHote(h, 'elmourad')).toBe('elmourad');
    }
  });
});

describe('le même hôte pour une autre école', () => {
  it('remplace la première étiquette et garde le port', () => {
    expect(hoteAvecSlug('admin.localhost:3000', 'nour')).toBe('nour.localhost:3000');
    expect(hoteAvecSlug('nour.localhost:3000', null)).toBe('admin.localhost:3000');
    expect(hoteAvecSlug('admin.elourwa.duckdns.org', 'salam')).toBe('salam.elourwa.duckdns.org');
  });

  it('préfixe un hôte sans sous-domaine', () => {
    expect(hoteAvecSlug('localhost:3000', 'nour')).toBe('nour.localhost:3000');
  });
});
