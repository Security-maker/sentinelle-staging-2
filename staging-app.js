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

const TOTAL_EXPECTED = Object.values(EXPECTED_COUNTS)
  .reduce((sum, value) => sum + value, 0);

const $ = (selector) => document.querySelector(selector);
const authCard = $('#auth-card');
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

let currentUser = null;
let currentFirebaseProfile = null;

function setStatus(element, label, kind = 'neutral') {
  element.textContent = label;
  element.className = `status ${kind}`;
}

function setMessage(element, label = '', kind = '') {
  element.textContent = label;
  element.className = `message${kind ? ` ${kind}` : ''}`;
}

function safeText(value) {
  return String(value ?? '—');
}

function escapeHtml(value) {
  return safeText(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function readableError(error) {
  const code = String(error?.code || '');
  if (code.includes('invalid-credential') || code.includes('wrong-password')) {
    return 'Adresse e-mail ou mot de passe incorrect.';
  }
  if (code.includes('too-many-requests')) {
    return 'Trop de tentatives. Patiente quelques minutes avant de recommencer.';
  }
  if (code.includes('network-request-failed')) {
    return 'Connexion réseau indisponible.';
  }
  return error?.message || String(error || 'Erreur inconnue');
}

function assertReadOnlyMethod(method) {
  const normalized = String(method || 'GET').toUpperCase();
  if (!['GET', 'HEAD'].includes(normalized)) {
    throw new Error(`Méthode bloquée par le mode lecture seule : ${normalized}`);
  }
  return normalized;
}

async function readonlyFetch(url, options = {}) {
  const method = assertReadOnlyMethod(options.method);
  return fetch(url, { ...options, method });
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
  if (!snapshot.exists()) {
    throw new Error('Le compte existe dans Firebase Auth mais aucun profil Firestore users/{uid} n’a été trouvé.');
  }
  return { uid: user.uid, ...snapshot.data() };
}

async function readSupabaseProfile(token, uid) {
  const filter = encodeURIComponent(uid);
  const url = `${SUPABASE.url}/rest/v1/profiles` +
    `?select=id,external_uid,organization_id,role,active` +
    `&external_uid=eq.${filter}`;

  const response = await readonlyFetch(url, {
    method: 'GET',
    headers: supabaseHeaders(token)
  });

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(`Profil Supabase inaccessible (${response.status}) : ${JSON.stringify(payload)}`);
  }

  if (!Array.isArray(payload) || payload.length !== 1) {
    throw new Error(`Nombre de profils Supabase inattendu : ${Array.isArray(payload) ? payload.length : 'réponse invalide'}.`);
  }

  return { status: response.status, profile: payload[0] };
}

function parseContentRange(value) {
  const match = String(value || '').match(/\/(\d+|\*)$/);
  if (!match || match[1] === '*') return null;
  const total = Number(match[1]);
  return Number.isFinite(total) ? total : null;
}

async function countVisibleRows(token, table) {
  const url = `${SUPABASE.url}/rest/v1/${encodeURIComponent(table)}?select=id&limit=1`;
  const response = await readonlyFetch(url, {
    method: 'GET',
    headers: supabaseHeaders(token, {
      Prefer: 'count=exact',
      Range: '0-0'
    })
  });

  const text = await response.text();
  if (!response.ok) {
    return {
      table,
      ok: false,
      status: response.status,
      count: null,
      error: text.slice(0, 220)
    };
  }

  let count = parseContentRange(response.headers.get('content-range'));
  if (count === null) {
    try {
      const data = JSON.parse(text);
      count = Array.isArray(data) ? data.length : null;
    } catch (_) {
      count = null;
    }
  }

  return {
    table,
    ok: true,
    status: response.status,
    count,
    error: null
  };
}

function renderSummary(items) {
  summary.innerHTML = items.map((item) => `
    <div class="summary-item ${item.good ? 'good' : 'bad'}">
      <span>${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(item.value)}</strong>
    </div>
  `).join('');
  summary.classList.remove('hidden');
}

function renderCounts(rows) {
  countsBody.innerHTML = rows.map((row) => {
    const expected = EXPECTED_COUNTS[row.table];
    let state = 'Lecture impossible';
    let className = 'state-error';

    if (row.ok && row.count === expected) {
      state = 'Conforme';
      className = 'state-ok';
    } else if (row.ok) {
      state = 'Différent / RLS';
      className = 'state-info';
    }

    return `
      <tr>
        <td><code>${escapeHtml(row.table)}</code></td>
        <td>${row.count === null ? '—' : escapeHtml(row.count)}</td>
        <td>${escapeHtml(expected)}</td>
        <td class="${className}" title="${escapeHtml(row.error || '')}">${escapeHtml(state)}</td>
      </tr>
    `;
  }).join('');
  countsZone.classList.remove('hidden');
}

async function runAudit() {
  if (!currentUser || !currentFirebaseProfile) return;

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
    const coreSuccess = (
      claimRole === 'authenticated' &&
      status === 200 &&
      roleMatches &&
      organizationMatches &&
      active
    );

    renderSummary([
      { label: 'Claim Firebase', value: claimRole || 'absent', good: claimRole === 'authenticated' },
      { label: 'Réponse Supabase', value: `HTTP ${status}`, good: status === 200 },
      { label: 'Rôle métier', value: roleMatches ? safeText(supabaseProfile.role) : 'Différent', good: roleMatches },
      { label: 'Organisation', value: organizationMatches ? 'Conforme' : 'Différente', good: organizationMatches }
    ]);

    const tableNames = Object.keys(EXPECTED_COUNTS);
    const countRows = [];

    for (const table of tableNames) {
      countRows.push(await countVisibleRows(token, table));
    }

    renderCounts(countRows);

    const visibleTotal = countRows
      .filter((row) => row.ok && Number.isFinite(row.count))
      .reduce((sum, row) => sum + row.count, 0);

    if (coreSuccess) {
      setStatus(auditStatus, 'Connexion validée', 'success');
      setMessage(
        auditMessage,
        `Authentification et profil validés. Total visible : ${visibleTotal} ligne(s), référence import : ${TOTAL_EXPECTED}.`,
        'success'
      );
    } else {
      setStatus(auditStatus, 'Contrôle à examiner', 'warning');
      setMessage(
        auditMessage,
        'Supabase répond, mais au moins un contrôle essentiel ne correspond pas. Aucune donnée n’a été modifiée.',
        'warning'
      );
    }
  } catch (error) {
    console.error(error);
    setStatus(auditStatus, 'Échec sans écriture', 'error');
    setMessage(auditMessage, readableError(error), 'error');
  } finally {
    auditButton.disabled = !currentUser;
  }
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

setPersistence(auth, browserSessionPersistence).catch((error) => {
  console.warn('Persistance de session indisponible', error);
});

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginButton.disabled = true;
  setMessage(authMessage, 'Connexion Firebase en cours…');

  const data = new FormData(loginForm);
  try {
    await signInWithEmailAndPassword(
      auth,
      String(data.get('email') || '').trim(),
      String(data.get('password') || '')
    );
  } catch (error) {
    console.error(error);
    setStatus(authStatus, 'Connexion refusée', 'error');
    setMessage(authMessage, readableError(error), 'error');
  } finally {
    loginButton.disabled = false;
  }
});

logoutButton.addEventListener('click', async () => {
  auditButton.disabled = true;
  await signOut(auth);
});

auditButton.addEventListener('click', runAudit);

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  currentFirebaseProfile = null;
  summary.classList.add('hidden');
  countsZone.classList.add('hidden');
  setMessage(auditMessage, '');

  if (!user) {
    loginForm.classList.remove('hidden');
    sessionPanel.classList.add('hidden');
    auditCard.setAttribute('aria-disabled', 'true');
    auditButton.disabled = true;
    setStatus(authStatus, 'Non connecté', 'neutral');
    setStatus(auditStatus, 'En attente', 'neutral');
    setMessage(authMessage, '');
    return;
  }

  loginForm.classList.add('hidden');
  sessionPanel.classList.remove('hidden');
  sessionAccount.textContent = user.email ? user.email.replace(/(^.).*(@.*$)/, '$1••••$2') : 'Compte Firebase connecté';
  setStatus(authStatus, 'Connecté', 'success');
  setMessage(authMessage, 'Session Firebase ouverte uniquement pour ce portail de contrôle.', 'success');

  try {
    currentFirebaseProfile = await loadFirebaseProfile(user);
    auditCard.setAttribute('aria-disabled', 'false');
    auditButton.disabled = false;
    setStatus(auditStatus, 'Prêt', 'neutral');
    setMessage(auditMessage, 'Profil Firestore retrouvé. Le contrôle Supabase peut être lancé.');
  } catch (error) {
    console.error(error);
    auditCard.setAttribute('aria-disabled', 'true');
    auditButton.disabled = true;
    setStatus(auditStatus, 'Profil absent', 'error');
    setMessage(auditMessage, readableError(error), 'error');
  }
});
