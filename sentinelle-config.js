// Sentinelle Pro V5.9.3 — PRODUCTION Supabase Auth + Core + Storage + Web Push natif
// Aucun SDK Firebase, OneSignal ou Worker Cloudflare n'est nécessaire pour le push.
export const stagingConfig = Object.freeze({
  version: '5.9.3',
  environment: 'production',
  supabaseUrl: 'https://ksoyqtsrhtsfbwmxipqz.supabase.co',
  supabasePublishableKey: 'sb_publishable_TaSZX6F0nsEecsHPxjZ8hg_c1cZtQuN',
  organizationId: '43b09366-de36-5b44-97cc-d549eb0d4e53',
  reportPhotoBucket: 'report-photos',
  reportBucket: 'main-courantes',
  adminUserFunction: 'admin-manage-user',
  pushFunctionName: 'send-web-push',
  pushFunctionUrl: 'https://ksoyqtsrhtsfbwmxipqz.supabase.co/functions/v1/send-web-push'
});

export const DEFAULT_QG_WHATSAPP = '+33661416937';

export const pushConfig = Object.freeze({
  pushProvider: 'supabase-web-push',
  pushFunctionName: 'send-web-push',
  pushFunctionUrl: 'https://ksoyqtsrhtsfbwmxipqz.supabase.co/functions/v1/send-web-push',
  securityIntelWorkerUrl: ''
});
