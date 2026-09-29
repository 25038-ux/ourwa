import { afterEach, describe, expect, it } from 'vitest';
import { TenantService } from './tenant.service.js';

/**
 * Host -> slug resolution. Pure, so it is tested directly without a database.
 *
 * The case that matters most is `admin.` returning null: the platform console
 * must NOT resolve to a school, or a caller could reach tenant data by pretending
 * to be it. "Unknown host -> 404, never a default tenant" (ARCHITECTURE.md §4).
 */
const service = new TenantService(null as never, null as never);

describe('slugFromHost', () => {
  it('reads the branch from a subdomain', () => {
    expect(service.slugFromHost('nour.localhost:3000')).toBe('nour');
    expect(service.slugFromHost('rissala.localhost')).toBe('rissala');
    expect(service.slugFromHost('salam.platform.app:443')).toBe('salam');
  });

  it('is case-insensitive', () => {
    expect(service.slugFromHost('NOUR.Localhost:3000')).toBe('nour');
  });

  it('refuses to treat the platform console as a school', () => {
    expect(service.slugFromHost('admin.localhost:3000')).toBeNull();
    expect(service.slugFromHost('www.platform.app')).toBeNull();
  });

  it('returns null rather than guessing when there is no subdomain', () => {
    expect(service.slugFromHost('localhost:3000')).toBeNull();
    expect(service.slugFromHost('')).toBeNull();
    expect(service.slugFromHost(undefined)).toBeNull();
  });

  it('never falls back to a default tenant', () => {
    // Every unresolvable host must be null. A default here would silently serve
    // one school's data to anyone who got the hostname wrong.
    for (const host of ['', 'localhost', 'admin.localhost', '127.0.0.1:3000']) {
      expect(service.slugFromHost(host)).toBeNull();
    }
  });
});

describe('slugFromHost en école unique', () => {
  afterEach(() => {
    delete process.env.SINGLE_SCHOOL_SLUG;
  });

  it('rend cette école pour tout hôte, même admin., www., une IP ou rien', () => {
    process.env.SINGLE_SCHOOL_SLUG = 'elmourad';
    for (const host of ['elmourad.mr', 'www.elmourad.mr', 'admin.elmourad.mr', '127.0.0.1:3001', 'localhost', '', undefined]) {
      expect(service.slugFromHost(host)).toBe('elmourad');
    }
    expect(service.ecoleUnique()).toBe('elmourad');
  });

  it('refuse un slug d’école unique invalide au lieu de l’ignorer', () => {
    process.env.SINGLE_SCHOOL_SLUG = 'admin';
    expect(() => service.slugFromHost('x.example.com')).toThrow(/SINGLE_SCHOOL_SLUG/);
  });

  it('sans la variable, rien ne change', () => {
    expect(service.ecoleUnique()).toBeNull();
    expect(service.slugFromHost('admin.localhost:3000')).toBeNull();
  });
});
