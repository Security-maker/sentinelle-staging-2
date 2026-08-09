import { supabaseConfig } from './supabase-config.js';

let clientPromise = null;

function isConfigured(){
  return Boolean(
    supabaseConfig.enabled &&
    ['dual','supabase'].includes(supabaseConfig.mode) &&
    supabaseConfig.url && !String(supabaseConfig.url).includes('REMPLACE_MOI') &&
    supabaseConfig.publishableKey && !String(supabaseConfig.publishableKey).includes('REMPLACE_MOI') &&
    supabaseConfig.organizationId && !String(supabaseConfig.organizationId).includes('REMPLACE_MOI')
  );
}

export function supabaseBridgeEnabled(){
  return isConfigured();
}

async function getClient(firebaseUser){
  if (!isConfigured()) return null;
  if (!clientPromise) {
    clientPromise = import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm')
      .then(({ createClient }) => createClient(
        supabaseConfig.url,
        supabaseConfig.publishableKey,
        {
          accessToken: async () => firebaseUser ? await firebaseUser.getIdToken(false) : null,
          auth: { persistSession:false, autoRefreshToken:false, detectSessionInUrl:false }
        }
      ));
  }
  return clientPromise;
}

function slug(value){
  return String(value || 'document')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9_-]+/gi,'-').replace(/^-+|-+$/g,'').toLowerCase() || 'document';
}

export async function mirrorGeneratedDocument({ firebaseUser, profile, document, pdfBlob }){
  const client = await getClient(firebaseUser);
  if (!client) return { skipped:true };
  if (!(pdfBlob instanceof Blob)) throw new Error('PDF absent pour la passerelle Supabase.');

  const organizationId = supabaseConfig.organizationId;
  const siteId = String(document.siteId || 'sans-site');
  const missionId = String(document.missionId || document.id || 'sans-mission');
  const filename = `${slug(document.title || document.id)}.pdf`;
  const storagePath = `${organizationId}/${slug(siteId)}/${slug(missionId)}/${document.id}-${filename}`;

  const upload = await client.storage
    .from(supabaseConfig.reportBucket)
    .upload(storagePath, pdfBlob, { contentType:'application/pdf', upsert:true, cacheControl:'3600' });
  if (upload.error) throw upload.error;

  const record = {
    organization_id: organizationId,
    firebase_id: document.id,
    firebase_site_id: document.siteId || null,
    firebase_mission_id: document.missionId || null,
    type: document.type || 'mission',
    title: document.title || 'Main courante',
    row_count: Number(document.rowCount || 0),
    storage_bucket: supabaseConfig.reportBucket,
    storage_path: storagePath,
    payload: document.payload || {},
    status: 'active',
    created_by_external_uid: firebaseUser?.uid || profile?.uid || null
  };

  const { data, error } = await client
    .from('generated_documents')
    .upsert(record, { onConflict:'organization_id,firebase_id' })
    .select('id')
    .single();
  if (error) throw error;

  let emailQueued = false;
  if (supabaseConfig.autoEmail && document.type === 'mission') {
    const invoke = await client.functions.invoke(supabaseConfig.emailFunction, { body:{ documentId:data.id } });
    if (invoke.error) throw invoke.error;
    emailQueued = Boolean(invoke.data?.sent || invoke.data?.alreadySent || invoke.data?.queued);
  }
  return { documentId:data.id, storagePath, emailQueued };
}
