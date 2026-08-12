# Tests V5.8.2 — Planning compact QG

## Contrôles techniques réalisés

- `node --check app.js`
- `node --check service-worker.js`
- vérification des chemins du cache PWA V5.8.2 ;
- comparaison avec la V5.8.1 : seuls `app.js`, `style.css`, `index.html` et `service-worker.js` changent pour cette évolution ;
- aucune écriture Firestore ajoutée par le nouvel affichage ;
- conservation de l’ouverture des missions et de la création rapide.

## Recette à réaliser sur le projet réel

1. Ouvrir QG > Missions > Planning exploitation.
2. Sélectionner la vue Sites.
3. Vérifier qu’une case colorée ne déborde jamais de sa colonne.
4. Vérifier que le nombre affiché correspond aux agents distincts de la journée.
5. Survoler la case sur ordinateur et contrôler noms, horaires, types et statuts.
6. Cliquer une journée contenant une mission : la fiche mission doit s’ouvrir.
7. Cliquer une journée contenant plusieurs missions : le récapitulatif doit s’ouvrir.
8. Depuis ce récapitulatif, ouvrir chaque mission.
9. Cliquer une journée vide : la création rapide doit s’ouvrir avec le bon site et la bonne date.
10. Tester les affichages 7 jours, 14 jours et Mois.
11. Tester les filtres statut et recherche.
12. Vérifier que la vue Collaborateurs reste inchangée.
13. Vérifier sur mobile que le clic remplace correctement le survol.
14. Contrôler qu’aucune mission, publication ou confirmation n’a changé dans Firebase.
