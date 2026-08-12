SENTINELLE PRO — V5.8.8.3 STAGING

Correctif ciblé : photo obligatoire de prise de poste.

Constat V5.8.8.2 :
- Web Push natif OK ;
- abonnement actif OK ;
- certaines preuves de prise de poste échouaient dans le flux historique shiftProofs/compat_records ;
- le shift pouvait rester actif avec le drapeau "preuve enregistrée" alors que la vraie image n'était pas disponible.

V5.8.8.3 :
- la photo de prise de poste est désormais enregistrée dans le rapport automatique "Prise de service" ;
- ce rapport utilise le même pipeline Supabase Storage que les photos MCI déjà validées ;
- le rapport conserve le chemin Storage, le type MIME, la taille, les dimensions et la date de capture ;
- le shift conserve checkInPhotoReportId / checkInPhotoSource ;
- la fiche QG de l'agent utilise automatiquement cette photo si aucune ancienne preuve shiftProofs n'est disponible ;
- le démarrage est refusé si la vraie photo ne peut pas être enregistrée.

AUCUN SQL supplémentaire.
AUCUN secret à modifier.
AUCUNE clé VAPID à régénérer.
La fonction send-web-push déjà déployée peut rester en place.

Test : terminer le shift de test resté actif, rouvrir la PWA, prendre un nouveau poste avec photo, vérifier la photo dans le rapport "Prise de service" puis dans le détail QG de l'agent.
