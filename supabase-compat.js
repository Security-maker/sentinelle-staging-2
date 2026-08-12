import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { stagingConfig } from './sentinelle-config.js';

const CORE = Object.freeze({
  users: { table:'profiles', id:'external_uid' },
  sites: { table:'sites', id:'firebase_id' },
  missions: { table:'missions', id:'firebase_id' },
  shifts: { table:'shifts', id:'firebase_id' },
  reports: { table:'reports', id:'firebase_id' },
  generatedDocuments: { table:'generated_documents', id:'firebase_id' },
  auditLogs: { table:'audit_logs', id:'id' }
});

const supabase = createClient(stagingConfig.supabaseUrl, stagingConfig.supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: 'sentinelle-pro-v590-auth'
  }
});

let compatUserCache = null;
let profileCache = null;

class CompatTimestamp {
  constructor(value){
    const d = value instanceof Date ? value : new Date(value);
    this._iso = Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }
  toDate(){ return new Date(this._iso); }
  toJSON(){ return this._iso; }
  valueOf(){ return this.toDate().getTime(); }
  toString(){ return this._iso; }
}

export const Timestamp = Object.freeze({
  now: () => new CompatTimestamp(new Date()),
  fromDate: date => new CompatTimestamp(date)
});
export const serverTimestamp = () => new CompatTimestamp(new Date());

function looksIso(value){
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) && !Number.isNaN(new Date(value).getTime());
}
function revive(value){
  if (value == null) return value;
  if (looksIso(value)) return new CompatTimestamp(value);
  if (Array.isArray(value)) return value.map(revive);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,revive(v)]));
  return value;
}
function plain(value){
  if (value instanceof CompatTimestamp) return value.toJSON();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === 'object') {
    const out={};
    for (const [k,v] of Object.entries(value)) if (v !== undefined) out[k]=plain(v);
    return out;
  }
  return value;
}
function deepClone(value){ return revive(plain(value)); }
function deepMerge(base, patch){
  const out = Array.isArray(base) ? [...base] : (base && typeof base === 'object' ? {...base} : {});
  for (const [rawKey,rawValue] of Object.entries(patch || {})) {
    if (rawKey.includes('.')) { deepSet(out, rawKey, rawValue); continue; }
    const value = rawValue;
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof CompatTimestamp) && !(value instanceof Date) && out[rawKey] && typeof out[rawKey] === 'object' && !Array.isArray(out[rawKey])) out[rawKey]=deepMerge(out[rawKey],value);
    else out[rawKey]=value;
  }
  return out;
}
function deepSet(target, path, value){
  const parts=String(path).split('.').filter(Boolean);
  let cur=target;
  parts.forEach((part,index)=>{
    if(index===parts.length-1) cur[part]=value;
    else { if(!cur[part] || typeof cur[part] !== 'object' || Array.isArray(cur[part])) cur[part]={}; cur=cur[part]; }
  });
}
function deepGet(target, path){
  return String(path).split('.').reduce((cur,part)=>cur==null?undefined:cur[part],target);
}
function toIso(value){
  if (!value) return null;
  if (value instanceof CompatTimestamp) return value.toJSON();
  if (value instanceof Date) return value.toISOString();
  const d=new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function randomId(){
  const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes=crypto.getRandomValues(new Uint8Array(20));
  return Array.from(bytes,b=>alphabet[b%alphabet.length]).join('');
}
function currentExternalUid(){ return compatUserCache?.uid || profileCache?.external_uid || null; }

const signedUrlCache = new Map();
function mediaSafeSegment(value){
  return String(value || 'inconnu').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9_-]+/gi,'-').replace(/^-+|-+$/g,'').toLowerCase() || 'inconnu';
}
function isImageDataUrl(value){ return typeof value === 'string' && /^data:image\/[a-z0-9.+-]+;base64,/i.test(value); }
function dataUrlToBlob(value){
  const match=String(value||'').match(/^data:([^;]+);base64,(.+)$/s);
  if(!match) throw new Error('Image encodée invalide.');
  const binary=atob(match[2]);
  const bytes=new Uint8Array(binary.length);
  for(let i=0;i<binary.length;i++) bytes[i]=binary.charCodeAt(i);
  return new Blob([bytes],{type:match[1]||'image/jpeg'});
}
function extensionForMime(mime){
  const m=String(mime||'').toLowerCase();
  if(m.includes('png')) return 'png';
  if(m.includes('webp')) return 'webp';
  return 'jpg';
}
async function uploadPrivateImage({owner,id,kind,dataUrl}){
  if(!isImageDataUrl(dataUrl)) return null;
  const blob=dataUrlToBlob(dataUrl);
  const ext=extensionForMime(blob.type);
  const path=`${stagingConfig.organizationId}/${mediaSafeSegment(owner)}/${mediaSafeSegment(kind)}/${mediaSafeSegment(id)}.${ext}`;
  const {error}=await supabase.storage.from(stagingConfig.reportPhotoBucket||'report-photos')
    .upload(path,blob,{contentType:blob.type||'image/jpeg',upsert:true,cacheControl:'3600'});
  if(error) throw error;
  return {bucket:stagingConfig.reportPhotoBucket||'report-photos',path,mimeType:blob.type,size:blob.size};
}
async function signedPrivateUrl(bucket,path,expiresIn=3600){
  if(!bucket||!path) return '';
  const key=`${bucket}:${path}`;
  const cached=signedUrlCache.get(key);
  if(cached && cached.expiresAt>Date.now()+60000) return cached.url;
  const {data,error}=await supabase.storage.from(bucket).createSignedUrl(path,expiresIn);
  if(error) throw error;
  const url=String(data?.signedUrl||'');
  if(url) signedUrlCache.set(key,{url,expiresAt:Date.now()+Math.max(60,expiresIn-60)*1000});
  return url;
}
async function removePrivateObject(bucket,path){
  if(!bucket||!path) return;
  const {error}=await supabase.storage.from(bucket).remove([path]);
  if(error) throw error;
  signedUrlCache.delete(`${bucket}:${path}`);
}
async function prepareCoreMedia(path,id,data,existing){
  const incoming=normalizeDataObject(data);
  if(path==='reports' && isImageDataUrl(incoming.photoUrl)){
    const owner=incoming.agentId||existing?.firebase_agent_uid||currentExternalUid();
    const uploaded=await uploadPrivateImage({owner,id,kind:'reports',dataUrl:incoming.photoUrl});
    incoming.photoUrl=null;
    incoming.photoAvailable=true;
    incoming.photoStorageBucket=uploaded.bucket;
    incoming.photoStoragePath=uploaded.path;
    incoming.photoMimeType=incoming.photoMimeType||uploaded.mimeType;
    incoming.photoBytes=Number(incoming.photoBytes||uploaded.size||0);
  }
  if(path==='users' && Object.prototype.hasOwnProperty.call(incoming,'badgePhotoDataUrl')){
    const currentPayload=existing?.firebase_payload||{};
    if(isImageDataUrl(incoming.badgePhotoDataUrl)){
      const uploaded=await uploadPrivateImage({owner:id,id:'profile',kind:'badge',dataUrl:incoming.badgePhotoDataUrl});
      incoming.badgePhotoDataUrl=null;
      incoming.badgePhotoStorageBucket=uploaded.bucket;
      incoming.badgePhotoStoragePath=uploaded.path;
    }else if(incoming.badgePhotoDataUrl===''){
      const oldBucket=currentPayload.badgePhotoStorageBucket;
      const oldPath=currentPayload.badgePhotoStoragePath;
      if(oldBucket&&oldPath) await removePrivateObject(oldBucket,oldPath).catch(()=>{});
      incoming.badgePhotoStorageBucket=null;
      incoming.badgePhotoStoragePath=null;
    }
  }
  return incoming;
}
async function hydrateDecodedMedia(path,row,decoded){
  if(!decoded) return decoded;
  if(path==='reports' && row?.photo_bucket && row?.photo_path){
    decoded.photoStorageBucket=row.photo_bucket;
    decoded.photoStoragePath=row.photo_path;
    decoded.photoUrl=await signedPrivateUrl(row.photo_bucket,row.photo_path).catch(()=>decoded.photoUrl||'');
    decoded.photoAvailable=Boolean(decoded.photoUrl||row.photo_path);
  }
  if(path==='users'){
    const bucket=decoded.badgePhotoStorageBucket;
    const mediaPath=decoded.badgePhotoStoragePath;
    if(bucket&&mediaPath) decoded.badgePhotoDataUrl=await signedPrivateUrl(bucket,mediaPath).catch(()=>decoded.badgePhotoDataUrl||'');
  }
  if(path==='generatedDocuments' && Array.isArray(decoded?.payload?.rows)){
    decoded.payload.rows=await Promise.all(decoded.payload.rows.map(async report=>{
      const bucket=report?.photoStorageBucket;
      const mediaPath=report?.photoStoragePath;
      if(!bucket||!mediaPath) return report;
      const photoUrl=await signedPrivateUrl(bucket,mediaPath).catch(()=>report.photoUrl||'');
      return {...report,photoUrl,photoAvailable:Boolean(photoUrl||mediaPath)};
    }));
    if(Array.isArray(decoded.payload.timelineRows)){
      const byId=new Map(decoded.payload.rows.map(report=>[String(report?.id||''),report]));
      decoded.payload.timelineRows=decoded.payload.timelineRows.map(row=>{
        const hit=byId.get(String(row?.id||''));
        return hit ? {...row,photoUrl:hit.photoUrl,photoAvailable:hit.photoAvailable,photoStorageBucket:hit.photoStorageBucket,photoStoragePath:hit.photoStoragePath} : row;
      });
    }
  }
  return decoded;
}
async function prepareGenericMedia(path,id,data,existingPayload={}){
  const combined=normalizeDataObject(data);
  if(path==='shiftProofs' && isImageDataUrl(combined.imageDataUrl)){
    const owner=combined.agentId||existingPayload.agentId||currentExternalUid();
    const uploaded=await uploadPrivateImage({owner,id,kind:'shift-proofs',dataUrl:combined.imageDataUrl});
    combined.imageDataUrl=null;
    combined.storageBucket=uploaded.bucket;
    combined.storagePath=uploaded.path;
    combined.mimeType=combined.mimeType||uploaded.mimeType;
    combined.bytes=Number(combined.bytes||uploaded.size||0);
  }
  return combined;
}
async function hydrateGenericMedia(path,payload){
  const out=deepClone(payload||{});
  if(path==='shiftProofs' && out.storageBucket&&out.storagePath){
    out.imageDataUrl=await signedPrivateUrl(out.storageBucket,out.storagePath).catch(()=>out.imageDataUrl||'');
  }
  return out;
}

async function loadCompatUser(user, session=null){
  if (!user) { compatUserCache=null; profileCache=null; return null; }
  const { data:profile, error } = await supabase.from('profiles')
    .select('id,organization_id,auth_user_id,external_uid,role,first_name,last_name,email,phone,active,firebase_payload')
    .eq('auth_user_id', user.id).maybeSingle();
  if (error) throw error;
  if (!profile) {
    const accessToken = session?.access_token || (await supabase.auth.getSession()).data.session?.access_token || null;
    return {
      uid:user.id, supabaseUid:user.id, email:user.email || '', emailVerified:Boolean(user.email_confirmed_at),
      __missingProfile:true,
      getIdToken: async()=>accessToken
    };
  }
  profileCache=profile;
  const accessToken = session?.access_token || (await supabase.auth.getSession()).data.session?.access_token || null;
  compatUserCache={
    uid:profile.external_uid || user.id,
    supabaseUid:user.id,
    email:user.email || profile.email || '',
    emailVerified:Boolean(user.email_confirmed_at),
    getIdToken: async()=> (await supabase.auth.getSession()).data.session?.access_token || accessToken
  };
  return compatUserCache;
}

export function initializeApp(){ return { kind:'supabase-production-v590' }; }
export function deleteApp(){ return Promise.resolve(); }
export function getAuth(){ return { kind:'supabase-auth-v587' }; }
export const browserLocalPersistence = 'supabase-local';
export async function setPersistence(){ return true; }
export async function signInWithEmailAndPassword(_auth,email,password){
  const { data, error } = await supabase.auth.signInWithPassword({ email:String(email||'').trim(), password:String(password||'') });
  if (error) throw error;
  return { user:await loadCompatUser(data.user,data.session) };
}
export async function createUserWithEmailAndPassword(){
  throw new Error('Utilise la fonction Edge admin-manage-user de Sentinelle Pro.');
}
export async function signOut(){
  compatUserCache=null; profileCache=null;
  const { error }=await supabase.auth.signOut();
  if(error) throw error;
}
export function onAuthStateChanged(_auth, callback){
  let active=true;
  let initialized=false;
  supabase.auth.getSession().then(async ({data,error})=>{
    if(!active) return;
    if(error){ console.warn('Session Supabase indisponible',error); return callback(null); }
    initialized=true;
    try { callback(await loadCompatUser(data.session?.user || null,data.session)); }
    catch(e){ console.error(e); callback(null); }
  });
  const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,session)=>{
    // Évite l'écho INITIAL_SESSION déjà traité par getSession().
    if(!active || (!initialized && _event==='INITIAL_SESSION')) return;
    queueMicrotask(async()=>{
      if(!active) return;
      try { callback(await loadCompatUser(session?.user || null,session)); }
      catch(e){ console.error(e); callback(null); }
    });
  });
  return ()=>{ active=false; subscription?.unsubscribe?.(); };
}

export function initializeFirestore(){ return { kind:'supabase-db-v587' }; }
export function persistentLocalCache(){ return null; }
export function persistentMultipleTabManager(){ return null; }

function makeCollection(path){ return { __kind:'collection', path:String(path) }; }
function makeDoc(path,id){ return { __kind:'doc', path:String(path), id:String(id) }; }
export function collection(parent,...segments){
  const base = parent?.__kind==='doc' || parent?.__kind==='collection' ? parent.path + (parent.id?`/${parent.id}`:'') : '';
  return makeCollection([base,...segments.map(String)].filter(Boolean).join('/'));
}
export function doc(parent,...segments){
  if(parent?.__kind==='collection'){
    if(!segments.length) return makeDoc(parent.path,randomId());
    if(segments.length===1) return makeDoc(parent.path,segments[0]);
    const all=[parent.path,...segments.map(String)];
    return makeDoc(all.slice(0,-1).join('/'),all.at(-1));
  }
  const all=segments.map(String);
  if(!all.length) throw new Error('Référence document invalide.');
  return makeDoc(all.slice(0,-1).join('/'),all.at(-1));
}
export const where=(field,op,value)=>({type:'where',field,op,value});
export const orderBy=(field,direction='asc')=>({type:'orderBy',field,direction});
export const limit=(count)=>({type:'limit',count:Number(count||0)});
export function query(ref,...constraints){ return { __kind:'query', ref, constraints:constraints.flat().filter(Boolean) }; }

class DocSnapshot {
  constructor(ref,data){ this.ref=ref; this.id=ref.id; this._data=data; }
  exists(){ return this._data != null; }
  data(){ return this._data == null ? undefined : deepClone(this._data); }
}
class QuerySnapshot {
  constructor(docs){ this.docs=docs; this.empty=!docs.length; this.size=docs.length; }
  forEach(fn){ this.docs.forEach(fn); }
}

function logicalCollection(ref){
  const path=ref?.__kind==='query'?ref.ref.path:ref.path;
  return String(path||'');
}
function coreFor(path){ return CORE[path] || null; }

function decodeCore(path,row){
  if(!row) return null;
  if(path==='users'){
    const payload=revive(row.firebase_payload||{});
    return deepMerge(payload,{
      uid:row.external_uid, prenom:row.first_name, nom:row.last_name, email:row.email, telephone:row.phone,
      role:row.role, active:row.active, authUserId:row.auth_user_id
    });
  }
  if(path==='sites') return deepMerge(revive(row.payload||{}),{ name:row.name,address:row.address,clientName:row.client_name,reportEmail:row.report_email,isActive:row.active,updatedAt:revive(row.updated_at),createdAt:revive(row.created_at) });
  if(path==='missions') return deepMerge(revive(row.payload||{}),{ agentId:row.firebase_agent_uid,siteId:row.firebase_site_id,status:row.status,scheduledStart:revive(row.scheduled_start),scheduledEnd:revive(row.scheduled_end),actualStart:revive(row.actual_start),actualEnd:revive(row.actual_end),updatedAt:revive(row.updated_at),createdAt:revive(row.created_at) });
  if(path==='shifts') return deepMerge(revive(row.payload||{}),{ agentId:row.firebase_agent_uid,siteId:row.firebase_site_id,missionId:row.firebase_mission_id,status:row.status,startTime:revive(row.started_at),completedAt:revive(row.completed_at),updatedAt:revive(row.updated_at),createdAt:revive(row.created_at) });
  if(path==='reports') return deepMerge(revive(row.payload||{}),{ agentId:row.firebase_agent_uid,siteId:row.firebase_site_id,missionId:row.firebase_mission_id,shiftId:row.firebase_shift_id,category:row.category,severity:row.severity,message:row.message,createdAt:revive(row.occurred_at||row.created_at),photoStorageBucket:row.photo_bucket,photoStoragePath:row.photo_path,updatedAt:revive(row.updated_at) });
  if(path==='generatedDocuments') return {
    id:row.firebase_id, siteId:row.firebase_site_id, missionId:row.firebase_mission_id, type:row.type, title:row.title,
    rowCount:row.row_count, payload:revive(row.payload||{}), status:row.status, deliveryStatus:row.delivery_status,
    createdBy:row.created_by_external_uid, createdAt:revive(row.created_at), updatedAt:revive(row.updated_at),
    storageBucket:row.storage_bucket, storagePath:row.storage_path
  };
  if(path==='auditLogs'){
    const details=revive(row.details||{});
    return { action:row.action, details, userId:row.actor_external_uid, userRole:details.__userRole||null, userAgent:details.__userAgent||null, createdAt:revive(row.created_at) };
  }
  return revive(row);
}
function idForCore(path,row){
  const cfg=coreFor(path);
  return String(row?.[cfg.id] ?? '');
}

async function readRows(path){
  const cfg=coreFor(path);
  if(cfg){
    const {data,error}=await supabase.from(cfg.table).select('*');
    if(error) throw error;
    return Promise.all((data||[]).map(async row=>({id:idForCore(path,row),data:await hydrateDecodedMedia(path,row,decodeCore(path,row))})));
  }
  const {data,error}=await supabase.from('compat_records').select('external_id,payload').eq('collection_name',path);
  if(error) throw error;
  return Promise.all((data||[]).map(async row=>({id:String(row.external_id),data:await hydrateGenericMedia(path,revive(row.payload||{}))})));
}
async function readOne(path,id){
  const cfg=coreFor(path);
  if(cfg){
    const {data,error}=await supabase.from(cfg.table).select('*').eq(cfg.id,id).maybeSingle();
    if(error) throw error;
    return data?await hydrateDecodedMedia(path,data,decodeCore(path,data)):null;
  }
  const {data,error}=await supabase.from('compat_records').select('payload').eq('collection_name',path).eq('external_id',id).maybeSingle();
  if(error) throw error;
  return data?await hydrateGenericMedia(path,revive(data.payload||{})):null;
}

function comparable(value){
  if(value instanceof CompatTimestamp) return value.valueOf();
  if(value instanceof Date) return value.getTime();
  if(looksIso(value)) return new Date(value).getTime();
  return value;
}
function matches(data,c){
  const actual=deepGet(data,c.field), expected=c.value;
  const a=comparable(actual), e=comparable(expected);
  switch(c.op){
    case '==': return a===e || String(a??'')===String(e??'');
    case '!=': return !(a===e || String(a??'')===String(e??''));
    case '>': return a>e; case '>=': return a>=e; case '<': return a<e; case '<=': return a<=e;
    case 'in': return Array.isArray(expected)&&expected.some(x=>String(comparable(x))===String(a));
    case 'array-contains': return Array.isArray(actual)&&actual.some(x=>String(comparable(x))===String(e));
    default: return true;
  }
}
function applyConstraints(rows,constraints=[]){
  let out=[...rows];
  for(const c of constraints.filter(x=>x.type==='where')) out=out.filter(row=>matches(row.data,c));
  const orders=constraints.filter(x=>x.type==='orderBy');
  if(orders.length) out.sort((ra,rb)=>{
    for(const c of orders){
      const a=comparable(deepGet(ra.data,c.field)), b=comparable(deepGet(rb.data,c.field));
      if(a==null&&b==null) continue; if(a==null) return 1; if(b==null) return -1;
      const diff = a<b?-1:a>b?1:0; if(diff) return c.direction==='desc'?-diff:diff;
    }
    return 0;
  });
  const l=constraints.find(x=>x.type==='limit');
  if(l&&l.count>=0) out=out.slice(0,l.count);
  return out;
}
export async function getDoc(ref){ return new DocSnapshot(ref,await readOne(ref.path,ref.id)); }
export async function getDocs(ref){
  const path=logicalCollection(ref), constraints=ref?.__kind==='query'?ref.constraints:[];
  const rows=applyConstraints(await readRows(path),constraints);
  return new QuerySnapshot(rows.map(row=>new DocSnapshot(makeDoc(path,row.id),row.data)));
}

function onlyOperationalPatch(data){
  const allowed=new Set(['statut','siteActuel','siteActuelNom','lastSeen','isOnline']);
  const keys=Object.keys(data||{});
  return keys.length>0 && keys.every(key=>allowed.has(key));
}
async function updateOwnOperationalProfile(id,data){
  if(id!==currentExternalUid() || !onlyOperationalPatch(data)) return false;
  const {error}=await supabase.rpc('sentinelle_v586_update_my_state',{p_patch:plain(data)});
  if(error) throw error;
  if(profileCache?.firebase_payload) profileCache.firebase_payload=deepMerge(profileCache.firebase_payload,plain(data));
  return true;
}

async function existingCoreRow(path,id){
  const cfg=coreFor(path);
  const {data,error}=await supabase.from(cfg.table).select('*').eq(cfg.id,id).maybeSingle();
  if(error) throw error;
  return data;
}
function normalizeDataObject(data){
  const out={};
  for(const [k,v] of Object.entries(data||{})){
    if(k.includes('.')) deepSet(out,k,v); else out[k]=v;
  }
  return out;
}
async function buildCoreRecord(path,id,data,{merge=false}={}){
  const incoming=normalizeDataObject(data);
  const existing=merge?await existingCoreRow(path,id):null;
  const previous=existing?decodeCore(path,existing):{};
  const combined=merge?deepMerge(previous,incoming):incoming;
  const payload=plain(combined);
  const org=stagingConfig.organizationId;
  if(path==='users') return {
    organization_id:org, external_uid:id,
    role:combined.role||existing?.role||'agent', first_name:combined.prenom??existing?.first_name??null,
    last_name:combined.nom??existing?.last_name??null, email:combined.email??existing?.email??null,
    phone:combined.telephone??existing?.phone??null, active:combined.active!==false,
    firebase_payload:payload, updated_at:new Date().toISOString()
  };
  if(path==='sites') return { organization_id:org,firebase_id:id,name:combined.name||combined.siteNom||id,address:combined.address||null,client_name:combined.clientName||null,report_email:combined.reportEmail||combined.clientEmail||combined.billingEmail||null,active:combined.isActive!==false,payload,updated_at:new Date().toISOString() };
  if(path==='missions') return { organization_id:org,firebase_id:id,firebase_site_id:combined.siteId||null,firebase_agent_uid:combined.agentId||null,status:combined.status||null,scheduled_start:toIso(combined.scheduledStart),scheduled_end:toIso(combined.scheduledEnd),actual_start:toIso(combined.actualStart),actual_end:toIso(combined.actualEnd),payload,updated_at:new Date().toISOString() };
  if(path==='shifts') return { organization_id:org,firebase_id:id,firebase_mission_id:combined.missionId||null,firebase_site_id:combined.siteId||null,firebase_agent_uid:combined.agentId||null,status:combined.status||null,started_at:toIso(combined.startTime),completed_at:toIso(combined.completedAt),payload,updated_at:new Date().toISOString() };
  if(path==='reports') return { organization_id:org,firebase_id:id,firebase_mission_id:combined.missionId||null,firebase_shift_id:combined.shiftId||null,firebase_site_id:combined.siteId||null,firebase_agent_uid:combined.agentId||null,occurred_at:toIso(combined.occurredAt||combined.createdAt||combined.photoCapturedAt)||new Date().toISOString(),category:combined.category||null,severity:combined.severity||null,message:combined.message||null,photo_bucket:combined.photoStorageBucket||existing?.photo_bucket||null,photo_path:combined.photoStoragePath||existing?.photo_path||null,payload,updated_at:new Date().toISOString() };
  if(path==='generatedDocuments') return { organization_id:org,firebase_id:id,firebase_site_id:combined.siteId||null,firebase_mission_id:combined.missionId||null,type:combined.type||'mission',title:combined.title||'Document Sentinelle',row_count:Number(combined.rowCount||0),storage_bucket:'main-courantes',storage_path:existing?.storage_path||`${org}/v587-metadata/${id}.pdf`,payload:plain(combined.payload||{}),status:combined.status||'active',delivery_status:combined.deliveryStatus||'v587_metadata_only',created_by_external_uid:combined.createdBy||currentExternalUid(),updated_at:new Date().toISOString() };
  throw new Error(`Collection core non prise en charge : ${path}`);
}
async function writeCore(path,id,data,{merge=false,insertOnly=false}={}){
  if(path==='users' && await updateOwnOperationalProfile(id,data)) return makeDoc(path,id);
  const cfg=coreFor(path);
  if(path==='auditLogs'){
    const details=plain({...data.details,__userRole:data.userRole??null,__userAgent:data.userAgent??null});
    const row={organization_id:stagingConfig.organizationId,actor_external_uid:data.userId||currentExternalUid(),action:data.action||'event',details,created_at:toIso(data.createdAt)||new Date().toISOString()};
    const {data:created,error}=await supabase.from('audit_logs').insert(row).select('id').single();
    if(error) throw error;
    return makeDoc(path,String(created.id));
  }
  const existing=insertOnly?null:await existingCoreRow(path,id);
  const prepared=await prepareCoreMedia(path,id,data,existing);
  const record=await buildCoreRecord(path,id,prepared,{merge:Boolean(existing)||merge});
  let result;
  if(existing) result=await supabase.from(cfg.table).update(record).eq(cfg.id,id).select(cfg.id).maybeSingle();
  else result=await supabase.from(cfg.table).insert(record).select(cfg.id).single();
  if(result.error) throw result.error;
  return makeDoc(path,id);
}
function ownerFor(path,payload){
  const first=String(path).split('/')[0];
  return payload.agentId||payload.userId||payload.createdBy||(first==='planningAcknowledgements'?String(path).split('/')[1]:null)||currentExternalUid();
}
async function writeGeneric(path,id,data,{merge=false}={}){
  const prev=merge?await readOne(path,id):null;
  const prepared=await prepareGenericMedia(path,id,data,prev||{});
  let combined=prepared;
  if(merge) combined=deepMerge(prev||{},prepared);
  const row={organization_id:stagingConfig.organizationId,collection_name:path,external_id:id,owner_external_uid:ownerFor(path,combined),payload:plain(combined),updated_at:new Date().toISOString()};
  const {data:existing,error:readError}=await supabase.from('compat_records').select('id').eq('collection_name',path).eq('external_id',id).maybeSingle();
  if(readError) throw readError;
  const result=existing?await supabase.from('compat_records').update(row).eq('id',existing.id):await supabase.from('compat_records').insert(row);
  if(result.error) throw result.error;
  return makeDoc(path,id);
}
export async function addDoc(ref,data){
  const id=randomId(), path=ref.path;
  return coreFor(path)?writeCore(path,id,data,{insertOnly:true}):writeGeneric(path,id,data,{merge:false});
}
export async function setDoc(ref,data,options={}){
  return coreFor(ref.path)?writeCore(ref.path,ref.id,data,{merge:Boolean(options.merge)}):writeGeneric(ref.path,ref.id,data,{merge:Boolean(options.merge)});
}
export async function updateDoc(ref,data){
  if(coreFor(ref.path)){
    const existing=await existingCoreRow(ref.path,ref.id);
    if(!existing && ref.path!=='auditLogs') throw new Error(`Document introuvable : ${ref.path}/${ref.id}`);
    return writeCore(ref.path,ref.id,data,{merge:true});
  }
  const existing=await readOne(ref.path,ref.id);
  if(!existing) throw new Error(`Document introuvable : ${ref.path}/${ref.id}`);
  return writeGeneric(ref.path,ref.id,data,{merge:true});
}
export async function deleteDoc(ref){
  const cfg=coreFor(ref.path);
  if(cfg){
    if(ref.path==='reports'){
      const existing=await existingCoreRow('reports',ref.id).catch(()=>null);
      if(existing?.photo_bucket&&existing?.photo_path) await removePrivateObject(existing.photo_bucket,existing.photo_path).catch(()=>{});
    }
    if(ref.path==='users'){
      const existing=await existingCoreRow('users',ref.id).catch(()=>null);
      const payload=existing?.firebase_payload||{};
      if(payload.badgePhotoStorageBucket&&payload.badgePhotoStoragePath) await removePrivateObject(payload.badgePhotoStorageBucket,payload.badgePhotoStoragePath).catch(()=>{});
    }
    const {error}=await supabase.from(cfg.table).delete().eq(cfg.id,ref.id);
    if(error) throw error;
    return;
  }
  if(ref.path==='shiftProofs'){
    const existing=await readOne(ref.path,ref.id).catch(()=>null);
    if(existing?.storageBucket&&existing?.storagePath) await removePrivateObject(existing.storageBucket,existing.storagePath).catch(()=>{});
  }
  const {error}=await supabase.from('compat_records').delete().eq('collection_name',ref.path).eq('external_id',ref.id);
  if(error) throw error;
}

export function onSnapshot(ref,next,error){
  let stopped=false, running=false, fingerprint='';
  const poll=async()=>{
    if(stopped||running) return; running=true;
    try{
      const snap=ref.__kind==='doc'?await getDoc(ref):await getDocs(ref);
      const raw=ref.__kind==='doc'?(snap.exists()?snap.data():null):snap.docs.map(d=>[d.id,d.data()]);
      const nextPrint=JSON.stringify(plain(raw));
      if(nextPrint!==fingerprint){ fingerprint=nextPrint; next(snap); }
    }catch(e){ if(!stopped){ console.warn('Flux Supabase indisponible',e); error?.(e); } }
    finally{running=false;}
  };
  poll();
  const timer=setInterval(poll,3500);
  return ()=>{stopped=true;clearInterval(timer);};
}

export function writeBatch(){
  const ops=[];
  return {
    set:(ref,data,options={})=>ops.push(()=>setDoc(ref,data,options)),
    update:(ref,data)=>ops.push(()=>updateDoc(ref,data)),
    delete:(ref)=>ops.push(()=>deleteDoc(ref)),
    commit:async()=>{ for(const op of ops) await op(); }
  };
}
export async function runTransaction(_db,handler){
  const ops=[];
  const tx={
    get:getDoc,
    set:(ref,data,options={})=>ops.push(()=>setDoc(ref,data,options)),
    update:(ref,data)=>ops.push(()=>updateDoc(ref,data)),
    delete:(ref)=>ops.push(()=>deleteDoc(ref))
  };
  const result=await handler(tx);
  for(const op of ops) await op();
  return result;
}

export function getSupabaseClient(){ return supabase; }
export function supabaseRuntimeConfigured(){
  return Boolean(stagingConfig.supabaseUrl && stagingConfig.supabasePublishableKey && stagingConfig.organizationId);
}
