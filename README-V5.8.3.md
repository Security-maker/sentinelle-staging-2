# Sentinelle Pro V5.8.3 — Correctif planning QG

Cette version reprend intégralement la V5.8.2 et corrige uniquement l’affichage du planning QG.

## Corrections

1. Les cases colorées indiquant le nombre d’agents restent strictement dans la colonne du jour correspondant.
2. Les cases vides de création et les cases colorées utilisent exactement la même grille.
3. Lorsque le QG sélectionne « Mois », la période commence automatiquement au 1er jour du mois en cours.

## Sécurité

- Aucune donnée Firebase n’est supprimée ou modifiée par ce correctif.
- Aucune règle Firestore ni fonction Worker n’est modifiée.
- Les missions, horaires, agents, confirmations et PDF restent inchangés.
- Supabase reste désactivé comme dans la V5.8.2.

## Installation depuis la V5.8.2

Remplacer uniquement sur GitHub :

- `app.js`
- `style.css`
- `index.html`
- `service-worker.js`

Puis attendre le redéploiement et fermer/réouvrir uniquement l’espace QG après la fin du déploiement.
