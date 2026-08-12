# Sentinelle Pro — V5.7.5

## Brouillon et publication du planning mensuel

Cette version ajoute un cycle de préparation mensuelle sans notifications successives.

### Fonctionnement

- Une mission ponctuelle créée en mode normal conserve le fonctionnement existant : l’agent est notifié immédiatement.
- Le QG peut sélectionner un mois puis cliquer sur **Préparer ce mois en brouillon**.
- Les vacations du mois passent en brouillon, deviennent invisibles côté agent et ne génèrent aucune notification pendant la préparation.
- Le QG peut créer, modifier, déplacer, dupliquer ou annuler les vacations du brouillon.
- Le bouton **Valider et publier le mois** rend les missions visibles et envoie une seule notification mensuelle à chaque agent concerné.
- Après publication, toute modification ultérieure reste immédiate et notifie uniquement l’agent concerné.

## Fichiers à remplacer

- `app.js`
- `style.css`
- `index.html`
- `service-worker.js`
- `firestore.rules`

Après le déploiement des fichiers, publier également les nouvelles règles Firestore.

### Prise de connaissance

- L’agent reçoit un bouton **J’ai pris connaissance du planning** pour le mois publié.
- Cette action confirme toutes les missions mensuelles en une fois.
- Le QG peut consulter le nombre et le détail des confirmations agent par agent.
- Une modification après publication invalide automatiquement l’ancienne confirmation pour l’agent concerné.
