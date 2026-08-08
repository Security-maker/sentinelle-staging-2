SENTINELLE PRO V5.8.4 — STAGING SUPABASE TEST D'ÉCRITURE CONTRÔLÉE

OBJECTIF
Valider les écritures Supabase via les JWT Firebase existants et les RLS du staging, sans toucher à la production Firebase.

CE TEST FAIT
- Connexion Firebase Auth existante.
- Lecture du profil Firestore users/{uid}.
- Audit de lecture Supabase/RLS.
- Pour un compte admin ou superviseur uniquement :
  1. INSERT d'un profil agent temporaire dans public.profiles.
  2. SELECT de contrôle.
  3. UPDATE de ce profil temporaire.
  4. DELETE du même profil.
  5. SELECT final pour confirmer qu'il ne reste aucune ligne de test.

SÉCURITÉ
- Le profil temporaire porte toujours un external_uid commençant par staging-write-test-.
- firebase_payload.staging_write_test=true est vérifié avant la suite du test.
- Un nettoyage de secours est tenté si une étape échoue après la création.
- Aucune écriture Firestore.
- Aucune écriture Firebase Storage.
- Aucune mission, vacation, MCI, planning, document ou notification n'est modifié.
- Aucun Service Worker.
- OneSignal absent.
- Ce test ne crée PAS de compte Firebase Auth et ne constitue donc pas encore la création opérationnelle complète d'un nouvel agent.

DÉPLOIEMENT
Remplacer les fichiers du repo staging actuel par ce paquet, ou au minimum :
- index.html
- staging-app.js
- staging-style.css
- README-DEPLOIEMENT.txt
- SHA256SUMS.txt

NE PAS DÉPLOYER DANS LE REPO AZERRAP DE PRODUCTION.

RÉSULTAT ATTENDU
Avec un compte QG admin/superviseur :
- audit lecture validé ;
- bouton Étape 3 activé ;
- POST profiles : OK ;
- GET vérification : OK ;
- PATCH profiles : OK ;
- DELETE profiles : OK ;
- Nettoyage : 0 ligne restante.
