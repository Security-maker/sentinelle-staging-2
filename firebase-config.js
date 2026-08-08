// Sentinelle Pro Lite — configuration Firebase PRODUCTION
// Remplace les valeurs ci-dessous par celles de ton projet Firebase.
// Important : ces clés Firebase Web ne sont pas des secrets, la vraie sécurité se fait dans firestore.rules et storage.rules.

export const firebaseConfig = {
  apiKey: "AIzaSyCM1JfpeNx4Oy7hTMTXy9T-vWQGlhPb43Y",
  authDomain: "azzerap-7b440.firebaseapp.com",
  databaseURL: "https://azzerap-7b440-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "azzerap-7b440",
  storageBucket: "azzerap-7b440.firebasestorage.app",
  messagingSenderId: "259939966441",
  appId: "1:259939966441:web:d787ed60a3b0f42f607f78",
  measurementId: "G-8HBPQM7WJ1"
};

// Optionnel : mets le numéro QG par défaut au format international sans espace.
export const DEFAULT_QG_WHATSAPP = "+33661416937";

export const pushConfig = {
  pushProvider: "onesignal",
  oneSignalAppId: "227f2a95-c6d1-464c-bfae-cdea09247cbe",
  pushWorkerUrl: "https://sp-push.nacerito83.workers.dev/",
  securityIntelWorkerUrl: "https://sp-intel.nacerito83.workers.dev"
};


