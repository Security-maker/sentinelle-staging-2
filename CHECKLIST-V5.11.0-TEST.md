# Checklist rapide V5.11.0 TEST

## 1 — Surveillance simple sans ronde
- QG > Sites > Modifier
- Type : Surveillance / gardiennage
- Rondes visuelles : Non
- Prendre un poste avec l'agent test
- Vérifier : aucun bouton de ronde obligatoire et aucune pénalité de conformité liée à l'absence de ronde

## 2 — Accueil / filtrage
- Type : Accueil / filtrage
- Vérifier les actions rapides : arrivée visiteur, départ visiteur, livraison, contrôle/refus d'accès
- Cliquer une action et vérifier son apparition dans la MCI/timeline

## 3 — Ronde visuelle
Pour tester vite :
- Rondes visuelles : Oui
- Fréquence : 15 min
- Première ronde : 0 min
- Tolérance : 5 min
- Rappel : 5 min

Vérifier :
- l'accueil propose `Effectuer ma ronde`
- aucun écran de scan QR/NFC ne s'ouvre
- RAS crée une MCI `Ronde visuelle`
- Anomalie impose une observation
- la prochaine ronde est recalculée à partir de la dernière ronde
- la fin de poste compte les rondes visuelles dans le résumé

## 4 — Aquila sur plusieurs jours
- QG > Sites > Aquila
- Ajouter une période couvrant plusieurs jours
- Coller une URL HTTPS ou importer le PDF/image QR
- Affecter un agent et vérifier `Ouvrir Aquila`
- Modifier ensuite l'agent planifié sans toucher à Aquila
- Vérifier que le nouvel agent hérite du même accès pendant la même période
- Après expiration, vérifier que le bouton n'est plus proposé

## 5 — Passation et clôture
- Ajouter une note de transmission à la fin de poste
- Prendre ensuite un poste sur le même site avec un autre agent
- Vérifier que la transmission précédente est visible et confirmable

## 6 — Non-régression
- MCI détaillée
- Flash QG
- PTI/SOS
- Planning
- Documents/consignes
- Ronde QR existante
- Fin de poste
- génération + envoi automatique de la main courante
