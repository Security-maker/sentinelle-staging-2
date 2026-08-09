const SUPABASE = Object.freeze({
  url: 'https://ksoyqtsrhtsfbwmxipqz.supabase.co',
  publishableKey: 'sb_publishable_TaSZX6F0nsEecsHPxjZ8hg_c1cZtQuN',
  organizationId: '43b09366-de36-5b44-97cc-d549eb0d4e53',
  projectRef: 'ksoyqtsrhtsfbwmxipqz'
});

if (!window.supabase?.createClient) {
  throw new Error('Supabase JS indisponible. Vérifie le chargement du CDN.');
}

const supabaseClient = window.supabase.createClient(SUPABASE.url, SUPABASE.publishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'sentinelle-pro-staging-v585-auth'
  }
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
const BUSINESS_FLOW_STORAGE_KEY = 'sentinelle_staging_business_flow_v585';
const BUSINESS_FLOW_PREFIX = 'staging-flow-';

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
const flowCard = $('#flow-card');
const flowStatus = $('#flow-status');
const flowMessage = $('#flow-message');
const flowQGPanel = $('#flow-qg-panel');
const flowAgentPanel = $('#flow-agent-panel');
const flowAgentSelect = $('#flow-agent-select');
const flowSiteSelect = $('#flow-site-select');
const flowCreateButton = $('#flow-create-button');
const flowStartButton = $('#flow-start-button');
const flowMciButton = $('#flow-mci-button');
const flowEndButton = $('#flow-end-button');
const flowVerifyButton = $('#flow-verify-button');
const flowResults = $('#flow-results');

let currentUser = null;
let currentProfile = null;
let currentSession = null;
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
  const code = String(error?.code || error?.status || '').toLowerCase();
  const message = String(error?.message || error || '').toLowerCase();
  if (message.includes('invalid login credentials') || message.includes('invalid credentials')) return 'Adresse e-mail ou mot de passe incorrect.';
  if (message.includes('email not confirmed')) return 'Adresse e-mail non confirmée dans Supabase Auth.';
  if (message.includes('rate limit') || code.includes('429')) return 'Trop de tentatives. Patiente quelques minutes avant de recommencer.';
  if (message.includes('failed to fetch') || message.includes('network')) return 'Connexion réseau indisponible.';
  return error?.message || String(error || 'Erreur inconnue');
}

function parseJwt(token) {
  try {
    const base64 = String(token || '').split('.')[1]?.replace(/-/g, '+').replace(/_/g, '/');
    if (!base64) return {};
    return JSON.parse(decodeURIComponent(atob(base64).split('').map((c) => `%${(`00${c.charCodeAt(0).toString(16)}`).slice(-2)}`).join('')));
  } catch (_) {
    return {};
  }
}

async function getAccessToken() {
  const { data, error } = await supabaseClient.auth.getSession();
  if (error) throw error;
  if (!data?.session?.access_token) throw new Error('Session Supabase expirée ou absente.');
  currentSession = data.session;
  currentUser = data.session.user;
  return data.session.access_token;
}

function supabaseHeaders(token, extra = {}) {
  return {
    apikey: SUPABASE.publishableKey,
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
    ...extra
  };
}

async function readSupabaseProfile(token, authUserId) {
  const filter = encodeURIComponent(authUserId);
  const response = await fetch(`${SUPABASE.url}/rest/v1/profiles?select=id,auth_user_id,external_uid,organization_id,role,first_name,last_name,email,active&auth_user_id=eq.${filter}`, {
    method: 'GET', headers: supabaseHeaders(token)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`Profil Supabase inaccessible (${response.status}) : ${JSON.stringify(payload)}`);
  if (!Array.isArray(payload) || payload.length !== 1) throw new Error(`Compte Supabase Auth non relié à un profil métier unique : ${Array.isArray(payload) ? payload.length : 'réponse invalide'}.`);
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
  const role = String(currentProfile?.role || '');
  return Boolean(currentUser && lastAuditSucceeded && ['admin','superviseur'].includes(role));
}

function canRunAgentSecurityTest() {
  const role = String(currentProfile?.role || '');
  return Boolean(currentUser && lastAuditSucceeded && role === 'agent');
}

function refreshSecurityAvailability() {
  const allowed = canRunAgentSecurityTest();
  securityCard.setAttribute('aria-disabled', allowed ? 'false' : 'true');
  securityButton.disabled = !allowed;
  if (!currentUser) {
    setStatus(securityStatus, 'En attente', 'neutral');
    setMessage(securityMessage, 'Connecte un compte agent pour activer ce test.');
  } else if (String(currentProfile?.role || '') !== 'agent') {
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


function loadBusinessFlowState() {
  try {
    const parsed = JSON.parse(localStorage.getItem(BUSINESS_FLOW_STORAGE_KEY) || 'null');
    return parsed && parsed.flowId && parsed.missionFirebaseId ? parsed : null;
  } catch (_) { return null; }
}

function saveBusinessFlowState(state) {
  localStorage.setItem(BUSINESS_FLOW_STORAGE_KEY, JSON.stringify(state));
}

function clearBusinessFlowState() {
  localStorage.removeItem(BUSINESS_FLOW_STORAGE_KEY);
}

function flowRole() {
  return String(currentProfile?.role || '');
}

function isQGRole() {
  return ['admin','superviseur'].includes(flowRole());
}

function flowReady() {
  return Boolean(currentUser && lastAuditSucceeded);
}

function renderFlowSteps(steps) {
  flowResults.innerHTML = steps.map(step => `
    <div class="write-step ${step.ok ? 'ok' : 'bad'}">
      <span>${escapeHtml(step.label)}</span>
      <strong>${escapeHtml(step.detail)}</strong>
    </div>`).join('');
  flowResults.classList.toggle('hidden', !steps.length);
}

async function supabaseRequest(token, tableOrRpc, {
  method='GET', query='', body=null, prefer='', rpc=false
} = {}) {
  const url = rpc
    ? `${SUPABASE.url}/rest/v1/rpc/${tableOrRpc}`
    : `${SUPABASE.url}/rest/v1/${tableOrRpc}${query ? `?${query}` : ''}`;
  const headers = supabaseHeaders(token, {
    ...(body !== null ? {'Content-Type':'application/json'} : {}),
    ...(prefer ? {Prefer:prefer} : {})
  });
  const response = await fetch(url, {
    method,
    headers,
    ...(body !== null ? {body:JSON.stringify(body)} : {})
  });
  const result = await jsonOrText(response);
  return { response, result };
}

async function refreshBusinessFlowUI() {
  if (!flowCard) return;
  const role = flowRole();
  const state = loadBusinessFlowState();
  const ready = flowReady();

  flowQGPanel.classList.toggle('hidden', !isQGRole());
  flowAgentPanel.classList.toggle('hidden', role !== 'agent');
  const ownAgentFlow = Boolean(ready && role === 'agent' && state && state.agentAuthUserId === currentUser?.id);
  flowCreateButton.disabled = !(ready && isQGRole() && !state);
  flowVerifyButton.disabled = !(ready && isQGRole() && state);
  flowStartButton.disabled = !(ownAgentFlow && !['active','mci','completed'].includes(String(state.stage || '')));
  flowMciButton.disabled = !(ownAgentFlow && state.stage === 'active');
  flowEndButton.disabled = !(ownAgentFlow && state.stage === 'mci');

  if (!currentUser) {
    setStatus(flowStatus, 'En attente', 'neutral');
    setMessage(flowMessage, 'Connecte d’abord un compte QG ou agent puis valide l’étape 2.');
    renderFlowSteps([]);
    return;
  }
  if (!lastAuditSucceeded) {
    setStatus(flowStatus, 'Audit requis', 'neutral');
    setMessage(flowMessage, 'Lance le contrôle Supabase de l’étape 2 avant le scénario métier.');
    return;
  }

  try {
    const token = await getAccessToken();
    if (isQGRole()) {
      const [{response:agentsResponse,result:agents}, {response:sitesResponse,result:sites}] = await Promise.all([
        supabaseRequest(token, 'profiles', {
          query:'select=id,auth_user_id,external_uid,first_name,last_name,email,role,active&role=eq.agent&active=eq.true&order=last_name.asc'
        }),
        supabaseRequest(token, 'sites', {
          query:'select=id,firebase_id,name,address,active&active=eq.true&order=name.asc'
        })
      ]);
      if (agentsResponse.ok && Array.isArray(agents)) {
        flowAgentSelect.innerHTML = '<option value="">Choisir un agent Supabase Auth</option>' + agents
          .filter(agent => agent.external_uid && agent.auth_user_id)
          .map(agent => {
            const label = `${agent.first_name || ''} ${agent.last_name || ''}`.trim() || agent.email || agent.external_uid;
            return `<option value="${escapeHtml(agent.auth_user_id)}" data-external-uid="${escapeHtml(agent.external_uid)}" data-label="${escapeHtml(label)}">${escapeHtml(label)}</option>`;
          }).join('');
        if (state?.agentAuthUserId) flowAgentSelect.value = state.agentAuthUserId;
      }
      if (sitesResponse.ok && Array.isArray(sites)) {
        flowSiteSelect.innerHTML = '<option value="">Choisir un site</option>' + sites
          .filter(site => site.firebase_id)
          .map(site => `<option value="${escapeHtml(site.firebase_id)}" data-label="${escapeHtml(site.name || site.firebase_id)}">${escapeHtml(site.name || site.firebase_id)}</option>`)
          .join('');
        if (state?.siteFirebaseId) flowSiteSelect.value = state.siteFirebaseId;
      }
      setStatus(flowStatus, state ? 'Scénario en cours' : 'QG prêt', state ? 'warning' : 'success');
      setMessage(
        flowMessage,
        state
          ? `Mission staging ${state.missionFirebaseId}. Passe au compte agent ${state.agentLabel || state.agentAuthUserId}, puis reviens QG après la fin de poste.`
          : 'Crée une mission temporaire affectée à un agent. Elle n’existe que dans Supabase staging.',
        state ? 'warning' : 'success'
      );
    } else if (role === 'agent') {
      if (!state) {
        setStatus(flowStatus, 'Mission staging absente', 'warning');
        setMessage(flowMessage, 'Aucune mission de scénario n’a encore été préparée par le QG.', 'warning');
      } else if (state.agentAuthUserId !== currentUser.id) {
        setStatus(flowStatus, 'Autre agent requis', 'warning');
        setMessage(flowMessage, `Cette mission staging est affectée à ${state.agentLabel || 'un autre agent'}.`, 'warning');
      } else {
        const {response,result} = await supabaseRequest(token, 'missions', {
          query:`select=id,firebase_id,status,scheduled_start,scheduled_end,firebase_site_id,payload&firebase_id=eq.${encodeURIComponent(state.missionFirebaseId)}`
        });
        const mission = response.ok && Array.isArray(result) ? result[0] : null;
        if (!mission) {
          setStatus(flowStatus, 'Mission introuvable', 'error');
          setMessage(flowMessage, 'La mission staging n’est pas visible pour ce compte agent. Vérifie le compte utilisé.', 'error');
        } else {
          setStatus(flowStatus, `Agent · ${mission.status || 'planned'}`, mission.status === 'completed' ? 'success' : 'warning');
          setMessage(flowMessage, `Mission visible : ${state.siteLabel || mission.firebase_site_id}. Utilise les boutons dans l’ordre Démarrer → MCI → Terminer.`, 'success');
        }
      }
    } else {
      setStatus(flowStatus, 'Rôle non prévu', 'warning');
      setMessage(flowMessage, 'Ce scénario utilise uniquement un compte QG et un compte agent.', 'warning');
    }
  } catch (error) {
    console.error(error);
    setStatus(flowStatus, 'État indisponible', 'error');
    setMessage(flowMessage, readableError(error), 'error');
  }
}

async function createBusinessFlowMission() {
  if (!(flowReady() && isQGRole())) return;
  const agentAuthUserId = String(flowAgentSelect.value || '').trim();
  const selectedAgent = flowAgentSelect.selectedOptions[0];
  const agentExternalUid = String(selectedAgent?.dataset?.externalUid || '').trim();
  const siteFirebaseId = String(flowSiteSelect.value || '').trim();
  if (!agentAuthUserId || !agentExternalUid || !siteFirebaseId) {
    setStatus(flowStatus, 'Choix requis', 'warning');
    setMessage(flowMessage, 'Choisis un agent et un site avant de créer la mission.', 'warning');
    return;
  }
  if (loadBusinessFlowState()) {
    setStatus(flowStatus, 'Scénario déjà présent', 'warning');
    setMessage(flowMessage, 'Nettoie d’abord le scénario staging précédent avec le compte QG.', 'warning');
    return;
  }

  flowCreateButton.disabled = true;
  renderFlowSteps([]);
  setStatus(flowStatus, 'Création mission', 'warning');
  setMessage(flowMessage, 'Création de la mission temporaire dans Supabase staging…');

  try {
    const token = await getAccessToken();
    const flowId = `v585-${Date.now()}-${crypto.randomUUID().slice(0,8)}`;
    const missionFirebaseId = `${BUSINESS_FLOW_PREFIX}${flowId}-mission`;
    const selectedSite = flowSiteSelect.selectedOptions[0];
    const agentLabel = selectedAgent?.dataset?.label || selectedAgent?.textContent || agentExternalUid;
    const siteLabel = selectedSite?.dataset?.label || selectedSite?.textContent || siteFirebaseId;
    const now = new Date();
    const end = new Date(now.getTime() + 60 * 60 * 1000);
    const payload = {
      staging_business_flow:true,
      staging_flow_id:flowId,
      staging_stage:'planned',
      agent_label:agentLabel,
      site_label:siteLabel,
      created_by:currentUser.id,
      source:'sentinelle-staging-business-flow-v585'
    };

    const {response,result} = await supabaseRequest(token, 'missions', {
      method:'POST',
      body:{
        organization_id:SUPABASE.organizationId,
        firebase_id:missionFirebaseId,
        firebase_site_id:siteFirebaseId,
        firebase_agent_uid:agentExternalUid,
        status:'planned',
        scheduled_start:now.toISOString(),
        scheduled_end:end.toISOString(),
        payload
      },
      prefer:'return=representation'
    });
    if (!response.ok || !Array.isArray(result) || result.length !== 1) {
      throw new Error(`Création mission refusée (${response.status}) : ${JSON.stringify(result)}`);
    }

    saveBusinessFlowState({
      flowId,
      missionFirebaseId,
      missionId:result[0].id,
      agentAuthUserId,
      agentExternalUid,
      agentLabel,
      siteFirebaseId,
      siteLabel,
      createdAt:new Date().toISOString()
    });
    renderFlowSteps([
      {label:'QG · création mission',ok:true,detail:`HTTP ${response.status} · ${missionFirebaseId}`},
      {label:'Affectation',ok:true,detail:`${agentLabel} · ${siteLabel}`},
      {label:'Suite',ok:true,detail:'Déconnexion QG → connexion avec cet agent'}
    ]);
    setStatus(flowStatus, 'Mission créée', 'success');
    setMessage(flowMessage, `Mission staging créée pour ${agentLabel}. Déconnecte-toi puis connecte ce compte agent.`, 'success');
  } catch (error) {
    console.error(error);
    renderFlowSteps([{label:'Création mission',ok:false,detail:readableError(error)}]);
    setStatus(flowStatus, 'Création impossible', 'error');
    setMessage(flowMessage, readableError(error), 'error');
  } finally {
    await refreshBusinessFlowUI();
  }
}

async function getOwnFlowMissionAndShift(token, state) {
  const {response:missionResponse,result:missions} = await supabaseRequest(token, 'missions', {
    query:`select=id,firebase_id,firebase_site_id,firebase_agent_uid,status,payload&firebase_id=eq.${encodeURIComponent(state.missionFirebaseId)}`
  });
  if (!missionResponse.ok || !Array.isArray(missions) || missions.length !== 1) {
    throw new Error('Mission staging non visible pour cet agent.');
  }
  const mission = missions[0];
  const {response:shiftResponse,result:shifts} = await supabaseRequest(token, 'shifts', {
    query:`select=id,firebase_id,firebase_mission_id,firebase_site_id,firebase_agent_uid,status,started_at,completed_at,payload&firebase_mission_id=eq.${encodeURIComponent(state.missionFirebaseId)}&order=created_at.desc&limit=1`
  });
  if (!shiftResponse.ok) throw new Error(`Lecture shift impossible (${shiftResponse.status}).`);
  return {mission, shift:Array.isArray(shifts) ? shifts[0] || null : null};
}

async function startBusinessFlowShift() {
  const state = loadBusinessFlowState();
  if (!(flowReady() && flowRole() === 'agent' && state?.agentAuthUserId === currentUser.id)) return;
  flowStartButton.disabled = true;
  setStatus(flowStatus, 'Prise de poste', 'warning');
  setMessage(flowMessage, 'Création du shift et du rapport automatique de prise de service…');
  try {
    const token = await getAccessToken();
    const {mission,shift} = await getOwnFlowMissionAndShift(token, state);
    if (mission.status === 'completed') throw new Error('Cette mission staging est déjà terminée.');
    if (shift?.status === 'active') throw new Error('Un shift staging est déjà actif.');

    const shiftFirebaseId = `${BUSINESS_FLOW_PREFIX}${state.flowId}-shift`;
    const now = new Date().toISOString();
    const shiftPayload = {
      staging_business_flow:true,
      staging_flow_id:state.flowId,
      staging_stage:'active',
      isLocked:true,
      source:'sentinelle-staging-business-flow-v585'
    };
    const {response:shiftCreate,result:shiftCreated} = await supabaseRequest(token, 'shifts', {
      method:'POST',
      body:{
        organization_id:SUPABASE.organizationId,
        firebase_id:shiftFirebaseId,
        firebase_mission_id:state.missionFirebaseId,
        firebase_site_id:state.siteFirebaseId,
        firebase_agent_uid:currentProfile.external_uid,
        status:'active',
        started_at:now,
        payload:shiftPayload
      },
      prefer:'return=representation'
    });
    if (!shiftCreate.ok || !Array.isArray(shiftCreated) || shiftCreated.length !== 1) {
      throw new Error(`Création shift refusée (${shiftCreate.status}) : ${JSON.stringify(shiftCreated)}`);
    }

    const startReportId = `${BUSINESS_FLOW_PREFIX}${state.flowId}-report-start`;
    const {response:startReport,result:startResult} = await supabaseRequest(token, 'reports', {
      method:'POST',
      body:{
        organization_id:SUPABASE.organizationId,
        firebase_id:startReportId,
        firebase_mission_id:state.missionFirebaseId,
        firebase_shift_id:shiftFirebaseId,
        firebase_site_id:state.siteFirebaseId,
        firebase_agent_uid:currentProfile.external_uid,
        occurred_at:now,
        category:'Prise de service',
        severity:'Normal',
        message:`Prise de poste staging confirmée sur ${state.siteLabel || state.siteFirebaseId}.`,
        payload:{
          staging_business_flow:true,
          staging_flow_id:state.flowId,
          eventType:'shift_start',
          isLocked:true
        }
      },
      prefer:'return=representation'
    });
    if (!startReport.ok || !Array.isArray(startResult) || startResult.length !== 1) {
      throw new Error(`Rapport prise de poste refusé (${startReport.status}) : ${JSON.stringify(startResult)}`);
    }

    const missionPayload = {...(mission.payload || {}), staging_stage:'active', shift_firebase_id:shiftFirebaseId};
    const {response:missionPatch,result:missionPatched} = await supabaseRequest(token, 'missions', {
      method:'PATCH',
      query:`id=eq.${encodeURIComponent(mission.id)}`,
      body:{status:'active',actual_start:now,payload:missionPayload},
      prefer:'return=representation'
    });
    if (!missionPatch.ok || !Array.isArray(missionPatched) || missionPatched.length !== 1 || missionPatched[0].status !== 'active') {
      throw new Error(`Mise à jour mission refusée (${missionPatch.status}) : ${JSON.stringify(missionPatched)}`);
    }

    saveBusinessFlowState({...state, shiftFirebaseId, shiftId:shiftCreated[0].id, stage:'active'});
    renderFlowSteps([
      {label:'Agent · mission propre',ok:true,detail:'visible par RLS'},
      {label:'Agent · prise de poste',ok:true,detail:`HTTP ${shiftCreate.status} · shift actif`},
      {label:'Rapport automatique',ok:true,detail:`HTTP ${startReport.status} · prise de service`},
      {label:'Mise à jour mission',ok:true,detail:`HTTP ${missionPatch.status} · active`}
    ]);
    setStatus(flowStatus, 'Poste actif', 'success');
    setMessage(flowMessage, 'Prise de poste Supabase validée. Lance maintenant le MCI test.', 'success');
  } catch (error) {
    console.error(error);
    renderFlowSteps([{label:'Prise de poste',ok:false,detail:readableError(error)}]);
    setStatus(flowStatus, 'Prise de poste impossible', 'error');
    setMessage(flowMessage, readableError(error), 'error');
  } finally {
    await refreshBusinessFlowUI();
  }
}

async function createBusinessFlowMci() {
  const state = loadBusinessFlowState();
  if (!(flowReady() && flowRole() === 'agent' && state?.agentAuthUserId === currentUser.id)) return;
  flowMciButton.disabled = true;
  setStatus(flowStatus, 'Création MCI', 'warning');
  setMessage(flowMessage, 'Création d’un rapport MCI verrouillé et tentative de modification interdite…');
  try {
    const token = await getAccessToken();
    const {mission,shift} = await getOwnFlowMissionAndShift(token, state);
    if (!shift || shift.status !== 'active') throw new Error('Démarre d’abord la mission staging.');

    const reportFirebaseId = `${BUSINESS_FLOW_PREFIX}${state.flowId}-report-mci`;
    const now = new Date().toISOString();
    const {response:createResponse,result:createResult} = await supabaseRequest(token, 'reports', {
      method:'POST',
      body:{
        organization_id:SUPABASE.organizationId,
        firebase_id:reportFirebaseId,
        firebase_mission_id:state.missionFirebaseId,
        firebase_shift_id:shift.firebase_id,
        firebase_site_id:state.siteFirebaseId,
        firebase_agent_uid:currentProfile.external_uid,
        occurred_at:now,
        category:'Incident',
        severity:'Important',
        message:'MCI staging : contrôle du parcours Supabase de bout en bout.',
        payload:{
          staging_business_flow:true,
          staging_flow_id:state.flowId,
          isLocked:true,
          source:'sentinelle-staging-business-flow-v585'
        }
      },
      prefer:'return=representation'
    });
    if (!createResponse.ok || !Array.isArray(createResult) || createResult.length !== 1) {
      throw new Error(`Création MCI refusée (${createResponse.status}) : ${JSON.stringify(createResult)}`);
    }

    const createdReport = createResult[0];
    const {response:patchResponse,result:patchResult} = await supabaseRequest(token, 'reports', {
      method:'PATCH',
      query:`id=eq.${encodeURIComponent(createdReport.id)}`,
      body:{message:'MODIFICATION QUI DOIT ÊTRE BLOQUÉE'},
      prefer:'return=representation'
    });
    const updateBlocked = !patchResponse.ok || (Array.isArray(patchResult) && patchResult.length === 0);
    if (!updateBlocked) throw new Error('Sécurité : l’agent a réussi à modifier un rapport verrouillé.');

    saveBusinessFlowState({...state, mciReportId:createdReport.id, mciReportFirebaseId:reportFirebaseId, stage:'mci'});
    renderFlowSteps([
      {label:'Agent · création MCI',ok:true,detail:`HTTP ${createResponse.status} · rapport verrouillé`},
      {label:'Agent · PATCH du MCI',ok:true,detail:'bloqué par RLS comme attendu'}
    ]);
    setStatus(flowStatus, 'MCI validé', 'success');
    setMessage(flowMessage, 'Le MCI a été créé et sa modification a été bloquée. Tu peux terminer la mission.', 'success');
  } catch (error) {
    console.error(error);
    renderFlowSteps([{label:'MCI',ok:false,detail:readableError(error)}]);
    setStatus(flowStatus, 'MCI impossible', 'error');
    setMessage(flowMessage, readableError(error), 'error');
  } finally {
    await refreshBusinessFlowUI();
  }
}

async function endBusinessFlowShift() {
  const state = loadBusinessFlowState();
  if (!(flowReady() && flowRole() === 'agent' && state?.agentAuthUserId === currentUser.id)) return;
  flowEndButton.disabled = true;
  setStatus(flowStatus, 'Fin de poste', 'warning');
  setMessage(flowMessage, 'Création du rapport de fin et clôture du shift + mission…');
  try {
    const token = await getAccessToken();
    const {mission,shift} = await getOwnFlowMissionAndShift(token, state);
    if (!shift || shift.status !== 'active') throw new Error('Aucun shift staging actif à terminer.');

    const now = new Date().toISOString();
    const endReportId = `${BUSINESS_FLOW_PREFIX}${state.flowId}-report-end`;
    const {response:endReport,result:endResult} = await supabaseRequest(token, 'reports', {
      method:'POST',
      body:{
        organization_id:SUPABASE.organizationId,
        firebase_id:endReportId,
        firebase_mission_id:state.missionFirebaseId,
        firebase_shift_id:shift.firebase_id,
        firebase_site_id:state.siteFirebaseId,
        firebase_agent_uid:currentProfile.external_uid,
        occurred_at:now,
        category:'Fin de service',
        severity:'Normal',
        message:'Fin de poste staging confirmée. Relève : RAS.',
        payload:{
          staging_business_flow:true,
          staging_flow_id:state.flowId,
          eventType:'shift_end',
          isLocked:true
        }
      },
      prefer:'return=representation'
    });
    if (!endReport.ok || !Array.isArray(endResult) || endResult.length !== 1) {
      throw new Error(`Rapport fin de poste refusé (${endReport.status}) : ${JSON.stringify(endResult)}`);
    }

    const shiftPayload = {...(shift.payload || {}), staging_stage:'completed'};
    const {response:shiftPatch,result:shiftPatched} = await supabaseRequest(token, 'shifts', {
      method:'PATCH',
      query:`id=eq.${encodeURIComponent(shift.id)}`,
      body:{status:'completed',completed_at:now,payload:shiftPayload},
      prefer:'return=representation'
    });
    if (!shiftPatch.ok || !Array.isArray(shiftPatched) || shiftPatched.length !== 1 || shiftPatched[0].status !== 'completed') {
      throw new Error(`Clôture shift refusée (${shiftPatch.status}) : ${JSON.stringify(shiftPatched)}`);
    }

    const missionPayload = {...(mission.payload || {}), staging_stage:'completed'};
    const {response:missionPatch,result:missionPatched} = await supabaseRequest(token, 'missions', {
      method:'PATCH',
      query:`id=eq.${encodeURIComponent(mission.id)}`,
      body:{status:'completed',actual_end:now,payload:missionPayload},
      prefer:'return=representation'
    });
    if (!missionPatch.ok || !Array.isArray(missionPatched) || missionPatched.length !== 1 || missionPatched[0].status !== 'completed') {
      throw new Error(`Clôture mission refusée (${missionPatch.status}) : ${JSON.stringify(missionPatched)}`);
    }

    saveBusinessFlowState({...state, stage:'completed', completedAt:now});
    renderFlowSteps([
      {label:'Rapport fin de service',ok:true,detail:`HTTP ${endReport.status}`},
      {label:'Shift',ok:true,detail:`HTTP ${shiftPatch.status} · completed`},
      {label:'Mission',ok:true,detail:`HTTP ${missionPatch.status} · completed`},
      {label:'Suite',ok:true,detail:'Déconnexion Agent → reconnexion QG → Vérifier et nettoyer'}
    ]);
    setStatus(flowStatus, 'Mission terminée', 'success');
    setMessage(flowMessage, 'Parcours Agent terminé. Reconnecte maintenant le QG pour la vérification finale.', 'success');
  } catch (error) {
    console.error(error);
    renderFlowSteps([{label:'Fin de poste',ok:false,detail:readableError(error)}]);
    setStatus(flowStatus, 'Clôture impossible', 'error');
    setMessage(flowMessage, readableError(error), 'error');
  } finally {
    await refreshBusinessFlowUI();
  }
}

async function verifyAndCleanupBusinessFlow() {
  const state = loadBusinessFlowState();
  if (!(flowReady() && isQGRole() && state)) return;
  flowVerifyButton.disabled = true;
  setStatus(flowStatus, 'Vérification QG', 'warning');
  setMessage(flowMessage, 'Contrôle de la mission, du shift et des rapports avant nettoyage…');

  try {
    const token = await getAccessToken();
    const [{response:missionResponse,result:missions}, {response:shiftResponse,result:shifts}, {response:reportResponse,result:reports}] = await Promise.all([
      supabaseRequest(token, 'missions', {
        query:`select=id,firebase_id,status,actual_start,actual_end,payload&firebase_id=eq.${encodeURIComponent(state.missionFirebaseId)}`
      }),
      supabaseRequest(token, 'shifts', {
        query:`select=id,firebase_id,status,started_at,completed_at,payload&firebase_mission_id=eq.${encodeURIComponent(state.missionFirebaseId)}`
      }),
      supabaseRequest(token, 'reports', {
        query:`select=id,firebase_id,category,severity,message,occurred_at,payload&firebase_mission_id=eq.${encodeURIComponent(state.missionFirebaseId)}&order=occurred_at.asc`
      })
    ]);
    if (!missionResponse.ok || !shiftResponse.ok || !reportResponse.ok) throw new Error('Lecture QG du scénario impossible.');
    const mission = Array.isArray(missions) ? missions[0] : null;
    const shift = Array.isArray(shifts) ? shifts[0] : null;
    const reportRows = Array.isArray(reports) ? reports : [];
    const categories = reportRows.map(row => row.category);
    const checks = [
      {label:'QG · mission visible',ok:Boolean(mission),detail:mission ? mission.status : 'absente'},
      {label:'QG · mission terminée',ok:mission?.status === 'completed',detail:mission?.status || 'absente'},
      {label:'QG · shift terminé',ok:shift?.status === 'completed',detail:shift?.status || 'absent'},
      {label:'QG · prise de service',ok:categories.includes('Prise de service'),detail:categories.includes('Prise de service') ? 'présente' : 'absente'},
      {label:'QG · MCI Incident',ok:categories.includes('Incident'),detail:categories.includes('Incident') ? 'présent' : 'absent'},
      {label:'QG · fin de service',ok:categories.includes('Fin de service'),detail:categories.includes('Fin de service') ? 'présente' : 'absente'},
      {label:'QG · rapports',ok:reportRows.length >= 3,detail:`${reportRows.length} rapport(s)`}
    ];
    renderFlowSteps(checks);
    const complete = checks.every(check => check.ok);
    if (!complete) {
      setStatus(flowStatus, 'Parcours incomplet', 'error');
      setMessage(flowMessage, 'Le scénario n’est pas complet : aucune suppression automatique n’a été effectuée.', 'error');
      return;
    }

    const {response:cleanupResponse,result:cleanupResult} = await supabaseRequest(token, 'staging_cleanup_business_flow_v585', {
      method:'POST',
      body:{p_flow_id:state.flowId},
      rpc:true
    });
    if (!cleanupResponse.ok || cleanupResult?.ok !== true) {
      throw new Error(`Nettoyage RPC refusé (${cleanupResponse.status}) : ${JSON.stringify(cleanupResult)}`);
    }

    renderFlowSteps([
      ...checks,
      {label:'Nettoyage staging',ok:true,detail:`${cleanupResult.reports_deleted || 0} rapport(s), ${cleanupResult.shifts_deleted || 0} shift(s), ${cleanupResult.missions_deleted || 0} mission(s) supprimés`},
      {label:'État final',ok:true,detail:'0 donnée de scénario persistante'}
    ]);
    clearBusinessFlowState();
    setStatus(flowStatus, 'Parcours métier validé', 'success');
    setMessage(flowMessage, 'Mission → prise de poste → MCI → fin de poste → lecture QG : tout est validé sur Supabase staging et les données de test ont été supprimées.', 'success');
  } catch (error) {
    console.error(error);
    renderFlowSteps([{label:'Vérification / nettoyage',ok:false,detail:readableError(error)}]);
    setStatus(flowStatus, 'Vérification impossible', 'error');
    setMessage(flowMessage, readableError(error), 'error');
  } finally {
    await refreshBusinessFlowUI();
  }
}

function refreshWriteAvailability() {
  const allowed = canRunWriteTest();
  writeCard.setAttribute('aria-disabled', allowed ? 'false' : 'true');
  writeButton.disabled = !allowed;
  if (!currentUser) {
    setStatus(writeStatus, 'En attente', 'neutral');
    setMessage(writeMessage, 'Connecte un compte QG pour activer ce test.');
  } else if (!['admin','superviseur'].includes(String(currentProfile?.role || ''))) {
    setStatus(writeStatus, 'QG requis', 'warning');
    setMessage(writeMessage, 'Ce test est volontairement bloqué pour les comptes agent.', 'warning');
  } else if (!lastAuditSucceeded) {
    setStatus(writeStatus, 'Audit requis', 'neutral');
    setMessage(writeMessage, 'Lance d’abord le contrôle de lecture Supabase avec ce compte QG.');
  } else {
    setStatus(writeStatus, 'Prêt', 'success');
    setMessage(writeMessage, 'Le test temporaire peut être lancé. Aucune donnée de production ne sera modifiée.', 'success');
  }
  refreshSecurityAvailability();
}

async function runAudit() {
  if (!currentUser || !currentProfile) return;
  lastAuditSucceeded = false;
  refreshWriteAvailability();
  auditButton.disabled = true;
  setStatus(auditStatus, 'Contrôle en cours', 'warning');
  setMessage(auditMessage, 'Vérification du JWT Supabase Auth et interrogation des RLS…');
  summary.classList.add('hidden');
  countsZone.classList.add('hidden');

  try {
    const { data: userData, error: userError } = await supabaseClient.auth.getUser();
    if (userError) throw userError;
    const verifiedUser = userData?.user;
    if (!verifiedUser?.id) throw new Error('Supabase Auth ne retourne aucun utilisateur vérifié.');

    const token = await getAccessToken();
    const jwt = parseJwt(token);
    const { status, profile: supabaseProfile } = await readSupabaseProfile(token, verifiedUser.id);
    currentProfile = supabaseProfile;

    const authMatches = verifiedUser.id === currentUser.id && supabaseProfile.auth_user_id === verifiedUser.id;
    const jwtMatches = jwt.sub === verifiedUser.id && jwt.role === 'authenticated';
    const organizationMatches = supabaseProfile.organization_id === SUPABASE.organizationId;
    const active = supabaseProfile.active === true;
    const coreSuccess = authMatches && jwtMatches && status === 200 && organizationMatches && active;

    renderSummary([
      { label:'Supabase Auth', value:authMatches ? 'Utilisateur vérifié' : 'Incohérent', good:authMatches },
      { label:'JWT Supabase', value:jwtMatches ? 'authenticated' : safeText(jwt.role || 'absent'), good:jwtMatches },
      { label:'Rôle métier', value:safeText(supabaseProfile.role), good:['admin','superviseur','agent','client'].includes(String(supabaseProfile.role || '')) },
      { label:'Organisation', value:organizationMatches ? 'Conforme' : 'Différente', good:organizationMatches }
    ]);

    const countRows = [];
    for (const table of Object.keys(EXPECTED_COUNTS)) countRows.push(await countVisibleRows(token, table));
    renderCounts(countRows);
    const visibleTotal = countRows.filter((row) => row.ok && Number.isFinite(row.count)).reduce((sum,row) => sum + row.count,0);

    lastAuditSucceeded = coreSuccess;
    if (coreSuccess) {
      setStatus(auditStatus, 'Supabase Auth validé', 'success');
      setMessage(auditMessage, `Connexion Supabase native et profil métier validés. Total visible : ${visibleTotal} ligne(s), référence import : ${TOTAL_EXPECTED}.`, 'success');
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
    refreshBusinessFlowUI();
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
    const token = await getAccessToken();
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
        created_by: currentUser.id,
        source: 'sentinelle-staging-write-test-v585'
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
        const token = await getAccessToken();
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
    const token = await getAccessToken();
    const response = await fetch(`${SUPABASE.url}/rest/v1/rpc/staging_probe_agent_rls_v585`, {
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

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginButton.disabled = true;
  setStatus(authStatus, 'Connexion…', 'warning');
  setMessage(authMessage, 'Connexion directe à Supabase Auth…');
  const data = new FormData(loginForm);
  try {
    const email = String(data.get('email') || '').trim();
    const password = String(data.get('password') || '');
    const { data: authData, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (!authData?.session || !authData?.user) throw new Error('Supabase Auth n’a pas ouvert de session.');
    loginForm.reset();
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
  writeButton.disabled = true;
  securityButton.disabled = true;
  const { error } = await supabaseClient.auth.signOut({ scope:'local' });
  if (error) {
    console.error(error);
    setMessage(authMessage, readableError(error), 'error');
  }
});

auditButton.addEventListener('click', runAudit);
writeButton.addEventListener('click', runWriteTest);
securityButton.addEventListener('click', runAgentSecurityTest);
flowCreateButton.addEventListener('click', createBusinessFlowMission);
flowStartButton.addEventListener('click', startBusinessFlowShift);
flowMciButton.addEventListener('click', createBusinessFlowMci);
flowEndButton.addEventListener('click', endBusinessFlowShift);
flowVerifyButton.addEventListener('click', verifyAndCleanupBusinessFlow);

async function applyAuthSession(session) {
  currentSession = session || null;
  currentUser = session?.user || null;
  currentProfile = null;
  lastAuditSucceeded = false;
  summary.classList.add('hidden');
  countsZone.classList.add('hidden');
  writeResults.classList.add('hidden');
  securityResults.classList.add('hidden');
  flowResults.classList.add('hidden');
  setMessage(auditMessage, '');

  if (!currentUser || !session?.access_token) {
    loginForm.classList.remove('hidden');
    sessionPanel.classList.add('hidden');
    auditCard.setAttribute('aria-disabled', 'true');
    auditButton.disabled = true;
    setStatus(authStatus, 'Non connecté', 'neutral');
    setStatus(auditStatus, 'En attente', 'neutral');
    setMessage(authMessage, 'Connexion gérée uniquement par Supabase Auth sur ce staging.');
    refreshWriteAvailability();
    refreshSecurityAvailability();
    refreshBusinessFlowUI();
    return;
  }

  loginForm.classList.add('hidden');
  sessionPanel.classList.remove('hidden');
  sessionAccount.textContent = currentUser.email ? currentUser.email.replace(/(^.).*(@.*$)/, '$1••••$2') : 'Compte Supabase connecté';
  setStatus(authStatus, 'Supabase connecté', 'success');
  setMessage(authMessage, 'Session Supabase Auth native ouverte. Aucun SDK Firebase n’est chargé.', 'success');

  try {
    const { profile } = await readSupabaseProfile(session.access_token, currentUser.id);
    currentProfile = profile;
    auditCard.setAttribute('aria-disabled', 'false');
    auditButton.disabled = false;
    setStatus(auditStatus, 'Prêt', 'neutral');
    setMessage(auditMessage, `Profil métier ${profile.role} relié à auth.users. Lance le contrôle Supabase.`);
  } catch (error) {
    console.error(error);
    auditCard.setAttribute('aria-disabled', 'true');
    auditButton.disabled = true;
    setStatus(auditStatus, 'Profil non relié', 'error');
    setMessage(auditMessage, readableError(error), 'error');
  }

  refreshWriteAvailability();
  refreshSecurityAvailability();
  refreshBusinessFlowUI();
}

supabaseClient.auth.onAuthStateChange((_event, session) => {
  window.setTimeout(() => {
    applyAuthSession(session).catch((error) => {
      console.error(error);
      setStatus(authStatus, 'Erreur session', 'error');
      setMessage(authMessage, readableError(error), 'error');
    });
  }, 0);
});

