/*
 * EduPlateforme — le comportement du site. Aucune bibliothèque, aucun traceur.
 *
 *  0. Le compteur (« près de 3 000 ») monte une fois quand il paraît ; les
 *     feuilles du cèdre s'arrêtent de tomber quand on ne les voit plus.
 *
 *  1. Apparitions au défilement : ce qui est déjà à l'écran au chargement est
 *     marqué « vu » AVANT que la classe `js` ne cache le reste — rien ne
 *     disparaît puis ne réapparaît. Rien ne bouge si la personne a demandé de
 *     réduire les animations.
 *  2. Le menu du téléphone (replié par la feuille de style dès le premier
 *     affichage ; sans JavaScript, assets/css/sans-js.css le remet à plat).
 *  3. Le formulaire de contact n'envoie rien à ce site : il compose le message
 *     et l'ouvre dans WhatsApp ou dans la messagerie de la personne. Un lien
 *     « ?sujet=acces » ou « ?sujet=site » choisit l'objet d'avance.
 *
 * Sans JavaScript, tout reste visible et le formulaire part par courriel.
 */
(() => {
  'use strict';

  const racine = document.documentElement;
  const calme = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const io = 'IntersectionObserver' in window;

  /* 1. Apparitions */
  const aReveler = Array.from(document.querySelectorAll('.reveal'));
  if (!calme && io) {
    const bas = window.innerHeight * 0.94;
    aReveler.forEach((el) => { if (el.getBoundingClientRect().top < bas) el.classList.add('vu'); });
    const obs = new IntersectionObserver((entrees) => {
      entrees.forEach((e) => {
        if (!e.isIntersecting) return;
        e.target.classList.add('vu');
        obs.unobserve(e.target);
      });
    }, { rootMargin: '0px 0px -8% 0px' });
    aReveler.forEach((el) => { if (!el.classList.contains('vu')) obs.observe(el); });
  } else {
    aReveler.forEach((el) => el.classList.add('vu'));
  }
  racine.classList.add('js');

  /* 1 bis. Le compteur, et le sommeil des feuilles */
  const langue = racine.lang;
  const formater = (n) => (langue === 'ar' ? String(n) : n.toLocaleString(langue === 'en' ? 'en-US' : 'fr-FR'));
  const compteurs = Array.from(document.querySelectorAll('[data-compte]'));
  if (!calme && io && compteurs.length) {
    const vu = new IntersectionObserver((entrees) => {
      entrees.forEach((e) => {
        if (!e.isIntersecting) return;
        vu.unobserve(e.target);
        const el = e.target;
        const fin = Number(el.dataset.compte);
        const texteFinal = el.textContent;
        const debut = performance.now();
        const duree = 1800;
        const pas = (t) => {
          const k = Math.min(1, (t - debut) / duree);
          el.textContent = k < 1 ? formater(Math.round(fin * (1 - Math.pow(1 - k, 3)))) : texteFinal;
          if (k < 1) requestAnimationFrame(pas);
        };
        requestAnimationFrame(pas);
      });
    }, { threshold: 0.6 });
    compteurs.forEach((c) => vu.observe(c));
  }
  const cedre = document.querySelector('.hero-cedre');
  if (cedre && io) {
    new IntersectionObserver((e) => cedre.classList.toggle('endormi', !e[0].isIntersecting)).observe(cedre);
  }

  /* 2. Le menu du téléphone */
  const entete = document.querySelector('.entete');
  const bouton = document.querySelector('.menu-btn');
  if (entete && bouton) {
    const basculer = (ouvrir) => {
      entete.classList.toggle('ouvert', ouvrir);
      bouton.setAttribute('aria-expanded', String(ouvrir));
    };
    bouton.addEventListener('click', () => basculer(!entete.classList.contains('ouvert')));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && entete.classList.contains('ouvert')) { basculer(false); bouton.focus(); }
    });
    document.querySelectorAll('.nav a').forEach((a) => a.addEventListener('click', () => basculer(false)));
  }

  /* 3. Le formulaire de contact */
  const form = document.getElementById('formulaire');
  if (form) {
    const d = form.dataset;
    const objet = form.querySelector('[name="objet"]');
    try {
      const sujet = new URLSearchParams(window.location.search).get('sujet');
      if (sujet && objet && objet.querySelector(`option[value="${CSS.escape(sujet)}"]`)) objet.value = sujet;
    } catch (e) { /* adresse inhabituelle : on garde le choix par défaut */ }

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (!form.reportValidity()) return;
      const champ = (n) => (form.querySelector(`[name="${n}"]`).value || '').trim();
      const libelleObjet = objet ? objet.options[objet.selectedIndex].text : '';
      const lignes = [
        d.bonjour,
        '',
        `${d.lObjet} : ${libelleObjet}`,
        `${d.lNom} : ${champ('nom')}`,
      ];
      if (champ('etablissement')) lignes.push(`${d.lEtab} : ${champ('etablissement')}`);
      if (champ('telephone')) lignes.push(`${d.lTel} : ${champ('telephone')}`);
      lignes.push('', champ('message'));
      const texte = lignes.join('\n');
      const canal = ev.submitter && ev.submitter.value === 'courriel' ? 'courriel' : 'whatsapp';
      window.location.href = canal === 'courriel'
        ? `mailto:${d.courriel}?subject=${encodeURIComponent(libelleObjet)}&body=${encodeURIComponent(texte)}`
        : `https://wa.me/${d.whatsapp}?text=${encodeURIComponent(texte)}`;
    });
  }
})();
