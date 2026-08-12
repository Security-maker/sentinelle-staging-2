SENTINELLE PRO — STAGING V5.8.7.1

Correctif ciblé PHOTO MCI, basé sur la V5.8.7 validée.

Ce correctif :
- affiche la photo MCI directement dans le journal QG et dans la vue mission ;
- affiche la preuve en grand dans le détail d’un rapport ;
- conserve bucket + chemin Storage dans les documents archivés ;
- régénère une URL signée Supabase lors de la lecture d’un document archivé ;
- convertit temporairement les URL signées en data URL avant génération PDF pour remettre les photos dans les annexes PDF ;
- ne modifie ni le schéma SQL ni Firebase ;
- ne nécessite pas de nouvelle Edge Function.

INSTALLATION : remplacer uniquement les fichiers du patch dans le dépôt GitHub STAGING, puis fermer/réouvrir la PWA.
