import { describe, expect, it } from 'vitest';
import { acceptPour, MAX_OCTETS_FICHIER, typeReel, verifierFichier } from './fichiers';

const b = (...parts: (string | number[])[]) =>
  new Uint8Array(parts.flatMap((p) => (typeof p === 'string' ? Array.from(p, (c) => c.charCodeAt(0)) : p)));

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const DOCX = b(ZIP, 'xxxxxxxxxxxxxxxxxxxxxxxxxx[Content_Types].xml', 'contenu');
const ODT = b(ZIP, 'xxxxxxxxxxxxxxxxxxxxxxxxxxmimetypeapplication/vnd.oasis.opendocument.text', 'contenu');
const PDF = b('%PDF-1.7\n', 'contenu');

describe('le type réel d’un fichier', () => {
  it('admet une fiche Word, Excel, PowerPoint (OOXML), OpenDocument, les anciens formats et RTF', () => {
    expect(verifierFichier(DOCX, 'Fiche.DOCX')).toEqual({ mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    expect(verifierFichier(DOCX, 'notes.xlsx')).toEqual({ mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    expect(verifierFichier(DOCX, 'cours.pptx')).toEqual({ mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' });
    expect(verifierFichier(ODT, 'devoir.odt')).toEqual({ mime: 'application/vnd.oasis.opendocument.text' });
    expect(verifierFichier(b(OLE, 'reste'), 'ancien.doc')).toEqual({ mime: 'application/msword' });
    expect(verifierFichier(b(OLE, 'reste'), 'ancien.xls')).toEqual({ mime: 'application/vnd.ms-excel' });
    expect(verifierFichier(b('{\\rtf1 bonjour}'), 'texte.rtf')).toEqual({ mime: 'application/rtf' });
    expect(verifierFichier(PDF, 'sujet.pdf')).toEqual({ mime: 'application/pdf' });
  });

  it('⚠ refuse un .zip quelconque renommé .docx', () => {
    expect(verifierFichier(b(ZIP, 'xxxxxxxxxxxxxxxxxxxxxxxxxxvirus.exe'), 'fiche.docx')).toEqual({
      refus: expect.stringMatching(/non autorisé/),
    });
  });

  it('⚠ refuse un format à macros et un conteneur OLE sans extension connue', () => {
    expect('refus' in verifierFichier(DOCX, 'fiche.docm')).toBe(true);
    expect('refus' in verifierFichier(b(OLE, 'x'), 'installeur.msi')).toBe(true);
  });

  it('⚠ refuse un script déguisé et une extension qui ment', () => {
    expect(typeReel(b('<?php system($_GET["c"]); ?>'), 'photo.png')).toBeNull();
    expect(verifierFichier(PDF, 'photo.png')).toEqual({ refus: "L'extension du fichier ne correspond pas à son type réel." });
    expect(verifierFichier(b('RIFF', [0, 0, 0, 0], 'WAVE'), 'a.webp')).toEqual({ refus: expect.stringMatching(/non autorisé/) });
  });

  it('borne la taille à 10 Mo et refuse le vide', () => {
    expect(MAX_OCTETS_FICHIER).toBe(10 * 1024 * 1024);
    expect(verifierFichier(new Uint8Array(0), 'x.pdf')).toEqual({ refus: 'Fichier vide.' });
    const gros = new Uint8Array(MAX_OCTETS_FICHIER + 1);
    gros.set(Array.from('%PDF-', (c) => c.charCodeAt(0)));
    expect(verifierFichier(gros, 'x.pdf')).toEqual({ refus: 'Fichier trop volumineux (max 10 Mo).' });
  });

  it('un document signé n’admet que PDF et images', () => {
    expect(verifierFichier(DOCX, 'contrat.docx', ['pdf', 'image'])).toEqual({ refus: 'Type de fichier non autorisé. Acceptés : JPG, PNG, WebP, GIF, PDF.' });
    expect(verifierFichier(PDF, 'contrat.pdf', ['pdf', 'image'])).toEqual({ mime: 'application/pdf' });
    expect(acceptPour(['pdf', 'image'])).toBe('.jpg,.jpeg,.png,.webp,.gif,.pdf');
  });
});
