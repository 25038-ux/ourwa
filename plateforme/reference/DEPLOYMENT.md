# Déploiement — El Ourwa sur ScalaHosting (SPanel + Cloudflare)

Cible : VPS Managed Cloud, 2 vCPU / 4 Go / 50 Go NVMe, Sofia.
Pile : Apache + PHP 8.2 ou 8.3 (OPcache activé) + MariaDB/MySQL, Cloudflare en frontal.
Échelle : ~1 200 élèves, ~700 comptes parents, ~2 000 comptes au total, pointes à 20–30 requêtes/seconde.

> **Ordre à respecter.** La base d'abord, le code ensuite, puis le contrôle de
> sécurité. Le contrôle de sécurité n'est pas une formalité : s'il échoue,
> Apache ne lit pas les `.htaccess` et **la base de l'école est téléchargeable
> par n'importe qui**. Ne mettez pas le site en service avant de l'avoir passé.

---

## 1. La base de données

### Ce que contient le fichier

`INSTALLATION_TOTALE_v13.sql` — 29 Mo, 77 tables, toutes InnoDB / `utf8mb4_unicode_ci`.
Aucune vue, aucun déclencheur, aucune procédure, aucun `DEFINER` : il passe sur
un hébergement mutualisé comme sur un VPS.

> ⚠️ **L'import est destructif.** Le fichier commence par 78 `DROP TABLE IF EXISTS`.
> Il efface et recrée l'intégralité des 77 tables. Ne l'exécutez **que** sur une
> base vide ou sur une base dont vous acceptez de perdre le contenu.
> Sur une base déjà en service, faites une sauvegarde **avant** :
> ```bash
> mysqldump -u UTILISATEUR -p BASE | gzip > sauvegarde-$(date +%F).sql.gz
> ```

Le fichier ne contient ni `CREATE DATABASE` ni `USE` : c'est l'hébergeur qui
impose le nom de la base. **Créez la base d'abord**, depuis SPanel, en
`utf8mb4` / `utf8mb4_unicode_ci`.

### Voie A — SSH (recommandée)

```bash
mysql -u UTILISATEUR -p BASE < INSTALLATION_TOTALE_v13.sql
```

Environ une minute. Aucune sortie n'est bon signe.

### Voie B — phpMyAdmin

29 Mo dépassent la limite d'envoi habituelle (souvent 8 ou 16 Mo). Compressez :

```bash
gzip -k INSTALLATION_TOTALE_v13.sql
```

Vous obtenez ~3,9 Mo. **phpMyAdmin accepte directement le `.sql.gz`** et le
décompresse lui-même — n'essayez pas de le décompresser avant l'envoi.

### Vérification après import — obligatoire

```sql
SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE();
-- attendu : 77

SELECT origine, COUNT(*) FROM paiements GROUP BY origine;
-- attendu : 'elourwa' avec un compte élevé (15 625)

SELECT COUNT(*) AS eleves FROM etudiants;      -- attendu : 2 153
SELECT COUNT(*) AS familles FROM parents;      -- attendu : 1 372
SELECT COUNT(*) AS paiements FROM paiements;   -- attendu : 15 989
SELECT ROUND(SUM(montant)) AS encaisse FROM paiements;  -- attendu : 42 614 000
```

Si `origine` ne renvoie aucune ligne `elourwa`, **arrêtez-vous**. Cette valeur
distingue les écritures créées dans El Ourwa de celles reprises de l'ancien
logiciel. Sans elle, les états de dette et d'arriérés renvoient des chiffres
faux **sans lever la moindre erreur**.

---

## 2. Le code

1. Envoyez `el_ourwa_CODE_v13.zip` via le gestionnaire de fichiers SPanel, puis
   extrayez-le dans la racine web (`public_html` ou le dossier du domaine).

2. **Créez `config/database.local.php`** — l'application ne démarre pas sans lui,
   volontairement : les identifiants ne sont plus inscrits dans le code, sinon
   ils partaient dans chaque archive livrée.

   ```bash
   cp config/database.local.example.php config/database.local.php
   ```

   ```php
   <?php
   define('DB_HOST', 'localhost');
   define('DB_NAME', 'nom_de_la_base');
   define('DB_USER', 'utilisateur');
   define('DB_PASS', 'mot_de_passe');
   define('DB_PORT', 3306);
   define('DB_CHARSET', 'utf8mb4');
   ```

   Si ce fichier manque, l'écran affiche « Configuration de la base absente »
   et la marche à suivre — pas une erreur SQL incompréhensible.

3. **`APP_URL`** : laissez-la absente si le site est servi par un seul domaine —
   l'application déduit son adresse de la requête. Renseignez-la (dans
   `database.local.php`, sans barre oblique finale) seulement si une adresse
   doit être fabriquée hors requête HTTP, par exemple depuis une tâche planifiée.

4. **Droits des dossiers.** L'application crée `logs/`, `sessions/`, `cache/` et
   `uploads/` au démarrage si besoin, avec leur `.htaccess`. Si votre hébergeur
   l'interdit, créez-les à la main :

   ```bash
   mkdir -p logs sessions cache uploads
   chmod 750 logs sessions cache uploads
   chown -R UTILISATEUR:UTILISATEUR .
   ```

   Un dossier non inscriptible **ne casse pas le site** : il dégrade une
   fonction (pas de cache, pas de téléversement) et le note dans le journal.

5. **Ne mettez jamais `INSTALLATION_TOTALE_v13.sql` dans la racine web.**
   Gardez-le hors du site, ou supprimez-le après import.

---

## 3. Contrôle de sécurité — à passer avant l'ouverture

Toute la protection des dossiers sensibles repose sur 8 fichiers `.htaccess`.
Ils ne servent à rien si Apache ne les lit pas (`AllowOverride None`).

Depuis un navigateur, en navigation privée, chaque adresse doit renvoyer
**403 Forbidden** :

| Adresse | Attendu |
|---|---|
| `https://DOMAINE/config/database.php` | 403 |
| `https://DOMAINE/config/database.local.php` | 403 |
| `https://DOMAINE/sql/` | 403 |
| `https://DOMAINE/includes/` | 403 |
| `https://DOMAINE/logs/` | 403 |
| `https://DOMAINE/sessions/` | 403 |
| `https://DOMAINE/cache/` | 403 |

Ou en une commande :

```bash
for p in config/database.php config/database.local.php sql/ includes/ logs/ sessions/ cache/; do printf "%-32s %s\n" "$p" "$(curl -s -o /dev/null -w '%{http_code}' https://DOMAINE/$p)"; done
```

> **Si une seule renvoie 200, une page blanche ou une liste de fichiers :
> arrêtez tout.** Apache ne lit pas les `.htaccess`. Le fichier de session d'un
> administrateur connecté devient téléchargeable — donc sa session, donc son
> accès. Demandez `AllowOverride All` sur le répertoire du site avant d'aller
> plus loin.

Vérifiez aussi que `https://DOMAINE/` sert bien la page de connexion et non un
listage de répertoire.

---

## 4. Cloudflare

L'application sait lire l'adresse réelle du visiteur derrière le proxy — mais
seulement si la requête vient vraiment d'une plage Cloudflare (`includes/reseau.php`).

- **Mode SSL** : réglez sur **Full** ou **Full (strict)**, pas sur *Flexible*.
  L'application gère *Flexible* (elle lit `X-Forwarded-Proto` et `CF-Visitor`
  pour poser l'attribut `Secure` sur le cookie), mais le trajet Cloudflare →
  serveur y reste en clair.
- **Ne mettez pas en cache les pages PHP.** Seuls `/assets/*` doivent l'être ;
  ils portent un numéro de version (`?v=…`) qui change à chaque modification,
  la mise en cache longue est donc sûre.
- Après une mise en ligne, purgez le cache Cloudflare pour `/assets/*`.

**Vérification** : connectez-vous, puis regardez le journal de sécurité. Si les
adresses enregistrées sont des adresses Cloudflare (104.x, 172.6x, 162.15x) et
non celles des visiteurs, la liste des plages dans `includes/reseau.php` a
vieilli — remplacez-la par celle de <https://www.cloudflare.com/ips/>.

> Pourquoi cela compte : le verrouillage anti-force-brute compte les échecs
> **par adresse**. Si toutes les requêtes portent la même adresse, quinze
> échecs suffisent à verrouiller l'école entière, parents compris.

---

## 5. Réglages du serveur (2 vCPU / 4 Go)

**PHP**

```ini
memory_limit = 192M
max_execution_time = 120
upload_max_filesize = 32M
post_max_size = 32M
```

**PHP-FPM**

```ini
pm = dynamic
pm.max_children = 30
pm.start_servers = 6
pm.min_spare_servers = 4
pm.max_spare_servers = 12
```

30 processus × ~40 Mo ≈ 1,2 Go : cela laisse de la place à MySQL sur 4 Go.

**MySQL / MariaDB**

```ini
innodb_buffer_pool_size = 512M
max_allowed_packet = 64M
```

512 Mo couvrent largement les 29 Mo de données : l'ensemble tient en mémoire.

**OPcache** — vérifiez qu'il est actif :

```bash
php -i | grep -E "opcache.enable|opcache.memory_consumption"
```

Ou depuis le web, avec un fichier temporaire contenant `<?php phpinfo();` —
puis **supprimez-le immédiatement**. Il révèle vos chemins, vos extensions et
vos variables d'environnement.

```ini
opcache.enable = 1
opcache.memory_consumption = 128
opcache.max_accelerated_files = 10000
opcache.validate_timestamps = 1
opcache.revalidate_freq = 60
```

`validate_timestamps = 1` évite d'avoir à recharger PHP-FPM après chaque
modification de fichier. Si vous le passez à `0`, **rechargez PHP-FPM à chaque
mise en ligne**, sans quoi vos changements ne prendront pas effet.

---

## 6. Test de charge

Sur la page la plus lourde, l'impression d'une classe entière :

```bash
ab -n 200 -c 20 -C "EDUPLATFORME_SID=VOTRE_COOKIE" "https://DOMAINE/pages/super_admin/bulletins_classe.php?groupe_id=10&trimestre=1&annee_notes=2025"
```

Récupérez le cookie depuis les outils de développement du navigateur, une fois
connecté. Sans cookie valide vous mesurez la page de connexion, pas l'application.

**Lecture des résultats**

| Indicateur | Correct | À surveiller | Passer à 4 vCPU / 8 Go |
|---|---|---|---|
| Requests per second | > 25 | 15 – 25 | < 15 |
| Time per request (mean) | < 400 ms | 400 – 800 ms | > 800 ms |
| Échecs | 0 | 0 | > 0 |
| `load average` (`uptime`) | < 2 | 2 – 4 | > 4 en continu |

Mesurez aussi une page ordinaire (`tableau_bord.php`), plus représentative de
l'usage réel : l'impression de classe est un cas extrême, déclenché quelques
fois par trimestre.

Si les requêtes/seconde s'effondrent alors que le processeur reste bas, le
goulet est ailleurs — regardez `SHOW PROCESSLIST` côté MySQL et le nombre de
processus PHP-FPM occupés.

---

## 7. Après la mise en service

- [ ] **Changez le mot de passe de l'administrateur.** Celui livré a circulé
      dans les archives : considérez-le comme compromis.
- [ ] **Changez le mot de passe de la base** chez l'hébergeur, pour la même raison,
      puis reportez-le dans `config/database.local.php`.
- [ ] Supprimez tout fichier `phpinfo` restant.
- [ ] Mettez en place une sauvegarde quotidienne automatique de la base.
- [ ] Vérifiez que `logs/error.log` grossit — s'il reste vide, PHP n'y écrit pas
      et vous serez aveugle le jour d'un incident.

---

## Annexe — en cas de problème

| Symptôme | Cause probable |
|---|---|
| « Configuration de la base absente » | `config/database.local.php` manquant ou incomplet |
| Page blanche | Regardez `logs/error.log` ; souvent `memory_limit` |
| Styles cassés, page nue | `/assets/` bloqué, ou cache Cloudflare non purgé |
| Déconnexion à chaque page | `sessions/` non inscriptible |
| Tout le monde verrouillé d'un coup | Adresse réelle non lue — voir §4 |
| Dettes à zéro ou aberrantes | Valeur `elourwa` absente — voir §1 |
| Chiffres justes mais lenteur | OPcache inactif — voir §5 |
