Sentinelle Pro V5.10.3 — E-mail Azzera Premium

PATCH EDGE FUNCTIONS UNIQUEMENT

Ce patch ne modifie ni le SQL, ni le cron, ni GitHub, ni le PDF, ni la logique d’envoi/retry.
Il remplace uniquement le rendu des e-mails automatiques de main courante.

À redéployer dans Supabase :
1. send-main-courante/index.ts
   - Remplacer tout le code de la fonction existante
   - Verify JWT : activé
   - Deploy

2. process-main-courante-queue/index.ts
   - Remplacer tout le code de la fonction existante
   - Verify JWT : désactivé
   - Deploy

Nouveau rendu :
- logo Azzera Protect depuis https://sentinelle-pro.app/assets/logo.png
- charte obsidian #141C25 + bleu Azzera #64D0FF
- document/client/date mis en avant
- bouton vers https://sentinelle-pro.app/client.html
- signature Azzera Protect / Service Exploitation
- version texte de secours
- PDF toujours joint

Aucun nouveau secret n’est nécessaire.
