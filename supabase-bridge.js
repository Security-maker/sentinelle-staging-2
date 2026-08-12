import { supabaseConfig } from './supabase-config.js?v=510';
import { getSupabaseClient } from './supabase-compat.js?v=593';

function isConfigured(){
  return Boolean(
    supabaseConfig.enabled &&
    supabaseConfig.mode === 'supabase' &&
    supabaseConfig.url &&
    supabaseConfig.publishableKey &&
    supabaseConfig.organizationId
  );
}

export function supabaseBridgeEnabled(){ return isConfigured(); }

function slug(value){
  return String(value || 'document')
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9_-]+/gi,'-').replace(/^-+|-+$/g,'').toLowerCase() || 'document';
}

export async function mirrorGeneratedDocument({ firebaseUser, profile, document, pdfBlob }){
  if (!isConfigured()) return { skipped:true };
  if (!(pdfBlob instanceof Blob)) throw new Error('PDF absent pour Supabase Storage.');
  const client = getSupabaseClient();
  const organizationId = supabaseConfig.organizationId;
  const ownerId = String(firebaseUser?.uid || profile?.uid || 'qg');
  const siteId = String(document.siteId || 'sans-site');
  const missionId = String(document.missionId || document.id || 'sans-mission');
  const filename = `${slug(document.title || document.id)}.pdf`;
  const storagePath = `${organizationId}/${slug(ownerId)}/${slug(siteId)}/${slug(missionId)}/${document.id}-${filename}`;

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
    created_by_external_uid: ownerId,
    delivery_status: 'supabase_archived'
  };

  const { data, error } = await client
    .from('generated_documents')
    .upsert(record, { onConflict:'organization_id,firebase_id' })
    .select('id')
    .single();
  if (error) throw error;

  let emailQueued = false;
  let emailStatus = null;
  let emailError = null;
  if (supabaseConfig.autoEmail && document.type === 'mission') {
    const invoke = await client.functions.invoke(supabaseConfig.emailFunction, { body:{ documentId:data.id } });
    if (invoke.error) {
      // Le PDF est déjà correctement archivé : une panne de fonction/e-mail ne doit
      // jamais annuler l'archivage. On place explicitement le document dans la file
      // de relance afin que le cron serveur puisse reprendre sans intervention agent.
      emailError = String(invoke.error?.message || invoke.error);
      emailStatus = 'retry_pending';
      emailQueued = true;
      const nextAttempt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
      const queued = await client.from('generated_documents').update({
        delivery_status:'retry_pending',
        next_delivery_attempt_at:nextAttempt,
        delivery_error:emailError,
        updated_at:new Date().toISOString()
      }).eq('id',data.id);
      if (queued.error) console.warn('Mise en file de relance impossible', queued.error);
      console.warn('Envoi immédiat main courante indisponible, reprise cron prévue', invoke.error);
    } else {
      emailStatus = invoke.data?.status || null;
      emailQueued = Boolean(invoke.data?.sent || invoke.data?.alreadySent || invoke.data?.queued || invoke.data?.status === 'sent' || invoke.data?.status === 'retry_pending');
    }
  }
  return { documentId:data.id, storagePath, emailQueued, emailStatus, emailError };
}
