// Sentinelle Pro V5.8.7 — Supabase natif.
// Storage PDF actif. Envoi e-mail automatique volontairement coupé sur STAGING
// pour éviter d'envoyer des rapports aux destinataires réels pendant les tests.
export const supabaseConfig = Object.freeze({
  enabled: true,
  mode: 'supabase',
  url: 'https://ksoyqtsrhtsfbwmxipqz.supabase.co',
  publishableKey: 'sb_publishable_TaSZX6F0nsEecsHPxjZ8hg_c1cZtQuN',
  organizationId: '43b09366-de36-5b44-97cc-d549eb0d4e53',
  reportBucket: 'main-courantes',
  autoEmail: false,
  emailFunction: 'send-main-courante'
});
