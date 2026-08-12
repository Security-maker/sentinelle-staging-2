# Sentinelle Pro — V5.8.2 consolidée, planning QG compact

Cette version reprend intégralement la V5.8.1 consolidée et ajoute uniquement un nouvel affichage du planning QG en vue **Sites**. Elle ne modifie aucun document Firebase existant et ne transforme aucune mission.

## Nouveau planning par journée

En vue **Sites** :

- chaque colonne de journée contient au maximum une case colorée par site ;
- la case reste strictement limitée à la largeur de sa colonne ;
- elle affiche le nombre d’agents distincts prévus sur la journée ;
- le survol à la souris affiche le nom des agents, leurs horaires, le type et le statut de chaque mission ;
- un clic sur une case ouvre directement la mission lorsqu’il n’y en a qu’une ;
- lorsqu’il y a plusieurs missions, un récapitulatif de la journée s’ouvre et permet d’accéder à chaque mission ;
- une case vide conserve le bouton de création rapide d’une mission ;
- la couleur de la case reste celle du site ;
- les missions en retard, terminées ou encore en brouillon conservent un repère visuel.

La vue **Collaborateurs** garde volontairement son affichage actuel afin de limiter le périmètre de la modification et de préserver les habitudes du QG.

## Aucun impact sur les données

Cette évolution est purement visuelle :

- aucune mission n’est supprimée ;
- aucune mission n’est regroupée en base ;
- aucun horaire n’est modifié ;
- aucun agent n’est réaffecté ;
- aucun statut de publication mensuelle n’est changé ;
- aucune confirmation agent n’est réinitialisée ;
- aucune règle Firestore supplémentaire n’est nécessaire pour cette évolution.

Le regroupement est calculé uniquement dans le navigateur à partir des missions déjà chargées.

## Contenu consolidé

La V5.8.2 comprend aussi tout ce qui était présent dans la V5.8.1 :

- actions rapides agent en bulles et repositionnées en haut ;
- PDF de mission chronologique avec photos en annexes ;
- portail client et passerelle Supabase préparés mais désactivés ;
- trois derniers rapports MCI sur le tableau de bord QG ;
- trois éléments seulement dans le suivi prioritaire ;
- bouton non destructif d’effacement des notifications ;
- notification QG lors d’une prise de poste ;
- duplication d’une vacation sur le mois ;
- service worker sans activation forcée pendant une mission.

## Supabase reste désactivé

Conserver dans `supabase-config.js` :

```js
enabled: false,
mode: 'firebase'
```

La production continue donc de fonctionner exclusivement avec Firebase tant que cette configuration n’est pas modifiée.

## Installation recommandée

Cette version remplace les packs V5.8.0 et V5.8.1 non encore installés. Utiliser uniquement le pack V5.8.2.

1. Sauvegarder intégralement la version actuellement en production.
2. Si la V5.8.1 n’a jamais été installée, publier d’abord le `firestore.rules` fourni et déployer le Worker Cloudflare fourni, conformément aux instructions V5.8.1.
3. Remplacer ensuite les fichiers du pack V5.8.2 sur le dépôt.
4. Ne pas demander à un agent en poste de vider son cache ou de relancer l’application.
5. Attendre la fin de sa mission, fermer complètement la PWA puis la rouvrir.
6. Tester d’abord avec un compte QG : vue Sites, affichage 7 jours, 14 jours puis Mois.
7. Survoler une case colorée et vérifier les agents et horaires.
8. Cliquer une case avec une seule mission puis une case avec plusieurs missions.
9. Vérifier qu’une case vide ouvre toujours la création rapide.

## Retour arrière

Restaurer les fichiers de la sauvegarde précédente. Aucune migration de données n’est nécessaire, car cette version n’écrit aucune nouvelle donnée pour le planning compact.
