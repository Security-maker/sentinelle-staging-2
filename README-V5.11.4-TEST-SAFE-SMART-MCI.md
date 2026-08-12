# Sentinelle Pro V5.11.4 — TEST SAFE · Smart MCI

Objectif de cette version : permettre à l’agent d’ajouter une ligne de main courante en quelques secondes sans chercher dans les menus.

## Parcours terrain

1. Depuis la mission active, toucher **Ajouter à la main courante**.
2. Sentinelle affiche d’abord jusqu’à 6 **actions fréquentes**.
3. Toucher l’action correspondant au fait observé.
4. Vérifier le texte professionnel prérempli et toucher **Ajouter maintenant**.
5. **Voir toutes les situations** reste disponible pour les cas moins fréquents.

## Profil hôtel

Lorsque le site est identifié comme hôtel (nom du site contenant Hôtel/Hotel ou profil `agentQuickActionProfile = hotel`), les raccourcis initiaux privilégient :

- Clés client récupérées
- Objet trouvé
- Situation RAS
- Ronde visuelle (si activée) ou éclairage défectueux
- Arrivée employé
- Départ employé

Les dernières actions utilisées sur le site remontent ensuite automatiquement en premier sur le téléphone de l’agent.

## Saisie rapide

- **Clés client récupérées** : chambre/référence facultative.
- **Objet trouvé** : objet + lieu facultatifs.
- **Éclairage / matériel défectueux** : localisation facultative.
- **Ronde visuelle** : RAS en un choix ; en cas d’anomalie, raccourcis Éclairage / Porte-accès / Matériel / Dégradation / Autre.

Les champs facultatifs enrichissent automatiquement la phrase finale lorsque le texte standard n’a pas été modifié manuellement.

## TEST SAFE

Cette version conserve la configuration TEST SAFE de V5.11.3 : `testMode: true` et `shadowWrites: true`. Ne pas utiliser ce dossier comme production.
