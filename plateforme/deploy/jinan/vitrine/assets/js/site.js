/*
 * HEAVENLY · مؤسسة جنان للتعليم — le comportement du site.
 *
 * Aucune bibliothèque. Trois langues (fr, en, ar) depuis window.HEAVENLY_I18N ;
 * les apparitions passent par une classe `.vu` posée par IntersectionObserver
 * (le CSS fait le reste, en transform/opacity) ; l'avion du cursus suit le
 * défilement par une seule variable CSS mise à jour au plus une fois par image.
 *
 * Sans JavaScript, le site est entier : textes en français, FAQ dépliable,
 * liens d'appel et de courriel.
 */
(() => {
  'use strict';

  window.HEAVENLY_PRET = true;

  const I18N = window.HEAVENLY_I18N || {};
  const root = document.documentElement;
  const LANGS = ['fr', 'en', 'ar'];
  const MAIL = 'infoheavenly24@gmail.com';
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const calme = matchMedia('(prefers-reduced-motion: reduce)');
  const mobile = matchMedia('(max-width: 900px)');
  const io = 'IntersectionObserver' in window;

  let lang = LANGS.includes(root.lang) ? root.lang : 'fr';
  const t = (k) => (I18N[lang] && I18N[lang][k] != null ? I18N[lang][k] : (I18N.fr && I18N.fr[k]) || '');

  /* ───────────────────────── Les textes ───────────────────────── */

  function appliquerTextes() {
    root.lang = lang;
    root.dir = lang === 'ar' ? 'rtl' : 'ltr';
    $$('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    $$('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
    $$('[data-i18n-alt]').forEach((el) => { el.alt = t(el.dataset.i18nAlt); });
    $$('[data-i18n-attr]').forEach((el) => {
      el.dataset.i18nAttr.split(';').forEach((paire) => {
        const [attr, cle] = paire.split(':');
        el.setAttribute(attr, t(cle));
      });
    });
    document.title = t('meta.title');
    const desc = $('meta[name="description"]');
    if (desc) desc.setAttribute('content', t('meta.description'));
    // Deux courriels tout prêts : la demande de visite, et l'inscription.
    $$('[data-mail]').forEach((a) => {
      const k = a.dataset.mail === 'visite' ? 'mail.visit.' : 'mail.';
      a.href = `mailto:${MAIL}?subject=${encodeURIComponent(t(k + 'subject'))}&body=${encodeURIComponent(t(k + 'body'))}`;
    });
    $$('[data-lang]').forEach((b) => {
      const actif = b.dataset.lang === lang;
      b.classList.toggle('actif', actif);
      b.setAttribute('aria-pressed', String(actif));
    });
    if (burger && !menu.hidden) burger.setAttribute('aria-label', t('nav.close'));
    souligner();
  }

  // Le mot-clé du grand titre est souligné d'un trait de feutre, tracé à la main.
  function souligner() {
    $$('.hero-titre em').forEach((em) => {
      if ($('.trait-main', em)) return;
      em.insertAdjacentHTML('beforeend',
        '<svg class="trait-main" viewBox="0 0 300 30" preserveAspectRatio="none" aria-hidden="true">' +
        '<path pathLength="1" d="M5 20C45 8 85 26 125 15S205 6 245 17s40 5 50-5"/></svg>');
    });
  }

  /* ───────────────────────── Les apparitions ───────────────────────── */

  const apparitions = io ? new IntersectionObserver((entrees) => {
    entrees.forEach((e) => {
      if (!e.isIntersecting) return;
      e.target.classList.add('vu');
      apparitions.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.1 }) : null;
  $$('[data-anim]').forEach((el) => (apparitions ? apparitions.observe(el) : el.classList.add('vu')));

  // Les croquis animés s'arrêtent quand ils ne sont pas à l'écran.
  if (io) {
    const sommeil = new IntersectionObserver((entrees) => {
      entrees.forEach((e) => e.target.classList.toggle('endormi', !e.isIntersecting));
    }, { rootMargin: '120px 0px' });
    $$('.croquis, .flotte, .scintille, .tache').forEach((el) => sommeil.observe(el));
  }

  /* ───────────────────────── Le défilement ───────────────────────── */

  const entete = $('.entete');
  const ligne = $('.chemin-ligne');
  const barre = $('.barre-mobile');
  const sansBarre = $$('#visite, .fin, .pied');
  let dernierP = -1;

  function mesurer() {
    if (ligne) ligne.style.setProperty('--h', ligne.offsetHeight + 'px');
  }

  function surDefilement() {
    attente = false;
    const y = window.scrollY;
    const vh = window.innerHeight;
    entete.classList.toggle('colle', y > 8);

    // L'avion en papier descend le chemin du cursus avec la page.
    if (ligne) {
      const r = ligne.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (vh * 0.55 - r.top) / (r.height || 1)));
      const arrondi = Math.round(p * 1000) / 1000;
      if (arrondi !== dernierP) {
        dernierP = arrondi;
        ligne.style.setProperty('--p', arrondi);
      }
    }

    // La barre d'appel du téléphone : après l'accueil, sauf là où les boutons sont déjà à l'écran.
    if (barre && mobile.matches) {
      let montrer = y > vh * 0.8;
      if (montrer) {
        for (const z of sansBarre) {
          const r = z.getBoundingClientRect();
          if (r.top < vh - 90 && r.bottom > 90) { montrer = false; break; }
        }
      }
      barre.classList.toggle('visible', montrer);
    }
  }

  let attente = false;
  const planifier = () => {
    if (attente) return;
    attente = true;
    requestAnimationFrame(surDefilement);
  };
  window.addEventListener('scroll', planifier, { passive: true });
  window.addEventListener('resize', () => { mesurer(); planifier(); }, { passive: true });
  if (ligne && 'ResizeObserver' in window) new ResizeObserver(() => { mesurer(); planifier(); }).observe(ligne);

  // Le lien du menu correspondant à la section lue.
  const liensNav = $$('.nav a');
  if (io) {
    const lecture = new IntersectionObserver((entrees) => {
      entrees.forEach((e) => {
        if (!e.isIntersecting) return;
        const id = '#' + e.target.id;
        const correspond = liensNav.some((a) => a.getAttribute('href') === id);
        if (correspond || id === '#accueil') liensNav.forEach((a) => a.classList.toggle('actif', a.getAttribute('href') === id));
      });
    }, { rootMargin: '-45% 0px -50% 0px' });
    $$('main > section[id]').forEach((s) => lecture.observe(s));
  }

  /* ───────────────────────── Le menu (téléphone) ───────────────────────── */

  const burger = $('.burger');
  const menu = $('#menu');

  function basculerMenu(ouvrir) {
    if (!burger || !menu) return;
    const o = typeof ouvrir === 'boolean' ? ouvrir : menu.hidden;
    menu.hidden = !o;
    root.classList.toggle('menu-ouvert', o);
    burger.setAttribute('aria-expanded', String(o));
    burger.setAttribute('aria-label', t(o ? 'nav.close' : 'nav.menu'));
  }
  if (burger && menu) {
    burger.addEventListener('click', () => basculerMenu());
    $$('a', menu).forEach((a) => a.addEventListener('click', () => basculerMenu(false)));
    matchMedia('(min-width: 1121px)').addEventListener('change', (m) => { if (m.matches) basculerMenu(false); });
  }

  /* ───────────────────────── Les questions ───────────────────────── */

  const questions = $$('.faq details');

  function fermerQuestion(q) {
    const r = $('.q-r', q);
    if (!q.open || q.dataset.ferme) return;
    if (calme.matches || !r.animate) { q.open = false; return; }
    q.dataset.ferme = '1';
    const a = r.animate([{ height: r.offsetHeight + 'px', opacity: 1 }, { height: '0px', opacity: 0 }],
      { duration: 260, easing: 'ease', fill: 'forwards' });
    a.onfinish = () => { q.open = false; delete q.dataset.ferme; a.cancel(); };
  }

  function ouvrirQuestion(q) {
    questions.forEach((autre) => { if (autre !== q) fermerQuestion(autre); });
    q.open = true;
    const r = $('.q-r', q);
    if (calme.matches || !r.animate) return;
    r.animate([{ height: '0px', opacity: 0 }, { height: r.scrollHeight + 'px', opacity: 1 }],
      { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)' });
  }

  questions.forEach((q) => {
    $('summary', q).addEventListener('click', (ev) => {
      ev.preventDefault();
      if (q.open && !q.dataset.ferme) fermerQuestion(q); else ouvrirQuestion(q);
    });
  });

  /* ───────────────────────── La visionneuse ───────────────────────── */

  const vis = $('.visionneuse');
  const photos = $$('.pola-btn');
  let rang = 0;
  let avant = null;

  function montrer(i) {
    rang = (i + photos.length) % photos.length;
    const b = photos[rang];
    const img = $('img', b);
    const src = img.getAttribute('src');
    const grande = $('img', vis);
    grande.src = src.startsWith('data:') ? src : src.replace('-760.', '-1400.');
    grande.alt = img.alt;
    $('figcaption b', vis).textContent = $('.pola-titre', b).textContent;
    const legende = b.nextElementSibling;
    $('figcaption span', vis).textContent = legende ? legende.textContent : '';
    $('.vn-compte', vis).textContent = `${rang + 1} / ${photos.length}`;
  }

  function ouvrirVisionneuse(i) {
    avant = document.activeElement;
    montrer(i);
    vis.classList.add('ouverte');
    vis.setAttribute('aria-hidden', 'false');
    root.style.overflow = 'hidden';
    requestAnimationFrame(() => $('.visionneuse-fermer', vis).focus({ preventScroll: true }));
  }

  function fermerVisionneuse() {
    vis.classList.remove('ouverte');
    vis.setAttribute('aria-hidden', 'true');
    root.style.overflow = '';
    if (avant && avant.focus) avant.focus();
  }

  if (vis && photos.length) {
    photos.forEach((b, i) => b.addEventListener('click', () => ouvrirVisionneuse(i)));
    $('.visionneuse-fermer', vis).addEventListener('click', fermerVisionneuse);
    $('.vn-prec', vis).addEventListener('click', () => montrer(rang - 1));
    $('.vn-suiv', vis).addEventListener('click', () => montrer(rang + 1));
    vis.addEventListener('click', (e) => { if (e.target === vis) fermerVisionneuse(); });
  }

  document.addEventListener('keydown', (e) => {
    if (vis && vis.classList.contains('ouverte')) {
      if (e.key === 'Escape') fermerVisionneuse();
      else if (e.key === 'ArrowRight') montrer(rang + (lang === 'ar' ? -1 : 1));
      else if (e.key === 'ArrowLeft') montrer(rang + (lang === 'ar' ? 1 : -1));
      else if (e.key === 'Tab') {
        // Le focus reste dans la visionneuse.
        const f = $$('button', vis);
        const i = f.indexOf(document.activeElement);
        e.preventDefault();
        f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
      }
      return;
    }
    if (e.key === 'Escape' && menu && !menu.hidden) { basculerMenu(false); burger.focus(); }
  });

  /* ───────────────────────── La carte ───────────────────────── */

  const carte = $('iframe[data-src]');
  if (carte) {
    const charger = () => { if (!carte.src) carte.src = carte.dataset.src; };
    if (io) {
      const o = new IntersectionObserver((e) => { if (e[0].isIntersecting) { charger(); o.disconnect(); } }, { rootMargin: '600px 0px' });
      o.observe(carte);
    } else {
      charger();
    }
  }

  /* ───────────────────────── Changer de langue ─────────────────────────
   * Un fondu bref ; la section lue reste à sa place malgré les textes
   * plus longs ou plus courts. Un second clic pendant le fondu est gardé. */

  let enCours = false;
  let enAttente = null;

  function changerLangue(nouvelle) {
    if (!LANGS.includes(nouvelle)) return;
    if (enCours) { enAttente = nouvelle; return; }
    if (nouvelle === lang) return;
    enCours = true;

    const sections = $$('main > section');
    const repere = window.scrollY > 10 ? sections.find((s) => s.getBoundingClientRect().bottom > 90) : null;
    const decalage = repere ? repere.getBoundingClientRect().top : 0;

    root.classList.add('bascule');
    setTimeout(() => {
      lang = nouvelle;
      appliquerTextes();
      try { localStorage.setItem('heavenly-lang', lang); } catch (e) { /* navigation privée */ }
      try {
        const u = new URL(location.href);
        u.searchParams.set('lang', lang);
        history.replaceState(null, '', u);
      } catch (e) { /* file:// */ }
      // Recaler la section lue ; une seconde fois quand les polices de la
      // nouvelle langue sont arrivées (l'arabe se charge au premier passage),
      // sauf si la personne a défilé entre-temps.
      const recaler = () => {
        if (!repere) return;
        root.style.scrollBehavior = 'auto';
        window.scrollTo(0, window.scrollY + repere.getBoundingClientRect().top - decalage);
        root.style.scrollBehavior = '';
      };
      recaler();
      const yRecale = window.scrollY;
      if (repere && document.fonts && document.fonts.status === 'loading') {
        document.fonts.ready.then(() => { if (Math.abs(window.scrollY - yRecale) < 2) { recaler(); mesurer(); } });
      }
      mesurer();
      surDefilement();
      root.classList.remove('bascule');
      enCours = false;
      if (enAttente) { const l = enAttente; enAttente = null; changerLangue(l); }
    }, calme.matches ? 0 : 180);
  }

  $$('[data-lang]').forEach((b) => b.addEventListener('click', () => changerLangue(b.dataset.lang)));

  /* ───────────────────────── Départ ───────────────────────── */

  appliquerTextes();
  mesurer();
  surDefilement();
})();
