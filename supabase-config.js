// Sentinelle Pro V5.8.6 — le backend métier passe déjà par supabase-compat.js.
// Cette ancienne passerelle PDF reste désactivée jusqu'à V5.8.7 (Storage + Brevo).
export const supabaseConfig = Object.freeze({
  enabled: false,
  mode: 'supabase',
  url: 'https://ksoyqtsrhtsfbwmxipqz.supabase.co',
  publishableKey: 'sb_publishable_TaSZX6F0nsEecsHPxjZ8hg_c1cZtQuN',
  organizationId: '43b09366-de36-5b44-97cc-d549eb0d4e53',
  reportBucket: 'main-courantes',
  autoEmail: false,
  emailFunction: 'send-main-courante'
});
