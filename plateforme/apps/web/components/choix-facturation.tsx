'use client';

import { useMemo, useState } from 'react';
import {
  MODES_ETUDE,
  SERVICES_CANTINE,
  libelleMode,
  type ModeEtude,
  type Periodicite,
  type ServiceOptionnel,
} from '@elourwa/shared/facturation';
import { mru } from '@/components/hub';

/**
 * LE CATALOGUE D'UNE ANNÉE, TEL QUE LES FORMULAIRES D'INSCRIPTION LE LISENT —
 * facturation « services » (Jinan), spécification §8. Bâti côté serveur par
 * `catalogueFacturation()` (lib/facturation.ts) depuis `GET /finance/tarifs`.
 * Montants en chaînes ; `null` = « non défini ».
 */
export interface CatalogueFacturation {
  anneeLabel: string;
  /** Par id de niveau. */
  niveaux: Record<string, { nom: string; tarif8h14: string | null; tarif8h17: string | null; fraisInscription: string | null }>;
  services: { code: ServiceOptionnel; libelle: string; periodicite: Periodicite; obligatoire: boolean; prix: string | null }[];
}

/** Le tarif d'un niveau pour un mode — `null` si l'un manque ou n'est pas défini. */
export function tarifDuMode(catalogue: CatalogueFacturation, levelId: string | null | undefined, mode: ModeEtude | null): string | null {
  if (!levelId || !mode) return null;
  const n = catalogue.niveaux[levelId];
  if (!n) return null;
  return mode === '8h-14h' ? n.tarif8h14 : n.tarif8h17;
}

/** « 3000.00 » → « 3000 » : ce qu'on propose dans un champ, sans nombre JS. */
export function montantChamp(v: string | null): string {
  if (v === null) return '';
  return v.includes('.') ? v.replace(/0+$/, '').replace(/\.$/, '') : v;
}

// Les libellés du site sont en capitales (`label` global) : dans une carte à
// choisir, le prix doit se lire, en casse normale.
const CARTE: React.CSSProperties = {
  display: 'flex', gap: '.5rem', alignItems: 'center', padding: '.5rem .7rem', borderRadius: 8,
  border: '1.5px solid var(--border)', background: '#fff', cursor: 'pointer', fontSize: '.9rem',
  textTransform: 'none', letterSpacing: 'normal', fontWeight: 400, color: 'var(--text)',
};
const CARTE_ACTIVE: React.CSSProperties = { ...CARTE, borderColor: 'var(--primary)', background: '#fff2eb' };

/**
 * LE MODE D'ÉTUDE, LES FRAIS D'INSCRIPTION, LES SERVICES — le bloc que
 * l'inscription et la réinscription d'une école « services » ajoutent (§8).
 *
 *   - le mode est OBLIGATOIRE (deux boutons radio, `name="study_mode"`,
 *     `required`) : l'API refuse une inscription sans lui ;
 *   - chaque mode montre le tarif du niveau choisi ; `onMode` prévient le
 *     formulaire, qui pré-remplit « Frais mensuel » ;
 *   - les frais d'inscription du niveau sont dits (dus d'office, une fois par
 *     élève — ils ne se cochent pas), et de même, depuis le 04/10/2026
 *     (ADR-0079), la photocopie : UN prix d'école, d'office ;
 *   - la cantine (aucune, petit déjeuner, déjeuner, les deux), la piscine, le
 *     docteur, le transport — chacun avec son prix de l'année ; un service
 *     sans prix ne se coche pas. Le choix part dans `name="services"` (JSON).
 *
 * Rien de tout cela n'existe pour une école « famille » : le formulaire ne
 * rend ce bloc que si on lui a donné un catalogue.
 */
export function ChoixFacturation({
  catalogue,
  levelId,
  mode,
  onMode,
  avecServices = true,
  servicesInitiaux = [],
}: {
  catalogue: CatalogueFacturation;
  levelId: string | null;
  mode: ModeEtude | null;
  onMode: (mode: ModeEtude) => void;
  /** Faux pour la réinscription en lot : le mode seul (§8). */
  avecServices?: boolean;
  servicesInitiaux?: ServiceOptionnel[];
}) {
  const niveau = levelId ? catalogue.niveaux[levelId] : undefined;
  const prixDe = (code: ServiceOptionnel) => catalogue.services.find((s) => s.code === code)?.prix ?? null;
  const cantines = catalogue.services.filter((s) => (SERVICES_CANTINE as readonly string[]).includes(s.code));
  const autres = catalogue.services.filter((s) => !s.obligatoire && !(SERVICES_CANTINE as readonly string[]).includes(s.code));
  // D'office, comme les frais d'inscription : dits, jamais cochés.
  const dOffice = catalogue.services.filter((s) => s.obligatoire);

  const [cantine, setCantine] = useState<ServiceOptionnel | ''>(
    () => servicesInitiaux.find((s) => (SERVICES_CANTINE as readonly string[]).includes(s)) ?? '',
  );
  const [autresCoches, setAutresCoches] = useState<Set<ServiceOptionnel>>(
    () => new Set(servicesInitiaux.filter((s) => !(SERVICES_CANTINE as readonly string[]).includes(s))),
  );
  const choisis = useMemo(
    () => [...(cantine ? [cantine] : []), ...autres.map((s) => s.code).filter((c) => autresCoches.has(c))],
    [cantine, autres, autresCoches],
  );

  const frais = niveau?.fraisInscription ?? null;

  return (
    <fieldset className="choix-facturation" style={{ border: 'none', padding: 0, margin: '1rem 0 0' }}>
      <legend style={{ fontWeight: 700, marginBottom: '.5rem' }}>Mode d&apos;étude *</legend>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '.5rem' }}>
        {MODES_ETUDE.map((m) => {
          const t = tarifDuMode(catalogue, levelId, m);
          const actif = mode === m;
          return (
            <label key={m} style={actif ? CARTE_ACTIVE : CARTE}>
              <input type="radio" name="study_mode" value={m} required checked={actif} onChange={() => onMode(m)} />
              <span style={{ flex: 1 }}>
                <strong>{libelleMode(m)}</strong>
                <br />
                <small className="text-muted">
                  {!levelId ? 'choisissez d’abord le groupe' : t === null ? 'tarif non défini — bouton « Frais »' : `${mru(t)} MRU / mois`}
                </small>
              </span>
            </label>
          );
        })}
      </div>

      {levelId && (
        <p style={{ margin: '.75rem 0 0', fontSize: '.9rem' }} data-testid="frais-inscription">
          <strong>Frais d&apos;inscription {niveau ? `(${niveau.nom})` : ''} : </strong>
          {frais === null ? (
            <span className="text-danger">non définis pour {catalogue.anneeLabel} — l&apos;inscription sera refusée (bouton « Frais »).</span>
          ) : Number(frais) === 0 ? (
            <span>gratuits.</span>
          ) : (
            <span>{mru(frais)} MRU, dus une fois pour cet élève en {catalogue.anneeLabel}.</span>
          )}
        </p>
      )}
      {levelId &&
        dOffice.map((s) => (
          <p key={s.code} style={{ margin: '.35rem 0 0', fontSize: '.9rem' }} data-testid={`frais-${s.code}`}>
            <strong>{s.libelle} : </strong>
            {s.prix === null ? (
              <span className="text-danger">non défini pour {catalogue.anneeLabel} — l&apos;inscription sera refusée (bouton « Frais »).</span>
            ) : Number(s.prix) === 0 ? (
              <span>gratuit.</span>
            ) : (
              <span>
                {mru(s.prix)} MRU {s.periodicite === 'mensuel' ? 'par mois' : `, dus une fois pour cet élève en ${catalogue.anneeLabel}`} — obligatoire, le même pour tous les niveaux.
              </span>
            )}
          </p>
        ))}

      {avecServices && (
        <>
          <input type="hidden" name="services" value={JSON.stringify(choisis)} />
          <h4 style={{ margin: '1rem 0 .5rem' }}>Services ({catalogue.anneeLabel})</h4>
          <div style={{ display: 'grid', gap: '.5rem' }}>
            <div role="radiogroup" aria-label="Cantine" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '.4rem' }}>
              <label style={cantine === '' ? CARTE_ACTIVE : CARTE}>
                <input type="radio" name="choix_cantine" value="" checked={cantine === ''} onChange={() => setCantine('')} />
                <span>Cantine : aucune</span>
              </label>
              {cantines.map((s) => {
                const indisponible = s.prix === null;
                return (
                  <label key={s.code} style={{ ...(cantine === s.code ? CARTE_ACTIVE : CARTE), opacity: indisponible ? 0.55 : 1 }}>
                    <input
                      type="radio"
                      name="choix_cantine"
                      value={s.code}
                      disabled={indisponible}
                      checked={cantine === s.code}
                      onChange={() => setCantine(s.code)}
                    />
                    <span>
                      {s.libelle}
                      <br />
                      <small className="text-muted">{indisponible ? 'prix non défini' : `${mru(s.prix!)} MRU / mois`}</small>
                    </span>
                  </label>
                );
              })}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '.4rem' }}>
              {autres.map((s) => {
                const indisponible = prixDe(s.code) === null;
                const coche = autresCoches.has(s.code);
                return (
                  <label key={s.code} style={{ ...(coche ? CARTE_ACTIVE : CARTE), opacity: indisponible ? 0.55 : 1 }}>
                    <input
                      type="checkbox"
                      value={s.code}
                      aria-label={s.libelle}
                      disabled={indisponible}
                      checked={coche}
                      onChange={(e) =>
                        setAutresCoches((c) => {
                          const n = new Set(c);
                          if (e.target.checked) n.add(s.code);
                          else n.delete(s.code);
                          return n;
                        })
                      }
                    />
                    <span>
                      {s.libelle}
                      <br />
                      <small className="text-muted">
                        {indisponible ? 'prix non défini' : `${mru(s.prix!)} MRU ${s.periodicite === 'mensuel' ? '/ mois' : 'pour l’année'}`}
                      </small>
                    </span>
                  </label>
                );
              })}
            </div>
          </div>
        </>
      )}
    </fieldset>
  );
}
