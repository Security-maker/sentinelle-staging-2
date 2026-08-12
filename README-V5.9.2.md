# Sentinelle Pro V5.9.2

Correctifs post-bascule Supabase :

- ajout « Mot de passe oublié ? » sur le portail principal Admin / QG / Agent ;
- parcours Supabase Auth de réinitialisation avec choix du nouveau mot de passe ;
- ajout dans QG > Documents du bouton « Réparer PDF historiques » ;
- régénération des PDF MCI et rapports de mission historiques depuis les payloads Supabase ;
- archivage des PDF régénérés dans le bucket privé `main-courantes` ;
- amélioration de l’intégration des photos historiques depuis `report-photos` ;
- cache PWA V5.9.2.

L’envoi automatique e-mail reste volontairement désactivé (`autoEmail: false`) jusqu’à validation du rattrapage PDF.

## Après déploiement

1. QG > Documents > Réparer PDF historiques.
2. Attendre le message de fin (objectif attendu actuellement : 117/117).
3. Tester un ancien MCI depuis `client.html`.
4. Tester « Mot de passe oublié ? » sur `index.html`.
