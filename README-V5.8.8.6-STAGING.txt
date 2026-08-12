SENTINELLE PRO · STAGING · V5.8.8.6
PRISE DE POSTE UNIQUE · ANTI-DOUBLON

But : empêcher définitivement qu'un même agent crée 2 ou 3 shifts actifs lors d'un double/rejeu de soumission iOS/Safari.

1. Dans Supabase STAGING > SQL Editor, exécuter :
   supabase/staging-one-active-shift-v5886.sql

   Le SQL :
   - conserve le shift actif le plus récent si des doublons existent déjà ;
   - passe les autres doublons actifs en cancelled ;
   - crée un index unique partiel garantissant 1 seul shift actif par agent.

2. Déployer les fichiers web du patch sur le repo GitHub STAGING.

3. Fermer/réouvrir la PWA.
   Bandeau attendu :
   STAGING · V5.8.8.6 · PRISE DE POSTE UNIQUE · ANTI-DOUBLON

4. Test :
   - lancer une seule prise de poste ;
   - vérifier qu'une seule carte agent active existe ;
   - vérifier qu'une seule notification de prise de poste est reçue ;
   - terminer une seule fois la mission.

Aucun changement sur send-web-push, les secrets VAPID ou les RLS photo.
