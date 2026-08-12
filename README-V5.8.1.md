# Sentinelle Pro — V5.8.1 consolidée et réversible

Cette version est construite à partir de la V5.7.5 contenue dans `AZERRAP-main(3).zip`, complétée par la passerelle V5.8.0. Supabase reste désactivé par défaut.

## Fonctions actives immédiatement avec Firebase

- Actions rapides déplacées en haut de l’accueil agent et affichées en bulles.
- PDF de mission strictement chronologique : prise de poste, événements, fin de poste.
- Photos conservées en annexes à la fin du PDF.
- Archivage automatique du PDF à la fin de poste avec identifiant stable anti-doublon.
- Service worker sans activation forcée pendant une mission.
- Dashboard QG : seulement les 3 derniers rapports MCI affichés, sans supprimer l’historique.
- Missions QG : seulement les 3 éléments prioritaires affichés, le planning complet reste disponible.
- Centre de notifications : bouton d’effacement non destructif. Il mémorise l’heure de nettoyage sans supprimer missions, MCI ou SOS.
- Une prise de poste apparaît immédiatement dans le centre de notifications QG.
- Notification push QG de prise de poste préparée avec authentification Firebase et idempotence.
- Le bouton « Dupliquer +7 jours » devient « Dupliquer sur le mois » : répétition hebdomadaire, contrôle des conflits, création en brouillon et notification unique lors de la publication.

## Supabase et Brevo

`supabase-config.js` doit rester :

```js
enabled: false,
mode: 'firebase'
```

Dans cet état, aucun appel Supabase ou Brevo n’est effectué. Les fichiers du portail client, du stockage privé, de l’envoi Brevo et de la migration sont présents mais inactifs.

## Installation sûre

1. Télécharger et conserver une copie de la version actuellement en production.
2. Publier `firestore.rules` avant l’application. La seule nouvelle collection Firebase est `qgNotificationStates`, utilisée pour mémoriser le nettoyage du centre de notifications.
3. Remplacer les fichiers fournis sur le dépôt.
4. Déployer aussi `worker/onesignal-worker.js` dans Cloudflare pour recevoir les notifications push de prise de poste sur les appareils QG.
5. Ajouter dans les variables du Worker Cloudflare : `FIREBASE_PROJECT_ID=azzerap-7b440`. Les variables OneSignal et le secret existants restent inchangés.
6. Ne pas faire vider le cache à un agent en mission. Fermer complètement la PWA puis la rouvrir après la mission.
7. Tester avec un compte QG et un compte agent de test avant généralisation.

## Retour arrière

- Restaurer les fichiers de la sauvegarde V5.7.5.
- Les données existantes restent compatibles : aucune table ou collection métier n’est supprimée ou transformée.
- La collection `qgNotificationStates` peut rester en place ; elle n’influence pas l’ancienne version.
- Supabase reste désactivé, donc aucun retour de données n’est nécessaire.

## Tests prioritaires

1. Connexion agent et QG.
2. Prise de poste avec photo et apparition dans le centre QG.
3. Réception push QG après déploiement du Worker.
4. Création MCI avec photo.
5. Fin de poste et génération d’un seul PDF.
6. Vérification de l’ordre PDF et des annexes.
7. Effacement des notifications puis création d’un nouvel événement.
8. Duplication mensuelle, contrôle des conflits, brouillon puis publication unique.
