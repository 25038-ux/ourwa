/**
 * LE TYPE RÉEL D'UN FICHIER TÉLÉVERSÉ — une règle, lue par l'API (qui décide)
 * et par le site (qui prévient avant d'envoyer).
 *
 * Les trois contrôles d'El Ourwa (`includes/upload.php`) restent : le type est
 * lu dans les OCTETS, jamais dans ce que le navigateur annonce ; l'extension
 * doit concorder avec ce contenu ; la taille est bornée.
 *
 * ⚠ LES DOCUMENTS DE BUREAU (04/10/2026, Jinan : « envoyer exercice : you
 * can't send any document there »). Un exercice, c'est souvent une fiche Word ;
 * la liste n'acceptait que JPG, PNG, WebP, GIF et PDF, et le sélecteur du
 * professeur grisait tout le reste sur le téléphone. Sont admis en plus :
 *   - Word, Excel, PowerPoint (OOXML : .docx .xlsx .pptx) — une archive ZIP
 *     qui CONTIENT `[Content_Types].xml` (un .zip renommé ne passe pas) ;
 *   - OpenDocument (.odt .ods .odp) — une archive ZIP dont la première entrée
 *     `mimetype` dit `application/vnd.oasis.opendocument.*` ;
 *   - les anciens formats (.doc .xls .ppt) — le conteneur OLE2 (D0 CF 11 E0) ;
 *   - RTF (`{\rtf`).
 * Les formats à macros (.docm, .xlsm…) restent refusés.
 */

/** 10 Mo : une photo de téléphone dépasse souvent 5 Mo (l'ancienne borne). */
export const MAX_OCTETS_FICHIER = 10 * 1024 * 1024;

export type FamilleFichier = 'image' | 'pdf' | 'bureau';

interface TypeAdmis {
  extensions: string[];
  famille: FamilleFichier;
  libelle: string;
}

/** Type réel → les extensions qui peuvent l'accompagner. */
export const TYPES_ADMIS: Record<string, TypeAdmis> = {
  'image/jpeg': { extensions: ['jpg', 'jpeg'], famille: 'image', libelle: 'JPG' },
  'image/png': { extensions: ['png'], famille: 'image', libelle: 'PNG' },
  'image/webp': { extensions: ['webp'], famille: 'image', libelle: 'WebP' },
  'image/gif': { extensions: ['gif'], famille: 'image', libelle: 'GIF' },
  'application/pdf': { extensions: ['pdf'], famille: 'pdf', libelle: 'PDF' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { extensions: ['docx'], famille: 'bureau', libelle: 'Word' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { extensions: ['xlsx'], famille: 'bureau', libelle: 'Excel' },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { extensions: ['pptx'], famille: 'bureau', libelle: 'PowerPoint' },
  'application/vnd.oasis.opendocument.text': { extensions: ['odt'], famille: 'bureau', libelle: 'OpenDocument' },
  'application/vnd.oasis.opendocument.spreadsheet': { extensions: ['ods'], famille: 'bureau', libelle: 'OpenDocument' },
  'application/vnd.oasis.opendocument.presentation': { extensions: ['odp'], famille: 'bureau', libelle: 'OpenDocument' },
  'application/msword': { extensions: ['doc'], famille: 'bureau', libelle: 'Word' },
  'application/vnd.ms-excel': { extensions: ['xls'], famille: 'bureau', libelle: 'Excel' },
  'application/vnd.ms-powerpoint': { extensions: ['ppt'], famille: 'bureau', libelle: 'PowerPoint' },
  'application/rtf': { extensions: ['rtf'], famille: 'bureau', libelle: 'RTF' },
};

/** Pour l'attribut `accept` d'un `<input type="file">` : les extensions, pas `image/*` (qui laisserait passer le HEIC). */
export function acceptPour(familles: readonly FamilleFichier[]): string {
  return Object.values(TYPES_ADMIS)
    .filter((t) => familles.includes(t.famille))
    .flatMap((t) => t.extensions.map((e) => `.${e}`))
    .join(',');
}

/** « PDF, Word, Excel, … » — pour les messages. */
export function libellesPour(familles: readonly FamilleFichier[]): string {
  return [...new Set(Object.values(TYPES_ADMIS).filter((t) => familles.includes(t.famille)).map((t) => t.libelle))].join(', ');
}

function commencePar(o: Uint8Array, signature: number[] | string, decalage = 0): boolean {
  const s = typeof signature === 'string' ? Array.from(signature, (c) => c.charCodeAt(0)) : signature;
  if (o.length < decalage + s.length) return false;
  return s.every((b, i) => o[decalage + i] === b);
}

/** La chaîne `aiguille` (ASCII) se trouve-t-elle dans les octets ? */
function contient(o: Uint8Array, aiguille: string, jusqua = o.length): boolean {
  const a = Array.from(aiguille, (c) => c.charCodeAt(0));
  const fin = Math.min(o.length, jusqua) - a.length;
  outer: for (let i = 0; i <= fin; i++) {
    for (let j = 0; j < a.length; j++) if (o[i + j] !== a[j]) continue outer;
    return true;
  }
  return false;
}

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

/**
 * Le type réel de ces octets, compte tenu du nom (un conteneur ZIP ou OLE ne
 * dit pas lui-même s'il est Word ou Excel : l'extension choisit, parmi les
 * types que CE conteneur peut être). `null` : rien d'admis.
 */
export function typeReel(o: Uint8Array, nomFichier: string): string | null {
  const ext = (nomFichier.split('.').pop() ?? '').toLowerCase();
  if (commencePar(o, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (commencePar(o, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (commencePar(o, 'GIF87a') || commencePar(o, 'GIF89a')) return 'image/gif';
  // RIFF, quatre octets de longueur, puis WEBP : sans le second contrôle, un .wav passerait.
  if (commencePar(o, 'RIFF') && commencePar(o, 'WEBP', 8)) return 'image/webp';
  if (commencePar(o, '%PDF-')) return 'application/pdf';
  if (commencePar(o, '{\\rtf')) return 'application/rtf';
  if (commencePar(o, OLE)) {
    const parExt: Record<string, string> = { doc: 'application/msword', xls: 'application/vnd.ms-excel', ppt: 'application/vnd.ms-powerpoint' };
    return parExt[ext] ?? 'application/x-ole-inconnu';
  }
  if (commencePar(o, ZIP)) {
    // OpenDocument : l'entrée `mimetype`, non compressée, en tête d'archive.
    if (contient(o, 'application/vnd.oasis.opendocument.', 200)) {
      const parExt: Record<string, string> = {
        odt: 'application/vnd.oasis.opendocument.text',
        ods: 'application/vnd.oasis.opendocument.spreadsheet',
        odp: 'application/vnd.oasis.opendocument.presentation',
      };
      return parExt[ext] ?? 'application/x-zip-inconnu';
    }
    // OOXML : `[Content_Types].xml` est nommé dans l'archive (en tête, et dans
    // le répertoire central à la fin) — un .zip quelconque ne l'a pas.
    if (contient(o, '[Content_Types].xml')) {
      const parExt: Record<string, string> = {
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      };
      return parExt[ext] ?? 'application/x-zip-inconnu';
    }
    return null;
  }
  return null;
}

/**
 * Le verdict complet : `{ mime }` ou `{ refus }` (le message, en français).
 * `familles` : ce que l'écran admet (un document signé : PDF et images).
 */
export function verifierFichier(
  o: Uint8Array,
  nomFichier: string,
  familles: readonly FamilleFichier[] = ['image', 'pdf', 'bureau'],
  maxOctets = MAX_OCTETS_FICHIER,
): { mime: string } | { refus: string } {
  if (o.length === 0) return { refus: 'Fichier vide.' };
  if (o.length > maxOctets) return { refus: `Fichier trop volumineux (max ${maxOctets / 1024 / 1024} Mo).` };
  const mime = typeReel(o, nomFichier);
  const admis = mime ? TYPES_ADMIS[mime] : undefined;
  if (!admis || !familles.includes(admis.famille)) {
    return { refus: `Type de fichier non autorisé. Acceptés : ${libellesPour(familles)}.` };
  }
  const ext = (nomFichier.split('.').pop() ?? '').toLowerCase();
  if (!admis.extensions.includes(ext)) return { refus: "L'extension du fichier ne correspond pas à son type réel." };
  return { mime: mime! };
}
