SENTINELLE PRO — STAGING V5.8.8.1

Correctif ciblé du Diagnostic Web Push.

Corrections :
- le bouton Diagnostic Web Push est branché via les événements globaux de l’interface ;
- le diagnostic affiche immédiatement « Diagnostic en cours… » ;
- timeout Edge Function (8 s) afin d’éviter un bouton qui semble ne rien faire ;
- timeout Service Worker (4 s) afin d’éviter une attente infinie de navigator.serviceWorker.ready ;
- résultat détaillé Edge Function / Supabase / appareil même lorsqu’un contrôle échoue.

Aucun SQL supplémentaire.
Aucun changement de secrets VAPID.
Aucune Edge Function à redéployer pour ce correctif frontend.
