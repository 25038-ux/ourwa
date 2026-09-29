# Héberger une école — les options, prix et performance (septembre 2026)

Ce que la plateforme demande (docs/RUNNING.md § 2) : **Node 20+, Postgres 16,
un disque pour les pièces jointes, 1 Go de RAM confortable**, et un domaine.
Rien d'autre — ni Redis, ni file externe (ADR-0017). Pour une école de
Nouakchott, ce qui décide est la **latence** : l'Europe de l'Ouest est à
40–80 ms, l'Amérique du Nord à 120 ms et plus, et chaque page est rendue côté
serveur — la différence se sent à chaque clic.

Prix relevés le 22/09/2026 sur les pages publiques des hébergeurs (hors taxes,
paiement mensuel ; les prix annuels sont un peu plus bas). ⚠ Hetzner et OVH
ont augmenté leurs tarifs en 2026 et renommé leurs gammes : vérifier la page
au moment de commander.

| Option | Prix / mois | Machine | Où | Pour qui |
|---|---|---|---|---|
| **Hetzner Cloud CX22 → CX23** | **≈ 3,79 € → ~4,5 €** | 2 vCPU · 4 Go · 40 Go NVMe · 20 To | Falkenstein / Nuremberg (DE), Helsinki | **Le meilleur rapport prix/performance.** Une école entière tient sur CX22 ; CX32/CX33 (4 vCPU · 8 Go, ≈ 6,80 €) laisse de la marge pour les bulletins de fin d'année. Sauvegardes automatiques +20 %. |
| **OVHcloud VPS-1** | ≈ 4,54 $ (≈ 4,2 €) | 2 vCPU · 4 Go · 40 Go NVMe · trafic illimité | Gravelines / Strasbourg (FR) | Le plus proche (Paris ≈ 40 ms de Nouakchott), sauvegarde quotidienne incluse, anti-DDoS. VPS-2 (4 vCPU · 8 Go) ≈ 8,50 $. |
| **Contabo Cloud VPS** | ≈ 4,50–5,50 € | 4 vCPU · 8 Go · 100–300 Go | Allemagne, France | Le plus de RAM par euro ; support et performance disque plus inégaux. Bon pour une démo durable, moins pour l'école réelle. |
| **DigitalOcean Droplet** | 4 $ (1 Go) · 12 $ (2 Go) · 24 $ (4 Go) | partagé | Amsterdam / Francfort | Plus cher à machine égale ; interface et documentation excellentes ; Postgres géré à partir de 15 $. |
| **Render** (l'actuel, gratuit) | 0 $ ; **Starter 7 $ + Postgres Basic 6 $ = 13 $** pour ne plus s'endormir | 0,5 vCPU · 512 Mo | Francfort | Zéro administration, déploiement à chaque `git push`. Mais 512 Mo et le sommeil après 15 minutes (gratuit) : une démonstration, pas une école. |
| **Oracle Cloud Always Free** | 0 € | jusqu'à 4 OCPU ARM · 24 Go | Marseille / Francfort | Imbattable sur le papier ; l'ouverture du compte a été **refusée** au propriétaire (17/09) et le reste souvent. À retenter, pas à attendre. |
| Neon (Postgres géré) | 0 $ (0,5 Go) · 19 $ | — | Francfort | La base seule ; s'endort après 5 minutes en gratuit. Convient au démo Render, pas à une école (réveil, 0,5 Go). |

## Recommandation

**Une école réelle : un VPS européen à ~5 €/mois — Hetzner CX22/CX23 ou OVH
VPS-1 — avec `deploy/elmourad/install.sh`.** Tout tient dans une commande :
Docker, Postgres 16, l'API, le site, Caddy et les certificats HTTPS ; l'école
est installée sur une base neuve, sans donnée de démonstration. Compter
**+ 1 €/mois** pour les sauvegardes automatiques de l'hébergeur et **~10 €/an**
pour le domaine (`.mr` chez un registrar mauritanien, ou `.com`/`.net`).

Performance attendue sur CX22 pour ~2 000 élèves et 1 400 familles : pages du
personnel en 100–300 ms hors réseau, l'application des familles en un
aller-retour ; les bulletins d'une classe entière en quelques secondes. Le
plafond de requêtes de l'API (300/min par adresse anonyme, 600/min par
personne connectée) est très au-dessus de l'usage d'une école.

**Une démonstration : Render gratuit** (ce qui tourne aujourd'hui pour El
Ourwa), en acceptant le réveil d'une minute — ou 13 $/mois pour l'éviter.

## Ce qu'il faut préparer, quel que soit l'hébergeur

1. Un **domaine** avec trois enregistrements A vers le serveur : `@`, `www`, `api`.
2. Un **SMTP** (réinitialisations de mot de passe) : sans lui rien ne part.
3. Un **projet Firebase** pour les notifications poussées (facultatif : sans
   lui l'application interroge le serveur toutes les quinze minutes).
4. **`scripts/backup.sh` planifié** (base + pièces jointes) et un essai de
   restauration — une sauvegarde jamais restaurée est une hypothèse.
5. La **clé JWT** (`JWT_PRIVATE_KEY`) gardée hors du serveur : la régénérer
   déconnecte tout le monde d'un coup.

Sources consultées le 22/09/2026 : hetzner.com/cloud, docs.hetzner.com
(ajustement de prix du 15/06/2026), ovhcloud.com/vps, digitalocean.com/pricing,
render.com/pricing, contabo.com/vps, neon.tech/pricing.


## Mise à jour du 23/09 — OVH a annulé la commande

OVHcloud a demandé des justificatifs et annulé la commande du propriétaire
(vérification anti-fraude sur une carte mauritanienne, cas fréquent chez OVH
et Hetzner pour un premier client hors Europe). Recommandation révisée, pour
**600 usagers au plus** — 2 Go de RAM au minimum (Docker, Postgres, l'API et
le site tiennent ensemble dans ~1,2 Go) :

| Option | Prix / mois | Machine | Où | Pourquoi |
|---|---|---|---|---|
| **Hostinger KVM 1** (hostinger.com/vps-hosting) | **≈ 5–6,5 $** (promo 12–24 mois ; ≈ 12 $ au renouvellement) | 1 vCPU AMD EPYC · 4 Go · 50 Go NVMe · 1 Gbit/s | France, Pays-Bas, Allemagne | **Le choix.** Inscription simple (e-mail + carte ou PayPal), sans justificatif, très utilisé en Afrique ; 4 Go pour le prix d'un 1 Go ailleurs. KVM 2 (2 vCPU · 8 Go, ≈ 9 $) pour de la marge. |
| **DigitalOcean** Basic 2 Go | 12 $ | 1 vCPU · 2 Go · 50 Go SSD | Amsterdam, Francfort | La plus sûre à l'inscription et la plus documentée ; plus chère à machine égale. |
| **Vultr** Regular 2 Go | 12 $ | 1 vCPU · 2 Go · 55 Go | Paris, Francfort | Équivalent DigitalOcean ; ses offres à 1 Go sont trop justes. |
| Hetzner CX22/CX23 | ≈ 4–5 € | 2 vCPU · 4 Go | Allemagne | Le meilleur prix, mais même vérification d'identité qu'OVH : à ne tenter qu'en second. |

Sources consultées le 23/09/2026 : hostinger.com/vps-hosting, vultr.com/products/cloud-compute,
digitalocean.com/pricing/droplets. Les promotions Hostinger exigent un engagement
de 12 ou 24 mois ; le prix affiché est celui de la première période.

L'installation est la même quel que soit l'hébergeur : Ubuntu 24.04, les trois
enregistrements DNS, `deploy/elmourad/install.sh`.
