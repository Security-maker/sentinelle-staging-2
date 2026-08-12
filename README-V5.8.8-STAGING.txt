SENTINELLE PRO — V5.8.8 STAGING
WEB PUSH NATIF SUPABASE — SANS ONESIGNAL

Objectif
- Remplacer OneSignal + Worker Cloudflare par Web Push natif.
- Authentification des appels par Supabase Auth.
- Edge Function Supabase send-web-push.
- Abonnements stockés dans web_push_subscriptions, non lisibles directement par le navigateur.
- Clés VAPID privées uniquement dans les secrets Supabase.
- Notification QG à la PRISE DE POSTE.
- NOUVEAU : notification QG à la FIN DE POSTE.
- Flash, planning, consignes et documents utilisent le même moteur Web Push.

Installation STAGING uniquement
1. SQL Editor : exécuter supabase/staging-web-push-v588.sql
2. Dans le dossier du projet local : node scripts/generate-vapid.mjs
3. Copier la commande "supabase secrets set ..." affichée par le script.
4. Déployer : supabase functions deploy send-web-push --project-ref ksoyqtsrhtsfbwmxipqz
5. Mettre les fichiers V5.8.8 sur le dépôt GitHub STAGING.
6. Ouvrir Sentinelle > Push > Activer les notifications sur chaque appareil de test.

Test minimal
A. QG : activer les notifications.
B. Agent : activer les notifications.
C. QG crée une mission -> notification Agent.
D. Agent démarre -> notification QG "Agent en poste".
E. Agent termine -> notification QG "Fin de poste confirmée".
F. QG envoie un Flash -> notification Agent.

Important
- Ne jamais commiter WEB_PUSH_VAPID_PRIVATE_KEY.
- Le script generate-vapid.mjs n'écrit aucun secret dans le dépôt : il affiche les valeurs uniquement dans le terminal.
- L'ancien Edge Function send-push OneSignal peut rester déployé pendant le staging, mais V5.8.8 ne l'appelle plus.
- La production n'est pas modifiée par ce pack.
