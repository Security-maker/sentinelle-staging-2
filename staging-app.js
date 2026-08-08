import { firebaseConfig } from './firebase-config.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  getAuth,
  setPersistence,
  browserSessionPersistence,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  getIdToken,
  getIdTokenResult
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {
  getFirestore,
  doc,
  getDoc
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';

const SUPABASE = Object.freeze({
  url: 'https://ksoyqtsrhtsfbwmxipqz.supabase.co',
  publishableKey: 'sb_publishable_TaSZX6F0nsEecsHPxjZ8hg_c1cZtQuN',
  organizationId: '43b09366-de36-5b44-97cc-d549eb0d4e53',
  projectRef: 'ksoyqtsrhtsfbwmxipqz'
});

const EXPECTED_COUNTS = Object.freeze({
  organizations: 1,
  profiles: 8,
  sites: 3,
  missions: 67,
  shifts: 29,
  reports: 176,
  generated_documents: 48,
  alerts: 1,
  flash_messages: 3,
  flash_message_reads: 12,
  push_tokens: 13,
  qg_notification_states: 1,
  shift_proofs: 24,
  security_intel_logs: 47,
  billing_settings: 1,
  audit_logs: 578
});

const TOTAL_EXPECTED = Object.values(EXPECTED_COUNTS).reduce((sum, value) => sum + value, 0);
const TEST_UID_PREFIX = 'staging-write-test-';

const $ = (selector) => document.querySelector(selector);
const authStatus = $('#auth-status');
const authMessage = $('#auth-message');
const loginForm = $('#login-form');
const loginButton = $('#login-button');
const sessionPanel = $('#session-panel');
const sessionAccount = $('#session-account');
const logoutButton = $('#logout-button');
const auditCard = $('#audit-card');
const auditStatus = $('#audit-status');
const auditMessage = $('#audit-message');
const auditButton = $('#audit-button');
const summary = $('#summary');
const countsZone = $('#counts-zone');
const countsBody = $('#counts-body');
const writeCard = $('#write-card');
const writeStatus = $('#write-status');
const writeMessage = $('#write-message');
const writeButton = $('#write-button');
const writeResults = $('#write-results');
const securityCard = $('#security-card');
const securityStatus = $('#security-status');
const securityMessage = $('#security-message');
const securityButton = $('#security-button');
const securityResults = $('#security-results');

let currentUser = null;
let currentFirebaseProfile = null;
let lastAuditSucceeded = false;

function setStatus(element, label, kind = 'neutral') {
  element.textContent = label;
  element.className = `status ${kind}`;
}

function setMessage(element, label = '', kind = '') {
  element.textContent = label;
  element.className = `message${kind ? ` ${kind}` : ''}`;
}

function safeText(value) { return String(value ?? '—'); }
function escapeHtml(value) {
  return safeText(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function readableError(error) {
  const code = String(error?.code || '');
  if (code.includes('invalid-credential') || code.includes('wrong-password')) return 'Adresse e-mail ou mot de passe incorrect.';
  if (code.includes('too-many-requests')) return 'Trop de tentatives. Patiente quelques minutes avant de recommencer.';
  if (code.includes('network-request-failed')) return 'Connexion réseau indisponible.';
  return error?.message || String(error || 'Erreur inconnue');
}

function supabaseHeaders(token, extra = {}) {
  return {
    apikey: SUPABASE.publishableKey,
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    ...extra
  };
}

async function loadFirebaseProfile(user) {
  const snapshot = await getDoc(doc(db, 'users', user.uid));
  if (!snapshot.exists()) throw new Error('Le compte existe dans Firebase Auth mais aucun profil Firestore users/{uid} n’a été trouvé.');
  return { uid: user.uid, ...snapshot.data() };
}

async function readSupabaseProfile(token, uid) {
  const filter = encodeURIComponent(uid);
  const response = await fetch(`${SUPABASE.url}/rest/v1/profiles?select=id,external_uid,organization_id,role,active&external_uid=eq.${filter}`, {
    method: 'GET', headers: supabaseHeaders(token)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Profil Supabase inaccessible (${response.status}) : ${JSON.stringify(payload)}`);
  if (!Array.isArray(payload) || payload.length !== 1) throw new Error(`Nombre de profils Supabase inattendu : ${Array.isArray(payload) ? payload.length : 'réponse invalide'}.`);
  return { status: response.status, profile: payload[0] };
}

function parseContentRange(value) {
  const match = String(value || '').match(/\/(\d+|\*)$/);
  if (!match || match[1] === '*') return null;
  const total = Number(match[1]);
  return Number.isFinite(total) ? total : null;
}

async function countVisibleRows(token, table) {
  const response = await fetch(`${SUPABASE.url}/rest/v1/${encodeURIComponent(table)}?select=id&limit=1`, {
    method: 'GET',
    headers: supabaseHeaders(token, { Prefer: 'count=exact', Range: '0-0' })
  });
  const text = await response.text();
  if (!response.ok) return { table, ok:false, status:response.status, count:null, error:text.slice(0,220) };
  let count = parseContentRange(response.headers.get('content-range'));
  if (count === null) {
    try { const data = JSON.parse(text); count = Array.isArray(data) ? data.length : null; } catch (_) { count = null; }
  }
  return { table, ok:true, status:response.status, count, error:null };
}

function renderSummary(items) {
  summary.innerHTML = items.map((item) => `
    <div class="summary-item ${item.good ? 'good' : 'bad'}">
      <span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.value)}</strong>
    </div>`).join('');
  summary.classList.remove('hidden');
}

function renderCounts(rows) {
  countsBody.innerHTML = rows.map((row) => {
    const expected = EXPECTED_COUNTS[row.table];
    let state = 'Lecture impossible', className = 'state-error';
    if (row.ok && row.count === expected) { state = 'Conforme'; className = 'state-ok'; }
    else if (row.ok) { state = 'Différent / RLS'; className = 'state-info'; }
    return `<tr><td><code>${escapeHtml(row.table)}</code></td><td>${row.count === null ? '—' : escapeHtml(row.count)}</td><td>${escapeHtml(expected)}</td><td class="${className}" title="${escapeHtml(row.error || '')}">${escapeHtml(state)}</td></tr>`;
  }).join('');
  countsZone.classList.remove('hidden');
}

function canRunWriteTest() {
  const role = String(currentFirebaseProfile?.role || '');
  return Boolean(currentUser && lastAuditSucceeded && ['admin','superviseur'].includes(role));
}

function canRunAgentSecurityTest() {
  const role = String(currentFirebaseProfile?.role || '');
  return Boolean(currentUser && lastAuditSucceeded && role === 'agent');
}

function refreshSecurityAvailability() {
  const allowed = canRunAgentSecurityTest();
  securityCard.setAttribute('aria-disabled', allowed ? 'false' : 'true');
  securityButton.disabled = !allowed;
  if (!currentUser) {
    setStatus(securityStatus, 'En attente', 'neutral');
    setMessage(securityMessage, 'Connecte un compte agent pour activer ce test.');
  } else if (String(currentFirebaseProfile?.role || '') !== 'agent') {
    setStatus(securityStatus, 'Agent requis', 'warning');
    setMessage(securityMessage, 'Cette sonde est volontairement réservée à un compte agent.', 'warning');
  } else if (!lastAuditSucceeded) {
    setStatus(securityStatus, 'Audit requis', 'neutral');
    setMessage(securityMessage, 'Lance d’abord le contrôle de lecture Supabase avec ce compte agent.');
  } else {
    setStatus(securityStatus, 'Prêt', 'success');
    setMessage(securityMessage, 'Le test RLS Agent peut être lancé. Les écritures de sonde sont automatiquement annulées.', 'success');
  }
}

function refreshWriteAvailability() {
  const allowed = canRunWriteTest();
  writeCard.setAttribute('aria-disabled', allowed ? 'false' : 'true');
  writeButton.disabled = !allowed;
  if (!currentUser) {
    setStatus(writeStatus, 'En attente', 'neutral');
    setMessage(writeMessage, 'Connecte un compte QG pour activer ce test.');
  } else if (!['admin','superviseur'].includes(String(currentFirebaseProfile?.role || ''))) {
    setStatus(writeStatus, 'QG requis', 'warning');
    setMessage(writeMessage, 'Ce test est volontairement bloqué pour les comptes agent.', 'warning');
  } else if (!lastAuditSucceeded) {
    setStatus(writeStatus, 'Audit requis', 'neutral');
    setMessage(writeMessage, 'Lance d’abord le contrôle de lecture Supabase avec ce compte QG.');
  } else {
    setStatus(writeStatus, 'Prêt', 'success');
    setMessage(writeMessage, 'Le test temporaire peut être lancé. Aucune donnée Firebase ne sera modifiée.', 'success');
  }
  refreshSecurityAvailability();
}

async function runAudit() {
  if (!currentUser || !currentFirebaseProfile) return;
  lastAuditSucceeded = false;
  refreshWriteAvailability();
  auditButton.disabled = true;
  setStatus(auditStatus, 'Contrôle en cours', 'warning');
  setMessage(auditMessage, 'Renouvellement du jeton Firebase et interrogation de Supabase…');
  summary.classList.add('hidden');
  countsZone.classList.add('hidden');

  try {
    const token = await getIdToken(currentUser, true);
    const tokenResult = await getIdTokenResult(currentUser);
    const claimRole = tokenResult.claims?.role ?? null;
    const { status, profile: supabaseProfile } = await readSupabaseProfile(token, currentUser.uid);
    const roleMatches = String(supabaseProfile.role || '') === String(currentFirebaseProfile.role || '');
    const organizationMatches = supabaseProfile.organization_id === SUPABASE.organizationId;
    const active = supabaseProfile.active === true;
    const coreSuccess = claimRole === 'authenticated' && status === 200 && roleMatches && organizationMatches && active;

    renderSummary([
      { label:'Claim Firebase', value:claimRole || 'absent', good:claimRole === 'authenticated' },
      { label:'Réponse Supabase', value:`HTTP ${status}`, good:status === 200 },
      { label:'Rôle métier', value:roleMatches ? safeText(supabaseProfile.role) : 'Différent', good:roleMatches },
      { label:'Organisation', value:organizationMatches ? 'Conforme' : 'Différente', good:organizationMatches }
    ]);

    const countRows = [];
    for (const table of Object.keys(EXPECTED_COUNTS)) countRows.push(await countVisibleRows(token, table));
    renderCounts(countRows);
    const visibleTotal = countRows.filter((row) => row.ok && Number.isFinite(row.count)).reduce((sum,row) => sum + row.count,0);

    lastAuditSucceeded = coreSuccess;
    if (coreSuccess) {
      setStatus(auditStatus, 'Connexion validée', 'success');
      setMessage(auditMessage, `Authentification et profil validés. Total visible : ${visibleTotal} ligne(s), référence import : ${TOTAL_EXPECTED}.`, 'success');
    } else {
      setStatus(auditStatus, 'Contrôle à examiner', 'warning');
      setMessage(auditMessage, 'Supabase répond, mais au moins un contrôle essentiel ne correspond pas.', 'warning');
    }
  } catch (error) {
    console.error(error);
    setStatus(auditStatus, 'Échec', 'error');
    setMessage(auditMessage, readableError(error), 'error');
  } finally {
    auditButton.disabled = !currentUser;
    refreshWriteAvailability();
  }
}

function renderWriteSteps(steps) {
  writeResults.innerHTML = steps.map(step => `
    <div class="write-step ${step.ok ? 'ok' : 'bad'}">
      <span>${escapeHtml(step.label)}</span>
      <strong>${escapeHtml(step.detail)}</strong>
    </div>`).join('');
  writeResults.classList.remove('hidden');
}

async function jsonOrText(response) {
  const text = await response.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch (_) { return text; }
}

async function runWriteTest() {
  if (!canRunWriteTest()) return;
  writeButton.disabled = true;
  writeResults.classList.add('hidden');
  securityResults.classList.add('hidden');
  setStatus(writeStatus, 'Test en cours', 'warning');
  setMessage(writeMessage, 'Création d’un profil temporaire Supabase…');

  const steps = [];
  let created = null;
  const externalUid = `${TEST_UID_PREFIX}${Date.now()}-${crypto.randomUUID().slice(0,8)}`;

  try {
    const token = await getIdToken(currentUser, true);
    const createPayload = {
      organization_id: SUPABASE.organizationId,
      external_uid: externalUid,
      role: 'agent',
      first_name: 'Test',
      last_name: 'Staging',
      email: null,
      phone: null,
      active: true,
      firebase_payload: {
        staging_write_test: true,
        created_by: currentUser.uid,
        source: 'sentinelle-staging-write-test-v584'
      }
    };

    const createResponse = await fetch(`${SUPABASE.url}/rest/v1/profiles`, {
      method:'POST',
      headers:supabaseHeaders(token, { 'Content-Type':'application/json', Prefer:'return=representation' }),
      body:JSON.stringify(createPayload)
    });
    const createResult = await jsonOrText(createResponse);
    if (!createResponse.ok || !Array.isArray(createResult) || createResult.length !== 1) {
      throw new Error(`POST refusé (${createResponse.status}) : ${JSON.stringify(createResult)}`);
    }
    created = createResult[0];
    if (!String(created.external_uid || '').startsWith(TEST_UID_PREFIX)) throw new Error('Sécurité : le profil créé ne porte pas le préfixe staging attendu.');
    steps.push({ label:'POST profiles', ok:true, detail:`HTTP ${createResponse.status} · profil temporaire créé` });

    const readResponse = await fetch(`${SUPABASE.url}/rest/v1/profiles?select=id,external_uid,first_name,last_name,role,active,firebase_payload&id=eq.${encodeURIComponent(created.id)}`, {
      method:'GET', headers:supabaseHeaders(token)
    });
    const readResult = await jsonOrText(readResponse);
    if (!readResponse.ok || !Array.isArray(readResult) || readResult.length !== 1) throw new Error(`Lecture après POST impossible (${readResponse.status}).`);
    const safeMarker = readResult[0]?.firebase_payload?.staging_write_test === true && String(readResult[0]?.external_uid || '').startsWith(TEST_UID_PREFIX);
    if (!safeMarker) throw new Error('Sécurité : marqueur du profil temporaire absent.');
    steps.push({ label:'GET vérification', ok:true, detail:`HTTP ${readResponse.status} · profil relu` });

    const patchResponse = await fetch(`${SUPABASE.url}/rest/v1/profiles?id=eq.${encodeURIComponent(created.id)}`, {
      method:'PATCH',
      headers:supabaseHeaders(token, { 'Content-Type':'application/json', Prefer:'return=representation' }),
      body:JSON.stringify({ first_name:'Test modifié', active:false })
    });
    const patchResult = await jsonOrText(patchResponse);
    if (!patchResponse.ok || !Array.isArray(patchResult) || patchResult.length !== 1 || patchResult[0].first_name !== 'Test modifié' || patchResult[0].active !== false) {
      throw new Error(`PATCH refusé ou incohérent (${patchResponse.status}) : ${JSON.stringify(patchResult)}`);
    }
    steps.push({ label:'PATCH profiles', ok:true, detail:`HTTP ${patchResponse.status} · modification confirmée` });

    const deleteResponse = await fetch(`${SUPABASE.url}/rest/v1/profiles?id=eq.${encodeURIComponent(created.id)}&external_uid=eq.${encodeURIComponent(externalUid)}`, {
      method:'DELETE',
      headers:supabaseHeaders(token, { Prefer:'return=representation' })
    });
    const deleteResult = await jsonOrText(deleteResponse);
    if (!deleteResponse.ok || !Array.isArray(deleteResult) || deleteResult.length !== 1) {
      throw new Error(`DELETE refusé (${deleteResponse.status}) : ${JSON.stringify(deleteResult)}`);
    }
    steps.push({ label:'DELETE profiles', ok:true, detail:`HTTP ${deleteResponse.status} · profil supprimé` });
    created = null;

    const verifyDeleteResponse = await fetch(`${SUPABASE.url}/rest/v1/profiles?select=id&id=eq.${encodeURIComponent(deleteResult[0].id)}`, {
      method:'GET', headers:supabaseHeaders(token)
    });
    const verifyDeleteResult = await jsonOrText(verifyDeleteResponse);
    if (!verifyDeleteResponse.ok || !Array.isArray(verifyDeleteResult) || verifyDeleteResult.length !== 0) throw new Error('Le profil temporaire existe encore après DELETE.');
    steps.push({ label:'Nettoyage', ok:true, detail:'0 ligne restante · staging revenu à son état initial' });

    renderWriteSteps(steps);
    setStatus(writeStatus, 'Écriture validée', 'success');
    setMessage(writeMessage, 'POST, lecture, PATCH et DELETE ont réussi avec les RLS du compte QG. Aucun profil de test n’est resté en base.', 'success');
  } catch (error) {
    console.error(error);
    steps.push({ label:'Erreur', ok:false, detail:readableError(error) });

    // Nettoyage de secours uniquement si le profil créé est bien notre ligne temporaire.
    if (created?.id && String(created.external_uid || '').startsWith(TEST_UID_PREFIX)) {
      try {
        const token = await getIdToken(currentUser, true);
        const cleanup = await fetch(`${SUPABASE.url}/rest/v1/profiles?id=eq.${encodeURIComponent(created.id)}&external_uid=eq.${encodeURIComponent(created.external_uid)}`, {
          method:'DELETE', headers:supabaseHeaders(token, { Prefer:'return=minimal' })
        });
        steps.push({ label:'Nettoyage de secours', ok:cleanup.ok, detail:cleanup.ok ? `HTTP ${cleanup.status} · profil temporaire retiré` : `HTTP ${cleanup.status} · vérification manuelle requise` });
      } catch (cleanupError) {
        steps.push({ label:'Nettoyage de secours', ok:false, detail:'Échec réseau · vérifier profiles dans Supabase' });
      }
    }

    renderWriteSteps(steps);
    setStatus(writeStatus, 'Test incomplet', 'error');
    setMessage(writeMessage, readableError(error), 'error');
  } finally {
    writeButton.disabled = !canRunWriteTest();
  }
}


function renderSecuritySteps(steps) {
  securityResults.innerHTML = steps.map(step => `
    <div class="write-step ${step.ok ? 'ok' : 'bad'}">
      <span>${escapeHtml(step.label)}</span>
      <strong>${escapeHtml(step.detail)}</strong>
    </div>`).join('');
  securityResults.classList.remove('hidden');
}

async function runAgentSecurityTest() {
  if (!canRunAgentSecurityTest()) return;
  securityButton.disabled = true;
  securityResults.classList.add('hidden');
  setStatus(securityStatus, 'Test en cours', 'warning');
  setMessage(securityMessage, 'Exécution de la sonde RLS directement dans Supabase…');

  try {
    const token = await getIdToken(currentUser, true);
    const response = await fetch(`${SUPABASE.url}/rest/v1/rpc/staging_probe_agent_rls_v584`, {
      method:'POST',
      headers:supabaseHeaders(token, { 'Content-Type':'application/json' }),
      body:'{}'
    });
    const result = await jsonOrText(response);
    if (!response.ok) {
      throw new Error(`Sonde RLS indisponible (${response.status}) : ${JSON.stringify(result)}`);
    }
    if (!result || result.ok !== true) throw new Error(result?.error || 'Réponse de sonde invalide.');

    const tests = [
      ['Profils étrangers invisibles', Number(result.foreign_profiles_visible) === 0, `${result.foreign_profiles_visible ?? '—'} profil étranger visible`],
      ['Missions étrangères invisibles', Number(result.foreign_missions_visible) === 0, `${result.foreign_missions_visible ?? '—'} mission étrangère visible`],
      ['Rapports étrangers invisibles', Number(result.foreign_reports_visible) === 0, `${result.foreign_reports_visible ?? '—'} rapport étranger visible`],
      ['Création profil interdite', result.profile_insert_blocked === true, result.profile_insert_blocked ? 'bloquée par Supabase' : 'AUTORISÉE à tort'],
      ['Modification site interdite', result.site_update_blocked === true, result.site_update_blocked ? 'bloquée par Supabase' : 'AUTORISÉE à tort'],
      ['Création mission interdite', result.mission_insert_blocked === true, result.mission_insert_blocked ? 'bloquée par Supabase' : 'AUTORISÉE à tort'],
      ['Mise à jour de sa mission', result.mission_own_update_allowed !== false, result.mission_own_update_allowed === null ? 'non testée : aucune mission propre' : 'autorisée puis annulée'],
      ['Création de son shift', result.shift_own_insert_allowed === true, result.shift_own_insert_allowed ? 'autorisée puis annulée' : 'refusée à tort'],
      ['Création de son rapport verrouillé', result.report_own_insert_allowed === true, result.report_own_insert_allowed ? 'autorisée puis annulée' : 'refusée à tort'],
      ['Modification rapport existant interdite', result.report_own_update_blocked !== false, result.report_own_update_blocked === null ? 'non testée : aucun rapport propre' : 'bloquée par Supabase']
    ];
    renderSecuritySteps(tests.map(([label,ok,detail]) => ({label,ok,detail})));
    const failed = tests.filter(([,ok]) => !ok);
    if (failed.length) {
      setStatus(securityStatus, 'Sécurité à corriger', 'error');
      setMessage(securityMessage, `${failed.length} contrôle(s) RLS ne correspondent pas au comportement attendu.`, 'error');
    } else {
      setStatus(securityStatus, 'RLS Agent validées', 'success');
      setMessage(securityMessage, 'Les accès Agent sensibles sont correctement cloisonnés. Aucune donnée de sonde n’est restée en base.', 'success');
    }
  } catch (error) {
    console.error(error);
    renderSecuritySteps([{label:'Erreur',ok:false,detail:readableError(error)}]);
    setStatus(securityStatus, 'Test impossible', 'error');
    setMessage(securityMessage, readableError(error), 'error');
  } finally {
    securityButton.disabled = !canRunAgentSecurityTest();
  }
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

setPersistence(auth, browserSessionPersistence).catch((error) => console.warn('Persistance de session indisponible', error));

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginButton.disabled = true;
  setMessage(authMessage, 'Connexion Firebase en cours…');
  const data = new FormData(loginForm);
  try {
    await signInWithEmailAndPassword(auth, String(data.get('email') || '').trim(), String(data.get('password') || ''));
  } catch (error) {
    console.error(error);
    setStatus(authStatus, 'Connexion refusée', 'error');
    setMessage(authMessage, readableError(error), 'error');
  } finally { loginButton.disabled = false; }
});

logoutButton.addEventListener('click', async () => {
  auditButton.disabled = true;
  writeButton.disabled = true;
  await signOut(auth);
});

auditButton.addEventListener('click', runAudit);
writeButton.addEventListener('click', runWriteTest);
securityButton.addEventListener('click', runAgentSecurityTest);

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  currentFirebaseProfile = null;
  lastAuditSucceeded = false;
  summary.classList.add('hidden');
  countsZone.classList.add('hidden');
  writeResults.classList.add('hidden');
  securityResults.classList.add('hidden');
  setMessage(auditMessage, '');

  if (!user) {
    loginForm.classList.remove('hidden');
    sessionPanel.classList.add('hidden');
    auditCard.setAttribute('aria-disabled', 'true');
    auditButton.disabled = true;
    setStatus(authStatus, 'Non connecté', 'neutral');
    setStatus(auditStatus, 'En attente', 'neutral');
    setMessage(authMessage, '');
    refreshWriteAvailability();
    refreshSecurityAvailability();
    return;
  }

  loginForm.classList.add('hidden');
  sessionPanel.classList.remove('hidden');
  sessionAccount.textContent = user.email ? user.email.replace(/(^.).*(@.*$)/, '$1••••$2') : 'Compte Firebase connecté';
  setStatus(authStatus, 'Connecté', 'success');
  setMessage(authMessage, 'Session Firebase ouverte pour le portail staging.', 'success');

  try {
    currentFirebaseProfile = await loadFirebaseProfile(user);
    auditCard.setAttribute('aria-disabled', 'false');
    auditButton.disabled = false;
    setStatus(auditStatus, 'Prêt', 'neutral');
    setMessage(auditMessage, 'Profil Firestore retrouvé. Lance le contrôle Supabase.');
  } catch (error) {
    console.error(error);
    auditCard.setAttribute('aria-disabled', 'true');
    auditButton.disabled = true;
    setStatus(auditStatus, 'Profil absent', 'error');
    setMessage(auditMessage, readableError(error), 'error');
  }
  refreshWriteAvailability();
  refreshSecurityAvailability();
});
