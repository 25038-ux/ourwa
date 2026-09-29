-- ============================================================================
--  0041_user_phones — plusieurs numéros de téléphone pour un compte parent
-- ============================================================================
--
--  Demande du propriétaire (23/09/2026) : « add the possibility of registering
--  multiple phone numbers for a parent ».
--
--  Le téléphone EST l'identifiant d'une famille (`users.phone`, unique, 0001) :
--  c'est ce que la mère tape dans l'application. Mais une famille a souvent
--  deux ou trois numéros — le père, la mère, l'oncle qui règle les mois — et
--  n'importe lequel doit ouvrir le compte de la famille, avec LE MÊME mot de
--  passe. El Ourwa n'a qu'une colonne `telephone` ; le secrétariat y notait le
--  second numéro dans le nom, et ce numéro-là n'ouvrait rien.
--
--  `users.phone` reste le numéro principal (celui qui s'affiche comme
--  identifiant, celui que `users/:id/identifier` change) ; les autres vivent
--  ici. Une seule règle : UN NUMÉRO N'APPARTIENT QU'À UN COMPTE, principal ou
--  supplémentaire — deux comptes joignables par le même numéro, et la
--  connexion tirerait au sort.
--
--  ⚠ GLOBALE, comme `users` (0001) et `username` (0027) : un compte de famille
--  n'appartient à aucune école (la même mère peut avoir un enfant à Nour et un
--  à Rissala). Pas de `school_id`, donc pas de politique RLS — le test
--  `rls.test.ts` ne surveille que les tables qui portent `school_id`. L'accès
--  passe par le service des comptes, qui exige que la personne soit
--  correspondante de l'école qui la modifie.
--
--  La forme est CANONIQUE : huit chiffres, comme `telephoneMauritanien()` la
--  produit — c'est ce que la connexion compare (`right(regexp_replace(…), 8)`
--  pour `users.phone`, égalité stricte ici).

CREATE TABLE user_phones (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  phone      text NOT NULL CHECK (phone ~ '^[0-9]{8}$'),
  -- « Père », « Mère », « Oncle »… : ce que le secrétariat veut retrouver.
  label      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, phone),
  UNIQUE (phone)
);

COMMENT ON TABLE user_phones IS
  'Numéros supplémentaires d''un compte (famille) : chacun ouvre le compte avec '
  'son mot de passe. Le principal reste users.phone. Forme canonique, 8 chiffres.';

GRANT SELECT, INSERT, UPDATE, DELETE ON user_phones TO app_user;
GRANT SELECT ON user_phones TO app_reporter;
