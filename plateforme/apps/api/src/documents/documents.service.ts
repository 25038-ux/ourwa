import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { libelleService, SERVICE_CODES, type ServiceCode } from '@elourwa/shared/facturation';
import { DbService } from '../db/db.service.js';
import type { Queryable } from '@elourwa/db';
import { AuditService } from '../audit/audit.service.js';
import { AcademicYearService, type AcademicYear } from '../academic/academic-year.service.js';
import { NotificationsService } from '../parent/notifications.service.js';
import { currentTenant } from '../tenant/tenant.context.js';
import { deleteStored, readStored, storeUpload, UploadRejected } from '../attachments/storage.js';

/**
 * LES DOCUMENTS SIGNÉS — ADR-0080, migration 0048. Demande du propriétaire de
 * Jinan (04/10/2026) :
 *
 *   « Each service has a signed document and inscription has a signed
 *     document … a placeholder for every service the parent chose for either
 *     one of his children + inscription + photocopie. The documents are
 *     available to see and delete or replace anytime by the admin and they
 *     can only be seen by the parent. »
 *
 * Une PIÈCE est l'emplacement d'un document, par élève et par année :
 * l'inscription et la photocopie toujours, puis chaque service souscrit cette
 * année-là (même arrêté depuis : le contrat signé reste le sien). Une pièce
 * porte un document au plus ; « Remplacer » efface l'ancien fichier une fois
 * le nouveau enregistré.
 *
 * ⚠ UN DOCUMENT SIGNÉ EST UN SCAN OU UNE PHOTO : PDF et images seulement — pas
 * un fichier Word qu'on pourrait retoucher (la base le refuse aussi).
 */

/** L'ordre des pièces à l'écran : l'inscription, la photocopie, puis les services du catalogue. */
export const ORDRE_PIECES: readonly ServiceCode[] = [
  'inscription',
  'photocopie',
  ...SERVICE_CODES.filter((c) => c !== 'inscription' && c !== 'photocopie'),
];
const TOUJOURS: readonly ServiceCode[] = ['inscription', 'photocopie'];

/**
 * Le nom d'une pièce : celui du service, sauf pour les deux frais annuels —
 * le document signé est « l'inscription », pas « les frais d'inscription ».
 */
export function libellePiece(p: ServiceCode): string {
  if (p === 'inscription') return 'Inscription';
  if (p === 'photocopie') return 'Photocopie';
  return libelleService(p);
}

export function estPiece(p: string): p is ServiceCode {
  return (SERVICE_CODES as readonly string[]).includes(p);
}

export interface DocumentPiece {
  id: string;
  nom: string;
  mime: string;
  octets: number;
  deposeLe: string;
  deposePar: string | null;
}

export interface Piece {
  piece: ServiceCode;
  libelle: string;
  /** La pièce existe parce que le service a été souscrit (sinon : inscription / photocopie, d'office). */
  souscrit: boolean;
  document: DocumentPiece | null;
}

export interface EnfantDocuments {
  id: string;
  prenom: string;
  nom: string;
  matricule: string | null;
  classe: string | null;
  pieces: Piece[];
}

interface LigneDocument {
  id: string;
  student_id: string;
  piece: ServiceCode;
  display_name: string;
  mime: string;
  bytes: number;
  uploaded_at: string;
  depose_par: string | null;
}

@Injectable()
export class DocumentsService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AcademicYearService) private readonly years: AcademicYearService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  /**
   * « Search button for parents by name and number » : le nom, ou un morceau
   * de n'importe lequel de ses numéros (le principal et les supplémentaires).
   * Seulement les correspondants d'au moins un élève d'ici.
   */
  async rechercherFamilles(brut: string) {
    const q = brut.trim();
    if (q.length < 2) return [];
    const chiffres = q.replace(/\D/g, '');
    const motif = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{
        id: string;
        full_name: string;
        phone: string | null;
        autres: string[] | null;
        enfants: string;
      }>(
        `SELECT u.id, u.full_name, u.phone,
                (SELECT array_agg(p.phone ORDER BY p.created_at) FROM user_phones p WHERE p.user_id = u.id) AS autres,
                (SELECT count(*)::text FROM students s WHERE s.guardian_id = u.id) AS enfants
           FROM users u
          WHERE EXISTS (SELECT 1 FROM students s WHERE s.guardian_id = u.id)
            AND (u.full_name ILIKE $1 ESCAPE '\\'
                 OR EXISTS (SELECT 1 FROM students s WHERE s.guardian_id = u.id
                              AND (s.first_name || ' ' || s.last_name) ILIKE $1 ESCAPE '\\')
                 OR ($2 <> '' AND (
                      replace(replace(replace(coalesce(u.phone, ''), ' ', ''), '-', ''), '+', '') LIKE '%' || $2 || '%'
                      OR EXISTS (SELECT 1 FROM user_phones p WHERE p.user_id = u.id AND p.phone LIKE '%' || $2 || '%'))))
          ORDER BY u.full_name
          LIMIT 20`,
        [motif, chiffres.length >= 3 ? chiffres : ''],
      );
      return rows.map((r) => ({
        id: r.id,
        nom: r.full_name,
        telephone: r.phone,
        autresTelephones: r.autres ?? [],
        enfants: Number(r.enfants),
      }));
    });
  }

  /** L'année demandée (de CETTE école), sinon l'année active, sinon la plus récente qui a des inscrits. */
  private async annee(yearId?: string | null): Promise<AcademicYear | null> {
    if (yearId) {
      const y = await this.db.query(async (tx) => {
        const { rows } = await tx.query<AcademicYear>('SELECT * FROM academic_years WHERE id = $1', [yearId]);
        return rows[0] ?? null;
      });
      if (!y) throw new NotFoundException('Année scolaire introuvable.');
      return y;
    }
    return this.years.defaultView();
  }

  /**
   * Les enfants d'un correspondant pour une année, avec leurs pièces. Un enfant
   * figure s'il est inscrit cette année-là, ou s'il y a déjà un document.
   */
  private async enfantsAvecPieces(tx: Queryable, guardianId: string, yearId: string): Promise<EnfantDocuments[]> {
    const { rows: enfants } = await tx.query<{
      id: string;
      first_name: string;
      last_name: string;
      matricule: string | null;
      classe: string | null;
    }>(
      `SELECT s.id, s.first_name, s.last_name, s.matricule,
              (SELECT COALESCE(l.name || ' — ', '') || g.name
                 FROM enrollments e JOIN groups g ON g.id = e.group_id LEFT JOIN levels l ON l.id = g.level_id
                WHERE e.student_id = s.id AND e.academic_year_id = $2 AND e.status <> 'cancelled'
                ORDER BY e.created_at DESC LIMIT 1) AS classe
         FROM students s
        WHERE s.guardian_id = $1
          AND (EXISTS (SELECT 1 FROM enrollments e WHERE e.student_id = s.id AND e.academic_year_id = $2 AND e.status <> 'cancelled')
               OR EXISTS (SELECT 1 FROM student_documents d WHERE d.student_id = s.id AND d.academic_year_id = $2))
        ORDER BY s.first_name, s.last_name`,
      [guardianId, yearId],
    );
    if (enfants.length === 0) return [];
    const ids = enfants.map((e) => e.id);

    const { rows: services } = await tx.query<{ student_id: string; service: ServiceCode }>(
      `SELECT DISTINCT student_id, service FROM student_services
        WHERE student_id = ANY($1::uuid[]) AND academic_year_id = $2`,
      [ids, yearId],
    );
    const { rows: docs } = await tx.query<LigneDocument>(
      `SELECT d.id, d.student_id, d.piece, d.display_name, d.mime, d.bytes, d.uploaded_at,
              u.full_name AS depose_par
         FROM student_documents d LEFT JOIN users u ON u.id = d.uploaded_by
        WHERE d.student_id = ANY($1::uuid[]) AND d.academic_year_id = $2`,
      [ids, yearId],
    );

    return enfants.map((e) => {
      const souscrits = new Set(services.filter((s) => s.student_id === e.id).map((s) => s.service));
      const siens = docs.filter((d) => d.student_id === e.id);
      const pieces = ORDRE_PIECES.filter(
        (p) => TOUJOURS.includes(p) || souscrits.has(p) || siens.some((d) => d.piece === p),
      ).map((p): Piece => {
        const d = siens.find((x) => x.piece === p);
        return {
          piece: p,
          libelle: libellePiece(p),
          souscrit: souscrits.has(p),
          document: d
            ? {
                id: d.id,
                nom: d.display_name,
                mime: d.mime,
                octets: d.bytes,
                deposeLe: new Date(d.uploaded_at).toISOString(),
                deposePar: d.depose_par,
              }
            : null,
        };
      });
      return {
        id: e.id,
        prenom: e.first_name,
        nom: e.last_name,
        matricule: e.matricule,
        classe: e.classe,
        pieces,
      };
    });
  }

  /** LA FICHE « DOCUMENTS » D'UNE FAMILLE — côté école. */
  async famille(guardianId: string, yearId?: string | null) {
    const annee = await this.annee(yearId);
    return this.db.query(async (tx) => {
      const { rows } = await tx.query<{ id: string; full_name: string; phone: string | null; autres: string[] | null }>(
        `SELECT u.id, u.full_name, u.phone,
                (SELECT array_agg(p.phone ORDER BY p.created_at) FROM user_phones p WHERE p.user_id = u.id) AS autres
           FROM users u
          WHERE u.id = $1 AND EXISTS (SELECT 1 FROM students s WHERE s.guardian_id = u.id)`,
        [guardianId],
      );
      const g = rows[0];
      if (!g) throw new NotFoundException('Famille introuvable dans cette école.');
      return {
        famille: { id: g.id, nom: g.full_name, telephone: g.phone, autresTelephones: g.autres ?? [] },
        annee: annee ? { id: annee.id, label: annee.label } : null,
        enfants: annee ? await this.enfantsAvecPieces(tx, guardianId, annee.id) : [],
      };
    });
  }

  /**
   * DÉPOSER OU REMPLACER le document d'une pièce.
   *
   * Le fichier est écrit d'abord, la ligne ensuite ; l'ancien fichier n'est
   * effacé qu'une fois la ligne enregistrée — un échec en route laisse au
   * pire un fichier de trop (que `GET /attachments/integrity` signale), jamais
   * une pièce sans fichier.
   */
  async deposer(
    studentId: string,
    yearId: string,
    piece: string,
    fichier: { buffer: Buffer; filename: string },
    actorId: string,
  ) {
    const { schoolId } = currentTenant();
    if (!estPiece(piece)) throw new BadRequestException('Pièce inconnue.');

    const contexte = await this.db.query(async (tx) => {
      const { rows: eleve } = await tx.query<{ guardian_id: string | null; prenom: string; nom: string }>(
        'SELECT guardian_id, first_name AS prenom, last_name AS nom FROM students WHERE id = $1',
        [studentId],
      );
      if (!eleve[0]) throw new NotFoundException('Élève introuvable.');
      const { rows: annee } = await tx.query('SELECT 1 FROM academic_years WHERE id = $1', [yearId]);
      if (annee.length === 0) throw new NotFoundException('Année scolaire introuvable.');
      if (!TOUJOURS.includes(piece)) {
        const { rows: s } = await tx.query(
          `SELECT 1 FROM student_services WHERE student_id = $1 AND academic_year_id = $2 AND service = $3
           UNION ALL
           SELECT 1 FROM student_documents WHERE student_id = $1 AND academic_year_id = $2 AND piece = $3`,
          [studentId, yearId, piece],
        );
        if (s.length === 0) {
          throw new BadRequestException(`« ${libellePiece(piece)} » n’a pas été souscrit pour cet élève cette année.`);
        }
      }
      return eleve[0];
    });

    let stocke;
    try {
      stocke = await storeUpload(fichier.buffer, fichier.filename, schoolId, ['pdf', 'image']);
    } catch (e) {
      if (e instanceof UploadRejected) throw new BadRequestException(e.message);
      throw e;
    }

    let ancien: string | null = null;
    let resultat: { id: string; remplace: boolean };
    try {
      resultat = await this.db.query(async (tx) => {
        const { rows: avant } = await tx.query<{ id: string; stored_name: string; display_name: string }>(
          `SELECT id, stored_name, display_name FROM student_documents
            WHERE student_id = $1 AND academic_year_id = $2 AND piece = $3 FOR UPDATE`,
          [studentId, yearId, piece],
        );
        let id: string;
        if (avant[0]) {
          ancien = avant[0].stored_name;
          await tx.query(
            `UPDATE student_documents
                SET stored_name = $2, display_name = $3, mime = $4, bytes = $5,
                    uploaded_by = $6, uploaded_at = now()
              WHERE id = $1`,
            [avant[0].id, stocke.storedName, stocke.displayName, stocke.mime, stocke.bytes, actorId],
          );
          id = avant[0].id;
        } else {
          const { rows } = await tx.query<{ id: string }>(
            `INSERT INTO student_documents
               (school_id, student_id, academic_year_id, piece, stored_name, display_name, mime, bytes, uploaded_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
            [schoolId, studentId, yearId, piece, stocke.storedName, stocke.displayName, stocke.mime, stocke.bytes, actorId],
          );
          id = rows[0]!.id;
        }
        await this.audit.record(
          {
            actorId,
            schoolId,
            action: avant[0] ? 'document_signe_remplace' : 'document_signe_depose',
            entity: 'student_document',
            entityId: id,
            before: avant[0] ? { nom: avant[0].display_name } : undefined,
            after: { eleve: studentId, piece, nom: stocke.displayName, octets: String(stocke.bytes) },
          },
          tx,
        );
        // La famille est prévenue : un document l'attend dans l'application.
        if (contexte.guardian_id) {
          await this.notifications.notifier(tx, {
            guardianId: contexte.guardian_id,
            studentId,
            academicYearId: yearId,
            kind: 'document',
            souche: 'notif_document',
            params: { eleve: `${contexte.prenom} ${contexte.nom}`.trim(), document: libellePiece(piece) },
            route: 'documents',
          });
        }
        return { id, remplace: avant[0] !== undefined };
      });
    } catch (e) {
      await deleteStored(schoolId, stocke.storedName);
      throw e;
    }
    if (ancien) await deleteStored(schoolId, ancien);
    return { ...resultat, nom: stocke.displayName, mime: stocke.mime, octets: stocke.bytes };
  }

  /** SUPPRIMER : la pièce redevient vide ; le fichier part du disque. */
  async supprimer(id: string, actorId: string) {
    const { schoolId } = currentTenant();
    const ligne = await this.db.query(async (tx) => {
      const { rows } = await tx.query<{ stored_name: string; display_name: string; student_id: string; piece: string }>(
        'DELETE FROM student_documents WHERE id = $1 RETURNING stored_name, display_name, student_id, piece',
        [id],
      );
      if (!rows[0]) throw new NotFoundException('Document introuvable.');
      await this.audit.record(
        {
          actorId,
          schoolId,
          action: 'document_signe_supprime',
          entity: 'student_document',
          entityId: id,
          before: { eleve: rows[0].student_id, piece: rows[0].piece, nom: rows[0].display_name },
        },
        tx,
      );
      return rows[0];
    });
    await deleteStored(schoolId, ligne.stored_name);
    return { id, supprime: true };
  }

  /** Le fichier, pour l'école. */
  async fichier(id: string) {
    return this.lire(id, null);
  }

  /** Le fichier, pour une famille : seulement le document d'un de SES enfants. */
  async fichierPourFamille(id: string, guardianId: string) {
    return this.lire(id, guardianId);
  }

  private async lire(id: string, guardianId: string | null) {
    const { schoolId } = currentTenant();
    const ligne = await this.db.query(async (tx) => {
      const { rows } = await tx.query<{ stored_name: string; display_name: string; mime: string }>(
        `SELECT d.stored_name, d.display_name, d.mime
           FROM student_documents d JOIN students s ON s.id = d.student_id
          WHERE d.id = $1 AND ($2::uuid IS NULL OR s.guardian_id = $2)`,
        [id, guardianId],
      );
      return rows[0] ?? null;
    });
    // Le document d'une autre famille répond comme un document qui n'existe pas.
    if (!ligne) throw new NotFoundException('Document introuvable.');
    const buffer = await readStored(schoolId, ligne.stored_name).catch(() => {
      throw new NotFoundException('Le fichier de ce document est introuvable sur le serveur.');
    });
    return { buffer, mime: ligne.mime, displayName: ligne.display_name };
  }

  /**
   * LES DOCUMENTS D'UNE FAMILLE — côté application, en lecture seule. L'année
   * ACTIVE seulement (la règle de tout l'espace parent : jamais l'année
   * d'avant présentée comme la courante).
   */
  async pourFamille(guardianId: string) {
    const { schoolId } = currentTenant();
    // L'application n'offre « Documents » qu'aux familles d'une école « services ».
    const actif = await this.db.query(async (tx) => {
      const { rows } = await tx.query<{ billing_model: string }>('SELECT billing_model FROM schools WHERE id = $1', [schoolId]);
      return rows[0]?.billing_model === 'services';
    });
    const annee = await this.years.activeForParent();
    if (!annee) return { actif, annee: null, enfants: [] as EnfantDocuments[] };
    const enfants = await this.db.query((tx) => this.enfantsAvecPieces(tx, guardianId, annee.id));
    // Ce que l'école seule a à savoir (qui a déposé) ne part pas vers le téléphone.
    return {
      actif,
      annee: { id: annee.id, label: annee.label },
      enfants: enfants.map((e) => ({
        ...e,
        pieces: e.pieces.map((p) => ({ ...p, document: p.document ? { ...p.document, deposePar: null } : null })),
      })),
    };
  }
}
