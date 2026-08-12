# Sentinelle Pro V5.9.1 — Espace client

Cette version conserve le socle production Supabase V5.9.0 et ajoute le portail client.

## Ajouts
- nouvelle entrée **Clients** dans le QG admin ;
- création/configuration d'une entité client ;
- rattachement des sites à un client ;
- création d'un compte Supabase Auth avec rôle `client` ;
- portail `client.html` avec filtres, recherche, consultation et téléchargement PDF ;
- mot de passe oublié / récupération Supabase Auth ;
- RLS renforcées au niveau client + site ;
- rattachement des PDF historiques aux clients à partir des sites ;
- préparation `auto_email` et destinataires futurs, sans activer l'envoi automatique global.

## Ordre de mise en production
1. Exécuter `supabase/migrations/002_client_portal_v591.sql` dans le SQL Editor du projet `ksoyqtsrhtsfbwmxipqz`.
2. Déployer la nouvelle Edge Function `admin-manage-user`.
3. Uploader les fichiers frontend V5.9.1 sur GitHub Pages.
4. Se reconnecter au QG, ouvrir **Clients**, vérifier les clients/sites/PDF.
5. Créer un compte client test et valider `client.html`.

## Important
`supabase-config.js` garde `autoEmail: false`. L'envoi automatique des mains courantes reste donc désactivé dans cette étape.
