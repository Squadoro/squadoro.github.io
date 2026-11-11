# Squadoro

Squadoro aide les joueurs d'EA SPORTS FC 27 Ultimate Team à :

- compléter un maximum de DCE avec les cartes de leur club, sans toucher à leur équipe active ;
- trouver leur meilleure équipe (note d'abord, avec un collectif suffisant) ;
- suivre les DCE du moment et les prix du marché, mis à jour chaque soir.

Site : https://squadoro.github.io

## Contenu du dépôt

| Fichier | Rôle |
| --- | --- |
| `index.html` | L'application (tout est dans ce fichier). |
| `catalog.json` | Les DCE du moment, mis à jour chaque soir. |
| `market.json` | Les prix planchers par note, mis à jour chaque soir. |
| `privacy.html` | Politique de confidentialité. |
| `manifest.webmanifest`, `sw.js`, icônes | Installation sur l'écran d'accueil et fonctionnement hors ligne. |
| `serveur/worker.js` | Le serveur (Cloudflare Worker) : lecture des captures, limites par jour et base commune des cartes. |

Les données des joueurs (club, DCE, réglages) restent sur leur appareil. Seules les caractéristiques des cartes ajoutées (joueur, note, version, postes, nation, ligue, club, stats) rejoignent, sans rien d'identifiant, une base commune qui permet de retrouver une carte en tapant son nom. Ce partage se coupe dans les réglages.

Squadoro est un outil indépendant créé par des fans. Il n'est pas affilié à Electronic Arts ni à EA SPORTS FC.

## Base des joueurs FC 27

`players-fc27.json` : les 19 789 joueurs d'EA SPORTS FC 27 (cartes de base : note, postes, nation, ligue, club, stats, PlayStyles, pied faible, gestes techniques), d'après les notes publiques d'EA au lancement (instantané du 12/09/2026) rassemblées par le projet [EA_FC_ANALYSIS](https://github.com/lakshmikanth11/EA_FC_ANALYSIS). Nations et grandes ligues renommées en français comme dans l'appli.

Mise à jour automatique : chaque soir, la tâche de publication compare le dernier commit du dépôt source à `outils/base-source.json` ; s'il a changé, elle reconstruit `players-fc27.json` avec `outils/build_base.py` et le publie. Entre deux mises à jour de la source, les notes et les clubs peuvent avoir changé dans le jeu (mises à jour d'EA, transferts).

## Cartes spéciales FC 27

`specials-fc27.json` : les cartes spéciales (TOTW, promos, ICÔNES, Héros…) relevées chaque soir par la tâche de publication à partir des annonces publiques, gardées sans limite de durée, avec un rattrapage progressif des équipes déjà sorties (champ `backfill`). L'appli s'en sert pour la recherche et pour reconnaître les cartes spéciales sur les captures.

## Polices

Barlow et Barlow Condensed (The Barlow Project Authors), sous licence SIL Open Font License 1.1 : voir `fonts/OFL-Barlow.txt`.

## Guides des DCE (pages de texte)

Le dossier `guides/`, la page `a-propos.html`, `sitemap.xml` et `robots.txt` sont générés par `outils/guides/build_guides.py` à partir des textes de `outils/guides/articles.py` et `outils/guides/extras.py` :

```
python3 -I outils/guides/build_guides.py .
```

Les annonces Google AdSense ne sont affichées que sur ces pages de texte, jamais sur les écrans de l'appli (la configuration `ads.inApp` de `config.json` n'est pas activée).
