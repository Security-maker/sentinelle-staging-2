SENTINELLE PRO — V5.8.6 STAGING REAL UI / SUPABASE CORE
===========================================================

BUT
---
Cette version reprend la VRAIE interface V5.8.4, mais remplace le SDK Firebase
par Supabase Auth natif + un adaptateur Supabase pour le coeur métier.

IMPORTANT
---------
- Projet cible UNIQUEMENT : sentinelle-pro-staging.
- Ne pas envoyer ces fichiers dans le dépôt de production AZERRAP.
- Aucun SDK Firebase n'est chargé par index.html/app.js.
- OneSignal / Worker push sont volontairement désactivés en V5.8.6 staging.

AVANT GITHUB
------------
1. Supabase > sentinelle-pro-staging > SQL Editor.
2. Exécuter supabase/staging-real-ui-v586.sql.
3. Vérifier que la requête finale renvoie compat_records et les deux fonctions.

DÉPLOIEMENT
-----------
Remplacer le contenu du repo GitHub STAGING avec le pack complet, ou utiliser le
pack UPDATE si la base V5.8.5 est déjà en place.

TEST V5.8.6
-----------
1. Connexion QG avec le compte Supabase Auth déjà créé.
2. Vérifier Dashboard, Agents, Sites, Missions.
3. Créer UNE mission de test affectée au compte Agent Supabase déjà relié.
4. Déconnexion QG puis connexion Agent.
5. Vérifier Planning puis prendre le poste avec photo.
6. Créer un MCI de test.
7. Terminer le poste.
8. Reconnexion QG : vérifier mission terminée et les 3 rapports.

PÉRIMÈTRE RÉELLEMENT BASCULÉ EN V5.8.6
--------------------------------------
Supabase Auth natif : OUI
profiles / users métier : OUI
sites : OUI
missions / planning de base : OUI
shifts prise/fin de poste : OUI
reports / MCI : OUI
generated_documents (métadonnées) : OUI
audit_logs : OUI

SAS DE COMPATIBILITÉ STAGING
---------------------------
Les collections secondaires qui n'ont pas encore leur branchement final utilisent
compat_records pour les NOUVELLES écritures de test (rondes, preuve de prise de
poste, planning mensuel secondaire, etc.). Les historiques migrés de ces modules
ne sont pas encore tous exposés dans l'interface V5.8.6.

REPORTÉ À V5.8.7
----------------
- Supabase Storage définitif pour photos et PDF
- preuves photo historiques / migration Storage
- OneSignal + adaptation du Worker au JWT Supabase
- historique Flash / Push / Veille / SOS sur leurs tables finales
- création sécurisée d'un compte Supabase Auth depuis le QG (Edge Function)
- validation du hors-ligne / reprise réseau

NOTES DE SÉCURITÉ
----------------
L'agent ne reçoit PAS un droit UPDATE général sur profiles. Une RPC limitée permet
seulement statut, siteActuel, siteActuelNom, lastSeen et isOnline.
Les RLS V5.8.5 sur missions, shifts et reports restent la barrière principale.
