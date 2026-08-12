# Sentinelle Pro — V5.11.0 TEST · Agent Experience

Cette version est destinée au **repo TEST uniquement**. Elle ne nécessite ni migration SQL, ni nouvelle Edge Function, ni modification Brevo.

## Fichiers à remplacer dans le repo test

- `app.js`
- `style.css`
- `index.html`
- `service-worker.js`

## Ce qui est ajouté

### Portail agent · mode mission
- accueil dynamique pendant une vacation active
- cercle de progression de la vacation et temps restant
- prochaine action contextuelle
- timeline alimentée par la MCI existante
- actions rapides adaptées au type de poste
- mise en avant de la relève / transmission
- résumé renforcé avant fin de poste
- micro-interactions discrètes et mode nuit terrain

### Expérience adaptée par site
Dans QG > Sites > Modifier :
- Surveillance / gardiennage
- Accueil / filtrage
- Surveillance avec rondes visuelles
- Mixte

Les sites existants sans configuration V5.11 restent par défaut en surveillance simple.

### Rondes visuelles
Configuration par site :
- activées oui/non
- fréquence
- délai avant première ronde
- tolérance avant retard
- rappel visuel avant ronde

Une ronde visuelle :
- se valide depuis l'accueil agent
- propose RAS ou anomalie
- accepte une observation et une photo facultative
- écrit directement dans la MCI avec `eventType = visual_round`
- ne lance jamais le module Ronde QR/NFC

Le module existant est renommé visuellement `Ronde QR` afin d'éviter la confusion.

### Aquila
Dans QG > Sites > Aquila :
- création d'une période de prestation Aquila
- date/heure de début et de fin de validité
- URL HTTPS du QR
- lecture locale d'un QR depuis une image ou un PDF lorsque le navigateur le permet
- historique et archivage des anciens accès

Le lien Aquila est rattaché au **site + période de prestation**, pas à l'agent et pas à une vacation individuelle.

Exemple : une banque surveillée du 17 au 23 août utilise le même QR toute la semaine. Les agents peuvent être remplacés ou replanifiés librement : le QR reste inchangé. Une nouvelle prestation peut ensuite recevoir un nouveau QR.

Chaque agent en poste pendant la période voit `Ouvrir Aquila`. Sentinelle trace uniquement l'ouverture du lien dans la MCI ; elle ne prétend pas que la prise de poste Aquila a été validée sur la plateforme externe.

Un accès expiré n'est plus proposé à l'agent.

## Important pour les tests

Si le repo TEST utilise le même projet Supabase que la production, les données créées restent partagées avec la production. Pour les essais, utiliser de préférence un site test et un agent test. Les nouveaux champs V5.11 sont additifs et l'ancienne interface les ignore, mais les MCI de test sont de vraies lignes Supabase.

## Cache PWA
La version utilise le cache `sentinelle-pro-v5-11-0-agent-experience-test` et charge `app.js/style.css` en `v=5110`.

Après le déploiement GitHub du repo test, fermer complètement l'ancienne PWA / les anciens onglets puis rouvrir la version test afin de laisser le nouveau Service Worker prendre la main.

## Aucun changement dans cette version
- envoi automatique des mains courantes V5.10 : inchangé
- Brevo : inchangé
- Edge Functions : inchangées
- SQL / cron : inchangés
- espace client : inchangé
- fonctionnement QR/NFC existant : conservé et séparé des rondes visuelles
