// Sentinelle Pro V5.8.7 — STAGING Supabase Auth + Core + Storage
// Aucun SDK Firebase n'est chargé par cette version.
export const stagingConfig = Object.freeze({
  version: '5.8.7',
  environment: 'staging',
  supabaseUrl: 'https://ksoyqtsrhtsfbwmxipqz.supabase.co',
  supabasePublishableKey: 'sb_publishable_TaSZX6F0nsEecsHPxjZ8hg_c1cZtQuN',
  organizationId: '43b09366-de36-5b44-97cc-d549eb0d4e53',
  reportPhotoBucket: 'report-photos',
  reportBucket: 'main-courantes',
  adminUserFunction: 'admin-manage-user',
  pushFunctionUrl: 'https://ksoyqtsrhtsfbwmxipqz.supabase.co/functions/v1/send-push'
});

export const DEFAULT_QG_WHATSAPP = '+33661416937';

// IMPORTANT STAGING : le push OneSignal réel reste désactivé pour ne pas relier
// les abonnements de production à l'identité staging. Le backend Supabase Auth
// de send-push est fourni en V5.8.7 et pourra être activé avec une app OneSignal
// staging séparée ou lors de la bascule V5.9.0.
export const pushConfig = Object.freeze({
  pushProvider: 'disabled-staging-isolation',
  oneSignalAppId: '',
  pushWorkerUrl: 'https://ksoyqtsrhtsfbwmxipqz.supabase.co/functions/v1/send-push',
  securityIntelWorkerUrl: ''
});
