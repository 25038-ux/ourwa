import type { Queryable } from '@elourwa/db';

/**
 * LE PROCHAIN NUMÉRO D'UN DOCUMENT DE L'ÉCOLE — bon de dépense, reçu de prêt…
 *
 * El Ourwa numérote ses documents avec l'entier auto-incrémenté de la ligne :
 * 'DEP-' . str_pad($id, 6, '0'). Nos identifiants sont des UUID ; ce compteur
 * par école et par sorte rend le même numéro, pris sous verrou dans la
 * transaction de l'écriture (règle 10 : jamais MAX()+1).
 */
export async function nextDocumentNumber(
  tx: Queryable,
  schoolId: string,
  kind: string,
): Promise<number> {
  await tx.query(
    `INSERT INTO document_sequences (school_id, kind, last_number)
     VALUES ($1, $2, 0) ON CONFLICT DO NOTHING`,
    [schoolId, kind],
  );
  const { rows } = await tx.query<{ last_number: number }>(
    `UPDATE document_sequences SET last_number = last_number + 1
      WHERE school_id = $1 AND kind = $2 RETURNING last_number`,
    [schoolId, kind],
  );
  return rows[0]!.last_number;
}

/** `str_pad($id, 6, '0', STR_PAD_LEFT)` derrière son préfixe. */
export function numeroDocument(prefix: string, n: number): string {
  return `${prefix}-${String(n).padStart(6, '0')}`;
}
