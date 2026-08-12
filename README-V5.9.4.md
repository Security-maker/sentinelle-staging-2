# Sentinelle Pro V5.9.4 — Client Premium PWA

Cette version modernise uniquement l'expérience client et ne modifie pas les interfaces Agent / QG.

## Nouveautés
- Refonte complète de `client.html` : interface B2B premium, claire, responsive et plus institutionnelle.
- Palette client basée sur le bleu Azzera Protect avec marine profond et surfaces claires.
- Nouveau tableau de bord client : hiérarchie visuelle renforcée, métriques, sites, dernier document et bibliothèque PDF modernisée.
- États, filtres, boutons et messages modernisés ; remplacement de l'alerte navigateur par un toast côté client.
- PWA client dédiée : `manifest-client.json`, ouverture directe sur `client.html` et icône propre pour l'écran d'accueil.
- Icônes dédiées client : 180, 192 et 512 px.
- Enregistrement du Service Worker depuis le portail client ; cache V5.9.4 mis à jour sans changement de logique Web Push Agent / QG.

## Déploiement
Déposer les fichiers du dossier UPDATE à la racine du dépôt GitHub Pages en conservant les sous-dossiers.

Aucune migration SQL ni modification Edge Function n'est nécessaire pour cette version.
