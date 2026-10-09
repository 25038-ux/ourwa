/*
 * HEAVENLY · جنان — le mouvement du site.
 *
 * GSAP + ScrollTrigger pour les révélations, l'épinglage et les défilements ;
 * Lenis pour le défilement doux. Trois langues (fr, en, ar) depuis
 * window.HEAVENLY_I18N : changer de langue tire un rideau, remplace les
 * textes, inverse le sens (rtl) et reconstruit les animations.
 *
 * Sans GSAP (bloqué, hors ligne) ou avec « réduire les animations » : le
 * site reste entier, immobile, et les langues changent quand même.
 */
(() => {
  'use strict';

  const I18N = window.HEAVENLY_I18N || {};
  const root = document.documentElement;
  const LANGS = ['fr', 'en', 'ar'];
  const MAIL = 'infoheavenly24@gmail.com';
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));

  const gsap = window.gsap;
  const ScrollTrigger = window.ScrollTrigger;
  if (!gsap || !ScrollTrigger) root.classList.add('calme');
  const calme = root.classList.contains('calme');
  const pointeurFin = matchMedia('(hover: hover) and (pointer: fine)').matches;

  let lang = LANGS.includes(root.lang) ? root.lang : 'fr';
  const rtl = () => lang === 'ar';
  const t = (k) => (I18N[lang] && I18N[lang][k] != null ? I18N[lang][k] : (I18N.fr && I18N.fr[k]) || '');

  /* ───────────────────────── Les textes ───────────────────────── */

  function appliquerTextes() {
    root.lang = lang;
    root.dir = rtl() ? 'rtl' : 'ltr';
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
    placerPastille();
    try { localStorage.setItem('heavenly-lang', lang); } catch (e) { /* navigation privée */ }
    try {
      const u = new URL(location.href);
      u.searchParams.set('lang', lang);
      history.replaceState(null, '', u);
    } catch (e) { /* file:// */ }
  }

  function placerPastille() {
    const groupe = $('.entete .langues');
    const pastille = groupe && $('.langues-pastille', groupe);
    const bouton = groupe && $(`button[data-lang="${lang}"]`, groupe);
    if (!pastille || !bouton) return;
    pastille.style.transform = `translateX(${bouton.offsetLeft - 4}px)`;
    pastille.style.left = '4px';
  }

  /* ───────────────────────── Le découpage ─────────────────────────
   * Par MOTS, jamais par lettres : couper l'arabe en lettres casserait
   * leurs liaisons. Les balises (<em>, <bdi>) sont gardées. */

  function couperMots(el, classe = 'w') {
    const parcourir = (noeud) => {
      Array.from(noeud.childNodes).forEach((enfant) => {
        if (enfant.nodeType === 3) {
          const frag = document.createDocumentFragment();
          enfant.textContent.split(/(\s+)/).forEach((morceau) => {
            if (!morceau) return;
            if (/^\s+$/.test(morceau)) { frag.appendChild(document.createTextNode(morceau)); return; }
            if (classe === 'w') {
              const w = document.createElement('span');
              w.className = 'w';
              const wi = document.createElement('span');
              wi.className = 'wi';
              wi.textContent = morceau;
              w.appendChild(wi);
              frag.appendChild(w);
            } else {
              const s = document.createElement('span');
              s.className = classe;
              s.textContent = morceau;
              frag.appendChild(s);
            }
          });
          enfant.replaceWith(frag);
        } else if (enfant.nodeType === 1 && enfant.tagName !== 'BDI') {
          parcourir(enfant);
        }
      });
    };
    parcourir(el);
  }

  function couperLignes(el) {
    $$('.line', el).forEach((ligne) => {
      if (ligne.firstElementChild && ligne.firstElementChild.classList.contains('li')) return;
      ligne.innerHTML = `<span class="li">${ligne.innerHTML}</span>`;
    });
  }

  /* ───────────────────────── Le défilement doux ───────────────────────── */

  let lenis = null;
  if (!calme && window.Lenis) {
    lenis = new window.Lenis({ lerp: 0.085, smoothWheel: true, wheelMultiplier: 0.95 });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((temps) => lenis.raf(temps * 1000));
    gsap.ticker.lagSmoothing(0);
  }
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  function allerA(cible, immediat = false) {
    if (lenis) {
      lenis.scrollTo(cible, { offset: 0, duration: immediat ? 0 : 1.8, immediate: immediat, easing: (x) => 1 - Math.pow(1 - x, 4) });
    } else if (typeof cible === 'number') {
      window.scrollTo({ top: cible, behavior: immediat || calme ? 'auto' : 'smooth' });
    } else {
      cible.scrollIntoView({ behavior: immediat || calme ? 'auto' : 'smooth' });
    }
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const id = a.getAttribute('href');
    const cible = id === '#accueil' || id === '#' ? 0 : $(id);
    if (cible === null) return;
    e.preventDefault();
    fermerMenu();
    allerA(cible);
    if (a.classList.contains('skip') && cible) { cible.setAttribute('tabindex', '-1'); cible.focus({ preventScroll: true }); }
  });

  /* ───────────────────────── L'en-tête et le menu ───────────────────────── */

  const entete = $('.entete');
  let menuOuvert = false;

  function fermerMenu() {
    if (!menuOuvert) return;
    menuOuvert = false;
    root.classList.remove('menu-ouvert');
    $('.burger').setAttribute('aria-expanded', 'false');
    $('#menu').setAttribute('aria-hidden', 'true');
    lenis && lenis.start();
  }
  $('.burger').addEventListener('click', () => {
    if (menuOuvert) { fermerMenu(); return; }
    menuOuvert = true;
    root.classList.add('menu-ouvert');
    entete.classList.remove('cache');
    $('.burger').setAttribute('aria-expanded', 'true');
    $('#menu').setAttribute('aria-hidden', 'false');
    lenis && lenis.stop();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') fermerMenu(); });

  let dernierY = 0;
  const barre = $('.barre-mobile');
  // La barre d'action du téléphone : après l'accueil, sauf là où ses deux
  // gestes sont déjà sous les yeux (nous trouver, le mot de la fin, le pied).
  function barreMobile() {
    if (!barre) return;
    const deja = ['#visite', '.fin', '.pied', '.etapes-actions'].some((sel) => {
      const el = $(sel);
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.top < window.innerHeight && r.bottom > 0;
    });
    barre.classList.toggle('visible', window.scrollY > window.innerHeight * 0.7 && !deja);
  }
  function surDefilement() {
    const y = window.scrollY;
    barreMobile();
    entete.classList.toggle('colle', y > 30);
    if (!menuOuvert) {
      if (y > 420 && y > dernierY + 2) entete.classList.add('cache');
      else if (y < dernierY - 2 || y <= 420) entete.classList.remove('cache');
    }
    dernierY = y;
  }
  if (lenis) lenis.on('scroll', surDefilement);
  else window.addEventListener('scroll', surDefilement, { passive: true });
  // Au doigt, le défilement est natif : la barre écoute aussi la fenêtre.
  window.addEventListener('scroll', barreMobile, { passive: true });

  // L'en-tête passe en clair au-dessus des sections de nuit.
  function sombresSousEntete() {
    const y = (entete.offsetHeight || 70) / 2;
    const sombre = $$('.nuit, .fin, .pied').some((s) => {
      const r = s.getBoundingClientRect();
      return r.top <= y && r.bottom >= y;
    });
    entete.classList.toggle('sur-nuit', sombre);
  }
  if (lenis) lenis.on('scroll', sombresSousEntete);
  else window.addEventListener('scroll', sombresSousEntete, { passive: true });

  /* ───────────────────────── Les étoiles ───────────────────────── */

  function ciel(canvas) {
    const c = canvas.getContext('2d');
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0, h = 0, etoiles = [], raf = 0, visible = false;
    const redimensionner = () => {
      const r = canvas.getBoundingClientRect();
      w = r.width; h = r.height;
      if (!w || !h) return;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.min(420, Math.round((w * h) / 5200));
      etoiles = Array.from({ length: n }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: Math.random() < 0.08 ? 1.3 + Math.random() * 0.8 : 0.25 + Math.random() * 0.9,
        p: Math.random() * Math.PI * 2,
        v: 0.35 + Math.random() * 1.3,
        or: Math.random() < 0.14,
        prof: 0.2 + Math.random() * 0.8,
      }));
      dessiner(performance.now());
    };
    const dessiner = (temps) => {
      c.clearRect(0, 0, w, h);
      const decalage = (lenis ? lenis.scroll : window.scrollY) * 0.06;
      for (const e of etoiles) {
        const a = 0.25 + 0.75 * (0.5 + 0.5 * Math.sin(e.p + temps * 0.0011 * e.v));
        let y = (e.y - decalage * e.prof) % h;
        if (y < 0) y += h;
        c.globalAlpha = a * (e.or ? 0.95 : 0.8);
        c.fillStyle = e.or ? '#E6CD93' : '#F5EFE3';
        c.beginPath();
        c.arc(e.x, y, e.r, 0, Math.PI * 2);
        c.fill();
        if (e.r > 1.3) {
          c.globalAlpha = a * 0.25;
          c.beginPath();
          c.arc(e.x, y, e.r * 3.2, 0, Math.PI * 2);
          c.fill();
        }
      }
    };
    const boucle = (temps) => { dessiner(temps); raf = visible ? requestAnimationFrame(boucle) : 0; };
    new ResizeObserver(redimensionner).observe(canvas);
    new IntersectionObserver(([entree]) => {
      visible = entree.isIntersecting;
      if (visible && !raf && !calme) raf = requestAnimationFrame(boucle);
    }).observe(canvas);
  }
  $$('canvas.etoiles').forEach(ciel);

  /* ───────────────────────── La carte, au dernier moment ───────────────────────── */

  const iframe = $('.carte-arche iframe');
  if (iframe) {
    new IntersectionObserver((entrees, obs) => {
      if (entrees[0].isIntersecting) { iframe.src = iframe.dataset.src; obs.disconnect(); }
    }, { rootMargin: '700px 0px' }).observe(iframe);
  }

  /* ───────────────────────── Les questions ───────────────────────── */

  // Une réponse s'ouvre en glissant, et referme celle qui était ouverte.
  const questions = $$('.faq .q');
  function fermerQuestion(q) {
    const r = $('.q-r', q);
    if (calme) { q.open = false; return; }
    gsap.fromTo(r, { height: r.offsetHeight }, { height: 0, duration: 0.5, ease: 'power3.inOut', onComplete: () => { q.open = false; r.style.height = ''; } });
  }
  questions.forEach((q) => {
    $('summary', q).addEventListener('click', (e) => {
      e.preventDefault();
      if (q.open) { fermerQuestion(q); return; }
      questions.filter((autre) => autre !== q && autre.open).forEach(fermerQuestion);
      q.open = true;
      if (!calme) {
        const r = $('.q-r', q);
        gsap.fromTo(r, { height: 0 }, { height: r.scrollHeight, duration: 0.6, ease: 'power3.out', onComplete: () => { r.style.height = ''; } });
      }
    });
  });

  /* ───────────────────────── La visionneuse ───────────────────────── */

  const visionneuse = $('.visionneuse');
  const figures = $$('.galerie .g');
  let vue = -1;
  let dernierFocus = null;

  function montrer(i) {
    vue = (i + figures.length) % figures.length;
    const fig = figures[vue];
    const petite = $('img', fig);
    const img = $('.visionneuse-cadre img', visionneuse);
    img.src = petite.currentSrc || petite.src;
    // La grande version, si elle existe, remplace la petite quand elle arrive.
    const grande = (petite.getAttribute('srcset') || '').split(',').map((x) => x.trim().split(' ')[0]).pop();
    if (grande && grande !== img.src) {
      const pre = new Image();
      pre.onload = () => { if (figures[vue] === fig) img.src = grande; };
      pre.src = grande;
    }
    img.alt = petite.alt;
    $('.visionneuse-cadre b', visionneuse).textContent = $('figcaption b', fig).textContent;
    $('.visionneuse-cadre span', visionneuse).textContent = $('figcaption span', fig).textContent;
    $('.vn-compte', visionneuse).textContent = `${String(vue + 1).padStart(2, '0')} / ${String(figures.length).padStart(2, '0')}`;
  }
  function ouvrirVisionneuse(i) {
    dernierFocus = document.activeElement;
    montrer(i);
    visionneuse.classList.add('ouverte');
    visionneuse.setAttribute('aria-hidden', 'false');
    lenis && lenis.stop();
    $('.visionneuse-fermer', visionneuse).focus({ preventScroll: true });
  }
  function fermerVisionneuse() {
    if (!visionneuse.classList.contains('ouverte')) return;
    visionneuse.classList.remove('ouverte');
    visionneuse.setAttribute('aria-hidden', 'true');
    lenis && lenis.start();
    if (dernierFocus) dernierFocus.focus({ preventScroll: true });
  }
  figures.forEach((fig, i) => {
    fig.tabIndex = 0;
    fig.setAttribute('role', 'button');
    fig.addEventListener('click', () => ouvrirVisionneuse(i));
    fig.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); ouvrirVisionneuse(i); } });
  });
  $('.visionneuse-fermer', visionneuse).addEventListener('click', fermerVisionneuse);
  visionneuse.addEventListener('click', (e) => { if (e.target === visionneuse) fermerVisionneuse(); });
  // « Suivant » suit le sens de lecture : en arabe, la flèche de gauche avance.
  $('.vn-suiv', visionneuse).addEventListener('click', () => montrer(vue + 1));
  $('.vn-prec', visionneuse).addEventListener('click', () => montrer(vue - 1));
  document.addEventListener('keydown', (e) => {
    if (!visionneuse.classList.contains('ouverte')) return;
    if (e.key === 'Escape') fermerVisionneuse();
    const avance = rtl() ? 'ArrowLeft' : 'ArrowRight';
    const recule = rtl() ? 'ArrowRight' : 'ArrowLeft';
    if (e.key === avance) montrer(vue + 1);
    if (e.key === recule) montrer(vue - 1);
  });

  /* ───────────────────────── Le curseur, l'aimant, la lumière ───────────────────────── */

  if (!calme && pointeurFin) {
    const curseur = $('.curseur');
    const point = $('.curseur-point');
    const anneau = $('.curseur-anneau');
    const px = gsap.quickTo(point, 'x', { duration: 0.12, ease: 'power3' });
    const py = gsap.quickTo(point, 'y', { duration: 0.12, ease: 'power3' });
    const ax = gsap.quickTo(anneau, 'x', { duration: 0.55, ease: 'power3' });
    const ay = gsap.quickTo(anneau, 'y', { duration: 0.55, ease: 'power3' });
    let premier = true;
    window.addEventListener('pointermove', (e) => {
      if (premier) {
        // Pas de cercle oublié dans un coin avant le premier mouvement.
        premier = false;
        gsap.set([point, anneau], { x: e.clientX, y: e.clientY });
        curseur.classList.remove('cache');
      }
      px(e.clientX); py(e.clientY); ax(e.clientX); ay(e.clientY);
      const voir = e.target.closest('[data-cursor="view"]');
      const lien = !voir && e.target.closest('a, button, .svc');
      curseur.classList.toggle('voir', !!voir);
      curseur.classList.toggle('lien', !!lien);
    }, { passive: true });
    document.addEventListener('pointerleave', () => curseur.classList.add('cache'));
    document.addEventListener('pointerenter', () => curseur.classList.remove('cache'));

    $$('[data-magnetic]').forEach((el) => {
      const mx = gsap.quickTo(el, 'x', { duration: 0.6, ease: 'power3' });
      const my = gsap.quickTo(el, 'y', { duration: 0.6, ease: 'power3' });
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        mx((e.clientX - (r.left + r.width / 2)) * 0.28);
        my((e.clientY - (r.top + r.height / 2)) * 0.4);
      });
      el.addEventListener('pointerleave', () => {
        gsap.to(el, { x: 0, y: 0, duration: 1.1, ease: 'elastic.out(1, 0.4)' });
      });
    });

    $$('.carte').forEach((carte) => {
      carte.addEventListener('pointermove', (e) => {
        const r = carte.getBoundingClientRect();
        carte.style.setProperty('--mx', `${e.clientX - r.left}px`);
        carte.style.setProperty('--my', `${e.clientY - r.top}px`);
      });
    });

    // Les services : l'image qui suit la souris.
    const apercu = $('.svc-apercu');
    const liste = $('.liste-services');
    if (apercu && liste) {
      const ix = gsap.quickTo(apercu, 'x', { duration: 0.7, ease: 'power3' });
      const iy = gsap.quickTo(apercu, 'y', { duration: 0.7, ease: 'power3' });
      const images = $$('img', apercu);
      liste.addEventListener('pointermove', (e) => { ix(e.clientX); iy(e.clientY); });
      $$('.svc', liste).forEach((ligne) => {
        ligne.addEventListener('pointerenter', () => {
          apercu.classList.add('visible');
          images.forEach((img) => img.classList.toggle('actif', img.dataset.k === ligne.dataset.img));
        });
      });
      liste.addEventListener('pointerleave', () => apercu.classList.remove('visible'));
    }
  }

  /* ───────────────────────── Les animations au défilement ───────────────────────── */

  let ctx = null;
  let mm = null;
  const defiles = [];

  // Après un changement de langue, ce qui est DÉJÀ passé au-dessus ne se rejoue
  // pas : il est posé tel quel (sinon un déclencheur « une fois » déjà dépassé
  // pourrait le laisser caché).
  let reconstruction = false;
  const dejaVu = (el) => reconstruction && el.getBoundingClientRect().top < window.innerHeight * 0.9;

  function construire() {
    if (calme) return;
    ctx = gsap.context(() => {
      const sens = rtl() ? -1 : 1;

      // L'accueil s'éloigne doucement.
      gsap.to('.hero-texte', { y: -70, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });
      gsap.to('.hero-visuel .arche-cadre', { y: 90, ease: 'none', scrollTrigger: { trigger: '.hero', start: 'top top', end: 'bottom top', scrub: true } });

      // Les titres, mot à mot.
      $$('[data-split="words"]').forEach((el) => {
        couperMots(el);
        if (dejaVu(el)) return;
        gsap.from($$('.wi', el), {
          yPercent: 115,
          rotate: rtl() ? 0 : 3,
          duration: 1.25,
          ease: 'expo.out',
          stagger: 0.05,
          scrollTrigger: { trigger: el, start: 'top 88%', once: true },
        });
      });

      // Ce qui monte simplement.
      $$('[data-reveal]').forEach((el) => {
        if (dejaVu(el)) { gsap.set(el, { opacity: 1, y: 0 }); return; }
        gsap.to(el, { opacity: 1, y: 0, duration: 1.2, ease: 'expo.out', scrollTrigger: { trigger: el, start: 'top 90%', once: true } });
      });

      // Les images : un rideau qui se lève, l'image qui se pose.
      $$('.revele').forEach((el) => {
        const img = $('img', el);
        if (dejaVu(el)) { gsap.set(el, { clipPath: 'inset(0% 0% 0% 0%)' }); return; }
        const tl = gsap.timeline({ scrollTrigger: { trigger: el, start: 'top 88%', once: true } });
        tl.fromTo(el, { clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.5, ease: 'expo.inOut' });
        if (img) tl.fromTo(img, { scale: 1.3 }, { scale: 1, duration: 2, ease: 'expo.out' }, 0.1);
        const cadre = el.closest('.arche-cadre');
        if (cadre) tl.add(() => cadre.classList.add('vu'), 0.8);
      });

      // Les photos qui flottent à des vitesses différentes.
      $$('[data-parallax]').forEach((el) => {
        const v = parseFloat(el.dataset.parallax) || 0;
        gsap.fromTo(el, { y: v * 7 }, { y: -v * 7, ease: 'none', scrollTrigger: { trigger: el, start: 'top bottom', end: 'bottom top', scrub: true } });
      });
      $$('.galerie .g-img img').forEach((img) => {
        gsap.fromTo(img, { yPercent: -6 }, { yPercent: 6, ease: 'none', scrollTrigger: { trigger: img.parentElement, start: 'top bottom', end: 'bottom top', scrub: true } });
      });

      // Le manifeste s'allume mot à mot.
      $$('[data-scrub]').forEach((el) => {
        couperMots(el, 'mot-s');
        gsap.to($$('.mot-s', el), {
          opacity: 1,
          ease: 'none',
          stagger: 0.12,
          scrollTrigger: { trigger: el, start: 'top 82%', end: 'bottom 48%', scrub: 0.8 },
        });
      });

      // Les chiffres.
      $$('[data-count]').forEach((b) => {
        if (dejaVu(b)) return;
        const fin = parseInt(b.dataset.count, 10);
        const o = { v: 0 };
        gsap.to(o, {
          v: fin,
          duration: 1.6,
          ease: 'power2.out',
          onUpdate: () => { b.textContent = String(Math.round(o.v)); },
          scrollTrigger: { trigger: b, start: 'top 90%', once: true },
        });
      });

      // Le défilé des mots : sa vitesse suit celle du lecteur.
      defiles.length = 0;
      $$('.defile-rang').forEach((rang) => {
        const piste = $('.defile-piste', rang);
        const n = piste.children.length;
        const versDroite = getComputedStyle(rang).direction === 'rtl';
        const tw = gsap.to(piste, { xPercent: (versDroite ? 100 : -100) / n, duration: rang.classList.contains('r1') ? 38 : 30, ease: 'none', repeat: -1 });
        const base = rang.classList.contains('r2') ? -1 : 1;
        // Loin du départ : la boucle peut aussi tourner à l'envers.
        tw.totalTime(tw.duration() * 400);
        tw.timeScale(base);
        defiles.push({ tw, base });
      });
      ScrollTrigger.create({
        trigger: '.defile',
        start: 'top bottom',
        end: 'bottom top',
        onUpdate: (self) => {
          const v = self.getVelocity();
          defiles.forEach(({ tw, base }) => {
            const s = self.direction === 1 ? 1 : -1;
            gsap.to(tw, { timeScale: base * s * (1 + Math.min(Math.abs(v) / 260, 5)), duration: 0.25, overwrite: true });
            gsap.to(tw, { timeScale: base * s, duration: 1.2, delay: 0.25, ease: 'power2.out' });
          });
        },
      });

      // Les trois langues glissent depuis les bords.
      $$('[data-glisse]').forEach((li) => {
        const d = parseFloat(li.dataset.glisse) * sens;
        gsap.fromTo($('.langue-mot', li), { xPercent: 16 * d, opacity: 0.15 }, { xPercent: 0, opacity: 1, ease: 'none', scrollTrigger: { trigger: li, start: 'top bottom', end: 'top 50%', scrub: 1 } });
        gsap.fromTo($('.langue-desc', li), { opacity: 0, y: 20 }, { opacity: 1, y: 0, ease: 'none', scrollTrigger: { trigger: li, start: 'top 85%', end: 'top 55%', scrub: 1 } });
      });

      // Les valeurs, une à une.
      const cartes = $$('.carte').filter((c) => !dejaVu(c));
      if (cartes.length) {
        gsap.set(cartes, { opacity: 0 });
        ScrollTrigger.batch(cartes, {
          start: 'top 88%',
          once: true,
          onEnter: (lot) => gsap.fromTo(lot, { opacity: 0, y: 70 }, { opacity: 1, y: 0, duration: 1.3, ease: 'expo.out', stagger: 0.1 }),
        });
      }

      // Le verset sort de la brume ; l'étoile tourne derrière.
      if (!dejaVu($('.verset'))) {
        gsap.fromTo('.verset-ar', { opacity: 0, filter: 'blur(16px)', scale: 0.94 }, { opacity: 1, filter: 'blur(0px)', scale: 1, duration: 2, ease: 'power3.out', scrollTrigger: { trigger: '.verset', start: 'top 70%', once: true } });
        gsap.fromTo(['.verset-trad', '.verset-ref', '.verset-note'], { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 1.2, stagger: 0.15, delay: 0.5, ease: 'expo.out', scrollTrigger: { trigger: '.verset', start: 'top 70%', once: true } });
      }
      ['.verset-etoile', '.fin-etoile'].forEach((sel) => {
        const el = $(sel);
        if (!el) return;
        gsap.set(el, { x: 0, y: 0, xPercent: -50, yPercent: -50 });
        gsap.fromTo(el, { rotate: -30 }, { rotate: 60, ease: 'none', scrollTrigger: { trigger: el.parentElement, start: 'top bottom', end: 'bottom top', scrub: true } });
      });

      // La ligne de lecture, tout en haut.
      gsap.fromTo('.progression-page', { scaleX: 0 }, { scaleX: 1, ease: 'none', scrollTrigger: { start: 0, end: 'max', scrub: 0.3 } });

      // Les trois pas : ils montent, et la ligne d'or les relie.
      const etapes = $$('.etape').filter((e) => !dejaVu(e));
      if (etapes.length) {
        gsap.from(etapes, { opacity: 0, y: 50, duration: 1.2, stagger: 0.15, ease: 'expo.out', scrollTrigger: { trigger: '.etapes-liste', start: 'top 82%', once: true } });
      }

      // Grandir : la règle se remplit.
      gsap.fromTo('.regle-remplie', { scaleY: 0 }, { scaleY: 1, ease: 'none', scrollTrigger: { trigger: '.toises', start: 'top 80%', end: 'bottom 40%', scrub: 1 } });

      // Le pied de page : le grand nom qui remonte.
      gsap.fromTo('.pied-geant', { yPercent: 50, opacity: 0 }, { yPercent: 0, opacity: 1, ease: 'none', scrollTrigger: { trigger: '.pied', start: 'top bottom', end: 'bottom bottom', scrub: 1 } });

      // Le lien de navigation de la section en cours.
      $$('.nav a').forEach((a) => {
        const section = $(a.getAttribute('href'));
        if (!section) return;
        ScrollTrigger.create({ trigger: section, start: 'top 50%', end: 'bottom 50%', onToggle: (s) => a.classList.toggle('actif', s.isActive) });
      });

      // Le parcours : un long couloir horizontal, sur grand écran.
      mm = gsap.matchMedia();
      mm.add('(min-width: 901px)', () => {
        const piste = $('.parcours-piste');
        const distance = () => Math.max(0, piste.scrollWidth - window.innerWidth);
        const signe = rtl() ? 1 : -1;
        const couloir = gsap.to(piste, {
          x: () => signe * distance(),
          ease: 'none',
          scrollTrigger: {
            trigger: '.parcours',
            start: 'top top',
            end: () => `+=${distance()}`,
            pin: true,
            scrub: 0.9,
            invalidateOnRefresh: true,
            anticipatePin: 1,
          },
        });
        gsap.fromTo('.parcours-progression span', { scaleX: 0 }, { scaleX: 1, ease: 'none', scrollTrigger: { trigger: '.parcours', start: 'top top', end: () => `+=${distance()}`, scrub: 0.9, invalidateOnRefresh: true } });
        // La profondeur dans les photos du couloir (de gauche à droite seulement :
        // le couloir arabe avance dans l'autre sens).
        if (!rtl()) {
          $$('.cycle').forEach((carte) => {
            const img = $('img', carte);
            gsap.fromTo(img, { xPercent: -7, scale: 1.18 }, { xPercent: 7, scale: 1.18, ease: 'none', scrollTrigger: { trigger: carte, containerAnimation: couloir, start: 'left right', end: 'right left', scrub: true } });
          });
        }
      });
      // Pourquoi nous : la raison lue s'allume, la photo à côté change avec elle.
      mm.add('(min-width: 901px)', () => {
        const raisons = $$('.raison');
        const images = $$('.pourquoi-visuel img');
        const allumer = (i) => {
          raisons.forEach((r, j) => r.classList.toggle('actif', j === i));
          images.forEach((img, j) => img.classList.toggle('actif', j === i));
        };
        raisons.forEach((r, i) => {
          ScrollTrigger.create({ trigger: r, start: 'top 62%', end: 'bottom 62%', onToggle: (st) => { if (st.isActive) allumer(i); } });
        });
        gsap.fromTo('.etapes-ligne span', { scaleX: 0 }, { scaleX: 1, ease: 'none', scrollTrigger: { trigger: '.etapes-liste', start: 'top 72%', end: 'bottom 55%', scrub: 1 } });
      });
      mm.add('(max-width: 900px)', () => {
        gsap.fromTo('.etapes-ligne span', { scaleY: 0 }, { scaleY: 1, ease: 'none', scrollTrigger: { trigger: '.etapes-liste', start: 'top 70%', end: 'bottom 60%', scrub: 1 } });
        $$('.cycle').forEach((carte) => {
          if (dejaVu(carte)) return;
          gsap.from(carte, { opacity: 0, y: 60, duration: 1.2, ease: 'expo.out', scrollTrigger: { trigger: carte, start: 'top 88%', once: true } });
        });
      });
    });
  }

  function defaire() {
    if (mm) { mm.revert(); mm = null; }
    if (ctx) { ctx.revert(); ctx = null; }
  }

  /* ───────────────────────── L'ouverture ───────────────────────── */

  function introAccueil() {
    const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });
    tl.to('.entete', { opacity: 1, duration: 1.2 }, 0.2)
      .fromTo('.hero-titre .li', { yPercent: 115 }, { yPercent: 0, duration: 1.6, stagger: 0.12 }, 0)
      .fromTo('.hero-surtitre', { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 1.2 }, 0.15)
      .fromTo('.hero-arche', { clipPath: 'inset(100% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration: 1.8, ease: 'expo.inOut' }, 0)
      .fromTo('.hero-arche img', { scale: 1.4 }, { scale: 1, duration: 2.6 }, 0.1)
      .add(() => $('.hero-visuel .arche-cadre').classList.add('vu'), 1.1)
      .fromTo(['.hero-chapo', '.hero-actions'], { opacity: 0, y: 24 }, { opacity: 1, y: 0, duration: 1.4, stagger: 0.12 }, 0.6)
      .fromTo('.hero-preuves li', { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 1.1, stagger: 0.08 }, 0.95)
      .fromTo('.hero-legende', { opacity: 0 }, { opacity: 1, duration: 1.4 }, 1.1)
      .fromTo('.sceau', { opacity: 0, scale: 0.5, rotate: -90 }, { opacity: 1, scale: 1, rotate: 0, duration: 1.8 }, 0.9);
    return tl;
  }

  function ouverture() {
    const loader = $('.loader');
    const deja = (() => { try { return sessionStorage.getItem('heavenly-vu') === '1'; } catch (e) { return false; } })();
    try { sessionStorage.setItem('heavenly-vu', '1'); } catch (e) { /* rien */ }
    const tl = gsap.timeline();
    tl.to('.loader-star path', { strokeDashoffset: 0, duration: 1.4, ease: 'power2.inOut', stagger: 0.18 })
      .fromTo('.loader-name', { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.9, ease: 'expo.out' }, '-=0.6')
      .fromTo('.loader-tag', { opacity: 0 }, { opacity: 1, duration: 0.7 }, '-=0.6')
      .to('.loader-in', { opacity: 0, y: -24, duration: 0.55, ease: 'power2.in' }, '+=0.25')
      .fromTo(loader, { clipPath: 'inset(0% 0% 0% 0%)' }, { clipPath: 'inset(0% 0% 100% 0%)', duration: 1.1, ease: 'expo.inOut' }, '-=0.15')
      .add(() => { introAccueil(); }, '-=0.6')
      .add(() => { loader.style.display = 'none'; occupe = false; });
    if (deja) tl.timeScale(2.2);
  }

  /* ───────────────────────── Changer de langue ───────────────────────── */

  let occupe = !calme;
  let enAttente = null;

  function sectionEnCours() {
    const milieu = window.innerHeight * 0.35;
    const sections = $$('main section, .pied');
    for (const s of sections) {
      const r = s.getBoundingClientRect();
      if (r.top <= milieu && r.bottom > milieu) return { s, ratio: (milieu - r.top) / r.height };
    }
    return null;
  }

  function changerLangue(suivante) {
    if (!LANGS.includes(suivante)) return;
    // Un clic pendant le rideau n'est pas perdu : il passe juste après.
    if (occupe) { enAttente = suivante; return; }
    if (suivante === lang) return;
    fermerMenu();
    if (calme) {
      lang = suivante;
      appliquerTextes();
      return;
    }
    occupe = true;
    const loader = $('.loader');
    const ici = sectionEnCours();
    const fini = () => {
      occupe = false;
      const ensuite = enAttente;
      enAttente = null;
      if (ensuite && ensuite !== lang) changerLangue(ensuite);
    };
    const tl = gsap.timeline();
    tl.set(loader, { display: 'grid', clipPath: 'inset(100% 0% 0% 0%)' })
      .set('.loader-in', { opacity: 1, y: 0 })
      .set('.loader-star path', { strokeDashoffset: 0 })
      .set(['.loader-name', '.loader-tag'], { opacity: 1, y: 0 })
      .to(loader, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.7, ease: 'expo.inOut' })
      .add(() => {
        defaire();
        lang = suivante;
        appliquerTextes();
        couperLignes($('.hero-titre'));
        reconstruction = true;
        construire();
        reconstruction = false;
        ScrollTrigger.refresh();
        if (ici) {
          const r = ici.s.getBoundingClientRect();
          const y = window.scrollY + r.top + r.height * ici.ratio - window.innerHeight * 0.35;
          allerA(Math.max(0, y), true);
        }
        ScrollTrigger.update();
        sombresSousEntete();
        $('.loader-tag').textContent = t('loader.tagline');
      })
      .to('.loader-in', { opacity: 0, duration: 0.3 }, '+=0.2')
      .to(loader, { clipPath: 'inset(0% 0% 100% 0%)', duration: 0.9, ease: 'expo.inOut' })
      .add(() => {
        if ($('.hero').getBoundingClientRect().bottom > 0) {
          gsap.fromTo('.hero-titre .li', { yPercent: 115 }, { yPercent: 0, duration: 1.3, stagger: 0.1, ease: 'expo.out' });
        }
      }, '-=0.5')
      .set(loader, { display: 'none' })
      .add(fini);
  }

  $$('[data-lang]').forEach((b) => b.addEventListener('click', () => changerLangue(b.dataset.lang)));

  /* ───────────────────────── Départ ───────────────────────── */

  appliquerTextes();
  window.addEventListener('resize', placerPastille);

  if (calme) {
    $('.loader') && ($('.loader').style.display = 'none');
    sombresSousEntete();
    return;
  }

  gsap.registerPlugin(ScrollTrigger);
  couperLignes($('.hero-titre'));
  gsap.set('.hero-titre .li', { yPercent: 115 });
  window.scrollTo(0, 0);
  construire();

  const demarrer = () => {
    ScrollTrigger.refresh();
    sombresSousEntete();
    ouverture();
    const cible = location.hash && location.hash.length > 1 && document.getElementById(location.hash.slice(1));
    if (cible) setTimeout(() => allerA(cible), 1400);
  };
  if (document.fonts && document.fonts.ready) {
    // Les polices d'abord : les mots se mesurent avec leur vraie forme.
    Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 2500))]).then(demarrer);
  } else {
    window.addEventListener('load', demarrer);
  }
  window.addEventListener('load', () => ScrollTrigger.refresh());
})();
