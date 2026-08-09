import { pushConfig } from './sentinelle-config.js';

window.OneSignalDeferred = window.OneSignalDeferred || [];

window.__SENTINELLE_ONESIGNAL_READY__ = new Promise((resolve, reject) => {
  if (pushConfig?.pushProvider !== 'onesignal' || !pushConfig?.oneSignalAppId) {
    resolve(null);
    return;
  }

  const workerUrl = new URL('./push/onesignal/OneSignalSDKWorker.js', location.href);
  const workerPath = workerUrl.pathname.replace(/^\/+/, '');
  const workerScope = new URL('./push/onesignal/', location.href).pathname;

  window.OneSignalDeferred.push(async function(OneSignal) {
    try {
      if (new URLSearchParams(location.search).has('pushdebug')) {
        OneSignal.Debug.setLogLevel('trace');
      }
      await OneSignal.init({
        appId: pushConfig.oneSignalAppId,
        serviceWorkerPath: workerPath,
        serviceWorkerParam: { scope: workerScope },
        autoResubscribe: true,
        notifyButton: { enable: false },
        welcomeNotification: { disable: true }
      });
      window.__SENTINELLE_ONESIGNAL_INSTANCE__ = OneSignal;
      resolve(OneSignal);
    } catch (error) {
      console.error('Initialisation OneSignal impossible', error);
      reject(error);
    }
  });
});
