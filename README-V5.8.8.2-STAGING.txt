SENTINELLE PRO — V5.8.8.2 STAGING

Correctif Web Push ciblé d'après le diagnostic iPhone V5.8.8.1.

Corrigé :
- appel Edge Function avec Authorization JWT + apikey publique Supabase ;
- enregistrement explicite du Service Worker Sentinelle ;
- installation du Service Worker tolérante si un asset secondaire manque au cache ;
- diagnostic affiche désormais l'erreur exacte d'enregistrement du Service Worker ;
- activation Push force d'abord un Service Worker Sentinelle prêt.

Aucun SQL supplémentaire.
Aucun secret VAPID à ressaisir.
Aucun changement production.

Après GitHub staging : fermer complètement la PWA, la rouvrir, puis Diagnostic Web Push.
Si l'Edge Function reste inaccessible, ouvrir Supabase > Edge Functions > send-web-push > Logs : la V5.8.8.2 affiche alors aussi un message explicite côté app.
