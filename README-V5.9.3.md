# Sentinelle Pro V5.9.3

## Nouveautés

- QG > Clients : suppression individuelle d’un accès client avec confirmation `SUPPRIMER`.
- La suppression retire l’utilisateur Supabase Auth, le profil `role=client` et ses liens `client_users`, sans supprimer le client, les sites ni les PDF.
- Nouvelle page dédiée `reset-password.html` pour les mots de passe oubliés.
- Les liens de récupération Admin/Agent et Client arrivent sur cette page isolée.
- Après changement du mot de passe, aucune ouverture automatique d’un espace : l’utilisateur doit se reconnecter manuellement.
- Session de récupération non persistante et stockage Auth séparé afin d’éviter qu’une ancienne session client/admin détermine le portail ouvert.
- Cache PWA V5.9.3.

## Déploiement

1. Déployer d’abord `supabase/functions/admin-manage-user/index.ts`.
2. Vérifier dans Supabase Auth > URL Configuration que l’URL publique `reset-password.html` est autorisée comme Redirect URL (ou qu’un wildcard du dépôt GitHub Pages la couvre).
3. Uploader ensuite les fichiers du ZIP UPDATE à la racine GitHub.
4. Fermer/réouvrir la PWA pour prendre le cache V5.9.3.
5. Tester la suppression d’un accès client de test, puis le recréer avec la même adresse pour confirmer que l’utilisateur Auth a bien été supprimé.
6. Tester Mot de passe oublié depuis le portail principal et le portail client.
