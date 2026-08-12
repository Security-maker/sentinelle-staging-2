# Tests V5.8.1

## Contrôles statiques réalisés le 3 août 2026

Tous les contrôles ci-dessous ont réussi :

- syntaxe de `app.js` ;
- syntaxe de `service-worker.js` ;
- syntaxe de `client-app.js` ;
- syntaxe de `supabase-bridge.js` et `supabase-config.js` ;
- syntaxe du Worker Cloudflare OneSignal ;
- syntaxe des trois scripts de migration ;
- présence de tous les fichiers référencés par le cache PWA ;
- actions rapides en bulles ;
- affichage des 3 derniers rapports MCI sur le dashboard ;
- affichage des 3 missions prioritaires ;
- disparition du bouton « Dupliquer +7 jours » ;
- présence de « Dupliquer sur le mois » ;
- répétition hebdomadaire sur le mois cible ;
- création des copies en brouillon mensuel ;
- absence de suppression Firestore lors de l’effacement des notifications ;
- présence des prises de poste dans le centre QG ;
- envoi push QG authentifié par jeton Firebase ;
- clé d’idempotence du Worker pour éviter les doubles notifications ;
- chronologie PDF prise de poste → événements → fin de poste ;
- archivage automatique avec identifiant stable ;
- service worker sans activation forcée lors de l’installation ;
- Supabase désactivé par défaut.

## Tests terrain indispensables avant diffusion générale

1. Publier les règles Firestore dans le projet de test ou de production.
2. Déployer le Worker Cloudflare mis à jour avec `FIREBASE_PROJECT_ID=azzerap-7b440`.
3. Ouvrir un compte QG ayant autorisé les notifications OneSignal.
4. Réaliser une prise de poste avec un compte agent de test.
5. Vérifier l’apparition immédiate dans le centre QG.
6. Vérifier la notification push QG sur écran verrouillé.
7. Cliquer sur « Effacer » et confirmer qu’aucune mission, MCI ou alerte n’a disparu.
8. Créer un nouvel événement et confirmer qu’il apparaît après le nettoyage.
9. Dupliquer une vacation sur un mois de test et contrôler les horaires, conflits et brouillons.
10. Publier le mois et confirmer qu’une seule notification est envoyée par agent.
11. Terminer une mission et contrôler qu’un seul PDF est archivé.
12. Vérifier l’ordre du PDF et les photos en annexes.

Les appels réels Firebase, OneSignal, Supabase et Brevo ne peuvent pas être validés sans déploiement sur les projets correspondants.
