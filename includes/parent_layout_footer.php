    </main>
</div>

<!-- ===== Bottom nav mobile (app native) ===== -->
<nav class="parent-bottom-nav" aria-label="Navigation">
    <?php
    $bottom = [
        'tableau_bord.php' => ['label'=>t('accueil'),  'svg'=>'<path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>'],
        'resultats.php'    => ['label'=>t('resultats'),'svg'=>'<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>'],
        'exercices.php'    => ['label'=>t('exercices'),'svg'=>'<path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>'],
        'absences.php'     => ['label'=>t('absences'), 'svg'=>'<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>'],
        'messages.php'     => ['label'=>t('messages'), 'svg'=>'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>'],
    ];
    foreach ($bottom as $f => $l): ?>
        <a href="<?= e($base) ?>/pages/parent/<?= $f ?>" class="<?= $pg===$f?'active':'' ?>">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><?= $l['svg'] ?></svg>
            <span><?= e($l['label']) ?></span>
        </a>
    <?php endforeach; ?>
</nav>

<!-- ===== Panneau notifications glass ===== -->
<div class="notif-overlay" id="notifOverlay" onclick="toggleNotif()"></div>
<div class="notif-panel" id="notifPanel" aria-hidden="true">
    <div class="notif-panel-head">
        <h3><?= e(t('notifications')) ?></h3>
        <button class="g-btn g-btn-ghost" style="padding:.4rem .75rem;font-size:.78rem;min-height:32px;" onclick="marquerToutLu()"><?= e(t('tout_marquer_lu')) ?></button>
    </div>
    <div class="notif-panel-body" id="notifList">
        <p style="padding:1rem;color:var(--ink-500);text-align:center;"><?= e(t('chargement')) ?></p>
    </div>
</div>

<script>
(function () {
    const base = "<?= e($base) ?>";
    const csrf = document.querySelector('meta[name="csrf-token"]').content;
    const LANG = "<?= e(langue_courante()) ?>";
    const I18N = {
        fr: {
            now: "à l'instant",
            min_ago: "il y a {n} min",
            h_ago: "il y a {n} h",
            calm: "Tout est calme",
            no_notif: "Aucune notification pour le moment.",
            locale: "fr-FR",
        },
        ar: {
            now: "الآن",
            min_ago: "منذ {n} دقيقة",
            h_ago: "منذ {n} ساعة",
            calm: "كل شيء هادئ",
            no_notif: "لا توجد إشعارات في الوقت الحالي.",
            locale: "ar-MR",
        }
    }[LANG === 'ar' ? 'ar' : 'fr'];

    let lastId = 0;
    let permission = false;
    let pollInterval = 15000;     // 15s en focus (compatible hébergement mutualisé)
    let pollTimer = null;
    let allItems = [];

    // Demander la permission (lazy : seulement quand l'utilisateur ouvre la cloche)
    function askPermission() {
        if (!("Notification" in window)) return;
        if (Notification.permission === "granted") { permission = true; return; }
        if (Notification.permission === "denied")  return;
        Notification.requestPermission().then(p => permission = (p === "granted"));
    }

    function vibrate() {
        if ("vibrate" in navigator) navigator.vibrate([200, 100, 200]);
    }

    function showBrowserNotif(n) {
        // 1) Notification native du navigateur si autorisée (en arrière-plan)
        if (permission && "Notification" in window && document.hidden) {
            try {
                const notif = new Notification(n.titre, {
                    body: (n.contenu || '').substring(0, 180),
                    tag: "edu-" + n.id,
                    requireInteraction: false,
                    silent: false
                });
                setTimeout(() => notif.close(), 8000);
            } catch (e) { /* silently fail */ }
        }
        // 2) Toast iOS-style à l'écran (TOUJOURS, en plus)
        showIosToast(n);
        vibrate();
    }

    function showIosToast(n) {
        let container = document.getElementById('ios-toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'ios-toast-container';
            document.body.appendChild(container);
        }
        const isRtl = document.documentElement.dir === 'rtl';
        const toast = document.createElement('div');
        toast.className = 'ios-toast';
        const icon = ({
            message: '💬', note: '📊', absence: '📅', remarque: '💡',
            exercice: '📚', paiement: '💳', info: '🔔'
        }[n.type] || '🔔');
        toast.innerHTML = `
            <div class="ios-toast-icon">${icon}</div>
            <div class="ios-toast-body">
                <div class="ios-toast-app">El OURWA</div>
                <div class="ios-toast-title">${escapeHtml(n.titre)}</div>
                <div class="ios-toast-msg">${escapeHtml((n.contenu||'').substring(0, 110))}</div>
            </div>
            <button class="ios-toast-close" aria-label="Close">&times;</button>
        `;
        container.appendChild(toast);
        // Animation d'entrée
        requestAnimationFrame(() => toast.classList.add('ios-toast-in'));
        const dismiss = () => {
            toast.classList.add('ios-toast-out');
            setTimeout(() => toast.remove(), 350);
        };
        toast.querySelector('.ios-toast-close').addEventListener('click', dismiss);
        toast.addEventListener('click', e => {
            if (e.target.classList.contains('ios-toast-close')) return;
            // ouvre le panneau notifications
            toggleNotif();
            dismiss();
        });
        setTimeout(dismiss, 6000);
    }

    function formatDate(iso) {
        const d = new Date(iso.replace(' ', 'T'));
        const now = new Date();
        const diff = (now - d) / 1000;
        if (diff < 60)    return I18N.now;
        if (diff < 3600)  return I18N.min_ago.replace('{n}', Math.floor(diff/60));
        if (diff < 86400) return I18N.h_ago.replace('{n}', Math.floor(diff/3600));
        return d.toLocaleDateString(I18N.locale, { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
    }

    function renderList(items) {
        const list = document.getElementById("notifList");
        if (!items.length) {
            list.innerHTML = `
                <div class="empty-state" style="padding:2rem 1rem;">
                    <svg class="empty-state-illus" viewBox="0 0 120 120" fill="none">
                        <circle cx="60" cy="60" r="50" fill="#cffafe"/>
                        <path d="M40 55 Q40 40 60 40 Q80 40 80 55 L80 75 Q80 80 75 80 L45 80 Q40 80 40 75 Z" fill="#67e8f9" stroke="#0e7490" stroke-width="2"/>
                        <circle cx="55" cy="62" r="3" fill="#0e7490"/>
                        <circle cx="65" cy="62" r="3" fill="#0e7490"/>
                        <path d="M52 72 Q60 76 68 72" stroke="#0e7490" stroke-width="2" stroke-linecap="round" fill="none"/>
                    </svg>
                    <h3>${I18N.calm}</h3>
                    <p>${I18N.no_notif}</p>
                </div>`;
            return;
        }
        list.innerHTML = items.map(n => `
            <div class="notif-item ${n.lu == 0 ? 'unread' : ''}">
                <h4><span class="notif-icon-tag ${escapeHtml(n.type)}"></span>${escapeHtml(n.titre)}</h4>
                <p>${escapeHtml(n.contenu)}</p>
                <time>${formatDate(n.date_creation)}</time>
            </div>`).join("");
    }

    function escapeHtml(s){
        if (s == null) return '';
        const d = document.createElement("div");
        d.textContent = s;
        return d.innerHTML;
    }

    function poll() {
        fetch(`${base}/api/parent/notifications.php?since=${lastId}`, { credentials: "same-origin" })
            .then(r => r.ok ? r.json() : null)
            .then(d => {
                if (!d || !d.ok) return;
                if (d.nouvelles && d.nouvelles.length) {
                    d.nouvelles.forEach(n => {
                        if (lastId !== 0) showBrowserNotif(n);
                        allItems.unshift(n);
                    });
                    lastId = d.max_id;
                    renderList(allItems);
                }
                const badge = document.getElementById("notifBadge");
                if (d.non_lues > 0) { badge.textContent = d.non_lues; badge.style.display = "grid"; }
                else badge.style.display = "none";
            })
            .catch(() => {});
    }

    function schedulePoll() {
        if (pollTimer) clearTimeout(pollTimer);
        pollTimer = setTimeout(() => { poll(); schedulePoll(); }, pollInterval);
    }

    // Adapter la fréquence selon la visibilité de l'onglet (Page Visibility API)
    document.addEventListener('visibilitychange', () => {
        pollInterval = document.hidden ? 60000 : 15000;
        schedulePoll();
        if (!document.hidden) poll();      // refresh immédiat au retour
    });

    window.toggleNotif = function () {
        const p = document.getElementById("notifPanel");
        const o = document.getElementById("notifOverlay");
        const isOpen = p.classList.toggle("open");
        o.classList.toggle("open", isOpen);
        p.setAttribute('aria-hidden', !isOpen);
        if (isOpen) askPermission();
    };

    window.marquerToutLu = function () {
        const fd = new FormData();
        fd.append("action", "lu");
        fd.append("csrf_token", csrf);
        fetch(`${base}/api/parent/notifications.php`, { method: "POST", body: fd, credentials: "same-origin" })
            .then(() => {
                document.getElementById("notifBadge").style.display = "none";
                allItems = allItems.map(n => ({ ...n, lu: 1 }));
                renderList(allItems);
            });
    };

    // Premier chargement (historique, pas de popup)
    fetch(`${base}/api/parent/notifications.php?since=0`, { credentials: "same-origin" })
        .then(r => r.ok ? r.json() : null)
        .then(d => {
            if (d && d.ok && d.nouvelles) {
                allItems = d.nouvelles.slice().reverse();
                lastId = d.max_id;
                renderList(allItems);
            }
        });

    schedulePoll();

    // Lightbox global pour images d'exercices
    window.openLightbox = function(src) {
        let lb = document.getElementById('lightbox');
        if (!lb) {
            lb = document.createElement('div');
            lb.id = 'lightbox';
            lb.className = 'lightbox';
            lb.innerHTML = '<button class="lightbox-close" onclick="closeLightbox()" aria-label="Fermer"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button><img id="lightbox-img" alt="">';
            lb.addEventListener('click', e => { if (e.target === lb) closeLightbox(); });
            document.body.appendChild(lb);
        }
        document.getElementById('lightbox-img').src = src;
        lb.classList.add('open');
    };
    window.closeLightbox = function(){ document.getElementById('lightbox')?.classList.remove('open'); };
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });
})();
</script>
</body>
</html>
