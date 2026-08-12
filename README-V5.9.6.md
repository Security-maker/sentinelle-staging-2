# Sentinelle Pro V5.9.6 — Client Azzera Responsive

Patch strictement limité à l’espace client.

## Modifications
- Fond général de l’espace client légèrement plus soutenu pour réduire l’effet trop clair.
- Rappels du bleu Azzera renforcés à partir des variables déjà présentes dans le portail (`#64d0ff` et bleu profond existant).
- Topbar, cartes et filtres légèrement plus contrastés sans passage en thème sombre.
- Sur mobile, les bulles site/mission + adresse n’utilisent plus de défilement horizontal : elles occupent la largeur disponible et reviennent proprement à la ligne.
- Cache PWA espace client incrémenté afin de forcer le chargement des nouveaux styles.

## Fichiers modifiés
- `client-style.css`
- `client.html`
- `client-app.js` (uniquement version du service worker)
- `service-worker.js` (cache/version espace client)

Aucun changement fonctionnel apporté aux portails Agent, QG, planning ou MCI.
