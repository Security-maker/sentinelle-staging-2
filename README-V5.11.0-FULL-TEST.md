# Sentinelle Pro — V5.11.0 FULL TEST REPO

Version complète destinée au **repo TEST** pour valider l'expérience agent avant bascule en production.

## Socle intégré
- portail agent/QG existant
- espace client premium et correctif mobile V5.9.7
- envoi automatique des mains courantes V5.10
- bouton de relance / suivi de livraison V5.10
- sources des Edge Functions standalone avec email Azzera premium V5.10.3
- V5.11.0 Agent Experience TEST

## V5.11.0 Agent Experience
- accueil dynamique en mission
- cercle de progression et temps restant
- bouton principal contextuel
- timeline issue de la MCI existante
- actions rapides selon le type de poste
- rondes visuelles configurables, séparées des rondes QR/NFC
- résumé de fin de vacation
- transmission de relève
- micro-interactions et mode nuit terrain

## Aquila
L'accès Aquila est rattaché au **site + période de prestation**, et non à un agent.
Plusieurs agents et plusieurs vacations peuvent donc utiliser le même QR pendant toute sa période de validité.
Une modification du planning ou un remplacement d'agent ne modifie pas le QR.

## Déploiement du repo test
Décompresser l'archive et envoyer **le contenu de ce dossier** à la racine du repo test.

Aucune migration SQL supplémentaire n'est requise pour la V5.11.0 TEST elle-même.
Les migrations V5.10 et les sources Edge Functions sont présentes dans le dépôt à titre de cohérence du projet, mais si elles sont déjà déployées dans Supabase il ne faut pas les rejouer inutilement.

## Attention
Le fichier `supabase-config.js` cible le projet Supabase configuré dans le socle actuel.
Si le repo TEST utilise ce même projet que la production, les MCI, configurations de sites et essais réalisés depuis le repo TEST toucheront la même base.
Utiliser un site et un agent de test.
