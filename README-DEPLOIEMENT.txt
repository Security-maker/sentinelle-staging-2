SENTINELLE PRO V5.8.4 — STAGING SUPABASE — RLS AGENT

Objectif : valider les permissions Supabase Agent avant le parcours métier complet.

ORDRE OBLIGATOIRE
1. Dans Supabase STAGING > SQL Editor, exécuter :
   supabase/rls-agent-hardening-v584.sql
2. Sur GitHub staging, remplacer index.html et staging-app.js (ou publier ce pack complet).
3. Attendre le déploiement GitHub Pages puis recharger la page.
4. Se connecter avec un compte AGENT de test.
5. Lancer Étape 2 : contrôle lecture.
6. Lancer Étape 4 : test sécurité RLS Agent.

ATTENDU
- Profils/missions/rapports d'autres agents invisibles.
- Création de profil, modification de site et création de mission refusées à l'agent.
- Mise à jour de sa mission autorisée.
- Création de son shift autorisée.
- Création de son rapport verrouillé autorisée.
- Modification d'un rapport existant refusée.

SÉCURITÉ
- La fonction staging_probe_agent_rls_v584 utilise des sous-transactions : toutes les écritures de sonde réussies sont volontairement annulées.
- Aucun Firestore, Firebase Storage, OneSignal ou Worker n'est modifié par ce test.
- Ce SQL est prévu uniquement pour le projet Supabase staging.
