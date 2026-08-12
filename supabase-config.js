// Sentinelle Pro V5.10.0 — Supabase natif PRODUCTION.
// Storage PDF actif. Envoi e-mail automatique activé globalement ; chaque client reste piloté par clients.auto_email.
export const supabaseConfig = Object.freeze({
  enabled: true,
  mode: 'supabase',
  url: 'https://ksoyqtsrhtsfbwmxipqz.supabase.co',
  publishableKey: 'sb_publishable_TaSZX6F0nsEecsHPxjZ8hg_c1cZtQuN',
  organizationId: '43b09366-de36-5b44-97cc-d549eb0d4e53',
  reportBucket: 'main-courantes',
  autoEmail: true,
  emailFunction: 'send-main-courante'
});
