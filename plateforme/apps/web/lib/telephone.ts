/** « 22 12 34 56 » — la forme canonique (huit chiffres) rendue lisible. Sans 'use client' : sert aux deux côtés. */
export function formatTelephone(brut: string | null | undefined): string {
  const chiffres = (brut ?? '').replace(/\D/g, '');
  if (chiffres.length !== 8) return brut ?? '';
  return chiffres.replace(/(\d{2})(?=\d)/g, '$1 ');
}
