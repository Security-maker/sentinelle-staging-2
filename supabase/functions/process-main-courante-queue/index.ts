import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

export const MAX_MAIN_COURANTE_ATTEMPTS = 3
const RETRY_DELAYS_MS = [5 * 60_000, 30 * 60_000]

function escapeHtml(value: unknown){
  return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c] as string))
}

const AZZERA_EMAIL_LOGO_URL='https://sentinelle-pro.app/assets/logo.png'
const SENTINELLE_CLIENT_URL='https://sentinelle-pro.app/client.html'

function normalizeEmailSubject(value: unknown){
  return String(value ?? '').replace(/[\r\n]+/g,' ').replace(/\s+/g,' ').trim()
}
function formatEmailDate(value: unknown){
  const d=new Date(String(value || ''))
  if(Number.isNaN(d.getTime())) return ''
  try{
    return new Intl.DateTimeFormat('fr-FR',{day:'2-digit',month:'long',year:'numeric'}).format(d)
  }catch(_error){
    return d.toLocaleDateString('fr-FR')
  }
}
function mainCouranteClient(doc:any){
  return Array.isArray(doc?.clients) ? doc.clients[0] : doc?.clients
}
function buildMainCouranteEmail(doc:any, recipient:{email:string,display_name:string|null}){
  const client=mainCouranteClient(doc)
  const clientName=escapeHtml(client?.name || 'Client')
  const title=escapeHtml(doc?.title || 'Main courante')
  const date=formatEmailDate(doc?.created_at)
  const hello=recipient?.display_name ? `Bonjour ${escapeHtml(recipient.display_name)},` : 'Bonjour,'
  return `<!doctype html>
<html lang="fr">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f6f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;color:#141c25;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f3f6f9;margin:0;padding:0;">
    <tr><td align="center" style="padding:28px 14px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:640px;background:#ffffff;border-radius:22px;overflow:hidden;border:1px solid #e1e8ef;box-shadow:0 10px 30px rgba(20,28,37,.08);">
        <tr>
          <td style="background:#141c25;padding:24px 28px;border-bottom:3px solid #64d0ff;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td width="64" valign="middle" style="width:64px;">
                  <img src="${AZZERA_EMAIL_LOGO_URL}" width="48" height="48" alt="Azzera Protect" style="display:block;width:48px;height:48px;object-fit:contain;border:0;outline:none;text-decoration:none;">
                </td>
                <td valign="middle" style="padding-left:8px;">
                  <div style="font-size:20px;line-height:24px;font-weight:800;letter-spacing:.2px;color:#ffffff;">AZZERA PROTECT</div>
                  <div style="margin-top:4px;font-size:11px;line-height:16px;font-weight:700;letter-spacing:1.8px;color:#64d0ff;">SÉCURITÉ PRIVÉE</div>
                </td>
                <td align="right" valign="middle" style="font-size:11px;line-height:16px;color:#aeb9c5;">SENTINELLE PRO</td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td style="padding:34px 30px 8px 30px;">
            <div style="font-size:12px;line-height:18px;font-weight:800;letter-spacing:1.2px;color:#1589b8;text-transform:uppercase;">Main courante disponible</div>
            <h1 style="margin:8px 0 10px 0;font-size:28px;line-height:34px;color:#141c25;font-weight:800;">Votre rapport opérationnel est prêt</h1>
            <p style="margin:0;font-size:16px;line-height:25px;color:#5d6a78;">${hello}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:16px 30px 0 30px;">
            <p style="margin:0 0 18px 0;font-size:15px;line-height:24px;color:#384656;">La main courante correspondant à votre mission est disponible. Le PDF officiel est joint à cet e-mail et reste accessible depuis votre espace client Sentinelle Pro.</p>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;background:#f7fafc;border:1px solid #e2eaf1;border-radius:16px;">
              <tr><td style="padding:18px 20px;">
                <div style="font-size:11px;line-height:16px;font-weight:800;letter-spacing:1px;color:#7b8998;text-transform:uppercase;">Document</div>
                <div style="margin-top:5px;font-size:17px;line-height:24px;font-weight:800;color:#141c25;">${title}</div>
                <div style="margin-top:8px;font-size:13px;line-height:20px;color:#657383;"><strong style="color:#344250;">Client :</strong> ${clientName}${date ? ` &nbsp;·&nbsp; <strong style="color:#344250;">Date :</strong> ${escapeHtml(date)}` : ''}</div>
              </td></tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding:26px 30px 30px 30px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" bgcolor="#141c25" style="border-radius:12px;">
              <a href="${SENTINELLE_CLIENT_URL}" target="_blank" style="display:inline-block;padding:14px 24px;font-size:14px;line-height:18px;font-weight:800;color:#ffffff;text-decoration:none;border-radius:12px;border:1px solid #141c25;">Accéder à mon espace client</a>
            </td></tr></table>
            <div style="margin-top:12px;font-size:12px;line-height:18px;color:#8996a4;">Le PDF est également joint directement à ce message.</div>
          </td>
        </tr>
        <tr>
          <td style="padding:0 30px 30px 30px;">
            <div style="height:1px;background:#e5ebf1;margin-bottom:24px;"></div>
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
              <tr>
                <td valign="top">
                  <div style="font-size:14px;line-height:20px;font-weight:800;color:#141c25;">Azzera Protect</div>
                  <div style="margin-top:3px;font-size:13px;line-height:19px;color:#5f6d7b;">Service Exploitation · Sécurité privée</div>
                </td>
                <td align="right" valign="top" style="font-size:12px;line-height:18px;color:#8b97a5;">Document transmis via<br><strong style="color:#1589b8;">Sentinelle Pro</strong></td>
              </tr>
            </table>
          </td>
        </tr>
        <tr><td style="background:#eef3f7;padding:16px 24px;text-align:center;font-size:11px;line-height:17px;color:#7d8996;">Cet e-mail est généré automatiquement à la suite de la clôture de mission. Pour toute question opérationnelle, contactez votre interlocuteur habituel chez Azzera Protect.</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`
}
function buildMainCouranteText(doc:any, recipient:{email:string,display_name:string|null}){
  const client=mainCouranteClient(doc)
  const date=formatEmailDate(doc?.created_at)
  return `${recipient?.display_name ? `Bonjour ${recipient.display_name},` : 'Bonjour,'}\n\nVotre main courante est disponible.\n\nDocument : ${String(doc?.title || 'Main courante')}\nClient : ${String(client?.name || 'Client')}${date ? `\nDate : ${date}` : ''}\n\nLe PDF officiel est joint à cet e-mail et reste accessible dans votre espace client Sentinelle Pro : ${SENTINELLE_CLIENT_URL}\n\nAzzera Protect\nService Exploitation · Sécurité privée\nDocument transmis via Sentinelle Pro.`
}

function bytesToBase64(bytes: Uint8Array){
  let binary=''
  const chunk=0x8000
  for(let i=0;i<bytes.length;i+=chunk) binary += String.fromCharCode(...bytes.subarray(i,Math.min(i+chunk,bytes.length)))
  return btoa(binary)
}
function cleanFilename(value: unknown){
  return `${String(value || 'main-courante').replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'') || 'main-courante'}.pdf`
}
function uniqueRecipients(rows: Array<{email?: string|null,display_name?: string|null}>){
  const seen=new Set<string>()
  const out:Array<{email:string,display_name:string|null}>=[]
  for(const row of rows || []){
    const email=String(row?.email || '').trim().toLowerCase()
    if(!email || seen.has(email)) continue
    seen.add(email)
    out.push({email,display_name:row?.display_name ? String(row.display_name) : null})
  }
  return out
}
function nextRetryDate(attempt:number){
  const delay=RETRY_DELAYS_MS[Math.max(0,Math.min(attempt-1,RETRY_DELAYS_MS.length-1))] || RETRY_DELAYS_MS[RETRY_DELAYS_MS.length-1]
  return new Date(Date.now()+delay).toISOString()
}

async function markDocumentFailure(admin:SupabaseClient, doc:any, attempt:number, message:string){
  const retryable=attempt<MAX_MAIN_COURANTE_ATTEMPTS
  const status=retryable?'retry_pending':'failed'
  const next=retryable?nextRetryDate(attempt):null
  await admin.from('generated_documents').update({
    delivery_status:status,
    delivery_attempts:attempt,
    next_delivery_attempt_at:next,
    delivery_error:message.slice(0,4000),
    updated_at:new Date().toISOString()
  }).eq('id',doc.id)
  return {status,queued:retryable,nextAttemptAt:next,attempt,maxAttempts:MAX_MAIN_COURANTE_ATTEMPTS,error:message}
}

async function resolveRecipients(admin:SupabaseClient, doc:any){
  const direct=await admin.from('document_recipients').select('email,display_name').eq('document_id',doc.id)
  if(direct.error) throw direct.error
  if(direct.data?.length) return uniqueRecipients(direct.data)

  if(doc.client_id){
    const clientRecipients=await admin.from('client_report_recipients')
      .select('email,display_name').eq('client_id',doc.client_id).eq('active',true)
    if(clientRecipients.error) throw clientRecipients.error
    if(clientRecipients.data?.length) return uniqueRecipients(clientRecipients.data)
  }

  const client=Array.isArray(doc.clients) ? doc.clients[0] : doc.clients
  const fallback=client?.report_email || client?.billing_email
  return fallback ? uniqueRecipients([{email:fallback,display_name:client?.name || 'Client'}]) : []
}

export async function deliverMainCourante(args:{
  admin:SupabaseClient,
  documentId:string,
  brevoKey:string,
  senderEmail:string,
  senderName:string,
  manualReset?:boolean
}){
  const {admin,documentId,brevoKey,senderEmail,senderName,manualReset=false}=args
  const now=new Date().toISOString()

  const {data:doc,error:docError}=await admin.from('generated_documents')
    .select('id,organization_id,client_id,type,title,created_at,storage_bucket,storage_path,firebase_site_id,delivery_status,delivery_attempts,clients(name,report_email,billing_email,auto_email,active)')
    .eq('id',documentId).single()
  if(docError||!doc) throw docError||new Error('Document introuvable.')
  if(String(doc.type||'')!=='mission') return {status:'ignored',reason:'Document hors rapport de mission'}

  if(doc.delivery_status==='sent') return {status:'sent',sent:true,alreadySent:true,recipients:[]}

  const client=Array.isArray((doc as any).clients) ? (doc as any).clients[0] : (doc as any).clients
  if(!doc.client_id || !client){
    await admin.from('generated_documents').update({delivery_status:'no_recipient',delivery_error:'Aucun client rattaché au site du rapport.',next_delivery_attempt_at:null,updated_at:now}).eq('id',documentId)
    return {status:'no_recipient',queued:false,reason:'Aucun client rattaché'}
  }
  if(client.active===false || client.auto_email!==true){
    await admin.from('generated_documents').update({delivery_status:'disabled',delivery_error:null,next_delivery_attempt_at:null,updated_at:now}).eq('id',documentId)
    return {status:'disabled',queued:false,reason:'Envoi automatique désactivé pour ce client'}
  }

  const previousAttempts=manualReset ? 0 : Number((doc as any).delivery_attempts || 0)
  const attempt=previousAttempts+1
  await admin.from('generated_documents').update({
    delivery_status:'sending',delivery_attempts:attempt,next_delivery_attempt_at:null,delivery_error:null,updated_at:now
  }).eq('id',documentId)

  let recipients:Array<{email:string,display_name:string|null}>=[]
  try{
    recipients=await resolveRecipients(admin,doc)
  }catch(error){
    return await markDocumentFailure(admin,doc,attempt,`Résolution destinataires : ${String((error as Error)?.message||error)}`)
  }
  if(!recipients.length){
    await admin.from('generated_documents').update({delivery_status:'no_recipient',delivery_attempts:attempt,delivery_error:'Aucune adresse e-mail de rapport configurée.',next_delivery_attempt_at:null,updated_at:new Date().toISOString()}).eq('id',documentId)
    return {status:'no_recipient',queued:false,attempt,reason:'Aucun destinataire configuré'}
  }

  let pdfBase64=''
  try{
    if(!doc.storage_bucket || !doc.storage_path) throw new Error('Chemin Storage absent.')
    const {data:file,error:fileError}=await admin.storage.from(doc.storage_bucket).download(doc.storage_path)
    if(fileError||!file) throw fileError||new Error('PDF introuvable dans Storage.')
    pdfBase64=bytesToBase64(new Uint8Array(await file.arrayBuffer()))
  }catch(error){
    return await markDocumentFailure(admin,doc,attempt,`PDF indisponible : ${String((error as Error)?.message||error)}`)
  }

  const sent:string[]=[]
  const already:string[]=[]
  const failed:Array<{email:string,error:string}>=[]

  for(const recipient of recipients){
    const idempotencyKey=`main-courante:${documentId}:${recipient.email}`
    const {data:existing}=await admin.from('email_deliveries').select('id,status,attempt_count').eq('idempotency_key',idempotencyKey).maybeSingle()
    if(existing?.status==='sent'){
      already.push(recipient.email)
      continue
    }

    const deliveryAttempt=Number(existing?.attempt_count || 0)+1
    const {data:delivery,error:deliveryError}=await admin.from('email_deliveries').upsert({
      organization_id:doc.organization_id,
      document_id:documentId,
      recipient_email:recipient.email,
      idempotency_key:idempotencyKey,
      status:'sending',
      attempt_count:deliveryAttempt,
      last_attempt_at:new Date().toISOString(),
      next_attempt_at:null,
      error_message:null,
      updated_at:new Date().toISOString()
    },{onConflict:'idempotency_key'}).select('id').single()
    if(deliveryError){
      failed.push({email:recipient.email,error:String(deliveryError.message||deliveryError)})
      continue
    }

    try{
      const response=await fetch('https://api.brevo.com/v3/smtp/email',{
        method:'POST',
        headers:{'Content-Type':'application/json','api-key':brevoKey,'Idempotency-Key':idempotencyKey},
        body:JSON.stringify({
          sender:{email:senderEmail,name:senderName},
          to:[{email:recipient.email,name:recipient.display_name||recipient.email}],
          subject:`Azzera Protect — Main courante — ${normalizeEmailSubject(doc.title)}`,
          htmlContent:buildMainCouranteEmail(doc,recipient),
          textContent:buildMainCouranteText(doc,recipient),
          replyTo:{email:senderEmail,name:senderName},
          attachment:[{name:cleanFilename(doc.title),content:pdfBase64}],
          tags:['sentinelle-pro','main-courante']
        })
      })
      const payload=await response.json().catch(()=>({}))
      if(!response.ok) throw new Error(`Brevo ${response.status}: ${JSON.stringify(payload)}`)

      await admin.from('email_deliveries').update({
        status:'sent',provider_message_id:payload.messageId||null,sent_at:new Date().toISOString(),next_attempt_at:null,error_message:null,updated_at:new Date().toISOString()
      }).eq('id',delivery.id)
      sent.push(recipient.email)
    }catch(error){
      const message=String((error as Error)?.message||error)
      const retryable=attempt<MAX_MAIN_COURANTE_ATTEMPTS
      await admin.from('email_deliveries').update({
        status:'failed',error_message:message.slice(0,4000),next_attempt_at:retryable?nextRetryDate(attempt):null,updated_at:new Date().toISOString()
      }).eq('id',delivery.id)
      failed.push({email:recipient.email,error:message})
    }
  }

  if(failed.length){
    const summary=failed.map(row=>`${row.email}: ${row.error}`).join(' | ')
    const failure=await markDocumentFailure(admin,doc,attempt,summary)
    return {...failure,sent,alreadySent:already.length>0,already,failedRecipients:failed.map(row=>row.email)}
  }

  await admin.from('generated_documents').update({
    delivery_status:'sent',delivery_attempts:attempt,next_delivery_attempt_at:null,delivery_error:null,delivered_at:new Date().toISOString(),updated_at:new Date().toISOString()
  }).eq('id',documentId)
  return {status:'sent',sent:true,recipients:sent,alreadySent:already.length>0,already,attempt,maxAttempts:MAX_MAIN_COURANTE_ATTEMPTS}
}

function json(body: unknown, status=200){
  return new Response(JSON.stringify(body), {status,headers:{'Content-Type':'application/json'}})
}

Deno.serve(async req => {
  if(req.method!=='POST') return json({error:'Method not allowed'},405)
  try{
    const expectedSecret=Deno.env.get('MAIN_COURANTE_CRON_SECRET')||''
    const providedSecret=req.headers.get('X-Cron-Secret')||''
    if(!expectedSecret || providedSecret!==expectedSecret) return json({error:'Accès refusé'},403)

    const supabaseUrl=Deno.env.get('SUPABASE_URL')!
    const serviceKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const brevoKey=Deno.env.get('BREVO_API_KEY')!
    const senderEmail=Deno.env.get('BREVO_SENDER_EMAIL')!
    const senderName=Deno.env.get('BREVO_SENDER_NAME')||'Sentinelle Pro'
    if(!supabaseUrl||!serviceKey||!brevoKey||!senderEmail) throw new Error('Secrets serveur incomplets.')

    const admin=createClient(supabaseUrl,serviceKey,{auth:{persistSession:false}})
    const now=new Date().toISOString()
    const {data:rows,error}=await admin.from('generated_documents')
      .select('id')
      .eq('type','mission')
      .eq('delivery_status','retry_pending')
      .lte('next_delivery_attempt_at',now)
      .order('next_delivery_attempt_at',{ascending:true})
      .limit(20)
    if(error) throw error

    const results:any[]=[]
    for(const row of rows||[]){
      try{
        const result=await deliverMainCourante({admin,documentId:row.id,brevoKey,senderEmail,senderName})
        results.push({documentId:row.id,...result})
      }catch(error){
        console.error('Relance main courante impossible',row.id,error)
        results.push({documentId:row.id,status:'error',error:String((error as Error)?.message||error)})
      }
    }
    return json({ok:true,processed:results.length,results})
  }catch(error){
    console.error(error)
    return json({error:String((error as Error)?.message||error)},500)
  }
})
