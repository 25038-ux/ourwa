/*
 * Patrimo — petits comportements côté navigateur.
 * Pas de framework : chaque bloc ne s'active que si les éléments existent sur la page.
 */
(function () {
  'use strict';

  var $ = function (sel, ctx) { return (ctx || document).querySelector(sel); };
  var $$ = function (sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); };

  /* ---------- Menu latéral sur mobile ---------- */
  var bouton = $('[data-bascule-menu]');
  if (bouton) {
    bouton.addEventListener('click', function () {
      document.body.classList.toggle('menu-ouvert');
    });
    document.addEventListener('click', function (e) {
      if (document.body.classList.contains('menu-ouvert') &&
          !e.target.closest('#lateral') && !e.target.closest('[data-bascule-menu]')) {
        document.body.classList.remove('menu-ouvert');
      }
    });
  }

  /* ---------- Raccourci "/" pour la recherche ---------- */
  document.addEventListener('keydown', function (e) {
    if (e.key !== '/' || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) return;
    var champ = $('.recherche input');
    if (champ) { e.preventDefault(); champ.focus(); champ.select(); }
  });

  /* ---------- Messages flash ---------- */
  $$('.flash').forEach(function (f) {
    var fermer = $('.flash__fermer', f);
    if (fermer) fermer.addEventListener('click', function () { f.remove(); });
    if (f.classList.contains('flash--ok')) {
      setTimeout(function () { f.classList.add('flash--sortie'); }, 5000);
      setTimeout(function () { f.remove(); }, 5600);
    }
  });

  /* ---------- Lignes de tableau cliquables ---------- */
  $$('tr[data-href]').forEach(function (tr) {
    tr.addEventListener('click', function (e) {
      if (e.target.closest('a, button, input, form')) return;
      window.location = tr.getAttribute('data-href');
    });
  });

  /* ---------- Filtres : envoi automatique au changement ---------- */
  $$('[data-auto-submit]').forEach(function (el) {
    el.addEventListener('change', function () { el.form.submit(); });
  });

  /* ---------- Confirmations ---------- */
  $$('form[data-confirmer]').forEach(function (form) {
    form.addEventListener('submit', function (e) {
      if (!window.confirm(form.getAttribute('data-confirmer'))) e.preventDefault();
    });
  });

  /* ---------- Validation simple des formulaires ---------- */
  function messageErreur(champ) {
    var v = champ.value.trim();
    if (champ.required && v === '') {
      if (champ.type === 'radio') return null; // géré à part
      return champ.tagName === 'SELECT' ? 'Faites un choix dans la liste.' : 'Ce champ est obligatoire.';
    }
    if (v === '') return null;
    if (champ.minLength > 0 && v.length < champ.minLength) {
      return 'Au moins ' + champ.minLength + ' caractères.';
    }
    if (champ.pattern && !new RegExp('^(?:' + champ.pattern + ')$').test(v)) {
      return champ.name === 'numero_inventaire'
        ? 'Lettres, chiffres et tirets uniquement (ex. INF-2026-0012).'
        : 'Format incorrect.';
    }
    if (champ.type === 'date' && champ.max && v > champ.max) {
      return 'La date ne peut pas être dans le futur.';
    }
    return null;
  }

  function afficherErreur(champ, msg) {
    var bloc = champ.closest('.champ') || champ.parentNode;
    var ancien = $('.champ__erreur[data-js]', bloc);
    if (ancien) ancien.remove();
    champ.classList.toggle('invalide', !!msg);
    if (msg) {
      var s = document.createElement('span');
      s.className = 'champ__erreur';
      s.setAttribute('data-js', '');
      s.textContent = msg;
      bloc.appendChild(s);
    }
  }

  $$('form[data-valider]').forEach(function (form) {
    var champs = $$('input:not([type=hidden]):not([type=radio]), select, textarea', form);

    champs.forEach(function (c) {
      c.addEventListener('blur', function () { if (c.value !== '') afficherErreur(c, messageErreur(c)); });
      c.addEventListener('input', function () { if (c.classList.contains('invalide')) afficherErreur(c, messageErreur(c)); });
    });

    form.addEventListener('submit', function (e) {
      var premier = null;
      champs.forEach(function (c) {
        var msg = messageErreur(c);
        afficherErreur(c, msg);
        if (msg && !premier) premier = c;
      });

      // Boutons radio obligatoires (choix du nouvel état)
      var radios = $$('input[type=radio][required]', form);
      if (radios.length && !radios.some(function (r) { return r.checked; })) {
        var groupe = radios[0].closest('.choix-etat');
        groupe.classList.add('invalide');
        groupe.addEventListener('change', function () { groupe.classList.remove('invalide'); }, { once: true });
        if (!premier) premier = radios[0];
      }

      if (premier) {
        e.preventDefault();
        e.stopImmediatePropagation();
        premier.focus();
      }
    });
  });

  // Placé après la validation : pas de question si le formulaire est incomplet
  $$('[data-confirmer-reforme]').forEach(function (btn) {
    btn.form.addEventListener('submit', function (e) {
      var choix = $('input[name="etat"]:checked', btn.form);
      if (e.defaultPrevented || !choix || choix.value !== 'reforme') return;
      if (!window.confirm('La réforme est définitive : le matériel sortira du parc actif. Continuer ?')) {
        e.preventDefault();
      }
    });
  });

  /* ---------- Afficher / masquer le mot de passe ---------- */
  $$('[data-voir-mdp]').forEach(function (b) {
    b.addEventListener('click', function () {
      var input = b.previousElementSibling;
      var visible = input.type === 'text';
      input.type = visible ? 'password' : 'text';
      b.textContent = visible ? 'Afficher' : 'Masquer';
    });
  });

  /* ---------- Suggestion du numéro d'inventaire ---------- */
  var formMat = $('form[data-suggestion]');
  if (formMat) {
    var prochains = JSON.parse(formMat.getAttribute('data-prochains') || '{}');
    var cat = $('select[name=categorie_id]', formMat);
    var dateAcq = $('input[name=date_acquisition]', formMat);
    var numero = $('input[name=numero_inventaire]', formMat);
    var aide = $('[data-aide-numero]', formMat);
    var saisiALaMain = numero.value !== '';

    numero.addEventListener('input', function () { saisiALaMain = numero.value !== ''; });

    var proposer = function () {
      var opt = cat.options[cat.selectedIndex];
      var prefixe = opt && opt.getAttribute('data-prefixe');
      if (!prefixe || saisiALaMain) return;
      var annee = (dateAcq.value || '').slice(0, 4) || String(new Date().getFullYear());
      var suivant = (prochains[prefixe + '-' + annee] || 0) + 1;
      numero.value = prefixe + '-' + annee + '-' + String(suivant).padStart(4, '0');
      aide.textContent = 'Numéro proposé : le suivant libre pour ' + prefixe + ' en ' + annee + '.';
    };
    cat.addEventListener('change', proposer);
    dateAcq.addEventListener('change', proposer);
  }

  /* ---------- Formulaire utilisateur : direction seulement pour les responsables ---------- */
  var role = $('select[data-role]');
  if (role) {
    var champDir = $('[data-champ-direction]');
    var maj = function () { champDir.hidden = role.value === 'admin'; };
    role.addEventListener('change', maj);
    maj();
  }

  /* ---------- Code-barres Code 39 (lisible par une douchette) ---------- */
  // Chaque caractère = 15 modules (1 = barre, 0 = espace). Table de la norme Code 39.
  var CODE39 = {
    '0': '101000111011101', '1': '111010001010111', '2': '101110001010111', '3': '111011100010101',
    '4': '101000111010111', '5': '111010001110101', '6': '101110001110101', '7': '101000101110111',
    '8': '111010001011101', '9': '101110001011101', 'A': '111010100010111', 'B': '101110100010111',
    'C': '111011101000101', 'D': '101011100010111', 'E': '111010111000101', 'F': '101110111000101',
    'G': '101010001110111', 'H': '111010100011101', 'I': '101110100011101', 'J': '101011100011101',
    'K': '111010101000111', 'L': '101110101000111', 'M': '111011101010001', 'N': '101011101000111',
    'O': '111010111010001', 'P': '101110111010001', 'Q': '101010111000111', 'R': '111010101110001',
    'S': '101110101110001', 'T': '101011101110001', 'U': '111000101010111', 'V': '100011101010111',
    'W': '111000111010101', 'X': '100010111010111', 'Y': '111000101110101', 'Z': '100011101110101',
    '-': '100010101110111', '.': '111000101011101', ' ': '100011101011101', '/': '100010001010001',
    '*': '100010111011101'
  };

  $$('.codebarre[data-code]').forEach(function (el) {
    var texte = '*' + el.getAttribute('data-code').toUpperCase() + '*';
    var modules = '';
    for (var i = 0; i < texte.length; i++) {
      if (!CODE39[texte[i]]) return; // caractère non codable : on n'affiche rien
      modules += CODE39[texte[i]] + '0';
    }
    var rects = '';
    for (var x = 0; x < modules.length; x++) {
      if (modules[x] === '1') rects += '<rect x="' + x + '" y="0" width="1" height="40"/>';
    }
    el.innerHTML = '<svg viewBox="0 0 ' + modules.length + ' 40" preserveAspectRatio="none" fill="currentColor">' + rects + '</svg>';
  });

  /* ---------- Impression de l'étiquette ---------- */
  $$('[data-imprimer]').forEach(function (b) {
    b.addEventListener('click', function () {
      document.body.classList.add('impression-etiquette');
      window.print();
      setTimeout(function () { document.body.classList.remove('impression-etiquette'); }, 500);
    });
  });
})();
