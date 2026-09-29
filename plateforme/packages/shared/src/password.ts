/**
 * LA POLITIQUE DE MOT DE PASSE — `valider_mot_de_passe()` in `sanitize.php`.
 *
 * ⚠ EIGHT CHARACTERS *AND* THREE OF FOUR CHARACTER CLASSES. Ours checked the
 * length and nothing else, so "aaaaaaaa" passed — a password a school hands out
 * to 1 372 families, some of whom will keep whatever they are given.
 *
 * Three of four, not all four, and that is a deliberate softening on their part:
 * requiring a symbol from every parent on a phone keyboard in Nouakchott is how
 * you get "Passw0rd!" written on the back of the enrolment form. Three classes
 * out of four leaves room for a memorable phrase with a digit in it.
 *
 * The messages are theirs, word for word, because a rejection has to say what
 * would satisfy it — "invalid password" tells nobody anything.
 */
export const PASSWORD_MIN_LENGTH = 8;

/** Empty string when the password is acceptable; the reason when it is not. */
export function validatePassword(password: string): string {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères.`;
  }

  let classes = 0;
  if (/[a-z]/.test(password)) classes++;
  if (/[A-Z]/.test(password)) classes++;
  if (/\d/.test(password)) classes++;
  if (/[^a-zA-Z0-9]/.test(password)) classes++;

  if (classes < 3) {
    return (
      'Le mot de passe doit combiner au moins 3 types de caractères ' +
      '(minuscules, majuscules, chiffres, symboles).'
    );
  }

  return '';
}

/**
 * LE MOT DE PASSE PROPOSÉ POUR UN COMPTE PARENT (28/09/2026, demande d'El
 * Mourad : « le mot de passe généré automatiquement »).
 *
 * L'admission et « Reset mdp » faisaient TAPER le mot de passe ; le champ arrive
 * maintenant rempli de celui-ci — visible, modifiable, régénérable — et le
 * parent doit toujours le changer à la première connexion.
 *
 * La recette de `mdp_provisoire()` (comme `mdpProvisoire` de l'API) : une
 * majuscule, une minuscule, six minuscules ou chiffres, un chiffre, un signe —
 * 10 caractères, sans O/0, l/1, I (il se lit à voix haute, s'écrit sur un papier).
 * Tirage par `crypto.getRandomValues` (navigateur et Node), jamais Math.random.
 */
export function genererMotDePasse(): string {
  const majuscules = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const minuscules = 'abcdefghijkmnopqrstuvwxyz';
  const chiffres = '23456789';
  const signes = '!@#$%&*';
  const hasard = (n: number): number => {
    // Rejet au-dessus du plus grand multiple de n : pas de biais de modulo.
    const plafond = Math.floor(0x1_0000_0000 / n) * n;
    const u = new Uint32Array(1);
    do globalThis.crypto.getRandomValues(u);
    while (u[0]! >= plafond);
    return u[0]! % n;
  };
  const un = (s: string) => s[hasard(s.length)]!;
  let out = un(majuscules) + un(minuscules);
  for (let i = 0; i < 6; i += 1) out += hasard(2) ? un(minuscules) : un(chiffres);
  return out + un(chiffres) + un(signes);
}

/** True when the password satisfies the policy. */
export function passwordIsValid(password: string): boolean {
  return validatePassword(password) === '';
}
