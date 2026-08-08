SENTINELLE PRO V5.8.4 — STAGING SUPABASE LECTURE SEULE

OBJECTIF
Ce paquet sert uniquement à contrôler la connexion entre Firebase Auth et la copie Supabase staging.
Il ne s'agit pas encore d'une nouvelle version opérationnelle de Sentinelle Pro.

GARANTIES
- firebase-config.js est une copie strictement identique au fichier fourni dans la V5.8.4.
- Aucune fonction de mission, prise de poste, MCI, planning, push ou PDF n'est présente.
- Aucun Service Worker n'est enregistré.
- OneSignal n'est ni chargé ni initialisé.
- Les appels Supabase sont limités dans le code aux méthodes HTTP GET et HEAD.
- Firebase Auth est utilisé pour la connexion ; cette connexion peut mettre à jour les métadonnées normales de dernière connexion du compte.
- Firestore est utilisé uniquement pour lire le document users/{uid}.
- Aucune écriture de donnée métier dans Firestore, Firebase Storage ou Supabase n'est programmée.

DÉPLOIEMENT
Ce dossier doit être publié dans un dépôt GitHub Pages séparé de la production.
Ne remplacez aucun fichier du dépôt AZERRAP de production.

PROJETS CIBLÉS
Firebase : azzerap-7b440
Supabase : sentinelle-pro-staging
Référence Supabase : ksoyqtsrhtsfbwmxipqz
Organisation : 43b09366-de36-5b44-97cc-d549eb0d4e53

RÉSULTAT ATTENDU
Après connexion et lancement du contrôle :
- Claim Firebase : authenticated
- Réponse Supabase : HTTP 200
- Rôle métier : identique à Firestore
- Organisation : conforme

Les comptages sont informatifs. Une différence peut provenir des règles RLS ou d'une évolution des données depuis l'import.
