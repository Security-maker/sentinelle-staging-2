// Sentinelle Pro V5.11.2 TEST SAFE ULTRA UX — lecture du backend prod, écritures métier en shadow local.
// Passerelle PDF/e-mail désactivée : aucun e-mail client ni Storage de production depuis le repo test.
export const supabaseConfig = Object.freeze({
  enabled: false,
  testMode: true,
  mode: 'supabase',
  url: 'https://ksoyqtsrhtsfbwmxipqz.supabase.co',
  publishableKey: 'sb_publishable_TaSZX6F0nsEecsHPxjZ8hg_c1cZtQuN',
  organizationId: '43b09366-de36-5b44-97cc-d549eb0d4e53',
  reportBucket: 'main-courantes',
  autoEmail: false,
  emailFunction: 'send-main-courante'
});
