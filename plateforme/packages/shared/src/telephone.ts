/**
 * LE NUMÉRO DE TÉLÉPHONE MAURITANIEN — l'identifiant des familles.
 *
 * Un numéro mauritanien fait huit chiffres et commence par 2, 3 ou 4
 * (Mauritel, Chinguitel, Mattel ; le fixe 45 compris). L'indicatif +222 (ou
 * 00222) est admis à la saisie et retiré : la forme canonique est les huit
 * chiffres, sans espace, sans tiret, sans indicatif — c'est ainsi que
 * `parents.telephone` d'El Ourwa porte les siens (299 numéros réels, tous à
 * huit chiffres), et c'est ce qu'un parent tape.
 *
 * Décision du propriétaire (2026-09-14) : l'application des familles est UNE
 * pour toutes les branches, et un parent s'y connecte avec son numéro
 * mauritanien, strictement — rien d'autre n'est accepté comme identifiant.
 */
export const TELEPHONE_MAURITANIEN = /^[234][0-9]{7}$/;

/**
 * La forme canonique d'un numéro mauritanien, ou `null` si ce n'en est pas un.
 *
 *   « 22 12 34 56 »      → « 22123456 »
 *   « +222 22-12-34-56 » → « 22123456 »
 *   « 0022222123456 »    → « 22123456 »
 *   « 12345678 »         → null (ne commence pas par 2, 3 ou 4)
 *   « SANSTEL-0042 »     → null (le marqueur « sans téléphone » de la reprise)
 */
export function telephoneMauritanien(brut: string | null | undefined): string | null {
  if (!brut) return null;
  let chiffres = brut.replace(/[^0-9+]/g, '');
  if (chiffres.startsWith('+')) chiffres = chiffres.slice(1);
  if (chiffres.startsWith('00222')) chiffres = chiffres.slice(5);
  else if (chiffres.startsWith('222') && chiffres.length === 11) chiffres = chiffres.slice(3);
  return TELEPHONE_MAURITANIEN.test(chiffres) ? chiffres : null;
}

/** La phrase de refus, la même à chaque porte. */
export const TELEPHONE_MAURITANIEN_REFUS =
  'Numéro mauritanien attendu : 8 chiffres commençant par 2, 3 ou 4 (indicatif +222 facultatif).';
