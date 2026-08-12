SENTINELLE PRO — STAGING V5.8.8.5

Correctifs ciblés :
- fin de poste idempotente : un seul processus suffit ;
- garde anti-double validation ;
- aucun second push de fin de poste si le shift est déjà completed ;
- invalidation immédiate du cache de poste actif après clôture ;
- les opérations secondaires (profil, audit, PDF) ne bloquent plus la sortie de mission ;
- notification QG de prise de poste exécutée de manière déterministe avant rafraîchissement de l'interface ;
- conservation du Web Push natif, du Storage photo et des RLS déjà validés.

Aucun SQL supplémentaire.
Ne pas modifier la fonction Edge send-web-push déjà déployée et fonctionnelle.

Test recommandé :
1. Ouvrir une nouvelle mission agent avec photo.
2. Vérifier une seule notification QG de prise de poste.
3. Terminer la mission UNE seule fois.
4. Vérifier retour immédiat à Hors poste.
5. Vérifier une seule notification QG de fin de poste.
