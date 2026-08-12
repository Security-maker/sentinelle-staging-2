# Sentinelle Pro V5.9.0 — Production Supabase

Build de cutover préparé à partir de la V5.8.8.6 Supabase validée.

## Cible
- Supabase: `ksoyqtsrhtsfbwmxipqz`
- Organisation: `43b09366-de36-5b44-97cc-d549eb0d4e53`
- Auth: Supabase Auth
- Données métier: Supabase
- Photos: Supabase Storage `report-photos`
- PDF: Supabase Storage `main-courantes`
- Push: Web Push natif via `send-web-push`

## Cutover initial
- Firebase n’est pas utilisé par le runtime de ce build et peut rester intact comme rollback.
- L’envoi e-mail automatique des PDF reste volontairement désactivé (`autoEmail: false`) jusqu’à validation de `send-main-courante`.
- La veille externe reste désactivée (`securityIntelWorkerUrl: ''`) jusqu’à adaptation/validation côté Supabase.
- Le mode hors-ligne conserve le cache de confort, mais les écritures Supabase hors connexion ne sont pas garanties.

## Rollback
Réinstaller le contenu du ZIP Firebase V5.8.4 sauvegardé avant le cutover.
