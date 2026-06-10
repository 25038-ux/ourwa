<?php
/**
 * Module de traduction FR ↔ AR pour l'espace parent.
 *
 * Détection langue :
 *   1) ?lang=fr|ar dans l'URL (persiste en cookie + session)
 *   2) Cookie EDUPLAT_LANG
 *   3) parents.langue (si connecté)
 *   4) défaut 'fr'
 *
 * Usage : t('cle')  ou  t('cle', ['nom' => $valeur])
 */

if (!defined('I18N_LOADED')) {
    define('I18N_LOADED', true);

    // ---------- Détection de la langue ----------
    if (!function_exists('langue_courante')) {
        function langue_courante(): string {
            // 1. paramètre URL
            if (isset($_GET['lang']) && in_array($_GET['lang'], ['fr','ar'], true)) {
                $lg = $_GET['lang'];
                setcookie('EDUPLAT_LANG', $lg, [
                    'expires'  => time() + 86400 * 365,
                    'path'     => '/',
                    'samesite' => 'Lax',
                    'secure'   => !empty($_SERVER['HTTPS']),
                    'httponly' => false,
                ]);
                $_SESSION['langue'] = $lg;
                // Mise à jour DB si parent connecté
                if (!empty($_SESSION['parent_id'])) {
                    try {
                        getDB()->prepare('UPDATE parents SET langue = :l WHERE id = :id')
                              ->execute([':l' => $lg, ':id' => (int) $_SESSION['parent_id']]);
                    } catch (Throwable $e) { /* silencieux */ }
                }
                return $lg;
            }
            // 2. session
            if (!empty($_SESSION['langue']) && in_array($_SESSION['langue'], ['fr','ar'], true)) {
                return $_SESSION['langue'];
            }
            // 3. cookie
            if (!empty($_COOKIE['EDUPLAT_LANG']) && in_array($_COOKIE['EDUPLAT_LANG'], ['fr','ar'], true)) {
                $_SESSION['langue'] = $_COOKIE['EDUPLAT_LANG'];
                return $_SESSION['langue'];
            }
            // 4. DB (si parent connecté)
            if (!empty($_SESSION['parent_id'])) {
                try {
                    $st = getDB()->prepare('SELECT langue FROM parents WHERE id = :id');
                    $st->execute([':id' => (int) $_SESSION['parent_id']]);
                    $lg = $st->fetchColumn();
                    if (in_array($lg, ['fr','ar'], true)) {
                        $_SESSION['langue'] = $lg;
                        return $lg;
                    }
                } catch (Throwable $e) { /* silencieux */ }
            }
            return 'fr';
        }
    }

    if (!function_exists('est_rtl')) {
        function est_rtl(): bool {
            return langue_courante() === 'ar';
        }
    }

    // ---------- Dictionnaire ----------
    $GLOBALS['_I18N'] = [
        // Communs
        'app_nom'           => ['fr' => 'El OURWA', 'ar' => 'العروة'],
        'bienvenue'         => ['fr' => 'Bienvenue',   'ar' => 'مرحبا'],
        'accueil'           => ['fr' => 'Accueil',     'ar' => 'الرئيسية'],
        'absences'          => ['fr' => 'Absences',    'ar' => 'الغيابات'],
        'resultats'         => ['fr' => 'Résultats',   'ar' => 'النتائج'],
        'remarques'         => ['fr' => 'Remarques',   'ar' => 'الملاحظات'],
        'exercices'         => ['fr' => 'Exercices',   'ar' => 'التمارين'],
        'messages'          => ['fr' => 'Messages',    'ar' => 'الرسائل'],
        'profil'            => ['fr' => 'Profil',      'ar' => 'الملف'],
        'plus'              => ['fr' => 'Plus',        'ar' => 'المزيد'],
        'deconnexion'       => ['fr' => 'Déconnexion', 'ar' => 'تسجيل الخروج'],
        'connexion'         => ['fr' => 'Connexion',   'ar' => 'تسجيل الدخول'],
        'se_connecter'      => ['fr' => 'Se connecter','ar' => 'دخول'],
        'identifiant'       => ['fr' => 'Téléphone',   'ar' => 'الهاتف'],
        'mot_de_passe'      => ['fr' => 'Mot de passe','ar' => 'كلمة المرور'],
        'envoyer'           => ['fr' => 'Envoyer',     'ar' => 'إرسال'],
        'annuler'           => ['fr' => 'Annuler',     'ar' => 'إلغاء'],
        'fermer'            => ['fr' => 'Fermer',      'ar' => 'إغلاق'],
        'enregistrer'       => ['fr' => 'Enregistrer', 'ar' => 'حفظ'],
        'modifier'          => ['fr' => 'Modifier',    'ar' => 'تعديل'],
        'voir'              => ['fr' => 'Voir',        'ar' => 'عرض'],
        'voir_details'      => ['fr' => 'Voir détails','ar' => 'عرض التفاصيل'],
        'aucun_resultat'    => ['fr' => 'Aucun résultat','ar' => 'لا توجد نتائج'],
        'chargement'        => ['fr' => 'Chargement…','ar' => 'جار التحميل…'],
        'oui'               => ['fr' => 'Oui',          'ar' => 'نعم'],
        'non'               => ['fr' => 'Non',          'ar' => 'لا'],

        // Connexion
        'titre_connexion_parent' => ['fr' => 'Espace correspondant', 'ar' => 'فضاء ولي الأمر'],
        'sous_titre_connexion'   => ['fr' => 'Connectez-vous pour suivre votre enfant', 'ar' => 'سجّل الدخول لمتابعة أبنائك'],
        'erreur_identifiants'    => ['fr' => 'Identifiants incorrects.', 'ar' => 'بيانات الاعتماد غير صحيحة.'],
        'mdp_oublie'             => ['fr' => 'Mot de passe oublié ?',  'ar' => 'نسيت كلمة المرور؟'],
        'tout_correspondant_doit_changer' => ['fr' => 'Vous devez changer votre mot de passe avant de continuer.', 'ar' => 'يجب تغيير كلمة المرور قبل المتابعة.'],

        // Page de connexion — bloc de gauche (hero)
        'hero_titre_l1'   => ['fr' => 'Suivez la scolarité',           'ar' => 'تابع مسار طفلك المدرسي'],
        'hero_titre_l2'   => ['fr' => 'de votre enfant en temps réel.','ar' => 'في الوقت الفعلي.'],
        'hero_lede'       => ['fr' => 'Notes, absences, exercices, messages des enseignants — tout au même endroit, immédiatement.',
                              'ar' => 'النقاط، الغيابات، التمارين، رسائل الأساتذة — كل شيء في مكان واحد، فوراً.'],
        'feat_notif'      => ['fr' => 'Notifications instantanées dans votre navigateur',
                              'ar' => 'إشعارات فورية في متصفحك'],
        'feat_classe'     => ['fr' => 'Toute la classe de votre enfant, accessible en un clic',
                              'ar' => 'كل تفاصيل صف ابنك بنقرة واحدة'],
        'feat_secu'       => ['fr' => 'Connexion sécurisée par téléphone & mot de passe',
                              'ar' => 'تسجيل دخول آمن بالهاتف وكلمة المرور'],
        'footer_copyright'=> ['fr' => '© 2026 El OURWA — Tous droits réservés.',
                              'ar' => '© 2026 العروة — جميع الحقوق محفوظة.'],
        'bonjour'         => ['fr' => 'Bonjour',           'ar' => 'مرحباً'],
        'connectez_vous'  => ['fr' => 'Connectez-vous avec le numéro de téléphone communiqué par l\'école.',
                              'ar' => 'سجّل الدخول برقم الهاتف الذي قدّمته المدرسة.'],
        'acces_admin'     => ['fr' => 'Accès personnel & administration',
                              'ar' => 'دخول الموظفين والإدارة'],

        // Tableau de bord
        'mes_enfants'       => ['fr' => 'Mes enfants',          'ar' => 'أبنائي'],
        'mon_enfant'        => ['fr' => 'Mon enfant',           'ar' => 'ابني'],
        'classe'            => ['fr' => 'Classe',               'ar' => 'الصف'],
        'niveau'            => ['fr' => 'Niveau',               'ar' => 'المستوى'],
        'groupe'            => ['fr' => 'Groupe',               'ar' => 'المجموعة'],
        'matieres'          => ['fr' => 'Matières',             'ar' => 'المواد'],
        'matiere'           => ['fr' => 'Matière',              'ar' => 'المادة'],
        'professeur'        => ['fr' => 'Professeur',           'ar' => 'الأستاذ'],
        'note'              => ['fr' => 'Note',                 'ar' => 'النقطة'],
        'moyenne'           => ['fr' => 'Moyenne',              'ar' => 'المعدل'],
        'trimestre'         => ['fr' => 'Trimestre',            'ar' => 'الفصل'],
        'annee_scolaire'    => ['fr' => 'Année scolaire',       'ar' => 'السنة الدراسية'],
        'bulletin'          => ['fr' => 'Bulletin',             'ar' => 'كشف النقاط'],
        'voir_bulletin'     => ['fr' => 'Voir le bulletin',     'ar' => 'عرض كشف النقاط'],
        'emploi_du_temps'   => ['fr' => 'Emploi du temps',      'ar' => 'جدول الحصص'],
        'mon_emploi_temps'  => ['fr' => 'Mon emploi du temps',  'ar' => 'جدولي الزمني'],
        'totalabsences'     => ['fr' => 'Total absences',       'ar' => 'مجموع الغيابات'],
        'date'              => ['fr' => 'Date',                 'ar' => 'التاريخ'],
        'motif'             => ['fr' => 'Motif',                'ar' => 'السبب'],
        'lundi'             => ['fr' => 'Lundi',     'ar' => 'الإثنين'],
        'mardi'             => ['fr' => 'Mardi',     'ar' => 'الثلاثاء'],
        'mercredi'          => ['fr' => 'Mercredi',  'ar' => 'الأربعاء'],
        'jeudi'             => ['fr' => 'Jeudi',     'ar' => 'الخميس'],
        'vendredi'          => ['fr' => 'Vendredi',  'ar' => 'الجمعة'],
        'samedi'            => ['fr' => 'Samedi',    'ar' => 'السبت'],

        // Notifications & messages
        'notifications'     => ['fr' => 'Notifications',         'ar' => 'الإشعارات'],
        'aucune_notif'      => ['fr' => 'Aucune notification.',  'ar' => 'لا توجد إشعارات.'],
        'tout_marquer_lu'   => ['fr' => 'Tout marquer comme lu', 'ar' => 'تحديد الكل كمقروء'],
        'nouvelle_notif'    => ['fr' => 'Nouvelle notification', 'ar' => 'إشعار جديد'],
        'nouveau_message'   => ['fr' => 'Nouveau message',       'ar' => 'رسالة جديدة'],
        'expediteur'        => ['fr' => 'Expéditeur',            'ar' => 'المُرسِل'],
        'sujet'             => ['fr' => 'Sujet',                 'ar' => 'الموضوع'],
        'aucun_message'     => ['fr' => 'Aucun message.',        'ar' => 'لا توجد رسائل.'],

        // Profil enfant
        'fiche_enfant'      => ['fr' => 'Fiche de l\'enfant',    'ar' => 'بطاقة الابن'],
        'matricule'         => ['fr' => 'Matricule',             'ar' => 'الرقم التعريفي'],
        'frais_mensuel'     => ['fr' => 'Frais mensuels',        'ar' => 'المصاريف الشهرية'],
        'historique_absences' => ['fr' => 'Historique des absences', 'ar' => 'سجل الغيابات'],
        'liste_remarques'   => ['fr' => 'Remarques des professeurs', 'ar' => 'ملاحظات الأساتذة'],
        'aucune_remarque'   => ['fr' => 'Aucune remarque.',      'ar' => 'لا توجد ملاحظات.'],
        'aucune_absence'    => ['fr' => 'Aucune absence enregistrée.', 'ar' => 'لا توجد غيابات مسجلة.'],
        'choisir_trimestre' => ['fr' => 'Choisir le trimestre',  'ar' => 'اختر الفصل'],
        'tous_trimestres'   => ['fr' => 'Tous les trimestres',   'ar' => 'كل الفصول'],
        'trimestre_1'       => ['fr' => 'Trimestre 1',           'ar' => 'الفصل الأول'],
        'trimestre_2'       => ['fr' => 'Trimestre 2',           'ar' => 'الفصل الثاني'],
        'trimestre_3'       => ['fr' => 'Trimestre 3',           'ar' => 'الفصل الثالث'],

        // Changer mot de passe
        'changer_mdp'       => ['fr' => 'Changer mon mot de passe', 'ar' => 'تغيير كلمة المرور'],
        'mdp_actuel'        => ['fr' => 'Mot de passe actuel',      'ar' => 'كلمة المرور الحالية'],
        'nouveau_mdp'       => ['fr' => 'Nouveau mot de passe',     'ar' => 'كلمة المرور الجديدة'],
        'confirmer_mdp'     => ['fr' => 'Confirmer le mot de passe','ar' => 'تأكيد كلمة المرور'],

        // Langue
        'langue'            => ['fr' => 'Langue', 'ar' => 'اللغة'],
        'francais'          => ['fr' => 'Français', 'ar' => 'الفرنسية'],
        'arabe'             => ['fr' => 'العربية', 'ar' => 'العربية'],

        // Erreurs
        'erreur_generique'  => ['fr' => 'Une erreur est survenue.', 'ar' => 'حدث خطأ.'],
        'champs_requis'     => ['fr' => 'Veuillez remplir tous les champs requis.', 'ar' => 'يرجى ملء جميع الحقول المطلوبة.'],

        // Tableau de bord
        'apercu_enfants'    => ['fr' => 'Voici un aperçu de la scolarité de vos enfants.', 'ar' => 'إليك نظرة على المسار الدراسي لأبنائك.'],
        'apercu_enfant'     => ['fr' => 'Voici un aperçu de la scolarité de votre enfant.', 'ar' => 'إليك نظرة على المسار الدراسي لابنك.'],
        'aucun_enfant'      => ['fr' => 'Aucun enfant rattaché',                            'ar' => 'لا يوجد ابن مرتبط بحسابك'],
        'contactez_etablissement' => ['fr' => 'Contactez l\'établissement pour qu\'un étudiant soit associé à votre compte.', 'ar' => 'يرجى الاتصال بالمدرسة لربط ابنك بحسابك.'],

        // Notes / résultats
        'mes_notes'         => ['fr' => 'Mes notes',           'ar' => 'نقاطي'],
        'aucune_note'       => ['fr' => 'Aucune note pour le moment.', 'ar' => 'لا توجد نقاط حالياً.'],
        'type_note'         => ['fr' => 'Type',                'ar' => 'النوع'],
        'devoir'            => ['fr' => 'Devoir',              'ar' => 'فرض'],
        'controle'          => ['fr' => 'Contrôle',            'ar' => 'اختبار'],
        'examen'            => ['fr' => 'Examen',              'ar' => 'امتحان'],

        // Exercices
        'mes_exercices'     => ['fr' => 'Mes exercices',       'ar' => 'تماريني'],
        'aucun_exercice'    => ['fr' => 'Aucun exercice pour le moment.', 'ar' => 'لا توجد تمارين حالياً.'],
        'a_rendre'          => ['fr' => 'À rendre',            'ar' => 'تسليم قبل'],
        'consigne'          => ['fr' => 'Consigne',            'ar' => 'التعليمات'],
        'piece_jointe'      => ['fr' => 'Pièce jointe',        'ar' => 'الملف المرفق'],
        'telecharger'       => ['fr' => 'Télécharger',         'ar' => 'تحميل'],

        // Messages
        'mes_messages'      => ['fr' => 'Mes messages',        'ar' => 'رسائلي'],
        'de_la_part_de'     => ['fr' => 'De la part de',       'ar' => 'من'],
        'lu'                => ['fr' => 'Lu',                  'ar' => 'مقروء'],
        'non_lu'            => ['fr' => 'Non lu',              'ar' => 'غير مقروء'],

        // Changer mdp obligatoire
        'changement_obligatoire' => ['fr' => 'Vous devez changer votre mot de passe avant de continuer.', 'ar' => 'يجب عليك تغيير كلمة المرور قبل المتابعة.'],
        'mdp_change_succes' => ['fr' => 'Mot de passe modifié avec succès.', 'ar' => 'تم تغيير كلمة المرور بنجاح.'],

        // Bottom nav
        'notes_short'       => ['fr' => 'Notes',  'ar' => 'النقاط'],
        'exos_short'        => ['fr' => 'Exos',   'ar' => 'التمارين'],
    ];

    if (!function_exists('t')) {
        function t(string $cle, array $vars = []): string {
            $lg = langue_courante();
            $dict = $GLOBALS['_I18N'] ?? [];
            $txt  = $dict[$cle][$lg] ?? $dict[$cle]['fr'] ?? $cle;
            if ($vars) {
                foreach ($vars as $k => $v) {
                    $txt = str_replace('{' . $k . '}', (string) $v, $txt);
                }
            }
            return $txt;
        }
    }
}
