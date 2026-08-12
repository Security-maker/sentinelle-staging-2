# Sentinelle Pro V5.11.1 — TEST SAFE

Cette version est destinée UNIQUEMENT au repo test.

## Protection production

Le repo test continue à lire le projet Supabase actuel pour récupérer le contexte (comptes, sites, missions), mais la couche métier fonctionne en **shadow local** :

- prises de poste : locales au navigateur
- fins de poste : locales au navigateur
- MCI / actions rapides : locales au navigateur
- rondes visuelles : locales au navigateur
- SOS/PTI : simulation locale uniquement
- paramètres V5.11 des sites : locaux au navigateur
- accès Aquila enregistrés dans le repo test : locaux au navigateur
- modifications de missions via la couche compat : locales au navigateur
- Push QG : désactivé
- abonnement Web Push : désactivé
- envoi automatique de mains courantes : désactivé
- passerelle Brevo / Storage PDF production : désactivée

Ainsi les événements de test ne créent pas de shifts/MCI/alertes dans la base production et ne peuvent pas apparaître dans le centre de notifications du QG principal.

## Rubriques volontairement bloquées

Dans le repo test sécurisé, les rubriques qui utilisent des écritures Supabase directes hors de la couche de simulation sont bloquées :

- Clients
- Facturation
- Documents production
- Gestion des agents
- Web Push

Elles ne sont pas nécessaires pour valider la V5.11 Agent Experience.

## Important

Le shadow est stocké dans le navigateur via `localStorage`. Il n'est donc **pas synchronisé entre deux appareils**. Pour tester l'agent et le QG avec les mêmes données simulées, utilise le même navigateur/appareil. Pour des tests multi-appareils totalement isolés, il faudra un projet Supabase de test séparé.

Le bouton `Réinitialiser les tests` dans le bandeau TEST SAFE supprime toutes les écritures locales et recharge le socle lu depuis la production.

## Aquila

Le bouton d'ouverture Aquila ouvre bien l'URL HTTPS réelle pour valider l'ergonomie. Sentinelle ne transmet aucune donnée à Aquila elle-même ; si tu remplis ensuite le formulaire Aquila dans la page ouverte, tu agis évidemment sur le service Aquila réel.
