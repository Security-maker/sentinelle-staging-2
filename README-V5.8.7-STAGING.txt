SENTINELLE PRO — STAGING V5.8.7
===================================

OBJECTIF
- Supabase Auth natif : déjà validé V5.8.5.
- Vraie interface / backend métier : déjà validés V5.8.6.
- V5.8.7 ajoute le stockage privé Supabase pour :
  * photos MCI,
  * preuves photo de prise de poste,
  * nouvelles photos badge,
  * PDF générés.
- Création/suppression des comptes Supabase Auth depuis le QG via Edge Function.
- Backend send-push Supabase Auth fourni.

SÉCURITÉ STAGING
- Aucun SDK Firebase chargé.
- Aucun accès à Firebase par les fichiers V5.8.7.
- L'envoi e-mail automatique Brevo est désactivé sur staging.
- Le push OneSignal LIVE reste désactivé sur staging pour ne pas toucher aux abonnements de production.
  La fonction send-push répond en dry-run tant que SENTINELLE_PUSH_LIVE n'est pas true.

DÉPLOIEMENT
1. Supabase staging -> SQL Editor -> exécuter supabase/staging-storage-auth-v587.sql.
2. Supabase staging -> Edge Functions -> déployer admin-manage-user.
3. Optionnel maintenant : déployer send-push (reste dry-run sans activation explicite).
4. Remplacer les fichiers du repo GitHub STAGING uniquement.
5. Fermer/réouvrir la PWA staging pour prendre le nouveau Service Worker.

TESTS PRIORITAIRES
A. QG : connexion -> Agents -> créer un agent de test depuis l'interface.
B. Agent : mission -> prise de poste avec photo -> MCI avec photo -> fin de poste.
C. QG : vérifier MCI/photo et générer un PDF dans Documents.
D. Supabase Storage : vérifier que report-photos et main-courantes contiennent les nouveaux fichiers.
E. QG : supprimer le compte agent de test si souhaité.

ATTENDU
- Aucun data: URL nouveau ne doit être conservé dans reports.photo payload pour les nouvelles photos.
- Les URLs affichées sont des signed URLs temporaires.
- Les buckets restent privés.
