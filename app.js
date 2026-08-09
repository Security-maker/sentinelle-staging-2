import { stagingConfig, DEFAULT_QG_WHATSAPP, pushConfig } from './sentinelle-config.js';
import { supabaseBridgeEnabled, mirrorGeneratedDocument } from './supabase-bridge.js';
import {
  initializeApp, deleteApp, getAuth, setPersistence, browserLocalPersistence, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut, onAuthStateChanged, initializeFirestore, persistentLocalCache,
  persistentMultipleTabManager, collection, doc, getDoc, getDocs, addDoc, setDoc, updateDoc, query, where,
  orderBy, limit, onSnapshot, serverTimestamp, Timestamp, runTransaction, deleteDoc, writeBatch, supabaseRuntimeConfigured, getSupabaseClient
} from './supabase-compat.js?v=5882';

const $app = document.querySelector('#app');
const $toast = document.querySelector('#toast-root');

// Indique à index.html que le module principal est bien chargé.
window.__SENTINELLE_MODULE_LOADED__ = true;

let fbApp = null;
let auth = null;
let db = null;
let storage = null; // V5.8.7.1 : médias et PDF utilisent Supabase Storage via la couche compat.
let currentUser = null;
let currentProfile = null;
let currentRoute = 'home';
let unsubscribeList = [];
let latestFlashUnsub = null;
let mapInstance = null;
let mapMarkers = [];
let mapSiteLayer = null;
let mapAgentLayer = null;
let mapBoundsCache = [];
let mapSitePoints = [];
let mapAgentPoints = [];
let sosTimer = null;
let sosCountdownTimer = null;
let sosArming = false;
let sosTriggered = false;
let activeShiftCache = null;
let lastSitesCache = [];
let qgReportMissionGroups = [];
let qgNotificationsCache = [];
let qgNotificationClearedAt = 0;
let qgMissionsCache = [];
let qgAllSitesCache = [];
let qgAllAgentsCache = [];
let qgInvoicesCache = [];
let billingProfileCache = null;
let qgPlanningState = { missions: [], sites: [], agents: [], startDate: null, mode: 'sites', days: 14, status: '', density: 'comfort', collaboratorAgentId: '', collaboratorMonth: '', publications: new Map() };
let pendingMissionSelectionId = null;

const rolePortal = role => role === 'agent' ? 'agent' : 'qg';
const nowText = () => new Date().toLocaleString('fr-FR', { dateStyle:'short', timeStyle:'short' });
const dateText = value => {
  if (!value) return '—';
  const d = value.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('fr-FR', { dateStyle:'short', timeStyle:'short' });
};
const dateOnlyText = value => {
  if (!value) return '—';
  const d = value.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('fr-FR');
};
const money = value => new Intl.NumberFormat('fr-FR', { style:'currency', currency:'EUR' }).format(Number(value || 0));
const round2 = value => Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
const normalizeHexColor = value => /^#[0-9a-f]{6}$/i.test(String(value || '').trim()) ? String(value).trim().toUpperCase() : null;
const contrastColor = hex => {
  const c = normalizeHexColor(hex) || '#009CFF';
  const r = parseInt(c.slice(1,3),16), g = parseInt(c.slice(3,5),16), b = parseInt(c.slice(5,7),16);
  return ((r*299 + g*587 + b*114) / 1000) > 150 ? '#03111D' : '#F4F8FB';
};
const safe = value => String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const id = () => Math.random().toString(36).slice(2, 10);
const isConfigured = () => supabaseRuntimeConfigured();
const isOnline = () => navigator.onLine;
const OFFLINE_PROFILE_KEY = 'sentinelle_offline_profile_v1';
const OFFLINE_READY_KEY = 'sentinelle_offline_ready_v1';

function saveOfflineProfile(profile){
  if (!profile?.uid) return;
  try {
    localStorage.setItem(OFFLINE_PROFILE_KEY, JSON.stringify({ uid:profile.uid, profile, savedAt:new Date().toISOString() }));
  } catch (_) {}
}
function readOfflineProfile(uid){
  try {
    const row = JSON.parse(localStorage.getItem(OFFLINE_PROFILE_KEY) || 'null');
    return row?.uid === uid && row?.profile ? row.profile : null;
  } catch (_) { return null; }
}
function setOfflineReady(uid){
  try { localStorage.setItem(OFFLINE_READY_KEY, JSON.stringify({ uid, syncedAt:new Date().toISOString() })); } catch (_) {}
}
function getOfflineReady(uid=currentUser?.uid){
  try {
    const row = JSON.parse(localStorage.getItem(OFFLINE_READY_KEY) || 'null');
    return row?.uid === uid ? row : null;
  } catch (_) { return null; }
}
function offlineReadyText(){
  const row = getOfflineReady();
  if (!row?.syncedAt) return 'Non préparé';
  const d = new Date(row.syncedAt);
  return Number.isNaN(d.getTime()) ? 'Préparé' : `Dernière synchro ${d.toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'})}`;
}

function toast(message, type='info'){
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  $toast.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function clearSubs(){
  unsubscribeList.forEach(fn => { try { fn(); } catch(e){} });
  unsubscribeList = [];
  if (latestFlashUnsub) { try { latestFlashUnsub(); } catch(e){} latestFlashUnsub = null; }
}

function getGPS(options={ enableHighAccuracy:true, timeout:8000, maximumAge:20000 }){
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy, capturedAt: new Date().toISOString() }),
      () => resolve(null),
      options
    );
  });
}


function timestampToDate(value){
  if (!value) return null;
  const d = value?.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
function elapsedShiftText(value){
  const start = timestampToDate(value);
  if (!start) return 'Calcul en cours';
  const totalMinutes = Math.max(0, Math.floor((Date.now() - start.getTime()) / 60000));
  if (totalMinutes < 1) return 'Moins d’une minute';
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days) return `${days} j ${hours} h ${minutes} min`;
  if (hours) return `${hours} h ${minutes} min`;
  return `${minutes} min`;
}
function blobToDataUrl(blob){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('Lecture de la photo impossible.'));
    reader.readAsDataURL(blob);
  });
}
async function compressCheckInPhoto(file){
  if (!file || !String(file.type || '').startsWith('image/')) throw new Error('Choisis une photo valide.');
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = objectUrl;
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Cette photo ne peut pas être lue. Essaie une photo JPEG.'));
    });
    let width = image.naturalWidth || image.width;
    let height = image.naturalHeight || image.height;
    const maxDimension = 640;
    const scale = Math.min(1, maxDimension / Math.max(width, height));
    width = Math.max(1, Math.round(width * scale));
    height = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha:false });
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    let quality = .72;
    let blob = null;
    while (quality >= .34) {
      blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= 180000) break;
      quality -= .08;
    }
    if (!blob) throw new Error('Compression de la photo impossible.');
    if (blob.size > 260000) throw new Error('La photo reste trop lourde. Reprends-la avec moins de détails.');
    return {
      dataUrl: await blobToDataUrl(blob),
      bytes: blob.size,
      width,
      height,
      mimeType: 'image/jpeg',
      capturedAt: new Date().toISOString()
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function compressBadgePhoto(file){
  if (!file || !String(file.type || '').startsWith('image/')) throw new Error('Choisis une photo agent valide.');
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = objectUrl;
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error('Photo illisible. Essaie une photo JPEG ou PNG.'));
    });
    const targetW = 420;
    const targetH = 520;
    const canvas = document.createElement('canvas');
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext('2d', { alpha:false });
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0,0,targetW,targetH);
    const iw = image.naturalWidth || image.width;
    const ih = image.naturalHeight || image.height;
    const scale = Math.max(targetW / iw, targetH / ih);
    const sw = Math.round(targetW / scale);
    const sh = Math.round(targetH / scale);
    const sx = Math.max(0, Math.round((iw - sw) / 2));
    const sy = Math.max(0, Math.round((ih - sh) / 2));
    ctx.drawImage(image, sx, sy, sw, sh, 0, 0, targetW, targetH);
    let quality = .74;
    let blob = null;
    while (quality >= .38) {
      blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= 190000) break;
      quality -= .08;
    }
    if (!blob) throw new Error('Compression de la photo impossible.');
    if (blob.size > 300000) throw new Error('La photo reste trop lourde. Reprends-la avec moins de détails.');
    return { dataUrl: await blobToDataUrl(blob), bytes: blob.size, width:targetW, height:targetH, mimeType:'image/jpeg', capturedAt:new Date().toISOString() };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

async function geocodeAddress(address){
  const queryText = String(address || '').trim();
  if (queryText.length < 5) throw new Error('Renseigne une adresse plus précise.');
  const url = new URL('https://data.geopf.fr/geocodage/search');
  url.searchParams.set('q', queryText);
  url.searchParams.set('index', 'address');
  url.searchParams.set('limit', '1');
  url.searchParams.set('autocomplete', '1');
  const response = await fetch(url.toString(), { headers:{ Accept:'application/json' } });
  if (!response.ok) throw new Error(`Service de géolocalisation indisponible (${response.status}).`);
  const data = await response.json();
  const feature = data?.features?.[0] || data?.results?.[0] || null;
  const coordinates = feature?.geometry?.coordinates || feature?.coordinates || null;
  const lng = Number(Array.isArray(coordinates) ? coordinates[0] : feature?.lon ?? feature?.longitude);
  const lat = Number(Array.isArray(coordinates) ? coordinates[1] : feature?.lat ?? feature?.latitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw new Error('Adresse non reconnue. Vérifie le numéro, la rue et la ville.');
  const properties = feature?.properties || feature || {};
  return {
    lat,
    lng,
    label: properties.label || properties.name || properties.fulltext || queryText,
    score: Number(properties.score || 0),
    source: 'IGN Géoplateforme / BAN'
  };
}

function collectionRef(name){ return collection(db, name); }
function docRef(name, docId){ return doc(db, name, docId); }

function page(title, subtitle, body, options={}){
  const profileName = currentProfile ? `${currentProfile.prenom || ''} ${currentProfile.nom || ''}`.trim() : '';
  const portal = currentProfile ? rolePortal(currentProfile.role) : 'public';
  const nav = portal === 'agent' ? agentNav() : qgNav();
  const gpsPill = portal === 'agent' ? `<span class="pill ${currentProfile?.statut === 'en_poste' ? 'green' : ''}">${currentProfile?.statut === 'en_poste' ? 'GPS actif pendant le service' : 'GPS inactif hors poste'}</span>` : '';
  return `
    <div class="layout ${portal}">
      <div class="drawer-backdrop" id="drawer-backdrop" data-action="close-menu"></div>
      <aside class="nav-drawer" id="nav-drawer" aria-hidden="true">
        <div class="drawer-head">
          <div class="brand drawer-brand">
            <img src="assets/logo.png" alt="Sentinelle Pro">
            <div><div class="brand-name">Sentinelle Pro</div><div class="brand-kicker">Centre opérationnel</div></div>
          </div>
          <button class="icon-btn" data-action="close-menu" aria-label="Fermer le menu">×</button>
        </div>
        <nav class="nav drawer-nav">${nav}</nav>
        <div class="side-footer drawer-footer">
          <div><strong>${safe(profileName || 'Utilisateur')}</strong></div>
          <div>${safe(currentProfile?.role || '')}</div>
          <div class="divider"></div>
          <button class="btn ghost full small" data-action="logout">Déconnexion</button>
        </div>
      </aside>
      <main class="main">
        <div class="topbar">
          <div class="topbar-leading">
            <button class="menu-toggle" data-action="toggle-menu" aria-label="Ouvrir le menu"><span></span><span></span><span></span></button>
            <img src="assets/logo.png" alt="Sentinelle Pro" class="topbar-logo">
            <div class="page-title"><h1>${safe(title)}</h1><p>${safe(subtitle || '')}</p></div>
          </div>
          <div class="top-actions">
            ${gpsPill}
            <span class="pill ${navigator.onLine ? 'green':'red'}">${navigator.onLine ? 'En ligne':'Hors ligne'}</span>
            <span class="pill blue" id="clock-pill">${nowText()}</span>
          </div>
        </div>
        ${body}
      </main>
      ${portal === 'agent' ? sosButton() : ''}
    </div>
  `;
}

function navBtn(route, icon, label){
  return `<button class="nav-btn ${currentRoute === route ? 'active':''}" data-route="${route}"><span class="nav-icon">${icon}</span><span>${label}</span></button>`;
}
function agentNav(){
  return [
    navBtn('home','⌂','Accueil'), navBtn('planning','◷','Planning'), navBtn('badge','▣','Badge'), navBtn('mci','▤','MCI'), navBtn('round','◎','Ronde'), navBtn('docs','▣','Docs'), navBtn('flash','⚡','Flash'), navBtn('pushsetup','🔔','Push'), navBtn('intel','◌','Veille')
  ].join('');
}
function qgNav(){
  const items = [
    navBtn('home','⌂','Dashboard'), navBtn('missions','◷','Missions'), navBtn('notifications','◆','Notif'), navBtn('reports','▤','MCI'), navBtn('documents','▣','Documents')
  ];
  if (isStrictAdmin()) items.push(navBtn('billing','€','Facturation'));
  items.push(navBtn('intel','◌','Veille'), navBtn('device','◉','Dispositif'), navBtn('sites','▦','Sites'), navBtn('agents','☷','Agents'), navBtn('alerts','!','SOS'), navBtn('flash','⚡','Flash'), navBtn('pushsetup','🔔','Push'), navBtn('history','⇩','Exports'));
  return items.join('');
}
function sosButton(){
  return `<div class="sos-help hidden" id="sos-help">Maintenir 3 secondes pour déclencher. Relâcher annule l’armement.</div><div class="sos-fixed"><button class="sos-btn" id="sos-btn">SOS<br><small>PTI</small></button></div>`;
}

function boot(){
  if ('serviceWorker' in navigator) {
    // V5.8.8.2 : enregistre explicitement le Worker Sentinelle et garde l'erreur pour le diagnostic.
    ensureSentinelleServiceWorker({ cleanupLegacy:true, timeoutMs:8000 }).catch(error => {
      window.__SENTINELLE_SW_LAST_ERROR__ = error?.message || String(error || 'Service Worker indisponible');
      console.warn('Service Worker Sentinelle non prêt', error);
    });
  }
  window.addEventListener('online', () => {
    toast('Connexion rétablie — synchronisation en cours', 'success');
    if (currentUser && currentProfile && rolePortal(currentProfile.role) === 'agent') {
      primeAgentOfflineData().catch(error => console.warn('Synchronisation hors ligne impossible', error));
    }
    retryPendingSupabaseDeliveries().catch(error => console.warn('Relance Supabase impossible', error));
  });
  window.addEventListener('offline', () => toast('Mode hors ligne V5.8.8.2 — les écritures Supabase sont suspendues jusqu’au retour du réseau', 'warning'));

  if (!isConfigured()) return renderSetupMissing();
  try {
    fbApp = initializeApp();
    auth = getAuth(fbApp);
    setPersistence(auth, browserLocalPersistence).catch(error => console.warn('Persistance Auth indisponible', error));
    db = initializeFirestore(fbApp, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
    });
    storage = getSupabaseClient().storage;
  } catch (error) {
    console.error(error);
    return renderFatal('Configuration Supabase staging invalide', error.message);
  }

  onAuthStateChanged(auth, async user => {
    clearSubs();
    currentUser = user;
    activeShiftCache = null;
    if (!user) return renderLogin();
    await loadProfile(user);
  });
}

async function loadProfile(user){
  try {
    let profileData = null;
    try {
      const snap = await getDoc(docRef('users', user.uid));
      if (snap.exists()) profileData = snap.data();
    } catch (error) {
      if (navigator.onLine) throw error;
    }
    if (!profileData) profileData = readOfflineProfile(user.uid);
    if (!profileData) {
      if (!navigator.onLine) return renderOfflineDeviceNotPrepared(user);
      return renderMissingProfile(user);
    }
    currentProfile = { uid:user.uid, ...profileData };
    saveOfflineProfile(currentProfile);
    if (navigator.onLine) {
      updateDoc(docRef('users', user.uid), { lastSeen: serverTimestamp(), isOnline: true }).catch(() => {});
    }
    const requestedRoute = new URLSearchParams(location.search).get('route') || 'home';
    const portal = rolePortal(currentProfile.role);
    const allowedAgentRoutes = ['home','planning','badge','mci','round','docs','flash','pushsetup','intel'];
    const allowedQGRoutes = ['home','missions','notifications','reports','documents','billing','intel','device','sites','agents','alerts','flash','pushsetup','history'];
    currentRoute = portal === 'agent' && allowedAgentRoutes.includes(requestedRoute) ? requestedRoute : portal === 'qg' && allowedQGRoutes.includes(requestedRoute) ? requestedRoute : 'home';
    navigate(currentRoute);
    if (navigator.onLine) {
      syncNativePushIdentity().catch(() => {});
      primeAgentOfflineData().catch(error => console.warn('Préparation hors ligne incomplète', error));
      retryPendingSupabaseDeliveries().catch(error => console.warn('Livraisons Supabase en attente', error));
    }
    startFlashListener();
  } catch (error) {
    console.error(error);
    if (!navigator.onLine && currentUser) return renderOfflineDeviceNotPrepared(currentUser);
    renderFatal('Accès refusé', 'Impossible de charger le profil utilisateur. Vérifie Supabase Auth, profiles et les RLS.');
  }
}

async function primeAgentOfflineData(){
  if (!currentUser || !currentProfile || rolePortal(currentProfile.role) !== 'agent' || !navigator.onLine) return;
  await Promise.allSettled([
    getAgentPlannedMissions(),
    getActiveSites(),
    findActiveShift(),
    getDocs(query(collectionRef('documents'), limit(250))),
    getDocs(query(collectionRef('roundCheckpoints'), limit(500))),
    getDocs(query(collectionRef('flashMessages'), orderBy('sentAt','desc'), limit(30))),
    getDocs(query(collectionRef('shifts'), where('agentId','==',currentUser.uid), limit(100)))
  ]);
  saveOfflineProfile(currentProfile);
  setOfflineReady(currentUser.uid);
  document.querySelector('#offline-ready-status')?.replaceChildren(document.createTextNode(offlineReadyText()));
}

function render(html){
  // Empêche le faux écran 'Démarrage trop long' une fois qu'une vue est rendue.
  window.__SENTINELLE_RENDERED__ = true;
  $app.className = '';
  $app.innerHTML = html;
  bindGlobalEvents();
  const clock = document.querySelector('#clock-pill');
  if (clock) setInterval(() => { const c=document.querySelector('#clock-pill'); if(c) c.textContent=nowText(); }, 30000);
}

function bindGlobalEvents(){
  const layout = document.querySelector('.layout');
  const openMenu = () => {
    layout?.classList.add('drawer-open');
    document.querySelector('#nav-drawer')?.setAttribute('aria-hidden','false');
    document.body.classList.add('menu-open');
  };
  const closeMenu = () => {
    layout?.classList.remove('drawer-open');
    document.querySelector('#nav-drawer')?.setAttribute('aria-hidden','true');
    document.body.classList.remove('menu-open');
  };
  document.querySelectorAll('[data-action="toggle-menu"]').forEach(btn => btn.addEventListener('click', openMenu));
  document.querySelectorAll('[data-action="close-menu"]').forEach(btn => btn.addEventListener('click', closeMenu));
  document.querySelectorAll('[data-route]').forEach(btn => btn.addEventListener('click', () => { closeMenu(); navigate(btn.dataset.route); }));
  document.querySelectorAll('[data-action="diagnose-web-push"]').forEach(btn => btn.addEventListener('click', () => diagnosePushSetup(btn)));
  document.querySelectorAll('[data-action="logout"]').forEach(btn => btn.addEventListener('click', async () => {
    closeMenu();
    if (currentUser) await updateDoc(docRef('users', currentUser.uid), { isOnline:false, lastSeen: serverTimestamp() }).catch(()=>{});
    await disableNativePushForCurrentDevice().catch(()=>{});
    await signOut(auth);
  }));
  document.onkeydown = e => { if (e.key === 'Escape') closeMenu(); };
  bindSos();
}

function navigate(route){
  currentRoute = route;
  clearSubs();
  const portal = rolePortal(currentProfile.role);
  if (portal === 'agent') {
    ({ home:renderAgentHome, planning:renderAgentPlanning, badge:renderAgentBadge, mci:renderAgentMCI, round:renderAgentRound, docs:renderAgentDocs, flash:renderAgentFlash, pushsetup:renderPushSetup, intel:renderAgentIntel }[route] || renderAgentHome)();
  } else {
    ({ home:renderQGHome, missions:renderQGMissions, notifications:renderQGNotifications, reports:renderQGReports, documents:renderQGDocuments, billing:renderQGBilling, intel:renderQGIntel, device:renderQGDevice, sites:renderQGSites, agents:renderQGAgents, alerts:renderQGAlerts, flash:renderQGFlash, pushsetup:renderPushSetup, history:renderQGHistory }[route] || renderQGHome)();
  }
}

function renderSetupMissing(){
  render(`
    <div class="login-page"><section class="login-card">
      <img src="assets/logo.png" class="login-logo" alt="Sentinelle Pro">
      <h1>Configuration requise</h1>
      <p class="subtitle">Portail opérationnel sécurisé</p>
      <div class="setup-box">
        L’application est en mode production uniquement. Aucun mode démo n’est activé.<br><br>
        La configuration Supabase staging est absente ou invalide dans <strong>sentinelle-config.js</strong>.
      </div>
      <div class="card compact">
        <div class="item-meta">À faire : vérifier l’URL Supabase, la clé publique et l’UUID d’organisation du projet sentinelle-pro-staging.</div>
      </div>
    </section></div>`);
}
function renderFatal(title, message){
  render(`<div class="login-page"><section class="login-card"><img src="assets/logo.png" class="login-logo"><h1>${safe(title)}</h1><p class="subtitle">Erreur système</p><div class="setup-box danger-copy">${safe(message)}</div></section></div>`);
}
function renderOfflineDeviceNotPrepared(user){
  render(`<div class="login-page"><section class="login-card"><img src="assets/logo.png" class="login-logo" alt="Sentinelle Pro"><h1>Accès hors ligne indisponible</h1><p class="subtitle">Cet appareil n’a pas encore été préparé</p><div class="setup-box warning-copy">Une première connexion avec réseau est nécessaire sur cet appareil pour vérifier le compte et mettre en cache le profil, le planning et les consignes. Ensuite, l’application pourra redémarrer sans réseau tant que l’agent ne se déconnecte pas.</div><button class="btn full" type="button" onclick="location.reload()">Réessayer</button></section></div>`);
}
function renderLogin(){
  currentProfile = null;
  render(`
    <div class="login-page">
      <form class="login-card" id="login-form">
        <img src="assets/logo.png" class="login-logo" alt="Sentinelle Pro">
        <h1>Sentinelle Pro</h1>
        <p class="subtitle">Portail opérationnel sécurisé</p>
        <div class="field"><label>Email</label><input class="input" name="email" type="email" autocomplete="email" required placeholder="agent@agence.fr"></div>
        <div class="field"><label>Mot de passe</label><input class="input" name="password" type="password" autocomplete="current-password" required placeholder="••••••••"></div>
        <button class="btn primary full" type="submit" ${navigator.onLine?'':'disabled'}>${navigator.onLine?'Connexion sécurisée':'Connexion impossible sans réseau'}</button>
        ${navigator.onLine?'':`<div class="setup-box warning-copy">Aucune session active n’est disponible sur cet appareil. La toute première connexion Supabase ne peut pas être vérifiée sans réseau. Connecte cet appareil une fois, puis conserve la session pour les futurs démarrages hors ligne.</div>`}
        <div class="divider"></div>
        <p class="muted" style="font-size:12px;line-height:1.55">Authentification native <strong>Supabase Auth</strong>. Les rôles métier sont lus dans <strong>public.profiles</strong>.</p>
      </form>
    </div>`);
  document.querySelector('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    try {
      await signInWithEmailAndPassword(auth, fd.get('email'), fd.get('password'));
      toast('Connexion validée', 'success');
    } catch (error) {
      toast('Connexion refusée. Vérifie email et mot de passe.', 'error');
    }
  });
}
function renderMissingProfile(user){
  render(`
    <div class="login-page"><section class="login-card">
      <img src="assets/logo.png" class="login-logo"><h1>Profil non configuré</h1><p class="subtitle">Profil Supabase requis</p>
      <div class="setup-box">Le compte existe dans Supabase Auth, mais aucun profil métier relié n’est visible dans public.profiles.</div>
      <div class="field"><label>UUID Supabase Auth</label><input class="input mono" readonly value="${safe(user.uid)}"></div>
      <div class="card compact"><div class="item-meta">Relie auth.users.id à public.profiles.auth_user_id puis conserve external_uid pendant la transition V5.8.7.</div></div>
      <div class="divider"></div><button class="btn full" data-action="logout">Déconnexion</button>
    </section></div>`);
}

boot();

// -------------------- AGENT --------------------
async function findActiveShift(){
  if (!currentUser) return null;
  const q = query(collectionRef('shifts'), where('agentId','==',currentUser.uid), where('status','==','active'), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id:d.id, ...d.data() };
}
async function getActiveSites(){
  try {
    const snap = await getDocs(query(collectionRef('sites'), where('isActive','==',true), orderBy('name'))).catch(async () => getDocs(query(collectionRef('sites'), where('isActive','==',true))));
    lastSitesCache = snap.docs.map(d => ({ id:d.id, ...d.data() }));
  } catch (error) {
    console.warn('Sites indisponibles hors ligne', error);
  }
  return lastSitesCache;
}

async function getAgentPlannedMissions(){
  if (!currentUser) return [];
  const snap = await getDocs(query(collectionRef('missions'), where('agentId','==',currentUser.uid))).catch(()=>({docs:[]}));
  const now = Date.now();
  return snap.docs.map(d => ({ id:d.id, ...d.data() }))
    .filter(m => !missionIsDraft(m) && (['planned','assigned'].includes(m.status || 'planned') || ((m.scheduledEnd?.toDate?.()?.getTime() || 0) > now && m.status !== 'completed')))
    .sort((a,b)=>(a.scheduledStart?.toDate?.()?.getTime() || 0) - (b.scheduledStart?.toDate?.()?.getTime() || 0));
}
function toLocalInputValue(value){
  if (!value) return '';
  const d = value.toDate ? value.toDate() : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInputValue(value){
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : Timestamp.fromDate(d);
}
function missionStatusLabel(status){
  return ({ planned:'Planifiée', assigned:'Planifiée', active:'En cours', completed:'Terminée', cancelled:'Annulée' }[status || 'planned'] || status || 'Planifiée');
}
function missionStatusColor(status){
  return status === 'completed' ? 'green' : status === 'active' ? 'blue' : status === 'cancelled' ? 'red' : 'orange';
}
function missionIsLate(m){
  if(missionIsDraft(m)) return false;
  const start = m.scheduledStart?.toDate?.()?.getTime();
  return start && Date.now() > start + 10*60*1000 && !['active','completed','cancelled'].includes(m.status);
}
function computeConformityScore({ shift, reportsCount, roundsCount, incidentsCount }){
  let score = 100;
  const start = shift.scheduledStart?.toDate?.()?.getTime();
  const actual = shift.startTime?.toDate?.()?.getTime();
  if (start && actual && actual > start + 5*60*1000) score -= Math.min(25, Math.ceil((actual - start) / 60000));
  if (!reportsCount) score -= 12;
  if (!roundsCount) score -= 10;
  if (incidentsCount) score -= Math.min(10, incidentsCount * 2);
  return Math.max(0, Math.min(100, score));
}


function localMonthValue(value=new Date()){
  const d = value instanceof Date ? value : new Date(value);
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}`;
}
function monthRange(value){
  const match = String(value || '').match(/^(\d{4})-(\d{2})$/);
  const base = match ? new Date(Number(match[1]), Number(match[2])-1, 1) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const start = startOfDay(base);
  const end = new Date(base.getFullYear(), base.getMonth()+1, 1);
  return { start, end, days:new Date(base.getFullYear(), base.getMonth()+1, 0).getDate(), label:base.toLocaleDateString('fr-FR',{month:'long',year:'numeric'}) };
}
function timeOnlyText(value){
  const d = timestampToDate(value);
  return d ? d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}) : '--:--';
}
function missionDurationMinutes(mission){
  const start = timestampToDate(mission?.scheduledStart)?.getTime();
  const end = timestampToDate(mission?.scheduledEnd)?.getTime();
  return start && end && end > start ? Math.round((end-start)/60000) : 0;
}
function hoursText(minutes){
  const total = Math.max(0, Number(minutes || 0));
  const h = Math.floor(total/60), m = total%60;
  return m ? `${h} h ${String(m).padStart(2,'0')}` : `${h} h`;
}
function missionRevision(mission){ return Math.max(1, Number(mission?.planningRevision || 1)); }
function missionIsDraft(mission){ return String(mission?.publicationStatus || '').toLowerCase() === 'draft'; }
function planningMonthForValue(value){ const d=timestampToDate(value); return d?localMonthValue(d):localMonthValue(); }
function planningPublicationDocId(monthValue){ return String(monthValue || localMonthValue()).replace(/[^0-9-]/g,''); }
async function getMonthlyPlanningPublication(monthValue,{force=false}={}){
  const key=planningPublicationDocId(monthValue);
  if(!force&&qgPlanningState.publications.has(key)) return qgPlanningState.publications.get(key);
  const snap=await getDoc(docRef('planningPublications',key)).catch(()=>null);
  const value=snap?.exists?.()?{id:snap.id,...snap.data()}:{id:key,status:'individual',month:key,version:0};
  qgPlanningState.publications.set(key,value);
  return value;
}
async function batchUpdateMissionDocuments(rows,buildPayload){
  for(let offset=0;offset<rows.length;offset+=400){
    const batch=writeBatch(db);
    rows.slice(offset,offset+400).forEach(row=>batch.update(docRef('missions',row.id),buildPayload(row)));
    await batch.commit();
  }
}
function monthlyPlanningSignature(missions){
  const rows=(missions||[]).filter(m=>m.status!=='cancelled'&&!missionIsDraft(m)).slice().sort((a,b)=>String(a.id).localeCompare(String(b.id)));
  const raw=rows.map(m=>`${m.id}:${missionRevision(m)}:${m.status||'planned'}`).join('|');
  return `${rows.length}:${Math.abs(hashCode(raw))}`;
}
function planningAcknowledgementRef(agentId,monthValue){
  return doc(db,'planningAcknowledgements',String(agentId),'months',planningPublicationDocId(monthValue));
}

function missionIsAcknowledged(mission){
  return Number(mission?.acknowledgedRevision || 0) >= missionRevision(mission) && !!mission?.acknowledgedAt;
}
function missionOverlapsRange(mission, start, end){
  const ms = timestampToDate(mission?.scheduledStart)?.getTime();
  const me = timestampToDate(mission?.scheduledEnd)?.getTime();
  return !!(ms && me && ms < end.getTime() && me > start.getTime());
}
function missionCanStartNow(mission){
  if (!mission || !['planned','assigned'].includes(mission.status || 'planned')) return false;
  const start = timestampToDate(mission.scheduledStart)?.getTime();
  const end = timestampToDate(mission.scheduledEnd)?.getTime();
  if (!start || !end) return false;
  const now = Date.now();
  return now >= start - 2*60*60*1000 && now <= end + 60*60*1000;
}
function agentSiteAddress(site){
  return [site?.address, site?.postalCode, site?.city].filter(Boolean).join(', ');
}
function mapsUrl(address){
  return address ? `https://maps.apple.com/?q=${encodeURIComponent(address)}` : '';
}
function agentPlanningMissionCard(mission, sitesById){
  const site = sitesById.get(mission.siteId) || {};
  const color = normalizeHexColor(mission.siteColor) || normalizeHexColor(site.planningColor) || '#64D0FF';
  const acknowledged = missionIsAcknowledged(mission);
  const address = agentSiteAddress(site);
  const minutes = missionDurationMinutes(mission);
  const cancelled = mission.status === 'cancelled';
  return `<article class="agent-plan-mission ${acknowledged?'read':'unread'} ${cancelled?'cancelled':''}" style="--mission-color:${color}">
    <div class="agent-plan-color"></div>
    <div class="agent-plan-main">
      <div class="agent-plan-title"><strong>${safe(mission.siteNom || site.name || 'Site')}</strong><span class="pill ${missionStatusColor(mission.status)}">${safe(missionStatusLabel(mission.status))}</span>${!acknowledged && !cancelled?'<span class="pill orange">Nouveau</span>':''}</div>
      <div class="agent-plan-time">${safe(dateOnlyText(mission.scheduledStart))} · ${safe(timeOnlyText(mission.scheduledStart))} → ${safe(timeOnlyText(mission.scheduledEnd))} · ${safe(hoursText(minutes))}</div>
      <div class="agent-plan-meta">${safe(mission.type || 'Mission')}${address?` · ${safe(address)}`:''}</div>
    </div>
    <div class="agent-plan-actions"><button class="btn small primary" data-agent-mission-open="${safe(mission.id)}">Détails</button>${!acknowledged && !cancelled?`<button class="btn small success" data-agent-mission-ack="${safe(mission.id)}">J’ai pris connaissance</button>`:''}${missionCanStartNow(mission)?`<button class="btn small" data-agent-mission-start="${safe(mission.id)}">Prendre poste</button>`:''}</div>
  </article>`;
}
function agentPlanningCalendarHtml(missions, sitesById, monthValue){
  const {start,days} = monthRange(monthValue);
  const leading = (start.getDay()+6)%7;
  const cells = [];
  for(let i=0;i<leading;i++) cells.push('<div class="agent-month-cell empty-cell"></div>');
  for(let day=1;day<=days;day++){
    const date = new Date(start.getFullYear(), start.getMonth(), day);
    const dayStart = startOfDay(date), dayEnd = addDays(dayStart,1);
    const dayMissions = missions.filter(m=>missionOverlapsRange(m,dayStart,dayEnd)).sort((a,b)=>(missionStartMs(a)||0)-(missionStartMs(b)||0));
    const chips = dayMissions.slice(0,3).map(m=>{
      const site = sitesById.get(m.siteId)||{};
      const color = normalizeHexColor(m.siteColor)||normalizeHexColor(site.planningColor)||'#64D0FF';
      return `<button class="agent-month-chip" style="--mission-color:${color}" data-agent-mission-open="${safe(m.id)}"><strong>${safe(timeOnlyText(m.scheduledStart))}</strong><span>${safe(m.siteNom||site.name||'Site')}</span></button>`;
    }).join('');
    cells.push(`<div class="agent-month-cell ${isToday(date)?'today':''}"><div class="agent-month-day"><strong>${day}</strong><span>${safe(date.toLocaleDateString('fr-FR',{weekday:'short'}).replace('.',''))}</span></div>${chips}${dayMissions.length>3?`<button class="agent-month-more" data-agent-day-open="${date.toISOString().slice(0,10)}">+${dayMissions.length-3}</button>`:''}</div>`);
  }
  return `<div class="agent-month-weekdays">${['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'].map(x=>`<span>${x}</span>`).join('')}</div><div class="agent-month-grid">${cells.join('')}</div>`;
}
function agentPlanningListHtml(missions, sitesById, monthValue){
  const {start,end} = monthRange(monthValue);
  const rows = missions.filter(m=>missionOverlapsRange(m,start,end)).sort((a,b)=>(missionStartMs(a)||0)-(missionStartMs(b)||0));
  if(!rows.length) return '<div class="empty">Aucune mission sur ce mois.</div>';
  const groups = new Map();
  rows.forEach(m=>{
    const d=timestampToDate(m.scheduledStart); const key=d?d.toISOString().slice(0,10):'sans-date';
    if(!groups.has(key)) groups.set(key,[]); groups.get(key).push(m);
  });
  return [...groups.entries()].map(([key,list])=>{
    const d=key==='sans-date'?null:new Date(`${key}T12:00:00`);
    return `<section class="agent-plan-day"><h3>${d?safe(d.toLocaleDateString('fr-FR',{weekday:'long',day:'numeric',month:'long'})):'Date inconnue'}</h3>${list.map(m=>agentPlanningMissionCard(m,sitesById)).join('')}</section>`;
  }).join('');
}
async function acknowledgeAgentMission(mission){
  if(!mission?.id || mission.agentId !== currentUser?.uid) return;
  await updateDoc(docRef('missions',mission.id),{
    acknowledgedAt:serverTimestamp(), acknowledgedBy:currentUser.uid,
    acknowledgedRevision:missionRevision(mission)
  });
  await addAudit('mission_acknowledged',{missionId:mission.id,revision:missionRevision(mission)});
  toast('Prise de connaissance enregistrée.','success');
}
function openAgentMissionDetail(mission, sitesById){
  const site=sitesById.get(mission.siteId)||{};
  const address=agentSiteAddress(site);
  const acknowledged=missionIsAcknowledged(mission);
  showModal('Détail de la mission',`<div class="mission-detail-panel agent-mission-detail">
    <div class="mission-detail-head"><div><h3>${safe(mission.siteNom||site.name||'Site')}</h3><p>${safe(mission.type||'Mission')} · ${safe(dateOnlyText(mission.scheduledStart))}</p></div><span class="pill ${missionStatusColor(mission.status)}">${safe(missionStatusLabel(mission.status))}</span></div>
    <div class="mission-detail-grid"><div><strong>Début</strong><span>${safe(dateText(mission.scheduledStart))}</span></div><div><strong>Fin</strong><span>${safe(dateText(mission.scheduledEnd))}</span></div><div><strong>Durée</strong><span>${safe(hoursText(missionDurationMinutes(mission)))}</span></div><div><strong>Lecture</strong><span>${acknowledged?'Confirmée':'À confirmer'}</span></div></div>
    ${address?`<div class="setup-box"><strong>Adresse :</strong><br>${safe(address)}</div>`:''}
    <div class="setup-box"><strong>Consignes :</strong><br>${safe(mission.instructions||site.instructions||'Aucune consigne particulière.').replace(/\n/g,'<br>')}</div>
    <div class="grid cols-2">${address?`<a class="btn" target="_blank" rel="noopener" href="${safe(mapsUrl(address))}">Ouvrir dans Plans</a>`:''}${site.emergencyContact?`<a class="btn danger" href="tel:${safe(site.emergencyContact)}">Appeler l’urgence site</a>`:''}${!acknowledged && mission.status!=='cancelled'?`<button class="btn success" id="agent-detail-ack">J’ai pris connaissance</button>`:''}${missionCanStartNow(mission)?`<button class="btn primary" id="agent-detail-start">Prendre poste</button>`:''}</div>
  </div>`,'wide');
  document.querySelector('#agent-detail-ack')?.addEventListener('click',async()=>{await acknowledgeAgentMission(mission);closeModal();});
  document.querySelector('#agent-detail-start')?.addEventListener('click',()=>{pendingMissionSelectionId=mission.id;closeModal();navigate('home');});
}

const DEFAULT_BADGE_COMPANY = {
  name:'AZZERA PROTECT',
  address:'131 Avenue de Verdun',
  postalCity:'83600 Fréjus',
  phone:'04.65.84.08.98',
  cnaps:'AUT-083-2123-05-14-20240931815',
  legalNotice:"Article L612-14 - Code de la sécurité intérieure : L’autorisation d’exercice ne confère aucune prérogative de puissance publique à l’entreprise ou aux personnes qui en bénéficient."
};
function agentFullName(agent={}){ return `${agent.prenom || ''} ${agent.nom || ''}`.trim() || agent.email || 'Agent'; }
function agentInitials(agent={}){ return String(agentFullName(agent)).split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join('').toUpperCase() || 'AG'; }
function badgeDate(value){ if(!value) return '—'; const d = value?.toDate ? value.toDate() : new Date(value); return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString('fr-FR'); }
function badgeLine(value){ return safe(value || '—'); }
function badgeProfessionalCard(agent={}){ return agent.professionalCard || agent.professionalCardNumber || agent.cnapsCardNumber || '—'; }
function badgeActivities(agent={}){ return agent.authorizedActivities || agent.securityActivity || 'Surveillance humaine ou gardiennage'; }
function badgeCompany(agent={}){
  return {
    name: agent.badgeCompanyName || DEFAULT_BADGE_COMPANY.name,
    address: agent.badgeCompanyAddress || DEFAULT_BADGE_COMPANY.address,
    postalCity: agent.badgeCompanyPostalCity || DEFAULT_BADGE_COMPANY.postalCity,
    phone: agent.badgeCompanyPhone || DEFAULT_BADGE_COMPANY.phone,
    cnaps: agent.badgeCompanyCnapsAuthorization || DEFAULT_BADGE_COMPANY.cnaps,
    legalNotice: agent.badgeCompanyLegalNotice || DEFAULT_BADGE_COMPANY.legalNotice
  };
}
function badgePhoto(agent={}){
  const src = agent.badgePhotoDataUrl || agent.photoDataUrl || '';
  if (src) return `<img src="${safe(src)}" alt="Photo agent">`;
  return `<div class="agent-badge-photo-placeholder">${safe(agentInitials(agent))}</div>`;
}
function splitBadgeList(value){ return String(value || '').split(/[\n,;]+/).map(x=>x.trim()).filter(Boolean); }
function badgeCardHtml(agent={}, options={}){
  const company = badgeCompany(agent);
  const activities = splitBadgeList(badgeActivities(agent));
  const specialties = splitBadgeList(agent.specialties || agent.qualifications || '');
  return `<article class="agent-badge-shell ${options.print?'print-mode':''}">
    <section class="agent-badge-card recto">
      <div class="agent-badge-top"><img src="assets/logo.png" alt="Azzera Protect"><div><strong>${badgeLine(company.name)}</strong><span>${badgeLine(company.address)}</span><span>${badgeLine(company.postalCity)}</span><span>${badgeLine(company.phone)}</span></div></div>
      <div class="agent-badge-middle"><div class="agent-badge-data"><p><strong>Nom :</strong> ${badgeLine(agent.nom)}</p><p><strong>Prénom :</strong> ${badgeLine(agent.prenom)}</p><p><strong>Né(e) le :</strong> ${safe(badgeDate(agent.birthDate))}${agent.birthPlace?` · ${badgeLine(agent.birthPlace)}`:''}</p><p><strong>N° carte pro :</strong> ${badgeLine(badgeProfessionalCard(agent))}</p>${agent.professionalCardExpiryDate?`<p><strong>Expiration :</strong> ${safe(badgeDate(agent.professionalCardExpiryDate))}</p>`:''}</div><figure class="agent-badge-photo">${badgePhoto(agent)}</figure></div>
      <div class="agent-badge-legal">${safe(company.legalNotice)}</div>
    </section>
    <section class="agent-badge-card verso">
      <div class="agent-badge-top"><img src="assets/logo.png" alt="Azzera Protect"><div><strong>${badgeLine(company.name)}</strong><span>${badgeLine(company.address)}</span><span>${badgeLine(company.postalCity)}</span><span>${badgeLine(company.phone)}</span></div></div>
      <div class="agent-badge-verso-grid"><div><p><strong>Matricule :</strong> ${badgeLine(agent.matricule || agent.badgeNumber)}</p><p><strong>Badge interne :</strong> ${badgeLine(agent.badgeNumber || agent.matricule)}</p><p><strong>NUB :</strong> ${badgeLine(agent.nub)}</p></div><div><p><strong>Activité(s) autorisée(s) :</strong></p><ul>${(activities.length?activities:['Surveillance humaine']).map(x=>`<li>${safe(x)}</li>`).join('')}</ul></div></div>
      <div class="agent-badge-specialties"><strong>Spécialité(s) / qualification(s)</strong><ul>${(specialties.length?specialties:['Agent de sécurité']).map(x=>`<li>${safe(x)}</li>`).join('')}</ul></div>
      <div class="agent-badge-footer"><strong>${badgeLine(company.name)}</strong><span>${badgeLine(company.cnaps)}</span></div>
    </section>
  </article>`;
}
async function renderAgentBadge(){
  currentRoute = 'badge';
  const body = `<section class="card agent-badge-page"><div class="card-title"><div><h2>Mon badge</h2><p>Carte professionnelle employeur consultable même en intervention</p></div><div class="btn-row"><button class="btn small" id="agent-badge-pdf">PDF</button><button class="btn small" id="agent-badge-print">Imprimer</button></div></div><div class="setup-box">Cette carte opérationnelle complète le titre CNAPS dématérialisé. Elle ne remplace pas les vérifications réglementaires de l’employeur.</div><div id="agent-badge-preview">${badgeCardHtml(currentProfile || {})}</div></section>`;
  render(page('Mon badge','Carte professionnelle employeur',body));
  const redraw = agent => {
    const box = document.querySelector('#agent-badge-preview');
    if (box) box.innerHTML = badgeCardHtml(agent || currentProfile || {});
    const oldPdfBtn = document.querySelector('#agent-badge-pdf');
    const oldPrintBtn = document.querySelector('#agent-badge-print');
    if (oldPdfBtn) oldPdfBtn.replaceWith(oldPdfBtn.cloneNode(true));
    if (oldPrintBtn) oldPrintBtn.replaceWith(oldPrintBtn.cloneNode(true));
    document.querySelector('#agent-badge-pdf')?.addEventListener('click',()=>downloadAgentBadgePdf(agent || currentProfile || {}));
    document.querySelector('#agent-badge-print')?.addEventListener('click',()=>printAgentBadge(agent || currentProfile || {}));
  };
  redraw(currentProfile);
  unsubscribeList.push(onSnapshot(docRef('users', currentUser.uid), snap=>{
    if(!snap.exists()) return;
    currentProfile = { uid:currentUser.uid, id:currentUser.uid, ...snap.data() };
    saveOfflineProfile(currentProfile);
    redraw(currentProfile);
  },()=>{}));
}
function openAgentBadgePreview(agent){
  if(!agent) return;
  showModal(`Badge · ${agentFullName(agent)}`, `<div class="agent-badge-modal"><div class="setup-box">Aperçu recto-verso de la carte employeur. La photo et les informations CNAPS se modifient depuis la fiche agent.</div><div id="qg-agent-badge-preview">${badgeCardHtml(agent)}</div><div class="btn-row"><button class="btn primary" id="qg-agent-badge-pdf">Télécharger PDF</button><button class="btn" id="qg-agent-badge-print">Imprimer</button><button class="btn ghost" id="qg-agent-badge-edit">Modifier la fiche</button></div></div>`, 'wide');
  document.querySelector('#qg-agent-badge-pdf')?.addEventListener('click',()=>downloadAgentBadgePdf(agent));
  document.querySelector('#qg-agent-badge-print')?.addEventListener('click',()=>printAgentBadge(agent));
  document.querySelector('#qg-agent-badge-edit')?.addEventListener('click',()=>{ closeModal(); showAgentForm(agent); });
}
function printAgentBadge(agent){
  document.querySelector('#print-root')?.remove();
  const root=document.createElement('div');
  root.id='print-root';
  root.className='print-root agent-badge-print-root';
  root.innerHTML=`<div class="agent-badge-print-page">${badgeCardHtml(agent,{print:true})}</div>`;
  document.body.appendChild(root);
  toast('Badge prêt. Choisis Imprimer puis Enregistrer en PDF si besoin.','success');
  window.addEventListener('afterprint',()=>setTimeout(()=>root.remove(),400),{once:true});
  setTimeout(()=>window.print(),220);
  setTimeout(()=>root.remove(),15000);
}
function badgePdfList(doc, items, x, y, maxWidth=78){
  const lines = (items.length?items:['—']).slice(0,6).flatMap(item=>doc.splitTextToSize(`• ${item}`, maxWidth));
  lines.forEach(line=>{ doc.text(line, x, y); y += 4.3; });
  return y;
}
function downloadAgentBadgePdf(agent){
  try{
    const jsPDF=getJsPDF(); if(!jsPDF) throw new Error('Bibliothèque PDF indisponible.');
    const C=AZZERA_DOC_BRAND;
    const doc=new jsPDF({unit:'mm',format:'a4',orientation:'portrait'});
    const company=badgeCompany(agent);
    const card=(x,y)=>{ doc.setDrawColor(20,28,37); doc.setLineWidth(.45); doc.rect(x,y,180,74); doc.setFillColor(244,248,251); doc.rect(x,y+22,180,52,'F'); };
    doc.setProperties({title:`Badge ${agentFullName(agent)}`,subject:'Carte professionnelle employeur',author:'AZZERA PROTECT · Sentinelle Pro'});
    doc.setFont('helvetica','bold'); doc.setFontSize(16); doc.setTextColor(...C.obsidian); doc.text('Carte professionnelle employeur',15,15);
    card(15,24); pdfDrawLogo(doc,25,31,18,16); doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.setTextColor(...C.obsidian); doc.text(company.name,55,34); doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.text(company.address,55,40); doc.text(company.postalCity,55,45); doc.text(company.phone,55,50);
    if(agent.badgePhotoDataUrl){ try{ doc.addImage(agent.badgePhotoDataUrl, 'JPEG', 150, 35, 35, 43, undefined, 'FAST'); }catch(_){} } else { doc.setDrawColor(190); doc.rect(150,35,35,43); doc.setFont('helvetica','bold'); doc.setFontSize(14); doc.text(agentInitials(agent),167.5,58,{align:'center'}); }
    doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.text('Nom :',25,62); doc.text('Prénom :',25,68); doc.text('Né(e) le :',25,74); doc.text('N° carte pro :',25,80); doc.setFont('helvetica','normal'); doc.text(String(agent.nom||'—'),50,62); doc.text(String(agent.prenom||'—'),50,68); doc.text(`${badgeDate(agent.birthDate)}${agent.birthPlace?` · ${agent.birthPlace}`:''}`,50,74); doc.text(String(badgeProfessionalCard(agent)),50,80);
    doc.setFontSize(6.7); doc.setTextColor(...C.grey); doc.text(doc.splitTextToSize(company.legalNotice,160),25,92);
    card(15,112); pdfDrawLogo(doc,25,119,18,16); doc.setTextColor(...C.obsidian); doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.text(company.name,55,122); doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.text(company.address,55,128); doc.text(company.postalCity,55,133); doc.text(company.phone,55,138);
    doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.text('Matricule :',25,153); doc.text('NUB :',25,159); doc.text('Expiration :',25,165); doc.setFont('helvetica','normal'); doc.text(String(agent.matricule||agent.badgeNumber||'—'),52,153); doc.text(String(agent.nub||'—'),52,159); doc.text(badgeDate(agent.professionalCardExpiryDate),52,165);
    doc.setFont('helvetica','bold'); doc.text('Activité(s) autorisée(s)',105,153); doc.setFont('helvetica','normal'); badgePdfList(doc, splitBadgeList(badgeActivities(agent)), 105, 159, 78);
    doc.setFont('helvetica','bold'); doc.text('Spécialité(s)',105,177); doc.setFont('helvetica','normal'); badgePdfList(doc, splitBadgeList(agent.specialties || agent.qualifications || 'Agent de sécurité'), 105, 183, 78);
    doc.setFont('helvetica','bold'); doc.setFontSize(8); doc.text(company.name,25,198); doc.text(company.cnaps,25,204);
    pdfAddFooter(doc);
    doc.save(documentSlug(`badge-${agentFullName(agent)}`,'pdf'));
    toast('Badge PDF téléchargé.','success');
  }catch(error){ console.error(error); toast(userFriendlyError(error,'PDF badge impossible.'),'error'); }
}

async function renderAgentPlanning(){
  currentRoute='planning';
  const monthValue=localMonthValue();
  const body=`<section class="card agent-planning-card">
    <div class="card-title"><div><h2>Mon planning</h2><p>Missions, horaires, consignes et prise de connaissance</p></div><button class="btn small" id="agent-planning-download">PDF mensuel</button></div>
    <div class="agent-planning-toolbar"><div class="segmented"><button class="active" data-agent-plan-view="list">Liste</button><button data-agent-plan-view="month">Mois</button></div><div class="field compact-field"><label>Mois</label><input class="input" id="agent-planning-month" type="month" value="${monthValue}"></div></div>
    <div id="agent-monthly-ack" class="agent-monthly-ack"></div>
    <div id="agent-planning-summary" class="mission-kpis"></div>
    <div id="agent-planning-content"><div class="empty">Chargement du planning...</div></div>
  </section>`;
  render(page('Mon planning','Uniquement tes missions personnelles',body));
  const state={missions:[],sitesById:new Map(),view:'list',month:monthValue,monthlyAck:null};
  const sitesSnap=await getDocs(collectionRef('sites')).catch(()=>({docs:[]}));
  state.sitesById=new Map(sitesSnap.docs.map(d=>[d.id,{id:d.id,...d.data()}]));
  const redraw=()=>{
    const range=monthRange(state.month);
    const monthMissions=state.missions.filter(m=>missionOverlapsRange(m,range.start,range.end));
    const active=monthMissions.filter(m=>m.status!=='cancelled');
    const minutes=active.reduce((sum,m)=>sum+missionDurationMinutes(m),0);
    const unread=active.filter(m=>!missionIsAcknowledged(m)).length;
    const sites=new Set(active.map(m=>m.siteId).filter(Boolean)).size;
    const summary=document.querySelector('#agent-planning-summary');
    if(summary) summary.innerHTML=`<div class="mini-kpi"><strong>${active.length}</strong><span>Missions</span></div><div class="mini-kpi blue"><strong>${safe(hoursText(minutes))}</strong><span>Heures prévues</span></div><div class="mini-kpi green"><strong>${sites}</strong><span>Sites</span></div><div class="mini-kpi ${unread?'orange':'green'}"><strong>${unread}</strong><span>À confirmer</span></div>`;
    const box=document.querySelector('#agent-planning-content');
    if(box) box.innerHTML=state.view==='month'?agentPlanningCalendarHtml(state.missions,state.sitesById,state.month):agentPlanningListHtml(state.missions,state.sitesById,state.month);
    bindAgentPlanningActions(state);
    renderAgentMonthlyAcknowledgement(state);
  };
  document.querySelectorAll('[data-agent-plan-view]').forEach(btn=>btn.addEventListener('click',()=>{state.view=btn.dataset.agentPlanView;document.querySelectorAll('[data-agent-plan-view]').forEach(b=>b.classList.toggle('active',b===btn));redraw();}));
  document.querySelector('#agent-planning-month')?.addEventListener('change',async e=>{state.month=e.target.value||localMonthValue();state.monthlyAck=null;redraw();await loadAgentMonthlyAcknowledgement(state);});
  document.querySelector('#agent-planning-download')?.addEventListener('click',()=>downloadCollaboratorPlanningPdf(currentUser.uid,state.month,{agentView:true}));
  const q=query(collectionRef('missions'),where('agentId','==',currentUser.uid));
  unsubscribeList.push(onSnapshot(q,async snap=>{state.missions=snap.docs.map(d=>({id:d.id,...d.data()})).filter(m=>!missionIsDraft(m)).sort((a,b)=>(missionStartMs(a)||0)-(missionStartMs(b)||0));redraw();await loadAgentMonthlyAcknowledgement(state);},()=>{const box=document.querySelector('#agent-planning-content');if(box)box.innerHTML='<div class="empty error">Planning indisponible.</div>';}));
}
async function loadAgentMonthlyAcknowledgement(state){
  if(!currentUser?.uid||!state?.month) return;
  const snap=await getDoc(planningAcknowledgementRef(currentUser.uid,state.month)).catch(()=>null);
  state.monthlyAck=snap?.exists?.()?{id:snap.id,...snap.data()}:null;
  renderAgentMonthlyAcknowledgement(state);
}
function renderAgentMonthlyAcknowledgement(state){
  const box=document.querySelector('#agent-monthly-ack');
  if(!box) return;
  const range=monthRange(state.month);
  const missions=state.missions.filter(m=>m.monthlyPlanning===true&&m.status!=='cancelled'&&missionOverlapsRange(m,range.start,range.end));
  if(!missions.length){box.innerHTML='';return;}
  const signature=monthlyPlanningSignature(missions);
  const confirmed=state.monthlyAck?.signature===signature;
  const label=range.label.charAt(0).toUpperCase()+range.label.slice(1);
  if(confirmed){
    box.innerHTML=`<div class="agent-monthly-ack-copy"><span class="pill green">Planning confirmé</span><div><strong>${safe(label)}</strong><p>Prise de connaissance enregistrée le ${safe(dateText(state.monthlyAck.confirmedAt))}.</p></div></div>`;
    return;
  }
  box.innerHTML=`<div class="agent-monthly-ack-copy"><span class="pill orange">À confirmer</span><div><strong>${safe(label)} · ${missions.length} mission${missions.length>1?'s':''}</strong><p>Consulte les horaires et les consignes, puis confirme la prise de connaissance du mois.</p></div></div><button class="btn success" id="agent-confirm-monthly-planning">J’ai pris connaissance du planning</button>`;
  document.querySelector('#agent-confirm-monthly-planning')?.addEventListener('click',()=>acknowledgeMonthlyPlanning(state));
}
async function acknowledgeMonthlyPlanning(state){
  const range=monthRange(state.month);
  const missions=state.missions.filter(m=>m.monthlyPlanning===true&&m.status!=='cancelled'&&missionOverlapsRange(m,range.start,range.end));
  if(!missions.length) return toast('Aucune mission à confirmer.','warning');
  const button=document.querySelector('#agent-confirm-monthly-planning'); if(button) button.disabled=true;
  try{
    await batchUpdateMissionDocuments(missions,m=>({acknowledgedAt:serverTimestamp(),acknowledgedBy:currentUser.uid,acknowledgedRevision:missionRevision(m),updatedAt:serverTimestamp(),updatedBy:currentUser.uid}));
    const signature=monthlyPlanningSignature(missions);
    await setDoc(planningAcknowledgementRef(currentUser.uid,state.month),{agentId:currentUser.uid,month:state.month,signature,missionCount:missions.length,confirmedAt:serverTimestamp(),updatedAt:serverTimestamp()},{merge:true});
    await addAudit('monthly_planning_acknowledged',{month:state.month,missionCount:missions.length,signature});
    toast('Prise de connaissance du planning enregistrée.','success');
    await loadAgentMonthlyAcknowledgement(state);
  }catch(error){console.error(error);toast(userFriendlyError(error,'Confirmation du planning impossible.'),'error');if(button)button.disabled=false;}
}

function bindAgentPlanningActions(state){
  document.querySelectorAll('[data-agent-mission-open]').forEach(btn=>btn.addEventListener('click',()=>{const m=state.missions.find(x=>x.id===btn.dataset.agentMissionOpen);if(m)openAgentMissionDetail(m,state.sitesById);}));
  document.querySelectorAll('[data-agent-mission-ack]').forEach(btn=>btn.addEventListener('click',async()=>{const m=state.missions.find(x=>x.id===btn.dataset.agentMissionAck);if(m)await acknowledgeAgentMission(m);}));
  document.querySelectorAll('[data-agent-mission-start]').forEach(btn=>btn.addEventListener('click',()=>{pendingMissionSelectionId=btn.dataset.agentMissionStart;navigate('home');}));
  document.querySelectorAll('[data-agent-day-open]').forEach(btn=>btn.addEventListener('click',()=>{state.view='list';document.querySelectorAll('[data-agent-plan-view]').forEach(b=>b.classList.toggle('active',b.dataset.agentPlanView==='list'));const month=document.querySelector('#agent-planning-content');if(month)month.innerHTML=agentPlanningListHtml(state.missions.filter(m=>dateOnlyKey(m.scheduledStart)===btn.dataset.agentDayOpen),state.sitesById,state.month);bindAgentPlanningActions(state);}));
}
function dateOnlyKey(value){ const d=timestampToDate(value); return d?`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`:''; }

async function renderAgentHome(){
  currentRoute = 'home';
  const shift = await findActiveShift().catch(() => activeShiftCache || null);
  activeShiftCache = shift;
  const isWorking = !!shift;
  const body = `
    <section class="grid cols-3">
      <div class="card stat ${isWorking?'green':'orange'}"><div class="stat-label">Statut agent</div><div class="stat-value">${isWorking?'En poste':'Hors poste'}</div><div class="muted">${safe(currentProfile.prenom || '')} ${safe(currentProfile.nom || '')}</div></div>
      <div class="card stat blue"><div class="stat-label">Mission / site</div><div class="stat-value" style="font-size:22px">${safe(shift?.siteNom || 'Aucune')}</div><div class="muted">${isWorking ? 'Mission active' : 'Mission à sélectionner'}</div></div>
      <div class="card stat ${navigator.onLine?'green':'orange'}"><div class="stat-label">Réseau</div><div class="stat-value">${navigator.onLine?'OK':'OFF'}</div><div class="muted">${navigator.onLine?'Synchronisation active':'Données locales actives'}</div></div>
    </section>
    <section class="card quick-actions-card" style="margin-top:16px">
      <div class="card-title"><div><h2>Actions rapides</h2><p>Les fonctions terrain essentielles, accessibles sans défilement</p></div></div>
      <div class="quick-action-bubbles">
        <button class="quick-action-bubble primary" data-route="planning"><span class="quick-action-icon">◷</span><strong>Planning</strong><small>Mes missions</small></button>
        <button class="quick-action-bubble" data-route="mci"><span class="quick-action-icon">▤</span><strong>Main courante</strong><small>Déclarer un événement</small></button>
        <button class="quick-action-bubble" data-route="round"><span class="quick-action-icon">◎</span><strong>Ronde</strong><small>Scanner un point</small></button>
        <button class="quick-action-bubble" data-route="docs"><span class="quick-action-icon">▣</span><strong>Documents</strong><small>Consignes du site</small></button>
        <button class="quick-action-bubble warning" data-route="flash"><span class="quick-action-icon">⚡</span><strong>Flash QG</strong><small>Messages prioritaires</small></button>
        <button class="quick-action-bubble" id="whatsapp-qg"><span class="quick-action-icon">◉</span><strong>WhatsApp QG</strong><small>Canal non critique</small></button>
      </div>
      <div class="quick-actions-footer"><button class="btn full" id="enable-push">Activer les notifications écran verrouillé</button><p class="muted">En urgence, utiliser le bouton SOS/PTI.</p></div>
    </section>
    <section class="card offline-ready-card ${navigator.onLine?'':'offline-active'}" style="margin-top:16px">
      <div class="card-title"><div><h2>Mode hors ligne</h2><p id="offline-ready-status">${safe(offlineReadyText())}</p></div>${navigator.onLine?'<button class="btn small" id="offline-sync-now">Synchroniser maintenant</button>':'<span class="pill orange">Hors ligne</span>'}</div>
      <div class="setup-box ${navigator.onLine?'':'warning-copy'}">${navigator.onLine?'Cache local de confort préparé. Le hors-ligne complet Supabase reste à valider avant la bascule production.':'V5.8.7.1 staging : les écritures Supabase ne sont pas encore garanties hors ligne. Une alerte PTI hors ligne ne peut pas prévenir le QG immédiatement : appelle le QG ou le 112.'}</div>
    </section>
    <section class="card" style="margin-top:16px">
      <div class="card-title"><div><h2>${isWorking?'Poste en cours':'Prise de poste'}</h2><p>${isWorking?'Résumé, relève et clôture':'Mission planifiée ou prise de poste libre'}</p></div></div>
      ${isWorking ? shiftSummary(shift) + `<div id="agent-handover-card" class="handover-box"><div class="empty">Chargement de la relève...</div></div><button class="btn danger full end-shift-main-btn" id="end-shift-btn">Terminer ma mission</button>` : takeShiftForm()}
    </section>
    <section class="card" style="margin-top:16px">
      <div class="card-title"><div><h2>Derniers rapports envoyés</h2><p>Flux personnel</p></div></div>
      <div id="agent-recent-reports" class="timeline"><div class="empty">Chargement...</div></div>
    </section>`;
  render(page('Accueil Agent', 'Exécution terrain rapide et sécurisée', body));
  bindAgentHome(shift);
  document.querySelector('#offline-sync-now')?.addEventListener('click', async event => {
    const button = event.currentTarget; button.disabled = true; button.textContent = 'Synchronisation…';
    await primeAgentOfflineData().catch(() => {});
    button.textContent = 'Synchronisé'; setTimeout(() => { if (button.isConnected) { button.disabled=false; button.textContent='Synchroniser maintenant'; } }, 1200);
  });
  if (shift) loadAgentHandoverCard(shift);
  listenAgentRecentReports();
}

function shiftSummary(shift){
  const score = typeof shift.conformityScore === 'number' ? `<span class="pill ${shift.conformityScore < 70 ? 'red' : shift.conformityScore < 90 ? 'orange' : 'green'}">Conformité ${shift.conformityScore}%</span>` : '';
  const planned = shift.scheduledStart ? `<div><span>Mission prévue</span><strong>${dateText(shift.scheduledStart)} → ${dateText(shift.scheduledEnd)}</strong></div>` : '';
  return `<div class="shift-live-card">
    <div class="shift-live-head"><div><span class="shift-eyebrow">POSTE ACTIF</span><h3>${safe(shift.siteNom)}</h3></div><div class="shift-live-badges"><span class="pill green">En poste</span>${score}</div></div>
    <div class="shift-live-grid">
      <div><span>Prise de poste</span><strong>${dateText(shift.startTime)}</strong></div>
      <div><span>Durée en poste</span><strong id="shift-elapsed">${elapsedShiftText(shift.startTime)}</strong></div>
      <div><span>Type</span><strong>${safe(shift.shiftType || 'Mission')}</strong></div>
      <div><span>Preuve photo</span><strong>${shift.checkInPhotoAvailable ? 'Enregistrée' : 'Non disponible'}</strong></div>
      ${planned}
    </div>
  </div>`;
}
function takeShiftForm(){
  return `<form id="take-shift-form" class="take-shift-flow">
    <section class="shift-step">
      <div class="shift-step-head"><span class="shift-step-number">1</span><div><h3>Choisir la mission</h3><p>La mission planifiée sélectionne automatiquement le site.</p></div></div>
      <div class="field"><label>Mission planifiée</label><select class="select" name="missionId" id="mission-select"><option value="">Chargement des missions...</option></select></div>
      <div class="field"><label>Site</label><select class="select" name="siteId" id="site-select" required><option value="">Chargement des sites...</option></select></div>
    </section>
    <section class="shift-step">
      <div class="shift-step-head"><span class="shift-step-number">2</span><div><h3>Lire les consignes</h3><p>Les informations critiques du site sont mises en avant.</p></div></div>
      <div id="site-info" class="empty">Sélectionne une mission ou un site pour afficher les consignes.</div>
    </section>
    <section class="shift-step camera-checkin">
      <div class="shift-step-head"><span class="shift-step-number">3</span><div><h3>Photo de prise de poste</h3><p>Prends une photo du poste, de l’accès principal ou de ta présence sur site.</p></div></div>
      <label class="camera-trigger" for="checkin-photo-input"><span>📷 Ouvrir l’appareil photo</span><small>Obligatoire pour démarrer la mission</small></label>
      <input id="checkin-photo-input" type="file" accept="image/*" capture="environment" hidden>
      <div id="checkin-photo-preview" class="camera-preview"><span>Aucune photo enregistrée</span></div>
      <div class="checkline camera-consent"><input type="checkbox" id="checkin-photo-confirm" disabled> <span>Je confirme que cette photo correspond à ma prise de poste actuelle.</span></div>
    </section>
    <button class="btn primary full shift-start-cta" id="take-shift-submit" type="submit" disabled>Démarrer ma mission</button>
  </form>`;
}
async function bindAgentHome(shift){
  document.querySelectorAll('[data-route]').forEach(btn => btn.addEventListener('click', () => navigate(btn.dataset.route)));
  const whatsappBtn = document.querySelector('#whatsapp-qg');
  if (whatsappBtn) whatsappBtn.addEventListener('click', () => openWhatsapp(shift));
  document.querySelector('#enable-push')?.addEventListener('click', () => registerPushNotifications());
  if (!shift) {
    const [sites, missions] = await Promise.all([getActiveSites().catch(()=>[]), getAgentPlannedMissions().catch(()=>[])]);
    const select = document.querySelector('#site-select');
    const missionSelect = document.querySelector('#mission-select');
    const photoInput = document.querySelector('#checkin-photo-input');
    const photoPreview = document.querySelector('#checkin-photo-preview');
    const photoConfirm = document.querySelector('#checkin-photo-confirm');
    const submitButton = document.querySelector('#take-shift-submit');
    let checkInPhoto = null;
    const selectedSite = () => {
      const mission = missions.find(m => m.id === missionSelect?.value) || null;
      return sites.find(s => s.id === (mission?.siteId || select?.value)) || null;
    };
    const syncSubmitState = () => {
      if (!submitButton) return;
      submitButton.disabled = !(selectedSite() && checkInPhoto && photoConfirm?.checked);
    };
    if (select) select.innerHTML = `<option value="">Choisir un site</option>` + sites.map(s => `<option value="${safe(s.id)}">${safe(s.name)}</option>`).join('');
    if (missionSelect) {
      missionSelect.innerHTML = `<option value="">Prise de poste libre</option>` + missions.map(m => `<option value="${safe(m.id)}">${safe(m.siteNom || 'Site')} · ${dateText(m.scheduledStart)}</option>`).join('');
      missionSelect.addEventListener('change', () => {
        const m = missions.find(x => x.id === missionSelect.value);
        if (m && select) select.value = m.siteId;
        renderTakeShiftInfo(sites.find(s => s.id === (m?.siteId || select?.value)), m);
        syncSubmitState();
      });
      if (pendingMissionSelectionId && missions.some(m => m.id === pendingMissionSelectionId)) {
        missionSelect.value = pendingMissionSelectionId;
        pendingMissionSelectionId = null;
        missionSelect.dispatchEvent(new Event('change'));
      }
    }
    if (select) select.addEventListener('change', () => {
      renderTakeShiftInfo(sites.find(s => s.id === select.value), missions.find(m => m.id === missionSelect?.value));
      syncSubmitState();
    });
    photoInput?.addEventListener('change', async () => {
      const file = photoInput.files?.[0];
      if (!file) return;
      if (photoPreview) photoPreview.innerHTML = '<span>Compression et sécurisation de la photo...</span>';
      try {
        checkInPhoto = await compressCheckInPhoto(file);
        if (photoPreview) photoPreview.innerHTML = `<img src="${safe(checkInPhoto.dataUrl)}" alt="Preuve de prise de poste"><div><strong>Photo prête</strong><span>${Math.round(checkInPhoto.bytes / 1024)} Ko · ${checkInPhoto.width}×${checkInPhoto.height}</span></div>`;
        if (photoConfirm) { photoConfirm.disabled = false; photoConfirm.checked = true; }
        toast('Photo de prise de poste enregistrée.', 'success');
      } catch(error) {
        console.error(error);
        checkInPhoto = null;
        if (photoConfirm) { photoConfirm.disabled = true; photoConfirm.checked = false; }
        if (photoPreview) photoPreview.innerHTML = `<span>${safe(error.message || 'Photo impossible à traiter.')}</span>`;
        toast(error.message || 'Photo impossible à traiter.', 'error');
      }
      syncSubmitState();
    });
    photoConfirm?.addEventListener('change', syncSubmitState);
    const form = document.querySelector('#take-shift-form');
    form?.addEventListener('submit', async e => {
      e.preventDefault();
      if (!isOnline()) return toast('Réseau indisponible — prise de poste impossible.', 'error');
      const fd = new FormData(form);
      const mission = missions.find(m => m.id === fd.get('missionId')) || null;
      const site = sites.find(s => s.id === (mission?.siteId || fd.get('siteId')));
      if (!site) return toast('Sélectionne un site.', 'warning');
      if (!checkInPhoto || !photoConfirm?.checked) return toast('La photo de prise de poste est obligatoire.', 'warning');
      submitButton.disabled = true;
      submitButton.textContent = 'Prise de poste en cours...';
      await takeShift(site, mission, checkInPhoto);
    });
  } else {
    const refreshElapsed = () => {
      const elapsed = document.querySelector('#shift-elapsed');
      if (elapsed) elapsed.textContent = elapsedShiftText(shift.startTime);
    };
    refreshElapsed();
    const elapsedTimer = setInterval(refreshElapsed, 60000);
    unsubscribeList.push(() => clearInterval(elapsedTimer));
    document.querySelector('#end-shift-btn')?.addEventListener('click', () => endShift(shift));
  }
}
function renderTakeShiftInfo(site, mission){
  const box = document.querySelector('#site-info');
  if (!box) return;
  if (!site) return box.innerHTML = 'Sélectionne une mission ou un site pour afficher les consignes.';
  const late = mission && missionIsLate(mission) ? `<span class="pill red">Retard détecté</span>` : '';
  const instructions = safe(mission?.instructions || site.instructions || 'Aucune consigne renseignée.').replace(/\n/g, '<br>');
  box.innerHTML = `<article class="site-brief">
    <header class="site-brief-head"><div><span class="site-brief-label">SITE DE MISSION</span><h3>${safe(site.name)}</h3><p>${safe(site.clientName || 'Client non renseigné')}</p></div>${late}</header>
    <div class="site-facts">
      <div><span>Adresse</span><strong>${safe(site.address || '—')}</strong></div>
      <div><span>Contact d’urgence</span><strong>${safe(site.emergencyContact || '—')}</strong></div>
      <div><span>Horaire</span><strong>${mission ? `${dateText(mission.scheduledStart)} → ${dateText(mission.scheduledEnd)}` : 'Prise de poste libre'}</strong></div>
      <div><span>Type</span><strong>${safe(mission?.type || 'Mission libre')}</strong></div>
    </div>
    <section class="site-instructions"><span>CONSIGNES OPÉRATIONNELLES</span><p>${instructions}</p></section>
  </article>`;
}
async function takeShift(site, mission=null, checkInPhoto=null){
  let shiftDoc = null;
  try {
    const existing = await findActiveShift();
    if (existing) return toast('Un poste est déjà ouvert. Termine-le avant d’en ouvrir un autre.', 'warning');
    if (!checkInPhoto?.dataUrl) return toast('La photo de prise de poste est obligatoire.', 'warning');
    const gps = await getGPS({ enableHighAccuracy:true, timeout:12000, maximumAge:0 });
    const agentNom = `${currentProfile.prenom || ''} ${currentProfile.nom || ''}`.trim();
    shiftDoc = await addDoc(collectionRef('shifts'), {
      agentId: currentUser.uid, agentNom, siteId: site.id, siteNom: site.name,
      missionId: mission?.id || null, missionTitle: mission ? `${mission.siteNom || site.name} · ${dateText(mission.scheduledStart)}` : null,
      scheduledStart: mission?.scheduledStart || null, scheduledEnd: mission?.scheduledEnd || null, shiftType: mission?.type || 'Mission libre', missionInstructions: mission?.instructions || null,
      startTime: serverTimestamp(), positionGPS: gps, status:'active', handoverAcknowledged:false,
      checkInPhotoAvailable:true, checkInPhotoCapturedAt:checkInPhoto.capturedAt, checkInPhotoBytes:checkInPhoto.bytes,
      createdAt: serverTimestamp(), createdBy: currentUser.uid
    });
    try {
      await setDoc(docRef('shiftProofs', shiftDoc.id), {
        shiftId:shiftDoc.id, agentId:currentUser.uid, agentNom, siteId:site.id, siteNom:site.name,
        imageDataUrl:checkInPhoto.dataUrl, mimeType:checkInPhoto.mimeType, bytes:checkInPhoto.bytes,
        width:checkInPhoto.width, height:checkInPhoto.height, capturedAt:checkInPhoto.capturedAt,
        createdAt:serverTimestamp(), createdBy:currentUser.uid
      });
    } catch(proofError) {
      await deleteDoc(docRef('shifts', shiftDoc.id)).catch(()=>{});
      throw new Error('La preuve photo n’a pas pu être enregistrée dans Supabase Storage. Vérifie les RLS V5.8.7 puis réessaie.');
    }
    await addDoc(collectionRef('reports'), {
      agentId:currentUser.uid, agentNom, siteId:site.id, siteNom:site.name, shiftId:shiftDoc.id, missionId:mission?.id || null,
      category:'Prise de service', severity:'Normal', message:`Prise de poste confirmée sur ${site.name}. Photo de contrôle${gps ? ' et position GPS' : ''} enregistrée${gps ? 's' : ''}.`,
      photoProofAvailable:true, gps, status:'new', isLocked:true, systemGenerated:true, eventType:'shift_start',
      createdAt:serverTimestamp(), createdBy:currentUser.uid
    }).catch(error => console.warn('Rapport automatique de prise de poste non créé', error));
    if (mission?.id) await updateDoc(docRef('missions', mission.id), { status:'active', actualStart:serverTimestamp(), shiftId:shiftDoc.id, updatedAt:serverTimestamp(), updatedBy:currentUser.uid }).catch(()=>{});
    await updateDoc(docRef('users', currentUser.uid), { statut:'en_poste', siteActuel: site.id, siteActuelNom: site.name, lastSeen: serverTimestamp() });
    currentProfile = { ...currentProfile, statut:'en_poste', siteActuel:site.id, siteActuelNom:site.name };
    syncNativePushIdentity().catch(() => {});
    await addAudit('shift_start', { shiftId: shiftDoc.id, siteId: site.id, missionId: mission?.id || null, photoProof:true, gpsAvailable:!!gps });
    spNotifyQGShiftStarted({shiftId:shiftDoc.id,siteName:site.name,startedAt:new Date()}).then(result=>addAudit('qg_shift_start_notification',{shiftId:shiftDoc.id,pushStatus:result?.skipped?(result?.reason||'skipped'):result?.ok?'sent':result?.error||'failed'}).catch(()=>{})).catch(()=>{});
    toast('Prise de poste confirmée', 'success');
    renderAgentHome();
  } catch(error){
    console.error(error);
    toast(error.message || 'Erreur prise de poste. Vérifie les RLS Supabase.', 'error');
    renderAgentHome();
  }
}
async function loadAgentHandoverCard(shift){
  const box = document.querySelector('#agent-handover-card');
  if (!box) return;
  try {
    const snap = await getDocs(query(collectionRef('shifts'), where('siteId','==',shift.siteId), where('status','==','completed'), orderBy('completedAt','desc'), limit(4))).catch(async()=>getDocs(query(collectionRef('shifts'), where('siteId','==',shift.siteId), where('status','==','completed'), limit(4))));
    const prev = snap.docs.map(d => ({id:d.id,...d.data()})).filter(s => s.id !== shift.id).sort((a,b)=>(b.completedAt?.toDate?.()?.getTime()||0)-(a.completedAt?.toDate?.()?.getTime()||0))[0];
    if (!prev) return box.innerHTML = `<div class="item"><div class="item-main"><div class="item-title">Relève agent</div><div class="item-meta">Aucune mission précédente trouvée sur ce site.</div></div></div>`;
    const ack = shift.handoverAcknowledged ? `<span class="pill green">Relève confirmée</span>` : `<button class="btn small primary" id="ack-handover">Confirmer la relève</button>`;
    box.innerHTML = `<div class="item"><div class="item-main"><div class="item-title">Relève agent ${ack}</div><div class="item-meta">Mission précédente : ${safe(prev.agentNom || '—')}<br>Fin : ${dateText(prev.completedAt)}<br>Rapports : ${prev.reportsCount || 0} · Rondes : ${prev.roundsCount || 0} · Incidents : ${prev.incidentsCount || 0}<br><br><strong>Note de relève :</strong><br>${safe(prev.handoverNote || 'Aucune note transmise.')}</div></div></div>`;
    document.querySelector('#ack-handover')?.addEventListener('click', async () => {
      await updateDoc(docRef('shifts', shift.id), { handoverAcknowledged:true, handoverFromShiftId:prev.id, handoverAcknowledgedAt:serverTimestamp(), updatedAt:serverTimestamp(), updatedBy:currentUser.uid });
      await addAudit('handover_acknowledged', { shiftId:shift.id, fromShiftId:prev.id });
      toast('Relève prise en compte', 'success');
      loadAgentHandoverCard({ ...shift, handoverAcknowledged:true });
    });
  } catch(e){ console.warn(e); box.innerHTML = `<div class="empty">Relève indisponible avec les règles actuelles.</div>`; }
}
async function endShift(shift){
  try {
    const reportsSnap = await getDocs(query(collectionRef('reports'), where('agentId','==',currentUser.uid), where('shiftId','==',shift.id)));
    const roundsSnap = await getDocs(query(collectionRef('rounds'), where('agentId','==',currentUser.uid), where('shiftId','==',shift.id)));
    const reports = reportsSnap.docs.map(d=>d.data());
    const incidentsCount = reports.filter(r => ['Incident','Intervention','Anomalie'].includes(r.category) || ['Important','Critique'].includes(r.severity)).length;
    const score = computeConformityScore({ shift, reportsCount:reportsSnap.size, roundsCount:roundsSnap.size, incidentsCount });
    const agentName = `${currentProfile.prenom || ''} ${currentProfile.nom || ''}`.trim();
    showModal('Terminer la mission', `<form id="end-shift-form" class="end-shift-flow">
      <div class="end-shift-hero"><span>POSTE EN COURS DEPUIS</span><strong>${elapsedShiftText(shift.startTime)}</strong><p>${safe(shift.siteNom)} · prise de poste ${dateText(shift.startTime)}</p></div>
      <div class="mission-kpis"><div class="mini-kpi"><strong>${reportsSnap.size}</strong><span>Rapports</span></div><div class="mini-kpi green"><strong>${roundsSnap.size}</strong><span>Rondes</span></div><div class="mini-kpi ${incidentsCount?'orange':'green'}"><strong>${incidentsCount}</strong><span>Événements</span></div><div class="mini-kpi ${score < 70 ? 'red' : score < 90 ? 'orange' : 'green'}"><strong>${score}%</strong><span>Conformité</span></div></div>
      <div class="field"><label>Note de relève pour l’agent suivant</label><textarea class="textarea" name="handoverNote" placeholder="RAS, point à surveiller, incident en cours, consigne client..."></textarea></div>
      <label class="checkline"><input type="checkbox" name="certify" required> Je confirme avoir terminé mon service et transmis les informations utiles.</label>
      <div class="field"><label>Signature agent</label><input class="input" name="signatureName" required value="${safe(agentName)}" placeholder="Nom et prénom"></div>
      <div class="end-shift-actions">
        <button class="btn danger full end-shift-cta" type="submit">Confirmer la fin de poste</button>
        <p class="muted end-shift-note">La fin de service sera ajoutée automatiquement à la main courante. Aucun rapport manuel n’est nécessaire.</p>
      </div>
    </form>`);
    const endShiftModalRoot = document.querySelector('#modal-root');
    endShiftModalRoot?.classList.add('end-shift-backdrop');
    endShiftModalRoot?.querySelector('.modal')?.classList.add('end-shift-modal');
    document.querySelector('#end-shift-form')?.addEventListener('submit', async e => {
      e.preventDefault();
      const form = e.currentTarget;
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      button.textContent = 'Clôture en cours...';
      const fd = new FormData(form);
      const endGps = await getGPS({ enableHighAccuracy:true, timeout:10000, maximumAge:0 });
      let finalReportsCount = reportsSnap.size;
      try {
        await addDoc(collectionRef('reports'), {
          agentId:currentUser.uid, agentNom:agentName, siteId:shift.siteId, siteNom:shift.siteNom, shiftId:shift.id, missionId:shift.missionId || null,
          category:'Fin de service', severity:'Normal', message:`Fin de poste confirmée. Relève : ${fd.get('handoverNote') || 'RAS'}.`,
          gps:endGps, status:'new', isLocked:true, systemGenerated:true, eventType:'shift_end',
          createdAt:serverTimestamp(), createdBy:currentUser.uid
        });
        finalReportsCount += 1;
      } catch(reportError) { console.warn('Rapport automatique de fin de poste non créé', reportError); }
      await updateDoc(docRef('shifts', shift.id), {
        completedAt: serverTimestamp(), endPositionGPS:endGps, status:'completed', reportsCount: finalReportsCount, roundsCount: roundsSnap.size, incidentsCount, conformityScore:score,
        handoverNote: fd.get('handoverNote') || 'RAS', signatureName: fd.get('signatureName'), signatureStatement:true,
        updatedAt: serverTimestamp(), updatedBy: currentUser.uid
      });
      if (shift.missionId) await updateDoc(docRef('missions', shift.missionId), { status:'completed', actualEnd:serverTimestamp(), reportsCount:finalReportsCount, roundsCount:roundsSnap.size, incidentsCount, conformityScore:score, completedBy:currentUser.uid, updatedAt:serverTimestamp(), updatedBy:currentUser.uid }).catch(()=>{});
      await updateDoc(docRef('users', currentUser.uid), { statut:'hors_poste', siteActuel:null, siteActuelNom:null, lastSeen: serverTimestamp() });
      currentProfile = { ...currentProfile, statut:'hors_poste', siteActuel:null, siteActuelNom:null };
      syncNativePushIdentity().catch(() => {});
      await addAudit('shift_end', { shiftId: shift.id, reportsCount: finalReportsCount, roundsCount: roundsSnap.size, conformityScore:score, gpsAvailable:!!endGps });
      spNotifyQGShiftEnded({shiftId:shift.id,siteName:shift.siteNom||'',reportsCount:finalReportsCount,roundsCount:roundsSnap.size,incidentsCount}).then(result=>addAudit('qg_shift_end_notification',{shiftId:shift.id,pushStatus:result?.skipped?(result?.reason||'skipped'):result?.ok?'sent':result?.error||'failed'}).catch(()=>{})).catch(()=>{});
      const [finalReportsSnap, finalShiftSnap, finalMissionSnap] = await Promise.all([
        getDocs(query(collectionRef('reports'), where('shiftId','==',shift.id))).catch(()=>({docs:[]})),
        getDoc(docRef('shifts', shift.id)).catch(()=>null),
        shift.missionId ? getDoc(docRef('missions', shift.missionId)).catch(()=>null) : Promise.resolve(null)
      ]);
      const finalShift = finalShiftSnap?.exists?.() ? {id:finalShiftSnap.id,...finalShiftSnap.data()} : {...shift, status:'completed', handoverNote:fd.get('handoverNote')||'RAS', signatureName:fd.get('signatureName'), completedAt:new Date(), reportsCount:finalReportsCount, roundsCount:roundsSnap.size, incidentsCount, conformityScore:score};
      const finalMission = finalMissionSnap?.exists?.() ? {id:finalMissionSnap.id,...finalMissionSnap.data()} : {id:shift.missionId||shift.id, ...shift, status:'completed'};
      archiveMissionReportSilently({ mission:finalMission, shift:finalShift, reports:finalReportsSnap.docs.map(d=>({id:d.id,...d.data()})) }).catch(()=>{});
      closeModal(); toast(supabaseBridgeEnabled() ? 'Fin de poste confirmée · PDF en cours d’archivage et d’envoi' : 'Fin de poste confirmée · PDF archivé', 'success'); renderAgentHome();
    });
  } catch(error){ console.error(error); toast('Erreur fin de poste.', 'error'); }
}
function listenAgentRecentReports(){
  const box = document.querySelector('#agent-recent-reports');
  if (!box) return;
  const q = query(collectionRef('reports'), where('agentId','==',currentUser.uid), orderBy('createdAt','desc'), limit(8));
  const unsub = onSnapshot(q, snap => {
    if (snap.empty) return box.innerHTML = `<div class="empty">Aucun rapport envoyé.</div>`;
    box.innerHTML = snap.docs.map(d => reportTimeline(d.data())).join('');
  }, () => box.innerHTML = `<div class="empty">Flux indisponible. Vérifie les RLS Supabase.</div>`);
  unsubscribeList.push(unsub);
}
function reportPhotoPreviewHtml(report,{large=false}={}){
  if (report?.photoUrl) {
    const size = large ? 'max-width:100%;max-height:520px' : 'width:84px;height:64px';
    return `<img src="${safe(report.photoUrl)}" alt="Photo jointe au rapport" loading="lazy" style="${size};object-fit:cover;border-radius:12px;border:1px solid rgba(255,255,255,.12);display:block">`;
  }
  if (report?.photoStoragePath || report?.photoAvailable) return `<span class="pill blue">📷 Photo enregistrée</span>`;
  return '<span class="muted">—</span>';
}
function reportTimeline(r){
  const sev = String(r.severity || 'normal').toLowerCase();
  return `<div class="timeline-entry ${sev}"><div class="item-title">${safe(r.category || 'Rapport')} · ${safe(r.siteNom || '')}</div><div class="item-meta">${dateText(r.createdAt)} · Gravité ${safe(r.severity || 'Normal')}${reportHasPhoto(r)?' · 📷 Photo jointe':''}</div><div style="margin-top:6px">${safe(r.message || '')}</div>${reportHasPhoto(r)?`<div style="margin-top:10px">${reportPhotoPreviewHtml(r)}</div>`:''}</div>`;
}

async function renderAgentMCI(){
  currentRoute = 'mci';
  const shift = await findActiveShift();
  const body = `<section class="grid cols-2">
    <div class="card">
      <div class="card-title"><div><h2>Main courante intelligente</h2><p>Maximum 2 clics pour déclarer</p></div></div>
      ${!shift ? `<div class="setup-box">Tu dois prendre poste avant d’envoyer une main courante.</div>` : mciForm(shift)}
    </div>
    <div class="card"><div class="card-title"><div><h2>Flux du site</h2><p>Rapports récents</p></div></div><div id="site-report-feed" class="timeline"><div class="empty">Chargement...</div></div></div>
  </section>`;
  render(page('Main Courante Agent', 'Rapport opérationnel envoyé au QG en temps réel', body));
  if (shift) bindMCIForm(shift);
  listenSiteReports(shift?.siteId);
}
function mciForm(shift){
  const cats = ['Ronde','Anomalie','Incident','Information','Intervention','Consigne reçue'];
  const templates = [
    'Ronde effectuée sans anomalie. Zone contrôlée, accès vérifiés, RAS.',
    'Portail et accès principaux vérifiés. Aucun signe d’effraction constaté.',
    'Présence suspecte constatée en zone à surveiller. QG informé, surveillance renforcée.',
    'Dégradation constatée. Zone sécurisée, photo jointe si possible, client/QG à informer.',
    'Levée de doute effectuée. Aucun danger immédiat constaté.',
    'Consigne reçue du QG et appliquée sur site.',
    'Intervention effectuée. Situation stabilisée, éléments transmis au QG.'
  ];
  return `<form id="mci-form">
    <div class="field"><label>Catégorie</label><div class="category-grid">${cats.map((c,i)=>`<button type="button" class="cat-btn ${i===0?'active':''}" data-cat="${safe(c)}">${safe(c)}</button>`).join('')}</div><input type="hidden" name="category" value="Ronde"></div>
    <div class="field"><label>Modèle rapide</label><select class="select" id="mci-template"><option value="">Écrire librement</option>${templates.map(t=>`<option value="${safe(t)}">${safe(t.slice(0,72))}${t.length>72?'…':''}</option>`).join('')}</select></div>
    <div class="field"><label>Niveau</label><select class="select" name="severity"><option>Normal</option><option>À surveiller</option><option>Important</option><option>Critique</option></select></div>
    <div class="field"><label>Rapport</label><textarea class="textarea" name="message" required placeholder="Décrire l’événement de manière factuelle..."></textarea></div>
    <div class="btn-row"><button type="button" class="btn" id="voice-btn">🎙️ Micro</button><label class="btn" for="mci-photo-input">📷 Photo</label><button type="button" class="btn" id="gps-btn">◎ GPS</button></div>
    <input id="mci-photo-input" type="file" accept="image/*" capture="environment" style="display:none">
    <div class="camera-preview" id="mci-photo-preview" style="display:none"></div>
    <input type="hidden" name="gpsRequested" value="false">
    <div id="voice-state" class="muted" style="margin:12px 0;font-size:12px"></div>
    <div class="divider"></div><button class="btn primary full" type="submit">Envoyer au QG</button>
  </form>`;
}
function bindMCIForm(shift){
  const form = document.querySelector('#mci-form');
  let pendingMciPhoto = null;
  const photoInput = document.querySelector('#mci-photo-input');
  const photoPreview = document.querySelector('#mci-photo-preview');
  const refreshPhotoPreview = () => {
    if (!photoPreview) return;
    if (!pendingMciPhoto?.dataUrl) {
      photoPreview.style.display = 'none';
      photoPreview.innerHTML = '';
      return;
    }
    photoPreview.style.display = 'flex';
    photoPreview.innerHTML = `<img src="${safe(pendingMciPhoto.dataUrl)}" alt="Photo jointe à la main courante"><div><strong>Photo prête</strong><span>${Math.max(1,Math.round(Number(pendingMciPhoto.bytes || 0)/1024))} Ko · compression automatique</span><button type="button" class="btn small ghost" id="mci-photo-remove">Retirer</button></div>`;
    document.querySelector('#mci-photo-remove')?.addEventListener('click', () => {
      pendingMciPhoto = null;
      if (photoInput) photoInput.value = '';
      refreshPhotoPreview();
    });
  };
  document.querySelectorAll('.cat-btn').forEach(btn => btn.addEventListener('click', () => {
    document.querySelectorAll('.cat-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active'); form.category.value = btn.dataset.cat;
  }));
  document.querySelector('#mci-template')?.addEventListener('change', e => {
    if (!e.target.value) return;
    form.message.value = e.target.value;
    form.message.focus();
  });
  document.querySelector('#voice-btn')?.addEventListener('click', () => {
    const box = document.querySelector('#voice-state');
    box.textContent = 'Dictée en cours... simulation de transcription.';
    setTimeout(() => {
      form.message.value = (form.message.value ? form.message.value + '\n' : '') + 'Observation terrain à compléter : présence constatée, zone sécurisée, information transmise au QG.';
      box.textContent = 'Transcription ajoutée. Corrige le texte avant envoi.';
    }, 900);
  });
  document.querySelector('#gps-btn')?.addEventListener('click', () => { form.gpsRequested.value = 'true'; toast('Position GPS demandée pour ce rapport.', 'success'); });
  photoInput?.addEventListener('change', async event => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      toast('Compression de la photo...', 'info');
      pendingMciPhoto = await compressCheckInPhoto(file);
      refreshPhotoPreview();
      toast('Photo ajoutée à la main courante.', 'success');
    } catch(error) {
      console.error(error);
      pendingMciPhoto = null;
      event.target.value = '';
      refreshPhotoPreview();
      toast(userFriendlyError(error, 'Photo impossible.'), 'error');
    }
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(form);
    const onlineAtSubmission = isOnline();
    const gps = fd.get('gpsRequested') === 'true' ? await getGPS() : null;
    const reportRef = doc(collectionRef('reports'));
    const reportData = {
      agentId: currentUser.uid,
      agentNom: `${currentProfile.prenom || ''} ${currentProfile.nom || ''}`.trim(),
      siteId: shift.siteId, siteNom: shift.siteNom, shiftId: shift.id, missionId: shift.missionId || null,
      category: fd.get('category'), severity: fd.get('severity'), message: fd.get('message'),
      photoUrl: pendingMciPhoto?.dataUrl || null,
      photoAvailable: Boolean(pendingMciPhoto?.dataUrl),
      photoBytes: Number(pendingMciPhoto?.bytes || 0),
      photoMimeType: pendingMciPhoto?.mimeType || null,
      photoWidth: Number(pendingMciPhoto?.width || 0),
      photoHeight: Number(pendingMciPhoto?.height || 0),
      photoCapturedAt: pendingMciPhoto?.capturedAt || null,
      gps, status:'new', isLocked:true, createdAt: serverTimestamp(), createdBy: currentUser.uid
    };
    try {
      const reportWrite = setDoc(reportRef, reportData);
      if (onlineAtSubmission) {
        await reportWrite;
        await updateDoc(docRef('users', currentUser.uid), { lastSeen: serverTimestamp() }).catch(()=>{});
        await addAudit('report_create', { siteId: shift.siteId, shiftId: shift.id, missionId: shift.missionId || null, category: fd.get('category'), severity: fd.get('severity'), photoAvailable:Boolean(pendingMciPhoto?.dataUrl) });
      } else {
        reportWrite.catch(error => console.error('Synchronisation MCI hors ligne impossible', error));
      }
      form.reset();
      form.category.value = 'Ronde';
      pendingMciPhoto = null;
      refreshPhotoPreview();
      document.querySelectorAll('.cat-btn').forEach((btn,index) => btn.classList.toggle('active', index===0));
      toast(onlineAtSubmission ? 'Rapport envoyé au QG' : 'Rapport enregistré hors ligne. Il sera transmis au retour du réseau.', onlineAtSubmission ? 'success' : 'warning');
    } catch(error){
      console.error(error);
      toast(userFriendlyError(error, 'Erreur envoi rapport.'), 'error');
    }
  });
}
function listenSiteReports(siteId){
  const box = document.querySelector('#site-report-feed'); if (!box || !siteId) return;
  const q = query(collectionRef('reports'), where('siteId','==',siteId), orderBy('createdAt','desc'), limit(12));
  const unsub = onSnapshot(q, snap => box.innerHTML = snap.empty ? `<div class="empty">Aucun rapport pour ce site.</div>` : snap.docs.map(d => reportTimeline(d.data())).join(''));
  unsubscribeList.push(unsub);
}

async function renderAgentDocs(){
  currentRoute = 'docs';
  const shift = await findActiveShift();
  const body = `<section class="grid cols-2">
    <div class="card"><div class="card-title"><div><h2>Consignes site</h2><p>Consultation opérationnelle</p></div></div><div id="docs-consignes">${shift?'Chargement...':'<div class="empty">Prends poste pour accéder aux consignes du site.</div>'}</div></div>
    <div class="card"><div class="card-title"><div><h2>Documents et plans</h2><p>PDF, images, contacts</p></div></div><div class="field"><label>Recherche rapide</label><input class="input" id="doc-search" placeholder="incendie, intrusion, évacuation..."></div><div id="docs-list" class="list"><div class="empty">Chargement...</div></div><div id="doc-viewer" class="doc-viewer" style="margin-top:14px"><div class="empty" style="margin:20px">Sélectionne un document.</div></div></div>
  </section>`;
  render(page('Documentation Site', 'Consignes, plans et procédures spécifiques', body));
  if (shift) loadSiteDocs(shift.siteId);
}
async function loadSiteDocs(siteId){
  const siteSnap = await getDoc(docRef('sites', siteId));
  const site = siteSnap.exists() ? siteSnap.data() : {};
  document.querySelector('#docs-consignes').innerHTML = `<div class="list">
    <div class="item"><div class="item-main"><div class="item-title">${safe(site.name || 'Site')}</div><div class="item-meta">Client : ${safe(site.clientName || '—')}<br>Adresse : ${safe(site.address || '—')}<br>Contact urgence : ${safe(site.emergencyContact || '—')}<br>Contact client : ${safe(site.contactPhone || '—')}</div></div></div>
    <div class="item"><div class="item-main"><div class="item-title">Consignes principales</div><div class="item-meta">${safe(site.instructions || 'Aucune consigne renseignée.')}</div></div></div>
  </div>`;
  const docsSnap = await getDocs(query(collectionRef('documents'), where('siteId','==',siteId), where('status','==','active'))).catch(()=>({docs:[]}));
  const docs = docsSnap.docs.map(d => ({id:d.id, ...d.data()}));
  renderDocList(docs);
  document.querySelector('#doc-search')?.addEventListener('input', e => {
    const term = e.target.value.toLowerCase();
    renderDocList(docs.filter(doc => `${doc.title} ${doc.type} ${doc.description}`.toLowerCase().includes(term)));
  });
}
function renderDocList(docs){
  const list = document.querySelector('#docs-list');
  if (!docs.length) return list.innerHTML = `<div class="empty">Aucun document lié au site.</div>`;
  list.innerHTML = docs.map(d => `<div class="item"><div class="item-main"><div class="item-title">${safe(d.title || 'Document')}</div><div class="item-meta">${safe(d.type || 'document')} · ${safe(d.description || '')}</div></div><div class="item-actions"><button class="btn small" data-open-doc="${safe(d.id)}">Ouvrir</button></div></div>`).join('');
  document.querySelectorAll('[data-open-doc]').forEach(btn => btn.addEventListener('click', () => {
    const doc = docs.find(d => d.id === btn.dataset.openDoc);
    const url = doc?.url || doc?.fileUrl;
    if (!url) return toast('URL document manquante.', 'warning');
    const v = document.querySelector('#doc-viewer');
    if ((doc.type || '').toLowerCase().includes('image') || /\.(png|jpg|jpeg|webp)$/i.test(url)) v.innerHTML = `<img src="${safe(url)}" alt="${safe(doc.title)}">`;
    else v.innerHTML = `<iframe src="${safe(url)}" title="${safe(doc.title)}"></iframe>`;
  }));
}

async function renderAgentRound(){
  currentRoute = 'round';
  const shift = await findActiveShift();
  const body = `<section class="grid cols-2">
    <div class="card"><div class="card-title"><div><h2>Validation de ronde</h2><p>QR prioritaire, NFC si compatible</p></div></div>${shift ? roundUI() : `<div class="setup-box">Tu dois prendre poste avant de démarrer une ronde.</div>`}</div>
    <div class="card"><div class="card-title"><div><h2>Points de contrôle</h2><p>Progression en temps réel</p></div></div><div id="round-checkpoints" class="list"><div class="empty">Chargement...</div></div></div>
  </section>`;
  render(page('Ronde Agent', 'Certification des passages terrain', body));
  if (shift) bindRound(shift);
}
function roundUI(){
  return `<div class="qr-zone"><div style="font-weight:900;font-size:20px">Scanner QR / NFC</div><p class="muted">NFC disponible uniquement sur navigateur compatible. QR obligatoire en fallback.</p><div class="field"><label>Code point de ronde</label><input class="input mono" id="checkpoint-code" placeholder="Scanner ou saisir le code"></div><div class="btn-row"><button class="btn primary" id="validate-checkpoint">Valider point</button><button class="btn" id="nfc-read">Lire NFC</button></div></div><div class="divider"></div><div class="progress-shell"><div id="round-progress" class="progress-bar" style="width:0%"></div></div><p class="muted" id="round-progress-text">0% validé</p>`;
}
async function bindRound(shift){
  const snap = await getDocs(query(collectionRef('roundCheckpoints'), where('siteId','==',shift.siteId), where('isActive','==',true), orderBy('order'))).catch(async()=>getDocs(query(collectionRef('roundCheckpoints'), where('siteId','==',shift.siteId), where('isActive','==',true))));
  const points = snap.docs.map(d => ({id:d.id, ...d.data()}));
  const state = { roundId:null, validated:new Set(), points };
  renderCheckpoints(state);
  document.querySelector('#validate-checkpoint')?.addEventListener('click', async () => {
    const code = document.querySelector('#checkpoint-code').value.trim();
    const point = points.find(p => p.qrCode === code || p.nfcId === code || p.id === code);
    if (!point) return toast('Point non reconnu.', 'error');
    await validateCheckpoint(shift, state, point, 'QR');
  });
  document.querySelector('#nfc-read')?.addEventListener('click', async () => {
    if (!('NDEFReader' in window)) return toast('NFC non compatible. Utilise le QR code.', 'warning');
    try {
      const reader = new NDEFReader();
      await reader.scan();
      toast('Approche le téléphone du tag NFC.', 'success');
      reader.onreading = async event => {
        const serial = event.serialNumber;
        const point = points.find(p => p.nfcId === serial);
        if (point) await validateCheckpoint(shift, state, point, 'NFC'); else toast('Tag NFC non reconnu.', 'error');
      };
    } catch { toast('Lecture NFC refusée ou indisponible.', 'warning'); }
  });
}
function renderCheckpoints(state){
  const list = document.querySelector('#round-checkpoints');
  if (!state.points.length) return list.innerHTML = `<div class="empty">Aucun point de ronde configuré pour ce site.</div>`;
  list.innerHTML = state.points.map(p => `<div class="item"><div class="item-main"><div class="item-title">${state.validated.has(p.id)?'✅':'○'} ${safe(p.name)}</div><div class="item-meta">Zone : ${safe(p.zone || '—')} · Ordre : ${safe(p.order || '—')}<br>${safe(p.description || '')}</div></div></div>`).join('');
  const percent = Math.round((state.validated.size / state.points.length) * 100);
  const bar = document.querySelector('#round-progress'); if (bar) bar.style.width = `${percent}%`;
  const txt = document.querySelector('#round-progress-text'); if (txt) txt.textContent = `${percent}% validé · ${state.validated.size}/${state.points.length}`;
}
async function validateCheckpoint(shift, state, point, method){
  try {
    if (!state.roundId) {
      const round = await addDoc(collectionRef('rounds'), { agentId:currentUser.uid, agentNom:`${currentProfile.prenom||''} ${currentProfile.nom||''}`.trim(), siteId:shift.siteId, siteNom:shift.siteNom, shiftId:shift.id, startedAt:serverTimestamp(), status:'active', checkpointsValidated:[] });
      state.roundId = round.id;
    }
    if (state.validated.has(point.id)) return toast('Point déjà contrôlé.', 'warning');
    const gps = await getGPS();
    await addDoc(collectionRef('roundCheckpointsLogs'), { roundId:state.roundId, agentId:currentUser.uid, siteId:shift.siteId, checkpointId:point.id, checkpointName:point.name, scanMethod:method, gps, scannedAt:serverTimestamp(), isValid:true, createdBy:currentUser.uid });
    state.validated.add(point.id);
    await updateDoc(docRef('rounds', state.roundId), { checkpointsValidated:[...state.validated], status:state.validated.size === state.points.length ? 'completed':'active', completedAt:state.validated.size === state.points.length ? serverTimestamp() : null });
    document.querySelector('#checkpoint-code').value = '';
    renderCheckpoints(state);
    toast('Point contrôlé', 'success');
  } catch(error){ console.error(error); toast('Erreur validation ronde.', 'error'); }
}

function openWhatsapp(shift){
  const phone = shift?.whatsappQG || DEFAULT_QG_WHATSAPP;
  const msg = `Bonjour QG, ici ${currentProfile.prenom || ''} ${currentProfile.nom || ''}, site ${shift?.siteNom || 'non renseigné'}, je vous contacte concernant :`;
  window.open(`https://wa.me/${String(phone).replace(/\D/g,'')}?text=${encodeURIComponent(msg)}`, '_blank');
}

async function renderAgentFlash(){
  currentRoute = 'flash';
  const body = `<section class="card"><div class="card-title"><div><h2>Messages Flash reçus</h2><p>Confirmation de lecture obligatoire</p></div></div><div id="agent-flash-list" class="list"><div class="empty">Chargement...</div></div></section>`;
  render(page('Messages Flash', 'Alertes descendantes du QG', body));
  listenAgentFlashList();
}
function listenAgentFlashList(){
  const box = document.querySelector('#agent-flash-list'); if (!box) return;
  const q = query(collectionRef('flashMessages'), orderBy('sentAt','desc'), limit(30));
  const unsub = onSnapshot(q, snap => {
    const data = snap.docs.map(d => ({ id:d.id, ...d.data() })).filter(f => flashTargetsMe(f));
    if (!data.length) return box.innerHTML = `<div class="empty">Aucun message Flash.</div>`;
    box.innerHTML = data.map(f => `<div class="item"><div class="item-main"><div class="item-title">${safe(f.title)}</div><div class="item-meta">${safe(f.priority || 'Information')} · ${dateText(f.sentAt)}<br>${safe(f.message)}</div></div><div class="item-actions">${f.readBy?.[currentUser.uid] ? '<span class="pill green">Lu</span>' : `<button class="btn small primary" data-read-flash="${safe(f.id)}">Confirmer lecture</button>`}</div></div>`).join('');
    document.querySelectorAll('[data-read-flash]').forEach(btn => btn.addEventListener('click', () => markFlashRead(btn.dataset.readFlash)));
  });
  unsubscribeList.push(unsub);
}

// -------------------- QG --------------------
function roleAllowedAdmin(){ return ['admin','superviseur'].includes(currentProfile?.role); }
function isStrictAdmin(){ return currentProfile?.role === 'admin'; }

async function renderQGHome(){
  currentRoute = 'home';
  const body = `
    <section class="grid cols-4" id="qg-stats">
      <div class="card stat green dashboard-stat" role="button" tabindex="0" data-dashboard-detail="working" aria-label="Afficher les agents en poste"><div class="stat-label">Agents en poste</div><div class="stat-value" id="stat-working">—</div><div class="stat-hint">Voir les agents et leur durée en poste</div></div>
      <div class="card stat red dashboard-stat" role="button" tabindex="0" data-dashboard-detail="alerts" aria-label="Afficher les alertes actives"><div class="stat-label">Alertes actives</div><div class="stat-value" id="stat-alerts">—</div><div class="stat-hint">Voir les alertes à traiter</div></div>
      <div class="card stat orange dashboard-stat" role="button" tabindex="0" data-dashboard-detail="incidents" aria-label="Afficher les incidents des dernières 24 heures"><div class="stat-label">Incidents 24h</div><div class="stat-value" id="stat-incidents">—</div><div class="stat-hint">Voir les incidents et interventions</div></div>
      <div class="card stat blue dashboard-stat" role="button" tabindex="0" data-dashboard-detail="missions" aria-label="Afficher les missions du jour"><div class="stat-label">Missions du jour</div><div class="stat-value" id="stat-missions">—</div><div class="stat-hint">Voir le programme opérationnel</div></div>
    </section>
    <section class="card map-card map-card-xl" style="margin-top:16px">
      <div class="card-title map-card-title"><div><h2>Carte opérationnelle</h2><p>Vue lisible des sites géolocalisés et agents en poste</p></div><div class="btn-row map-actions"><button class="btn small" id="map-locate">Ma position</button><button class="btn small" id="map-reset">Tout afficher</button></div></div>
      <div class="map-legend map-legend-premium"><span><i class="legend-dot agent"></i>Agents en poste</span><span><i class="legend-dot site"></i>Sites client</span><span class="muted">Touchez un agent pour afficher son poste · Touchez un site pour ouvrir sa fiche</span></div>
      <div id="qg-map" class="map premium-map premium-map-xl"></div>
      <div id="map-empty-help" class="map-empty-help hidden">Renseigne une adresse complète dans Gestion Sites : la position sera calculée automatiquement.</div>
    </section>
    <section class="grid cols-2" style="margin-top:16px">
      <div class="card"><div class="card-title"><div><h2>Centre notifications</h2><p>Retards, prises de poste, inactivité, SOS et critiques</p></div><div class="btn-row"><button class="btn small ghost" id="qg-clear-notifications-preview" type="button">Effacer</button><button class="btn small" data-route="notifications">Voir tout</button></div></div><div id="qg-notifications-preview" class="list"><div class="empty">Chargement...</div></div></div>
      <div class="card"><div class="card-title"><div><h2>Alertes prioritaires</h2><p>SOS/PTI actifs</p></div></div><div id="qg-alerts-feed" class="list"><div class="empty">Chargement...</div></div></div>
    </section>
    <section class="card" style="margin-top:16px"><div class="card-title"><div><h2>Derniers rapports MCI</h2><p>Temps réel, sans pollution planning</p></div><button class="btn small" data-route="reports">Voir journal</button></div><div id="qg-reports-feed" class="timeline"><div class="empty">Chargement...</div></div></section>`;
  render(page('Dashboard QG', 'Centre de commandement temps réel', body));
  listenQGStats(); bindQGDashboardDetails(); listenQGReportsFeed(); listenQGAlertsFeed(); initQGMap(); listenQGNotifications('#qg-notifications-preview', 5); bindQGNotificationClearButton('#qg-clear-notifications-preview');
}

function bindQGDashboardDetails(){
  document.querySelectorAll('[data-dashboard-detail]').forEach(card => {
    const open = () => showQGDashboardDetail(card.dataset.dashboardDetail);
    card.addEventListener('click', open);
    card.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    });
  });
}
function dashboardEmpty(message){
  return `<div class="dashboard-detail-empty">${safe(message)}</div>`;
}
function dashboardDetailItem({title='', meta='', badge='', badgeClass='blue', actions=''}){
  return `<article class="dashboard-detail-item"><div class="dashboard-detail-main"><div class="dashboard-detail-title">${safe(title)}</div><div class="dashboard-detail-meta">${meta}</div></div><div class="dashboard-detail-side">${badge ? `<span class="pill ${safe(badgeClass)}">${safe(badge)}</span>` : ''}${actions}</div></article>`;
}
function dashboardMissionStatusLabel(status){
  return ({planned:'Planifiée', active:'En cours', completed:'Terminée', cancelled:'Annulée', late:'En retard'}[status] || status || 'Planifiée');
}
function missionStatusClass(status){
  return ({active:'green', completed:'blue', cancelled:'red', late:'red', planned:'orange'}[status] || 'blue');
}
async function showQGDashboardDetail(type){
  const config = {
    working:{ title:'Agents en poste', subtitle:'Présence terrain en temps réel' },
    alerts:{ title:'Alertes actives', subtitle:'Alertes nécessitant une prise en charge' },
    incidents:{ title:'Incidents des dernières 24h', subtitle:'Incidents et interventions déclarés' },
    missions:{ title:'Missions du jour', subtitle:'Planning opérationnel de la journée' }
  }[type];
  if (!config) return;
  showModal(config.title, `<div class="dashboard-detail-head"><p>${safe(config.subtitle)}</p><span class="dashboard-detail-live">Mise à jour à ${safe(new Date().toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}))}</span></div><div id="dashboard-detail-content" class="dashboard-detail-list"><div class="empty">Chargement...</div></div>`, 'wide');
  const box = document.querySelector('#dashboard-detail-content');
  if (!box) return;
  try {
    if (type === 'working') {
      const [shiftSnap, usersSnap] = await Promise.all([
        getDocs(query(collectionRef('shifts'), where('status','==','active'))),
        getDocs(collectionRef('users'))
      ]);
      const users = new Map(usersSnap.docs.map(d => [d.id, {id:d.id, ...d.data()}]));
      const rows = shiftSnap.docs.map(d => ({id:d.id, ...d.data()})).sort((a,b) => (timestampToDate(a.startTime)?.getTime() || 0) - (timestampToDate(b.startTime)?.getTime() || 0));
      if (!rows.length) return box.innerHTML = dashboardEmpty('Aucun agent n’est actuellement en poste.');
      box.innerHTML = `<div class="dashboard-detail-summary"><strong>${rows.length}</strong><span>agent${rows.length>1?'s':''} actuellement en poste</span></div>` + rows.map(row => {
        const user = users.get(row.agentId) || {};
        const phone = user.telephone || user.phone || '';
        const actions = `<button class="btn small" data-dashboard-map-shift="${safe(row.id)}">Voir sur la carte</button>${phone ? `<a class="btn small" href="tel:${safe(String(phone).replace(/\s/g,''))}">Appeler</a>` : ''}`;
        return dashboardDetailItem({
          title:row.agentNom || `${user.prenom||''} ${user.nom||''}`.trim() || 'Agent',
          meta:`<strong>${safe(row.siteNom || 'Site non renseigné')}</strong><br>Prise de poste : ${safe(dateText(row.startTime))}<br>Depuis : <strong>${safe(elapsedShiftText(row.startTime))}</strong>${row.scheduledEnd ? `<br>Fin prévue : ${safe(dateText(row.scheduledEnd))}` : ''}`,
          badge:'En poste', badgeClass:'green', actions
        });
      }).join('');
      document.querySelectorAll('[data-dashboard-map-shift]').forEach(btn => btn.addEventListener('click', () => {
        const shiftId = btn.dataset.dashboardMapShift;
        closeModal();
        setTimeout(() => focusAgentOnMap(shiftId), 120);
      }));
      return;
    }
    if (type === 'alerts') {
      const snap = await getDocs(query(collectionRef('alerts'), where('statut','==','active')));
      const rows = snap.docs.map(d => ({id:d.id, ...d.data()})).sort((a,b) => (timestampToDate(b.heure || b.createdAt)?.getTime() || 0) - (timestampToDate(a.heure || a.createdAt)?.getTime() || 0));
      if (!rows.length) return box.innerHTML = dashboardEmpty('Aucune alerte active.');
      box.innerHTML = `<div class="dashboard-detail-summary danger"><strong>${rows.length}</strong><span>alerte${rows.length>1?'s':''} active${rows.length>1?'s':''}</span></div>` + rows.map(row => dashboardDetailItem({
        title:`${row.typeAlerte || 'SOS/PTI'} · ${row.agentNom || 'Agent'}`,
        meta:`Site : <strong>${safe(row.siteActuelNom || row.siteActuel || '—')}</strong><br>Déclenchée : ${safe(dateText(row.heure || row.createdAt))}<br>${safe(row.message || 'Alerte critique en attente de traitement')}`,
        badge:row.niveau || 'Critique', badgeClass:'red',
        actions:`<button class="btn small danger" data-dashboard-alert="${safe(row.id)}">Ouvrir l’alerte</button>`
      })).join('');
      document.querySelectorAll('[data-dashboard-alert]').forEach(btn => btn.addEventListener('click', () => { closeModal(); navigate('alerts'); }));
      return;
    }
    if (type === 'incidents') {
      const snap = await getDocs(query(collectionRef('reports'), orderBy('createdAt','desc'), limit(300)));
      const since = Date.now() - 24*60*60*1000;
      const rows = snap.docs.map(d => ({id:d.id, ...d.data()})).filter(row => ['Incident','Intervention'].includes(row.category) && (timestampToDate(row.createdAt)?.getTime() || 0) > since);
      if (!rows.length) return box.innerHTML = dashboardEmpty('Aucun incident ni intervention déclaré sur les dernières 24 heures.');
      box.innerHTML = `<div class="dashboard-detail-summary warning"><strong>${rows.length}</strong><span>événement${rows.length>1?'s':''} sur les dernières 24h</span></div>` + rows.map(row => dashboardDetailItem({
        title:`${row.category || 'Incident'} · ${row.siteNom || 'Site'}`,
        meta:`Agent : <strong>${safe(row.agentNom || '—')}</strong><br>${safe(dateText(row.createdAt))}<br>${safe(row.message || '')}`,
        badge:row.severity || 'Normal', badgeClass:['Critique','Important'].includes(row.severity)?'red':'orange',
        actions:`<button class="btn small" data-dashboard-report="${safe(row.id)}">Voir le journal MCI</button>`
      })).join('');
      document.querySelectorAll('[data-dashboard-report]').forEach(btn => btn.addEventListener('click', () => { closeModal(); navigate('reports'); }));
      return;
    }
    if (type === 'missions') {
      const snap = await getDocs(query(collectionRef('missions'), orderBy('scheduledStart','desc'), limit(400)));
      const today = new Date(); today.setHours(0,0,0,0);
      const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate()+1);
      const rows = snap.docs.map(d => ({id:d.id, ...d.data()})).filter(row => {
        if(missionIsDraft(row)) return false;
        const start = timestampToDate(row.scheduledStart)?.getTime() || 0;
        const end = timestampToDate(row.scheduledEnd)?.getTime() || start;
        return start < tomorrow.getTime() && end >= today.getTime();
      }).sort((a,b) => (timestampToDate(a.scheduledStart)?.getTime() || 0) - (timestampToDate(b.scheduledStart)?.getTime() || 0));
      if (!rows.length) return box.innerHTML = dashboardEmpty('Aucune mission planifiée aujourd’hui.');
      box.innerHTML = `<div class="dashboard-detail-summary"><strong>${rows.length}</strong><span>mission${rows.length>1?'s':''} couvrant la journée</span></div>` + rows.map(row => dashboardDetailItem({
        title:row.siteNom || row.title || 'Mission',
        meta:`Agent : <strong>${safe(row.agentNom || 'Non affecté')}</strong><br>${safe(dateText(row.scheduledStart))} → ${safe(dateText(row.scheduledEnd))}<br>${safe(row.type || row.missionType || 'Mission de sécurité')}`,
        badge:dashboardMissionStatusLabel(row.status), badgeClass:missionStatusClass(row.status),
        actions:`<button class="btn small" data-dashboard-mission="${safe(row.id)}">Ouvrir les missions</button>`
      })).join('');
      document.querySelectorAll('[data-dashboard-mission]').forEach(btn => btn.addEventListener('click', () => { closeModal(); navigate('missions'); }));
    }
  } catch(error) {
    console.error(error);
    box.innerHTML = dashboardEmpty(userFriendlyError(error, 'Impossible de charger le détail pour le moment.'));
  }
}
function focusAgentOnMap(shiftId){
  if (!mapInstance || !mapAgentLayer) return toast('La carte n’est pas encore prête.', 'warning');
  let target = null;
  mapAgentLayer.eachLayer(layer => { if (layer?.__spShift?.id === shiftId) target = layer; });
  if (!target) return toast('Cet agent n’est plus localisé sur la carte.', 'warning');
  const coords = target.getLatLng?.();
  if (coords) mapInstance.setView(coords, 16, {animate:true});
  const mapElement = document.querySelector('#qg-map');
  mapElement?.scrollIntoView({behavior:'smooth', block:'center'});
  setTimeout(() => target.fire('click'), 450);
}
async function showAgentOperationalDetails(shift, lat, lng){
  const modalId = `agent-live-${id()}`;
  showModal(shift.agentNom || 'Agent en poste', `<section class="agent-live-sheet"><div class="agent-live-status"><span class="live-dot"></span><strong>En poste</strong><span id="${modalId}-elapsed">${safe(elapsedShiftText(shift.startTime))}</span></div><div id="${modalId}-content" class="agent-live-content"><div class="empty">Chargement des informations...</div></div></section>`, 'wide');
  const content = document.getElementById(`${modalId}-content`);
  if (!content) return;
  try {
    const [userSnap, proofSnap] = await Promise.all([
      shift.agentId ? getDoc(docRef('users', shift.agentId)).catch(()=>null) : Promise.resolve(null),
      shift.checkInPhotoAvailable ? getDoc(docRef('shiftProofs', shift.id)).catch(()=>null) : Promise.resolve(null)
    ]);
    const user = userSnap?.exists?.() ? userSnap.data() : {};
    const proof = proofSnap?.exists?.() ? proofSnap.data() : {};
    const phone = user.telephone || user.phone || '';
    const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
    content.innerHTML = `<div class="agent-live-identity"><div class="agent-live-avatar">${safe(String(shift.agentNom || 'A').split(/\s+/).filter(Boolean).slice(0,2).map(part=>part[0]).join('').toUpperCase())}</div><div><h3>${safe(shift.agentNom || 'Agent')}</h3><p>${safe(shift.siteNom || 'Site non renseigné')}</p></div></div>
      <div class="agent-live-grid">
        <div><span>Prise de poste</span><strong>${safe(dateText(shift.startTime))}</strong></div>
        <div><span>Durée en poste</span><strong id="${modalId}-duration">${safe(elapsedShiftText(shift.startTime))}</strong></div>
        <div><span>Mission</span><strong>${safe(shift.shiftType || 'Mission libre')}</strong></div>
        <div><span>Fin prévue</span><strong>${safe(dateText(shift.scheduledEnd))}</strong></div>
        <div><span>Dernière activité</span><strong>${safe(dateText(user.lastSeen))}</strong></div>
        <div><span>Précision GPS</span><strong>${Number.isFinite(Number(shift.positionGPS?.accuracy)) ? `${Math.round(Number(shift.positionGPS.accuracy))} m` : 'Non disponible'}</strong></div>
      </div>
      ${shift.missionInstructions ? `<div class="agent-live-instructions"><span>CONSIGNES DE MISSION</span><p>${safe(shift.missionInstructions).replace(/\n/g,'<br>')}</p></div>` : ''}
      ${proof.imageDataUrl ? `<figure class="agent-live-photo"><img src="${safe(proof.imageDataUrl)}" alt="Photo de prise de poste"><figcaption>Preuve photo de prise de poste · ${safe(dateText(proof.capturedAt || shift.checkInPhotoCapturedAt))}</figcaption></figure>` : `<div class="agent-live-no-photo">Aucune photo de prise de poste disponible.</div>`}
      <div class="agent-live-actions"><a class="btn primary" href="${safe(mapsUrl)}" target="_blank" rel="noopener">Ouvrir dans Google Maps</a>${phone ? `<a class="btn" href="tel:${safe(String(phone).replace(/\s/g,''))}">Appeler l’agent</a>` : ''}<button class="btn" id="${modalId}-agents">Gestion agents</button></div>`;
    document.getElementById(`${modalId}-agents`)?.addEventListener('click', () => { closeModal(); navigate('agents'); });
    const timer = setInterval(() => {
      const elapsed = document.getElementById(`${modalId}-elapsed`);
      const duration = document.getElementById(`${modalId}-duration`);
      if (!elapsed && !duration) return clearInterval(timer);
      const value = elapsedShiftText(shift.startTime);
      if (elapsed) elapsed.textContent = value;
      if (duration) duration.textContent = value;
    }, 60000);
  } catch(error) {
    console.error(error);
    content.innerHTML = dashboardEmpty('Les informations complémentaires de cet agent sont indisponibles.');
  }
}

function listenQGStats(){
  const usersQ = query(collectionRef('users'));
  const alertsQ = query(collectionRef('alerts'), where('statut','==','active'));
  const reportsQ = query(collectionRef('reports'), orderBy('createdAt','desc'), limit(200));
  const missionsQ = query(collectionRef('missions'), orderBy('scheduledStart','desc'), limit(200));
  unsubscribeList.push(onSnapshot(usersQ, snap => {
    const users = snap.docs.map(d=>d.data());
    const working = users.filter(u => u.statut === 'en_poste').length;
    setText('#stat-working', working);
  }));
  unsubscribeList.push(onSnapshot(alertsQ, snap => setText('#stat-alerts', snap.size)));
  unsubscribeList.push(onSnapshot(reportsQ, snap => {
    const since = Date.now() - 24*60*60*1000;
    const rows = snap.docs.map(d=>d.data());
    setText('#stat-incidents', rows.filter(r => ['Incident','Intervention'].includes(r.category) && (r.createdAt?.toDate?.()?.getTime() || 0) > since).length);
  }));
  unsubscribeList.push(onSnapshot(missionsQ, snap => {
    const today = new Date(); today.setHours(0,0,0,0);
    const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate()+1);
    const rows = snap.docs.map(d=>d.data());
    setText('#stat-missions', rows.filter(m => { const start=timestampToDate(m.scheduledStart)?.getTime() || 0; const end=timestampToDate(m.scheduledEnd)?.getTime() || start; return !missionIsDraft(m) && start<tomorrow.getTime() && end>=today.getTime(); }).length);
  }, () => setText('#stat-missions', '0')));
}
function setText(sel, value){ const el=document.querySelector(sel); if(el) el.textContent=value; }
function listenQGReportsFeed(){
  const box = document.querySelector('#qg-reports-feed'); if(!box) return;
  const q = query(collectionRef('reports'), orderBy('createdAt','desc'), limit(3));
  unsubscribeList.push(onSnapshot(q, snap => {
    const rows = snap.docs;
    box.innerHTML = rows.length ? rows.map(d=>reportTimeline(d.data())).join('') : `<div class="empty">Aucun rapport.</div>`;
  }));
}
function listenQGAlertsFeed(){
  const box = document.querySelector('#qg-alerts-feed'); if(!box) return;
  const q = query(collectionRef('alerts'), where('statut','==','active'));
  unsubscribeList.push(onSnapshot(q, snap => {
    if (snap.empty) return box.innerHTML = `<div class="empty">Aucune alerte active.</div>`;
    box.innerHTML = snap.docs.map(d => alertItem({id:d.id,...d.data()}, true)).join('');
    bindAlertActions();
  }));
}
function alertItem(a, compact=false){
  return `<div class="item" style="border-color:rgba(255,46,46,.4)"><div class="item-main"><div class="item-title">🚨 ${safe(a.typeAlerte || 'SOS/PTI')} · ${safe(a.agentNom)}</div><div class="item-meta">Site : ${safe(a.siteActuelNom || a.siteActuel || '—')}<br>Heure : ${dateText(a.heure || a.createdAt)}<br>${a.positionGPS ? `GPS : ${a.positionGPS.lat?.toFixed?.(5)}, ${a.positionGPS.lng?.toFixed?.(5)}` : 'GPS : indisponible'}</div></div><div class="item-actions"><button class="btn small danger" data-take-alert="${safe(a.id)}">Prendre en charge</button><button class="btn small" data-close-alert="${safe(a.id)}">Clôturer</button></div></div>`;
}
async function initQGMap(){
  const el = document.querySelector('#qg-map'); if (!el) return;
  if (!window.L) { el.innerHTML = '<div class="empty" style="margin:20px">Carte indisponible. Connexion CDN Leaflet requise.</div>'; return; }
  if (mapInstance) { try { mapInstance.remove(); } catch(e){} }
  mapMarkers = []; mapBoundsCache = []; mapSitePoints = []; mapAgentPoints = [];
  mapInstance = L.map('qg-map', { zoomControl:false, attributionControl:true }).setView([46.6, 2.4], 5);
  L.control.zoom({ position:'bottomright' }).addTo(mapInstance);
  const light = L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { maxZoom:20, attribution:'© OpenStreetMap © CARTO' }).addTo(mapInstance);
  const dark = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', { maxZoom:20, attribution:'© OpenStreetMap © CARTO' });
  mapSiteLayer = L.layerGroup().addTo(mapInstance);
  mapAgentLayer = L.layerGroup().addTo(mapInstance);
  L.control.layers({ 'Carte claire':light, 'Mode nuit':dark }, { 'Agents en poste':mapAgentLayer, 'Sites':mapSiteLayer }, { collapsed:false, position:'topright' }).addTo(mapInstance);

  const markerIcon = (type, label='', color='') => L.divIcon({
    className:'sp-map-icon-shell',
    html:`<div class="sp-map-marker ${type}" ${color?`style="--marker-color:${safe(color)}"`:''}><span>${safe(label || (type==='agent'?'A':'S'))}</span></div>`,
    iconSize:[46,46], iconAnchor:[23,23], popupAnchor:[0,-26]
  });
  const syncBounds = () => { mapBoundsCache = [...mapSitePoints, ...mapAgentPoints]; };
  const googleLink = (lat,lng) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
  const fitAll = () => {
    if (mapBoundsCache.length) mapInstance.fitBounds(mapBoundsCache, { padding:[42,42], maxZoom:14 });
    else mapInstance.setView([46.6,2.4],5);
  };

  unsubscribeList.push(onSnapshot(collectionRef('sites'), snap => {
    mapSiteLayer.clearLayers();
    mapSitePoints = [];
    snap.docs.forEach(d => {
      const s = { id:d.id, ...d.data() };
      const gps = s.gps || {};
      const lat = Number(gps.lat ?? s.latitude ?? s.lat);
      const lng = Number(gps.lng ?? s.longitude ?? s.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const color = normalizeHexColor(s.planningColor) || planningColorForSite(s.id);
      const label = String(s.name || 'S').trim().slice(0,2).toUpperCase();
      const marker = L.marker([lat,lng], { icon:markerIcon('site', label, color) }).addTo(mapSiteLayer)
        .bindPopup(`<div class="map-popup"><strong>${safe(s.name || 'Site')}</strong><span>${safe(s.clientName || '')}</span><span>${safe(s.address || '')}</span><a href="${googleLink(lat,lng)}" target="_blank" rel="noopener">Ouvrir dans Google Maps</a></div>`);
      mapMarkers.push(marker); mapSitePoints.push([lat,lng]);
    });
    document.querySelector('#map-empty-help')?.classList.toggle('hidden', mapSitePoints.length > 0 || mapAgentPoints.length > 0);
    syncBounds(); setTimeout(fitAll, 80);
  }, ()=>{}));

  const agentPopupHtml = (s, lat, lng, photoDataUrl='', loadingPhoto=false) => `<div class="map-popup agent-map-popup">
    <div class="agent-popup-head"><div><strong>${safe(s.agentNom || 'Agent')}</strong><span>${safe(s.siteNom || 'Site')}</span></div><span class="pill green">En poste</span></div>
    <div class="map-popup-kpis"><div><span>Prise de poste</span><strong>${dateText(s.startTime)}</strong></div><div><span>Depuis</span><strong>${elapsedShiftText(s.startTime)}</strong></div><div><span>Mission</span><strong>${safe(s.shiftType || 'Mission')}</strong></div></div>
    ${loadingPhoto ? '<div class="map-photo-loading">Chargement de la preuve photo...</div>' : photoDataUrl ? `<img class="map-checkin-photo" src="${safe(photoDataUrl)}" alt="Photo de prise de poste">` : '<div class="map-photo-loading">Aucune photo disponible</div>'}
    <a href="${googleLink(lat,lng)}" target="_blank" rel="noopener">Ouvrir dans Google Maps</a>
  </div>`;
  const q = query(collectionRef('shifts'), where('status','==','active'));
  unsubscribeList.push(onSnapshot(q, snap => {
    mapAgentLayer.clearLayers();
    mapAgentPoints = [];
    snap.docs.forEach(d => {
      const s = { id:d.id, ...d.data() }; const gps = s.positionGPS || {};
      const lat = Number(gps.lat); const lng = Number(gps.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const initials = String(s.agentNom || 'A').split(/\s+/).filter(Boolean).slice(0,2).map(x=>x[0]).join('').toUpperCase();
      const marker = L.marker([lat,lng], { icon:markerIcon('agent', initials), title:`${s.agentNom || 'Agent'} · ${s.siteNom || 'Site'}` }).addTo(mapAgentLayer);
      marker.__spShift = s;
      marker.bindTooltip(`${safe(s.agentNom || 'Agent')} · ${safe(s.siteNom || 'Site')}`, { direction:'top', offset:[0,-24], opacity:.94 });
      marker.on('click', event => {
        if (event?.originalEvent) L.DomEvent.stopPropagation(event.originalEvent);
        showAgentOperationalDetails(s, lat, lng);
      });
      mapMarkers.push(marker); mapAgentPoints.push([lat,lng]);
    });
    document.querySelector('#map-empty-help')?.classList.toggle('hidden', mapSitePoints.length > 0 || mapAgentPoints.length > 0);
    syncBounds(); setTimeout(fitAll, 80);
  }));
  document.querySelector('#map-reset')?.addEventListener('click', fitAll);
  document.querySelector('#map-locate')?.addEventListener('click', async()=>{
    const gps = await getGPS({ enableHighAccuracy:true, timeout:10000, maximumAge:0 });
    if (!gps) return toast('Position indisponible ou refusée.', 'warning');
    mapInstance.setView([gps.lat,gps.lng], 15);
    L.circleMarker([gps.lat,gps.lng], { radius:10, color:'#00B8FF', fillColor:'#00B8FF', fillOpacity:.28, weight:3 }).addTo(mapInstance).bindPopup('Votre position').openPopup();
  });
  const stabilizeMap = () => {
    if (!mapInstance) return;
    try {
      mapInstance.invalidateSize(true);
      fitAll();
    } catch(e) {}
  };
  [80, 250, 700, 1400].forEach(ms => setTimeout(stabilizeMap, ms));
  window.addEventListener('resize', () => setTimeout(stabilizeMap, 120), { passive:true });
}
function listenQGMissionsPreview(){
  const box = document.querySelector('#qg-missions-preview'); if (!box) return;
  const q = query(collectionRef('missions'), orderBy('scheduledStart','asc'), limit(8));
  unsubscribeList.push(onSnapshot(q, snap => {
    const rows = snap.docs.map(d=>({id:d.id,...d.data()})).filter(m => !missionIsDraft(m) && !['completed','cancelled'].includes(m.status));
    box.innerHTML = rows.length ? rows.slice(0,5).map(missionItem).join('') : `<div class="empty">Aucune mission à venir.</div>`;
  }, () => box.innerHTML = `<div class="empty">Planning indisponible. Vérifie les RLS Supabase.</div>`));
}

async function renderQGMissions(){
  currentRoute = 'missions';
  const today = new Date();
  const defaultDate = today.toISOString().slice(0,10);
  const body = `<section class="grid cols-2 mission-admin-grid planning-admin-zone">
    <div class="card"><div class="card-title"><div><h2>Créer une mission</h2><p>Planification rapide agent / site / horaires</p></div></div>
      <form id="mission-form">
        <div class="form-grid"><div class="field"><label>Agent</label><select class="select" name="agentId" id="mission-agent" required></select></div><div class="field"><label>Site</label><select class="select" name="siteId" id="mission-site" required></select></div></div>
        <div class="form-grid"><div class="field"><label>Début prévu</label><input class="input" type="datetime-local" name="scheduledStart" required></div><div class="field"><label>Fin prévue</label><input class="input" type="datetime-local" name="scheduledEnd" required></div></div>
        <div class="form-grid"><div class="field"><label>Type de mission</label><select class="select" name="type"><option>Surveillance</option><option>Ronde</option><option>Gardiennage</option><option>Événementiel</option><option>Levée de doute</option><option>Astreinte intervention</option></select></div><div class="field"><label>Répétition</label><select class="select" name="repeatMode" id="mission-repeat"><option value="none">Aucune</option><option value="daily">Tous les jours</option><option value="weekly">Chaque semaine</option></select></div></div>
        <div class="field repeat-count-wrap" style="display:none"><label>Nombre de missions à créer</label><input class="input" type="number" name="repeatCount" min="2" max="31" value="2"></div>
        <div class="field"><label>Consignes mission</label><textarea class="textarea" name="instructions" placeholder="Consignes spécifiques pour cette vacation..."></textarea></div>
        <button class="btn primary full" type="submit">Planifier la mission</button>
      </form>
    </div>
    <div class="card"><div class="card-title"><div><h2>Suivi prioritaire</h2><p>Retards, missions en cours et missions du jour uniquement</p></div></div><div id="missions-live" class="list"><div class="empty">Chargement...</div></div></div>
  </section>
  <section class="card planning-card planning-card-v46" style="margin-top:16px">
    <div class="card-title planning-title"><div><h2>Planning exploitation</h2><p>Vue PC avancée : missions multi-jours, planification rapide et lecture par site ou collaborateur</p></div><div class="btn-row planning-title-actions"><button class="btn small" id="planning-today">Aujourd’hui</button><button class="btn small" id="planning-prev">‹</button><input class="input planning-date" id="planning-date" type="date" value="${defaultDate}"><button class="btn small" id="planning-next">›</button></div></div>
    <div class="planning-toolbar planning-toolbar-v46">
      <div class="segmented"><button class="active" data-planning-mode="sites">Sites</button><button data-planning-mode="agents">Collaborateurs</button></div>
      <div class="field compact-field"><label>Affichage</label><select class="select" id="planning-days"><option value="7">7 jours</option><option value="14" selected>14 jours</option><option value="31">Mois</option></select></div>
      <div class="field compact-field"><label>Statut</label><select class="select" id="planning-status"><option value="">Tous</option><option value="planned">Planifiées</option><option value="active">En cours</option><option value="completed">Terminées</option><option value="cancelled">Annulées</option></select></div>
      <div class="field compact-field"><label>Recherche</label><input class="input" id="planning-search" placeholder="Site, agent, client..."></div>
      <button class="btn primary" id="planning-quick-create" type="button">+ Mission rapide</button>
    </div>
    <div class="planning-helpbar"><span>Lecture compacte : chaque case colorée indique le nombre d’agents prévus sur la journée. Survole-la pour voir leurs noms et horaires, ou clique dessus pour ouvrir le détail. Clique sur une case vide pour créer une mission.</span></div>
    <div id="planning-site-legend" class="planning-site-legend"></div>
    <div id="planning-board" class="planning-board"><div class="empty">Chargement du planning...</div></div>
  </section>
  <section class="card collaborator-planning-card" style="margin-top:16px">
    <div class="card-title"><div><h2>Planning mensuel collaborateur</h2><p>Prépare le mois sans alerter les agents, puis publie-le en une seule fois.</p></div><div class="btn-row"><button class="btn small" id="collaborator-planning-print">Télécharger PDF</button></div></div>
    <div class="collaborator-toolbar"><div class="field"><label>Collaborateur</label><select class="select" id="collaborator-planning-agent"><option value="">Choisir un agent</option></select></div><div class="field"><label>Mois</label><input class="input" id="collaborator-planning-month" type="month" value="${localMonthValue(today)}"></div><button class="btn primary" id="collaborator-planning-add">+ Ajouter une vacation</button></div>
    <div id="monthly-publication-panel" class="monthly-publication-panel"><div class="empty">Chargement du statut mensuel...</div></div>
    <div id="collaborator-planning-summary" class="mission-kpis"></div>
    <div id="collaborator-planning-board" class="collaborator-board"><div class="empty">Choisis un collaborateur.</div></div>
  </section>`;
  render(page('Missions', 'Planning opérationnel et preuve d’exécution', body));
  const [sitesSnap, usersSnap] = await Promise.all([
    getDocs(query(collectionRef('sites'), where('isActive','==',true))).catch(()=>({docs:[]})),
    getDocs(query(collectionRef('users'), where('role','==','agent'))).catch(()=>({docs:[]}))
  ]);
  const sites = sitesSnap.docs.map(d=>({id:d.id,...d.data()}));
  const agents = usersSnap.docs.map(d=>({id:d.id,...d.data()}));
  qgPlanningState.sites = sites;
  qgPlanningState.agents = agents;
  qgPlanningState.startDate = startOfDay(new Date(defaultDate));
  document.querySelector('#mission-site').innerHTML = `<option value="">Choisir un site</option>` + sites.map(s=>`<option value="${safe(s.id)}">${safe(s.name)}</option>`).join('');
  document.querySelector('#mission-agent').innerHTML = `<option value="">Choisir un agent</option>` + agents.map(a=>`<option value="${safe(a.id)}">${safe((a.prenom||'')+' '+(a.nom||''))}</option>`).join('');
  const collaboratorSelect = document.querySelector('#collaborator-planning-agent');
  const requestedAgent = sessionStorage.getItem('sentinellePlanningAgentId') || qgPlanningState.collaboratorAgentId || agents[0]?.id || '';
  if (collaboratorSelect) {
    collaboratorSelect.innerHTML = `<option value="">Choisir un agent</option>` + agents.map(a=>`<option value="${safe(a.id)}" ${a.id===requestedAgent?'selected':''}>${safe(`${a.prenom||''} ${a.nom||''}`.trim() || a.email || a.id)}</option>`).join('');
    qgPlanningState.collaboratorAgentId = collaboratorSelect.value || '';
    sessionStorage.removeItem('sentinellePlanningAgentId');
  }
  qgPlanningState.collaboratorMonth = document.querySelector('#collaborator-planning-month')?.value || localMonthValue(today);
  document.querySelector('#mission-repeat')?.addEventListener('change', e => {
    const wrap = document.querySelector('.repeat-count-wrap');
    if (wrap) wrap.style.display = e.target.value === 'none' ? 'none' : 'block';
  });
  document.querySelector('#mission-form').addEventListener('submit', async e => {
    e.preventDefault();
    const result = await createMissionFromForm(new FormData(e.currentTarget));
    if (result?.ok) { e.currentTarget.reset(); document.querySelector('.repeat-count-wrap')?.style.setProperty('display','none'); }
  });
  bindPlanningControls();
  bindCollaboratorPlanningControls();
  listenMissionsList('#missions-live');
  listenPlanningBoard();
  renderCollaboratorPlanning();
  refreshMonthlyPublicationPanel();
}

function bindPlanningControls(){
  document.querySelectorAll('[data-planning-mode]').forEach(btn => btn.addEventListener('click', () => {
    qgPlanningState.mode = btn.dataset.planningMode;
    document.querySelectorAll('[data-planning-mode]').forEach(b => b.classList.toggle('active', b === btn));
    renderPlanningBoard();
  }));
  document.querySelector('#planning-days')?.addEventListener('change', e => {
    const selectedDays = Number(e.target.value || 14);
    qgPlanningState.days = selectedDays;
    if (selectedDays === 31) {
      const today = new Date();
      const monthStart = startOfDay(new Date(today.getFullYear(), today.getMonth(), 1));
      qgPlanningState.startDate = monthStart;
      const input = document.querySelector('#planning-date');
      if (input) input.value = `${monthStart.getFullYear()}-${String(monthStart.getMonth()+1).padStart(2,'0')}-01`;
    }
    renderPlanningBoard();
  });
  document.querySelector('#planning-status')?.addEventListener('change', e => { qgPlanningState.status = e.target.value || ''; renderPlanningBoard(); });
  document.querySelector('#planning-search')?.addEventListener('input', renderPlanningBoard);
  document.querySelector('#planning-date')?.addEventListener('change', e => { qgPlanningState.startDate = startOfDay(new Date(e.target.value)); renderPlanningBoard(); });
  document.querySelector('#planning-prev')?.addEventListener('click', () => movePlanningDate(-qgPlanningState.days));
  document.querySelector('#planning-next')?.addEventListener('click', () => movePlanningDate(qgPlanningState.days));
  document.querySelector('#planning-today')?.addEventListener('click', () => {
    const next = startOfDay(new Date());
    qgPlanningState.startDate = next;
    const input = document.querySelector('#planning-date');
    if (input) input.value = next.toISOString().slice(0,10);
    renderPlanningBoard();
  });
  document.querySelector('#planning-quick-create')?.addEventListener('click', () => openPlanningQuickMissionModal({}));
}

async function refreshMonthlyPublicationPanel(){
  const box=document.querySelector('#monthly-publication-panel');
  if(!box) return;
  const month=qgPlanningState.collaboratorMonth||document.querySelector('#collaborator-planning-month')?.value||localMonthValue();
  box.innerHTML='<div class="empty">Chargement du statut mensuel...</div>';
  const publication=await getMonthlyPlanningPublication(month,{force:true});
  const range=monthRange(month);
  const monthMissions=qgPlanningState.missions.filter(m=>planningMonthForValue(m.scheduledStart)===month&&!['completed'].includes(m.status));
  const draftRows=monthMissions.filter(m=>missionIsDraft(m));
  const publishedRows=monthMissions.filter(m=>!missionIsDraft(m));
  const confirmationMissions=monthMissions.filter(m=>m.monthlyPlanning===true&&!missionIsDraft(m)&&m.status!=='cancelled');
  const agents=new Set((publication.status==='published'?confirmationMissions:monthMissions.filter(m=>m.status!=='cancelled')).map(m=>m.agentId).filter(Boolean));
  let confirmedCount=0;
  if(publication.status==='published'&&agents.size){
    const checks=await Promise.all([...agents].map(async agentId=>{
      const snap=await getDoc(planningAcknowledgementRef(agentId,month)).catch(()=>null);
      const ack=snap?.exists?.()?snap.data():null;
      const signature=monthlyPlanningSignature(confirmationMissions.filter(m=>m.agentId===agentId));
      return !!ack&&ack.signature===signature;
    }));
    confirmedCount=checks.filter(Boolean).length;
  }
  const label=range.label.charAt(0).toUpperCase()+range.label.slice(1);
  if(publication.status==='draft'){
    box.innerHTML=`<div class="monthly-publication-copy"><span class="planning-publication-badge draft">Brouillon</span><div><strong>${safe(label)} en préparation</strong><p>${draftRows.length} vacation${draftRows.length>1?'s':''} masquée${draftRows.length>1?'s':''} aux agents · aucune notification envoyée.</p></div></div><div class="monthly-publication-stats"><span><strong>${draftRows.length}</strong> brouillons</span><span><strong>${agents.size}</strong> agents concernés</span></div><button class="btn success" id="publish-monthly-planning">Valider et publier le mois</button>`;
    document.querySelector('#publish-monthly-planning')?.addEventListener('click',()=>publishMonthlyPlanning(month));
    return;
  }
  if(publication.status==='published'){
    box.innerHTML=`<div class="monthly-publication-copy"><span class="planning-publication-badge published">Publié</span><div><strong>${safe(label)} publié</strong><p>Publié le ${safe(dateText(publication.publishedAt))}. Les nouvelles modifications sont notifiées uniquement aux agents concernés.</p></div></div><div class="monthly-publication-stats"><span><strong>${publishedRows.length}</strong> vacations visibles</span><span><strong>${agents.size}</strong> agents concernés</span><span><strong>${confirmedCount}/${agents.size}</strong> confirmations</span></div><button class="btn" id="view-monthly-confirmations">Voir les confirmations</button>`;
    document.querySelector('#view-monthly-confirmations')?.addEventListener('click',()=>showMonthlyPlanningConfirmations(month));
    return;
  }
  box.innerHTML=`<div class="monthly-publication-copy"><span class="planning-publication-badge individual">Mode normal</span><div><strong>${safe(label)} n’est pas en préparation</strong><p>Une mission créée maintenant notifiera immédiatement l’agent. Active le brouillon pour construire tout le mois sans alerte.</p></div></div><div class="monthly-publication-stats"><span><strong>${monthMissions.length}</strong> vacations existantes</span><span><strong>${agents.size}</strong> agents concernés</span></div><button class="btn primary" id="start-monthly-planning">Préparer ce mois en brouillon</button>`;
  document.querySelector('#start-monthly-planning')?.addEventListener('click',()=>startMonthlyPlanningDraft(month));
}
async function showMonthlyPlanningConfirmations(month){
  const range=monthRange(month);
  const label=range.label.charAt(0).toUpperCase()+range.label.slice(1);
  const missions=qgPlanningState.missions.filter(m=>planningMonthForValue(m.scheduledStart)===month&&m.monthlyPlanning===true&&m.status!=='cancelled'&&!missionIsDraft(m));
  const agentIds=[...new Set(missions.map(m=>m.agentId).filter(Boolean))];
  if(!agentIds.length) return toast('Aucun agent concerné sur ce mois.','warning');
  const rows=await Promise.all(agentIds.map(async agentId=>{
    const agent=qgPlanningState.agents.find(a=>a.id===agentId)||{};
    const agentMissions=missions.filter(m=>m.agentId===agentId);
    const signature=monthlyPlanningSignature(agentMissions);
    const snap=await getDoc(planningAcknowledgementRef(agentId,month)).catch(()=>null);
    const ack=snap?.exists?.()?snap.data():null;
    return {agentId,name:`${agent.prenom||''} ${agent.nom||''}`.trim()||agent.email||agentId,missionCount:agentMissions.length,confirmed:ack?.signature===signature,confirmedAt:ack?.confirmedAt};
  }));
  showModal(`Confirmations · ${label}`,`<div class="list">${rows.sort((a,b)=>Number(a.confirmed)-Number(b.confirmed)||a.name.localeCompare(b.name,'fr')).map(row=>`<div class="item"><div class="item-main"><div class="item-title">${safe(row.name)} <span class="pill ${row.confirmed?'green':'orange'}">${row.confirmed?'Confirmé':'En attente'}</span></div><div class="item-meta">${row.missionCount} mission${row.missionCount>1?'s':''}${row.confirmedAt?` · confirmation ${safe(dateText(row.confirmedAt))}`:''}</div></div></div>`).join('')}</div>`,'wide');
}

async function startMonthlyPlanningDraft(month){
  const range=monthRange(month);
  const label=range.label.charAt(0).toUpperCase()+range.label.slice(1);
  if(!confirm(`Préparer ${label} en brouillon ? Les vacations planifiées de ce mois seront temporairement masquées aux agents jusqu’à la publication.`)) return;
  const rows=qgPlanningState.missions.filter(m=>planningMonthForValue(m.scheduledStart)===month&&['planned','assigned'].includes(m.status||'planned'));
  try{
    await setDoc(docRef('planningPublications',planningPublicationDocId(month)),{month,status:'draft',version:Math.max(1,Number((await getMonthlyPlanningPublication(month,{force:true}))?.version||0)+1),startedAt:serverTimestamp(),startedBy:currentUser.uid,updatedAt:serverTimestamp(),updatedBy:currentUser.uid},{merge:true});
    await batchUpdateMissionDocuments(rows,row=>({publicationStatus:'draft',planningMonth:month,monthlyPlanning:true,planningRevision:missionRevision(row)+1,acknowledgedAt:null,acknowledgedBy:null,acknowledgedRevision:0,updatedAt:serverTimestamp(),updatedBy:currentUser.uid}));
    qgPlanningState.publications.delete(month);
    await addAudit('monthly_planning_draft_started',{month,missionCount:rows.length});
    toast(`${label} est maintenant en brouillon. Aucune notification ne sera envoyée.`, 'success');
    refreshMonthlyPublicationPanel();
  }catch(error){console.error(error);toast(userFriendlyError(error,'Impossible d’activer le brouillon mensuel.'),'error');}
}
async function publishMonthlyPlanning(month){
  const range=monthRange(month);
  const label=range.label.charAt(0).toUpperCase()+range.label.slice(1);
  const rows=qgPlanningState.missions.filter(m=>planningMonthForValue(m.scheduledStart)===month&&missionIsDraft(m)&&m.status!=='cancelled');
  if(!rows.length) return toast('Aucune vacation brouillon à publier.','warning');
  const agentIds=[...new Set(rows.map(m=>m.agentId).filter(Boolean))];
  if(!confirm(`Publier le planning de ${label} ? ${agentIds.length} agent${agentIds.length>1?'s':''} recevra${agentIds.length>1?'ont':''} une seule notification.`)) return;
  try{
    const publication=await getMonthlyPlanningPublication(month,{force:true});
    const version=Math.max(1,Number(publication?.version||1));
    await batchUpdateMissionDocuments(rows,row=>({publicationStatus:'published',planningMonth:month,monthlyPlanning:true,planningPublicationVersion:version,publishedAt:serverTimestamp(),publishedBy:currentUser.uid,planningRevision:missionRevision(row),acknowledgedAt:null,acknowledgedBy:null,acknowledgedRevision:0,updatedAt:serverTimestamp(),updatedBy:currentUser.uid}));
    await setDoc(docRef('planningPublications',planningPublicationDocId(month)),{month,status:'published',version,missionCount:rows.length,agentCount:agentIds.length,publishedAt:serverTimestamp(),publishedBy:currentUser.uid,updatedAt:serverTimestamp(),updatedBy:currentUser.uid},{merge:true});
    const pushResult=await spNotifyMonthlyPlanningPublished({agentIds,monthValue:month,missionCount:rows.length});
    await addAudit('monthly_planning_published',{month,missionCount:rows.length,agentCount:agentIds.length,pushStatus:pushResult?.ok?'sent':pushResult?.reason||pushResult?.error||'skipped'});
    qgPlanningState.publications.delete(month);
    toast(`Planning de ${label} publié. Une notification unique a été envoyée aux agents concernés.`, 'success');
    if(!pushResult?.ok) toast(`Planning publié, mais notification non envoyée : ${pushResult?.reason||pushResult?.error||'aucun appareil abonné'}.`,'warning');
    refreshMonthlyPublicationPanel();
  }catch(error){console.error(error);toast(userFriendlyError(error,'Publication mensuelle impossible.'),'error');}
}

function bindCollaboratorPlanningControls(){
  document.querySelector('#collaborator-planning-agent')?.addEventListener('change',e=>{qgPlanningState.collaboratorAgentId=e.target.value||'';renderCollaboratorPlanning();});
  document.querySelector('#collaborator-planning-month')?.addEventListener('change',e=>{qgPlanningState.collaboratorMonth=e.target.value||localMonthValue();renderCollaboratorPlanning();refreshMonthlyPublicationPanel();});
  document.querySelector('#collaborator-planning-add')?.addEventListener('click',()=>{
    if(!qgPlanningState.collaboratorAgentId) return toast('Choisis d’abord un collaborateur.','warning');
    const range=monthRange(qgPlanningState.collaboratorMonth||localMonthValue());
    openPlanningQuickMissionModal({resourceId:qgPlanningState.collaboratorAgentId,date:range.start.toISOString().slice(0,10),forceMode:'agents'});
  });
  document.querySelector('#collaborator-planning-print')?.addEventListener('click',()=>{
    if(!qgPlanningState.collaboratorAgentId) return toast('Choisis d’abord un collaborateur.','warning');
    downloadCollaboratorPlanningPdf(qgPlanningState.collaboratorAgentId,qgPlanningState.collaboratorMonth||localMonthValue());
  });
}
function missionSegmentsByDay(mission, rangeStart=null, rangeEnd=null){
  const start=timestampToDate(mission?.scheduledStart), end=timestampToDate(mission?.scheduledEnd);
  if(!start||!end||end<=start) return [];
  let cursor=new Date(Math.max(start.getTime(),rangeStart?.getTime?.()||start.getTime()));
  const hardEnd=new Date(Math.min(end.getTime(),rangeEnd?.getTime?.()||end.getTime()));
  const out=[];
  while(cursor<hardEnd){
    const dayStart=startOfDay(cursor), next=addDays(dayStart,1);
    const segmentEnd=new Date(Math.min(next.getTime(),hardEnd.getTime()));
    out.push({mission,date:dayStart,start:new Date(cursor),end:segmentEnd,minutes:Math.round((segmentEnd-cursor)/60000)});
    cursor=segmentEnd;
  }
  return out;
}
function segmentNightMinutes(segment){
  const day=startOfDay(segment.date);
  const windows=[[day, new Date(day.getFullYear(),day.getMonth(),day.getDate(),6,0,0,0)],[new Date(day.getFullYear(),day.getMonth(),day.getDate(),21,0,0,0),addDays(day,1)]];
  return windows.reduce((sum,[a,b])=>sum+Math.max(0,Math.round((Math.min(segment.end,b)-Math.max(segment.start,a))/60000)),0);
}
function easterSunday(year){
  const a=year%19,b=Math.floor(year/100),c=year%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),month=Math.floor((h+l-7*m+114)/31),day=((h+l-7*m+114)%31)+1;
  return new Date(year,month-1,day);
}
function isFrenchPublicHoliday(date){
  const d=startOfDay(date), y=d.getFullYear(), key=`${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  if(['01-01','05-01','05-08','07-14','08-15','11-01','11-11','12-25'].includes(key)) return true;
  const easter=easterSunday(y);
  return [1,39,50].some(offset=>startOfDay(addDays(easter,offset)).getTime()===d.getTime());
}
function collaboratorPlanningData(){
  const agent=qgPlanningState.agents.find(a=>a.id===qgPlanningState.collaboratorAgentId);
  const range=monthRange(qgPlanningState.collaboratorMonth||localMonthValue());
  const missions=qgPlanningState.missions.filter(m=>m.agentId===agent?.id&&missionOverlapsRange(m,range.start,range.end)).sort((a,b)=>(missionStartMs(a)||0)-(missionStartMs(b)||0));
  const segments=missions.filter(m=>m.status!=='cancelled').flatMap(m=>missionSegmentsByDay(m,range.start,range.end));
  const siteMap=new Map(qgPlanningState.sites.map(site=>[site.id,site]));
  missions.forEach(m=>{if(m.siteId&&!siteMap.has(m.siteId))siteMap.set(m.siteId,{id:m.siteId,name:m.siteNom||m.siteId,planningColor:m.siteColor||null});});
  const sites=[...siteMap.values()].sort((a,b)=>(a.name||'').localeCompare(b.name||'','fr'));
  return {agent,range,missions,segments,sites};
}
function collaboratorCellHtml(site,day,missions,agent){
  const date=new Date(day.getFullYear(),day.getMonth(),day.getDate());
  const dayStart=startOfDay(date),dayEnd=addDays(dayStart,1);
  const segments=missions.filter(m=>m.siteId===site.id&&missionOverlapsRange(m,dayStart,dayEnd)).flatMap(m=>missionSegmentsByDay(m,dayStart,dayEnd));
  const chips=segments.map(seg=>{
    const m=seg.mission; const ack=missionIsAcknowledged(m);
    return `<button class="collaborator-shift ${m.status==='cancelled'?'cancelled':''} ${missionIsDraft(m)?'planning-draft':''}" data-mission-open="${safe(m.id)}" title="${safe(m.siteNom||site.name)} · ${safe(m.agentNom||'')}" style="--mission-color:${normalizeHexColor(m.siteColor)||planningColorForSite(site.id)}"><strong>${safe(timeOnlyText(seg.start))}</strong><span>${safe(timeOnlyText(seg.end))}${seg.end.getDate()!==seg.start.getDate()?' +1':''}</span>${!ack&&m.status!=='cancelled'?'<i title="Non confirmée"></i>':''}</button>`;
  }).join('');
  return `<div class="collaborator-cell ${isToday(date)?'today':''}"><button class="collaborator-cell-add" data-collab-cell="1" data-agent-id="${safe(agent.id)}" data-site-id="${safe(site.id)}" data-date="${date.toISOString().slice(0,10)}" title="Ajouter une vacation">+</button>${chips}</div>`;
}
function renderCollaboratorPlanning(){
  const board=document.querySelector('#collaborator-planning-board');
  const summary=document.querySelector('#collaborator-planning-summary');
  if(!board||!summary) return;
  const {agent,range,missions,segments,sites}=collaboratorPlanningData();
  if(!agent){summary.innerHTML='';board.innerHTML='<div class="empty">Choisis un collaborateur.</div>';return;}
  const totalMinutes=segments.reduce((sum,x)=>sum+x.minutes,0);
  const unread=missions.filter(m=>m.status!=='cancelled'&&!missionIsAcknowledged(m)).length;
  const daily=Array.from({length:range.days},(_,i)=>segments.filter(x=>x.date.getDate()===i+1).reduce((sum,x)=>sum+x.minutes,0));
  summary.innerHTML=`<div class="mini-kpi"><strong>${missions.filter(m=>m.status!=='cancelled').length}</strong><span>Vacations</span></div><div class="mini-kpi blue"><strong>${safe(hoursText(totalMinutes))}</strong><span>Heures prévues</span></div><div class="mini-kpi green"><strong>${new Set(missions.map(m=>m.siteId).filter(Boolean)).size}</strong><span>Sites</span></div><div class="mini-kpi ${unread?'orange':'green'}"><strong>${unread}</strong><span>Non confirmées</span></div>`;
  const days=Array.from({length:range.days},(_,i)=>new Date(range.start.getFullYear(),range.start.getMonth(),i+1));
  const header=`<div class="collaborator-grid collaborator-grid-head" style="--month-days:${range.days}"><div class="collaborator-site-head">Sites</div>${days.map(d=>`<div class="collaborator-day-head ${isToday(d)?'today':''}"><strong>${String(d.getDate()).padStart(2,'0')}</strong><span>${safe(d.toLocaleDateString('fr-FR',{weekday:'short'}).replace('.',''))}</span></div>`).join('')}</div>`;
  const activeSites=sites.length?sites:missions.map(m=>({id:m.siteId,name:m.siteNom})).filter((s,i,a)=>s.id&&a.findIndex(x=>x.id===s.id)===i);
  const rows=activeSites.map(site=>`<div class="collaborator-grid collaborator-grid-row" style="--month-days:${range.days}"><div class="collaborator-site"><i style="background:${planningColorForSite(site.id)}"></i><strong>${safe(site.name||site.id)}</strong><span>${safe(site.clientName||'')}</span></div>${days.map(day=>collaboratorCellHtml(site,day,missions,agent)).join('')}</div>`).join('');
  const totalRow=`<div class="collaborator-grid collaborator-grid-total" style="--month-days:${range.days}"><div class="collaborator-site"><strong>Total heures</strong><span>journalières</span></div>${daily.map(min=>`<div>${min?`${(min/60).toFixed(2)}`:'—'}</div>`).join('')}</div>`;
  const breakdown=planningHourBreakdown(segments);
  const weeks=planningWeeklyTotals(segments);
  board.innerHTML=`<div class="collaborator-scroll">${header}${rows}${totalRow}</div><div class="collaborator-details"><div class="collaborator-breakdown"><h3>Heures planifiées · répartition indicative 21h–6h</h3><div class="table-wrap"><table class="table"><thead><tr><th></th><th>Jour</th><th>Nuit</th><th>Férié jour</th><th>Férié nuit</th></tr></thead><tbody><tr><td>Semaine</td><td>${(breakdown.weekDay/60).toFixed(2)}</td><td>${(breakdown.weekNight/60).toFixed(2)}</td><td>${(breakdown.holidayDay/60).toFixed(2)}</td><td>${(breakdown.holidayNight/60).toFixed(2)}</td></tr><tr><td>Dimanche</td><td>${(breakdown.sundayDay/60).toFixed(2)}</td><td>${(breakdown.sundayNight/60).toFixed(2)}</td><td>—</td><td>—</td></tr><tr><td><strong>Total</strong></td><td colspan="4"><strong>${(totalMinutes/60).toFixed(2)} h</strong></td></tr></tbody></table></div></div><div class="collaborator-breakdown"><h3>Heures hebdomadaires</h3><div class="weekly-total-list">${weeks.map(w=>`<div><span>Semaine ${w.week}</span><strong>${(w.minutes/60).toFixed(2)} h</strong></div>`).join('')||'<div><span>Aucune heure</span><strong>0 h</strong></div>'}</div></div></div>`;
  board.querySelectorAll('[data-mission-open]').forEach(btn=>btn.addEventListener('click',e=>{e.stopPropagation();openPlanningMissionModal(btn.dataset.missionOpen);}));
  board.querySelectorAll('[data-collab-cell]').forEach(btn=>btn.addEventListener('click',()=>openPlanningQuickMissionModal({resourceId:btn.dataset.agentId,date:btn.dataset.date,forceMode:'agents',siteId:btn.dataset.siteId})));
}
function planningHourBreakdown(segments){
  const out={weekDay:0,weekNight:0,sundayDay:0,sundayNight:0,holidayDay:0,holidayNight:0};
  segments.forEach(seg=>{
    const night=Math.min(seg.minutes,segmentNightMinutes(seg)); const day=Math.max(0,seg.minutes-night);
    if(isFrenchPublicHoliday(seg.date)){out.holidayDay+=day;out.holidayNight+=night;}
    else if(seg.date.getDay()===0){out.sundayDay+=day;out.sundayNight+=night;}
    else {out.weekDay+=day;out.weekNight+=night;}
  });
  return out;
}
function isoWeekNumber(date){
  const d=new Date(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate()));
  const day=d.getUTCDay()||7; d.setUTCDate(d.getUTCDate()+4-day);
  const yearStart=new Date(Date.UTC(d.getUTCFullYear(),0,1));
  return Math.ceil((((d-yearStart)/86400000)+1)/7);
}
function planningWeeklyTotals(segments){
  const map=new Map();
  segments.forEach(seg=>{const key=isoWeekNumber(seg.date);map.set(key,(map.get(key)||0)+seg.minutes);});
  return [...map.entries()].sort((a,b)=>a[0]-b[0]).map(([week,minutes])=>({week,minutes}));
}

function movePlanningDate(offsetDays){
  const base = qgPlanningState.startDate || startOfDay(new Date());
  const next = addDays(base, offsetDays);
  qgPlanningState.startDate = next;
  const input = document.querySelector('#planning-date');
  if (input) input.value = next.toISOString().slice(0,10);
  renderPlanningBoard();
}
async function createMissionFromForm(fd, options={}){
  const siteId = fd.get('siteId') || options.siteId;
  const agentId = fd.get('agentId') || options.agentId;
  const site = qgPlanningState.sites.find(s=>s.id===siteId);
  const agent = qgPlanningState.agents.find(a=>a.id===agentId);
  const scheduledStart = fromLocalInputValue(fd.get('scheduledStart'));
  const scheduledEnd = fromLocalInputValue(fd.get('scheduledEnd'));
  if (!site || !agent || !scheduledStart || !scheduledEnd) { toast('Mission incomplète.', 'warning'); return { ok:false }; }
  if ((scheduledEnd.toDate?.()?.getTime() || 0) <= (scheduledStart.toDate?.()?.getTime() || 0)) { toast('La fin doit être après le début.', 'warning'); return { ok:false }; }
  const repeatMode = fd.get('repeatMode') || 'none';
  const repeatCount = repeatMode === 'none' ? 1 : Math.max(2, Math.min(31, Number(fd.get('repeatCount') || 2)));
  const interval = repeatMode === 'weekly' ? 7 : 1;
  const seriesId = repeatCount > 1 ? `serie_${id()}` : null;
  const proposed = Array.from({length:repeatCount},(_,i)=>({start:addDays(scheduledStart.toDate(),i*interval),end:addDays(scheduledEnd.toDate(),i*interval)}));
  const conflicts = proposed.flatMap(period=>missionConflicts(agent.id,period.start,period.end));
  if (conflicts.length && !confirm(`${conflicts.length} conflit(s) de planning détecté(s) pour cet agent. Enregistrer quand même ?`)) return { ok:false };
  const created = [], publishedCreated=[];
  const publicationByMonth=new Map();
  for (let i=0; i<repeatCount; i++){
    const startDate = addDays(scheduledStart.toDate(), i * interval);
    const endDate = addDays(scheduledEnd.toDate(), i * interval);
    const month=localMonthValue(startDate);
    if(!publicationByMonth.has(month)) publicationByMonth.set(month,await getMonthlyPlanningPublication(month));
    const isDraft=publicationByMonth.get(month)?.status==='draft';
    const docPayload = {
      agentId: agent.id, agentNom:`${agent.prenom||''} ${agent.nom||''}`.trim(), siteId: site.id, siteNom:site.name,
      siteColor: normalizeHexColor(site.planningColor) || planningColorForSite(site.id), hourlyRate: Number(site.hourlyRate || 0),
      scheduledStart: Timestamp.fromDate(startDate), scheduledEnd: Timestamp.fromDate(endDate), type:fd.get('type') || 'Surveillance', instructions:fd.get('instructions') || '', status:'planned',
      planningRevision:1, acknowledgedAt:null, acknowledgedBy:null, acknowledgedRevision:0, seriesId, repeatMode: repeatMode === 'none' ? null : repeatMode,
      planningMonth:month, publicationStatus:isDraft?'draft':'published', monthlyPlanning:isDraft,
      createdAt:serverTimestamp(), createdBy:currentUser.uid, updatedAt:serverTimestamp(), updatedBy:currentUser.uid
    };
    const ref=await addDoc(collectionRef('missions'), docPayload);
    created.push(ref); if(!isDraft) publishedCreated.push({ref,start:docPayload.scheduledStart,end:docPayload.scheduledEnd});
  }
  let planningPush={ok:false,skipped:true,reason:'Missions conservées en brouillon mensuel'};
  if(publishedCreated.length){
    planningPush = await spNotifyMissionCreated({ agentId:agent.id, siteName:site.name, start:publishedCreated[0].start, end:publishedCreated.at(-1).end, count:publishedCreated.length, missionId:publishedCreated[0].ref.id });
  }
  const draftCount=created.length-publishedCreated.length;
  await addAudit(repeatCount > 1 ? 'missions_series_created' : 'mission_created', { siteId:site.id, agentId:agent.id, count:repeatCount, draftCount, repeatMode, pushStatus:planningPush?.ok?'sent':planningPush?.reason||planningPush?.error||'skipped' });
  if(draftCount===created.length) toast(repeatCount>1?`${repeatCount} missions ajoutées au brouillon mensuel`:'Mission ajoutée au brouillon mensuel','success');
  else toast(repeatCount > 1 ? `${repeatCount} missions planifiées` : 'Mission planifiée', 'success');
  if(publishedCreated.length&&!planningPush?.ok) toast(`Planning enregistré, mais notification non envoyée : ${planningPush?.reason || planningPush?.error || 'aucun appareil abonné'}.`, 'warning');
  refreshMonthlyPublicationPanel();
  return { ok:true, created, push:planningPush, draftCount };
}
function openPlanningQuickMissionModal({ resourceId='', date=null, forceMode='', siteId='' }={}){
  const mode = forceMode || qgPlanningState.mode || 'sites';
  const clickedDate = date ? startOfDay(new Date(date)) : (qgPlanningState.startDate || startOfDay(new Date()));
  const start = new Date(clickedDate); start.setHours(8,0,0,0);
  const end = new Date(clickedDate); end.setHours(18,0,0,0);
  const prefilledSite = siteId || (mode === 'sites' ? resourceId : '');
  const prefilledAgent = mode === 'agents' ? resourceId : '';
  const siteOptions = `<option value="">Choisir un site</option>` + qgPlanningState.sites.map(s=>`<option value="${safe(s.id)}" ${s.id===prefilledSite?'selected':''}>${safe(s.name)}</option>`).join('');
  const agentOptions = `<option value="">Choisir un agent</option>` + qgPlanningState.agents.map(a=>`<option value="${safe(a.id)}" ${a.id===prefilledAgent?'selected':''}>${safe(`${a.prenom||''} ${a.nom||''}`.trim() || a.email || a.id)}</option>`).join('');
  showModal('Mission rapide', `<form id="planning-quick-form" class="planning-quick-form">
    <div class="setup-box">Création rapide depuis le planning. Les missions de plusieurs jours seront affichées en barre continue sur toutes les cases concernées.</div>
    <div class="form-grid"><div class="field"><label>Agent</label><select class="select" name="agentId" required>${agentOptions}</select></div><div class="field"><label>Site</label><select class="select" name="siteId" required>${siteOptions}</select></div></div>
    <div class="form-grid"><div class="field"><label>Début prévu</label><input class="input" type="datetime-local" name="scheduledStart" value="${toLocalInputValue(start)}" required></div><div class="field"><label>Fin prévue</label><input class="input" type="datetime-local" name="scheduledEnd" value="${toLocalInputValue(end)}" required></div></div>
    <div class="form-grid"><div class="field"><label>Type</label><select class="select" name="type"><option>Surveillance</option><option>Ronde</option><option>Gardiennage</option><option>Événementiel</option><option>Levée de doute</option><option>Astreinte intervention</option></select></div><div class="field"><label>Répétition</label><select class="select" name="repeatMode" id="quick-repeat"><option value="none">Aucune</option><option value="daily">Tous les jours</option><option value="weekly">Chaque semaine</option></select></div></div>
    <div class="field quick-repeat-count" style="display:none"><label>Nombre de missions à créer</label><input class="input" type="number" name="repeatCount" min="2" max="31" value="2"></div>
    <div class="field"><label>Consignes</label><textarea class="textarea" name="instructions" placeholder="Consignes spécifiques..."></textarea></div>
    <button class="btn primary full" type="submit">Créer la mission</button>
  </form>`, 'wide');
  document.querySelector('#quick-repeat')?.addEventListener('change', e => {
    const wrap = document.querySelector('.quick-repeat-count');
    if (wrap) wrap.style.display = e.target.value === 'none' ? 'none' : 'block';
  });
  document.querySelector('#planning-quick-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const result = await createMissionFromForm(new FormData(e.currentTarget));
    if (result?.ok) closeModal();
  });
}
function missionConflicts(agentId,startValue,endValue,excludeId=''){
  const start=timestampToDate(startValue)?.getTime?.() || new Date(startValue).getTime();
  const end=timestampToDate(endValue)?.getTime?.() || new Date(endValue).getTime();
  if(!agentId||!start||!end) return [];
  return qgPlanningState.missions.filter(m=>m.id!==excludeId&&m.agentId===agentId&&m.status!=='cancelled').filter(m=>{
    const ms=missionStartMs(m),me=missionEndMs(m);
    return ms&&me&&ms<end&&me>start;
  });
}
function openPlanningMissionModal(missionId){
  const m = qgPlanningState.missions.find(x=>x.id===missionId) || qgMissionsCache.find(x=>x.id===missionId);
  if (!m) return toast('Mission introuvable.', 'warning');
  const durationDays = missionDurationDays(m);
  const acknowledged=missionIsAcknowledged(m);
  showModal('Détail mission', `<div class="mission-detail-panel">
    <div class="mission-detail-head"><div><h3>${safe(m.siteNom || 'Site')}</h3><p>${safe(m.agentNom || 'Agent')} · ${safe(m.type || 'Mission')}</p></div><span class="pill ${missionStatusColor(m.status)}">${missionStatusLabel(m.status)}</span></div>
    <div class="mission-detail-grid"><div><strong>Début</strong><span>${dateText(m.scheduledStart)}</span></div><div><strong>Fin</strong><span>${dateText(m.scheduledEnd)}</span></div><div><strong>Durée</strong><span>${durationDays > 1 ? `${durationDays} jours` : hoursText(missionDurationMinutes(m))}</span></div><div><strong>Lecture agent</strong><span>${acknowledged?`Confirmée ${dateText(m.acknowledgedAt)}`:'À confirmer'}</span></div></div>
    <div class="setup-box"><strong>Consignes :</strong><br>${safe(m.instructions || 'Aucune consigne spécifique.').replace(/\n/g,'<br>')}</div>
    <div class="grid cols-2"><button class="btn primary" id="mission-detail-edit">Modifier la vacation</button><button class="btn" id="mission-detail-pdf">Rapport PDF</button><button class="btn" id="mission-detail-duplicate-month">Dupliquer sur le mois</button><button class="btn" id="mission-detail-duplicate-day">Dupliquer demain</button>${!['completed','cancelled'].includes(m.status)?`<button class="btn danger" id="mission-detail-cancel">Annuler mission</button>`:''}${isStrictAdmin()?`<button class="btn ghost" id="mission-detail-delete">Supprimer définitivement</button>`:''}</div>
  </div>`, 'wide');
  document.querySelector('#mission-detail-edit')?.addEventListener('click', () => openPlanningMissionEditModal(m));
  document.querySelector('#mission-detail-pdf')?.addEventListener('click', () => printMissionById(m.id));
  document.querySelector('#mission-detail-duplicate-month')?.addEventListener('click', () => duplicateMissionAcrossMonth(m));
  document.querySelector('#mission-detail-duplicate-day')?.addEventListener('click', () => duplicateMissionWithOffset(m, 1));
  document.querySelector('#mission-detail-cancel')?.addEventListener('click', async () => {
    if (!confirm('Annuler cette mission ?')) return;
    await updateDoc(docRef('missions', m.id), { status:'cancelled', planningRevision:missionRevision(m)+1, acknowledgedAt:null, acknowledgedBy:null, acknowledgedRevision:0, updatedAt:serverTimestamp(), updatedBy:currentUser.uid });
    const cancelPush = missionIsDraft(m) ? {ok:false,skipped:true,reason:'Mission en brouillon'} : await spNotifyMissionCancelled(m);
    await addAudit('mission_cancelled', { missionId:m.id, pushStatus:cancelPush?.ok?'sent':cancelPush?.reason||cancelPush?.error||'skipped' });
    closeModal(); toast('Mission annulée', 'warning');
  });
  document.querySelector('#mission-detail-delete')?.addEventListener('click', async()=>{
    if(!isStrictAdmin()||!confirm('Supprimer définitivement cette mission ?')) return;
    await addAudit('mission_deleted',{missionId:m.id,agentId:m.agentId,siteId:m.siteId});
    await deleteDoc(docRef('missions',m.id));
    closeModal();toast('Mission supprimée.','success');
  });
}
function openPlanningMissionEditModal(m){
  if(!m) return;
  const siteOptions=qgPlanningState.sites.map(s=>`<option value="${safe(s.id)}" ${s.id===m.siteId?'selected':''}>${safe(s.name||s.id)}</option>`).join('');
  const agentOptions=qgPlanningState.agents.map(a=>`<option value="${safe(a.id)}" ${a.id===m.agentId?'selected':''}>${safe(`${a.prenom||''} ${a.nom||''}`.trim()||a.email||a.id)}</option>`).join('');
  const types=['Surveillance','Ronde','Gardiennage','Événementiel','Levée de doute','Astreinte intervention'];
  const statuses=[['planned','Planifiée'],['active','En cours'],['completed','Terminée'],['cancelled','Annulée']];
  showModal('Modifier la vacation',`<form id="planning-edit-form">
    <div class="setup-box">En brouillon mensuel, la modification reste silencieuse. Après publication, seul l’agent concerné est notifié.</div>
    <div class="form-grid"><div class="field"><label>Agent</label><select class="select" name="agentId" required>${agentOptions}</select></div><div class="field"><label>Site</label><select class="select" name="siteId" required>${siteOptions}</select></div></div>
    <div class="form-grid"><div class="field"><label>Début prévu</label><input class="input" type="datetime-local" name="scheduledStart" value="${toLocalInputValue(m.scheduledStart)}" required></div><div class="field"><label>Fin prévue</label><input class="input" type="datetime-local" name="scheduledEnd" value="${toLocalInputValue(m.scheduledEnd)}" required></div></div>
    <div class="form-grid"><div class="field"><label>Type</label><select class="select" name="type">${types.map(t=>`<option ${t===(m.type||'Surveillance')?'selected':''}>${safe(t)}</option>`).join('')}</select></div><div class="field"><label>Statut</label><select class="select" name="status">${statuses.map(([v,l])=>`<option value="${v}" ${v===(m.status||'planned')?'selected':''}>${l}</option>`).join('')}</select></div></div>
    <div class="field"><label>Consignes</label><textarea class="textarea" name="instructions">${safe(m.instructions||'')}</textarea></div>
    <button class="btn primary full" type="submit">Enregistrer la vacation</button>
  </form>`,'wide');
  document.querySelector('#planning-edit-form')?.addEventListener('submit',async e=>{
    e.preventDefault();
    const form=e.currentTarget,fd=new FormData(form),btn=form.querySelector('button[type="submit"]');
    const agent=qgPlanningState.agents.find(a=>a.id===fd.get('agentId'));
    const site=qgPlanningState.sites.find(s=>s.id===fd.get('siteId'));
    const start=fromLocalInputValue(fd.get('scheduledStart')),end=fromLocalInputValue(fd.get('scheduledEnd'));
    if(!agent||!site||!start||!end) return toast('Vacation incomplète.','warning');
    if(end.toDate().getTime()<=start.toDate().getTime()) return toast('La fin doit être après le début.','warning');
    const conflicts=missionConflicts(agent.id,start,end,m.id);
    if(conflicts.length&&!confirm(`${conflicts.length} conflit(s) détecté(s) avec d’autres vacations. Enregistrer quand même ?`)) return;
    btn.disabled=true;
    try{
      const oldAgentId=m.agentId;
      const revision=missionRevision(m)+1;
      const targetMonth=planningMonthForValue(start);
      const publication=await getMonthlyPlanningPublication(targetMonth);
      const isDraft=publication?.status==='draft';
      const payload={agentId:agent.id,agentNom:`${agent.prenom||''} ${agent.nom||''}`.trim(),siteId:site.id,siteNom:site.name,siteColor:normalizeHexColor(site.planningColor)||planningColorForSite(site.id),hourlyRate:Number(site.hourlyRate||0),scheduledStart:start,scheduledEnd:end,type:fd.get('type')||'Surveillance',status:fd.get('status')||'planned',instructions:fd.get('instructions')||'',planningMonth:targetMonth,publicationStatus:isDraft?'draft':'published',monthlyPlanning:isDraft||(m.monthlyPlanning===true&&planningMonthForValue(m.scheduledStart)===targetMonth),planningRevision:revision,acknowledgedAt:null,acknowledgedBy:null,acknowledgedRevision:0,updatedAt:serverTimestamp(),updatedBy:currentUser.uid};
      await updateDoc(docRef('missions',m.id),payload);
      let pushResult={ok:false,skipped:true,reason:'Modification conservée en brouillon mensuel'};
      if(!isDraft){
        if(oldAgentId&&oldAgentId!==agent.id){
          if(!missionIsDraft(m)) await spNotifyMissionCancelled({...m,agentId:oldAgentId});
          pushResult=await spNotifyMissionCreated({agentId:agent.id,siteName:site.name,start,end,count:1,missionId:m.id});
        }else pushResult=await spNotifyMissionUpdated({...m,...payload,id:m.id});
      }
      await addAudit('mission_updated',{missionId:m.id,oldAgentId,newAgentId:agent.id,revision,draft:isDraft,pushStatus:pushResult?.ok?'sent':pushResult?.reason||pushResult?.error||'skipped'});
      closeModal();toast(isDraft?'Vacation modifiée dans le brouillon mensuel.':'Vacation modifiée et agent notifié.','success');
      refreshMonthlyPublicationPanel();
    }catch(error){console.error(error);toast(userFriendlyError(error,'Modification impossible.'),'error');btn.disabled=false;}
  });
}

function monthlyMissionOccurrences(m, monthValue){
  const originalStart=timestampToDate(m?.scheduledStart), originalEnd=timestampToDate(m?.scheduledEnd);
  if(!originalStart||!originalEnd||originalEnd<=originalStart||!/^[0-9]{4}-[0-9]{2}$/.test(String(monthValue||''))) return [];
  const range=monthRange(monthValue);
  const durationMs=originalEnd.getTime()-originalStart.getTime();
  const weekday=originalStart.getDay();
  const sameMonth=localMonthValue(originalStart)===monthValue;
  const periods=[];
  for(let day=new Date(range.start);day<range.end;day=addDays(day,1)){
    if(day.getDay()!==weekday) continue;
    const start=new Date(day.getFullYear(),day.getMonth(),day.getDate(),originalStart.getHours(),originalStart.getMinutes(),originalStart.getSeconds(),0);
    const end=new Date(start.getTime()+durationMs);
    if(sameMonth&&start.getTime()<=originalStart.getTime()) continue;
    const exactDuplicate=qgPlanningState.missions.some(row=>
      row.id!==m.id&&row.status!=='cancelled'&&row.agentId===m.agentId&&row.siteId===m.siteId&&
      Math.abs((missionStartMs(row)||0)-start.getTime())<60000&&Math.abs((missionEndMs(row)||0)-end.getTime())<60000
    );
    if(!exactDuplicate) periods.push({start,end});
  }
  return periods;
}

async function duplicateMissionAcrossMonth(m){
  const originalStart=timestampToDate(m?.scheduledStart), originalEnd=timestampToDate(m?.scheduledEnd);
  if(!originalStart||!originalEnd||originalEnd<=originalStart) return toast('Horaire de mission invalide.','error');
  const defaultMonth=localMonthValue(originalStart);
  showModal('Dupliquer sur le mois', `<form id="duplicate-month-form">
    <div class="setup-box"><strong>Répétition hebdomadaire</strong><br>La vacation sera reproduite chaque semaine, le même jour et aux mêmes horaires. La mission d’origine et les vacations déjà existantes ne seront jamais modifiées.</div>
    <div class="field"><label>Mois cible</label><input class="input" type="month" name="month" value="${safe(defaultMonth)}" required></div>
    <div class="setup-box" id="duplicate-month-preview">Calcul des occurrences…</div>
    <button class="btn primary full" type="submit">Créer les duplications du mois</button>
  </form>`);
  const form=document.querySelector('#duplicate-month-form');
  const monthInput=form?.querySelector('[name="month"]');
  const preview=document.querySelector('#duplicate-month-preview');
  const refreshPreview=async()=>{
    const month=String(monthInput?.value||defaultMonth);
    const periods=monthlyMissionOccurrences(m,month);
    const publication=await getMonthlyPlanningPublication(month).catch(()=>null);
    const mode=publication?.status==='draft'?'Brouillon mensuel : aucune notification ne sera envoyée.':'Mois publié ou hors brouillon : une seule notification sera envoyée à l’agent pour toute la série.';
    if(preview) preview.innerHTML=periods.length
      ? `<strong>${periods.length} vacation${periods.length>1?'s':''} à créer</strong><br>${periods.map(period=>dateText(period.start)).join(' · ')}<br><br>${safe(mode)}`
      : '<strong>Aucune nouvelle vacation à créer.</strong><br>Les occurrences identiques déjà présentes sont ignorées.';
  };
  monthInput?.addEventListener('change',()=>refreshPreview());
  refreshPreview();
  form?.addEventListener('submit',async event=>{
    event.preventDefault();
    const button=form.querySelector('button[type="submit"]');
    const month=String(new FormData(form).get('month')||'');
    const periods=monthlyMissionOccurrences(m,month);
    if(!periods.length) return toast('Aucune nouvelle occurrence à créer sur ce mois.','warning');
    const conflicts=periods.flatMap(period=>missionConflicts(m.agentId,period.start,period.end));
    const conflictIds=[...new Set(conflicts.map(row=>row.id).filter(Boolean))];
    if(conflictIds.length&&!confirm(`${conflictIds.length} vacation(s) existante(s) se chevauchent. Créer quand même les nouvelles vacations ?`)) return;
    if(button){button.disabled=true;button.textContent='Duplication en cours...';}
    try{
      const publication=await getMonthlyPlanningPublication(month,{force:true});
      const isDraft=publication?.status==='draft';
      const batch=writeBatch(db);
      const seriesId=`serie_mois_${id()}`;
      const createdIds=[];
      periods.forEach(period=>{
        const ref=doc(collectionRef('missions'));
        createdIds.push(ref.id);
        batch.set(ref,{
          agentId:m.agentId,agentNom:m.agentNom,siteId:m.siteId,siteNom:m.siteNom,siteColor:m.siteColor||planningColorForSite(m.siteId),hourlyRate:Number(m.hourlyRate||0),type:m.type||'Surveillance',instructions:m.instructions||'',
          scheduledStart:Timestamp.fromDate(period.start),scheduledEnd:Timestamp.fromDate(period.end),status:'planned',planningRevision:1,acknowledgedAt:null,acknowledgedBy:null,acknowledgedRevision:0,
          copiedFrom:m.id,seriesId,repeatMode:'weekly_month',planningMonth:month,publicationStatus:isDraft?'draft':'published',monthlyPlanning:isDraft,
          createdAt:serverTimestamp(),createdBy:currentUser.uid,updatedAt:serverTimestamp(),updatedBy:currentUser.uid
        });
      });
      await batch.commit();
      let pushResult={ok:false,skipped:true,reason:'Vacations conservées dans le brouillon mensuel'};
      if(!isDraft){
        pushResult=await spNotifyMissionCreated({agentId:m.agentId,siteName:m.siteNom,start:Timestamp.fromDate(periods[0].start),end:Timestamp.fromDate(periods.at(-1).end),count:periods.length,missionId:createdIds[0]||''});
      }
      await addAudit('missions_month_duplicated',{sourceMissionId:m.id,month,count:periods.length,createdIds,conflictCount:conflictIds.length,draft:isDraft,pushStatus:pushResult?.ok?'sent':pushResult?.reason||pushResult?.error||'skipped'});
      closeModal();
      toast(isDraft?`${periods.length} vacation(s) ajoutée(s) au brouillon mensuel.`:`${periods.length} vacation(s) créée(s). Une notification unique a été envoyée à l’agent.`,'success');
      refreshMonthlyPublicationPanel();
    }catch(error){
      console.error(error);
      toast(userFriendlyError(error,'Duplication mensuelle impossible.'),'error');
      if(button){button.disabled=false;button.textContent='Créer les duplications du mois';}
    }
  });
}

async function duplicateMissionWithOffset(m, days=7){
  const start = m.scheduledStart?.toDate ? addDays(m.scheduledStart.toDate(), days) : addDays(new Date(), days);
  const end = m.scheduledEnd?.toDate ? addDays(m.scheduledEnd.toDate(), days) : addDays(start, 0);
  const month=localMonthValue(start),publication=await getMonthlyPlanningPublication(month),isDraft=publication?.status==='draft';
  const duplicatedRef = await addDoc(collectionRef('missions'), {
    agentId:m.agentId, agentNom:m.agentNom, siteId:m.siteId, siteNom:m.siteNom, siteColor:m.siteColor || planningColorForSite(m.siteId), hourlyRate:Number(m.hourlyRate || 0), type:m.type || 'Surveillance', instructions:m.instructions || '',
    scheduledStart:Timestamp.fromDate(start), scheduledEnd:Timestamp.fromDate(end), status:'planned', planningRevision:1, acknowledgedAt:null, acknowledgedBy:null, acknowledgedRevision:0, copiedFrom:m.id,
    planningMonth:month,publicationStatus:isDraft?'draft':'published',monthlyPlanning:isDraft,
    createdAt:serverTimestamp(), createdBy:currentUser.uid, updatedAt:serverTimestamp(), updatedBy:currentUser.uid
  });
  const planningPush=isDraft?{ok:false,skipped:true,reason:'Mission en brouillon mensuel'}:await spNotifyMissionCreated({ agentId:m.agentId, siteName:m.siteNom, start:Timestamp.fromDate(start), end:Timestamp.fromDate(end), count:1, missionId:duplicatedRef.id });
  await addAudit('mission_duplicated', { missionId:m.id, offsetDays:days, draft:isDraft, pushStatus:planningPush?.ok?'sent':planningPush?.reason||planningPush?.error||'skipped' });
  closeModal(); toast(isDraft?'Mission dupliquée dans le brouillon mensuel.':'Mission dupliquée', 'success'); refreshMonthlyPublicationPanel();
}
function listenPlanningBoard(){
  const q = query(collectionRef('missions'), orderBy('scheduledStart','asc'), limit(1200));
  unsubscribeList.push(onSnapshot(q, snap => {
    qgPlanningState.missions = snap.docs.map(d=>({id:d.id,...d.data()}));
    renderPlanningBoard();
    renderCollaboratorPlanning();
    refreshMonthlyPublicationPanel();
  }, () => {
    const box = document.querySelector('#planning-board');
    if (box) box.innerHTML = `<div class="empty">Planning indisponible. Vérifie les RLS Supabase.</div>`;
  }));
}
function startOfDay(d){
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return startOfDay(new Date());
  x.setHours(0,0,0,0);
  return x;
}
function addDays(d, n){ const x = new Date(d); x.setDate(x.getDate()+n); return x; }
function endOfDay(d){ const x = startOfDay(d); x.setHours(23,59,59,999); return x; }
function planningDateLabel(d){ return d.toLocaleDateString('fr-FR', { day:'2-digit', month:'2-digit' }); }
function planningDayShort(d){ return d.toLocaleDateString('fr-FR', { weekday:'short' }).replace('.', '').toUpperCase(); }
function planningColorForSite(siteId){
  const site = qgPlanningState.sites.find(s => s.id === siteId);
  const explicit = normalizeHexColor(site?.planningColor);
  if (explicit) return explicit;
  const palette = ['#009CFF','#00D084','#FF9F1C','#7C5CFF','#E84DFF','#00B8FF','#FF5C7A','#39C6B3','#F3C543','#6E8BFF'];
  return palette[Math.abs(hashCode(siteId || 'site')) % palette.length];
}
function renderPlanningSiteLegend(){
  const box = document.querySelector('#planning-site-legend');
  if (!box) return;
  const sites = qgPlanningState.sites.slice().sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''),'fr'));
  box.innerHTML = sites.length ? `<span class="planning-legend-title">Code couleur sites</span>${sites.map(site => { const color=planningColorForSite(site.id); return `<span class="planning-site-legend-item"><i style="background:${color}"></i>${safe(site.name || site.id)}</span>`; }).join('')}` : '';
}
function renderPlanningBoard(){
  const box = document.querySelector('#planning-board');
  if (!box) return;
  renderPlanningSiteLegend();
  const start = qgPlanningState.startDate || startOfDay(new Date());
  const days = Number(qgPlanningState.days || 14);
  const dates = Array.from({length:days}, (_,i)=>addDays(start,i));
  const end = endOfDay(dates[dates.length-1]);
  const term = (document.querySelector('#planning-search')?.value || '').toLowerCase();
  const statusFilter = qgPlanningState.status || document.querySelector('#planning-status')?.value || '';
  const mode = qgPlanningState.mode || 'sites';
  const resources = (mode === 'agents' ? qgPlanningState.agents : qgPlanningState.sites)
    .map(r => ({...r, label: mode === 'agents' ? (`${r.prenom || ''} ${r.nom || ''}`.trim() || r.email || r.id) : (r.name || r.siteNom || r.id), sub: mode === 'agents' ? (r.telephone || r.email || '') : (r.clientName || r.address || '') }))
    .filter(r => !term || `${r.label} ${r.sub}`.toLowerCase().includes(term) || qgPlanningState.missions.some(m => `${m.siteNom} ${m.agentNom} ${m.type} ${m.status}`.toLowerCase().includes(term) && ((mode==='agents' && m.agentId===r.id) || (mode==='sites' && m.siteId===r.id))));
  const rangeMissions = qgPlanningState.missions.filter(m => {
    if (statusFilter && m.status !== statusFilter) return false;
    if (['cancelled'].includes(m.status) && statusFilter !== 'cancelled') return false;
    const ms = missionStartMs(m), me = missionEndMs(m);
    return ms && me && ms <= end.getTime() && me >= start.getTime();
  });
  const header = `<div class="planning-grid planning-header" style="--days:${days}"><div class="planning-resource-head">${mode === 'agents' ? 'Collaborateurs' : 'Sites'}</div>${dates.map(d=>`<div class="planning-day-head ${isToday(d)?'today':''}"><strong>${planningDateLabel(d)}</strong><span>${planningDayShort(d)}</span></div>`).join('')}</div>`;
  const rows = resources.map(res => planningResourceRow({ res, mode, dates, start, end, days, rangeMissions })).join('');
  const emptyRows = resources.length ? '' : `<div class="empty">Aucun ${mode === 'agents' ? 'collaborateur' : 'site'} à afficher.</div>`;
  box.innerHTML = `<div class="planning-scroll planning-scroll-v46">${header}${rows || emptyRows}</div>`;
  bindPlanningBoardActions();
}
function planningResourceRow({ res, mode, dates, start, end, days, rangeMissions }){
  const missions = rangeMissions
    .filter(m => (mode === 'agents' && m.agentId === res.id) || (mode === 'sites' && m.siteId === res.id))
    .sort((a,b)=>(missionStartMs(a)||0)-(missionStartMs(b)||0));
  if (mode === 'sites') return planningSiteSummaryRow({ res, dates, days, missions });
  const items = missions.map(m => planningMissionSpan(m, start, days)).filter(Boolean);
  assignPlanningTracks(items);
  const tracks = Math.max(1, ...items.map(i=>i.track + 1));
  const cells = dates.map((d,i)=>`<button type="button" class="planning-bg-cell ${isToday(d)?'today':''}" style="grid-column:${i+1};grid-row:1 / span ${tracks}" data-planning-cell="1" data-resource-id="${safe(res.id)}" data-date="${d.toISOString().slice(0,10)}" title="Créer une mission le ${planningDateLabel(d)}"><span>+</span></button>`).join('');
  const bars = items.map(item => planningMissionBar(item, mode)).join('');
  return `<div class="planning-row-v46" style="--days:${days};--tracks:${tracks}"><div class="planning-resource planning-resource-v46"><strong>${safe(res.label)}</strong><span>${safe(res.sub || '—')}</span><em>${missions.length} mission${missions.length>1?'s':''}</em></div><div class="planning-lane" style="--days:${days};--tracks:${tracks}">${cells}${bars}</div></div>`;
}
function planningSiteSummaryRow({ res, dates, days, missions }){
  const siteColor = planningColorForSite(res.id);
  const textColor = contrastColor(siteColor);
  const cells = dates.map((date,index) => {
    const dayMissions = planningMissionsForDay(missions, date);
    if (!dayMissions.length) {
      return `<button type="button" class="planning-bg-cell planning-summary-empty ${isToday(date)?'today':''}" style="grid-column:${index+1};grid-row:1" data-planning-cell="1" data-resource-id="${safe(res.id)}" data-date="${date.toISOString().slice(0,10)}" title="Créer une mission le ${planningDateLabel(date)}"><span>+</span></button>`;
    }
    const agentKeys = new Set(dayMissions.map(m => String(m.agentId || m.agentNom || m.id || '')).filter(Boolean));
    const agentCount = Math.max(1, agentKeys.size);
    const missionIds = dayMissions.map(m=>m.id).filter(Boolean).join(',');
    const anyLate = dayMissions.some(m=>missionIsLate(m));
    const anyDraft = dayMissions.some(m=>missionIsDraft(m));
    const allCompleted = dayMissions.every(m=>m.status==='completed');
    const accessible = `${agentCount} agent${agentCount>1?'s':''} prévu${agentCount>1?'s':''} le ${planningDateLabel(date)}. Survoler pour le détail.`;
    return `<button type="button" class="planning-day-summary site-color ${isToday(date)?'today':''} ${anyLate?'late':''} ${anyDraft?'has-draft':''} ${allCompleted?'status-completed':''}" style="grid-column:${index+1};grid-row:1;--site-color:${siteColor};--site-text:${textColor}" data-planning-day-summary="1" data-resource-id="${safe(res.id)}" data-date="${date.toISOString().slice(0,10)}" data-mission-ids="${safe(missionIds)}" aria-label="${safe(accessible)}"><strong>${agentCount}</strong><span>agent${agentCount>1?'s':''}</span></button>`;
  }).join('');
  const totalAgents = new Set(missions.map(m=>String(m.agentId || m.agentNom || '')).filter(Boolean)).size;
  return `<div class="planning-row-v46 planning-row-summary" style="--days:${days};--tracks:1"><div class="planning-resource planning-resource-v46 planning-resource-summary" style="--resource-color:${siteColor}"><i class="planning-resource-color" style="background:${siteColor}"></i><strong>${safe(res.label)}</strong><span>${safe(res.sub || '—')}</span><em>${totalAgents} agent${totalAgents>1?'s':''} · ${missions.length} mission${missions.length>1?'s':''}</em></div><div class="planning-lane planning-lane-summary" style="--days:${days};--tracks:1">${cells}</div></div>`;
}
function planningMissionsForDay(missions, date){
  const dayStart = startOfDay(date).getTime();
  const nextDayStart = addDays(startOfDay(date),1).getTime();
  return missions.filter(m => {
    const start = missionStartMs(m), end = missionEndMs(m);
    return start && end && start < nextDayStart && end > dayStart;
  }).sort((a,b)=>(missionStartMs(a)||0)-(missionStartMs(b)||0));
}
function planningMissionTimeLabel(m){
  const start = m.scheduledStart?.toDate?.();
  const end = m.scheduledEnd?.toDate?.();
  if (!start) return 'Horaire indisponible';
  const startText = start.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'});
  const endText = end ? end.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}) : '--:--';
  const extraDays = end ? Math.max(0, Math.round((startOfDay(end).getTime()-startOfDay(start).getTime())/86400000)) : 0;
  return `${startText} – ${endText}${extraDays?` (+${extraDays}j)`:''}`;
}
function planningMissionIdsFromButton(button){
  return String(button?.dataset?.missionIds || '').split(',').map(id=>id.trim()).filter(Boolean);
}
function planningMissionsFromSummaryButton(button){
  const ids = new Set(planningMissionIdsFromButton(button));
  return qgPlanningState.missions.filter(m=>ids.has(String(m.id))).sort((a,b)=>(missionStartMs(a)||0)-(missionStartMs(b)||0));
}
function ensurePlanningHoverCard(){
  let card = document.querySelector('#planning-hover-card');
  if (card) return card;
  card = document.createElement('div');
  card.id = 'planning-hover-card';
  card.className = 'planning-hover-card';
  card.setAttribute('role','tooltip');
  document.body.appendChild(card);
  return card;
}
function positionPlanningHoverCard(card, button, pointer=null){
  if (!card || !button) return;
  const margin = 12;
  const rect = button.getBoundingClientRect();
  const width = Math.min(340, Math.max(250, card.offsetWidth || 290));
  let left = pointer?.clientX != null ? pointer.clientX + 14 : rect.left + rect.width/2 - width/2;
  left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
  let top = pointer?.clientY != null ? pointer.clientY + 16 : rect.bottom + 10;
  const height = card.offsetHeight || 160;
  if (top + height > window.innerHeight - margin) top = Math.max(margin, rect.top - height - 10);
  card.style.left = `${Math.round(left)}px`;
  card.style.top = `${Math.round(top)}px`;
}
function showPlanningHoverCard(button, pointer=null){
  const missions = planningMissionsFromSummaryButton(button);
  if (!missions.length) return;
  const card = ensurePlanningHoverCard();
  const site = qgPlanningState.sites.find(s=>s.id===button.dataset.resourceId);
  const date = new Date(`${button.dataset.date}T12:00:00`);
  const rows = missions.map(m=>`<div class="planning-hover-row"><div><strong>${safe(m.agentNom || 'Agent')}</strong><span>${safe(m.type || 'Mission')} · ${safe(missionStatusLabel(m.status))}${missionIsDraft(m)?' · Brouillon':''}</span></div><time>${safe(planningMissionTimeLabel(m))}</time></div>`).join('');
  card.innerHTML = `<div class="planning-hover-head"><div><strong>${safe(site?.name || site?.siteNom || 'Site')}</strong><span>${safe(planningDateLabel(date))} · ${missions.length} mission${missions.length>1?'s':''}</span></div></div><div class="planning-hover-list">${rows}</div><small>Clique pour ouvrir le détail de la journée.</small>`;
  card.classList.add('visible');
  card.setAttribute('aria-hidden','false');
  requestAnimationFrame(()=>positionPlanningHoverCard(card,button,pointer));
}
function hidePlanningHoverCard(){
  const card = document.querySelector('#planning-hover-card');
  if (!card) return;
  card.classList.remove('visible');
  card.setAttribute('aria-hidden','true');
}
function openPlanningDaySummaryModal(button){
  const missions = planningMissionsFromSummaryButton(button);
  if (!missions.length) return;
  if (missions.length === 1) return openPlanningMissionModal(missions[0].id);
  const site = qgPlanningState.sites.find(s=>s.id===button.dataset.resourceId);
  const date = new Date(`${button.dataset.date}T12:00:00`);
  const rows = missions.map(m=>`<button type="button" class="item planning-day-modal-item" data-day-mission-open="${safe(m.id)}"><div class="item-main"><div class="item-title">${safe(m.agentNom || 'Agent')} <span class="pill ${missionStatusColor(m.status)}">${safe(missionStatusLabel(m.status))}</span></div><div class="item-meta">${safe(planningMissionTimeLabel(m))}<br>${safe(m.type || 'Mission')}</div></div><span aria-hidden="true">›</span></button>`).join('');
  showModal(`Planning du ${planningDateLabel(date)}`, `<div class="setup-box"><strong>${safe(site?.name || site?.siteNom || 'Site')}</strong><br>${missions.length} mission${missions.length>1?'s':''} sur cette journée.</div><div class="list planning-day-modal-list">${rows}</div><button type="button" class="btn primary full" id="planning-day-add-mission">+ Ajouter une mission sur ce jour</button>`);
  document.querySelectorAll('[data-day-mission-open]').forEach(row=>row.addEventListener('click',()=>openPlanningMissionModal(row.dataset.dayMissionOpen)));
  document.querySelector('#planning-day-add-mission')?.addEventListener('click',()=>openPlanningQuickMissionModal({resourceId:button.dataset.resourceId,date:button.dataset.date}));
}
function missionStartMs(m){ return m.scheduledStart?.toDate?.()?.getTime() || null; }
function missionEndMs(m){
  const start = missionStartMs(m);
  const end = m.scheduledEnd?.toDate?.()?.getTime() || start;
  return end || null;
}
function missionDurationDays(m){
  const s = missionStartMs(m), e = missionEndMs(m);
  if (!s || !e) return 1;
  const a = startOfDay(new Date(s)).getTime();
  const b = startOfDay(new Date(e)).getTime();
  return Math.max(1, Math.floor((b - a) / 86400000) + 1);
}
function planningMissionSpan(m, rangeStart, days){
  const ms = missionStartMs(m), me = missionEndMs(m);
  if (!ms || !me) return null;
  const rangeStartMs = startOfDay(rangeStart).getTime();
  const rangeEndMs = endOfDay(addDays(rangeStart, days-1)).getTime();
  if (ms > rangeEndMs || me < rangeStartMs) return null;
  const colStart = Math.max(1, Math.floor((startOfDay(new Date(ms)).getTime() - rangeStartMs) / 86400000) + 1);
  const colEnd = Math.min(days, Math.floor((startOfDay(new Date(me)).getTime() - rangeStartMs) / 86400000) + 1);
  return { mission:m, colStart, colEnd, span:Math.max(1, colEnd - colStart + 1), track:0 };
}
function assignPlanningTracks(items){
  const tracks = [];
  items.forEach(item => {
    let track = tracks.findIndex(lastEnd => item.colStart > lastEnd);
    if (track === -1) { track = tracks.length; tracks.push(0); }
    item.track = track;
    tracks[track] = item.colEnd;
  });
}
function planningMissionBar(item, mode){
  const m = item.mission;
  const start = m.scheduledStart?.toDate?.(); const end = m.scheduledEnd?.toDate?.();
  const time = start ? start.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'}) : '--:--';
  const fin = end ? end.toLocaleTimeString('fr-FR', {hour:'2-digit', minute:'2-digit'}) : '--:--';
  const label = mode === 'agents' ? (m.siteNom || 'Site') : (m.agentNom || 'Agent');
  const days = missionDurationDays(m);
  const siteColor = normalizeHexColor(m.siteColor) || planningColorForSite(m.siteId);
  const textColor = contrastColor(siteColor);
  const late = missionIsLate(m);
  const status = late ? 'Retard' : missionStatusLabel(m.status);
  return `<button type="button" class="planning-mission planning-mission-bar site-color status-${safe(m.status || 'planned')} ${late?'late':''} ${missionIsDraft(m)?'planning-draft':''}" style="grid-column:${item.colStart} / span ${item.span};grid-row:${item.track+1};--site-color:${siteColor};--site-text:${textColor}" data-mission-open="${safe(m.id)}" title="${safe(label)} · ${safe(m.type || 'Mission')}"><strong>${safe(time)}-${safe(fin)}</strong><span>${safe(label)}</span><small>${missionIsDraft(m)?'Brouillon · ':''}${safe(status)}${days>1?` · ${days}j`:''}</small></button>`;
}
function bindPlanningBoardActions(){
  const root = document.querySelector('#planning-board');
  if (!root) return;
  hidePlanningHoverCard();
  root.querySelectorAll('[data-mission-open]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    openPlanningMissionModal(btn.dataset.missionOpen);
  }));
  root.querySelectorAll('[data-planning-day-summary]').forEach(btn => {
    btn.addEventListener('mouseenter', e=>showPlanningHoverCard(btn,e));
    btn.addEventListener('mousemove', e=>positionPlanningHoverCard(document.querySelector('#planning-hover-card'),btn,e));
    btn.addEventListener('mouseleave', hidePlanningHoverCard);
    btn.addEventListener('focus', ()=>showPlanningHoverCard(btn));
    btn.addEventListener('blur', hidePlanningHoverCard);
    btn.addEventListener('click', e=>{
      e.stopPropagation();
      hidePlanningHoverCard();
      openPlanningDaySummaryModal(btn);
    });
  });
  root.querySelectorAll('[data-planning-cell]').forEach(btn => btn.addEventListener('click', e => {
    e.stopPropagation();
    openPlanningQuickMissionModal({ resourceId:btn.dataset.resourceId, date:btn.dataset.date });
  }));
}
function isToday(d){
  const a = startOfDay(d).getTime();
  const b = startOfDay(new Date()).getTime();
  return a === b;
}
function planningMissionChip(m, mode, rowIndex=0){
  const item = planningMissionSpan(m, startOfDay(m.scheduledStart?.toDate?.() || new Date()), 1) || { mission:m, colStart:1, span:1, track:0 };
  return planningMissionBar(item, mode);
}

function hashCode(value){
  return String(value).split('').reduce((acc,ch)=>((acc<<5)-acc)+ch.charCodeAt(0),0);
}

function listenMissionsList(selector){
  const box = document.querySelector(selector); if (!box) return;
  const q = query(collectionRef('missions'), orderBy('scheduledStart','desc'), limit(100));
  unsubscribeList.push(onSnapshot(q, snap => {
    const rows = snap.docs.map(d=>({id:d.id,...d.data()}));
    qgMissionsCache = rows;
    const today = startOfDay(new Date()).getTime();
    const tomorrow = endOfDay(new Date()).getTime();
    const priorityRows = rows.filter(m => {
      if(missionIsDraft(m)) return false;
      const start = missionStartMs(m) || 0;
      return m.status === 'active' || missionIsLate(m) || (start >= today && start <= tomorrow && !['completed','cancelled'].includes(m.status));
    }).slice(0, 3);
    box.innerHTML = priorityRows.length ? priorityRows.map(missionItem).join('') : `<div class="empty">Aucune mission prioritaire. Le planning complet reste visible en dessous.</div>`;
    document.querySelectorAll('[data-mission-cancel]').forEach(btn => btn.addEventListener('click', async () => {
      if (!confirm('Annuler cette mission ?')) return;
      const cancelledMission = rows.find(m => m.id === btn.dataset.missionCancel);
      await updateDoc(docRef('missions', btn.dataset.missionCancel), { status:'cancelled', updatedAt:serverTimestamp(), updatedBy:currentUser.uid });
      const cancelPush = missionIsDraft(cancelledMission) ? {ok:false,skipped:true,reason:'Mission en brouillon'} : await spNotifyMissionCancelled(cancelledMission);
      await addAudit('mission_cancelled', { missionId:btn.dataset.missionCancel, pushStatus:cancelPush?.ok?'sent':cancelPush?.reason||cancelPush?.error||'skipped' });
      toast('Mission annulée', 'warning');
    }));
    document.querySelectorAll('[data-mission-pdf]').forEach(btn => btn.addEventListener('click', () => printMissionById(btn.dataset.missionPdf)));
    document.querySelectorAll('[data-mission-duplicate]').forEach(btn => btn.addEventListener('click', () => duplicateMissionAcrossMonth(rows.find(m=>m.id===btn.dataset.missionDuplicate))));
  }, () => box.innerHTML = `<div class="empty">Missions indisponibles. Vérifie les RLS Supabase.</div>`));
}
async function duplicateMissionFlow(m){
  if (!m) return;
  const nextStart = m.scheduledStart?.toDate ? addDays(m.scheduledStart.toDate(), 7) : addDays(new Date(), 1);
  const nextEnd = m.scheduledEnd?.toDate ? addDays(m.scheduledEnd.toDate(), 7) : addDays(nextStart, 0);
  showModal('Dupliquer mission', `<form id="duplicate-mission-form"><div class="setup-box">Duplique cette vacation pour accélérer la planification PC.</div><div class="form-grid"><div class="field"><label>Nouveau début</label><input class="input" type="datetime-local" name="scheduledStart" value="${toLocalInputValue(nextStart)}" required></div><div class="field"><label>Nouvelle fin</label><input class="input" type="datetime-local" name="scheduledEnd" value="${toLocalInputValue(nextEnd)}" required></div></div><button class="btn primary full" type="submit">Créer la copie</button></form>`);
  document.querySelector('#duplicate-mission-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const scheduledStart = fromLocalInputValue(fd.get('scheduledStart'));
    const scheduledEnd = fromLocalInputValue(fd.get('scheduledEnd'));
    const month=planningMonthForValue(scheduledStart),publication=await getMonthlyPlanningPublication(month),isDraft=publication?.status==='draft';
    const duplicatedRef = await addDoc(collectionRef('missions'), {
      agentId:m.agentId, agentNom:m.agentNom, siteId:m.siteId, siteNom:m.siteNom, siteColor:m.siteColor || planningColorForSite(m.siteId), hourlyRate:Number(m.hourlyRate || 0), type:m.type || 'Surveillance', instructions:m.instructions || '',
      scheduledStart, scheduledEnd, status:'planned', planningRevision:1, acknowledgedAt:null, acknowledgedBy:null, acknowledgedRevision:0, copiedFrom:m.id, planningMonth:month,publicationStatus:isDraft?'draft':'published',monthlyPlanning:isDraft, createdAt:serverTimestamp(), createdBy:currentUser.uid, updatedAt:serverTimestamp(), updatedBy:currentUser.uid
    });
    const planningPush = isDraft?{ok:false,skipped:true,reason:'Mission en brouillon mensuel'}:await spNotifyMissionCreated({ agentId:m.agentId, siteName:m.siteNom, start:scheduledStart, end:scheduledEnd, count:1, missionId:duplicatedRef.id });
    await addAudit('mission_duplicated', { missionId:m.id, draft:isDraft, pushStatus:planningPush?.ok?'sent':planningPush?.reason||planningPush?.error||'skipped' });
    closeModal();
    toast(isDraft?'Mission dupliquée dans le brouillon mensuel.':'Mission dupliquée', 'success'); refreshMonthlyPublicationPanel();
  });
}
function missionItem(m){
  const late = missionIsLate(m);
  const color = missionIsDraft(m) ? 'blue' : (late ? 'red' : missionStatusColor(m.status));
  const delay = m.actualStart && m.scheduledStart ? Math.round(((m.actualStart.toDate?.()?.getTime()||0) - (m.scheduledStart.toDate?.()?.getTime()||0))/60000) : null;
  return `<div class="item mission-row ${late?'late':''}"><div class="item-main"><div class="item-title">${safe(m.siteNom)} · ${safe(m.agentNom)} <span class="pill ${color}">${missionIsDraft(m)?'Brouillon':(late?'Retard':missionStatusLabel(m.status))}</span></div><div class="item-meta">Prévu : ${dateText(m.scheduledStart)} → ${dateText(m.scheduledEnd)}<br>Type : ${safe(m.type || 'Mission')} ${delay!==null ? `<br>Pointage : ${delay>0?`+${delay} min`:`${delay} min`}`:''}${typeof m.conformityScore==='number'?`<br>Conformité : ${m.conformityScore}%`:''}</div></div><div class="item-actions"><button class="btn small" data-mission-pdf="${safe(m.id)}">Rapport PDF</button><button class="btn small ghost" data-mission-duplicate="${safe(m.id)}">Dupliquer sur le mois</button>${!['completed','cancelled'].includes(m.status)?`<button class="btn small ghost" data-mission-cancel="${safe(m.id)}">Annuler</button>`:''}</div></div>`;
}
function renderQGNotifications(){
  currentRoute = 'notifications';
  const body = `<section class="card"><div class="card-title"><div><h2>Centre de notifications QG</h2><p>Prises de poste, retards, inactivité, SOS et non-conformités</p></div><button class="btn small ghost" id="qg-clear-notifications" type="button">Effacer les notifications</button></div><div class="setup-box">Ce bouton vide uniquement le centre de notifications. Il ne supprime aucune mission, main courante, alerte SOS ni donnée opérationnelle.</div><div id="notifications-list" class="list"><div class="empty">Chargement...</div></div></section>`;
  render(page('Notifications QG', 'Suivi opérationnel calculé en temps réel', body));
  listenQGNotifications('#notifications-list', 100);
  bindQGNotificationClearButton('#qg-clear-notifications');
}
function qgNotificationEventMs(value){
  return timestampToDate(value)?.getTime?.() || 0;
}
function bindQGNotificationClearButton(selector){
  document.querySelector(selector)?.addEventListener('click',clearQGNotifications);
}
async function clearQGNotifications(){
  if(!currentUser||!roleAllowedAdmin()) return;
  if(!confirm('Effacer les notifications actuellement visibles ? Les missions, rapports et alertes ne seront pas supprimés.')) return;
  try{
    qgNotificationClearedAt=Date.now();
    await setDoc(docRef('qgNotificationStates',currentUser.uid),{userId:currentUser.uid,clearedAt:serverTimestamp(),updatedAt:serverTimestamp(),updatedBy:currentUser.uid},{merge:true});
    await addAudit('qg_notifications_cleared',{clearedAt:new Date().toISOString()});
    toast('Centre de notifications vidé. Les nouveaux événements apparaîtront automatiquement.','success');
  }catch(error){
    console.error(error);
    toast(userFriendlyError(error,'Impossible d’effacer les notifications.'),'error');
  }
}
function listenQGNotifications(selector, max=10){
  const box = document.querySelector(selector); if (!box) return;
  const state = { missions:[], shifts:[], users:[], alerts:[], reports:[], flash:[], clearedAt:qgNotificationClearedAt };
  const redraw = () => {
    const rows = buildQGNotifications(state).slice(0,max);
    qgNotificationsCache = rows;
    box.innerHTML = rows.length ? rows.map(notificationItem).join('') : `<div class="empty">Aucune nouvelle notification opérationnelle.</div>`;
  };
  const bind = (name, q) => unsubscribeList.push(onSnapshot(q, snap => { state[name] = snap.docs.map(d=>({id:d.id,...d.data()})); redraw(); }, redraw));
  bind('missions', query(collectionRef('missions'), orderBy('scheduledStart','desc'), limit(200)));
  bind('shifts', query(collectionRef('shifts'), orderBy('createdAt','desc'), limit(200)));
  bind('users', query(collectionRef('users'), limit(200)));
  bind('alerts', query(collectionRef('alerts'), orderBy('createdAt','desc'), limit(100)));
  bind('reports', query(collectionRef('reports'), orderBy('createdAt','desc'), limit(100)));
  bind('flash', query(collectionRef('flashMessages'), orderBy('sentAt','desc'), limit(30)));
  const stateRef=docRef('qgNotificationStates',currentUser.uid);
  unsubscribeList.push(onSnapshot(stateRef,snap=>{
    const clearMs=snap.exists()?qgNotificationEventMs(snap.data().clearedAt):0;
    qgNotificationClearedAt=Math.max(qgNotificationClearedAt,clearMs);
    state.clearedAt=qgNotificationClearedAt;
    redraw();
  },redraw));
}
function buildQGNotifications(state){
  const now = Date.now();
  const rows = [];
  state.shifts.forEach(shift=>{
    const startedAt=qgNotificationEventMs(shift.startTime||shift.createdAt);
    if(startedAt&&now-startedAt<=48*60*60*1000) rows.push({
      id:`shift_start_${shift.id}`,level:'blue',eventAt:startedAt,
      title:`Prise de poste · ${shift.agentNom||'Agent'}`,
      meta:`${shift.siteNom||'Site'} · ${dateText(shift.startTime||shift.createdAt)}`,
      body:shift.missionTitle?`Mission : ${shift.missionTitle}`:'Prise de poste libre enregistrée.'
    });
    const completedAt=qgNotificationEventMs(shift.completedAt);
    if(completedAt&&now-completedAt<=48*60*60*1000) rows.push({
      id:`shift_end_${shift.id}`,level:'blue',eventAt:completedAt,
      title:`Fin de poste · ${shift.agentNom||'Agent'}`,
      meta:`${shift.siteNom||'Site'} · ${dateText(shift.completedAt)}`,
      body:`Clôture confirmée · ${shift.reportsCount||0} rapport(s) · ${shift.roundsCount||0} ronde(s) · ${shift.incidentsCount||0} événement(s).`
    });
  });
  state.alerts.filter(a => ['active','taken'].includes(a.statut)).forEach(a => rows.push({id:`alert_${a.id}`,level:'red',eventAt:qgNotificationEventMs(a.createdAt||a.heure),title:`SOS/PTI actif · ${a.agentNom || 'Agent'}`, meta:`${a.siteActuelNom || 'Site'} · ${dateText(a.createdAt || a.heure)}`, body:a.message || 'Alerte critique en cours'}));
  state.missions.filter(m=>!missionIsDraft(m)).forEach(m => {
    const start = qgNotificationEventMs(m.scheduledStart); const end = qgNotificationEventMs(m.scheduledEnd);
    if (start && now > start + 10*60000 && !['active','completed','cancelled'].includes(m.status)) rows.push({id:`mission_late_${m.id}`,level:'red',eventAt:start,title:`Prise de poste en retard · ${m.agentNom}`, meta:`${m.siteNom} · prévu ${dateText(m.scheduledStart)}`, body:'Mission non démarrée dans le délai prévu.'});
    if (end && now > end + 15*60000 && m.status === 'active') rows.push({id:`mission_open_${m.id}`,level:'orange',eventAt:end,title:`Mission non clôturée · ${m.agentNom}`, meta:`${m.siteNom} · fin prévue ${dateText(m.scheduledEnd)}`, body:'La mission dépasse son horaire de fin sans clôture.'});
  });
  state.users.filter(u => u.statut === 'en_poste').forEach(u => {
    const last = qgNotificationEventMs(u.lastSeen);
    if (last && now - last > 45*60000) rows.push({id:`inactive_${u.id}`,level:'orange',eventAt:last,title:`Agent sans activité récente · ${u.prenom || ''} ${u.nom || ''}`, meta:`${u.siteActuelNom || 'Site inconnu'} · dernière activité ${dateText(u.lastSeen)}`, body:'Contrôle recommandé par le QG.'});
  });
  state.reports.filter(r => r.severity === 'Critique' && r.status !== 'treated').forEach(r => rows.push({id:`report_${r.id}`,level:'red',eventAt:qgNotificationEventMs(r.createdAt),title:`Rapport critique non traité · ${r.agentNom}`, meta:`${r.siteNom} · ${dateText(r.createdAt)}`, body:r.message || 'Rapport critique'}));
  state.flash.filter(f => f.priority === 'Critique').forEach(f => {
    const sent = qgNotificationEventMs(f.sentAt);
    if (sent && now - sent > 10*60000 && Object.keys(f.readBy || {}).length === 0) rows.push({id:`flash_${f.id}`,level:'orange',eventAt:sent,title:`Flash critique non lu`, meta:`Envoyé ${dateText(f.sentAt)}`, body:f.title || f.message || 'Message sans lecture confirmée'});
  });
  const clearedAt=Number(state.clearedAt||0);
  const levelWeight={red:3,orange:2,blue:1};
  return rows.filter(row=>Number(row.eventAt||0)>clearedAt).sort((a,b)=>(levelWeight[b.level]||0)-(levelWeight[a.level]||0)||Number(b.eventAt||0)-Number(a.eventAt||0)||String(a.id||'').localeCompare(String(b.id||''),'fr'));
}
function notificationItem(n){
  return `<div class="item notification ${n.level}"><div class="item-main"><div class="item-title">${safe(n.title)}</div><div class="item-meta">${safe(n.meta)}</div><div style="margin-top:6px">${safe(n.body)}</div></div></div>`;
}

function missionEventMs(value){
  const date = timestampToDate(value);
  return date ? date.getTime() : 0;
}
function missionTimelinePriority(row){
  const type = String(row?.eventType || row?.category || '').toLowerCase();
  if (type.includes('shift_start') || type.includes('prise de service') || type.includes('prise de poste')) return 0;
  if (type.includes('shift_end') || type.includes('fin de service') || type.includes('fin de poste')) return 100;
  return 50;
}
function buildMissionTimeline({ mission={}, shift={}, reports=[] }={}){
  const rows = (reports || []).map((report, index) => ({
    ...report,
    createdAt: report.occurredAt || report.createdAt || report.photoCapturedAt || null,
    timelineSource: report.timelineSource || 'report',
    timelineIndex: index
  }));
  const hasStart = rows.some(row => missionTimelinePriority(row) === 0);
  const hasEnd = rows.some(row => missionTimelinePriority(row) === 100);
  if (!hasStart && shift.startTime) rows.push({
    id:`shift-start-${shift.id || mission.id || 'mission'}`,
    createdAt:shift.startTime,
    agentId:shift.agentId || mission.agentId || '',
    agentNom:shift.agentNom || mission.agentNom || '',
    siteId:shift.siteId || mission.siteId || '',
    siteNom:shift.siteNom || mission.siteNom || '',
    missionId:mission.id || shift.missionId || '',
    shiftId:shift.id || '',
    category:'Prise de poste',
    severity:'Normal',
    message:`Prise de poste enregistrée${shift.checkInPhotoAvailable ? ' avec preuve photographique' : ''}.`,
    eventType:'shift_start',
    systemGenerated:true,
    timelineSource:'shift'
  });
  if (!hasEnd && shift.completedAt) rows.push({
    id:`shift-end-${shift.id || mission.id || 'mission'}`,
    createdAt:shift.completedAt,
    agentId:shift.agentId || mission.agentId || '',
    agentNom:shift.agentNom || mission.agentNom || '',
    siteId:shift.siteId || mission.siteId || '',
    siteNom:shift.siteNom || mission.siteNom || '',
    missionId:mission.id || shift.missionId || '',
    shiftId:shift.id || '',
    category:'Fin de poste',
    severity:'Normal',
    message:`Fin de poste confirmée. Relève : ${shift.handoverNote || 'RAS'}.`,
    eventType:'shift_end',
    systemGenerated:true,
    timelineSource:'shift'
  });
  return rows.sort((a,b) => {
    const aPriority = missionTimelinePriority(a);
    const bPriority = missionTimelinePriority(b);
    if (aPriority === 0 && bPriority !== 0) return -1;
    if (bPriority === 0 && aPriority !== 0) return 1;
    if (aPriority === 100 && bPriority !== 100) return 1;
    if (bPriority === 100 && aPriority !== 100) return -1;
    const time = missionEventMs(a.createdAt) - missionEventMs(b.createdAt);
    if (time) return time;
    const priority = aPriority - bPriority;
    if (priority) return priority;
    return String(a.id || a.timelineIndex || '').localeCompare(String(b.id || b.timelineIndex || ''), 'fr');
  });
}
function missionPdfData({ mission={}, shift={}, reports=[] }={}){
  const compactRows = reports.map(r => r.createdAt || r.message ? compactReport(r) : r);
  const compactM = compactMission(mission);
  const compactS = compactShift(shift);
  const timelineRows = buildMissionTimeline({ mission:compactM, shift:compactS, reports:compactRows });
  return {
    type:'mission',
    title:`Rapport mission — ${mission.siteNom || shift.siteNom || 'Site'} — ${mission.agentNom || shift.agentNom || 'Agent'}`,
    siteId:mission.siteId || shift.siteId || null,
    siteNom:mission.siteNom || shift.siteNom || null,
    missionId:mission.id || null,
    clientId:mission.clientId || shift.clientId || null,
    rowCount:timelineRows.length,
    payload:{ mission:compactM, shift:compactS, rows:compactRows, timelineRows }
  };
}
async function archiveMissionReportSilently({ mission={}, shift={}, reports=[] }={}){
  try {
    const data = missionPdfData({ mission, shift, reports });
    const stableSource = String(data.missionId || shift.id || mission.id || 'mission').replace(/[^a-zA-Z0-9_-]/g,'-');
    const documentId = `mission-${stableSource}`.slice(0,120);
    const existing = await getDoc(docRef('generatedDocuments', documentId)).catch(()=>null);
    if (existing?.exists?.()) return { id:existing.id, ...existing.data() };
    const archived = await archivePdfDocument(data, { silent:true, documentId });
    await addAudit('mission_pdf_auto_archived', { missionId:data.missionId || null, documentId:archived.id, rowCount:data.rowCount });
    return archived;
  } catch(error) {
    console.error('Archivage automatique du rapport impossible', error);
    await addAudit('mission_pdf_auto_failed', { missionId:mission.id || null, error:String(error?.message || error) }).catch(()=>{});
    return null;
  }
}

async function printMissionGroup(group){
  const reports = group?.reports || [];
  const first = reports[0] || {};
  if (first.missionId) return printMissionById(first.missionId);
  let shift = {};
  if (first.shiftId) {
    const snap = await getDoc(docRef('shifts', first.shiftId)).catch(()=>null);
    if (snap?.exists?.()) shift = { id:snap.id, ...snap.data() };
  }
  const mission = { id:group?.key || first.shiftId || 'mission', siteNom:first.siteNom, agentNom:first.agentNom, scheduledStart:shift.scheduledStart, scheduledEnd:shift.scheduledEnd };
  printMissionReport({ mission, shift, reports });
}
async function printMissionById(missionId){
  const mission = qgMissionsCache.find(m=>m.id===missionId) || (await getDoc(docRef('missions', missionId))).data();
  if (!mission) return toast('Mission introuvable.', 'error');
  const reportsSnap = await getDocs(query(collectionRef('reports'), where('missionId','==',missionId))).catch(()=>({docs:[]}));
  const shiftsSnap = await getDocs(query(collectionRef('shifts'), where('missionId','==',missionId))).catch(()=>({docs:[]}));
  const reports = reportsSnap.docs.map(d=>({id:d.id,...d.data()}));
  const shift = shiftsSnap.docs.map(d=>({id:d.id,...d.data()}))[0] || {};
  printMissionReport({ mission:{id:missionId,...mission}, shift, reports });
}
async function printMissionReport({ mission, shift={}, reports=[] }){
  const data = missionPdfData({ mission, shift, reports });
  try {
    const archived = await archivePdfDocument(data, { silent:true });
    await downloadGeneratedPdf(archived, { silent:true });
    toast('Rapport PDF téléchargé et archivé dans Documents.', 'success');
  } catch(error) {
    console.error(error);
    toast(userFriendlyError(error, 'Impossible d’archiver le PDF. Ouverture de l’aperçu.'), 'warning');
    printGeneratedDocument({ ...data, createdAt:new Date() });
  }
}
function renderQGReports(){
  currentRoute = 'reports';
  const body = `<section class="card fixed-mobile-card"><div class="card-title"><div><h2>Journal MCI</h2><p>Classement par mission, filtres et traitement des rapports</p></div><div class="btn-row"><button class="btn small" data-route="documents">Documents</button><button class="btn small" id="export-reports">Télécharger MCI</button>${isStrictAdmin()?'<button class="btn small danger" id="purge-reports">Supprimer les MCI filtrées</button>':''}</div></div>
    <div class="form-grid mci-filters">
      <div class="field"><label>Recherche</label><input class="input" id="report-search" placeholder="Agent, site, mission, message..."></div>
      <div class="field"><label>Vue</label><select class="select" id="report-view-mode"><option value="missions">Par mission</option><option value="table">Table complète</option></select></div>
      <div class="field"><label>Site</label><select class="select" id="site-filter"><option value="">Tous les sites</option></select></div>
      <div class="field"><label>Agent</label><select class="select" id="agent-filter"><option value="">Tous les agents</option></select></div>
      <div class="field"><label>Gravité</label><select class="select" id="severity-filter"><option value="">Toutes</option><option>Normal</option><option>À surveiller</option><option>Important</option><option>Critique</option></select></div>
      <div class="field"><label>Catégorie</label><select class="select" id="category-filter"><option value="">Toutes</option><option>Ronde</option><option>Anomalie</option><option>Incident</option><option>Information</option><option>Intervention</option><option>Consigne reçue</option><option>Prise de service</option><option>Fin de service</option></select></div>
    </div>
    <div id="reports-summary" class="mission-kpis"></div>
    <div id="reports-table" class="table-wrap"><div class="empty">Chargement...</div></div></section>`;
  render(page('Supervision MCI', 'Journal de bord temps réel', body));
  let rows = [];
  const reportsQuery = query(collectionRef('reports'), orderBy('createdAt','desc'), limit(1000));
  const redraw = () => renderReportsTable(rows);
  unsubscribeList.push(onSnapshot(reportsQuery, snap => {
    rows = snap.docs.map(d=>({id:d.id,...d.data()}));
    refreshReportFilters(rows);
    redraw();
  }));
  unsubscribeList.push(onSnapshot(collectionRef('sites'), snap => {
    qgAllSitesCache = snap.docs.map(d=>({id:d.id,...d.data()}));
    refreshReportFilters(rows);
    redraw();
  }));
  unsubscribeList.push(onSnapshot(collectionRef('users'), snap => {
    qgAllAgentsCache = snap.docs.map(d=>({id:d.id,...d.data()}));
    refreshReportFilters(rows);
    redraw();
  }));
  ['report-search','severity-filter','category-filter','site-filter','agent-filter','report-view-mode'].forEach(id => {
    document.querySelector(`#${id}`)?.addEventListener('input', redraw);
    document.querySelector(`#${id}`)?.addEventListener('change', redraw);
  });
  document.querySelector('#export-reports').addEventListener('click', () => exportCSV(filterReports(rows), 'mci-reports-filtres.csv'));
  document.querySelector('#purge-reports')?.addEventListener('click', () => requestDeleteReports(filterReports(rows), 'les MCI actuellement filtrées'));
}
function refreshReportFilters(rows){
  refreshSiteFilter(rows);
  refreshAgentFilter(rows);
}
function refreshSiteFilter(rows){
  const el = document.querySelector('#site-filter');
  if (!el) return;
  const previous = el.value;
  const sitesMap = new Map();
  qgAllSitesCache.forEach(site => {
    const key = site.id || site.siteId || site.name;
    if (key) sitesMap.set(String(key), site.name || site.siteNom || String(key));
  });
  rows.forEach(report => {
    const key = report.siteId || report.siteNom;
    if (key && !sitesMap.has(String(key))) sitesMap.set(String(key), report.siteNom || String(key));
  });
  const options = [...sitesMap.entries()].sort((a,b)=>String(a[1]).localeCompare(String(b[1]), 'fr'));
  el.innerHTML = `<option value="">Tous les sites</option>` + options.map(([value,label]) => `<option value="${safe(value)}">${safe(label)}</option>`).join('');
  if (options.some(([value]) => value === previous)) el.value = previous;
}
function refreshAgentFilter(rows){
  const el = document.querySelector('#agent-filter');
  if (!el) return;
  const previous = el.value;
  const agentsMap = new Map();
  qgAllAgentsCache.filter(u => !u.role || ['agent','superviseur','admin'].includes(u.role)).forEach(user => {
    const label = `${user.prenom || ''} ${user.nom || ''}`.trim() || user.email || user.id;
    const key = user.uid || user.id || label;
    if (key) agentsMap.set(String(key), label);
  });
  rows.forEach(report => {
    const key = report.agentId || report.agentNom;
    if (key && !agentsMap.has(String(key))) agentsMap.set(String(key), report.agentNom || String(key));
  });
  const options = [...agentsMap.entries()].sort((a,b)=>String(a[1]).localeCompare(String(b[1]), 'fr'));
  el.innerHTML = `<option value="">Tous les agents</option>` + options.map(([value,label]) => `<option value="${safe(value)}">${safe(label)}</option>`).join('');
  if (options.some(([value]) => value === previous)) el.value = previous;
}
function fillSelect(selector, values, firstLabel){
  const el = document.querySelector(selector);
  if (!el) return;
  const previous = el.value;
  el.innerHTML = `<option value="">${firstLabel}</option>` + values.map(v => `<option value="${safe(v)}">${safe(v)}</option>`).join('');
  if (values.includes(previous)) el.value = previous;
}
function filterReports(rows){
  const term = document.querySelector('#report-search')?.value.toLowerCase() || '';
  const sev = document.querySelector('#severity-filter')?.value || '';
  const category = document.querySelector('#category-filter')?.value || '';
  const site = document.querySelector('#site-filter')?.value || '';
  const agent = document.querySelector('#agent-filter')?.value || '';
  const selectedSite = site ? qgAllSitesCache.find(s => [s.id, s.siteId, s.name].map(v=>String(v||'')).includes(site)) : null;
  const selectedAgent = agent ? qgAllAgentsCache.find(u => [u.id, u.uid, `${u.prenom || ''} ${u.nom || ''}`.trim(), u.email].map(v=>String(v||'')).includes(agent)) : null;
  return rows.filter(r => {
    const mission = missionKey(r);
    const haystack = `${r.agentNom} ${r.siteNom} ${r.category} ${r.severity} ${r.message} ${mission}`.toLowerCase();
    const siteOk = !site || r.siteId === site || r.siteNom === site || (selectedSite && (r.siteId === selectedSite.id || r.siteId === selectedSite.siteId || r.siteNom === selectedSite.name));
    const selectedAgentName = selectedAgent ? `${selectedAgent.prenom || ''} ${selectedAgent.nom || ''}`.trim() : '';
    const agentOk = !agent || r.agentId === agent || r.agentNom === agent || (selectedAgent && (r.agentId === selectedAgent.id || r.agentId === selectedAgent.uid || r.agentNom === selectedAgentName));
    return (!sev || r.severity === sev)
      && (!category || r.category === category)
      && siteOk
      && agentOk
      && haystack.includes(term);
  });
}
function missionKey(r){
  if (r.shiftId) return String(r.shiftId);
  const d = r.createdAt?.toDate ? r.createdAt.toDate() : new Date(r.createdAt || Date.now());
  const day = Number.isNaN(d.getTime()) ? 'date-inconnue' : d.toISOString().slice(0,10);
  return `mission-${r.agentId || r.agentNom || 'agent'}-${r.siteId || r.siteNom || 'site'}-${day}`;
}
function missionTitle(group){
  const first = group.reports[0] || {};
  return `${first.siteNom || 'Site non renseigné'} · ${first.agentNom || 'Agent non renseigné'}`;
}
function buildMissionGroups(rows){
  const map = new Map();
  rows.forEach(r => {
    const key = missionKey(r);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(r);
  });
  return [...map.entries()].map(([key, reports]) => {
    const sorted = reports.slice().sort((a,b)=>(b.createdAt?.toDate?.()?.getTime() || 0) - (a.createdAt?.toDate?.()?.getTime() || 0));
    const times = reports.map(r => r.createdAt?.toDate?.()?.getTime()).filter(Boolean).sort((a,b)=>a-b);
    return {
      key,
      reports: sorted,
      count: reports.length,
      incidents: reports.filter(r => ['Incident','Intervention','Anomalie'].includes(r.category)).length,
      critical: reports.filter(r => r.severity === 'Critique').length,
      important: reports.filter(r => ['Important','Critique'].includes(r.severity)).length,
      firstAt: times[0] ? new Date(times[0]) : null,
      lastAt: times[times.length-1] ? new Date(times[times.length-1]) : null,
      treated: reports.filter(r => r.status === 'treated').length
    };
  }).sort((a,b)=>(b.lastAt?.getTime() || 0) - (a.lastAt?.getTime() || 0));
}
function renderReportsSummary(rows, groups){
  const box = document.querySelector('#reports-summary');
  if (!box) return;
  const openCritical = rows.filter(r => r.severity === 'Critique' && r.status !== 'treated').length;
  box.innerHTML = `
    <div class="mini-kpi"><strong>${groups.length}</strong><span>Missions</span></div>
    <div class="mini-kpi"><strong>${rows.length}</strong><span>Rapports</span></div>
    <div class="mini-kpi orange"><strong>${rows.filter(r => ['Incident','Intervention','Anomalie'].includes(r.category)).length}</strong><span>Événements</span></div>
    <div class="mini-kpi ${openCritical ? 'red' : 'green'}"><strong>${openCritical}</strong><span>Critiques ouverts</span></div>`;
}
function renderReportsTable(rows){
  const filtered = filterReports(rows);
  const groups = buildMissionGroups(filtered);
  renderReportsSummary(filtered, groups);
  const box = document.querySelector('#reports-table');
  const mode = document.querySelector('#report-view-mode')?.value || 'missions';
  if (!filtered.length) return box.innerHTML = `<div class="empty">Aucun rapport trouvé.</div>`;
  if (mode === 'missions') return renderMissionView(box, groups);
  box.innerHTML = `<table class="table"><thead><tr><th>Mission</th><th>Heure</th><th>Agent</th><th>Site</th><th>Catégorie</th><th>Gravité</th><th>Message</th><th>Photo</th><th>Statut</th><th>Action</th></tr></thead><tbody>${filtered.map(r => `<tr><td><span class="mission-badge">${safe(shortMissionId(r))}</span></td><td>${dateText(r.createdAt)}</td><td>${safe(r.agentNom)}</td><td>${safe(r.siteNom)}</td><td>${safe(r.category)}</td><td>${safe(r.severity)}</td><td>${safe(r.message)}</td><td>${reportPhotoPreviewHtml(r)}</td><td>${safe(r.status || 'new')}</td><td><div class="table-actions"><button class="btn small" data-report-detail="${safe(r.id)}">Détail</button>${isStrictAdmin()?`<button class="btn small danger" data-report-delete="${safe(r.id)}">Supprimer</button>`:''}</div></td></tr>`).join('')}</tbody></table>`;
  document.querySelectorAll('[data-report-detail]').forEach(btn => btn.addEventListener('click', () => showReportDetail(filtered.find(r=>r.id===btn.dataset.reportDetail))));
  document.querySelectorAll('[data-report-delete]').forEach(btn => btn.addEventListener('click', () => requestDeleteReports(filtered.filter(r=>r.id===btn.dataset.reportDelete), 'ce rapport MCI')));
}
function shortMissionId(r){
  const key = missionKey(r);
  return key.length > 10 ? key.slice(0, 8).toUpperCase() : key.toUpperCase();
}
function renderMissionView(box, groups){
  qgReportMissionGroups = groups;
  box.innerHTML = `<div class="mission-list">${groups.map((g, index) => {
    const first = g.reports[0] || {};
    const color = g.critical ? 'red' : g.important ? 'orange' : 'green';
    const last = g.lastAt ? g.lastAt.toLocaleString('fr-FR', { dateStyle:'short', timeStyle:'short' }) : '—';
    const firstAt = g.firstAt ? g.firstAt.toLocaleString('fr-FR', { dateStyle:'short', timeStyle:'short' }) : '—';
    return `<div class="mission-card ${color}">
      <div class="mission-head">
        <div><div class="mission-title">${safe(missionTitle(g))}</div><div class="mission-meta">Mission ${safe(shortMissionId(first))} · Début ${safe(firstAt)} · Dernier rapport ${safe(last)}</div></div>
        <span class="pill ${color}">${g.critical ? 'Critique' : g.important ? 'À surveiller' : 'Normal'}</span>
      </div>
      <div class="mission-stats"><span>${g.count} rapports</span><span>${g.incidents} événements</span><span>${g.treated}/${g.count} traités</span></div>
      <div class="mission-last">${safe(g.reports[0]?.category || 'Rapport')} — ${safe(g.reports[0]?.message || '').slice(0,150)}${(g.reports[0]?.message || '').length > 150 ? '…' : ''}</div>
      <div class="btn-row"><button class="btn small primary" data-mission-detail="${index}">Voir la mission</button><button class="btn small" data-mission-export="${index}">Export CSV</button><button class="btn small" data-mission-print="${index}">PDF</button><button class="btn small success" data-mission-archive="${index}">Archiver document</button>${isStrictAdmin()?`<button class="btn small danger" data-mission-delete="${index}">Supprimer MCI</button>`:''}</div>
    </div>`;
  }).join('')}</div>`;
  document.querySelectorAll('[data-mission-detail]').forEach(btn => btn.addEventListener('click', () => showMissionDetail(Number(btn.dataset.missionDetail))));
  document.querySelectorAll('[data-mission-export]').forEach(btn => btn.addEventListener('click', () => {
    const g = qgReportMissionGroups[Number(btn.dataset.missionExport)];
    if (g) exportCSV(g.reports, `mission-${g.key}.csv`);
  }));
  document.querySelectorAll('[data-mission-print]').forEach(btn => btn.addEventListener('click', () => {
    const g = qgReportMissionGroups[Number(btn.dataset.missionPrint)];
    if (g) printMissionGroup(g);
  }));
  document.querySelectorAll('[data-mission-archive]').forEach(btn => btn.addEventListener('click', () => {
    const g = qgReportMissionGroups[Number(btn.dataset.missionArchive)];
    if (g) archiveMissionGroup(g);
  }));
  document.querySelectorAll('[data-mission-delete]').forEach(btn => btn.addEventListener('click', () => {
    const g = qgReportMissionGroups[Number(btn.dataset.missionDelete)];
    if (g) requestDeleteReports(g.reports, `les ${g.count} MCI de cette mission`);
  }));
}
function showMissionDetail(index){
  const g = qgReportMissionGroups[index];
  if (!g) return;
  const rows = g.reports.map(r => `<tr><td>${dateText(r.createdAt)}</td><td>${safe(r.category)}</td><td>${safe(r.severity)}</td><td>${safe(r.message)}</td><td>${reportPhotoPreviewHtml(r)}</td><td>${safe(r.status || 'new')}</td><td><button class="btn small" data-report-detail-modal="${safe(r.id)}">Détail</button></td></tr>`).join('');
  showModal('Main courante par mission', `<div class="list"><div class="item"><div class="item-main"><div class="item-title">${safe(missionTitle(g))}</div><div class="item-meta">Mission ${safe(g.key)}<br>${g.count} rapports · ${g.incidents} événements · ${g.critical} critique(s)</div></div></div></div><div class="table-wrap"><table class="table"><thead><tr><th>Heure</th><th>Catégorie</th><th>Gravité</th><th>Message</th><th>Photo</th><th>Statut</th><th>Action</th></tr></thead><tbody>${rows}</tbody></table></div><div class="btn-row"><button class="btn primary" id="export-current-mission">Exporter CSV</button><button class="btn" id="print-current-mission">Rapport PDF</button></div>`);
  document.querySelector('#export-current-mission')?.addEventListener('click', () => exportCSV(g.reports, `mission-${g.key}.csv`));
  document.querySelector('#print-current-mission')?.addEventListener('click', () => printMissionGroup(g));
  document.querySelectorAll('[data-report-detail-modal]').forEach(btn => btn.addEventListener('click', () => showReportDetail(g.reports.find(r=>r.id===btn.dataset.reportDetailModal))));
}
function showReportDetail(r){
  showModal('Détail rapport MCI', `<div class="list"><div class="item"><div class="item-main"><div class="item-title">${safe(r.category)} · ${safe(r.severity)}</div><div class="item-meta">${safe(r.agentNom)} · ${safe(r.siteNom)} · ${dateText(r.createdAt)}</div><p>${safe(r.message)}</p>${reportHasPhoto(r)?`<div style="margin-top:14px"><strong>Preuve photographique</strong><div style="margin-top:8px">${reportPhotoPreviewHtml(r,{large:true})}</div></div>`:''}${r.gps?`<p class="muted">GPS : ${r.gps.lat}, ${r.gps.lng}</p>`:''}</div></div></div><div class="field"><label>Note superviseur</label><textarea class="textarea" id="supervisor-note" placeholder="Ajouter une note...">${safe(r.supervisorNote || '')}</textarea></div><div class="btn-row"><button class="btn primary" id="mark-treated">Marquer comme traité</button>${isStrictAdmin()?'<button class="btn danger" id="delete-current-report">Supprimer définitivement</button>':''}</div>`);
  document.querySelector('#mark-treated')?.addEventListener('click', async () => {
    await updateDoc(docRef('reports', r.id), { status:'treated', supervisorNote:document.querySelector('#supervisor-note').value, treatedBy:currentUser.uid, treatedAt:serverTimestamp() });
    await addAudit('report_treated', { reportId:r.id });
    closeModal(); toast('Rapport traité', 'success');
  });
  document.querySelector('#delete-current-report')?.addEventListener('click', () => { closeModal(); requestDeleteReports([r], 'ce rapport MCI'); });
}



// =========================
// V4.8 — Veille Sécurité IA assistée
// =========================
function getIntelWorkerUrl(){
  return String(pushConfig?.securityIntelWorkerUrl || pushConfig?.intelWorkerUrl || '').trim();
}
function intelLevelClass(level){
  const l = String(level||'').toLowerCase();
  if (l.includes('critique')) return 'red';
  if (l.includes('élevé') || l.includes('eleve')) return 'orange';
  if (l.includes('attention')) return 'warning';
  return 'green';
}
function renderIntelResult(result, audience='qg'){
  if (!result) return `<div class="empty">Lance une analyse pour afficher la veille sécurité.</div>`;
  const sources = (result.sources || []).slice(0,8);
  const recos = result.recommendations || [];
  const signals = result.signals || [];
  return `<div class="intel-result">
    <div class="intel-score-card ${intelLevelClass(result.level)}"><div><div class="muted">Niveau estimé</div><h2>${safe(result.level || 'Normal')}</h2><p>${safe(result.city || '')} · ${safe(result.generatedAtText || nowText())}</p></div><div class="intel-score">${result.limited ? '—' : safe(result.score ?? 0)}</div></div>
    <div class="grid cols-2 intel-grid">
      <div class="card inner"><h3>Signaux détectés</h3>${signals.length ? signals.map(s=>`<div class="intel-signal"><span class="pill ${safe(s.levelClass||'')}">${safe(s.type)}</span><div>${safe(s.label)}</div><small>${safe(s.count || 0)} élément(s)</small></div>`).join('') : `<div class="empty">Aucun signal public fort détecté.</div>`}</div>
      <div class="card inner"><h3>Recommandations opérationnelles</h3>${recos.length ? `<ul class="intel-list">${recos.map(r=>`<li>${safe(r)}</li>`).join('')}</ul>` : `<div class="empty">Aucune recommandation particulière.</div>`}</div>
    </div>
    <div class="card inner"><h3>Synthèse</h3><p>${safe(result.summary || 'Aucune synthèse disponible.')}</p></div>
    <div class="card inner"><h3>Sources publiques consultées</h3>${sources.length ? sources.map(src=>`<div class="item compact"><div class="item-main"><div class="item-title">${safe(src.title || 'Source')}</div><div class="item-meta">${safe(src.domain || '')} · ${safe(src.date || '')}</div>${src.url ? `<a class="link" href="${safe(src.url)}" target="_blank" rel="noopener">Ouvrir la source</a>` : ''}</div></div>`).join('') : `<div class="empty">Aucune source exploitable retournée.</div>`}</div>
    ${audience==='qg' ? `<div class="btn-row"><button class="btn primary" id="intel-create-flash">Créer Flash depuis cette veille</button><button class="btn" id="intel-copy-result">Copier synthèse</button></div>` : `<button class="btn full" id="intel-copy-result">Copier synthèse</button>`}
  </div>`;
}
function intelText(result){
  if (!result) return '';
  return `Veille sécurité — ${result.city || ''}\nNiveau : ${result.level || 'Normal'} ${result.limited ? '(analyse limitée)' : `(${result.score ?? 0}/100)`}\n\nSynthèse :\n${result.summary || ''}\n\nRecommandations :\n${(result.recommendations||[]).map(x=>'• '+x).join('\n')}\n\nSources :\n${(result.sources||[]).slice(0,6).map(s=>'• '+(s.title||s.domain||'Source')+(s.url?' — '+s.url:'')).join('\n')}`;
}
async function runSecurityIntel(city, audience='qg'){
  const workerUrl = getIntelWorkerUrl();
  if (!workerUrl) throw new Error('Veille externe désactivée sur le staging pendant la migration Supabase.');
  const payload = { city, audience, userRole: currentProfile?.role || 'agent', siteActuel: currentProfile?.siteActuelNom || currentProfile?.siteActuel || null };
  const res = await fetch(workerUrl, { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(payload) });
  let data = null;
  try { data = await res.json(); } catch(e) {}
  if (!res.ok) throw new Error(data?.error || `Erreur veille sécurité (${res.status})`);
  data.generatedAtText = nowText();
  await addDoc(collectionRef('securityIntelLogs'), {
    city: data.city || city,
    queryCity: city,
    level: data.level || 'Normal',
    score: data.score || 0,
    summary: data.summary || '',
    signals: data.signals || [],
    recommendations: data.recommendations || [],
    sources: (data.sources || []).slice(0,10),
    requestedBy: currentUser.uid,
    requestedByNom: `${currentProfile.prenom||''} ${currentProfile.nom||''}`.trim(),
    role: currentProfile.role,
    createdAt: serverTimestamp()
  }).catch(()=>{});
  return data;
}
async function renderQGIntel(){
  currentRoute = 'intel';
  const body = `<section class="grid cols-2 intel-layout">
    <div class="card"><div class="card-title"><div><h2>Veille Sécurité IA</h2><p>Analyse publique par ville : grèves, manifestations, incidents, météo sociale, tensions locales</p></div></div>
      <form id="intel-form"><div class="field"><label>Ville à analyser</label><input class="input" name="city" placeholder="Ex : Marseille, Toulon, Nice, Fréjus" required></div><div class="field"><label>Question opérationnelle</label><textarea class="textarea" name="question" placeholder="Ex : Y a-t-il un risque sécurité aujourd’hui ?"></textarea></div><button class="btn primary full" type="submit">Analyser maintenant</button></form>
      <div class="setup-box" style="margin-top:12px">Cette veille exploite des sources publiques. Elle aide à décider, mais ne remplace pas les consignes officielles, la préfecture, les forces de l’ordre ou le client.</div>
    </div>
    <div class="card"><div class="card-title"><div><h2>Dernières veilles</h2><p>Historique QG</p></div></div><div id="intel-history" class="list"><div class="empty">Chargement...</div></div></div>
  </section><section class="card" style="margin-top:16px"><div class="card-title"><div><h2>Résultat opérationnel</h2><p>Niveau, signaux, sources et actions</p></div></div><div id="intel-result">${renderIntelResult(null,'qg')}</div></section>`;
  render(page('Veille Sécurité', 'Analyse opérationnelle des risques publics par ville', body));
  document.querySelector('#intel-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const city = String(fd.get('city')||'').trim();
    const resultBox = document.querySelector('#intel-result');
    resultBox.innerHTML = `<div class="empty">Analyse en cours…</div>`;
    try {
      const result = await runSecurityIntel(city, 'qg');
      resultBox.innerHTML = renderIntelResult(result,'qg');
      bindIntelResultActions(result);
      toast('Veille sécurité générée', 'success');
    } catch(error) {
      console.error(error);
      resultBox.innerHTML = `<div class="empty error">${safe(error.message || error)}</div>`;
      toast(error.message || 'Analyse impossible', 'error');
    }
  });
  listenSecurityIntelHistory('#intel-history');
}
function bindIntelResultActions(result){
  document.querySelector('#intel-copy-result')?.addEventListener('click', async()=>{
    await navigator.clipboard?.writeText(intelText(result)).catch(()=>{});
    toast('Synthèse copiée', 'success');
  });
  document.querySelector('#intel-create-flash')?.addEventListener('click', async()=>{
    const priority = (result.score||0) >= 75 ? 'Critique' : (result.score||0) >= 45 ? 'Urgent' : 'Important';
    const title = `Veille sécurité — ${result.city || 'zone'}`;
    const message = `${result.level || 'Normal'} — ${result.summary || ''}\n\nConsignes : ${(result.recommendations||[]).slice(0,4).join(' / ')}`;
    await addDoc(collectionRef('flashMessages'), { title, message, priority, target:'all', sentBy:currentUser.uid, sentAt:serverTimestamp(), readBy:{}, status:'sent', source:'securityIntel' });
    toast('Flash créé depuis la veille', 'success');
  });
}
function listenSecurityIntelHistory(selector){
  const box = document.querySelector(selector); if (!box) return;
  const q = query(collectionRef('securityIntelLogs'), orderBy('createdAt','desc'), limit(12));
  unsubscribeList.push(onSnapshot(q, snap => {
    const rows = snap.docs.map(d=>({id:d.id,...d.data()}));
    box.innerHTML = rows.length ? rows.map(r=>`<div class="item compact"><div class="item-main"><div class="item-title">${safe(r.city)} <span class="pill ${intelLevelClass(r.level)}">${safe(r.level)}</span></div><div class="item-meta">${dateText(r.createdAt)} · ${r.limited ? 'analyse limitée' : 'score '+safe(r.score||0)+'/100'}</div><p>${safe(r.summary||'')}</p></div></div>`).join('') : `<div class="empty">Aucune veille enregistrée.</div>`;
  }, () => box.innerHTML = `<div class="empty">Historique indisponible.</div>`));
}
async function renderAgentIntel(){
  currentRoute = 'intel';
  const defaultCity = (currentProfile?.siteActuelNom || '').split(' ').slice(-1)[0] || '';
  const body = `<section class="card"><div class="card-title"><div><h2>Point sécurité</h2><p>Résumé court avant ou pendant la mission</p></div></div>
    <form id="agent-intel-form"><div class="field"><label>Ville</label><input class="input" name="city" value="${safe(defaultCity)}" placeholder="Ex : Marseille, Nice, Toulon" required></div><button class="btn primary full" type="submit">Analyser ma zone</button></form>
    <div class="setup-box" style="margin-top:12px">Utilise cette veille comme aide. En cas d’urgence ou consigne officielle, applique toujours les procédures QG/client.</div>
  </section><section class="card" style="margin-top:16px"><div id="agent-intel-result">${renderIntelResult(null,'agent')}</div></section>`;
  render(page('Veille sécurité', 'Informations publiques utiles à la mission', body));
  document.querySelector('#agent-intel-form')?.addEventListener('submit', async e => {
    e.preventDefault();
    const city = String(new FormData(e.currentTarget).get('city')||'').trim();
    const box = document.querySelector('#agent-intel-result');
    box.innerHTML = `<div class="empty">Analyse en cours…</div>`;
    try {
      const result = await runSecurityIntel(city, 'agent');
      box.innerHTML = renderIntelResult(result,'agent');
      bindIntelResultActions(result);
    } catch(error) {
      console.error(error);
      box.innerHTML = `<div class="empty error">${safe(error.message || error)}</div>`;
      toast(error.message || 'Analyse impossible', 'error');
    }
  });
}

function renderQGDevice(){
  currentRoute = 'device';
  const body = `<section class="card"><div class="card-title"><div><h2>Dispositif opérationnel</h2><p>Liste vivante des agents</p></div></div><div id="device-list" class="list"><div class="empty">Chargement...</div></div></section>`;
  render(page('Dispositif', 'Agents, statuts et activité terrain', body));
  const q = query(collectionRef('users'), orderBy('nom'));
  unsubscribeList.push(onSnapshot(q, snap => {
    const rows = snap.docs.map(d=>({id:d.id,...d.data()}));
    const box = document.querySelector('#device-list');
    box.innerHTML = rows.map(u => `<div class="item"><div class="item-main"><div class="item-title">${safe(u.prenom)} ${safe(u.nom)} <span class="pill ${u.statut==='en_poste'?'green':u.statut==='alerte'?'red':''}">${safe(u.statut || 'actif')}</span></div><div class="item-meta">Rôle : ${safe(u.role)}<br>Site : ${safe(u.siteActuelNom || u.siteActuel || '—')}<br>Dernière activité : ${dateText(u.lastSeen)}<br>Téléphone : ${safe(u.telephone || '—')}</div></div><div class="item-actions">${u.telephone?`<a class="btn small" href="tel:${safe(u.telephone)}">Appeler</a>`:''}</div></div>`).join('') || `<div class="empty">Aucun agent.</div>`;
  }));
}

function renderQGAgents(){
  currentRoute = 'agents';
  const body = `<section class="card"><div class="card-title"><div><h2>Gestion Agents</h2><p>Profils, rôles et statut</p></div><button class="btn primary small" id="add-agent-profile">Ajouter profil</button></div><div id="agents-table" class="table-wrap"><div class="empty">Chargement...</div></div></section>`;
  render(page('Gestion Agents', 'Administration opérationnelle des accès', body));
  document.querySelector('#add-agent-profile').addEventListener('click', () => showAgentForm());
  const q = query(collectionRef('users'), orderBy('nom'));
  unsubscribeList.push(onSnapshot(q, snap => renderAgentsTable(snap.docs.map(d=>({id:d.id,...d.data()})))));
}
function renderAgentsTable(rows){
  const box = document.querySelector('#agents-table');
  if (!rows.length) return box.innerHTML = `<div class="empty">Aucun profil agent.</div>`;
  box.innerHTML = `<table class="table"><thead><tr><th>Nom</th><th>Email</th><th>Téléphone</th><th>Rôle</th><th>Statut</th><th>Site actuel</th><th>Action</th></tr></thead><tbody>${rows.map(u=>`<tr><td>${safe(u.prenom)} ${safe(u.nom)}</td><td>${safe(u.email)}</td><td>${safe(u.telephone || '')}</td><td>${safe(u.role)}</td><td>${safe(u.statut)}</td><td>${safe(u.siteActuelNom || '—')}</td><td><div class="table-actions"><button class="btn small primary" data-agent-planning="${safe(u.id)}">Planning</button><button class="btn small" data-agent-badge="${safe(u.id)}">Badge</button><button class="btn small" data-edit-agent="${safe(u.id)}">Modifier</button>${isStrictAdmin() && u.id !== currentUser.uid ? `<button class="btn small danger" data-delete-agent="${safe(u.id)}">Supprimer</button>` : ''}</div></td></tr>`).join('')}</tbody></table>`;
  document.querySelectorAll('[data-agent-planning]').forEach(btn => btn.addEventListener('click', () => { sessionStorage.setItem('sentinellePlanningAgentId',btn.dataset.agentPlanning); navigate('missions'); }));
  document.querySelectorAll('[data-agent-badge]').forEach(btn => btn.addEventListener('click', () => openAgentBadgePreview(rows.find(u=>u.id===btn.dataset.agentBadge))));
  document.querySelectorAll('[data-edit-agent]').forEach(btn => btn.addEventListener('click', () => showAgentForm(rows.find(u=>u.id===btn.dataset.editAgent))));
  document.querySelectorAll('[data-delete-agent]').forEach(btn => btn.addEventListener('click', () => requestDeleteAgent(rows.find(u=>u.id===btn.dataset.deleteAgent))));
}

function confirmDestructiveAction({ title, message, confirmWord='SUPPRIMER', actionLabel='Supprimer', onConfirm }){
  if (!isStrictAdmin()) return toast('Action réservée au compte admin.', 'error');
  showModal(title, `<div class="setup-box danger-copy">${safe(message)}</div><div class="field"><label>Écris ${safe(confirmWord)} pour confirmer</label><input class="input mono" id="danger-confirm-input" autocomplete="off"></div><button class="btn danger full" id="danger-confirm-button" disabled>${safe(actionLabel)}</button>`);
  const input = document.querySelector('#danger-confirm-input');
  const button = document.querySelector('#danger-confirm-button');
  input?.addEventListener('input', () => { button.disabled = input.value.trim().toUpperCase() !== confirmWord.toUpperCase(); });
  button?.addEventListener('click', async()=>{
    button.disabled = true;
    try { await onConfirm(); closeModal(); }
    catch(error){ console.error(error); button.disabled = false; toast(userFriendlyError(error, 'Suppression impossible.'), 'error'); }
  });
}
async function deleteQueryDocuments(q, collectionName){
  const snap = await getDocs(q).catch(()=>({docs:[]}));
  const refs = snap.docs.map(d=>docRef(collectionName,d.id));
  for (let i=0;i<refs.length;i+=400){
    const batch = writeBatch(db);
    refs.slice(i,i+400).forEach(ref=>batch.delete(ref));
    await batch.commit();
  }
  return refs.length;
}
function requestDeleteAgent(user){
  if (!user || user.id === currentUser.uid) return toast('Tu ne peux pas supprimer ton propre compte admin.', 'warning');
  confirmDestructiveAction({
    title:'Supprimer cet agent',
    message:`Le profil métier de ${user.prenom || ''} ${user.nom || ''} sera supprimé de Supabase et son accès métier sera bloqué. Son compte Supabase Auth et son profil métier seront supprimés. Les historiques de missions et MCI restent conservés.`,
    onConfirm: async()=>{
      await addAudit('agent_profile_deleted', { uid:user.id, email:user.email || '', nom:`${user.prenom||''} ${user.nom||''}`.trim() });
      await deleteAuthAccountFromAdmin(user);
      await deleteQueryDocuments(query(collectionRef('pushTokens'), where('userId','==',user.id)), 'pushTokens');
      await deleteDoc(docRef('users', user.id));
      toast('Agent supprimé et accès bloqué.', 'success');
    }
  });
}
function requestDeleteSite(site){
  if (!site) return;
  confirmDestructiveAction({
    title:'Supprimer ce site',
    message:`Le site “${site.name || site.id}” et ses points de ronde seront supprimés. Les anciennes missions et MCI restent conservées pour la traçabilité, sauf suppression séparée depuis le journal MCI.`,
    onConfirm: async()=>{
      await addAudit('site_deleted', { siteId:site.id, name:site.name || '' });
      await deleteQueryDocuments(query(collectionRef('roundCheckpoints'), where('siteId','==',site.id)), 'roundCheckpoints');
      await deleteDoc(docRef('sites', site.id));
      toast('Site supprimé.', 'success');
    }
  });
}
async function deleteReportRows(rows){
  const ids = [...new Set((rows||[]).map(r=>r.id).filter(Boolean))];
  for (let i=0;i<ids.length;i+=400){
    const batch = writeBatch(db);
    ids.slice(i,i+400).forEach(reportId=>batch.delete(docRef('reports',reportId)));
    await batch.commit();
  }
  return ids.length;
}
function requestDeleteReports(rows, label='ces MCI'){
  if (!rows?.length) return toast('Aucune MCI à supprimer.', 'warning');
  confirmDestructiveAction({
    title:'Suppression définitive des MCI',
    message:`Tu vas supprimer définitivement ${rows.length} rapport(s) : ${label}. Cette action est réservée à l’admin et ne peut pas être annulée.`,
    onConfirm: async()=>{
      await addAudit('reports_deleted', { count:rows.length, reportIds:rows.slice(0,30).map(r=>r.id), scope:label });
      const count = await deleteReportRows(rows);
      toast(`${count} MCI supprimée(s).`, 'success');
    }
  });
}

function showAgentForm(u={}){
  const isEdit = !!u.id;
  const c = badgeCompany(u);
  let pendingBadgePhotoDataUrl = u.badgePhotoDataUrl || u.photoDataUrl || '';
  showModal(isEdit?'Modifier profil':'Créer compte agent', `<form id="agent-form">
    ${!isEdit ? `<div class="setup-box">V5.8.7.1 staging : le compte Supabase Auth et son profil sont créés ensemble par une Edge Function sécurisée. Aucun secret administrateur n’est exposé dans le navigateur.</div>` : ''}
    <div class="invoice-form-section"><h3>Identité et accès</h3><div class="form-grid">
      <div class="field"><label>UID historique / external_uid ${isEdit?'':'(requis après création Supabase Auth)'}</label><input class="input mono" name="uid" value="${safe(u.id || u.uid || '')}" ${isEdit?'readonly':''} placeholder="Conserver l’external_uid du profil métier"></div>
      <div class="field"><label>Email de connexion</label><input class="input" name="email" type="email" value="${safe(u.email || '')}" required></div>
      ${!isEdit ? `<div class="field"><label>Mot de passe initial</label><input class="input" name="password" type="password" minlength="8" placeholder="Minimum 8 caractères"></div><div class="field"><label>Confirmer mot de passe</label><input class="input" name="passwordConfirm" type="password" minlength="8"></div>` : ''}
      <div class="field"><label>Prénom</label><input class="input" name="prenom" value="${safe(u.prenom || '')}" required></div>
      <div class="field"><label>Nom</label><input class="input" name="nom" value="${safe(u.nom || '')}" required></div>
      <div class="field"><label>Téléphone</label><input class="input" name="telephone" value="${safe(u.telephone || '')}"></div>
      <div class="field"><label>Matricule</label><input class="input" name="matricule" value="${safe(u.matricule || '')}"></div>
      <div class="field field-wide"><label>Adresse</label><input class="input" name="address" value="${safe(u.address || '')}" placeholder="Adresse du collaborateur"></div>
      <div class="field"><label>Code postal</label><input class="input" name="postalCode" value="${safe(u.postalCode || '')}"></div>
      <div class="field"><label>Ville</label><input class="input" name="city" value="${safe(u.city || '')}"></div>
      <div class="field"><label>Rôle</label><select class="select" name="role"><option ${u.role==='agent'?'selected':''}>agent</option><option ${u.role==='superviseur'?'selected':''}>superviseur</option><option ${u.role==='admin'?'selected':''}>admin</option></select></div>
      <div class="field"><label>Statut</label><select class="select" name="statut"><option ${u.statut==='actif'?'selected':''}>actif</option><option ${u.statut==='hors_poste'?'selected':''}>hors_poste</option><option ${u.statut==='désactivé'?'selected':''}>désactivé</option></select></div>
    </div></div>

    <div class="invoice-form-section agent-card-form-section"><h3>Carte professionnelle employeur</h3>
      <div class="agent-photo-editor"><div class="agent-photo-preview" id="agent-badge-photo-preview">${pendingBadgePhotoDataUrl?`<img src="${safe(pendingBadgePhotoDataUrl)}" alt="Photo agent">`:`<span>${safe(agentInitials(u))}</span>`}</div><div class="agent-photo-controls"><div class="field"><label>Photo agent</label><input class="input" id="badge-photo-file" type="file" accept="image/*" capture="user"></div><button class="btn small ghost" type="button" id="badge-photo-clear">Retirer la photo</button><p class="muted">Photo compressée puis stockée dans le bucket privé Supabase Storage.</p></div></div>
      <div class="form-grid">
        <div class="field"><label>Date de naissance</label><input class="input" type="date" name="birthDate" value="${safe(u.birthDate || '')}"></div>
        <div class="field"><label>Lieu de naissance</label><input class="input" name="birthPlace" value="${safe(u.birthPlace || '')}" placeholder="Ville, pays"></div>
        <div class="field"><label>NUB CNAPS</label><input class="input mono" name="nub" value="${safe(u.nub || '')}" placeholder="NUB / identifiant CNAPS"></div>
        <div class="field"><label>N° carte professionnelle</label><input class="input mono" name="professionalCard" value="${safe(badgeProfessionalCard(u) === '—' ? '' : badgeProfessionalCard(u))}" placeholder="CAR-..."></div>
        <div class="field"><label>Date de délivrance</label><input class="input" type="date" name="professionalCardIssueDate" value="${safe(u.professionalCardIssueDate || '')}"></div>
        <div class="field"><label>Date d’expiration</label><input class="input" type="date" name="professionalCardExpiryDate" value="${safe(u.professionalCardExpiryDate || '')}"></div>
        <div class="field"><label>N° badge interne</label><input class="input" name="badgeNumber" value="${safe(u.badgeNumber || '')}" placeholder="BADGE-001"></div>
        <div class="field"><label>Dernière vérification CNAPS</label><input class="input" type="date" name="cnapsLastCheckDate" value="${safe(u.cnapsLastCheckDate || '')}"></div>
        <div class="field span-2"><label>Activité(s) autorisée(s)</label><textarea class="textarea" name="authorizedActivities" rows="3" placeholder="Surveillance humaine, gardiennage, événementiel...">${safe(u.authorizedActivities || u.securityActivity || '')}</textarea></div>
        <div class="field span-2"><label>Spécialité(s) / qualification(s)</label><textarea class="textarea" name="specialties" rows="3" placeholder="Agent événementiel, Agent de sécurité confirmé, SSIAP...">${safe(u.specialties || u.qualifications || '')}</textarea></div>
        <div class="field"><label>Début contrat</label><input class="input" type="date" name="contractStartDate" value="${safe(u.contractStartDate || '')}"></div>
        <div class="field"><label>Fin contrat</label><input class="input" type="date" name="contractEndDate" value="${safe(u.contractEndDate || '')}"></div>
      </div>
    </div>

    <div class="invoice-form-section"><h3>Informations carte employeur</h3><div class="form-grid">
      <div class="field"><label>Nom entreprise</label><input class="input" name="badgeCompanyName" value="${safe(c.name)}"></div>
      <div class="field"><label>Téléphone entreprise</label><input class="input" name="badgeCompanyPhone" value="${safe(c.phone)}"></div>
      <div class="field"><label>Adresse entreprise</label><input class="input" name="badgeCompanyAddress" value="${safe(c.address)}"></div>
      <div class="field"><label>CP / Ville</label><input class="input" name="badgeCompanyPostalCity" value="${safe(c.postalCity)}"></div>
      <div class="field span-2"><label>Autorisation d’exercice CNAPS entreprise</label><input class="input mono" name="badgeCompanyCnapsAuthorization" value="${safe(c.cnaps)}" placeholder="AUT-..."></div>
      <div class="field span-2"><label>Mention carte</label><textarea class="textarea" name="badgeCompanyLegalNotice" rows="3">${safe(c.legalNotice)}</textarea></div>
    </div></div>
    <button class="btn primary full" type="submit">${isEdit?'Enregistrer profil et badge':'Créer compte et profil'}</button></form>`, 'wide');

  const preview = document.querySelector('#agent-badge-photo-preview');
  const refreshPreview = () => {
    if (!preview) return;
    preview.innerHTML = pendingBadgePhotoDataUrl ? `<img src="${safe(pendingBadgePhotoDataUrl)}" alt="Photo agent">` : `<span>${safe(agentInitials({prenom:document.querySelector('[name="prenom"]')?.value, nom:document.querySelector('[name="nom"]')?.value}))}</span>`;
  };
  document.querySelector('[name="prenom"]')?.addEventListener('input', refreshPreview);
  document.querySelector('[name="nom"]')?.addEventListener('input', refreshPreview);
  document.querySelector('#badge-photo-file')?.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const photo = await compressBadgePhoto(file);
      pendingBadgePhotoDataUrl = photo.dataUrl;
      refreshPreview();
      toast('Photo agent ajoutée au badge.', 'success');
    } catch(error) {
      console.error(error);
      toast(userFriendlyError(error,'Photo impossible.'),'error');
      e.target.value = '';
    }
  });
  document.querySelector('#badge-photo-clear')?.addEventListener('click', () => { pendingBadgePhotoDataUrl=''; refreshPreview(); });

  document.querySelector('#agent-form').addEventListener('submit', async e => {
    e.preventDefault();
    const form = e.currentTarget;
    const fd = new FormData(form);
    let uid = String(fd.get('uid') || '').trim();
    const email = String(fd.get('email') || '').trim();
    const password = String(fd.get('password') || '');
    const passwordConfirm = String(fd.get('passwordConfirm') || '');
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      if (!isEdit && !uid) {
        if (password.length < 8) throw new Error('Mot de passe : minimum 8 caractères.');
        if (password !== passwordConfirm) throw new Error('Les mots de passe ne correspondent pas.');
        uid = await createAuthAccountFromAdmin(email, password, { role:String(fd.get('role')||'agent'), prenom:String(fd.get('prenom')||''), nom:String(fd.get('nom')||''), telephone:String(fd.get('telephone')||'') });
      }
      if (!uid) throw new Error('UID historique (external_uid) manquant.');
      await setDoc(docRef('users', uid), {
        uid, email,
        prenom:fd.get('prenom'), nom:fd.get('nom'), telephone:fd.get('telephone'), matricule:fd.get('matricule'),
        address:fd.get('address'), postalCode:fd.get('postalCode'), city:fd.get('city'),
        birthDate:fd.get('birthDate'), birthPlace:fd.get('birthPlace'), nub:fd.get('nub'),
        professionalCard:fd.get('professionalCard'), professionalCardNumber:fd.get('professionalCard'), professionalCardIssueDate:fd.get('professionalCardIssueDate'), professionalCardExpiryDate:fd.get('professionalCardExpiryDate'),
        badgeNumber:fd.get('badgeNumber'), cnapsLastCheckDate:fd.get('cnapsLastCheckDate'), authorizedActivities:fd.get('authorizedActivities'), specialties:fd.get('specialties'), qualifications:fd.get('specialties'),
        contractStartDate:fd.get('contractStartDate'), contractEndDate:fd.get('contractEndDate'), badgePhotoDataUrl:pendingBadgePhotoDataUrl,
        badgeCompanyName:fd.get('badgeCompanyName'), badgeCompanyPhone:fd.get('badgeCompanyPhone'), badgeCompanyAddress:fd.get('badgeCompanyAddress'), badgeCompanyPostalCity:fd.get('badgeCompanyPostalCity'), badgeCompanyCnapsAuthorization:fd.get('badgeCompanyCnapsAuthorization'), badgeCompanyLegalNotice:fd.get('badgeCompanyLegalNotice'),
        role:fd.get('role'), statut:fd.get('statut'),
        isOnline:u.isOnline ?? false,
        siteActuel:u.siteActuel ?? null,
        siteActuelNom:u.siteActuelNom ?? null,
        updatedAt:serverTimestamp(), updatedBy:currentUser.uid,
        badgeUpdatedAt:serverTimestamp(), badgeUpdatedBy:currentUser.uid,
        createdAt:u.createdAt || serverTimestamp(), createdBy:u.createdBy || currentUser.uid
      }, { merge:true });
      await addAudit(isEdit?'user_profile_updated':'user_account_created', { uid, role:fd.get('role'), badgeConfigured:Boolean(fd.get('professionalCard') || pendingBadgePhotoDataUrl) });
      closeModal(); toast(isEdit?'Profil et badge enregistrés':'Compte et profil créés', 'success');
    } catch(error) {
      console.error(error);
      toast(userFriendlyError(error, 'Création impossible. Vérifie Supabase Auth, les RLS et les champs.'), 'error');
    } finally {
      submitBtn.disabled = false;
    }
  });
}

async function createAuthAccountFromAdmin(email, password, metadata={}){
  const client=getSupabaseClient();
  const {data,error}=await client.functions.invoke('admin-manage-user',{
    body:{action:'create',email,password,role:metadata.role||'agent',firstName:metadata.prenom||'',lastName:metadata.nom||'',phone:metadata.telephone||''}
  });
  if(error) throw error;
  if(!data?.ok||!data?.externalUid) throw new Error(data?.error||'Création Supabase Auth non confirmée.');
  return String(data.externalUid);
}
async function deleteAuthAccountFromAdmin(user){
  const authUserId=String(user?.authUserId||'').trim();
  if(!authUserId) return {ok:true,skipped:true};
  const client=getSupabaseClient();
  const {data,error}=await client.functions.invoke('admin-manage-user',{body:{action:'delete',authUserId}});
  if(error) throw error;
  if(!data?.ok) throw new Error(data?.error||'Suppression Supabase Auth non confirmée.');
  return data;
}

function renderQGSites(){
  currentRoute = 'sites';
  const body = `<section class="card"><div class="card-title"><div><h2>Gestion Sites</h2><p>Consignes, contacts, points de ronde</p></div><button class="btn primary small" id="add-site">Ajouter site</button></div><div id="sites-table" class="table-wrap"><div class="empty">Chargement...</div></div></section>`;
  render(page('Gestion Sites', 'Configuration opérationnelle des missions', body));
  document.querySelector('#add-site').addEventListener('click', () => showSiteForm());
  const q = query(collectionRef('sites'), orderBy('name'));
  unsubscribeList.push(onSnapshot(q, snap => renderSitesTable(snap.docs.map(d=>({id:d.id,...d.data()})))));
}
function renderSitesTable(rows){
  const box = document.querySelector('#sites-table');
  if (!rows.length) return box.innerHTML = `<div class="empty">Aucun site configuré.</div>`;
  const billingHead = isStrictAdmin() ? '<th>Tarif horaire</th>' : '';
  box.innerHTML = `<table class="table"><thead><tr><th>Couleur</th><th>Site</th><th>Client</th><th>Adresse</th>${billingHead}<th>Actif</th><th>Action</th></tr></thead><tbody>${rows.map(s=>{const color=normalizeHexColor(s.planningColor)||planningColorForSite(s.id);return `<tr><td><span class="site-color-swatch" style="background:${color}" title="${color}"></span></td><td>${safe(s.name)}</td><td>${safe(s.clientName || '')}</td><td>${safe(s.address || '')}</td>${isStrictAdmin()?`<td>${s.hourlyRate?money(s.hourlyRate):'—'}</td>`:''}<td>${s.isActive?'Oui':'Non'}</td><td><div class="table-actions"><button class="btn small" data-edit-site="${safe(s.id)}">Modifier</button><button class="btn small" data-points-site="${safe(s.id)}">Points</button>${isStrictAdmin()?`<button class="btn small danger" data-delete-site="${safe(s.id)}">Supprimer</button>`:''}</div></td></tr>`}).join('')}</tbody></table>`;
  document.querySelectorAll('[data-edit-site]').forEach(btn => btn.addEventListener('click', () => showSiteForm(rows.find(s=>s.id===btn.dataset.editSite))));
  document.querySelectorAll('[data-points-site]').forEach(btn => btn.addEventListener('click', () => showCheckpointsManager(btn.dataset.pointsSite)));
  document.querySelectorAll('[data-delete-site]').forEach(btn => btn.addEventListener('click', () => requestDeleteSite(rows.find(s=>s.id===btn.dataset.deleteSite))));
}
function showSiteForm(s={}){
  const existingLat = s.gps?.lat ?? s.latitude ?? '';
  const existingLng = s.gps?.lng ?? s.longitude ?? '';
  showModal(s.id?'Modifier site':'Ajouter site', `<form id="site-form"><div class="form-grid">
    <div class="field"><label>Nom du site</label><input class="input" name="name" value="${safe(s.name || '')}" required></div>
    <div class="field"><label>Client</label><input class="input" name="clientName" value="${safe(s.clientName || '')}"></div>
    <div class="field field-wide"><label>Adresse complète</label><div class="address-geocode-row"><input class="input" id="site-address" name="address" value="${safe(s.address || '')}" placeholder="250 rue Jean Aicard, 83300 Draguignan" required><button class="btn" id="site-geocode-btn" type="button">Localiser</button></div><div id="site-geocode-status" class="geocode-status ${existingLat!==''&&existingLng!==''?'success':''}">${existingLat!==''&&existingLng!==''?'Position cartographique déjà enregistrée.':'La position sera calculée automatiquement depuis l’adresse.'}</div></div>
    <div class="field"><label>Contact client</label><input class="input" name="contactName" value="${safe(s.contactName || '')}"></div>
    <div class="field"><label>Téléphone client</label><input class="input" name="contactPhone" value="${safe(s.contactPhone || '')}"></div>
    <div class="field"><label>Urgence</label><input class="input" name="emergencyContact" value="${safe(s.emergencyContact || '')}"></div>
    <div class="field"><label>WhatsApp QG</label><input class="input" name="whatsappQG" value="${safe(s.whatsappQG || DEFAULT_QG_WHATSAPP)}"></div>
    <div class="field"><label>Couleur planning</label><div class="color-field"><input class="color-input" name="planningColor" type="color" value="${normalizeHexColor(s.planningColor) || planningColorForSite(s.id || 'nouveau-site')}"><span>Différencie ce site sur toutes les vues planning.</span></div></div>
    ${isStrictAdmin()?`<div class="field"><label>Tarif horaire HT (€)</label><input class="input" name="hourlyRate" type="number" min="0" step="0.01" value="${safe(s.hourlyRate ?? '')}" placeholder="25.00"></div>
    <div class="field"><label>TVA par défaut (%)</label><input class="input" name="vatRate" type="number" min="0" max="100" step="0.1" value="${safe(s.vatRate ?? '20')}"></div>
    <div class="field"><label>Email facturation client</label><input class="input" name="billingEmail" type="email" value="${safe(s.billingEmail || '')}"></div>
    <div class="field"><label>Adresse de facturation</label><input class="input" name="billingAddress" value="${safe(s.billingAddress || s.address || '')}"></div>`:''}
    <div class="field"><label>Actif</label><select class="select" name="isActive"><option value="true" ${s.isActive!==false?'selected':''}>Oui</option><option value="false" ${s.isActive===false?'selected':''}>Non</option></select></div>
  </div>
  <details class="advanced-coordinates"><summary>Réglage manuel de la position (facultatif)</summary><div class="form-grid"><div class="field"><label>Latitude</label><input class="input mono" id="site-latitude" name="latitude" type="number" step="any" value="${safe(existingLat)}" placeholder="43.433"></div><div class="field"><label>Longitude</label><input class="input mono" id="site-longitude" name="longitude" type="number" step="any" value="${safe(existingLng)}" placeholder="6.737"></div></div></details>
  <div class="field"><label>Consignes principales</label><textarea class="textarea site-instructions-input" name="instructions" placeholder="Consignes opérationnelles, accès, rondes, filtrage, contacts...">${safe(s.instructions || '')}</textarea></div><button class="btn primary full" type="submit">Enregistrer site</button></form>`, 'wide');
  const form = document.querySelector('#site-form');
  const addressInput = document.querySelector('#site-address');
  const latInput = document.querySelector('#site-latitude');
  const lngInput = document.querySelector('#site-longitude');
  const statusBox = document.querySelector('#site-geocode-status');
  const locateButton = document.querySelector('#site-geocode-btn');
  let lastGeocodedAddress = existingLat !== '' && existingLng !== '' ? String(s.address || '').trim() : '';
  let geocodeMeta = s.geocode || null;
  const previousInstructions = String(s.instructions || '').trim();
  const setGeoStatus = (message, type='') => {
    if (!statusBox) return;
    statusBox.className = `geocode-status ${type}`.trim();
    statusBox.textContent = message;
  };
  const locateAddress = async () => {
    const address = String(addressInput?.value || '').trim();
    if (!address) throw new Error('Renseigne d’abord l’adresse du site.');
    locateButton.disabled = true;
    locateButton.textContent = 'Recherche...';
    setGeoStatus('Recherche de l’adresse dans la Base Adresse Nationale...', 'loading');
    try {
      const result = await geocodeAddress(address);
      latInput.value = result.lat;
      lngInput.value = result.lng;
      lastGeocodedAddress = address;
      geocodeMeta = { label:result.label, score:result.score, source:result.source, geocodedAt:new Date().toISOString() };
      setGeoStatus(`Adresse localisée : ${result.label}`, 'success');
      return result;
    } catch(error) {
      setGeoStatus(error.message || 'Adresse introuvable.', 'error');
      throw error;
    } finally {
      locateButton.disabled = false;
      locateButton.textContent = 'Localiser';
    }
  };
  locateButton?.addEventListener('click', () => locateAddress().catch(error => toast(error.message, 'warning')));
  addressInput?.addEventListener('input', () => {
    if (String(addressInput.value || '').trim() !== lastGeocodedAddress) setGeoStatus('Adresse modifiée : la position sera recalculée à l’enregistrement.', '');
  });
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(form);
    const siteId = s.id || `site_${Date.now()}`;
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    try {
      const address = String(fd.get('address') || '').trim();
      let lat = Number(fd.get('latitude'));
      let lng = Number(fd.get('longitude'));
      const hasManualCoordinates = fd.get('latitude') !== '' && fd.get('longitude') !== '' && Number.isFinite(lat) && Number.isFinite(lng);
      if (!hasManualCoordinates || address !== lastGeocodedAddress) {
        const result = await locateAddress();
        lat = result.lat;
        lng = result.lng;
      }
      const payload = {
        siteId,
        name:fd.get('name'), clientName:fd.get('clientName'), address,
        contactName:fd.get('contactName'), contactPhone:fd.get('contactPhone'), emergencyContact:fd.get('emergencyContact'),
        whatsappQG:fd.get('whatsappQG'), instructions:fd.get('instructions'), isActive:fd.get('isActive')==='true',
        planningColor: normalizeHexColor(fd.get('planningColor')) || planningColorForSite(siteId),
        gps:{ lat, lng }, geocode:geocodeMeta,
        updatedAt:serverTimestamp(), updatedBy:currentUser.uid,
        createdAt:s.createdAt || serverTimestamp(), createdBy:s.createdBy || currentUser.uid
      };
      if (isStrictAdmin()) Object.assign(payload, { hourlyRate:Number(fd.get('hourlyRate') || 0), vatRate:Number(fd.get('vatRate') || 0), billingEmail:fd.get('billingEmail') || '', billingAddress:fd.get('billingAddress') || '' });
      await setDoc(docRef('sites', siteId), payload, { merge:true });
      const nextInstructions = String(payload.instructions || '').trim();
      let instructionsPush = { ok:false, skipped:true, reason:'Consignes inchangées' };
      if (s.id && nextInstructions !== previousInstructions) instructionsPush = await spNotifyInstructionsChanged({ id:siteId, name:payload.name }, nextInstructions);
      await addAudit('site_saved', { siteId, geocoded:true, lat, lng, instructionsChanged:s.id && nextInstructions !== previousInstructions, pushStatus:instructionsPush?.ok?'sent':instructionsPush?.reason||instructionsPush?.error||'skipped' });
      closeModal(); toast('Site enregistré et positionné sur la carte', 'success');
    } catch(error) {
      console.error(error);
      toast(userFriendlyError(error, error.message || 'Site impossible à enregistrer. Vérifie l’adresse et les RLS Supabase.'), 'error');
    } finally {
      submitBtn.disabled = false;
    }
  });
}
async function showCheckpointsManager(siteId){
  showModal('Points de ronde', `<div class="card compact"><form id="checkpoint-form"><div class="form-grid"><div class="field"><label>Nom point</label><input class="input" name="name" required></div><div class="field"><label>Zone</label><input class="input" name="zone"></div><div class="field"><label>Ordre</label><input class="input" name="order" type="number" value="1"></div><div class="field"><label>QR code</label><input class="input mono" name="qrCode" value="QR-${Date.now()}"></div></div><div class="field"><label>Description</label><input class="input" name="description"></div><button class="btn primary full" type="submit">Ajouter point</button></form></div><div class="divider"></div><div id="checkpoint-list" class="list"><div class="empty">Chargement...</div></div>`, 'wide');
  const renderList = async () => {
    const snap = await getDocs(query(collectionRef('roundCheckpoints'), where('siteId','==',siteId))).catch(()=>({docs:[]}));
    const rows = snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(a.order||0)-(b.order||0));
    document.querySelector('#checkpoint-list').innerHTML = rows.length ? rows.map(p=>`<div class="item"><div class="item-main"><div class="item-title">${safe(p.name)}</div><div class="item-meta">Zone : ${safe(p.zone||'—')} · Ordre : ${safe(p.order||'—')}<br>QR : <span class="mono">${safe(p.qrCode||p.id)}</span></div></div><div class="item-actions"><button class="btn small" data-print-qr="${safe(p.qrCode||p.id)}">Imprimer QR</button></div></div>`).join('') : `<div class="empty">Aucun point.</div>`;
    document.querySelectorAll('[data-print-qr]').forEach(btn => btn.addEventListener('click', () => printQRCode(btn.dataset.printQr)));
  };
  document.querySelector('#checkpoint-form').addEventListener('submit', async e => {
    e.preventDefault(); const fd = new FormData(e.currentTarget);
    await addDoc(collectionRef('roundCheckpoints'), { siteId, name:fd.get('name'), zone:fd.get('zone'), order:Number(fd.get('order')||0), qrCode:fd.get('qrCode'), description:fd.get('description'), isActive:true, createdAt:serverTimestamp(), createdBy:currentUser.uid });
    await addAudit('checkpoint_created', { siteId }); e.currentTarget.reset(); toast('Point créé', 'success'); renderList();
  });
  renderList();
}
function printQRCode(code){
  const url = `https://api.qrserver.com/v1/create-qr-code/?size=360x360&data=${encodeURIComponent(code)}`;
  const w = window.open('', '_blank');
  w.document.write(`<title>QR Point de ronde</title><body style="font-family:Arial;text-align:center;padding:40px"><h1>Point de ronde</h1><img src="${url}"><p>${safe(code)}</p><script>setTimeout(()=>print(),600)<\/script></body>`);
}

function renderQGAlerts(){
  currentRoute = 'alerts';
  const body = `<section class="card"><div class="card-title"><div><h2>Alertes SOS/PTI</h2><p>Prise en charge et clôture tracée</p></div></div><div id="alerts-list" class="list"><div class="empty">Chargement...</div></div></section>`;
  render(page('Alertes critiques', 'Traitement prioritaire des urgences terrain', body));
  const q = query(collectionRef('alerts'), orderBy('createdAt','desc'), limit(100));
  unsubscribeList.push(onSnapshot(q, snap => {
    const box = document.querySelector('#alerts-list');
    box.innerHTML = snap.empty ? `<div class="empty">Aucune alerte.</div>` : snap.docs.map(d=>alertItem({id:d.id,...d.data()})).join('');
    bindAlertActions();
  }));
}
function bindAlertActions(){
  document.querySelectorAll('[data-take-alert]').forEach(btn => btn.addEventListener('click', async () => {
    await updateDoc(docRef('alerts', btn.dataset.takeAlert), { statut:'taken', takenAt:serverTimestamp(), takenBy:currentUser.uid });
    await addAudit('alert_taken', { alertId:btn.dataset.takeAlert }); toast('Alerte prise en charge', 'success');
  }));
  document.querySelectorAll('[data-close-alert]').forEach(btn => btn.addEventListener('click', () => closeAlertFlow(btn.dataset.closeAlert)));
}
function closeAlertFlow(alertId){
  const reason = prompt('Justification obligatoire de clôture :');
  if (!reason || reason.trim().length < 5) return toast('Justification trop courte.', 'warning');
  updateDoc(docRef('alerts', alertId), { statut:'closed', closedAt:serverTimestamp(), closedBy:currentUser.uid, closeReason:reason.trim() })
    .then(()=>addAudit('alert_closed', { alertId, reason:reason.trim() }))
    .then(()=>toast('Alerte clôturée avec trace', 'success'))
    .catch(()=>toast('Erreur clôture alerte', 'error'));
}

async function renderQGFlash(){
  currentRoute = 'flash';
  const [sitesSnap, agentsSnap] = await Promise.all([
    getDocs(query(collectionRef('sites'), orderBy('name'))).catch(()=>({docs:[]})),
    getDocs(query(collectionRef('users'), orderBy('nom'))).catch(()=>({docs:[]}))
  ]);
  const sites = sitesSnap.docs.map(d=>({id:d.id,...d.data()}));
  const agents = agentsSnap.docs.map(d=>({id:d.id,...d.data()})).filter(u => u.role === 'agent');
  const targetOptions = [
    '<option value="all">Tous les agents</option>',
    '<option value="working">Agents en poste</option>',
    ...sites.map(s=>`<option value="site:${safe(s.id)}">Site · ${safe(s.name || s.siteNom || s.id)}</option>`),
    ...agents.map(a=>`<option value="agent:${safe(a.id || a.uid)}">Agent · ${safe(`${a.prenom || ''} ${a.nom || ''}`.trim() || a.email || a.id)}</option>`)
  ].join('');
  const pushStatus = webPushFunctionConfigured() ? '<span class="pill green">Web Push natif</span>' : '<span class="pill orange">Web Push à configurer</span>';
  const body = `<section class="grid cols-2"><div class="card"><div class="card-title"><div><h2>Envoyer Flash</h2><p>Alerte descendante prioritaire</p></div>${pushStatus}</div><form id="flash-form"><div class="field"><label>Titre</label><input class="input" name="title" required placeholder="Message Flash reçu"></div><div class="field"><label>Message</label><textarea class="textarea" name="message" required></textarea></div><div class="form-grid"><div class="field"><label>Priorité</label><select class="select" name="priority"><option>Information</option><option>Important</option><option>Urgent</option><option>Critique</option></select></div><div class="field"><label>Cible</label><select class="select" name="target">${targetOptions}</select></div></div><button class="btn primary full" type="submit">Envoyer Flash</button></form><div class="divider"></div><button class="btn full" id="diagnose-push" data-action="diagnose-web-push" type="button">Diagnostic Web Push</button><p class="muted" style="font-size:12px;margin-top:10px">Le Flash reste visible dans l’app et peut aussi être envoyé sur l’écran verrouillé via Supabase Edge Functions + Web Push natif.</p></div><div class="card"><div class="card-title"><div><h2>Historique Flash</h2><p>Confirmations de lecture et statut push</p></div></div><div id="flash-history" class="list"><div class="empty">Chargement...</div></div></div></section>`;
  render(page('Messages Flash QG', 'Communication descendante immédiate', body));
  document.querySelector('#flash-form').addEventListener('submit', async e => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const flashRef = await addDoc(collectionRef('flashMessages'), { title:fd.get('title'), message:fd.get('message'), priority:fd.get('priority'), target:fd.get('target'), sentBy:currentUser.uid, sentAt:serverTimestamp(), readBy:{}, status:'sent', pushStatus:'pending' });
    await addAudit('flash_sent', { priority:fd.get('priority'), target:fd.get('target') });
    try {
      const push = await sendPushForFlash({ id:flashRef.id, title:fd.get('title'), message:fd.get('message'), priority:fd.get('priority'), target:fd.get('target') });
      await updateDoc(docRef('flashMessages', flashRef.id), { pushStatus:push?.skipped?'skipped':'sent', pushProvider:'supabase-web-push', pushSentAt:serverTimestamp(), pushResponse:push || null }).catch(()=>{});
      toast(push?.skipped ? 'Flash envoyé dans l’app. Push non configuré.' : 'Flash envoyé + notification push demandée.', push?.skipped ? 'warning' : 'success');
    } catch(error) {
      console.error(error);
      await updateDoc(docRef('flashMessages', flashRef.id), { pushStatus:'failed', pushError:String(error.message || error), pushProvider:'supabase-web-push' }).catch(()=>{});
      toast('Flash envoyé dans l’app, mais la notification push a échoué.', 'warning');
    }
    e.currentTarget.reset();
  });
  const q = query(collectionRef('flashMessages'), orderBy('sentAt','desc'), limit(30));
  unsubscribeList.push(onSnapshot(q, snap => {
    const box = document.querySelector('#flash-history');
    box.innerHTML = snap.empty ? `<div class="empty">Aucun Flash envoyé.</div>` : snap.docs.map(d=>{ const f={id:d.id,...d.data()}; return `<div class="item"><div class="item-main"><div class="item-title">${safe(f.title)} <span class="pill ${f.priority==='Critique'?'red':f.priority==='Urgent'?'orange':'blue'}">${safe(f.priority)}</span></div><div class="item-meta">${dateText(f.sentAt)} · Cible ${safe(f.target)}<br>${safe(f.message)}<br>Lectures : ${Object.keys(f.readBy || {}).length} · Push : ${safe(f.pushStatus || '—')}</div></div></div>`}).join('');
  }));
}


// -------------------- CENTRE DOCUMENTS QG --------------------
function isoDateValue(value){
  if (!value) return null;
  const d = value.toDate ? value.toDate() : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function documentTypeLabel(type){ return ({mci:'Main courante MCI', mission:'Rapport de mission', rounds:'Rapport de rondes', alerts:'Rapport SOS / PTI', invoice:'Facture'}[type] || type || 'Document'); }
function compactReport(r){ return { id:r.id||'', createdAt:isoDateValue(r.createdAt), agentId:r.agentId||'', agentNom:r.agentNom||'', siteId:r.siteId||'', siteNom:r.siteNom||'', missionId:r.missionId||'', shiftId:r.shiftId||'', category:r.category||'', severity:r.severity||'', message:r.message||'', status:r.status||'new', supervisorNote:r.supervisorNote||'', photoUrl:r.photoUrl||'', photoAvailable:Boolean(r.photoAvailable||r.photoUrl||r.photoStoragePath), photoStorageBucket:r.photoStorageBucket||'', photoStoragePath:r.photoStoragePath||'', photoBytes:Number(r.photoBytes||0), photoMimeType:r.photoMimeType||'', photoWidth:Number(r.photoWidth||0), photoHeight:Number(r.photoHeight||0), photoCapturedAt:isoDateValue(r.photoCapturedAt)||null, gps:r.gps||null }; }
function compactRound(r){ return { id:r.id||'', scannedAt:isoDateValue(r.scannedAt), agentId:r.agentId||'', agentNom:r.agentNom||'', siteId:r.siteId||'', siteNom:r.siteNom||'', checkpointName:r.checkpointName||'', scanMethod:r.scanMethod||'', isValid:r.isValid !== false }; }
function compactAlert(r){ return { id:r.id||'', createdAt:isoDateValue(r.createdAt || r.heure), agentId:r.agentId||'', agentNom:r.agentNom||'', siteId:r.siteActuel||r.siteId||'', siteNom:r.siteActuelNom||r.siteNom||'', typeAlerte:r.typeAlerte||'SOS/PTI', statut:r.statut||'', niveau:r.niveau||'', message:r.message||'', closeReason:r.closeReason||r.closureReason||'' }; }
function compactMission(m){ return { id:m.id||'', agentId:m.agentId||'', agentNom:m.agentNom||'', siteId:m.siteId||'', siteNom:m.siteNom||'', clientId:m.clientId||'', type:m.type||m.missionType||'', instructions:m.instructions||'', status:m.status||'', scheduledStart:isoDateValue(m.scheduledStart), scheduledEnd:isoDateValue(m.scheduledEnd), actualStart:isoDateValue(m.actualStart), actualEnd:isoDateValue(m.actualEnd), conformityScore:m.conformityScore ?? null, roundsCount:m.roundsCount||0, incidentsCount:m.incidentsCount||0 }; }
function compactShift(s){ return { id:s.id||'', missionId:s.missionId||'', missionTitle:s.missionTitle||'', shiftType:s.shiftType||s.missionType||'', missionInstructions:s.missionInstructions||'', agentId:s.agentId||'', agentNom:s.agentNom||'', siteId:s.siteId||'', siteNom:s.siteNom||'', clientId:s.clientId||'', startTime:isoDateValue(s.startTime), completedAt:isoDateValue(s.completedAt), scheduledStart:isoDateValue(s.scheduledStart), scheduledEnd:isoDateValue(s.scheduledEnd), roundsCount:s.roundsCount||0, incidentsCount:s.incidentsCount||0, conformityScore:s.conformityScore ?? null, signatureName:s.signatureName||'', handoverNote:s.handoverNote||'' }; }
function missionDisplayType(m={}, sh={}){
  const explicit = String(m.type || m.missionType || sh.shiftType || sh.missionType || '').trim();
  if (explicit) return explicit;
  const freeShift = /libre/i.test(String(sh.missionTitle || '')) || (!m.id && !sh.missionId);
  return freeShift ? 'Prise de poste libre' : 'Mission de sécurité';
}
function missionPlannedText(m={}, sh={}){
  const start = m.scheduledStart || sh.scheduledStart || null;
  const end = m.scheduledEnd || sh.scheduledEnd || null;
  if (start && end) return `${dateText(start)} → ${dateText(end)}`;
  if (start) return `${dateText(start)} → fin prévue non renseignée`;
  if (end) return `Début prévu non renseigné → ${dateText(end)}`;
  const freeShift = /libre/i.test(String(m.type || sh.shiftType || sh.missionTitle || '')) || (!m.id && !sh.missionId);
  return freeShift ? 'Prise de poste libre — aucun horaire planifié' : 'Horaires prévus non renseignés';
}
function inPeriod(value, from, to){
  const d = value?.toDate ? value.toDate() : new Date(value || 0);
  if (Number.isNaN(d.getTime())) return false;
  return (!from || d >= from) && (!to || d <= to);
}

function documentSlug(value, ext='pdf'){
  const base = String(value || 'document').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'').toLowerCase() || 'document';
  return `${base}.${ext}`;
}
function getJsPDF(){ return window.jspdf?.jsPDF || window.jsPDF || null; }
function addPdfFooter(doc, page=1){
  doc.setFontSize(8); doc.setTextColor(120,130,145);
  doc.text(`Sentinelle Pro · Document généré le ${new Date().toLocaleString('fr-FR')} · Page ${page}`, 14, 287);
}
function addPdfWrappedText(doc, text, x, y, maxWidth=180, lineHeight=5){
  const lines = doc.splitTextToSize(String(text || '—'), maxWidth);
  lines.forEach(line => {
    if (y > 278) { doc.addPage(); y = 16; addPdfFooter(doc, doc.getNumberOfPages()); }
    doc.text(line, x, y); y += lineHeight;
  });
  return y;
}
function generatedDocumentRows(d){
  const p = d?.payload || {};
  if (d.type === 'mission') return p.timelineRows || buildMissionTimeline({ mission:p.mission||{}, shift:p.shift||{}, reports:p.rows||[] });
  if (d.type === 'invoice') return p.invoice?.lines || p.lines || [];
  if (d.type === 'mci') return (p.rows || []).slice().sort((a,b)=>missionEventMs(a.createdAt)-missionEventMs(b.createdAt)||String(a.id||'').localeCompare(String(b.id||''),'fr'));
  return p.rows || [];
}
function generatedDocumentMeta(d){
  const p = d?.payload || {};
  if (d.type === 'mission') {
    const m = p.mission || {}, sh = p.shift || {};
    return [
      `Site : ${m.siteNom || sh.siteNom || d.siteNom || '—'}`,
      `Agent : ${m.agentNom || sh.agentNom || '—'}`,
      `Type de mission : ${missionDisplayType(m, sh)}`,
      `Horaires prévus : ${missionPlannedText(m, sh)}`,
      `Horaires réalisés : ${dateText(sh.startTime)} → ${dateText(sh.completedAt)}`,
      `Conformité : ${sh.conformityScore ?? m.conformityScore ?? '—'}%`
    ];
  }
  if (d.type === 'invoice') {
    const inv = p.invoice || p || {};
    return [`Facture : ${inv.number || d.title || '—'}`, `Client : ${inv.clientName || inv.siteNom || '—'}`, `Période : ${dateOnlyText(inv.periodStart)} → ${dateOnlyText(inv.periodEnd)}`, `Total TTC : ${money(inv.total)}`];
  }
  return [`Type : ${documentTypeLabel(d.type)}`, `Site : ${d.siteNom || 'Tous sites'}`, `Lignes : ${d.rowCount || generatedDocumentRows(d).length}`];
}
async function downloadGeneratedPdf(d, { silent=false }={}){
  try {
    const prepared = await prepareGeneratedDocumentPhotos(d);
    const doc = createGeneratedDocumentPdf(prepared);
    doc.save(documentSlug(d.title || documentTypeLabel(d.type), 'pdf'));
    if (!silent) toast('PDF généré et téléchargé.', 'success');
  } catch(error) {
    console.error(error);
    toast(userFriendlyError(error, 'PDF indisponible. Utilise Imprimer / PDF.'), 'error');
  }
}
async function deliverGeneratedDocumentToSupabase(archived){
  if (!supabaseBridgeEnabled() || !navigator.onLine || !archived?.id) return { skipped:true };
  try {
    const preparedArchived = await prepareGeneratedDocumentPhotos(archived);
    const pdfBlob = createGeneratedDocumentPdf(preparedArchived).output('blob');
    const result = await mirrorGeneratedDocument({ firebaseUser:currentUser, profile:currentProfile, document:archived, pdfBlob });
    await updateDoc(docRef('generatedDocuments', archived.id), {
      deliveryStatus:result?.emailQueued ? 'email_queued' : 'supabase_archived',
      supabaseDocumentId:result?.documentId || null,
      supabaseStoragePath:result?.storagePath || null,
      deliveryError:null,
      deliveredAt:serverTimestamp()
    }).catch(()=>{});
    return result;
  } catch(error) {
    console.error('Passerelle Supabase/Brevo indisponible', error);
    await updateDoc(docRef('generatedDocuments', archived.id), {
      deliveryStatus:'bridge_failed', deliveryError:String(error?.message || error), deliveryAttemptAt:serverTimestamp()
    }).catch(()=>{});
    throw error;
  }
}
async function retryPendingSupabaseDeliveries(){
  if (!supabaseBridgeEnabled() || !navigator.onLine || !currentUser || !currentProfile) return;
  const isAgentPortal = rolePortal(currentProfile.role) === 'agent';
  const source = isAgentPortal
    ? query(collectionRef('generatedDocuments'), where('createdBy','==',currentUser.uid), where('type','==','mission'), limit(25))
    : query(collectionRef('generatedDocuments'), orderBy('createdAt','desc'), limit(50));
  const snap = await getDocs(source).catch(()=>null);
  if (!snap) return;
  const pending = snap.docs.map(d=>({id:d.id,...d.data()})).filter(d=>['pending','bridge_failed'].includes(d.deliveryStatus));
  for (const document of pending) {
    await deliverGeneratedDocumentToSupabase(document).catch(()=>{});
  }
}

async function archivePdfDocument(data, { silent=false, documentId=null }={}){
  const payload = { ...data, fileType:'pdf', status:'active', deliveryStatus:supabaseBridgeEnabled() ? 'pending' : 'firebase_only', createdAt:serverTimestamp(), createdBy:currentUser.uid, createdByNom:`${currentProfile.prenom||''} ${currentProfile.nom||''}`.trim() };
  const ref = documentId ? docRef('generatedDocuments', documentId) : doc(collectionRef('generatedDocuments'));
  await setDoc(ref, payload);
  const archived = { id:ref.id, ...payload, createdAt:new Date() };
  await addAudit('generated_pdf_archived', { type:data.type, title:data.title || '', documentId:ref.id, missionId:data.missionId || null, rowCount:data.rowCount || 0 });
  if (supabaseBridgeEnabled()) deliverGeneratedDocumentToSupabase(archived).catch(()=>{});
  if (!silent) toast('PDF archivé dans Documents.', 'success');
  return archived;
}
async function renderQGDocuments(){
  currentRoute = 'documents';
  const today = new Date();
  const monthAgo = new Date(today); monthAgo.setDate(monthAgo.getDate()-30);
  const body = `<section class="grid cols-2 documents-layout">
    <div class="card"><div class="card-title"><div><h2>Générateur de documents</h2><p>Crée puis archive un document dans Sentinelle Pro</p></div></div>
      <form id="document-generator-form">
        <div class="form-grid"><div class="field"><label>Type de document</label><select class="select" name="type" id="document-type"><option value="mci">Main courante MCI</option><option value="mission">Rapport de mission</option><option value="rounds">Rapport de rondes</option><option value="alerts">Rapport SOS / PTI</option></select></div><div class="field"><label>Site</label><select class="select" name="siteId" id="document-site"><option value="">Tous les sites</option></select></div></div>
        <div class="field hidden" id="document-mission-wrap"><label>Mission</label><select class="select" name="missionId" id="document-mission"><option value="">Choisir une mission</option></select></div>
        <div class="form-grid" id="document-period-wrap"><div class="field"><label>Du</label><input class="input" name="dateFrom" type="date" value="${monthAgo.toISOString().slice(0,10)}"></div><div class="field"><label>Au</label><input class="input" name="dateTo" type="date" value="${today.toISOString().slice(0,10)}"></div></div>
        <div class="field"><label>Titre personnalisé (optionnel)</label><input class="input" name="title" placeholder="Ex : Main courante hebdomadaire — Site Alpha"></div>
        <button class="btn primary full" type="submit">Générer et archiver</button>
      </form>
      <div class="setup-box" style="margin-top:14px">V5.8.7.1 : métadonnées et fichier PDF privé sont archivés dans Supabase. L’envoi e-mail automatique reste désactivé sur le staging.</div>
    </div>
    <div class="card"><div class="card-title"><div><h2>Documents archivés</h2><p>MCI, missions, rondes, SOS et factures</p></div><div class="field compact-field"><select class="select" id="documents-filter"><option value="">Tous</option><option value="mci">MCI</option><option value="mission">Missions</option><option value="rounds">Rondes</option><option value="alerts">SOS</option><option value="invoice">Factures</option></select></div></div><div id="generated-documents-list" class="list"><div class="empty">Chargement...</div></div></div>
  </section>`;
  render(page('Documents', 'Génération, archivage et téléchargement opérationnel', body));
  const [sitesSnap, missionsSnap] = await Promise.all([
    getDocs(query(collectionRef('sites'), orderBy('name'))).catch(()=>({docs:[]})),
    getDocs(query(collectionRef('missions'), orderBy('scheduledStart','desc'), limit(300))).catch(()=>({docs:[]}))
  ]);
  const sites = sitesSnap.docs.map(d=>({id:d.id,...d.data()}));
  const missions = missionsSnap.docs.map(d=>({id:d.id,...d.data()}));
  document.querySelector('#document-site').innerHTML = `<option value="">Tous les sites</option>` + sites.map(s=>`<option value="${safe(s.id)}">${safe(s.name)}</option>`).join('');
  document.querySelector('#document-mission').innerHTML = `<option value="">Choisir une mission</option>` + missions.map(m=>`<option value="${safe(m.id)}">${safe(m.siteNom||'Site')} · ${safe(m.agentNom||'Agent')} · ${dateText(m.scheduledStart)}</option>`).join('');
  const updateForm = () => {
    const missionMode = document.querySelector('#document-type')?.value === 'mission';
    document.querySelector('#document-mission-wrap')?.classList.toggle('hidden', !missionMode);
    document.querySelector('#document-period-wrap')?.classList.toggle('hidden', missionMode);
  };
  document.querySelector('#document-type')?.addEventListener('change', updateForm); updateForm();
  document.querySelector('#document-generator-form')?.addEventListener('submit', async e=>{
    e.preventDefault();
    const btn=e.currentTarget.querySelector('button[type="submit"]'); btn.disabled=true;
    try {
      const archived = await generateAndArchiveDocument(new FormData(e.currentTarget), {sites, missions});
      if (archived) {
        await downloadGeneratedPdf(archived, { silent:true });
        const documentPush = await spNotifyDocumentArchived(archived);
        await addAudit('generated_document_notified', { documentId:archived.id, type:archived.type, pushStatus:documentPush?.ok?'sent':documentPush?.reason||documentPush?.error||'skipped' });
      }
      toast('PDF archivé dans Documents.', 'success');
    }
    catch(error){ console.error(error); toast(userFriendlyError(error,'Génération impossible.'),'error'); }
    finally { btn.disabled=false; }
  });
  listenGeneratedDocuments();
}
async function generateAndArchiveDocument(fd, caches={}){
  const type = String(fd.get('type')||'mci');
  const siteId = String(fd.get('siteId')||'');
  const site = (caches.sites||[]).find(s=>s.id===siteId);
  const titleInput = String(fd.get('title')||'').trim();
  const from = fd.get('dateFrom') ? new Date(`${fd.get('dateFrom')}T00:00:00`) : null;
  const to = fd.get('dateTo') ? new Date(`${fd.get('dateTo')}T23:59:59`) : null;
  let payload={}, rowCount=0, title='', missionId=null;
  if (type === 'mission'){
    missionId = String(fd.get('missionId')||'');
    if (!missionId) throw new Error('Choisis une mission.');
    const missionSnap = await getDoc(docRef('missions',missionId));
    if (!missionSnap.exists()) throw new Error('Mission introuvable.');
    const mission = {id:missionSnap.id,...missionSnap.data()};
    const [reportsSnap,shiftsSnap] = await Promise.all([
      getDocs(query(collectionRef('reports'),where('missionId','==',missionId))).catch(()=>({docs:[]})),
      getDocs(query(collectionRef('shifts'),where('missionId','==',missionId))).catch(()=>({docs:[]}))
    ]);
    const reports = reportsSnap.docs.map(d=>compactReport({id:d.id,...d.data()}));
    const shift = shiftsSnap.docs.length ? compactShift({id:shiftsSnap.docs[0].id,...shiftsSnap.docs[0].data()}) : {};
    payload={mission:compactMission(mission),shift,rows:reports}; rowCount=reports.length;
    title=titleInput || `Rapport mission — ${mission.siteNom || 'Site'} — ${mission.agentNom || 'Agent'}`;
  } else {
    const config = type==='mci' ? {collection:'reports',date:'createdAt',compact:compactReport} : type==='rounds' ? {collection:'roundCheckpointsLogs',date:'scannedAt',compact:compactRound} : {collection:'alerts',date:'createdAt',compact:compactAlert};
    const snap = await getDocs(query(collectionRef(config.collection), limit(1200))).catch(()=>({docs:[]}));
    let rows=snap.docs.map(d=>({id:d.id,...d.data()}));
    rows=rows.filter(r=>(!siteId || r.siteId===siteId || r.siteActuel===siteId) && inPeriod(r[config.date] || r.heure,from,to));
    rowCount=rows.length;
    const compactRows=rows.slice(0,350).map(config.compact);
    payload={rows:compactRows,truncated:rowCount>compactRows.length};
    title=titleInput || `${documentTypeLabel(type)} — ${site?.name || 'Tous sites'} — ${fd.get('dateFrom')||''} au ${fd.get('dateTo')||''}`;
  }
  return archivePdfDocument({ type,title,siteId:siteId||null,siteNom:site?.name||null,missionId,rowCount,payload }, { silent:true });
}
function listenGeneratedDocuments(){
  const box=document.querySelector('#generated-documents-list'); if(!box)return;
  let rows=[];
  const redraw=()=>{
    const type=document.querySelector('#documents-filter')?.value||'';
    const filtered=rows.filter(d=>!type||d.type===type);
    box.innerHTML=filtered.length?filtered.map(d=>`<div class="item document-item pdf-document"><div class="item-main"><div class="item-title">${safe(d.title||documentTypeLabel(d.type))} <span class="pill blue">PDF</span></div><div class="item-meta">${safe(documentTypeLabel(d.type))} · ${safe(d.siteNom||'Tous sites')} · ${d.rowCount||0} ligne(s)<br>Créé ${dateText(d.createdAt)} par ${safe(d.createdByNom||'QG')}</div></div><div class="item-actions"><button class="btn small primary" data-open-generated-doc="${safe(d.id)}">Aperçu</button><button class="btn small success" data-download-generated-doc="${safe(d.id)}">Télécharger PDF</button>${isStrictAdmin()?`<button class="btn small danger" data-delete-generated-doc="${safe(d.id)}">Supprimer</button>`:''}</div></div>`).join(''):`<div class="empty">Aucun document PDF archivé.</div>`;
    document.querySelectorAll('[data-open-generated-doc]').forEach(btn=>btn.addEventListener('click',()=>openGeneratedDocument(rows.find(d=>d.id===btn.dataset.openGeneratedDoc))));
    document.querySelectorAll('[data-download-generated-doc]').forEach(btn=>btn.addEventListener('click',()=>downloadGeneratedDocument(rows.find(d=>d.id===btn.dataset.downloadGeneratedDoc))));
    document.querySelectorAll('[data-delete-generated-doc]').forEach(btn=>btn.addEventListener('click',()=>requestDeleteGeneratedDocument(rows.find(d=>d.id===btn.dataset.deleteGeneratedDoc))));
  };
  document.querySelector('#documents-filter')?.addEventListener('change',redraw);
  unsubscribeList.push(onSnapshot(query(collectionRef('generatedDocuments'),orderBy('createdAt','desc'),limit(250)),snap=>{rows=snap.docs.map(d=>({id:d.id,...d.data()}));redraw();},()=>box.innerHTML='<div class="empty">Documents indisponibles. Vérifie les RLS Supabase.</div>'));
}
function openGeneratedDocument(d){
  if(!d)return;
  showModal('Document archivé',`<div class="document-preview">${generatedDocumentHtml(d)}</div><div class="btn-row"><button class="btn primary" id="download-generated-pdf">Télécharger PDF</button><button class="btn" id="print-generated-document">Imprimer depuis aperçu</button><button class="btn ghost" id="download-generated-csv">Exporter CSV</button></div>`,'wide');
  document.querySelector('#download-generated-pdf')?.addEventListener('click',()=>downloadGeneratedPdf(d));
  document.querySelector('#print-generated-document')?.addEventListener('click',()=>printGeneratedDocument(d));
  document.querySelector('#download-generated-csv')?.addEventListener('click',()=>exportCSV(generatedDocumentRows(d),`${documentSlug(d.title||d.type,'csv')}`));
}
function printGeneratedDocument(d){
  document.querySelector('#print-root')?.remove();
  const root=document.createElement('div');root.id='print-root';root.className='print-root';root.innerHTML=generatedDocumentHtml(d);document.body.appendChild(root);
  toast('Aperçu préparé. Choisis Imprimer puis Enregistrer en PDF si besoin.','success');
  window.addEventListener('afterprint',()=>setTimeout(()=>root.remove(),400),{once:true});setTimeout(()=>window.print(),220);setTimeout(()=>root.remove(),15000);
}
function downloadGeneratedDocument(d){
  if(!d)return;
  downloadGeneratedPdf(d);
}
function requestDeleteGeneratedDocument(d){
  if(!d)return;
  confirmDestructiveAction({title:'Supprimer le document',message:`Le document “${d.title||d.id}” sera supprimé définitivement de la rubrique Documents.`,onConfirm:async()=>{await addAudit('generated_document_deleted',{documentId:d.id,title:d.title||''});await deleteDoc(docRef('generatedDocuments',d.id));toast('Document supprimé.','success');}});
}
async function archiveMissionGroup(group){
  const first=group?.reports?.[0]||{};
  let mission={},shift={};
  if(first.missionId){const ms=await getDoc(docRef('missions',first.missionId)).catch(()=>null);if(ms?.exists?.())mission={id:ms.id,...ms.data()};}
  if(first.shiftId){const ss=await getDoc(docRef('shifts',first.shiftId)).catch(()=>null);if(ss?.exists?.())shift={id:ss.id,...ss.data()};}
  if(!mission.id) mission={id:first.missionId||group.key,agentId:first.agentId,agentNom:first.agentNom,siteId:first.siteId,siteNom:first.siteNom,scheduledStart:shift.scheduledStart,scheduledEnd:shift.scheduledEnd};
  const reports=(group.reports||[]).map(compactReport);
  const archived = await archivePdfDocument({type:'mission',title:`Rapport mission — ${mission.siteNom||'Site'} — ${mission.agentNom||'Agent'}`,siteId:mission.siteId||null,siteNom:mission.siteNom||null,missionId:mission.id||null,rowCount:reports.length,payload:{mission:compactMission(mission),shift:compactShift(shift),rows:reports}}, { silent:true });
  await downloadGeneratedPdf(archived, { silent:true });
  toast('Rapport PDF archivé dans Documents et téléchargé.','success');
}


// -------------------- FACTURATION ADMIN --------------------
function invoiceStatusLabel(status){
  return ({ draft:'Brouillon', sent:'Envoyée', paid:'Payée', overdue:'En retard', cancelled:'Annulée' }[status || 'draft'] || status || 'Brouillon');
}
function invoiceStatusColor(status){
  return status === 'paid' ? 'green' : status === 'sent' ? 'blue' : status === 'overdue' ? 'red' : status === 'cancelled' ? 'red' : 'orange';
}
function invoiceEffectiveStatus(invoice){
  const due = invoice.dueDate?.toDate?.()?.getTime() || new Date(invoice.dueDate || 0).getTime();
  if (!['paid','cancelled'].includes(invoice.status) && due && due < startOfDay(new Date()).getTime()) return 'overdue';
  return invoice.status || 'draft';
}
function missionBillableHours(m){
  const start = m.actualStart?.toDate?.() || m.scheduledStart?.toDate?.();
  const end = m.actualEnd?.toDate?.() || m.scheduledEnd?.toDate?.();
  if (!start || !end) return 0;
  return Math.max(.25, round2((end.getTime() - start.getTime()) / 3600000));
}
async function loadBillingProfile(){
  const snap = await getDoc(docRef('billingSettings','profile')).catch(()=>null);
  billingProfileCache = snap?.exists?.() ? snap.data() : {};
  return billingProfileCache;
}
async function nextInvoiceNumber(){
  const counterRef = docRef('billingSettings','counter');
  const year = new Date().getFullYear();
  return runTransaction(db, async transaction => {
    const snap = await transaction.get(counterRef);
    const data = snap.exists() ? snap.data() : {};
    const sequence = data.year === year ? Number(data.sequence || 0) + 1 : 1;
    transaction.set(counterRef, { year, sequence, updatedAt:serverTimestamp(), updatedBy:currentUser.uid }, { merge:true });
    return `SP-${year}-${String(sequence).padStart(4,'0')}`;
  });
}
async function renderQGBilling(){
  if (!isStrictAdmin()) { toast('Facturation réservée au compte admin.', 'error'); return renderQGHome(); }
  currentRoute = 'billing';
  const body = `<section class="grid cols-4 billing-kpis">
    <div class="card stat blue"><div class="stat-label">Facturé HT</div><div class="stat-value billing-money" id="billing-total">0 €</div></div>
    <div class="card stat green"><div class="stat-label">Encaissé TTC</div><div class="stat-value billing-money" id="billing-paid">0 €</div></div>
    <div class="card stat orange"><div class="stat-label">À encaisser</div><div class="stat-value billing-money" id="billing-due">0 €</div></div>
    <div class="card stat red"><div class="stat-label">En retard</div><div class="stat-value billing-money" id="billing-overdue">0 €</div></div>
  </section>
  <section class="card" style="margin-top:16px">
    <div class="card-title"><div><h2>Facturation clients</h2><p>Génération depuis les missions terminées, suivi des paiements et PDF</p></div><div class="btn-row"><button class="btn" id="billing-profile">Coordonnées entreprise</button><button class="btn primary" id="billing-create">+ Créer une facture</button></div></div>
    <div class="form-grid billing-filters"><div class="field"><label>Recherche</label><input class="input" id="billing-search" placeholder="Numéro, client, site..."></div><div class="field"><label>Site</label><select class="select" id="billing-site"><option value="">Tous les sites</option></select></div><div class="field"><label>Statut</label><select class="select" id="billing-status"><option value="">Tous</option><option value="draft">Brouillon</option><option value="sent">Envoyée</option><option value="paid">Payée</option><option value="overdue">En retard</option><option value="cancelled">Annulée</option></select></div></div>
    <div id="billing-list" class="list"><div class="empty">Chargement des factures...</div></div>
  </section>`;
  render(page('Facturation', 'Pilotage administratif réservé au compte admin', body));
  const [sitesSnap] = await Promise.all([getDocs(query(collectionRef('sites'), orderBy('name'))).catch(()=>getDocs(collectionRef('sites'))), loadBillingProfile()]);
  const sites = sitesSnap.docs.map(d=>({id:d.id,...d.data()}));
  document.querySelector('#billing-site').innerHTML = `<option value="">Tous les sites</option>${sites.map(site=>`<option value="${safe(site.id)}">${safe(site.name)}</option>`).join('')}`;
  document.querySelector('#billing-profile').onclick = () => showBillingProfileModal();
  document.querySelector('#billing-create').onclick = () => showInvoiceCreateModal(sites);
  ['#billing-search','#billing-site','#billing-status'].forEach(selector => document.querySelector(selector)?.addEventListener(selector==='#billing-search'?'input':'change', ()=>renderInvoiceList(qgInvoicesCache)));
  const q = query(collectionRef('invoices'), orderBy('createdAt','desc'), limit(300));
  unsubscribeList.push(onSnapshot(q, snap => { qgInvoicesCache = snap.docs.map(d=>({id:d.id,...d.data()})); renderInvoiceList(qgInvoicesCache); }, error => {
    console.error(error); document.querySelector('#billing-list').innerHTML = '<div class="empty">Facturation secondaire en transition Supabase. Vérifie compat_records et les RLS.</div>';
  }));
}
function renderInvoiceList(rows){
  const box = document.querySelector('#billing-list'); if (!box) return;
  const term = (document.querySelector('#billing-search')?.value || '').toLowerCase();
  const siteId = document.querySelector('#billing-site')?.value || '';
  const status = document.querySelector('#billing-status')?.value || '';
  const filtered = rows.filter(invoice => {
    const effective = invoiceEffectiveStatus(invoice);
    if (siteId && invoice.siteId !== siteId) return false;
    if (status && effective !== status) return false;
    return !term || `${invoice.number} ${invoice.clientName} ${invoice.siteNom} ${invoice.billingEmail || ''}`.toLowerCase().includes(term);
  });
  const active = rows.filter(i=>invoiceEffectiveStatus(i)!=='cancelled');
  const totalHT = active.reduce((sum,i)=>sum+Number(i.subtotal || 0),0);
  const paid = active.filter(i=>invoiceEffectiveStatus(i)==='paid').reduce((sum,i)=>sum+Number(i.total || 0),0);
  const due = active.filter(i=>!['paid','cancelled'].includes(invoiceEffectiveStatus(i))).reduce((sum,i)=>sum+Number(i.total || 0),0);
  const overdue = active.filter(i=>invoiceEffectiveStatus(i)==='overdue').reduce((sum,i)=>sum+Number(i.total || 0),0);
  const set = (id,value)=>{const el=document.querySelector(id);if(el)el.textContent=money(value)};
  set('#billing-total',totalHT);set('#billing-paid',paid);set('#billing-due',due);set('#billing-overdue',overdue);
  box.innerHTML = filtered.length ? filtered.map(invoiceCard).join('') : '<div class="empty">Aucune facture correspondant aux filtres.</div>';
  document.querySelectorAll('[data-invoice-open]').forEach(btn=>btn.addEventListener('click',()=>showInvoiceDetail(filtered.find(i=>i.id===btn.dataset.invoiceOpen))));
  document.querySelectorAll('[data-invoice-print]').forEach(btn=>btn.addEventListener('click',()=>printInvoice(filtered.find(i=>i.id===btn.dataset.invoicePrint))));
  document.querySelectorAll('[data-invoice-paid]').forEach(btn=>btn.addEventListener('click',()=>updateInvoiceStatus(btn.dataset.invoicePaid,'paid')));
  document.querySelectorAll('[data-invoice-sent]').forEach(btn=>btn.addEventListener('click',()=>updateInvoiceStatus(btn.dataset.invoiceSent,'sent')));
  document.querySelectorAll('[data-invoice-cancel]').forEach(btn=>btn.addEventListener('click',()=>updateInvoiceStatus(btn.dataset.invoiceCancel,'cancelled')));
  document.querySelectorAll('[data-invoice-delete]').forEach(btn=>btn.addEventListener('click',()=>requestDeleteInvoice(filtered.find(i=>i.id===btn.dataset.invoiceDelete))));
}
function invoiceCard(invoice){
  const status = invoiceEffectiveStatus(invoice);
  const color = normalizeHexColor(invoice.siteColor) || planningColorForSite(invoice.siteId);
  return `<div class="item invoice-item" style="--invoice-site-color:${color}"><div class="invoice-site-strip"></div><div class="item-main"><div class="item-title">${safe(invoice.number || invoice.id)} · ${safe(invoice.clientName || invoice.siteNom || 'Client')} <span class="pill ${invoiceStatusColor(status)}">${safe(invoiceStatusLabel(status))}</span></div><div class="item-meta">${safe(invoice.siteNom || 'Site')} · période ${dateOnlyText(invoice.periodStart)} → ${dateOnlyText(invoice.periodEnd)}<br>Émise le ${dateOnlyText(invoice.issueDate)} · échéance ${dateOnlyText(invoice.dueDate)} · ${invoice.lines?.length || 0} ligne(s)</div></div><div class="invoice-total"><strong>${money(invoice.total)}</strong><span>TTC</span></div><div class="item-actions invoice-actions"><button class="btn small primary" data-invoice-open="${safe(invoice.id)}">Ouvrir</button><button class="btn small" data-invoice-print="${safe(invoice.id)}">PDF</button>${status==='draft'?`<button class="btn small" data-invoice-sent="${safe(invoice.id)}">Marquer envoyée</button>`:''}${!['paid','cancelled'].includes(status)?`<button class="btn small success" data-invoice-paid="${safe(invoice.id)}">Marquer payée</button><button class="btn small ghost" data-invoice-cancel="${safe(invoice.id)}">Annuler</button>`:''}<button class="btn small danger" data-invoice-delete="${safe(invoice.id)}">Supprimer</button></div></div>`;
}
async function showBillingProfileModal(){
  const profile = await loadBillingProfile();
  const defaultL61214 = "L’autorisation d’exercice ne confère aucune prérogative de puissance publique à l’entreprise ou aux personnes qui en bénéficient.";
  showModal('Coordonnées légales et facturation', `<form id="billing-profile-form">
    <div class="setup-box"><strong>Facturation agence de sécurité.</strong><br>Renseigne l’identité complète de l’entreprise, le numéro d’autorisation d’exercice CNAPS et les conditions de règlement. Ces informations seront intégrées aux factures et aux PDF.</div>
    <div class="invoice-form-section"><h3>Identité de l’entreprise</h3><div class="form-grid">
      <div class="field"><label>Nom / raison sociale *</label><input class="input" name="companyName" value="${safe(profile.companyName || '')}" required></div>
      <div class="field"><label>Forme juridique *</label><input class="input" name="legalForm" value="${safe(profile.legalForm || '')}" placeholder="SAS, SARL…" required></div>
      <div class="field"><label>Capital social (€)</label><input class="input" name="shareCapital" value="${safe(profile.shareCapital || '')}" placeholder="1 000"></div>
      <div class="field"><label>SIREN *</label><input class="input" name="siren" value="${safe(profile.siren || '')}" inputmode="numeric" required></div>
      <div class="field"><label>SIRET *</label><input class="input" name="siret" value="${safe(profile.siret || '')}" inputmode="numeric" required></div>
      <div class="field"><label>RCS / ville d’immatriculation</label><input class="input" name="rcsCity" value="${safe(profile.rcsCity || '')}" placeholder="RCS Fréjus"></div>
      <div class="field"><label>N° TVA intracommunautaire</label><input class="input" name="vatNumber" value="${safe(profile.vatNumber || '')}"></div>
      <div class="field"><label>Autorisation d’exercice CNAPS *</label><input class="input mono" name="cnapsAuthorization" value="${safe(profile.cnapsAuthorization || '')}" placeholder="AUT-…" required></div>
      <div class="field span-2"><label>Activité autorisée</label><input class="input" name="securityActivity" value="${safe(profile.securityActivity || 'Surveillance humaine ou surveillance par des systèmes électroniques de sécurité ou gardiennage')}"></div>
      <div class="field span-2"><label>Mention obligatoire — article L612-14 du CSI</label><textarea class="textarea" name="securityLegalNotice" rows="3">${safe(profile.securityLegalNotice || defaultL61214)}</textarea></div>
    </div></div>
    <div class="invoice-form-section"><h3>Coordonnées</h3><div class="form-grid">
      <div class="field span-2"><label>Adresse *</label><input class="input" name="address" value="${safe(profile.address || '')}" required></div>
      <div class="field"><label>Code postal *</label><input class="input" name="postalCode" value="${safe(profile.postalCode || '')}" required></div>
      <div class="field"><label>Ville *</label><input class="input" name="city" value="${safe(profile.city || '')}" required></div>
      <div class="field"><label>Email *</label><input class="input" type="email" name="email" value="${safe(profile.email || '')}" required></div>
      <div class="field"><label>Téléphone *</label><input class="input" name="phone" value="${safe(profile.phone || '')}" required></div>
    </div></div>
    <div class="invoice-form-section"><h3>Règlement et fiscalité</h3><div class="form-grid">
      <div class="field"><label>Mode de règlement</label><input class="input" name="paymentMethod" value="${safe(profile.paymentMethod || 'Virement bancaire')}"></div>
      <div class="field"><label>Délai de paiement (jours)</label><input class="input" type="number" min="0" max="60" name="paymentDays" value="${safe(profile.paymentDays ?? 30)}"></div>
      <div class="field"><label>IBAN</label><input class="input mono" name="iban" value="${safe(profile.iban || '')}"></div>
      <div class="field"><label>BIC</label><input class="input mono" name="bic" value="${safe(profile.bic || '')}"></div>
      <div class="field"><label>TVA par défaut (%)</label><input class="input" type="number" min="0" max="100" step="0.1" name="defaultVatRate" value="${safe(profile.defaultVatRate ?? 20)}"></div>
      <div class="field"><label>Mention TVA</label><input class="input" name="legalNotice" value="${safe(profile.legalNotice || '')}" placeholder="TVA non applicable, art. 293 B du CGI…"></div>
      <div class="field span-2"><label>Escompte pour paiement anticipé</label><textarea class="textarea" name="earlyPaymentDiscount" rows="2">${safe(profile.earlyPaymentDiscount || 'Aucun escompte accordé pour paiement anticipé.')}</textarea></div>
      <div class="field span-2"><label>Pénalités de retard</label><textarea class="textarea" name="latePenaltyText" rows="3">${safe(profile.latePenaltyText || 'Pénalités de retard exigibles dès le lendemain de la date d’échéance, calculées au taux de refinancement semestriel de la BCE majoré de 10 points.')}</textarea></div>
      <div class="field span-2"><label>Autres mentions légales</label><textarea class="textarea" name="additionalLegalNotice" rows="3">${safe(profile.additionalLegalNotice || '')}</textarea></div>
    </div></div>
    <button class="btn primary full" type="submit">Enregistrer les mentions légales</button>
  </form>`, 'wide');
  document.querySelector('#billing-profile-form').addEventListener('submit', async e=>{
    e.preventDefault();
    const fd=new FormData(e.currentTarget);
    const payload=Object.fromEntries(fd.entries());
    payload.paymentDays=Math.min(60,Math.max(0,Number(payload.paymentDays||30)));
    payload.defaultVatRate=Number(payload.defaultVatRate||0);
    payload.updatedAt=serverTimestamp();
    payload.updatedBy=currentUser.uid;
    await setDoc(docRef('billingSettings','profile'),payload,{merge:true});
    billingProfileCache=payload;
    await addAudit('billing_profile_saved',{cnapsConfigured:Boolean(payload.cnapsAuthorization)});
    closeModal();
    toast('Mentions légales et coordonnées enregistrées.','success');
  });
}
async function showInvoiceCreateModal(sites){
  const profile = billingProfileCache || await loadBillingProfile();
  if (!profile.companyName || !profile.cnapsAuthorization) toast('Complète d’abord les coordonnées légales et l’autorisation CNAPS.', 'warning');
  const today = startOfDay(new Date());
  const first = new Date(today.getFullYear(),today.getMonth(),1);
  const due = addDays(today,Number(profile.paymentDays||30));
  const options = `<option value="">Choisir un site / client</option>${sites.map(site=>`<option value="${safe(site.id)}">${safe(site.name)} · ${safe(site.clientName||'Client')}</option>`).join('')}`;
  showModal('Créer une facture', `<form id="invoice-create-form">
    <div class="setup-box">Les missions terminées de la période seront ajoutées automatiquement. Vérifie l’identité et l’adresse de facturation du client avant de générer le PDF définitif.</div>
    <div class="invoice-form-section"><h3>Client et prestation</h3><div class="form-grid">
      <div class="field"><label>Site / client</label><select class="select" name="siteId" id="invoice-site-select" required>${options}</select></div>
      <div class="field"><label>Tarif horaire HT (€)</label><input class="input" type="number" min="0" step="0.01" name="hourlyRate" id="invoice-hourly-rate" required></div>
      <div class="field"><label>Raison sociale du client *</label><input class="input" name="clientName" id="invoice-client-name" required></div>
      <div class="field"><label>Email de facturation</label><input class="input" type="email" name="billingEmail" id="invoice-billing-email"></div>
      <div class="field span-2"><label>Adresse de facturation *</label><input class="input" name="billingAddress" id="invoice-billing-address" required></div>
      <div class="field"><label>SIREN client</label><input class="input" name="clientSiren" id="invoice-client-siren"></div>
      <div class="field"><label>N° TVA client</label><input class="input" name="clientVatNumber" id="invoice-client-vat"></div>
      <div class="field span-2"><label>Adresse du lieu de prestation</label><input class="input" name="serviceAddress" id="invoice-service-address"></div>
      <div class="field span-2"><label>Catégorie de l’opération</label><input class="input" name="operationCategory" value="Prestation de services de sécurité privée"></div>
    </div></div>
    <div class="invoice-form-section"><h3>Période et règlement</h3><div class="form-grid">
      <div class="field"><label>Début période</label><input class="input" type="date" name="periodStart" value="${first.toISOString().slice(0,10)}" required></div>
      <div class="field"><label>Fin période</label><input class="input" type="date" name="periodEnd" value="${today.toISOString().slice(0,10)}" required></div>
      <div class="field"><label>Date facture</label><input class="input" type="date" name="issueDate" value="${today.toISOString().slice(0,10)}" required></div>
      <div class="field"><label>Échéance</label><input class="input" type="date" name="dueDate" value="${due.toISOString().slice(0,10)}" required></div>
      <div class="field"><label>TVA (%)</label><input class="input" type="number" min="0" max="100" step="0.1" name="vatRate" id="invoice-vat-rate" value="${safe(profile.defaultVatRate ?? 20)}"></div>
      <div class="field"><label>Référence client</label><input class="input" name="clientReference" placeholder="Bon de commande, contrat…"></div>
      <div class="field"><label>Complément / forfait</label><input class="input" name="extraLabel" placeholder="Frais, forfait, majoration…"></div>
      <div class="field"><label>Montant complément HT (€)</label><input class="input" type="number" min="0" step="0.01" name="extraAmount" value="0"></div>
    </div></div>
    <div id="invoice-site-preview" class="billing-client-preview muted">Choisis un site.</div>
    <button class="btn primary full" type="submit">Générer la facture</button>
  </form>`, 'wide');
  const select=document.querySelector('#invoice-site-select');
  const sync=()=>{
    const site=sites.find(s=>s.id===select.value);
    if(!site)return;
    document.querySelector('#invoice-hourly-rate').value=Number(site.hourlyRate||0);
    document.querySelector('#invoice-vat-rate').value=Number(site.vatRate ?? profile.defaultVatRate ?? 20);
    document.querySelector('#invoice-client-name').value=site.clientName||site.name||'';
    document.querySelector('#invoice-billing-address').value=site.billingAddress||site.clientAddress||site.address||'';
    document.querySelector('#invoice-billing-email').value=site.billingEmail||site.clientEmail||'';
    document.querySelector('#invoice-client-siren').value=site.clientSiren||'';
    document.querySelector('#invoice-client-vat').value=site.clientVatNumber||'';
    document.querySelector('#invoice-service-address').value=site.address||'';
    document.querySelector('#invoice-site-preview').innerHTML=`<strong>${safe(site.clientName||site.name)}</strong><br>${safe(site.billingAddress||site.address||'Adresse non renseignée')} · ${safe(site.billingEmail||'Email non renseigné')}`;
  };
  select.addEventListener('change',sync);
  document.querySelector('#invoice-create-form').addEventListener('submit',async e=>{
    e.preventDefault();
    const fd=new FormData(e.currentTarget);
    const site=sites.find(s=>s.id===fd.get('siteId'));
    if(!site)return toast('Site introuvable.','error');
    const periodStart=startOfDay(new Date(fd.get('periodStart'))), periodEnd=endOfDay(new Date(fd.get('periodEnd')));
    const issueDate=startOfDay(new Date(fd.get('issueDate'))), dueDate=startOfDay(new Date(fd.get('dueDate')));
    if(periodEnd<periodStart)return toast('Période invalide.','warning');
    if(dueDate<issueDate)return toast('L’échéance ne peut pas précéder la date de facture.','warning');
    if(dueDate>addDays(issueDate,60))return toast('Le délai de paiement ne peut pas dépasser 60 jours après émission.','warning');
    const missionsSnap=await getDocs(query(collectionRef('missions'),where('siteId','==',site.id))).catch(()=>({docs:[]}));
    const existingSnap=await getDocs(query(collectionRef('invoices'),limit(500))).catch(()=>({docs:[]}));
    const billed=new Set(existingSnap.docs.flatMap(d=>{const x=d.data();return x.status==='cancelled'?[]:(x.missionIds||[])}));
    const missions=missionsSnap.docs.map(d=>({id:d.id,...d.data()})).filter(m=>m.status==='completed'&&!billed.has(m.id)).filter(m=>{const ms=missionStartMs(m),me=missionEndMs(m);return ms&&me&&ms<=periodEnd.getTime()&&me>=periodStart.getTime()}).sort((a,b)=>missionStartMs(a)-missionStartMs(b));
    const hourlyRate=Number(fd.get('hourlyRate')||0);
    const lines=missions.map(m=>{const qty=missionBillableHours(m);return {missionId:m.id,date:m.scheduledStart,description:`${m.type||'Mission'} — ${m.agentNom||'Agent'} — ${dateOnlyText(m.scheduledStart)}`,quantity:qty,unit:'heure',unitPrice:hourlyRate,amount:round2(qty*hourlyRate)};});
    const extraAmount=Number(fd.get('extraAmount')||0);
    if(extraAmount>0)lines.push({description:fd.get('extraLabel')||'Complément de facturation',quantity:1,unit:'forfait',unitPrice:extraAmount,amount:round2(extraAmount)});
    if(!lines.length)return toast('Aucune mission terminée non facturée sur cette période et aucun complément saisi.','warning');
    const subtotal=round2(lines.reduce((sum,line)=>sum+Number(line.amount||0),0));
    const vatRate=Number(fd.get('vatRate')||0);
    const vatAmount=round2(subtotal*vatRate/100);
    const total=round2(subtotal+vatAmount);
    const number=await nextInvoiceNumber();
    const payload={
      number,
      clientName:String(fd.get('clientName')||site.clientName||site.name||'').trim(),
      siteId:site.id,siteNom:site.name,siteColor:normalizeHexColor(site.planningColor)||planningColorForSite(site.id),
      billingAddress:String(fd.get('billingAddress')||'').trim(),billingEmail:String(fd.get('billingEmail')||'').trim(),
      clientSiren:String(fd.get('clientSiren')||'').trim(),clientVatNumber:String(fd.get('clientVatNumber')||'').trim(),
      serviceAddress:String(fd.get('serviceAddress')||site.address||'').trim(),operationCategory:String(fd.get('operationCategory')||'Prestation de services').trim(),
      clientReference:fd.get('clientReference')||'',periodStart:Timestamp.fromDate(periodStart),periodEnd:Timestamp.fromDate(periodEnd),
      issueDate:Timestamp.fromDate(issueDate),dueDate:Timestamp.fromDate(dueDate),
      lines,missionIds:missions.map(m=>m.id),subtotal,vatRate,vatAmount,total,currency:'EUR',status:'draft',
      createdAt:serverTimestamp(),createdBy:currentUser.uid,updatedAt:serverTimestamp(),updatedBy:currentUser.uid
    };
    const ref=await addDoc(collectionRef('invoices'),payload);
    await addAudit('invoice_created',{invoiceId:ref.id,number,siteId:site.id,total});
    closeModal();
    toast(`Facture ${number} créée.`, 'success');
  });
}
async function updateInvoiceStatus(invoiceId,status){
  await updateDoc(docRef('invoices',invoiceId),{status,paidAt:status==='paid'?serverTimestamp():null,sentAt:status==='sent'?serverTimestamp():null,updatedAt:serverTimestamp(),updatedBy:currentUser.uid});await addAudit('invoice_status_updated',{invoiceId,status});toast(`Facture ${invoiceStatusLabel(status).toLowerCase()}.`,'success');
}
function showInvoiceDetail(invoice){
  if(!invoice)return;const status=invoiceEffectiveStatus(invoice);const rows=(invoice.lines||[]).map(line=>`<tr><td>${safe(line.description||'')}</td><td>${safe(line.quantity||0)} ${safe(line.unit||'')}</td><td>${money(line.unitPrice)}</td><td>${money(line.amount)}</td></tr>`).join('');
  showModal(`Facture ${invoice.number||invoice.id}`,`<div class="invoice-detail"><div class="mission-detail-head"><div><h3>${safe(invoice.clientName||'Client')}</h3><p>${safe(invoice.siteNom||'Site')} · ${safe(invoice.billingEmail||'')}</p></div><span class="pill ${invoiceStatusColor(status)}">${invoiceStatusLabel(status)}</span></div><div class="mission-detail-grid"><div><strong>Période</strong><span>${dateOnlyText(invoice.periodStart)} → ${dateOnlyText(invoice.periodEnd)}</span></div><div><strong>Échéance</strong><span>${dateOnlyText(invoice.dueDate)}</span></div><div><strong>HT</strong><span>${money(invoice.subtotal)}</span></div><div><strong>TTC</strong><span>${money(invoice.total)}</span></div></div><div class="table-wrap"><table class="table invoice-lines-table"><thead><tr><th>Description</th><th>Quantité</th><th>Prix unitaire</th><th>Total HT</th></tr></thead><tbody>${rows}</tbody></table></div><div class="btn-row"><button class="btn primary" id="invoice-detail-print">Imprimer / PDF</button><button class="btn" id="invoice-detail-csv">Exporter lignes CSV</button>${status==='draft'?'<button class="btn" id="invoice-detail-sent">Marquer envoyée</button>':''}${!['paid','cancelled'].includes(status)?'<button class="btn success" id="invoice-detail-paid">Marquer payée</button><button class="btn ghost" id="invoice-detail-cancel">Annuler facture</button>':''}</div></div>`,'wide');
  document.querySelector('#invoice-detail-print').onclick=()=>printInvoice(invoice);document.querySelector('#invoice-detail-csv').onclick=()=>exportCSV((invoice.lines||[]).map(l=>({...l,invoice:invoice.number,client:invoice.clientName,site:invoice.siteNom})),`facture-${invoice.number||invoice.id}.csv`);document.querySelector('#invoice-detail-sent')?.addEventListener('click',()=>{updateInvoiceStatus(invoice.id,'sent');closeModal()});document.querySelector('#invoice-detail-paid')?.addEventListener('click',()=>{updateInvoiceStatus(invoice.id,'paid');closeModal()});document.querySelector('#invoice-detail-cancel')?.addEventListener('click',()=>{updateInvoiceStatus(invoice.id,'cancelled');closeModal()});
}
async function printInvoice(invoice){
  if(!invoice)return;
  const profile = await loadBillingProfile();
  const missing = [];
  if(!profile.companyName) missing.push('raison sociale');
  if(!profile.siret) missing.push('SIRET');
  if(!profile.address || !profile.city) missing.push('adresse entreprise');
  if(!profile.cnapsAuthorization) missing.push('autorisation CNAPS');
  if(missing.length) {
    toast(`Mentions à compléter : ${missing.join(', ')}.`, 'warning');
    return showBillingProfileModal();
  }
  const data = {
    type:'invoice',
    title:`Facture ${invoice.number || invoice.id} — ${invoice.clientName || invoice.siteNom || 'Client'}`,
    siteId:invoice.siteId || null,
    siteNom:invoice.siteNom || null,
    missionId:null,
    rowCount:invoice.lines?.length || 0,
    payload:{ invoice, profile }
  };
  try {
    const archived = await archivePdfDocument(data, { silent:true });
    downloadGeneratedPdf(archived, { silent:true });
    toast('Facture PDF téléchargée et archivée dans Documents.', 'success');
  } catch(error) {
    console.error(error);
    const root=document.querySelector('#print-root');root?.remove();
    const el=document.createElement('div');el.id='print-root';el.className='print-root';el.innerHTML=invoiceHtml(invoice,profile);document.body.appendChild(el);
    toast('Archivage impossible. Aperçu impression ouvert.','warning');
    window.addEventListener('afterprint',()=>setTimeout(()=>el.remove(),500),{once:true});
    setTimeout(()=>window.print(),250);setTimeout(()=>el.remove(),20000);
  }
}
function invoiceHtml(invoice,profile={}){
  const logo=new URL('./assets/logo.png',location.href).href;
  const lines=(invoice.lines||[]).map(line=>`<tr><td>${safe(line.description||'')}</td><td>${safe(line.quantity||0)} ${safe(line.unit||'')}</td><td>${money(line.unitPrice)}</td><td>${money(line.amount)}</td></tr>`).join('');
  const legal61214=profile.securityLegalNotice || "L’autorisation d’exercice ne confère aucune prérogative de puissance publique à l’entreprise ou aux personnes qui en bénéficient.";
  const issuerIdentity=[
    profile.legalForm,
    profile.shareCapital?`au capital de ${safe(profile.shareCapital)} €`:'',
    profile.rcsCity||''
  ].filter(Boolean).map(safe).join(' · ');
  const paymentParts=[profile.paymentMethod||'Virement bancaire',profile.iban?`IBAN ${profile.iban}`:'',profile.bic?`BIC ${profile.bic}`:''].filter(Boolean).map(safe).join(' · ');
  return `<article class="report-doc invoice-doc invoice-security-doc">
    <header><img src="${logo}" alt="Sentinelle Pro"><div><h1>FACTURE ${safe(invoice.number||'')}</h1><p>Date d’émission : ${dateOnlyText(invoice.issueDate)} · Date d’échéance : ${dateOnlyText(invoice.dueDate)}</p></div></header>
    <section class="invoice-parties">
      <div><h3>Émetteur</h3><strong>${safe(profile.companyName||'Entreprise')}</strong><p>${issuerIdentity}<br>${safe(profile.address||'')}<br>${safe(profile.postalCode||'')} ${safe(profile.city||'')}<br>${safe(profile.email||'')} · ${safe(profile.phone||'')}<br>${profile.siren?`SIREN : ${safe(profile.siren)}<br>`:''}${profile.siret?`SIRET : ${safe(profile.siret)}<br>`:''}${profile.vatNumber?`TVA : ${safe(profile.vatNumber)}`:''}</p></div>
      <div><h3>Client facturé</h3><strong>${safe(invoice.clientName||invoice.siteNom||'Client')}</strong><p>${safe(invoice.billingAddress||'Adresse non renseignée')}<br>${safe(invoice.billingEmail||'')}${invoice.clientSiren?`<br>SIREN : ${safe(invoice.clientSiren)}`:''}${invoice.clientVatNumber?`<br>TVA : ${safe(invoice.clientVatNumber)}`:''}<br>Lieu de prestation : ${safe(invoice.serviceAddress||invoice.siteNom||'')}</p></div>
    </section>
    <section class="invoice-operation"><p><strong>Nature de l’opération :</strong> ${safe(invoice.operationCategory||'Prestation de services de sécurité privée')}<br><strong>Période de réalisation :</strong> ${dateOnlyText(invoice.periodStart)} → ${dateOnlyText(invoice.periodEnd)}${invoice.clientReference?`<br><strong>Référence client :</strong> ${safe(invoice.clientReference)}`:''}</p></section>
    <section><table class="invoice-print-table"><thead><tr><th>Désignation</th><th>Quantité</th><th>Prix unitaire HT</th><th>Total HT</th></tr></thead><tbody>${lines}</tbody></table></section>
    <section class="invoice-totals"><div><span>Total HT</span><strong>${money(invoice.subtotal)}</strong></div><div><span>TVA ${safe(invoice.vatRate||0)} %</span><strong>${money(invoice.vatAmount)}</strong></div><div class="grand-total"><span>Total TTC</span><strong>${money(invoice.total)}</strong></div></section>
    <section class="invoice-legal-grid">
      <div class="invoice-legal-box"><h3>Conditions de règlement</h3><p><strong>Règlement :</strong> ${paymentParts}<br><strong>Échéance :</strong> ${dateOnlyText(invoice.dueDate)}<br>${safe(profile.earlyPaymentDiscount||'Aucun escompte accordé pour paiement anticipé.')}<br>${safe(profile.latePenaltyText||'Pénalités de retard exigibles dès le lendemain de l’échéance.')}<br>Indemnité forfaitaire pour frais de recouvrement en cas de retard : <strong>40 €</strong>.</p>${profile.legalNotice?`<p>${safe(profile.legalNotice)}</p>`:''}</div>
      <div class="invoice-legal-box security"><h3>Sécurité privée — CNAPS</h3><p><strong>Autorisation d’exercice CNAPS :</strong> ${safe(profile.cnapsAuthorization||'Non renseignée')}<br><strong>Activité :</strong> ${safe(profile.securityActivity||'Sécurité privée')}</p><p><strong>Art. L612-14 du CSI :</strong> ${safe(legal61214)}</p></div>
    </section>
    ${profile.additionalLegalNotice?`<section class="invoice-additional-legal">${safe(profile.additionalLegalNotice)}</section>`:''}
    <footer>${safe(profile.companyName||'Entreprise')} · ${profile.siret?`SIRET ${safe(profile.siret)} · `:''}${profile.cnapsAuthorization?`Autorisation CNAPS ${safe(profile.cnapsAuthorization)} · `:''}Document généré par Sentinelle Pro.</footer>
  </article>`;
}
function requestDeleteInvoice(invoice){
  if(!invoice)return;confirmDestructiveAction({title:'Supprimer la facture',message:`La facture ${invoice.number||invoice.id} sera supprimée définitivement. Le compteur de numérotation ne sera pas réutilisé.`,onConfirm:async()=>{await addAudit('invoice_deleted',{invoiceId:invoice.id,number:invoice.number||''});await deleteDoc(docRef('invoices',invoice.id));toast('Facture supprimée.','success')}});
}

function renderQGHistory(){
  currentRoute = 'history';
  const body = `<section class="grid cols-3"><button class="card stat blue" id="export-reports-all"><div class="stat-label">Exporter</div><div class="stat-value">MCI</div></button><button class="card stat orange" id="export-rounds-all"><div class="stat-label">Exporter</div><div class="stat-value">Rondes</div></button><button class="card stat red" id="export-alerts-all"><div class="stat-label">Exporter</div><div class="stat-value">SOS</div></button></section><section class="card" style="margin-top:16px"><div class="card-title"><div><h2>Audit logs</h2><p>Actions sensibles tracées</p></div></div><div id="audit-list" class="timeline"><div class="empty">Chargement...</div></div></section>`;
  render(page('Historique / Exports', 'Traçabilité et extractions professionnelles', body));
  document.querySelector('#export-reports-all').onclick = () => exportCollection('reports','reports.csv');
  document.querySelector('#export-rounds-all').onclick = () => exportCollection('rounds','rounds.csv');
  document.querySelector('#export-alerts-all').onclick = () => exportCollection('alerts','alerts.csv');
  const q = query(collectionRef('auditLogs'), orderBy('createdAt','desc'), limit(50));
  unsubscribeList.push(onSnapshot(q, snap => document.querySelector('#audit-list').innerHTML = snap.empty ? `<div class="empty">Aucun audit log.</div>` : snap.docs.map(d=>{const a=d.data(); return `<div class="timeline-entry"><div class="item-title">${safe(a.action)}</div><div class="item-meta">${dateText(a.createdAt)} · ${safe(a.userId)}</div><div>${safe(JSON.stringify(a.details || {}))}</div></div>`}).join('')));
}
async function exportCollection(name, filename){
  const snap = await getDocs(query(collectionRef(name), limit(500)));
  exportCSV(snap.docs.map(d=>({id:d.id,...d.data()})), filename);
  await addAudit('export_data', { collection:name });
}
async function exportCSV(rows, filename){
  if (!rows.length) return toast('Aucune donnée à exporter.', 'warning');
  const safeFilename = filename || `export-${Date.now()}.csv`;
  const { csv, preview, textReport } = buildExportPayload(rows, safeFilename);
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  showModal('Export MCI sécurisé', `<div class="download-panel export-safe-panel">
    <p class="muted">Le téléchargement direct peut être bloqué sur iPhone/PWA. Cette version propose plusieurs sorties fiables : téléchargement, partage, impression PDF et copie.</p>
    <div class="grid cols-2 export-actions">
      <a class="btn primary full" href="${safe(url)}" download="${safe(safeFilename)}" target="_blank" rel="noopener">Télécharger CSV</a>
      <button class="btn full" id="share-export-file">Partager fichier</button>
      <button class="btn full" id="print-export-report">Imprimer / PDF</button>
      <button class="btn full" id="copy-export-csv">Copier CSV</button>
      <button class="btn full" id="copy-export-text">Copier rapport texte</button>
      <button class="btn ghost full" id="open-export-page">Ouvrir page d’export</button>
    </div>
    <div class="divider"></div>
    <div class="field"><label>Aperçu export</label><textarea class="textarea mono" id="export-preview" readonly rows="10">${safe(preview)}</textarea></div>
    <p class="muted">Méthode la plus stable sur iPhone : Imprimer / PDF → Partager → Enregistrer dans Fichiers. Sinon : Copier CSV.</p>
  </div>`, 'wide');
  document.querySelector('#copy-export-csv')?.addEventListener('click', () => copyText(csv.replace(/^﻿/, ''), 'CSV copié.'));
  document.querySelector('#copy-export-text')?.addEventListener('click', () => copyText(textReport, 'Rapport texte copié.'));
  document.querySelector('#print-export-report')?.addEventListener('click', () => printRowsReport(rows, safeFilename));
  document.querySelector('#open-export-page')?.addEventListener('click', () => openExportPage(rows, safeFilename));
  document.querySelector('#share-export-file')?.addEventListener('click', async () => {
    try {
      if (!navigator.canShare || !navigator.share) throw new Error('Partage non supporté');
      const file = new File([blob], safeFilename, { type:'text/csv' });
      if (!navigator.canShare({ files:[file] })) throw new Error('Partage fichier non supporté');
      await navigator.share({ files:[file], title:safeFilename, text:'Export Sentinelle Pro' });
      toast('Export partagé.', 'success');
    } catch(error) {
      toast('Partage indisponible. Utilise Copier CSV ou Imprimer/PDF.', 'warning');
    }
  });
  setTimeout(() => URL.revokeObjectURL(url), 180000);
}
function buildExportPayload(rows, filename){
  const flat = rows.map(row => Object.fromEntries(Object.entries(row).map(([k,v]) => [k, v?.toDate ? v.toDate().toISOString() : typeof v === 'object' ? JSON.stringify(v) : v])));
  const headers = [...new Set(flat.flatMap(r=>Object.keys(r)))];
  const csv = '﻿' + [headers.join(';'), ...flat.map(r => headers.map(h => `"${String(r[h] ?? '').replace(/"/g,'""')}"`).join(';'))].join('\n');
  const preview = csv.replace(/^﻿/, '').split('\n').slice(0, 14).join('\n');
  const textReport = [`Sentinelle Pro — ${filename}`, `Export généré le ${new Date().toLocaleString('fr-FR')}`, `Lignes : ${rows.length}`, ''].concat(rows.map((r, i) => {
    const when = dateText(r.createdAt || r.scannedAt || r.heure || r.sentAt || r.scheduledStart);
    return `${i+1}. ${when} — ${r.siteNom || r.siteName || r.siteId || 'Site'} — ${r.agentNom || r.agentId || 'Agent'} — ${r.category || r.type || r.status || 'Événement'} — ${r.severity || ''}\n${r.message || r.instructions || ''}`;
  })).join('\n\n');
  return { csv, preview, textReport };
}
async function copyText(text, successMessage){
  try {
    await navigator.clipboard.writeText(text);
    toast(successMessage || 'Copié.', 'success');
  } catch(error) {
    const textarea = document.querySelector('#export-preview');
    textarea?.focus(); textarea?.select();
    toast('Copie automatique bloquée. Sélectionne le texte puis copie.', 'warning');
  }
}
function openExportPage(rows, filename){
  const html = exportReportHtml(rows, filename, false);
  const blob = new Blob([html], { type:'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const opened = window.open(url, '_blank', 'noopener');
  if (!opened) toast('Ouverture bloquée. Utilise Imprimer/PDF ou Copier CSV.', 'warning');
  setTimeout(() => URL.revokeObjectURL(url), 180000);
}
function printRowsReport(rows, filename){
  document.querySelector('#print-root')?.remove();
  const root = document.createElement('div');
  root.id = 'print-root';
  root.className = 'print-root';
  root.innerHTML = exportReportHtml(rows, filename, true);
  document.body.appendChild(root);
  toast('Rapport prêt. Dans l’écran d’impression, choisis “Enregistrer en PDF”.', 'success');
  window.addEventListener('afterprint', () => setTimeout(()=>root.remove(), 500), { once:true });
  setTimeout(() => window.print(), 250);
  setTimeout(() => root.remove(), 20000);
}
function exportReportHtml(rows, filename, innerOnly=false){
  const logo = new URL('./assets/logo.png', location.href).href;
  const flat = rows.map(row => Object.fromEntries(Object.entries(row).map(([k,v]) => [k, v?.toDate ? dateText(v) : typeof v === 'object' ? JSON.stringify(v) : v])));
  const preferred = ['createdAt','scheduledStart','agentNom','siteNom','category','severity','message','status'];
  const all = [...new Set(flat.flatMap(r=>Object.keys(r)))];
  const headers = [...preferred.filter(h=>all.includes(h)), ...all.filter(h=>!preferred.includes(h)).slice(0,8)];
  const table = `<table><thead><tr>${headers.map(h=>`<th>${safe(h)}</th>`).join('')}</tr></thead><tbody>${flat.map(r=>`<tr>${headers.map(h=>`<td>${safe(r[h] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const doc = `<article class="report-doc"><header><img src="${logo}" alt="Sentinelle Pro"><div><h1>Export opérationnel Sentinelle Pro</h1><p>${safe(filename)} · généré le ${new Date().toLocaleString('fr-FR')}</p></div></header><section class="report-grid"><div><strong>${rows.length}</strong><span>Lignes exportées</span></div><div><strong>${new Date().toLocaleDateString('fr-FR')}</strong><span>Date</span></div><div><strong>CSV/PDF</strong><span>Format</span></div><div><strong>QG</strong><span>Origine</span></div></section><section>${table}</section><footer>Document généré automatiquement par Sentinelle Pro.</footer></article>`;
  if (innerOnly) return doc;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${safe(filename)}</title><style>body{font-family:Montserrat,Arial,sans-serif;margin:0;background:#f4f8fb;color:#050A13}.report-doc{max-width:1100px;margin:24px auto;background:white;padding:32px;border-radius:18px}.report-doc header{display:flex;gap:18px;align-items:center;border-bottom:1px solid #dbe3ee;padding-bottom:18px}.report-doc img{width:74px;height:74px;object-fit:contain}.report-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:22px 0}.report-grid div{background:#f4f8fb;border-radius:14px;padding:14px}.report-grid strong{display:block;font-size:22px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border-bottom:1px solid #e5edf6;padding:8px;text-align:left;vertical-align:top}button{position:fixed;right:18px;bottom:18px;padding:12px 16px;border:0;border-radius:999px;background:#009cff;color:white;font-weight:700}@media print{button{display:none}.report-doc{margin:0;box-shadow:none}}</style></head><body>${doc}<button onclick="window.print()">Imprimer / PDF</button></body></html>`;
}



// -------------------- V5.8.8.2 — WEB PUSH NATIF SUPABASE --------------------
const SP_PUSH_PREF_DEFAULTS = Object.freeze({ flash:true, planning:true, instructions:true, documents:true, operations:true });

function spLoadPushPreferences(){
  try {
    const stored = JSON.parse(localStorage.getItem('sentinelle_push_preferences') || '{}');
    return { ...SP_PUSH_PREF_DEFAULTS, ...(stored && typeof stored === 'object' ? stored : {}) };
  } catch(error) {
    return { ...SP_PUSH_PREF_DEFAULTS };
  }
}

async function spSavePushPreferences(preferences){
  const normalized = { ...SP_PUSH_PREF_DEFAULTS };
  Object.keys(normalized).forEach(key => { normalized[key] = preferences?.[key] !== false; });
  localStorage.setItem('sentinelle_push_preferences', JSON.stringify(normalized));
  if (!currentUser) return normalized;
  try {
    const supabase = getSupabaseClient();
    const { error } = await supabase.rpc('sentinelle_update_web_push_preferences', { p_preferences:normalized });
    if (error) throw error;
  } catch(error) {
    console.warn('Préférences Web Push non synchronisées', error);
  }
  return normalized;
}

function isIosLike(){
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
function isStandalonePwa(){
  return window.matchMedia?.('(display-mode: standalone)')?.matches || window.navigator.standalone === true;
}
async function ensureSentinelleServiceWorker({cleanupLegacy=false, timeoutMs=8000}={}){
  if (!('serviceWorker' in navigator)) throw new Error('Service Worker non supporté par ce navigateur.');
  if (cleanupLegacy) {
    const registrations = await navigator.serviceWorker.getRegistrations().catch(()=>[]);
    await Promise.all((registrations||[]).map(async registration => {
      const scriptUrl = registration.active?.scriptURL || registration.waiting?.scriptURL || registration.installing?.scriptURL || '';
      if (/\/(OneSignalSDKWorker|OneSignalSDKUpdaterWorker)\.js(?:\?|$)/.test(scriptUrl) && !scriptUrl.includes('/push/onesignal/')) {
        await registration.unregister().catch(()=>false);
      }
    }));
  }
  let registration = await navigator.serviceWorker.getRegistration('./').catch(()=>null);
  const existingUrl = registration?.active?.scriptURL || registration?.waiting?.scriptURL || registration?.installing?.scriptURL || '';
  if (!registration || !/service-worker\.js/i.test(existingUrl)) {
    try {
      registration = await navigator.serviceWorker.register('./service-worker.js?v=5882', { scope:'./', updateViaCache:'none' });
      window.__SENTINELLE_SW_LAST_ERROR__ = '';
    } catch(error) {
      window.__SENTINELLE_SW_LAST_ERROR__ = error?.message || String(error || 'Échec enregistrement Service Worker');
      throw error;
    }
  } else {
    registration.update?.().catch(()=>{});
  }
  const ready = await Promise.race([
    navigator.serviceWorker.ready.catch(()=>null),
    new Promise(resolve=>setTimeout(()=>resolve(null), Math.max(1500, Number(timeoutMs||8000))))
  ]);
  return ready || registration;
}

function nativeWebPushSupported(){
  return Boolean('serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined');
}
function webPushFunctionConfigured(){
  return Boolean(pushConfig?.pushProvider === 'supabase-web-push' && String(pushConfig?.pushFunctionUrl || '').startsWith('https://'));
}
function pushIsConfigured(){ return webPushFunctionConfigured(); }
function pushWorkerIsConfigured(){ return webPushFunctionConfigured(); }

function urlBase64ToUint8Array(value){
  const padding = '='.repeat((4 - String(value || '').length % 4) % 4);
  const base64 = (String(value || '') + padding).replace(/-/g,'+').replace(/_/g,'/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(char => char.charCodeAt(0)));
}

async function spNativePushRequest(body, options={}){
  if (!currentUser) return { ok:false, skipped:true, reason:'Utilisateur non connecté' };
  if (!webPushFunctionConfigured()) return { ok:false, skipped:true, reason:'Edge Function Web Push non configurée' };
  const timeoutMs = Math.max(3000, Number(options?.timeoutMs || 20000));
  const supabase = getSupabaseClient();
  const sessionResult = await supabase.auth.getSession();
  const token = sessionResult?.data?.session?.access_token || await currentUser.getIdToken(false);
  if (!token) throw new Error('Session Supabase absente ou expirée.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    // V5.8.8.2 : la passerelle Supabase attend le JWT utilisateur dans Authorization
    // et la clé publique du projet dans apikey pour un appel navigateur fiable.
    const response = await fetch(pushConfig.pushFunctionUrl, {
      method:'POST',
      headers:{
        'Content-Type':'application/json',
        'Accept':'application/json',
        'Authorization':`Bearer ${token}`,
        'apikey':stagingConfig.supabasePublishableKey,
        'x-client-info':'sentinelle-pro-web-push/5.8.8.2'
      },
      body:JSON.stringify(body || {}),
      signal:controller.signal,
      cache:'no-store'
    });
    const text = await response.text().catch(()=> '');
    let result={};
    try { result = text ? JSON.parse(text) : {}; } catch { result = { message:text }; }
    if (!response.ok || result?.ok === false) throw new Error(result?.error || result?.message || `Web Push HTTP ${response.status}`);
    return result;
  } catch(error) {
    if (error?.name === 'AbortError') throw new Error(`Edge Function sans réponse après ${Math.round(timeoutMs/1000)} s.`);
    if (/Load failed|Failed to fetch|NetworkError/i.test(String(error?.message||error))) {
      throw new Error('Edge Function inaccessible depuis l’app. Vérifie son déploiement et ses logs Supabase.');
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function spGetVapidPublicKey(){
  const cached = String(sessionStorage.getItem('sentinelle_vapid_public_key') || '').trim();
  if (cached) return cached;
  const result = await spNativePushRequest({ action:'public_key' });
  const key = String(result?.publicKey || '').trim();
  if (!key) throw new Error('Clé publique VAPID absente côté Supabase.');
  sessionStorage.setItem('sentinelle_vapid_public_key', key);
  return key;
}

async function nativePushState(options={}){
  if (!('serviceWorker' in navigator)) return {worker:'',workerState:'absent',nativeSubscribed:false,endpoint:'',registrationError:'non supporté'};
  const timeoutMs = Math.max(1500, Number(options?.timeoutMs || 5000));
  let registration = null;
  let registrationError = '';
  try {
    registration = await ensureSentinelleServiceWorker({cleanupLegacy:false, timeoutMs});
  } catch(error) {
    registrationError = error?.message || String(error || 'échec enregistrement');
  }
  if (!registration) return {scope:new URL('./',location.href).href,worker:'',workerState:'non prêt / délai dépassé',nativeSubscribed:false,endpoint:'',registrationError:registrationError||window.__SENTINELLE_SW_LAST_ERROR__||''};
  const subscription = registration?.pushManager ? await registration.pushManager.getSubscription().catch(()=>null) : null;
  return {
    scope:registration?.scope || new URL('./',location.href).href,
    worker:registration?.active?.scriptURL || registration?.waiting?.scriptURL || registration?.installing?.scriptURL || '',
    workerState:registration?.active?.state || registration?.waiting?.state || registration?.installing?.state || 'enregistré',
    nativeSubscribed:Boolean(subscription),
    endpoint:subscription?.endpoint || '',
    registrationError:registrationError||window.__SENTINELLE_SW_LAST_ERROR__||''
  };
}

async function persistNativePushSubscription(subscription){
  if (!currentUser || !subscription) return null;
  const json = subscription.toJSON?.() || {};
  const endpoint = String(json.endpoint || subscription.endpoint || '').trim();
  const p256dh = String(json.keys?.p256dh || '').trim();
  const authSecret = String(json.keys?.auth || '').trim();
  if (!endpoint || !p256dh || !authSecret) throw new Error('Abonnement Push incomplet.');
  const supabase = getSupabaseClient();
  const { data,error } = await supabase.rpc('sentinelle_register_web_push_subscription', {
    p_endpoint:endpoint,
    p_p256dh:p256dh,
    p_auth:authSecret,
    p_preferences:spLoadPushPreferences(),
    p_user_agent:navigator.userAgent || '',
    p_platform:navigator.platform || ''
  });
  if (error) throw error;
  localStorage.setItem('sentinelle_native_push_endpoint', endpoint);
  return data;
}

async function syncNativePushIdentity(){
  if (!currentUser || !nativeWebPushSupported() || Notification.permission !== 'granted') return null;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return null;
    return await persistNativePushSubscription(subscription);
  } catch(error) {
    console.warn('Synchronisation Web Push impossible', error);
    return null;
  }
}

async function disableNativePushForCurrentDevice(){
  if (!currentUser || !('serviceWorker' in navigator)) return;
  try {
    const registration = await navigator.serviceWorker.ready.catch(()=>null);
    const subscription = await registration?.pushManager?.getSubscription?.().catch(()=>null);
    const endpoint = subscription?.endpoint || localStorage.getItem('sentinelle_native_push_endpoint') || '';
    if (endpoint) {
      const supabase = getSupabaseClient();
      await supabase.rpc('sentinelle_disable_web_push_subscription', { p_endpoint:endpoint }).catch(()=>{});
    }
  } catch(error) {
    console.warn('Désactivation Web Push impossible', error);
  }
}

async function registerPushNotifications(){
  const button = document.querySelector('#push-activate-main');
  const originalLabel = 'Activer les notifications sur cet appareil';
  try {
    if (!webPushFunctionConfigured()) return showModal('Web Push à configurer', `<div class="setup-box">Déploie d’abord l’Edge Function <strong>send-web-push</strong> et configure les secrets VAPID dans Supabase.</div>`);
    if (!nativeWebPushSupported()) return toast('Web Push non supporté sur cet appareil.', 'warning');
    if (isIosLike() && !isStandalonePwa()) return showModal('Installation requise sur iPhone', `<div class="setup-box">Sur iPhone/iPad, ouvre Sentinelle Pro depuis son icône installée sur l’écran d’accueil pour pouvoir activer le Web Push.</div>`);
    if (button) { button.disabled=true; button.textContent='Demande système en cours…'; }
    let permission = Notification.permission;
    if (permission !== 'granted') permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      if (permission === 'denied') return showModal('Notifications bloquées', `<div class="setup-box">L’autorisation a été refusée. Réactive les notifications dans les réglages de l’appareil puis reviens dans Sentinelle Pro.</div>`);
      throw new Error('Permission de notification non accordée.');
    }
    if (button) button.textContent='Création de l’abonnement sécurisé…';
    const registration = await ensureSentinelleServiceWorker({cleanupLegacy:true, timeoutMs:10000});
    if (!registration?.pushManager) throw new Error('Service Worker Sentinelle non prêt pour le Web Push.');
    const publicKey = await spGetVapidPublicKey();
    let subscription = await registration.pushManager.getSubscription();
    // V5.8.8 : on force un abonnement lié à NOS clés VAPID, et non à un ancien fournisseur.
    if (subscription) await subscription.unsubscribe().catch(()=>{});
    subscription = await registration.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey:urlBase64ToUint8Array(publicKey) });
    if (button) button.textContent='Association au compte Sentinelle…';
    await persistNativePushSubscription(subscription);
    await addAudit('web_push_enabled', { endpointHost:(()=>{try{return new URL(subscription.endpoint).host}catch{return 'push'}})(), provider:'supabase-web-push' });
    toast('Notifications Web Push activées sur cet appareil.', 'success');
    setTimeout(()=>renderPushSetup(),350);
  } catch(error) {
    console.error(error);
    showModal('Activation impossible', `<div class="setup-box">${safe(userFriendlyError(error,'Activation Web Push impossible.'))}</div>`);
  } finally {
    if (button) { button.disabled=false; button.textContent=originalLabel; }
  }
}

async function diagnosePushSetup(triggerButton=null){
  const button = triggerButton instanceof HTMLElement ? triggerButton : document.querySelector('#push-diagnose-main, #diagnose-push');
  const originalLabel = button?.textContent || 'Diagnostic Web Push';
  if (button) { button.disabled=true; button.textContent='Diagnostic en cours…'; }
  showModal('Diagnostic Web Push', `<div id="web-push-diagnostic-result"><div class="setup-box"><strong>Diagnostic en cours…</strong><br>Vérification de l’Edge Function, de Supabase et du Service Worker.</div></div>`);
  try {
    const [edgeResult, dbResult, nativeResult] = await Promise.allSettled([
      spNativePushRequest({action:'health'},{timeoutMs:8000}),
      (async()=>{
        const supabase=getSupabaseClient();
        const {data,error}=await supabase.rpc('sentinelle_web_push_status');
        if(error) throw error;
        return data;
      })(),
      nativePushState({timeoutMs:4000})
    ]);
    const edge = edgeResult.status==='fulfilled'
      ? `${edgeResult.value?.service||'send-web-push'} · VAPID ${edgeResult.value?.vapidConfigured?'OK':'MANQUANT'}`
      : `Erreur : ${edgeResult.reason?.message||edgeResult.reason||'inconnue'}`;
    const db = dbResult.status==='fulfilled'
      ? `${dbResult.value?.enabled_count ?? 0} abonnement(s) actif(s) sur ce compte`
      : `Erreur : ${dbResult.reason?.message||dbResult.reason||'inconnue'}`;
    const native = nativeResult.status==='fulfilled'
      ? nativeResult.value
      : {worker:'',workerState:`Erreur : ${nativeResult.reason?.message||nativeResult.reason||'inconnue'}`,nativeSubscribed:false,endpoint:''};
    const html = `<div class="setup-box"><strong>Edge Function</strong><br>${safe(edge)}</div><div class="setup-box" style="margin-top:12px"><strong>Base Supabase</strong><br>${safe(db)}</div><div class="setup-box" style="margin-top:12px"><strong>Appareil</strong><br>Permission : ${safe(typeof Notification!=='undefined'?Notification.permission:'indisponible')}<br>Service Worker : ${safe(native.worker||'absent')}<br>État : ${safe(native.workerState)}${native.registrationError?`<br>Erreur SW : ${safe(native.registrationError)}`:''}<br>Abonnement natif : ${native.nativeSubscribed?'oui':'non'}</div>`;
    const resultBox=document.querySelector('#web-push-diagnostic-result');
    if(resultBox) resultBox.innerHTML=html; else showModal('Diagnostic Web Push', html);
  } catch(error) {
    const message=userFriendlyError(error,'Diagnostic Web Push impossible.');
    const resultBox=document.querySelector('#web-push-diagnostic-result');
    if(resultBox) resultBox.innerHTML=`<div class="setup-box warning-copy"><strong>Diagnostic impossible</strong><br>${safe(message)}</div>`;
    else showModal('Diagnostic Web Push', `<div class="setup-box warning-copy">${safe(message)}</div>`);
  } finally {
    if (button && document.contains(button)) { button.disabled=false; button.textContent=originalLabel; }
  }
}

async function spSendOperationalPush({ title, message, category='planning', priority='Information', userIds=[], siteId='', route='home', data={}, target='' }={}){
  return spNativePushRequest({
    action:'send',
    title:String(title || 'Sentinelle Pro'),
    message:String(message || 'Nouvelle information opérationnelle'),
    priority,
    notificationType:category,
    notificationId:`${category}_${data?.missionId || data?.shiftId || data?.documentId || Date.now()}`,
    target:target || (siteId ? `site:${siteId}` : 'all'),
    userIds:Array.isArray(userIds)?userIds:[],
    siteId,
    route,
    url:new URL(`./index.html?route=${encodeURIComponent(route)}`, location.href).href,
    data
  });
}

function spMissionNotificationMessage({ siteName, start, end, count=1, status='created' }){
  const period = `${dateText(start)} → ${dateText(end)}`;
  if (status === 'cancelled') return `${siteName || 'Mission'} · ${period} · mission annulée par le QG.`;
  if (count > 1) return `${count} nouvelles missions planifiées sur ${siteName || 'un site'} à partir du ${dateText(start)}.`;
  return `${siteName || 'Nouvelle mission'} · ${period}. Consulte le planning et les consignes.`;
}

async function spNotifyQGShiftStarted({shiftId='',siteName='',startedAt=new Date()}={}){
  if(!shiftId) return {ok:false,skipped:true,reason:'Prise de poste incomplète'};
  return spNativePushRequest({action:'send',target:'qg',notificationType:'shift_start',notificationId:`shift_start_${shiftId}`,priority:'Important',route:'home',data:{shiftId,siteName,startedAt:new Date(startedAt).toISOString()}})
    .catch(error=>({ok:false,error:String(error.message||error)}));
}

async function spNotifyQGShiftEnded({shiftId='',siteName='',reportsCount=0,roundsCount=0,incidentsCount=0}={}){
  if(!shiftId) return {ok:false,skipped:true,reason:'Fin de poste incomplète'};
  return spNativePushRequest({action:'send',target:'qg',notificationType:'shift_end',notificationId:`shift_end_${shiftId}`,priority:incidentsCount>0?'Important':'Information',route:'home',data:{shiftId,siteName,reportsCount,roundsCount,incidentsCount}})
    .catch(error=>({ok:false,error:String(error.message||error)}));
}

async function spNotifyMissionCreated({ agentId, siteName, start, end, count=1, missionId='' }){
  return spSendOperationalPush({ title:count > 1 ? 'Nouvelles missions planifiées' : 'Nouvelle mission planifiée', message:spMissionNotificationMessage({ siteName, start, end, count }), category:'planning', priority:'Important', userIds:[agentId], route:'planning', data:{ missionId, count } }).catch(error => ({ ok:false, error:String(error.message || error) }));
}
async function spNotifyMonthlyPlanningPublished({agentIds=[],monthValue='',missionCount=0}={}){
  if(!agentIds.length) return {ok:false,skipped:true,reason:'Aucun agent concerné'};
  const range=monthRange(monthValue); const label=range.label.charAt(0).toUpperCase()+range.label.slice(1);
  return spSendOperationalPush({ title:`Planning ${label} disponible`, message:`Ton planning mensuel est finalisé. Consulte « Mon planning » et confirme la prise de connaissance du mois.`, category:'planning',priority:'Important',userIds:agentIds,route:'planning',data:{month:monthValue,status:'published',missionCount} }).catch(error=>({ok:false,error:String(error.message||error)}));
}
async function spNotifyMissionCancelled(mission){
  if (!mission?.agentId) return { ok:false, skipped:true };
  return spSendOperationalPush({ title:'Mission annulée', message:spMissionNotificationMessage({ siteName:mission.siteNom, start:mission.scheduledStart, end:mission.scheduledEnd, status:'cancelled' }), category:'planning', priority:'Urgent', userIds:[mission.agentId], route:'planning', data:{ missionId:mission.id, status:'cancelled' } }).catch(error => ({ ok:false, error:String(error.message || error) }));
}
async function spNotifyMissionUpdated(mission){
  if(!mission?.agentId) return {ok:false,skipped:true};
  return spSendOperationalPush({ title:'Planning modifié', message:`${mission.siteNom||'Mission'} · nouvel horaire ${dateText(mission.scheduledStart)} → ${dateText(mission.scheduledEnd)}. Consulte ton planning et confirme la lecture.`, category:'planning',priority:'Important',userIds:[mission.agentId],route:'planning',data:{missionId:mission.id,status:'updated',revision:missionRevision(mission)} }).catch(error=>({ok:false,error:String(error.message||error)}));
}
async function spNotifyInstructionsChanged(site, instructions){
  if (!site?.id) return { ok:false, skipped:true };
  return spSendOperationalPush({ title:`Consignes mises à jour · ${site.name || 'Site'}`, message:String(instructions || 'Les consignes opérationnelles du site ont été modifiées. Ouvre Sentinelle Pro avant ta prochaine prise de poste.').slice(0,420), category:'instructions', priority:'Important', siteId:site.id, route:'docs', data:{ siteId:site.id, updateType:'instructions' } }).catch(error => ({ ok:false, error:String(error.message || error) }));
}
async function spNotifyDocumentArchived(documentRecord){
  const payload = documentRecord?.payload || {}; const missionAgentId = payload?.mission?.agentId || '';
  if (!missionAgentId && !documentRecord?.siteId) return { ok:false, skipped:true, reason:'Document interne sans destinataire agent' };
  return spSendOperationalPush({ title:`Nouveau document · ${documentTypeLabel(documentRecord?.type)}`, message:`${documentRecord?.title || 'Un nouveau document'} est disponible dans la rubrique Documents.`, category:'documents', priority:'Information', userIds:missionAgentId ? [missionAgentId] : [], siteId:missionAgentId ? '' : (documentRecord?.siteId || ''), route:'docs', data:{ documentId:documentRecord?.id || '', documentType:documentRecord?.type || '' } }).catch(error => ({ ok:false, error:String(error.message || error) }));
}

function renderPushSetup(){
  currentRoute = 'pushsetup';
  const permission = typeof Notification !== 'undefined' ? Notification.permission : 'indisponible';
  const permissionClass = permission === 'granted' ? 'green' : permission === 'denied' ? 'red' : 'orange';
  const installed = isStandalonePwa(); const ios = isIosLike(); const prefs=spLoadPushPreferences();
  const body = `
    <section class="grid cols-2">
      <div class="card"><div class="card-title"><div><h2>Web Push natif</h2><p>Notifications écran verrouillé sans OneSignal.</p></div><span class="pill ${permissionClass}">${safe(permission)}</span></div>
        <div class="setup-box">App installée écran d’accueil : <strong>${installed?'Oui':'Non'}</strong><br>Web Push navigateur : <strong>${nativeWebPushSupported()?'Supporté':'Non supporté'}</strong><br>Edge Function Supabase : <strong>${webPushFunctionConfigured()?'Configurée':'Manquante'}</strong><br>Fournisseur : <strong>Web Push + VAPID</strong></div>
        ${ios&&!installed?`<div class="setup-box warning-copy"><strong>iPhone/iPad :</strong><br>ouvre Sentinelle Pro depuis l’icône ajoutée à l’écran d’accueil pour activer les notifications.</div>`:''}
        <button class="btn primary full" id="push-activate-main" type="button">Activer les notifications sur cet appareil</button>
        <button class="btn full" id="push-test-local" type="button">Tester une notification locale</button>
      </div>
      <div class="card"><div class="card-title"><div><h2>Diagnostic</h2><p>Supabase Auth → Edge Function → Web Push.</p></div></div>
        <div class="setup-box">V5.8.8.2 : aucun OneSignal et aucun Worker Cloudflare n’est nécessaire. Le Service Worker PWA reçoit directement le Web Push.</div>
        <div class="list"><div class="item"><div class="item-main"><div class="item-title">Compte connecté</div><div class="item-meta">${safe(currentProfile?.prenom||'')} ${safe(currentProfile?.nom||'')} · ${safe(currentProfile?.role||'')}</div></div></div><div class="item"><div class="item-main"><div class="item-title">Edge Function</div><div class="item-meta">${safe(pushConfig?.pushFunctionUrl||'Non configurée')}</div></div></div></div>
        <button class="btn full" id="push-diagnose-main" data-action="diagnose-web-push" type="button">Diagnostic Web Push</button><button class="btn ghost full" id="push-refresh-main" type="button">Rafraîchir l’état</button>
      </div>
    </section>
    <section class="card"><div class="card-title"><div><h2>Notifications à recevoir</h2><p>Choisis les événements envoyés sur cet appareil.</p></div></div><div class="list">
      ${rolePortal(currentProfile?.role)==='qg'?`<label class="item"><div class="item-main"><div class="item-title">Prises et fins de poste</div><div class="item-meta">Notification QG lorsqu’un agent démarre ou termine son poste.</div></div><input type="checkbox" data-push-pref="operations" ${prefs.operations?'checked':''}></label>`:''}
      <label class="item"><div class="item-main"><div class="item-title">Planning et missions</div><div class="item-meta">Nouvelle mission, annulation et modification de planning.</div></div><input type="checkbox" data-push-pref="planning" ${prefs.planning?'checked':''}></label>
      <label class="item"><div class="item-main"><div class="item-title">Messages Flash QG</div><div class="item-meta">Informations, urgences et messages prioritaires.</div></div><input type="checkbox" data-push-pref="flash" ${prefs.flash?'checked':''}></label>
      <label class="item"><div class="item-main"><div class="item-title">Consignes opérationnelles</div><div class="item-meta">Modification des consignes d’un site ou d’une mission.</div></div><input type="checkbox" data-push-pref="instructions" ${prefs.instructions?'checked':''}></label>
      <label class="item"><div class="item-main"><div class="item-title">Nouveaux documents</div><div class="item-meta">Rapports de mission et documents disponibles.</div></div><input type="checkbox" data-push-pref="documents" ${prefs.documents?'checked':''}></label>
    </div><button class="btn primary full" id="push-save-preferences" type="button">Enregistrer mes préférences</button></section>`;
  render(page('Notifications Web Push','Supabase Edge Functions · sans OneSignal',body));
  spGetVapidPublicKey().catch(error=>console.warn('Préchargement VAPID impossible',error));
  navigator.serviceWorker?.ready?.catch?.(()=>{});
  document.querySelector('#push-activate-main')?.addEventListener('click',registerPushNotifications);
  document.querySelector('#push-save-preferences')?.addEventListener('click',async()=>{const preferences={...SP_PUSH_PREF_DEFAULTS};document.querySelectorAll('[data-push-pref]').forEach(input=>{preferences[input.dataset.pushPref]=Boolean(input.checked)});await spSavePushPreferences(preferences);toast('Préférences de notifications enregistrées.','success');});
  document.querySelector('#push-refresh-main')?.addEventListener('click',()=>renderPushSetup());
  document.querySelector('#push-test-local')?.addEventListener('click',async()=>{try{if(typeof Notification==='undefined')return toast('Notifications indisponibles sur ce navigateur.','warning');if(Notification.permission!=='granted')return toast('Autorisation non accordée sur cet appareil.','warning');const reg=await ensureSentinelleServiceWorker({timeoutMs:8000});await reg.showNotification('Sentinelle Pro',{body:'Notification locale de test. Le Service Worker est opérationnel.',tag:'sentinelle-local-test',icon:'./assets/icons/icon-192.png',badge:'./assets/icons/icon-192.png'});toast('Notification locale envoyée.','success')}catch(error){toast(userFriendlyError(error,'Test notification impossible.'),'error')}});
}

async function sendPushForFlash(flash){
  return spNativePushRequest({ action:'send', title:flash.title, message:flash.message, priority:flash.priority, target:flash.target, notificationType:'flash', notificationId:`flash_${flash.id}`, route:'flash', url:new URL('./index.html?route=flash',location.href).href, data:{flashId:flash.id} });
}

// -------------------- FLASH / SOS / UTILS --------------------
function flashTargetsMe(f){
  if (!currentProfile || rolePortal(currentProfile.role) !== 'agent') return false;
  if (f.target === 'all') return true;
  if (f.target === 'working') return currentProfile.statut === 'en_poste';
  if (f.target === `agent:${currentUser.uid}`) return true;
  if (currentProfile.siteActuel && f.target === `site:${currentProfile.siteActuel}`) return true;
  return false;
}
function startFlashListener(){
  if (!currentUser || rolePortal(currentProfile.role) !== 'agent') return;
  const q = query(collectionRef('flashMessages'), orderBy('sentAt','desc'), limit(5));
  latestFlashUnsub = onSnapshot(q, snap => {
    snap.docs.map(d => ({id:d.id,...d.data()})).filter(flashTargetsMe).forEach(f => {
      if (!f.readBy?.[currentUser.uid] && !document.querySelector(`[data-flash-overlay="${CSS.escape(f.id)}"]`)) showFlashOverlay(f);
    });
  });
}
function showFlashOverlay(f){
  const div = document.createElement('div');
  div.className = 'flash-overlay';
  div.dataset.flashOverlay = f.id;
  div.innerHTML = `<div class="flash-card ${f.priority === 'Critique' ? 'critique':''}"><div class="flash-priority">${safe(f.priority || 'Information')}</div><h2>${safe(f.title)}</h2><p>${safe(f.message)}</p><button class="btn primary full" data-confirm-flash="${safe(f.id)}">Confirmer lecture</button></div>`;
  document.body.appendChild(div);
  div.querySelector('[data-confirm-flash]').addEventListener('click', async () => { await markFlashRead(f.id); div.remove(); });
  if (navigator.vibrate) navigator.vibrate([120,80,120]);
}
async function markFlashRead(flashId){
  const field = `readBy.${currentUser.uid}`;
  await updateDoc(docRef('flashMessages', flashId), { [field]: { readAt: Timestamp.now(), agentNom:`${currentProfile.prenom||''} ${currentProfile.nom||''}`.trim() } });
  await addAudit('flash_read', { flashId });
  toast('Lecture confirmée', 'success');
}

function resetSosButton(){
  clearTimeout(sosTimer); clearInterval(sosCountdownTimer);
  sosTimer = null; sosCountdownTimer = null; sosArming = false;
  const btn = document.querySelector('#sos-btn');
  btn?.classList.remove('arming');
  if (btn) btn.innerHTML = 'SOS<br><small>PTI</small>';
  document.querySelector('#sos-help')?.classList.add('hidden');
}
function bindSos(){
  const btn = document.querySelector('#sos-btn');
  const help = document.querySelector('#sos-help');
  if (!btn) return;
  const blockNative = e => { e.preventDefault(); e.stopPropagation(); };
  ['contextmenu','selectstart','dragstart','copy'].forEach(type => btn.addEventListener(type, blockNative));
  const start = e => {
    blockNative(e);
    if (sosArming) return;
    sosTriggered = false; sosArming = true;
    btn.setPointerCapture?.(e.pointerId);
    btn.classList.add('arming'); help?.classList.remove('hidden');
    if (navigator.vibrate) navigator.vibrate(70);
    const startedAt = Date.now();
    const renderCountdown = () => {
      const remaining = Math.max(1, Math.ceil((3000 - (Date.now() - startedAt)) / 1000));
      if (btn.isConnected && sosArming) btn.innerHTML = `${remaining}<br><small>MAINTENIR</small>`;
    };
    renderCountdown(); sosCountdownTimer = setInterval(renderCountdown, 100);
    sosTimer = setTimeout(async () => {
      sosTriggered = true; sosArming = false; clearInterval(sosCountdownTimer); sosCountdownTimer = null;
      btn.innerHTML = '✓<br><small>ALERTE</small>';
      await triggerSOS();
    }, 3000);
  };
  const stop = e => {
    if (e) blockNative(e);
    if (sosTriggered) { setTimeout(resetSosButton, 700); return; }
    if (!sosArming) return;
    resetSosButton();
  };
  btn.addEventListener('pointerdown', start, { passive:false });
  btn.addEventListener('pointerup', stop, { passive:false });
  btn.addEventListener('pointerleave', stop, { passive:false });
  btn.addEventListener('pointercancel', stop, { passive:false });
}
async function triggerSOS(){
  const queuedOffline = !navigator.onLine;
  document.querySelector('#sos-btn')?.classList.remove('arming');
  document.querySelector('#sos-help')?.classList.add('hidden');
  try {
    const shift = await findActiveShift().catch(() => activeShiftCache || null);
    const gps = await getGPS();
    const agentNom = `${currentProfile.prenom || ''} ${currentProfile.nom || ''}`.trim();
    const alertDoc = await addDoc(collectionRef('alerts'), {
      agentId: currentUser.uid, agentNom, siteActuel: shift?.siteId || currentProfile.siteActuel || null, siteActuelNom: shift?.siteNom || currentProfile.siteActuelNom || null,
      positionGPS: gps, heure: serverTimestamp(), localTriggeredAt:new Date().toISOString(), queuedOffline,
      typeAlerte:'SOS/PTI', statut:'active', message:queuedOffline?'Alerte PTI enregistrée hors ligne — transmission au retour du réseau':'Alerte PTI déclenchée par l’agent', niveau:'critique', createdAt:serverTimestamp(), createdBy:currentUser.uid
    });
    updateDoc(docRef('users', currentUser.uid), { statut:'alerte', lastSeen:serverTimestamp() }).catch(()=>{});
    addAudit('sos_triggered', { alertId: alertDoc.id, siteId: shift?.siteId || null, queuedOffline }).catch(()=>{});
    if (navigator.vibrate) navigator.vibrate([200,80,200,80,200]);
    showSOSSent(alertDoc.id, { queuedOffline });
  } catch(error){
    console.error(error);
    showModal('Alerte non enregistrée', `<div class="setup-box danger-copy">L’appareil n’a pas pu enregistrer l’alerte. Appelle immédiatement le QG ou les secours.</div><div class="grid cols-2">${qgPhoneButton()}<a class="btn danger full" href="tel:112">Appeler le 112</a></div>`);
  }
}
function qgPhoneButton(){
  const digits = String(DEFAULT_QG_WHATSAPP || '').replace(/\D/g,'');
  if (!digits || digits === '33600000000') return '';
  const tel = String(DEFAULT_QG_WHATSAPP).replace(/[^+\d]/g,'');
  return `<a class="btn warning full" href="tel:${safe(tel)}">Appeler le QG</a>`;
}
function showSOSSent(alertId,{queuedOffline=false}={}){
  const title = queuedOffline ? 'Alerte enregistrée hors ligne' : 'Alerte envoyée au QG';
  const message = queuedOffline
    ? 'L’alerte est conservée sur cet appareil et sera synchronisée au retour du réseau. Le QG n’est pas prévenu en temps réel : appelle-le immédiatement ou compose le 112.'
    : 'QG notifié. Restez en sécurité.';
  showModal(title, `<div class="setup-box danger-copy">${safe(message)}</div><div class="grid cols-2">${qgPhoneButton()}<a class="btn danger full" href="tel:112">Appeler secours 112</a><button class="btn full" id="false-alert">Fausse alerte</button></div><p class="muted" style="font-size:12px;margin-top:14px">La fausse alerte est tracée et ne supprime pas silencieusement l’historique.</p>`);
  document.querySelector('#false-alert')?.addEventListener('click', async () => {
    const reason = prompt('Confirme la fausse alerte avec une justification :');
    if (!reason || reason.trim().length < 5) return toast('Justification trop courte.', 'warning');
    await updateDoc(docRef('alerts', alertId), { statut:'false_alert_requested', falseAlertReason:reason.trim(), falseAlertAt:serverTimestamp(), falseAlertBy:currentUser.uid });
    await addAudit('sos_false_alert_requested', { alertId, reason:reason.trim() });
    toast('Fausse alerte signalée au QG', 'warning'); closeModal();
  });
  setTimeout(resetSosButton, 900);
}

function userFriendlyError(error, fallback){
  const msg = String(error?.message || '');
  const code = String(error?.code || '');
  if (msg && !msg.includes('FirebaseError')) return msg;
  if (code.includes('permission-denied')) return 'Permission refusée par Supabase. Vérifie profiles.role et les RLS V5.8.7.';
  if (code.includes('auth/weak-password')) return 'Mot de passe trop faible : minimum 6 caractères.';
  if (code.includes('auth/invalid-email')) return 'Email invalide.';
  if (code.includes('auth/email-already-in-use')) return 'Cet email existe déjà dans Supabase Auth. Relie son auth.users.id au profil avant de poursuivre.';
  return fallback;
}

async function addAudit(action, details={}){
  if (!db || !currentUser) return;
  try {
    await addDoc(collectionRef('auditLogs'), { action, details, userId: currentUser.uid, userRole: currentProfile?.role || null, createdAt: serverTimestamp(), userAgent:navigator.userAgent });
  } catch(e) { console.warn('audit failed', e); }
}
async function downloadCollaboratorPlanningPdf(agentId,monthValue,{agentView=false}={}){
  try{
    const [agentSnap,missionSnap,siteSnap]=await Promise.all([
      getDoc(docRef('users',agentId)),
      getDocs(query(collectionRef('missions'),where('agentId','==',agentId))),
      getDocs(collectionRef('sites'))
    ]);
    if(!agentSnap.exists()) throw new Error('Profil collaborateur introuvable.');
    const agent={id:agentSnap.id,...agentSnap.data()};
    const sites=siteSnap.docs.map(d=>({id:d.id,...d.data()}));
    const siteMap=new Map(sites.map(x=>[x.id,x]));
    const range=monthRange(monthValue||localMonthValue());
    const missions=missionSnap.docs.map(d=>({id:d.id,...d.data()})).filter(m=>(!agentView||!missionIsDraft(m))&&missionOverlapsRange(m,range.start,range.end)).sort((a,b)=>(missionStartMs(a)||0)-(missionStartMs(b)||0));
    const segments=missions.filter(m=>m.status!=='cancelled').flatMap(m=>missionSegmentsByDay(m,range.start,range.end));
    const jsPDF=getJsPDF(); if(!jsPDF) throw new Error('Bibliothèque PDF indisponible.');
    const doc=new jsPDF({unit:'mm',format:'a4',orientation:'landscape'});
    const C=AZZERA_DOC_BRAND;
    let profile={};
    if(!agentView) profile=await loadBillingProfile().catch(()=>({}));
    const company=profile.companyName||'AZZERA PROTECT';
    const agentName=`${agent.prenom||''} ${agent.nom||''}`.trim()||agent.email||agent.id;
    doc.setProperties({title:`Planning ${agentName} ${monthValue}`,subject:'Planning collaborateur',author:`${company} · Sentinelle Pro`});
    doc.setFillColor(...C.obsidian);doc.rect(0,0,297,28,'F');
    pdfDrawLogo(doc,10,5,17,17);
    doc.setTextColor(...C.white);doc.setFont('helvetica','bold');doc.setFontSize(13);doc.text(company.toUpperCase(),31,12);
    doc.setTextColor(...C.azure);doc.setFontSize(7.2);doc.text('PLANNING COLLABORATEUR',31,18);
    doc.setTextColor(210,220,230);doc.setFont('helvetica','normal');doc.setFontSize(6.8);doc.text(`Édition du ${new Date().toLocaleString('fr-FR')} · Ce planning est susceptible d’être modifié.`,286,12,{align:'right'});
    doc.text(`${range.label.toUpperCase()} · ${agentName}`,286,19,{align:'right'});
    let y=34;
    doc.setDrawColor(...C.line);doc.setFillColor(248,250,252);doc.roundedRect(10,y,277,18,2.5,2.5,'FD');
    doc.setTextColor(...C.obsidian);doc.setFont('helvetica','bold');doc.setFontSize(9);doc.text(agentName,14,y+6);
    doc.setFont('helvetica','normal');doc.setFontSize(6.5);doc.setTextColor(...C.grey);
    const identity=[agent.address,[agent.postalCode,agent.city].filter(Boolean).join(' '),agent.telephone,agent.email,agent.professionalCard?`Carte pro : ${agent.professionalCard}`:''].filter(Boolean).join(' · ');
    doc.text(doc.splitTextToSize(identity||'Coordonnées collaborateur non renseignées.',268),14,y+11);
    y+=23;
    const siteRows=[...new Map(missions.map(m=>[m.siteId,siteMap.get(m.siteId)||{id:m.siteId,name:m.siteNom}]).filter(([id])=>id)).values()];
    const rows=siteRows.length?siteRows:[{id:'none',name:'Aucune vacation'}];
    const dayW=7.45,siteW=42,totalW=siteW+range.days*dayW;
    const drawGridHeader=()=>{
      doc.setFillColor(...C.obsidian);doc.rect(10,y,totalW,10,'F');
      doc.setTextColor(...C.white);doc.setFont('helvetica','bold');doc.setFontSize(6);doc.text('SITES',12,y+6.5);
      for(let i=0;i<range.days;i++){
        const d=new Date(range.start.getFullYear(),range.start.getMonth(),i+1),x=10+siteW+i*dayW;
        doc.setDrawColor(80,94,110);doc.rect(x,y,dayW,10);
        doc.setFontSize(4.8);doc.text(String(i+1).padStart(2,'0'),x+dayW/2,y+4,{align:'center'});doc.setFontSize(3.8);doc.text(d.toLocaleDateString('fr-FR',{weekday:'short'}).replace('.','').slice(0,3).toUpperCase(),x+dayW/2,y+7.5,{align:'center'});
      }
      y+=10;
    };
    drawGridHeader();
    for(const site of rows){
      if(y>164){doc.addPage('a4','landscape');y=12;drawGridHeader();}
      const rowH=14;
      doc.setFillColor(248,250,252);doc.rect(10,y,totalW,rowH,'F');doc.setDrawColor(...C.line);doc.rect(10,y,siteW,rowH);
      doc.setTextColor(...C.obsidian);doc.setFont('helvetica','bold');doc.setFontSize(5.8);doc.text(doc.splitTextToSize(site.name||site.id,siteW-4).slice(0,3),12,y+4.5);
      for(let i=0;i<range.days;i++){
        const day=new Date(range.start.getFullYear(),range.start.getMonth(),i+1),x=10+siteW+i*dayW,dayStart=startOfDay(day),dayEnd=addDays(dayStart,1);
        doc.setDrawColor(...C.line);doc.rect(x,y,dayW,rowH);
        const segs=missions.filter(m=>m.siteId===site.id&&missionOverlapsRange(m,dayStart,dayEnd)).flatMap(m=>missionSegmentsByDay(m,dayStart,dayEnd)).slice(0,2);
        if(segs.length){doc.setFont('helvetica','bold');doc.setTextColor(...C.obsidian);doc.setFontSize(3.7);segs.forEach((seg,j)=>{doc.text(timeOnlyText(seg.start),x+dayW/2,y+4+j*6,{align:'center'});doc.text(timeOnlyText(seg.end),x+dayW/2,y+7+j*6,{align:'center'});});}
      }
      y+=rowH;
    }
    const daily=Array.from({length:range.days},(_,i)=>segments.filter(seg=>seg.date.getDate()===i+1).reduce((sum,seg)=>sum+seg.minutes,0));
    doc.setFillColor(236,243,248);doc.rect(10,y,totalW,10,'F');doc.setDrawColor(...C.line);doc.rect(10,y,siteW,10);doc.setTextColor(...C.obsidian);doc.setFont('helvetica','bold');doc.setFontSize(5.5);doc.text('TOTAL HEURES JOURNALIÈRES',12,y+6);
    daily.forEach((min,i)=>{const x=10+siteW+i*dayW;doc.rect(x,y,dayW,10);doc.setFontSize(4.2);doc.text(min?(min/60).toFixed(2):'—',x+dayW/2,y+6,{align:'center'});});
    y+=15;
    const breakdown=planningHourBreakdown(segments),weeks=planningWeeklyTotals(segments),total=segments.reduce((sum,x)=>sum+x.minutes,0);
    if(y>150){doc.addPage('a4','landscape');y=14;}
    doc.setTextColor(...C.obsidian);doc.setFont('helvetica','bold');doc.setFontSize(8);doc.text('HEURES PLANIFIÉES',10,y);doc.text('HEURES HEBDOMADAIRES',158,y);y+=4;
    const leftRows=[['Semaine',(breakdown.weekDay/60).toFixed(2),(breakdown.weekNight/60).toFixed(2),(breakdown.holidayDay/60).toFixed(2),(breakdown.holidayNight/60).toFixed(2)],['Dimanche',(breakdown.sundayDay/60).toFixed(2),(breakdown.sundayNight/60).toFixed(2),'0.00','0.00'],['TOTAL','','','',''+(total/60).toFixed(2)]];
    const x0=10,widths=[34,23,23,26,26],headers=['Heures planifiées','De jour','De nuit','Férié jour','Férié nuit'];
    let x=x0;doc.setFillColor(...C.obsidian);doc.setTextColor(...C.white);doc.setFontSize(5);headers.forEach((h,i)=>{doc.rect(x,y,widths[i],8,'F');doc.text(h.toUpperCase(),x+1.5,y+5);x+=widths[i];});y+=8;
    leftRows.forEach(row=>{x=x0;doc.setTextColor(...C.obsidian);doc.setFont('helvetica',row[0]==='TOTAL'?'bold':'normal');doc.setFontSize(5.5);row.forEach((v,i)=>{doc.setDrawColor(...C.line);doc.rect(x,y,widths[i],8);doc.text(String(v),x+1.5,y+5);x+=widths[i];});y+=8;});
    let wy=y-32,wx=158,weekW=15;doc.setFillColor(...C.obsidian);doc.setTextColor(...C.white);doc.rect(wx,wy,35,8,'F');doc.text('SEMAINE',wx+2,wy+5);weeks.forEach((w,i)=>{doc.rect(wx+35+i*weekW,wy,weekW,8,'F');doc.text(String(w.week),wx+35+i*weekW+weekW/2,wy+5,{align:'center'});});wy+=8;
    doc.setTextColor(...C.obsidian);doc.setFont('helvetica','normal');doc.rect(wx,wy,35,9);doc.text('HEURES',wx+2,wy+5.5);weeks.forEach((w,i)=>{doc.rect(wx+35+i*weekW,wy,weekW,9);doc.text((w.minutes/60).toFixed(2),wx+35+i*weekW+weekW/2,wy+5.5,{align:'center'});});
    const footerY=201;doc.setDrawColor(...C.line);doc.line(10,footerY-4,287,footerY-4);doc.setTextColor(...C.grey);doc.setFontSize(5.4);doc.setFont('helvetica','normal');
    const footer=[company,profile.address,[profile.postalCode,profile.city].filter(Boolean).join(' '),profile.phone,profile.email,profile.siret?`SIRET ${profile.siret}`:'',profile.legalNotice||'Document généré par Sentinelle Pro.'].filter(Boolean).join(' · ');
    doc.text(doc.splitTextToSize(footer,270).slice(0,2),148.5,footerY,{align:'center'});
    const file=`planning-${agentName.toLowerCase().replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'')||agentId}-${monthValue}.pdf`;
    doc.save(file);toast('Planning PDF téléchargé.','success');
  }catch(error){console.error(error);toast(userFriendlyError(error,'PDF planning impossible.'),'error');}
}

function lockModalViewport(){
  document.documentElement.classList.add('modal-open');
  document.body.classList.add('modal-open');
}
function unlockModalViewport(){
  document.documentElement.classList.remove('modal-open');
  document.body.classList.remove('modal-open');
}
function showModal(title, body, size=''){
  closeModal();
  const div = document.createElement('div');
  div.className = 'modal-backdrop';
  div.id = 'modal-root';
  div.innerHTML = `<div class="modal ${size === 'wide' ? 'wide':''}"><div class="modal-head"><h2>${safe(title)}</h2><button class="btn small ghost" id="modal-close">Fermer</button></div>${body}</div>`;
  document.body.appendChild(div);
  lockModalViewport();
  document.querySelector('#modal-close').addEventListener('click', closeModal);
  div.addEventListener('click', e => { if (e.target === div) closeModal(); });
}
function closeModal(){
  document.querySelector('#modal-root')?.remove();
  unlockModalViewport();
}

window.addEventListener('beforeunload', () => {
  if (currentUser && db) updateDoc(docRef('users', currentUser.uid), { isOnline:false, lastSeen:serverTimestamp() }).catch(()=>{});
});


// -------------------- V5.2 — DOCUMENTS PREMIUM AZZERA PROTECT --------------------
// Correctif esthétique : documents PDF/aperçus alignés sur la charte Azzera Protect.
const AZZERA_DOC_LOGO_DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAANQAAAC+CAYAAABNsSEkAAAlJUlEQVR42u2de5ydVXnvv89a7/vuPbcdQEBArVDFSwLkAipQMOBp66XWY607VqEnmMuAtBy8IF5AZzaXkKCeemq1NSTY02o9ZlrbU9vanksD6kdtgcwkwXAEi9dWRSpkMrf9XtbTP/Z+JwNGcmHvPe+eWQ+f/WGSTHb2rHf91u95fuu5CN4WjKmqDIPsG0EAllbRYVARUb863rwdHkFSVbVVVXu4b129U4PqDrWoil+49plf3G4FEpgRkWzub181pifH8CwjlLIEtZaJQPjJH62QR+Z+X1XVjoDDM5cH1GK36g61I2saQBq8V3tdwCuAVwIvRXkewjPEAgrqSFHGFR4Uy5c044vfepyv3H2ppE9+L28eUIsPTKp2RCSr/h9dcvwpDKqy0UacaUPIUnAJuLTBYYAgYAyYCEwA6QxoxhjKHY//lD8ZuVQmPKg8oBajjydDitRE3BX36iujMh8Ne3lROgNpHSeCU8VIE0Szz1XRJrq0+T02LCMmgnSaB1zK9dtWyN8MqZqaoOBdQA+oRRAvDdEA08bder1YNhuLJDOkCEbAHN3b4QANy1hVyBJu2LZcNg2pmhqoj6s8oBY0M1W1IT6sH9WPlpdwbX0cVUVFjg5IhwKWCJQqmPp+PrJtpVyXu5R+3Y/djF+CIsdMTTDdpzeUj+Pa+jgpCk8XTNB8D0Xq46SlJbxr3S69bkQkOxIJ3psHVPeBaUeDLa64V18Z9HBLfIAUxc5GSa3xTwTFxhNkYYnN63bry0dEsuoODyrv8i3AuOk7Y1QCw64g4ox0BtcKZjrkP+dwYS8mneYBczLnnXoaMz6e8gy1cNhpBFMTcYFyU3mAM9JpsnaBCUAMJpkiK1V4cfZjrquJuKrfG56hFoyrt0ayjbv0JVLiqy5txDptf1aKSoCiTLmEldtX8S+5uuifimeornf5FG63IQGueUnb/qNVNEXDPvpFuAURzZNsvXmG6k52asrW6+7T3yoN8NlkigzotEDgTARpwqV3Lpcv+UyKo7PAL0FxWGkp6Lqv6IAYbnEpqopI5488tRab1dlcVb14aSONyZt3+bqMnWgIEfRxXanC87J6+1S9w5hNpsiifi5Yspffqok4fzflAdVVNqRqRgS3YUxfYAPelUzh5vPZKIhLURxDl49p39Jh1NdReUB1jTWCf1F1fCjsoU9TtKUXuEcbWAsmm8FFA5wZOa6t1byM7kWJLhMi1u/R14QRf5vOzIsQcSiaUglRdRwwhnO2LuP7Xkb3DNUVQkT1fo1w3Fqwo1Y0QaNelmR1NnkZ3QOqa4SISsJbS/2sSKcLwk4HQWXjCZwt85bB3frykTU+z8+7fMVVIowOo+tGOdEa9piAZ2YpKsU75LKgB5tM8fVnP87FXILzxYieoYrHTssQEVEj3FAa4BSX4KSYz8OmU2Slfs7//vH8l4aM7veNZ6hCkZOamojbMKrLJOAelJJmyHwqe08d6uGCEpLFfM+kLD/1CxyoDftsdM9QBbE8uFdlc9hDj2bzK5Mf9tQVTFbHRQM81wW8vVYTVx3xe8czVBFcvWZu3Ppd+pqwh79N6wUTIn4uTTWy0VU54BKW37mK73kZ3TPUfPtOsrSKrv22lkXYgoBqlxxqzWz0qI8lxlDzMroH1PyzU1MmDx7nbVGFs9pdONgGUJn4AM5GXD44phd5Gf1nzWebd0qIGFIzDO6Kf9JTxPLedLrYcdNThAjOhNikzuYh1ZfTbPvnZXTPUJ0VIoYbMnkYckPUx8kumd8E2KdhNpkkC/v5pX8d481eRveA6jw7qZpmvt45ErIxnsAh3bv2eTa6ws3rHtABn43uATUvggQZHwnKlDpW1t4uv68po5cqnMEM1/ls9Cf6xN7aKUQ0s8k3jOplYT+fTibIELo/kFdULCrCtMtYtW0FD+X91z1DeWsbKy0dRteO6nEIm1yM6kI5xATRDA166FPHZvAyumeoDrHTulHd1LOE99X3LxB2eqJlQRmb1XnNHcvli4u9P7oHVBuFiBroht2cKZZdQI+mxc3XO3YSxoU9mGSKvb39vOSEM0kWc9dZ7/K1N3pXzbi1CGXt7RQo0mmyUoWzpybZuNi7znpAtcPV26G2JuIGR/XSoMxvNmXyBZtRoIKkM6gRbrxqTE/eAW5oSI0HlLeWbK+lVXRopwapslkChAXe207AuAQXDvDMJON9IqL7li3OcMIDquVCRCNf7wfH8dvlCi9Np7okm7wFeymZxNmIqzaM6rKRNZIN6eJjKQ+o1kboszK5CENZHVVZJCd1LqOXKauyGQ7WfXlAeTs2dhrB1GriQri+VOG5WVzYsvZ2gcrGk2RhL69dN6q/NrJm8U1E9LJ5iyyXya/awwucYZcq5SKXtbePpBe3jO4ZqkW2bwRBRJOUW4Ieeote1t62EzqX0Zdw9vQUg4tNRveAaoWrlw9J26O/HPQsfJn8SOKpdBoVw41r79dTFpOM7gHVCiGi2uj+6lI+JGbhy+RHsq9cggv7ONnG1BaTjO4B9XTZaW7310oBu7/OH0uZeAIXlnjr4B49b7GUy3tAPV12GkbftkePN8KN6WKSyY8EUg41IWGW8GFtMrkHlLenZqeauDjlfVGFZ7vFJpMfHlKN4W0DrN44ujiGt/nT9Bgt7/66bkzPCiz3OCViEcrkhyfx2a6zD0cBK04aYWohd531p+kxWp4FIMrtQZkyi1QmP+yJfbDr7PPqycIf3uY3wLG4ek2ZfN2ovj7q5S+9EHE4mmoMb8MxLjHLt567cIe3eYY6FiGiig7eq70GNqvrou6v83dsiyZo2MtxmSzs4W0eUMciRIg4Z7kmqvDCbKbLur/Oo0DRHN725vV79ZKFKqP7k/VohQjQtWM8N7SMiWFAEy9EHI1AEfZi0inuMxkXnHou2ULL8/Mn69EKESIawKaojyWaeCHiaAWKtCGjn5sZNtRk4Y3F8ZvhKIWIwVG9VEr8YxZ3bSvledYncDZEXMqPTIlzTv0sP60B1BaGQOE3xJFtg0a+3g61mXKb2HxveDuGE9y4GFfq59RskhtqNXHVBZTn5wF1JOzULGtf8nwui/p52SIqa2/bvqs3y+XX79FzFlK5vAfU4SNpWTqMDv6LLsFwU7NJvneVnx5NCRlqy5RJuH02PvWAWgTs1Cxrz8Z5R2mA52Z1nJfJWwKqxlicPl65fkx/faGUy/uT9iksl8mvHOO5zrIboX8hdn+dP/JvlMun0+zp6eOlC6Fc3p+0T2G5TJ4qN4V9VBZq99d5O82b5fJRhXOmp/idhVAu7wH181y9XCYf04uCMm+JD3T3kLQix1PpNA7hfVffr6eMdHm5vN8gh3ZGZru/Zo4Pi8VCdw9JK/IedAka9XPiTMwNdHm5vAfUodgp7/66hCtKFS+Td4ClTDyJsyEbB3fr2d0so3tA/awSYZYOo4P36oliqfmy9g5BKkPDHkou49bZ+NUDagGw0zKkVhOXGt5fGuA0X9beMUjZeIIs6OHX1+/R13RrNro/eZ9ATmpqgl55Py92yr0oJfVl7Z2LXPOus9PsTY/jpaefTtxtMro/eedYw80QTRNuC3voUV/W3tnTfc7wtuBx3taNMroHVO7q5d1fd+urwzKvi7tlWruimr/A/cxr7p/P/b45v0ZRipLse7Dr7PvX79FndlvXWQ+ohq8hS6voNQ9qSTNuR4pd1q6KQ8kAFYvYELERYkPMz7yi5p/Nfc39/RBpDoUTVRyQAlkTZPOyJ12Ci/o5UVNu7Laus96d4eC09g1j+s5ogI/E44Vmp8yWsDaEZBo0ZVJhGiER5jDNHGdVQeRQDKQYBItSRhgIe0AC0AzSaVBHpmCk826vIqgJSNOE8+9cIaO5B1H0vRR4IUJNDdyVo/osBzek08UtHFTFlfqx8SQPpDF3CHzNRfwwsEzWp0lLGVqqNIBTHz8IgrpFShWUx574fnWLlFKC2NEThDwjmeIMlHMwXAJcEFUopdPgEjLAdDCeFBzORkRpnduAV3mG6jZ22qWfjJYwWGB2ysI+bDLFn7oD/M6dF8mBdv5j6/fqi8Xx2wJrwz5OSybBuc5m2s/pQfGGbSvlL/Nn5QFVcCFiw/26wij/5BwBjdipWOuiZFGDmf5q2wr5jSazBoBjGIaH0afzgYeGEYZhH8gjdyF3X0KWS9Vv3aUnhQHXKlxnI0rJNJl06MBRxQVlJJ3hobqw6nnLmS66jO4BtUaydbv0i6UBXpUUUNnLWxm7lO+4Cc7bfgGPVUcw7Y4nhlTNXXdh7r5UUoCNe/UlAluDHlbEBzq4TkoWVbDxfoa3rZJa0Vlq0QJq1tUb1d8Ievl8Ubu/quKiXkx9mjfeuUL+YvVODfJN3qEPIEN3YWuXSnrZ17XS28unwj7e0DHXWFEJUFEmEVZuPYuHi9x1dnHK5qqyFPTyMe0DtqhDCymTK1nUh4kn+X93Lufz1R1qOwomABGtXSppVdV+5nwZv+MvqMYTfDqqYJvSfbuPfNEUDXoZyJLid51dlIDKu7+WHdeWKpyZzRSyrF0xSBaTIrx/vuOGEWlmgA+j+7/JFfEEXwj7sepwHQCVjSdwQYnq+tFid51ddIAaUjUjDZn8dBNwfTxVUJlccVEfJov53PaV8s9FuIepibghkJE1kk2NszaZ4l+C8uyFcNtXRAIE5baqqm0Mb1PxgJpny8vaM+XmoI8lhSxr10YGRDrNlFpupkDT/2oibvVODf7sYnlMHe8zQcfWzqZTZKUBzl+ymysaw9uKt38XlSgxq+rdpy8Pyux0yewaFE8mr2Dr+/nY9lXyX4uYJZAXAP5gjC+HvVzYCVFntutswg9LEeec+DkeK9rwtkXEUAe7vxphkw0xFLGsvaFqmWSSx8VyOwWdTbuvqbSJ4fekQ7mPs11nBzitPsP1RRzetmgAlZe1V57Pm8IBfimZLGxZu4t6kSzl49uWyw+qI43PXbQPOQIOVGaUL8aTfDsoYZSOxFImnsSZkN8d3KMvmhVLPKA6eeo3ur+ue0AHEG5xSTG7vyo4E2HqB/i3njK/h6qMVClmE30RrSrm0ytkEvhrWwKhI4qfaIYGPfRmKVtm42IPqA6yU3Nau8zwrlKFM4ra/VUUDcqIwpaPL5V/r4IpcprNI3choGKEL2vWwZi8WS4f9vG69fcVq+vsggfUrEz+DT3TBFyXFFQmV8XZMiYe55s2ZdvQUONzF3ltL7kEB6Kp44FkirhZCqIdWi9p1qVsuuZBLS1tlFqKB1S7g+e8+2udW8Ie+grb/VXBBIiDm7eeJ1P7hhufu8hrW2vWWEkP31f4iQlApTOAmtN19qzpyebwtgLs5wUNqLlD0oIS1XgCV+DSDBNPcG+QsWNI1YwIXTOA7MBepoDHTa6bduoMEiSdQTHceNWYnlyEcvmFC6iD09pDB7c3y7y1mB+14b4oDG89T5J9NJrFFH6NRRRVGVkjGcp+MSDSuTWWg+Xyp8SOm4tQLr9gATVnWvsV0QDnFbb7azMBNpli550r+LsGOxW/1Hs2Rh1ubGBplOHPA6gx8QQuiFi3bo+eN995fgsTUM3ur+vv1xMwDBW6+6sgWYyKZajomdSHjKOGm4w0f6qp4FAbEZiUD833RfiCBFR1uNH9lZj3lgZ4VmG7vzYqcY2L+ctty+XLQ6qmGxqRPDGKkVxdW6JunrpFCTaZIgv7uWT9btbURNx8sdSCA1TuMq2/T19sQn43nihs0xXFIMk0dWMZ7s44tfG/wW/yDFV+waV5aDM/cahLUVE2XfZ1rSytzo+MvuAANesyCZsL3f1VcVE/xiV8auty2VvdobaoVag/1xMYwYBKFrMyKHNiluJkntZaBJPVcVGFXyyXeOd8yegLClCzTVfG9LVhb4G7vzbKM0wywbiW2FzUBNjD2SMnNdRIcfxy0KnUo8Ps52QKZyzvHLxXnzcCrtN5fgunL1+zrH3tt7XM49yONtwAKWaI78I+7Mw4H79zmXy3qmpr0k2xU2O974Zs8F7tzZTfTGdAFTOv690ol3dRhYF6xs2IvGXfjs4CasEwVJ6VbR/nmqjCi9MZsiLm6yk4E2LiA/woyPhvqipFTzE65Ho38wxdwBujfp6XxQVZb8HGB3A24k2DY3pRp2X0BcFQeffXwXv1F9Ty/qTA3V9F0aAHUz/AbVvPk0cfU7V0ITvNegP7eY9LG01uCuQNqA2wScztVdWLl5KXy7f/snxBMNRsWbvhlrCP4zQpphAxJwH2gfEp7uiGBNhD2eq7sDURFzzG26N+lqbTaMG8AZtMkUX9XFAZ5fJOlst3fQl8LkS8dUwvCkPuLmxZOwd77KXTvPGOFfIX3dBa+GfWu/mZB3fr2QR8TTN6ijiULm8QmiV81ySsOPULHOhEuXyXM1RzWruqsY7NNsQ0ywcK22MvmeJLW5fz+W5LMcpd6xGRbN0DOqDwp8bS57KGGFA417opo5cGON0Z3t2pcvmuBlRe1v5vu7lstqy9qGNoBMkSnHN8QLowxaipRLq1O7VsEj4X9rI8nS6m8DN3f8cTOBPx9ka5fPtl9O4FVLOs/ZoHtaJwU1HL2mfZqR+T1hm581z5UrfMOgIYGlKzeqcGIyLZW76sx0fP4K+iPl7dFRMe83L5Mn1Zwm3Q/oOsa2Oo3Jdfd5/WysfxwcKOoWn25gamjWHlJ5fxrSEtbm/u/LCqjmCoNjrGAmzcpRcS8odhmXPqE52bwNEiy2wJm9V51bYV8g/tPNC6ElBNmVw37OZ0MexG6NO0oNPalay0BDuznw9vXynvbjs7qYoCw82yiiPJEpw9tauNX8+N7TaM6QswXCvCoA0J0ukumT38JIEi7MEkU4z96484/2WvJmnXWJyuvIfaN4KwRpyO6q1RLwPN8SqFvMS1IaY+zo9tD1tUVWS4PSlGQ6pmH8iISHZwEihQO4b3ul+jHygXGuXN6nhL1Ed/fACSRq6e7bb9MjtdfgkrTjMM1kQ+VlW1I7R+2EHXMdTstPY9utpYdmYJWthYUMmiAWz9ANdsXyl/0C6ZfC7rXfOglurjnJAKkYZYk2AyQQKDOEGCBCECYsgajB5aS4+D4xBOVcfLBFabkBcHPZBMgmYdHwnaDnMmAHX8e5awYvsqfjicl/ksXoZqyOSrd2rgUrbYEkJSzIvRppth6wfY29vHHXk2R1vcX5Hsinv17LDE1TPTvMJZThIIxWHEIoEiqohRxFmYrV0WBMWqwdgATAhiIIshm0HjpJlx0oWsdAgzLiGLKpyU7eeDInJVtQ15fl0n3TaHpG2MBtja0Ul6x+q3z/C67SvkC+1gpyaY3IZRfbeNGA7K9Kb1xhR31Z/1P3+OW0qzn4XLp8g3k1wXYvFpY7q8JSPj/K3LZVerY9ruWbRmWftv79NniGG40GXtTZk8nuLvt6+QL7TjEje/F1p3n24qHcftLqV3Zpw0jXEuRTV70ssd+pX30WtWNFsgWKBgavyYDrUlwizjNoBWl810zcJVlzX83WiGG8N+TitsWXs+KK1OYpQbn6CitTJmEsnW79K15SW8rz5O6hwqQiB5rHOk/y22sbDN4W1hH7+6/j59QyPPr3XZ6F2xmLlrM7hbz1bDPaqEZMWVyaMKtj7O9u0rZUOrXYonXRnswlBxSUPJwtsRu+NBGclmeHBGOLeV0+W74iHkJ3yWsSksU6K4Ze0qFhNPMK6uPYPS8sx6lzUy611cuEzv4pOUYLIZXKnCC8vK1a0sly/8g8hP+PVj+qqwh9fGk4W+WHRRH6LK7995rnw37w3Y6rXYuEsvDMq8KT6AE+PBdKx7P5nGYbj+6vv1lJEWdZ0t9sNonvDXPKgllM3IPLWpOiJyOjiKhoDfa0clbp5Z72CzDbFQ0Mz67oilxCVo1M+J9bjZE7EFXWcLDaj8hJ+cYH1poNjZzaJoUEJQPrT9LPnpmhaPoslVve/vZk3Uz8UFHhjXTaAyzeny6zfu1Ze0oly+uIAaUrMD3Ft36UnGcmM6U1yZfLYS9wAPzUgbKnGbmfVrv61lo3xAswJn1ncbpBxqQkKXsKUVMW9hAVUdRkREDbw3GuBUlxRWJkdATYAg3PLpFTLZ6lE0+cC4cD9XRAMsTWeKOTCuSyFl40lc1M+lG0b5zacroxfylJuTAbDMBNyjSkmLKpNDFvRgk0l2Wcf5p55LVmuMAmsNoFRlaBj5zuuphMIeE/LsLEEFD6hWehhBCclivhUFrDppGVPHKqMX8qHkMrkqW4Jygbu/MmcUjfDBdoyiqY402CkQ3hUN8JwCX2h3L0nlXWcHOLOecO3TkdELt0lnpeHd+jpb5n+l0wUOvpUs7MPGB9i5/Vx5Rc6sLWXqg5e4Ywj9ha376nqaahSCqnLAZqz45Aq+O8TRF4IW66Q7OCSt1zm24Br93grsf0uW4GyJD85l1pYytYiqMhz2USnsONOFEUuJpmjUx5LUccuxjhYqFKDmDEn7nVKFFxU6+G4mwGYxf7P1LPlKq0fRzLnEfYkNeUtznKl39dotUBzA2TJv3rhXLzwWGb0wDyif1r7uAT1NDO8tcvdXmgmw6QypCbilHeyUy7dOqdkSAc5f4nbK9bMhxqVsOhYZvTAbNndvzDRDYT8nFLX7a3PRXdSHcTH/846z5Z5WJ8Dmo2027tFfDnp4dTxZ2GHbC5KlkimyqI/V68e47Ghl9EIAanYMzW4935RYV2j3phG8SjzFlIWb2pEAO5tilFEztnHP5Xd6J0P5RlqSCJvetkePXzp85MPbCrBpGx+0qmrV8SEbFt69cWEfRjM+8clV8lA+9aNlh0szxehfx3hj1MeFybRPMeo4SQkmi3GlAZ6TJFx/NF1n5x1QVcWMrJFsYIx1pQEuKnL319lRNOP8KO9iNPKNFrJHM8XoHV/VHoWbXFZwlXNhm4kncRJxzVUP6AtHRLIj6To7v4BqlrUP/n890Qi1Qpe100yALSNkbNr6Inl0DRha2DUnTzEaL7OxNMALM59iNJ+xlGiGhmX6kmk+MhvnH/avFSB2Wj+qv1+ucE19PxmmwE1XykgywwPpcZx7+h8Tt3SaQ7NB5ZXf5Bluhr0m4JlZ6lOMCmBZ0IONJ/jPd54rf324Zjvz9rDye5sNo7rChgzWJ3AUvFhODCJw4/84Q2ZangA7ghERdVO8u1ThlCInAy82gQKHGsNta7+t5aU8tUAxbw9sbr6eLVEqtBDRHEUTT/B/t63gr1rdxWhI1YxUcVeO6ulieVs8Weg7uEUnUKQzuKjCUvvTw5fLz8tDq+psWfsbwj5+NSl2WXuji1FCiuEG2jCKJr+DSx21sI8Bn2JUPIEimcbZgBvetlef81TT5TsPqOZ81qvv135RtmjRlazmJW5W57PbV8o/t+MSd2SNZOv26AVBmct8ilFBBYoEDfs5IUm5+akO1Y4/uDxfr55wbanC87N6ofP1VAIkmWICbd8lLoBk3GIibGEnMHpQmfgAzoRcvmG3nv/z8vw6upFn8/Xu0+eK5d3xdOFjBRf2YlzCH20/V77VrkvcdaP6+rCXVzTZyV/iFhVSitoIqxm3zj0M5w1Qeawgws1RH0uKnK+nipoQE0/wKCEfRlWWtuES95oHtWSUm31yUVdAysaTuLCXV2wY09ceKs+vY4Cak693sS1xWXyg2KexgAt6EHV8dPs58uP80rWlrm9N3NQkG6MKZ3XBvFpvT/BduKl6v0ZPltE79AAPjqFRxxYbYihwwqeCsxEmPsD3evv4WMt77OVdjEb1OCO8Jyt4hoi3OQdtc3hbVGFlpc7gk2X0jgAqn9b+/CVcFvVzQdF7yomitoSIsOVjL5DxlvfYa7JTAO8OB3h25vtEdJWpIOkMaiw3XjWmJ+8AR7PrbPsf4pzTWAw3ubjYPeVUcUEPtj7ONx6f5FOt7rGXCzNrR/V0Y7gmmfKXuN2HJ0yWkIUDPDNVbhARrTa7zrb9Qc6exsq7SgP8QhZ3QcJno+Xz0MiFMt3qFKNcmAmVDwS9DGhKiuBozBU8+pce4YuF9VLFHdGLJ70UVeXw/zH7OsTuABGCeAI1EVdt3HWw62xbmSLv2jN4P78IjCoFntbeCJ6ysA9bn+CuO1fyimPpenNEwsyYvjbq5wsubYzgfMJq6FMD/RBfHhnf6yHevpuVRT3Ex9en+Jn1EH/3MFMeD/f3VEnDHmxSZ+ezz+GVNcjaOmM3n9ae7tJby5XiTmufszHFJWQi3IiI7mvxDNaRasN1dMJDWZ1fS2coY+jVBgdq86E5Y3DqEDENsUIzxFrIHEYUoyAiiIKIYtQi0piYKwLimnkcYnAKKhmq0hz5KTgHKo1z2IltfD37ez9nr9KczWstuOxJEG7+WauEldm1ANQ2+bXx8xz8jNr4OYw2P79FBdSYxvdnihpQNY01V4MzoJk2/o4qztjmr5vvkylqApSk8e/lv84UDRwu/15ncUZRa8im9uPCALdvBGWNaNuYYu60drHsdEWe1t5kp6iCre/nM9tXyeWtTjHytjisTQzVkMmrO9S6jM1hCXEFndbeBFMjxWiSiQxqeb5h+4QPlTXHeLg8cldrWODkSxbJVfJIa97mKVPOhiG/o2wLoJoyebZ+t66Nejk/mSh0NjmAi3qx9f184o9XyUPVHWprbWQnaYgcnv0WoLXe5Xtic/vdNuQ5aYHHVio4GyIu4YeliHNO/ByPtbQS19uispZv8tnRK8p13SCTSyPhUYAPfnyp/HurZXJvnqGO2XKZ/K17OSMUxgovkx8cRfNP39rPRZdcgmvpKBpvnqGejs12f024pXlpWeTKUxUBl+Ks4bq7L5W0UTTmweStAICarTzdrS+3zQnlhRYiFBf2Y7M6n9m6Qr7iZXJvrbAWqXwHs8nFcbsJMC4psIrVqHWSeJLHspAb2i2Te/MMdXTsdDCb/IrSAC9LpwrfPtgFZYxLqf3x2fL9vCzfbwdv8y9KDKkZAh5+E8eXEnabgNOKPANWtVHWnkxzj035pVPPJTvWearevLWcoarDSK0mLprh/aUBnlXwGbBqLOpSUmN5+9bzJMmFFL8VvM07oPKGj1fer0ttyNXxRLFre9ThooYQ8ck7zpaveiHCW6FEibw3WRpzezRAuZliVFhXLyhj6+M8HAV8oHln5uMmb8VgqFmZfFRfH/Xxa0Xv/mpMU8VLufoPz5HHvKvnrTgMNaf7az1hi2tOa5eCXuGqkpUqBPXH+Mi28+QfDjdBwZu3jjLUbPfXmHeWl/CCrPjT2oP6fr72rBLvz3s6+EfvrRCAyjfkhjE9wwa8s8iTIlRxNsKmM/w4s1xeO0tiAO/qeSsMoPLYQzNuDfpYUth8PW1I5AhZUmftp86Rh/Pp6v6xe2uXHRUQ5uTr/acw5H9n8dMTNtr8k6VRL0F9nGu2nyt/sHqnBndfKql/5N6KIUo0hYjBezV0GR+SMoaCVp2qkpYrBDP7+e8eTN4K6fLlQkRm2BBVWFnUfD1V0vISgnicHdtX8I7qDrV3X+LLzb0VyeVr5us9+iaOr8fsMSGnFjFfLwdTfZy/6+nlDR87Ey9CeCseQ1WXNfL1Zuq8NxrgtCLm682CaYIvmpTqx14g9SFfzu6taAw1pGpqgq7fy4sM3IdS0qxAZe2NYSJZuUJQn+Cv90/wWyMXynTjc3tFz1vBGCovC5eUW8IeejQrjkyuDTBpuUIQH+BPTMwbRy6U6aEhDyZvBWSoXCZfv0d/JQj4hywuUPdXJTMB1gSQznDztpXyQYChIW3pYDRv3loDKFUZAtn3DYIlCV8PeliZTBcjxUiVNOwlcAnjLuaqbavks3nHJR8zeSuky5fL5JU6g1GFlUUYWZmPKClXCFzMriTm5dtWyWcbw589mLwVFFD5kLGr79dTbMhQOoOb77hJlSyIMGEZU5/kE489yupPrZLdBzPHPZi8zb8dMlNi3zIEETezS4fLSzgxHp+/WifVRmZ4qYJNp/hemvCO7Svk85ArkL4Mw1uBY6hciBjco+dh+JrLMChCp8d4NuXwICIQA2nMn07HvOcz58kPqzvUjlRx3sXzVniGysd2uIxNYQ+Bm4+ydm0wYnmAIJ7iYU14z7bl8ucAvjjQW9fEUHl5w4ZRXRP28SudLmvPRYewD2ssSTzJR2emeOm25fLnQ6pGVcWDyVt3uHzNMTQ/qdIbp4zZiF9M6x0bQ5OpImEPBoEs5u9dytD2lfLPnpW8dSWg8k27flSvL1XY0m4hQsE156WasLehIWYz3OOU25/g3uFjJW9dFkMNDakZBnflvXqqCu9JplqfEaGKiuAaX2JsiAnKkE5DWufLOD7x4GP8+d2XSppfKnsFz1tXAmrfMkRE3Ppdel2pjxPqEyRNdtLD0cwT6E5mJ5mDzP6pANaGiA2xEkAWQ1bn+3HK3zn4szuXy5fmxnEjIo32yN68dZvLl2dlb9itF9uQL4kBPZpMOJkFE0jj/2KaXwMug3QGNOMRDA+ifBX4R5Py9a3nyf4nupw4f0HrrasZqjbc/MrxRgzfTKdIEEIEg2JVMWLmEJKbZR8ngqriBDKEWGFaYBLlUYUfGeHHqnxP4SGb8fDWlfLo3H+8qmoZgZE1knnRwdvCEiV2qAV45CTkhQNIqYIJHsVMRshUcPD7elO072T0pxnKd6AyjZ7QQ1a7hOyw4oGqrL4Le/JPUH8x683bEYkPKtUdaquqdminBlVVW92hFlXxq+Nt0TBUziBP750843hb3PYfX1rR+sbFxVoAAAAASUVORK5CYII=';
const AZZERA_DOC_BRAND = {
  obsidian: [20, 28, 37],
  white: [255, 255, 255],
  azure: [100, 208, 255],
  grey: [76, 76, 76],
  soft: [244, 248, 251],
  line: [218, 226, 235]
};
function pdfTextValue(value){
  if(value === null || value === undefined || value === '') return '—';
  return String(value).replace(/<[^>]+>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\s+/g,' ').trim();
}
function pdfBrandDocType(type){
  return ({mci:'MAIN COURANTE', mission:'RAPPORT DE MISSION', rounds:'RONDES', alerts:'SOS / PTI', invoice:'FACTURE'}[type] || 'DOCUMENT OPÉRATIONNEL');
}
function pdfDrawLogo(doc, x, y, w, h){
  try { doc.addImage(AZZERA_DOC_LOGO_DATA_URI, 'PNG', x, y, w, h, undefined, 'FAST'); return; } catch(error) {}
  const C = AZZERA_DOC_BRAND;
  doc.setFont('helvetica','bold'); doc.setFontSize(Math.max(18, h)); doc.setTextColor(...C.azure); doc.text('A', x, y + h);
}
function pdfAddFooter(doc){
  const C = AZZERA_DOC_BRAND;
  const pages = doc.getNumberOfPages();
  for(let i=1;i<=pages;i++){
    doc.setPage(i);
    doc.setDrawColor(...C.line); doc.setLineWidth(.2); doc.line(14, 282, 196, 282);
    doc.setTextColor(...C.grey); doc.setFont('helvetica','normal'); doc.setFontSize(7.5);
    doc.text('AZZERA PROTECT · SÉCURITÉ PRIVÉE', 14, 287);
    doc.text(`Page ${i}/${pages}`, 196, 287, {align:'right'});
  }
}
function pdfEnsureSpace(doc, y, needed=20){
  if(y + needed <= 276) return y;
  doc.addPage();
  const C = AZZERA_DOC_BRAND;
  doc.setFillColor(...C.obsidian); doc.rect(0,0,210,12,'F');
  doc.setFillColor(...C.azure); doc.rect(14,11.6,182,.8,'F');
  return 22;
}
function pdfWrapped(doc, text, x, y, width, lineHeight=4.7, opts={}){
  const lines = doc.splitTextToSize(pdfTextValue(text), width);
  for(const line of lines){
    y = pdfEnsureSpace(doc, y, lineHeight + 2);
    doc.text(line, x, y, opts); y += lineHeight;
  }
  return y;
}
function pdfSectionTitle(doc, title, y){
  const C = AZZERA_DOC_BRAND;
  y = pdfEnsureSpace(doc, y, 14);
  doc.setFillColor(...C.azure); doc.rect(14, y-4, 3, 8, 'F');
  doc.setTextColor(...C.obsidian); doc.setFont('helvetica','bold'); doc.setFontSize(12);
  doc.text(String(title).toUpperCase(), 21, y+1);
  return y + 9;
}
function pdfInfoPanel(doc, items, y){
  const C = AZZERA_DOC_BRAND;
  y = pdfEnsureSpace(doc, y, 28);
  doc.setFillColor(248,250,252); doc.setDrawColor(...C.line); doc.roundedRect(14, y, 182, 24, 2.5, 2.5, 'FD');
  let x = 18;
  const colW = 58;
  items.slice(0,3).forEach((it, idx) => {
    doc.setFont('helvetica','normal'); doc.setFontSize(7); doc.setTextColor(...C.grey);
    doc.text(String(it.label || '').toUpperCase(), x, y+7);
    doc.setFont('helvetica','bold'); doc.setFontSize(9.2); doc.setTextColor(...C.obsidian);
    const lines = doc.splitTextToSize(pdfTextValue(it.value), colW-4).slice(0,2);
    doc.text(lines, x, y+13);
    if(idx<2){ doc.setDrawColor(225,231,238); doc.line(x+colW-5, y+5, x+colW-5, y+19); }
    x += colW;
  });
  return y + 34;
}
function pdfMetricCards(doc, cards, y){
  const C = AZZERA_DOC_BRAND;
  const w = 43.25, gap = 3;
  y = pdfEnsureSpace(doc, y, 26);
  cards.slice(0,4).forEach((card, i) => {
    const x = 14 + i*(w+gap);
    doc.setFillColor(...C.obsidian); doc.roundedRect(x, y, w, 22, 2.5, 2.5, 'F');
    doc.setFillColor(...C.azure); doc.rect(x, y, w, 2, 'F');
    doc.setTextColor(...C.white); doc.setFont('helvetica','bold'); doc.setFontSize(12);
    doc.text(pdfTextValue(card.value), x+3, y+11);
    doc.setTextColor(205,216,226); doc.setFont('helvetica','normal'); doc.setFontSize(6.6);
    doc.text(String(card.label || '').toUpperCase(), x+3, y+17);
  });
  return y + 31;
}
function pdfDrawTable(doc, headers, rows, widths, y, rowMapper){
  const C = AZZERA_DOC_BRAND;
  const x0 = 14;
  const drawHeader = () => {
    y = pdfEnsureSpace(doc, y, 12);
    doc.setFillColor(...C.obsidian); doc.roundedRect(x0, y, widths.reduce((a,b)=>a+b,0), 9, 1.5, 1.5, 'F');
    let x=x0;
    headers.forEach((h,i)=>{ doc.setTextColor(...C.white); doc.setFont('helvetica','bold'); doc.setFontSize(6.8); doc.text(String(h).toUpperCase(), x+2, y+6); x+=widths[i]; });
    y += 10;
  };
  drawHeader();
  if(!rows.length){
    doc.setFont('helvetica','normal'); doc.setTextColor(...C.grey); doc.setFontSize(9);
    return pdfWrapped(doc, 'Aucune donnée disponible pour ce document.', x0, y+5, 180, 5) + 3;
  }
  rows.forEach((row, idx) => {
    const cells = rowMapper(row, idx).map(pdfTextValue);
    doc.setFont('helvetica','normal'); doc.setFontSize(7.2);
    const split = cells.map((c,i)=>doc.splitTextToSize(c, widths[i]-4));
    const rowH = Math.max(8, ...split.map(lines=>lines.length*3.8 + 4));
    if(y + rowH > 276){ doc.addPage(); y = 22; drawHeader(); }
    doc.setFillColor(idx%2 ? 255 : 248, idx%2 ? 255 : 250, idx%2 ? 255 : 252);
    doc.rect(x0, y, widths.reduce((a,b)=>a+b,0), rowH, 'F');
    let x=x0;
    split.forEach((lines,i)=>{
      doc.setDrawColor(232,237,243); doc.rect(x, y, widths[i], rowH);
      doc.setTextColor(i === 0 ? 20 : 47, i === 0 ? 28 : 55, i === 0 ? 37 : 69);
      if(i === 3 || i === 4) doc.setFont('helvetica','bold'); else doc.setFont('helvetica','normal');
      doc.text(lines, x+2, y+4.8);
      x += widths[i];
    });
    y += rowH;
  });
  return y + 4;
}

function reportHasPhoto(report){
  return Boolean(report?.photoUrl || report?.photoStoragePath || report?.photoAvailable);
}
function reportHasEmbeddablePdfPhoto(report){
  return Boolean(report?.photoUrl && String(report.photoUrl).startsWith('data:image/'));
}
function reportPhotoLabel(report){
  return reportHasPhoto(report) ? 'Photo jointe' : '—';
}
async function imageUrlToDataUrl(url){
  const value=String(url||'');
  if(!value || value.startsWith('data:image/')) return value;
  const response=await fetch(value,{cache:'no-store'});
  if(!response.ok) throw new Error(`Photo indisponible (${response.status})`);
  const blob=await response.blob();
  return await new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onload=()=>resolve(String(reader.result||''));
    reader.onerror=()=>reject(new Error('Conversion de la photo impossible.'));
    reader.readAsDataURL(blob);
  });
}
async function prepareGeneratedDocumentPhotos(d){
  const p=d?.payload||{};
  const rows=Array.isArray(p.rows)?p.rows:[];
  if(!rows.length) return d;
  const preparedRows=await Promise.all(rows.map(async row=>{
    if(!row?.photoUrl || String(row.photoUrl).startsWith('data:image/')) return row;
    try { return {...row,photoUrl:await imageUrlToDataUrl(row.photoUrl)}; }
    catch(error){ console.warn('Photo PDF non convertie',error); return row; }
  }));
  const byId=new Map(preparedRows.map(row=>[String(row.id||''),row]));
  const timelineRows=Array.isArray(p.timelineRows)?p.timelineRows.map(row=>{
    const hit=byId.get(String(row?.id||''));
    return hit ? {...row,photoUrl:hit.photoUrl,photoAvailable:hit.photoAvailable,photoStorageBucket:hit.photoStorageBucket,photoStoragePath:hit.photoStoragePath} : row;
  }):p.timelineRows;
  return {...d,payload:{...p,rows:preparedRows,...(timelineRows?{timelineRows}:{})}};
}
function pdfImageFormat(dataUrl){
  return String(dataUrl||'').startsWith('data:image/png') ? 'PNG' : 'JPEG';
}
function pdfPhotoMetaLines(report, index){
  const gps = report?.gps;
  const lat = Number(gps?.latitude ?? gps?.lat);
  const lng = Number(gps?.longitude ?? gps?.lng);
  const gpsText = Number.isFinite(lat) && Number.isFinite(lng) ? `${lat.toFixed(6)}, ${lng.toFixed(6)}` : 'Non renseigné';
  return [
    `Photo ${index + 1} · Rapport ${report?.id || '—'}`,
    `Date et heure : ${dateText(report?.photoCapturedAt || report?.createdAt)}`,
    `Agent : ${report?.agentNom || '—'} · Site : ${report?.siteNom || '—'}`,
    `Catégorie : ${report?.category || '—'} · Gravité : ${report?.severity || '—'}`,
    `GPS : ${gpsText}`
  ];
}
function pdfDrawPhotoAnnexes(doc, reports){
  const C = AZZERA_DOC_BRAND;
  const photos = (reports||[]).filter(reportHasEmbeddablePdfPhoto);
  if(!photos.length) return;
  photos.forEach((report,index)=>{
    doc.addPage();
    doc.setFillColor(...C.obsidian); doc.rect(0,0,210,30,'F');
    pdfDrawLogo(doc,14,6,16,16);
    doc.setTextColor(...C.white); doc.setFont('helvetica','bold'); doc.setFontSize(12);
    doc.text('ANNEXES PHOTOGRAPHIQUES', 36, 14);
    doc.setTextColor(...C.azure); doc.setFontSize(7.5);
    doc.text(`PIÈCE ${index+1} / ${photos.length}`, 196, 14, {align:'right'});

    const maxW=178, maxH=162, x=16, y=38;
    let iw=Number(report.photoWidth||0), ih=Number(report.photoHeight||0);
    if(!(iw>0 && ih>0)){ iw=4; ih=3; }
    const ratio=Math.min(maxW/iw,maxH/ih);
    const w=iw*ratio, h=ih*ratio;
    const ix=x+(maxW-w)/2;
    doc.setFillColor(245,248,251); doc.roundedRect(x,y,maxW,maxH,3,3,'F');
    try { doc.addImage(report.photoUrl,pdfImageFormat(report.photoUrl),ix,y+(maxH-h)/2,w,h,undefined,'FAST'); }
    catch(error){
      console.error('Photo PDF impossible',error);
      doc.setTextColor(...C.grey); doc.setFont('helvetica','normal'); doc.setFontSize(9);
      doc.text('La photo n’a pas pu être incorporée au PDF.',105,y+maxH/2,{align:'center'});
    }
    let my=209;
    doc.setTextColor(...C.obsidian); doc.setFont('helvetica','bold'); doc.setFontSize(10);
    doc.text(`Rapport photographique n° ${report.id || index+1}`,16,my); my+=7;
    doc.setFont('helvetica','normal'); doc.setFontSize(8.2); doc.setTextColor(...C.grey);
    pdfPhotoMetaLines(report,index).slice(1).forEach(line=>{ doc.text(pdfTextValue(line),16,my); my+=5; });
    const message=doc.splitTextToSize(`Observation : ${report.message || '—'}`,178);
    doc.text(message,16,my); 
  });
}
function pdfDocumentTitle(d){ return pdfTextValue(d.title || documentTypeLabel(d.type)); }
function pdfMissionPayload(d){ const p=d?.payload||{}; const rows=p.rows||[]; return { mission:p.mission||{}, shift:p.shift||{}, rows, timelineRows:p.timelineRows||buildMissionTimeline({mission:p.mission||{},shift:p.shift||{},reports:rows}) }; }
function createGeneratedDocumentPdf(d){
  const jsPDF = getJsPDF();
  if(!jsPDF) throw new Error('Bibliothèque PDF indisponible. Vérifie ta connexion ou réessaie.');
  const C = AZZERA_DOC_BRAND;
  const doc = new jsPDF({ unit:'mm', format:'a4', orientation:'portrait' });
  doc.setProperties({ title: pdfDocumentTitle(d), subject: pdfBrandDocType(d.type), author:'AZZERA PROTECT · Sentinelle Pro' });

  doc.setFillColor(...C.obsidian); doc.rect(0,0,210,46,'F');
  doc.setFillColor(...C.azure); doc.rect(14,43,182,1.2,'F');
  pdfDrawLogo(doc, 14, 8, 18, 18);
  doc.setTextColor(...C.white); doc.setFont('helvetica','bold'); doc.setFontSize(13.5);
  doc.text('AZZERA PROTECT', 37, 16);
  doc.setFontSize(7.6); doc.setFont('helvetica','bold'); doc.setCharSpace(.7);
  doc.text('SÉCURITÉ PRIVÉE', 37, 22);
  doc.setCharSpace(0);
  doc.setFont('helvetica','normal'); doc.setFontSize(7.2); doc.setTextColor(205,216,226);
  doc.text('On s’occupe du risque. Vous du reste.', 37, 29);
  doc.setFont('helvetica','bold'); doc.setFontSize(7.4); doc.setTextColor(...C.azure);
  doc.text(pdfBrandDocType(d.type), 196, 17, { align:'right' });
  doc.setTextColor(205,216,226); doc.setFont('helvetica','normal'); doc.setFontSize(7.2);
  doc.text(`Généré le ${new Date().toLocaleString('fr-FR')}`, 196, 24, { align:'right' });

  let y = 58;
  doc.setTextColor(...C.obsidian); doc.setFont('helvetica','bold'); doc.setFontSize(18);
  y = pdfWrapped(doc, pdfDocumentTitle(d), 14, y, 178, 7.5) + 2;
  doc.setDrawColor(...C.azure); doc.setLineWidth(.6); doc.line(14, y, 72, y); y += 8;

  const rows = generatedDocumentRows(d);
  const metaLines = generatedDocumentMeta(d);
  const metaItems = [
    {label:'Type', value:documentTypeLabel(d.type)},
    {label:'Site', value:d.siteNom || 'Tous sites'},
    {label:'Volume', value:`${d.rowCount || rows.length || 0} ligne(s)`}
  ];
  y = pdfInfoPanel(doc, metaItems, y);

  if(d.type === 'mission'){
    const {mission, shift, rows:missionRows, timelineRows} = pdfMissionPayload(d);
    y = pdfMetricCards(doc, [
      {label:'Rapports', value:missionRows.length},
      {label:'Rondes', value:shift.roundsCount || mission.roundsCount || 0},
      {label:'Événements', value:shift.incidentsCount || mission.incidentsCount || 0},
      {label:'Conformité', value:(shift.conformityScore ?? mission.conformityScore ?? '—') + '%'}
    ], y);
    y = pdfSectionTitle(doc, 'Informations mission', y);
    doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(...C.grey);
    metaLines.forEach(line => { y = pdfWrapped(doc, line, 18, y, 174, 4.8); });
    y += 3;
    y = pdfSectionTitle(doc, 'Main courante de mission', y);
    y = pdfDrawTable(doc, ['Heure','Agent','Événement','Gravité','Photo','Observation'], timelineRows, [27,29,25,21,20,60], y, r=>[dateText(r.createdAt), r.agentNom || mission.agentNom, r.category, r.severity, reportPhotoLabel(r), r.message]);
    y = pdfSectionTitle(doc, 'Relève et signature', y);
    doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(...C.grey);
    y = pdfWrapped(doc, `Signature agent : ${shift.signatureName || '—'}`, 18, y, 174, 5);
    y = pdfWrapped(doc, `Note de relève : ${shift.handoverNote || 'RAS'}`, 18, y, 174, 5);
  } else if(d.type === 'invoice'){
    const inv = d.payload?.invoice || d.payload || {};
    const profile = d.payload?.profile || {};
    const l61214 = profile.securityLegalNotice || "L’autorisation d’exercice ne confère aucune prérogative de puissance publique à l’entreprise ou aux personnes qui en bénéficient.";
    y = pdfMetricCards(doc, [
      {label:'Total HT', value:money(inv.subtotal || 0)},
      {label:'TVA', value:money(inv.vatAmount || 0)},
      {label:'Total TTC', value:money(inv.total || 0)},
      {label:'Statut', value:invoiceStatusLabel(inv.status || 'draft')}
    ], y);
    y = pdfSectionTitle(doc, 'Émetteur et client', y);
    doc.setFont('helvetica','normal'); doc.setFontSize(8.2); doc.setTextColor(...C.grey);
    const issuer = [
      profile.companyName || 'Entreprise',
      [profile.legalForm, profile.shareCapital ? `capital ${profile.shareCapital} €` : '', profile.rcsCity].filter(Boolean).join(' · '),
      [profile.address, profile.postalCode, profile.city].filter(Boolean).join(' '),
      [profile.siren ? `SIREN ${profile.siren}` : '', profile.siret ? `SIRET ${profile.siret}` : '', profile.vatNumber ? `TVA ${profile.vatNumber}` : ''].filter(Boolean).join(' · ')
    ].filter(Boolean).join(' — ');
    const client = [
      inv.clientName || inv.siteNom || 'Client',
      inv.billingAddress || 'Adresse non renseignée',
      [inv.clientSiren ? `SIREN ${inv.clientSiren}` : '', inv.clientVatNumber ? `TVA ${inv.clientVatNumber}` : ''].filter(Boolean).join(' · '),
      inv.serviceAddress ? `Lieu de prestation : ${inv.serviceAddress}` : ''
    ].filter(Boolean).join(' — ');
    y = pdfWrapped(doc, `Émetteur : ${issuer}`, 18, y, 174, 4.4);
    y = pdfWrapped(doc, `Client : ${client}`, 18, y, 174, 4.4);
    y = pdfWrapped(doc, `Nature : ${inv.operationCategory || 'Prestation de services de sécurité privée'} · Période : ${dateOnlyText(inv.periodStart)} au ${dateOnlyText(inv.periodEnd)}${inv.clientReference ? ` · Référence : ${inv.clientReference}` : ''}`, 18, y, 174, 4.4);
    y += 3;
    y = pdfSectionTitle(doc, 'Lignes facturées', y);
    y = pdfDrawTable(doc, ['Désignation','Qté','PU HT','Total HT'], inv.lines || rows, [100,20,30,32], y, l=>[l.description, `${l.quantity || 0} ${l.unit || ''}`, money(l.unitPrice || 0), money(l.amount || 0)]);
    y += 2; y = pdfEnsureSpace(doc, y, 28);
    doc.setFillColor(...C.obsidian); doc.roundedRect(120, y, 76, 24, 3, 3, 'F');
    doc.setTextColor(...C.white); doc.setFont('helvetica','bold'); doc.setFontSize(9); doc.text('TOTAL TTC', 126, y+8);
    doc.setTextColor(...C.azure); doc.setFontSize(15); doc.text(money(inv.total || 0), 190, y+17, {align:'right'});
    y += 31;
    y = pdfSectionTitle(doc, 'Conditions de règlement', y);
    doc.setFont('helvetica','normal'); doc.setFontSize(8.1); doc.setTextColor(...C.grey);
    y = pdfWrapped(doc, `Mode : ${profile.paymentMethod || 'Virement bancaire'}${profile.iban ? ` · IBAN ${profile.iban}` : ''}${profile.bic ? ` · BIC ${profile.bic}` : ''}`, 18, y, 174, 4.4);
    y = pdfWrapped(doc, `Échéance : ${dateOnlyText(inv.dueDate)}. ${profile.earlyPaymentDiscount || 'Aucun escompte accordé pour paiement anticipé.'}`, 18, y, 174, 4.4);
    y = pdfWrapped(doc, profile.latePenaltyText || 'Pénalités de retard exigibles dès le lendemain de la date d’échéance.', 18, y, 174, 4.4);
    y = pdfWrapped(doc, 'Indemnité forfaitaire pour frais de recouvrement en cas de retard : 40 €.', 18, y, 174, 4.4);
    if(profile.legalNotice) y = pdfWrapped(doc, profile.legalNotice, 18, y, 174, 4.4);
    y += 3;
    y = pdfSectionTitle(doc, 'Sécurité privée — CNAPS', y);
    doc.setFont('helvetica','normal'); doc.setFontSize(8.1); doc.setTextColor(...C.grey);
    y = pdfWrapped(doc, `Autorisation d’exercice CNAPS : ${profile.cnapsAuthorization || 'Non renseignée'}`, 18, y, 174, 4.4);
    if(profile.securityActivity) y = pdfWrapped(doc, `Activité autorisée : ${profile.securityActivity}`, 18, y, 174, 4.4);
    y = pdfWrapped(doc, `Art. L612-14 du CSI : ${l61214}`, 18, y, 174, 4.4);
    if(profile.additionalLegalNotice) y = pdfWrapped(doc, profile.additionalLegalNotice, 18, y, 174, 4.4);
  } else {
    y = pdfMetricCards(doc, [
      {label:'Lignes', value:d.rowCount || rows.length || 0},
      {label:'Site', value:d.siteNom ? '1' : 'Tous'},
      {label:'Source', value:'QG'},
      {label:'Format', value:'PDF'}
    ], y);
    y = pdfSectionTitle(doc, 'Synthèse', y);
    doc.setFont('helvetica','normal'); doc.setFontSize(9); doc.setTextColor(...C.grey);
    generatedDocumentMeta(d).forEach(line => { y = pdfWrapped(doc, line, 18, y, 174, 4.8); });
    y += 3;
    y = pdfSectionTitle(doc, documentTypeLabel(d.type), y);
    if(d.type === 'mci') y = pdfDrawTable(doc, ['Date','Agent','Site','Gravité','Photo','Message'], rows, [27,28,28,21,20,58], y, r=>[dateText(r.createdAt), r.agentNom, r.siteNom, r.severity || r.category, reportPhotoLabel(r), r.message]);
    else if(d.type === 'rounds') y = pdfDrawTable(doc, ['Date','Agent','Site','Point','État'], rows, [30,32,32,58,30], y, r=>[dateText(r.scannedAt), r.agentNom, r.siteNom, r.checkpointName, r.isValid === false ? 'Refusé' : 'Validé']);
    else y = pdfDrawTable(doc, ['Date','Agent','Site','Statut','Message'], rows, [30,32,32,24,64], y, r=>[dateText(r.createdAt), r.agentNom, r.siteNom, r.statut || r.niveau, r.message]);
  }
  if(d.type === 'mission') pdfDrawPhotoAnnexes(doc, pdfMissionPayload(d).rows);
  else if(d.type === 'mci') pdfDrawPhotoAnnexes(doc, rows);
  pdfAddFooter(doc);
  return doc;
}
function azzeraDocHtmlTable(headers, rows, mapper){
  const body = rows.map((r,i)=>`<tr>${mapper(r,i).map(c=>`<td>${safe(c)}</td>`).join('')}</tr>`).join('');
  return `<table><thead><tr>${headers.map(h=>`<th>${safe(h)}</th>`).join('')}</tr></thead><tbody>${body || `<tr><td colspan="${headers.length}">Aucune donnée.</td></tr>`}</tbody></table>`;
}

function photoAnnexesHtml(reports=[]){
  const photos=reports.filter(reportHasPhoto);
  if(!photos.length) return '';
  return `<section class="azza-photo-annexes"><h3>Annexes photographiques</h3>${photos.map((r,i)=>`<article class="azza-photo-proof"><img src="${safe(r.photoUrl)}" alt="Photo du rapport ${i+1}"><div><strong>Photo ${i+1} · Rapport ${safe(r.id||'—')}</strong><p>${safe(dateText(r.photoCapturedAt||r.createdAt))} · ${safe(r.agentNom||'—')} · ${safe(r.siteNom||'—')}<br>${safe(r.category||'—')} · ${safe(r.severity||'—')}<br>${safe(r.message||'')}</p></div></article>`).join('')}</section>`;
}
function missionReportHtml({ mission, shift={}, reports=[], timelineRows=null }){
  const logo = new URL('./assets/logo.png', location.href).href;
  const orderedRows = timelineRows || buildMissionTimeline({ mission, shift, reports });
  const metrics = [
    ['Rapports', reports.length],
    ['Rondes', shift.roundsCount || mission.roundsCount || 0],
    ['Événements', shift.incidentsCount || mission.incidentsCount || 0],
    ['Conformité', (shift.conformityScore ?? mission.conformityScore ?? '—') + '%']
  ];
  return `<article class="report-doc azzera-doc"><header class="azza-header"><div class="azza-brand"><img src="${logo}" alt="Azzera Protect"><div><strong>AZZERA PROTECT</strong><span>SÉCURITÉ PRIVÉE</span></div></div><div class="azza-doc-type">RAPPORT DE MISSION<br><small>${new Date().toLocaleString('fr-FR')}</small></div></header><section class="azza-hero"><p>On s’occupe du risque. Vous du reste.</p><h1>Rapport opérationnel de sécurité</h1><div class="azza-accent"></div></section><section class="azza-meta"><div><span>Site</span><strong>${safe(mission.siteNom || shift.siteNom || '—')}</strong></div><div><span>Agent</span><strong>${safe(mission.agentNom || shift.agentNom || '—')}</strong></div><div><span>Type de mission</span><strong>${safe(missionDisplayType(mission, shift))}</strong></div></section><section class="azza-text"><p><strong>Horaires prévus :</strong> ${safe(missionPlannedText(mission, shift))}<br><strong>Horaires réalisés :</strong> ${dateText(shift.startTime)} → ${dateText(shift.completedAt)}</p></section><section class="report-grid azza-grid">${metrics.map(m=>`<div><strong>${safe(m[1])}</strong><span>${safe(m[0])}</span></div>`).join('')}</section><section><h3>Main courante de mission</h3>${azzeraDocHtmlTable(['Heure','Agent','Événement','Gravité','Photo','Observation'], orderedRows, r=>[dateText(r.createdAt), r.agentNom || mission.agentNom, r.category, r.severity, reportPhotoLabel(r), r.message])}</section>${photoAnnexesHtml(reports)}<section class="report-signature azza-signature"><strong>Signature agent :</strong> ${safe(shift.signatureName || '—')}<br><strong>Note de relève :</strong> ${safe(shift.handoverNote || 'RAS')}</section><footer>Document généré automatiquement par Sentinelle Pro · AZZERA PROTECT</footer></article>`;
}
function generatedDocumentHtml(d){
  const p=d?.payload||{};
  if(d.type==='mission') return missionReportHtml({mission:p.mission||{},shift:p.shift||{},reports:p.rows||[],timelineRows:p.timelineRows||null});
  if(d.type==='invoice') return invoiceHtml(p.invoice||p||{}, p.profile||{});
  const logo=new URL('./assets/logo.png',location.href).href;
  const rows=generatedDocumentRows(d);
  let headers=[], mapper;
  if(d.type==='mci'){ headers=['Date','Agent','Site','Catégorie','Gravité','Photo','Message']; mapper=r=>[dateText(r.createdAt),r.agentNom,r.siteNom,r.category,r.severity,reportPhotoLabel(r),r.message]; }
  else if(d.type==='rounds'){ headers=['Date','Agent','Site','Point','Méthode','Validité']; mapper=r=>[dateText(r.scannedAt),r.agentNom,r.siteNom,r.checkpointName,r.scanMethod,r.isValid?'Valide':'Refusé']; }
  else { headers=['Date','Agent','Site','Alerte','Statut','Message']; mapper=r=>[dateText(r.createdAt),r.agentNom,r.siteNom,r.typeAlerte,r.statut,r.message]; }
  return `<article class="report-doc azzera-doc"><header class="azza-header"><div class="azza-brand"><img src="${logo}" alt="Azzera Protect"><div><strong>AZZERA PROTECT</strong><span>SÉCURITÉ PRIVÉE</span></div></div><div class="azza-doc-type">${safe(pdfBrandDocType(d.type))}<br><small>${dateText(d.createdAt)}</small></div></header><section class="azza-hero"><p>On s’occupe du risque. Vous du reste.</p><h1>${safe(d.title||documentTypeLabel(d.type))}</h1><div class="azza-accent"></div></section><section class="azza-meta"><div><span>Type</span><strong>${safe(documentTypeLabel(d.type))}</strong></div><div><span>Site</span><strong>${safe(d.siteNom||'Tous sites')}</strong></div><div><span>Volume</span><strong>${d.rowCount||rows.length} ligne(s)</strong></div></section>${p.truncated?'<section class="azza-warning">Aperçu limité aux 350 premières lignes. Le volume total reste enregistré.</section>':''}<section><h3>Contenu du document</h3>${azzeraDocHtmlTable(headers, rows, mapper)}</section>${d.type==='mci'?photoAnnexesHtml(rows):''}<footer>Document généré automatiquement par Sentinelle Pro · AZZERA PROTECT</footer></article>`;
}
