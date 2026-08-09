// Sentinelle Pro V5.8.6 — STAGING Supabase Core
// Aucun SDK Firebase n'est chargé par cette version.
export const stagingConfig = Object.freeze({
  version: '5.8.6',
  environment: 'staging',
  supabaseUrl: 'https://ksoyqtsrhtsfbwmxipqz.supabase.co',
  supabasePublishableKey: 'sb_publishable_TaSZX6F0nsEecsHPxjZ8hg_c1cZtQuN',
  organizationId: '43b09366-de36-5b44-97cc-d549eb0d4e53'
});

export const DEFAULT_QG_WHATSAPP = '+33661416937';

// V5.8.6 : notifications volontairement coupées sur le staging.
// Le Worker actuel valide encore les JWT Firebase. Reconnexion en V5.8.7.
export const pushConfig = Object.freeze({
  pushProvider: 'disabled',
  oneSignalAppId: '',
  pushWorkerUrl: '',
  securityIntelWorkerUrl: ''
});
