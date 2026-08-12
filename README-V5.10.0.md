# Sentinelle Pro V5.10.0 — Envoi automatique des mains courantes

Patch ciblé. Il ne modifie pas les règles métier de prise/fin de poste, les MCI, les rondes, le planning ou l'espace client. Le Service Worker est volontairement laissé inchangé pour éviter tout impact inutile sur une mission en cours.

## Ce que le patch ajoute

- Envoi Brevo automatique du **rapport de mission PDF déjà archivé**.
- Activation **client par client** via `clients.auto_email`.
- Jusqu'à **3 tentatives au total** : envoi immédiat, puis relances serveur à +5 min et +30 min.
- Idempotence par `documentId + destinataire` pour ne pas doubler un e-mail déjà confirmé.
- Priorité destinataires : destinataires du document → destinataires rapports du client → e-mail rapports → e-mail facturation.
- États : `sent`, `retry_pending`, `failed`, `no_recipient`, `disabled`.
- Bouton QG **Relancer envoi**.
- Badge d'état dans Documents.
- Alerte QG si les 3 tentatives échouent ou si aucun destinataire n'est configuré.
- Cron toutes les 5 minutes pour les relances uniquement.

## Garde-fous

- L'envoi global est activé dans `supabase-config.js`, mais **chaque client reste désactivé par défaut** tant que `auto_email` n'est pas passé à `true`.
- Une panne Brevo n'annule jamais l'archivage du PDF.
- Le cron ne traite que `delivery_status='retry_pending'`.
- Si le secret cron n'est pas configuré, le job SQL ne fait rien.
- Le patch ne supprime aucune colonne ni aucune donnée existante.

## Ordre de déploiement recommandé

1. Appliquer `supabase/migrations/003_main_courante_auto_delivery_v510.sql`.
2. Configurer un secret aléatoire identique côté Edge Functions et Vault :
   - Edge Functions : `MAIN_COURANTE_CRON_SECRET`
   - Vault : nom `main_courante_cron_secret`
3. Vérifier que les secrets Brevo existants sont présents :
   - `BREVO_API_KEY`
   - `BREVO_SENDER_EMAIL`
   - `BREVO_SENDER_NAME` (optionnel, défaut : Sentinelle Pro)
4. Déployer les fonctions :
   - `send-main-courante`
   - `process-main-courante-queue`
5. Déployer les fichiers racine du patch.
6. Dans **QG → Clients**, choisir un seul client de test et passer **Envoi automatique des mains courantes = Oui**.
7. Clôturer une mission test et vérifier l'e-mail avant d'activer les autres clients.

## Création du secret Vault

Exemple dans le SQL Editor (remplacer la valeur par un secret aléatoire long) :

```sql
select vault.create_secret(
  'REMPLACER_PAR_UN_SECRET_ALEATOIRE_LONG',
  'main_courante_cron_secret',
  'Sentinelle Pro — cron mains courantes'
);
```

La même valeur doit être enregistrée dans le secret Edge Function `MAIN_COURANTE_CRON_SECRET`.

## Vérifications SQL utiles

```sql
select id,title,delivery_status,delivery_attempts,next_delivery_attempt_at,delivery_error,delivered_at
from public.generated_documents
where type='mission'
order by created_at desc
limit 20;
```

```sql
select document_id,recipient_email,status,attempt_count,last_attempt_at,next_attempt_at,sent_at,error_message
from public.email_deliveries
order by updated_at desc
limit 30;
```

```sql
select jobid,jobname,schedule,active
from cron.job
where jobname='sentinelle-main-courante-queue';
```

## Coupure d'urgence

Pour stopper immédiatement tout nouvel envoi automatique sans retirer le patch :

```sql
update public.clients
set auto_email=false, updated_at=now();
```

Les PDF et l'espace client continuent de fonctionner normalement.

## Limite volontaire de cette version

La V5.10.0 automatise et fiabilise **la livraison dès que le PDF est présent dans Supabase Storage**. Elle ne remplace pas le moteur actuel de génération PDF côté application afin de ne pas toucher au flux de clôture déjà validé.
