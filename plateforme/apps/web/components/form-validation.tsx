'use client';

import { useEffect } from 'react';

/**
 * VALIDATION DE CHAMP AU FIL DE LA SAISIE — `assets/js/app.js`,
 * `initFormValidation()` / `validateField()` / `showFieldError()`.
 *
 * ⚠ NOTRE FEUILLE DE STYLE PORTE `.input-error` ET `.field-error` DEPUIS LE
 * DÉBUT, ET RIEN NE LES POSAIT JAMAIS. `style.css` est une copie au caractère
 * près de la sienne — les règles étaient donc là, mortes, et chaque formulaire
 * retombait sur la bulle native du navigateur : un message en anglais sur les
 * machines en anglais, qui disparaît au premier clic, ne se lit pas à
 * l'impression, et ne dit jamais quel est le deuxième champ fautif.
 *
 * Le sien écrit le message SOUS le champ, en français, le retire dès qu'on
 * corrige, et amène le premier champ fautif à l'écran. Ses règles, mot pour mot.
 *
 * ⚠ CE N'EST PAS UNE FRONTIÈRE DE SÉCURITÉ. Tout ce qui est refusé ici est
 * refusé à nouveau par Zod dans le contrôleur ; ceci épargne un aller-retour et
 * dit à la personne quoi corriger. Une validation faite dans le navigateur se
 * contourne en changeant un champ.
 *
 * Monté une fois dans la coquille, il observe le document : une navigation
 * App Router remplace le contenu sans recharger la page, donc un `querySelectorAll`
 * fait au montage ne verrait que les formulaires du premier écran.
 */
export function FormValidation() {
  useEffect(() => {
    /** Ses « champs libres » : contexte bilingue, chiffres et ponctuation admis. */
    const LIBRES = new Set([
      'nom_groupe_cs', 'description', 'motif', 'matiere', 'creneau',
      'externe_nom', 'debiteur_nom',
      // Les nôtres, de même nature — un motif de créance, une remarque, un
      // sujet de message ne sont pas des identifiants.
      'reason', 'note', 'subject', 'body', 'comment', 'debtorName', 'jobTitle',
      'fullName', 'firstName', 'lastName', 'guardianName', 'name', 'label',
      'title', 'instructions', 'placeOfBirth',
    ]);

    function message(input: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): string {
      const value = input.value.trim();
      const name = input.name || '';
      const type = (input as HTMLInputElement).type || '';

      if (input.disabled || input.offsetParent === null) return '';

      if ((input as HTMLInputElement).required && value === '') {
        return input.tagName === 'SELECT'
          ? 'Veuillez sélectionner une option.'
          : 'Ce champ est obligatoire.';
      }
      if (value === '') return '';

      if (type === 'number') {
        const num = Number(value);
        if (!Number.isFinite(num)) return 'Veuillez entrer un nombre valide.';
        const el = input as HTMLInputElement;
        const min = el.min !== '' ? Number(el.min) : null;
        const max = el.max !== '' ? Number(el.max) : null;
        if (min !== null && num < min) return `La valeur minimale est ${min}.`;
        if (max !== null && num > max) return `La valeur maximale est ${max}.`;
      }

      if (type === 'text' || type === '' || type === 'search' || type === 'tel') {
        if (!LIBRES.has(name) && /[<>]/.test(value)) {
          return 'Les caractères < et > ne sont pas autorisés.';
        }
        if (name === 'identifiant' || name.startsWith('ident_') || name === 'identifier') {
          if (!/^[a-zA-Z0-9._@\-+]+$/.test(value)) {
            return 'Caractères autorisés : lettres, chiffres, @, ., -, _';
          }
          if (value.length < 3) return 'Minimum 3 caractères.';
        }
        if (
          name === 'telephone' || name === 'telephone_parent' || name.startsWith('tel_') ||
          name === 'phone' || name === 'guardianPhone'
        ) {
          if (!/^[\d\s+\-()]+$/.test(value)) {
            return 'Format invalide. Utilisez uniquement des chiffres, +, -, espaces.';
          }
        }
        if (name === 'fonction') {
          if (!/^[\p{L}\s\-'./,]+$/u.test(value)) {
            return 'Ce champ ne doit contenir que des lettres et caractères simples.';
          }
        }
      }

      if (type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
        return 'Adresse email invalide.';
      }
      if (type === 'date' && Number.isNaN(Date.parse(value))) return 'Date invalide.';

      return '';
    }

    /** Son `showFieldError` : le message sous le champ, dans `.form-group`. */
    function afficher(input: Element, texte: string) {
      input.classList.add('input-error');
      const parent = input.closest('.form-group') ?? input.parentElement;
      if (!parent) return;
      let span = parent.querySelector<HTMLElement>('.field-error');
      if (!span) {
        span = document.createElement('span');
        span.className = 'field-error';
        input.parentElement?.insertBefore(span, input.nextSibling);
      }
      span.textContent = texte;
    }

    function effacer(input: Element) {
      input.classList.remove('input-error');
      const parent = input.closest('.form-group') ?? input.parentElement;
      const span = parent?.querySelector<HTMLElement>('.field-error');
      if (span) span.textContent = '';
    }

    type Champ = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    const estChamp = (el: EventTarget | null): el is Champ =>
      el instanceof HTMLInputElement ||
      el instanceof HTMLSelectElement ||
      el instanceof HTMLTextAreaElement;

    /*
     * Trois écouteurs sur le document plutôt qu'un par champ. `blur` et `input`
     * ne bouillonnent pas, d'où la capture — c'est ce qui permet de couvrir les
     * formulaires qui n'existaient pas au montage sans jamais re-parcourir le
     * DOM.
     */
    function onBlur(e: Event) {
      const el = e.target;
      if (!estChamp(el) || el.type === 'hidden') return;
      if (!el.form) return;
      const m = message(el);
      if (m) afficher(el, m);
      else effacer(el);
    }

    function onInput(e: Event) {
      const el = e.target;
      if (estChamp(el)) effacer(el);
    }

    function onSubmit(e: Event) {
      const form = e.target;
      if (!(form instanceof HTMLFormElement)) return;
      // Les formulaires GET servent à naviguer : sa propre règle les exclut.
      if ((form.method || 'get').toLowerCase() === 'get') return;

      let premier: Champ | null = null;
      for (const el of Array.from(form.elements)) {
        if (!estChamp(el) || el.type === 'hidden') continue;
        const m = message(el);
        if (m) {
          afficher(el, m);
          premier ??= el;
        } else {
          effacer(el);
        }
      }

      if (premier) {
        e.preventDefault();
        e.stopPropagation();
        premier.focus();
        premier.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    /*
     * ⚠ ET SANS CECI, RIEN DE CE QUI PRÉCÈDE NE S'AFFICHE JAMAIS.
     *
     * La validation native du navigateur s'exécute AVANT `submit` : un champ
     * `required` vide fait échouer la contrainte, l'événement `submit` n'est
     * jamais émis, et c'est la bulle native qui parle — en anglais sur une
     * machine en anglais, disparue au premier clic, muette sur le deuxième
     * champ fautif.
     *
     * `invalid` est l'événement que le navigateur émet à ce moment-là.
     * `preventDefault()` supprime la bulle ; le message français prend sa place
     * sous le champ. La contrainte reste : le formulaire ne part pas.
     */
    function onInvalid(e: Event) {
      const el = e.target;
      if (!estChamp(el)) return;
      e.preventDefault();
      afficher(el, message(el) || el.validationMessage);
      // Le premier champ refusé est celui qu'on amène à l'écran ; les suivants
      // sont déjà marqués quand on y arrive.
      if (!document.querySelector('.input-error:focus')) {
        el.focus();
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }

    document.addEventListener('blur', onBlur, true);
    document.addEventListener('input', onInput, true);
    document.addEventListener('invalid', onInvalid, true);
    // En capture : il doit refuser AVANT que React ne parte exécuter l'action.
    document.addEventListener('submit', onSubmit, true);

    return () => {
      document.removeEventListener('blur', onBlur, true);
      document.removeEventListener('input', onInput, true);
      document.removeEventListener('invalid', onInvalid, true);
      document.removeEventListener('submit', onSubmit, true);
    };
  }, []);

  return null;
}
