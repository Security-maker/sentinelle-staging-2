import { createClient } from 'npm:@supabase/supabase-js@2'

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'GET, POST, OPTIONS',
}
function json(body:unknown,status=200){ return new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}}) }
function secretKey(){
  const named=Deno.env.get('SUPABASE_SECRET_KEYS')
  if(named){ try{ const parsed=JSON.parse(named); if(parsed?.default) return String(parsed.default) }catch{} }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
}
function tagFilter(key:string,value:unknown){ return {field:'tag',key,relation:'=',value:String(value||'')} }
function buildTarget(payload:any){
  const ids=Array.isArray(payload.subscriptionIds)?[...new Set(payload.subscriptionIds.map((v:unknown)=>String(v||'').trim()).filter(Boolean))].slice(0,20000):[]
  if(ids.length) return {include_subscription_ids:ids}
  const target=String(payload.target||'all')
  if(target.startsWith('agent:')) return {include_aliases:{external_id:[target.slice(6)]},target_channel:'push'}
  if(target.startsWith('site:')) return {filters:[tagFilter('role','agent'),{operator:'AND'},tagFilter('siteActuel',target.slice(5))]}
  if(target==='working') return {filters:[tagFilter('role','agent'),{operator:'AND'},tagFilter('statut','en_poste')]}
  if(target==='qg') return {filters:[tagFilter('role','admin'),{operator:'OR'},tagFilter('role','superviseur')]}
  return {filters:[tagFilter('role','agent')]}
}
async function stableUuid(value:string){
  const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))
  const bytes=digest.slice(0,16);bytes[6]=(bytes[6]&0x0f)|0x40;bytes[8]=(bytes[8]&0x3f)|0x80
  const h=[...bytes].map(v=>v.toString(16).padStart(2,'0')).join('')
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors})
  if(req.method==='GET') return json({ok:true,service:'sentinelle-send-push',auth:'supabase',live:String(Deno.env.get('SENTINELLE_PUSH_LIVE')||'false')==='true'})
  if(req.method!=='POST') return json({ok:false,error:'Méthode non autorisée'},405)
  try{
    const url=Deno.env.get('SUPABASE_URL')||''; const key=secretKey()
    if(!url||!key) throw new Error('Configuration Supabase serveur absente')
    const bearer=String(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim()
    if(!bearer) return json({ok:false,error:'Authentification requise'},401)
    const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
    const {data:userData,error:userError}=await admin.auth.getUser(bearer)
    if(userError||!userData?.user) return json({ok:false,error:'Session Supabase invalide'},401)
    const {data:profile,error:profileError}=await admin.from('profiles').select('id,organization_id,external_uid,role,first_name,last_name,active').eq('auth_user_id',userData.user.id).maybeSingle()
    if(profileError||!profile||!profile.active) return json({ok:false,error:'Profil Sentinelle invalide'},403)
    const payload=await req.json().catch(()=>({})) as any
    if(profile.role==='agent'){
      const shiftId=String(payload?.data?.shiftId||'').trim()
      if(payload.notificationType!=='shift_start'||payload.target!=='qg'||!shiftId) return json({ok:false,error:'Action push agent non autorisée'},403)
      const {data:shift,error:shiftError}=await admin.from('shifts').select('firebase_id,firebase_agent_uid,firebase_site_id,firebase_mission_id,status,payload').eq('organization_id',profile.organization_id).eq('firebase_id',shiftId).maybeSingle()
      if(shiftError||!shift||shift.firebase_agent_uid!==profile.external_uid||shift.status!=='active') return json({ok:false,error:'Prise de poste non vérifiable'},403)
      payload.data={...(payload.data||{}),agentId:profile.external_uid,siteId:shift.firebase_site_id||'',missionId:shift.firebase_mission_id||'',route:'home'}
      payload.title='Agent en poste'
      const agentNom=`${profile.first_name||''} ${profile.last_name||''}`.trim()||'Un agent'
      payload.message=`${agentNom} vient de confirmer sa prise de poste. Ouvrez Sentinelle Pro pour consulter les détails.`
    }else if(!['admin','superviseur'].includes(profile.role)) return json({ok:false,error:'Rôle push non autorisé'},403)

    const live=String(Deno.env.get('SENTINELLE_PUSH_LIVE')||'false').toLowerCase()==='true'
    const appId=Deno.env.get('ONESIGNAL_APP_ID')||''; const apiKey=Deno.env.get('ONESIGNAL_REST_API_KEY')||''
    if(!live) return json({ok:true,dryRun:true,authorized:true,target:payload.target||'all',notificationType:payload.notificationType||'flash'})
    if(!appId||!apiKey) return json({ok:false,error:'Secrets OneSignal staging absents'},500)
    const title=String(payload.title||'Sentinelle Pro').slice(0,100)
    const message=String(payload.message||'Nouvelle information opérationnelle').slice(0,480)
    const priority=String(payload.priority||'Information')
    const notificationType=String(payload.notificationType||'flash').slice(0,40)
    const notificationId=String(payload.notificationId||payload.flashId||Date.now()).slice(0,120)
    const body={
      app_id:appId,...buildTarget(payload),headings:{en:title,fr:title},contents:{en:message,fr:message},
      name:`Sentinelle Pro ${notificationType} ${notificationId}`.slice(0,128),
      idempotency_key:await stableUuid(`${notificationType}:${notificationId}`),
      priority:['Critique','Urgent'].includes(priority)?10:5,
      ios_interruption_level:['Critique','Urgent'].includes(priority)?'time_sensitive':'active',
      web_url:/^https:\/\//i.test(String(payload.url||''))?String(payload.url):undefined,
      data:{type:notificationType,notificationId,flashId:payload.flashId||'',priority,target:payload.target||'direct',...(payload.data||{})}
    }
    const response=await fetch('https://api.onesignal.com/notifications?c=push',{method:'POST',headers:{Authorization:`Key ${apiKey}`,'Content-Type':'application/json'},body:JSON.stringify(body)})
    const result=await response.json().catch(()=>({}))
    if(!response.ok) return json({ok:false,error:'OneSignal a refusé la notification',status:response.status,details:result},response.status)
    return json({ok:true,id:result.id||null,recipients:result.recipients??null,externalId:result.external_id||null})
  }catch(error){
    console.error(error); return json({ok:false,error:String((error as Error)?.message||error)},500)
  }
})
