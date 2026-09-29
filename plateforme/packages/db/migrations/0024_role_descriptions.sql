-- ============================================================================
--  0024 — la phrase qui explique chaque rôle
-- ============================================================================
--
-- `comptes_staffs.php` coche les rôles d'un compte avec, sous chaque nom, la
-- phrase qui dit ce que le rôle permet :
--
--     <span><b>Comptable</b><span>Caisse, dépenses, dettes, rapports
--     financiers.</span></span>
--
-- Nos cases ne portaient que le nom. C'est précisément l'écran où l'on décide
-- ce que quelqu'un pourra faire, et « Secrétaire » tout seul ne dit pas qu'il
-- s'agit des inscriptions ET des notes.
--
-- ⚠ TABLE DE RÉFÉRENCE, PAS DE DONNÉE DE TENANT. `roles` est globale — sept
-- lignes, les mêmes pour toutes les écoles — donc pas de `school_id`, pas de
-- RLS : c'est le seul endroit du schéma où cela est correct, et
-- `role_permissions` fonctionne déjà ainsi.
ALTER TABLE roles ADD COLUMN description text;

COMMENT ON COLUMN roles.description IS
  'La phrase affichée sous le nom du rôle quand on coche les rôles d''un '
  'compte. Vient de `roles.description` chez El Ourwa.';

-- Ses six phrases, au mot près. Le rôle `parent` n'apparaît sur aucun écran de
-- gestion des comptes du personnel et n'en a pas.
UPDATE roles SET description = 'Accès total, y compris la finance et les comptes.'
 WHERE code = 'super_admin';
UPDATE roles SET description = 'Administration générale de l''école.'
 WHERE code = 'admin';
UPDATE roles SET description = 'Caisse, dépenses, dettes, rapports financiers.'
 WHERE code = 'comptable';
UPDATE roles SET description = 'Inscriptions, réinscriptions, notes, scolarité.'
 WHERE code = 'secretaire';
UPDATE roles SET description = 'Saisie et suivi des absences.'
 WHERE code = 'collecteur_absence';
UPDATE roles SET description = 'Classes, notes et exercices de ses enseignements.'
 WHERE code = 'professeur';
