// SENTINELLE PRO V5.8.8.3 — Web Push natif Supabase
import { createClient } from 'npm:@supabase/supabase-js@2.57.4'
import { setVapidDetails, sendNotification } from 'npm:web-push@3.6.7'

const cors={
  'Access-Control-Allow-Origin':'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods':'POST, OPTIONS',
}
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}})

function secretKey(){
  const named=Deno.env.get('SUPABASE_SECRET_KEYS')
  if(named){ try{ const parsed=JSON.parse(named); if(parsed?.default) return String(parsed.default) }catch{} }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
}
function boolPref(value:any,key:string){ return value?.[key] !== false }
function safeText(value:unknown,max=480){ return String(value||'').replace(/\s+/g,' ').trim().slice(0,max) }
function routeUrl(route:string, explicit:string){
  if(/^https:\/\//i.test(explicit||'')) return explicit
  const base=Deno.env.get('SENTINELLE_PUBLIC_URL') || ''
  if(!base) return ''
  try{ const u=new URL(base); u.searchParams.set('route',route||'home'); return u.href }catch{return ''}
}

async function currentProfile(admin:any,userId:string){
  const {data,error}=await admin.from('profiles')
    .select('id,organization_id,auth_user_id,external_uid,role,first_name,last_name,active,firebase_payload')
    .eq('auth_user_id',userId).maybeSingle()
  if(error) throw error
  if(!data?.active) return null
  return data
}

async function targetProfiles(admin:any, sender:any, payload:any){
  const org=sender.organization_id
  const eventType=String(payload.notificationType||'flash')

  if(['shift_start','shift_end'].includes(eventType)){
    if(sender.role!=='agent') throw new Error('Événement de poste réservé à un agent')
    const shiftId=safeText(payload?.data?.shiftId,220)
    if(!shiftId) throw new Error('Shift manquant')
    const {data:shift,error}=await admin.from('shifts')
      .select('firebase_id,firebase_agent_uid,firebase_site_id,firebase_mission_id,status,started_at,completed_at,payload')
      .eq('organization_id',org).eq('firebase_id',shiftId).maybeSingle()
    if(error) throw error
    const requiredStatus=eventType==='shift_start'?'active':'completed'
    if(!shift || shift.firebase_agent_uid!==sender.external_uid || shift.status!==requiredStatus) throw new Error('Événement de poste non vérifiable')
    const {data:profiles,error:profilesError}=await admin.from('profiles')
      .select('id,external_uid,role,firebase_payload').eq('organization_id',org).eq('active',true).in('role',['admin','superviseur'])
    if(profilesError) throw profilesError
    return {profiles:profiles||[],shift}
  }

  if(!['admin','superviseur'].includes(sender.role)) throw new Error('Envoi push réservé au QG')
  const {data:agents,error}=await admin.from('profiles')
    .select('id,external_uid,role,firebase_payload').eq('organization_id',org).eq('active',true).eq('role','agent')
  if(error) throw error
  let selected=[...(agents||[])]
  const ids=new Set((Array.isArray(payload.userIds)?payload.userIds:[]).map((v:any)=>String(v||'')).filter(Boolean))
  const target=String(payload.target||'all')

  if(ids.size) selected=selected.filter((p:any)=>ids.has(String(p.external_uid||'')))
  else if(target.startsWith('agent:')){
    const uid=target.slice(6); selected=selected.filter((p:any)=>String(p.external_uid||'')===uid)
  }else if(target==='working'){
    selected=selected.filter((p:any)=>['en_poste','enposte','active'].includes(String(p.firebase_payload?.statut||'').toLowerCase().replace(/[\s-]+/g,'_')))
  }else if(target.startsWith('site:') || payload.siteId){
    const siteId=target.startsWith('site:')?target.slice(5):String(payload.siteId||'')
    const assigned=new Set(selected.filter((p:any)=>String(p.firebase_payload?.siteActuel||'')===siteId).map((p:any)=>String(p.external_uid||'')))
    const {data:missions}=await admin.from('missions').select('firebase_agent_uid,status').eq('organization_id',org).eq('firebase_site_id',siteId).neq('status','cancelled')
    ;(missions||[]).forEach((m:any)=>{ if(m.firebase_agent_uid) assigned.add(String(m.firebase_agent_uid)) })
    selected=selected.filter((p:any)=>assigned.has(String(p.external_uid||'')))
  }
  return {profiles:selected,shift:null}
}

function serverMessage(sender:any,eventType:string,shift:any,payload:any){
  const agentName=`${sender.first_name||''} ${sender.last_name||''}`.trim()||'Un agent'
  const sp=shift?.payload||{}
  const siteName=safeText(sp.siteNom||sp.siteName||payload?.data?.siteName||'un site',160)
  if(eventType==='shift_start') return {
    title:'Agent en poste',
    body:`${agentName} a confirmé sa prise de poste sur ${siteName}.`,
    route:'home', priority:'Important'
  }
  if(eventType==='shift_end'){
    const reports=Number(sp.reportsCount??payload?.data?.reportsCount??0)
    const rounds=Number(sp.roundsCount??payload?.data?.roundsCount??0)
    const incidents=Number(sp.incidentsCount??payload?.data?.incidentsCount??0)
    return {
      title:'Fin de poste confirmée',
      body:`${agentName} a terminé son poste sur ${siteName}. Rapports : ${reports} · Rondes : ${rounds} · Événements : ${incidents}.`,
      route:'home', priority:incidents>0?'Important':'Information'
    }
  }
  return null
}

export default {
  fetch: async (req:Request) => {
    if(req.method==='OPTIONS') return new Response('ok',{headers:cors})
    if(req.method!=='POST') return json({ok:false,error:'Méthode non autorisée'},405)
    try{
      const url=Deno.env.get('SUPABASE_URL')||''
      const key=secretKey()
      if(!url||!key) throw new Error('Configuration Supabase serveur absente')
      const bearer=String(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim()
      if(!bearer) return json({ok:false,error:'Authentification requise'},401)
      const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
      const {data:userData,error:userError}=await admin.auth.getUser(bearer)
      if(userError||!userData?.user) return json({ok:false,error:'Session Supabase invalide'},401)
      const sender=await currentProfile(admin,userData.user.id)
      if(!sender) return json({ok:false,error:'Profil Sentinelle invalide'},403)
      const payload=await req.json().catch(()=>({})) as any
      const action=String(payload.action||'send')
      const publicKey=String(Deno.env.get('WEB_PUSH_VAPID_PUBLIC_KEY')||'').trim()
      const privateKey=String(Deno.env.get('WEB_PUSH_VAPID_PRIVATE_KEY')||'').trim()
      const subject=String(Deno.env.get('WEB_PUSH_VAPID_SUBJECT')||'mailto:admin@example.invalid').trim()

      if(action==='health') return json({ok:true,service:'send-web-push',provider:'web-push-vapid',vapidConfigured:Boolean(publicKey&&privateKey),oneSignal:false})
      if(action==='public_key'){
        if(!publicKey) return json({ok:false,error:'WEB_PUSH_VAPID_PUBLIC_KEY manquante'},500)
        return json({ok:true,publicKey})
      }
      if(action!=='send') return json({ok:false,error:'Action inconnue'},400)
      if(!publicKey||!privateKey) return json({ok:false,error:'Secrets VAPID incomplets'},500)

      const eventType=safeText(payload.notificationType||'flash',50)
      const {profiles,shift}=await targetProfiles(admin,sender,payload)
      if(!profiles.length) return json({ok:true,skipped:true,reason:'Aucun destinataire autorisé',delivered:0})
      const profileIds=profiles.map((p:any)=>p.id)
      const {data:subscriptions,error:subError}=await admin.from('web_push_subscriptions')
        .select('id,profile_id,endpoint,p256dh,auth_secret,preferences,enabled')
        .in('profile_id',profileIds).eq('enabled',true)
      if(subError) throw subError
      const category=['shift_start','shift_end'].includes(eventType)?'operations':eventType
      const eligible=(subscriptions||[]).filter((s:any)=>boolPref(s.preferences,category))
      if(!eligible.length) return json({ok:true,skipped:true,reason:'Aucun appareil abonné pour cette notification',delivered:0})

      const authoritative=serverMessage(sender,eventType,shift,payload)
      const title=safeText(authoritative?.title||payload.title||'Sentinelle Pro',100)
      const body=safeText(authoritative?.body||payload.message||'Nouvelle information opérationnelle',480)
      const route=safeText(authoritative?.route||payload.route||payload?.data?.route||'home',60)
      const priority=safeText(authoritative?.priority||payload.priority||'Information',30)
      const notificationId=safeText(payload.notificationId||`${eventType}_${Date.now()}`,160)
      const urlToOpen=routeUrl(route,String(payload.url||''))
      const visiblePayload=JSON.stringify({
        title,body,notificationId,tag:`sentinelle-${eventType}-${notificationId}`,
        route,url:urlToOpen,requireInteraction:['Critique','Urgent'].includes(priority),
        data:{type:eventType,priority,route,shiftId:payload?.data?.shiftId||'',missionId:payload?.data?.missionId||'',flashId:payload?.data?.flashId||''}
      })

      setVapidDetails(subject,publicKey,privateKey)
      let delivered=0,failed=0,disabled=0
      const failures:any[]=[]
      for(const sub of eligible){
        try{
          await sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth_secret}},visiblePayload,{TTL:['Critique','Urgent'].includes(priority)?3600:86400})
          delivered++
          await admin.from('web_push_subscriptions').update({last_success_at:new Date().toISOString(),failure_count:0,last_error:null,updated_at:new Date().toISOString()}).eq('id',sub.id)
        }catch(error:any){
          failed++
          const status=Number(error?.statusCode||0)
          const expired=status===404||status===410
          if(expired) disabled++
          const message=safeText(error?.body||error?.message||error,500)
          failures.push({status,message,disabled:expired})
          await admin.from('web_push_subscriptions').update({enabled:expired?false:true,last_failure_at:new Date().toISOString(),failure_count:1,last_error:message,updated_at:new Date().toISOString()}).eq('id',sub.id)
        }
      }
      return json({ok:true,provider:'web-push-vapid',oneSignal:false,requested:eligible.length,delivered,failed,disabled,notificationType:eventType,failures:failures.slice(0,5)})
    }catch(error:any){
      console.error(error)
      return json({ok:false,error:safeText(error?.message||error,700)},500)
    }
  }
}
