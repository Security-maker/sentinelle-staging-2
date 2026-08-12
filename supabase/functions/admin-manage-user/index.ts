import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown,status=200){ return new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}}) }
function secretKey(){
  const named=Deno.env.get('SUPABASE_SECRET_KEYS')
  if(named){ try{ const parsed=JSON.parse(named); if(parsed?.default) return String(parsed.default) }catch{} }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
}

Deno.serve(async req=>{
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors})
  if(req.method!=='POST') return json({ok:false,error:'Méthode non autorisée'},405)
  try{
    const url=Deno.env.get('SUPABASE_URL') || ''
    const key=secretKey()
    if(!url||!key) throw new Error('Secret Supabase serveur indisponible.')
    const bearer=String(req.headers.get('Authorization')||'').replace(/^Bearer\s+/i,'').trim()
    if(!bearer) return json({ok:false,error:'Authentification requise'},401)
    const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
    const {data:userData,error:userError}=await admin.auth.getUser(bearer)
    if(userError||!userData?.user) return json({ok:false,error:'Session Supabase invalide'},401)
    const callerId=userData.user.id
    const {data:caller,error:callerError}=await admin.from('profiles')
      .select('id,organization_id,external_uid,role,active').eq('auth_user_id',callerId).maybeSingle()
    if(callerError||!caller||!caller.active||!['admin','superviseur'].includes(caller.role)) return json({ok:false,error:'Accès QG refusé'},403)

    const body=await req.json().catch(()=>({})) as Record<string,unknown>
    const action=String(body.action||'create')
    if(action==='create'){
      const email=String(body.email||'').trim().toLowerCase()
      const password=String(body.password||'')
      const role=String(body.role||'agent')
      const firstName=String(body.firstName||'').trim()
      const lastName=String(body.lastName||'').trim()
      const phone=String(body.phone||'').trim()
      if(!email||!email.includes('@')) return json({ok:false,error:'E-mail invalide'},400)
      if(password.length<8) return json({ok:false,error:'Mot de passe initial : 8 caractères minimum'},400)
      if(!['agent','superviseur','admin'].includes(role)) return json({ok:false,error:'Rôle invalide'},400)
      if(caller.role==='superviseur' && role!=='agent') return json({ok:false,error:'Un superviseur peut uniquement créer un agent'},403)
      const {data:created,error:createError}=await admin.auth.admin.createUser({
        email,password,email_confirm:true,user_metadata:{first_name:firstName,last_name:lastName,sentinelle_role:role}
      })
      if(createError||!created?.user) throw createError||new Error('Compte Auth non créé')
      const externalUid=crypto.randomUUID()
      const profile={
        organization_id:caller.organization_id,auth_user_id:created.user.id,external_uid:externalUid,role,
        first_name:firstName||null,last_name:lastName||null,email,phone:phone||null,active:true,
        firebase_payload:{uid:externalUid,email,prenom:firstName,nom:lastName,telephone:phone,role,statut:'hors_poste',isOnline:false}
      }
      const {error:profileError}=await admin.from('profiles').insert(profile)
      if(profileError){
        await admin.auth.admin.deleteUser(created.user.id).catch(()=>{})
        throw profileError
      }
      return json({ok:true,authUserId:created.user.id,externalUid,email,role})
    }

    if(action==='create_client'){
      if(caller.role!=='admin') return json({ok:false,error:'Création d’un accès client réservée à un administrateur'},403)
      const clientId=String(body.clientId||'').trim()
      const email=String(body.email||'').trim().toLowerCase()
      const password=String(body.password||'')
      const firstName=String(body.firstName||'').trim()
      const lastName=String(body.lastName||'').trim()
      if(!clientId) return json({ok:false,error:'clientId requis'},400)
      if(!email||!email.includes('@')) return json({ok:false,error:'E-mail invalide'},400)
      if(password.length<8) return json({ok:false,error:'Mot de passe initial : 8 caractères minimum'},400)
      const {data:clientRow,error:clientError}=await admin.from('clients')
        .select('id,organization_id,name,active,portal_enabled').eq('id',clientId).maybeSingle()
      if(clientError) throw clientError
      if(!clientRow||clientRow.organization_id!==caller.organization_id) return json({ok:false,error:'Client hors organisation ou introuvable'},404)
      if(clientRow.active===false||clientRow.portal_enabled===false) return json({ok:false,error:'Le portail est désactivé pour ce client'},400)
      const {data:created,error:createError}=await admin.auth.admin.createUser({
        email,password,email_confirm:true,user_metadata:{first_name:firstName,last_name:lastName,sentinelle_role:'client',client_id:clientId}
      })
      if(createError||!created?.user) throw createError||new Error('Compte Auth client non créé')
      const externalUid=crypto.randomUUID()
      const {data:profile,error:profileError}=await admin.from('profiles').insert({
        organization_id:caller.organization_id,auth_user_id:created.user.id,external_uid:externalUid,role:'client',
        first_name:firstName||null,last_name:lastName||null,email,active:true,
        firebase_payload:{uid:externalUid,email,prenom:firstName,nom:lastName,role:'client',clientId}
      }).select('id').single()
      if(profileError){ await admin.auth.admin.deleteUser(created.user.id).catch(()=>{}); throw profileError }
      const {error:linkError}=await admin.from('client_users').insert({organization_id:caller.organization_id,client_id:clientId,profile_id:profile.id})
      if(linkError){
        try{ await admin.from('profiles').delete().eq('id',profile.id) }catch{}
        await admin.auth.admin.deleteUser(created.user.id).catch(()=>{})
        throw linkError
      }
      try{ await admin.from('audit_logs').insert({organization_id:caller.organization_id,actor_external_uid:caller.external_uid||null,action:'client_portal_account_created',details:{clientId,email,profileId:profile.id}}) }catch{}
      return json({ok:true,authUserId:created.user.id,externalUid,email,role:'client',clientId})
    }

    if(action==='delete_client_access'){
      if(caller.role!=='admin') return json({ok:false,error:'Suppression d’un accès client réservée à un administrateur'},403)
      const profileId=String(body.profileId||'').trim()
      const authUserIdInput=String(body.authUserId||'').trim()
      const clientId=String(body.clientId||'').trim()
      if(!profileId) return json({ok:false,error:'profileId requis'},400)

      const {data:target,error:targetError}=await admin.from('profiles')
        .select('id,organization_id,auth_user_id,external_uid,role,email,first_name,last_name').eq('id',profileId).maybeSingle()
      if(targetError) throw targetError
      if(!target||target.organization_id!==caller.organization_id) return json({ok:false,error:'Accès client hors organisation ou introuvable'},404)
      if(target.role!=='client') return json({ok:false,error:'Le profil ciblé n’est pas un compte client'},400)
      const authUserId=String(target.auth_user_id||authUserIdInput||'').trim()
      if(authUserId===callerId) return json({ok:false,error:'Impossible de supprimer son propre compte'},400)

      if(clientId){
        const {data:link,error:linkError}=await admin.from('client_users')
          .select('id,client_id,profile_id').eq('profile_id',profileId).eq('client_id',clientId).maybeSingle()
        if(linkError) throw linkError
        if(!link) return json({ok:false,error:'Ce compte n’est pas rattaché au client demandé'},404)
      }

      // Priorité à la suppression Auth : l'adresse e-mail redevient immédiatement réutilisable.
      if(authUserId){
        const {error:authDeleteError}=await admin.auth.admin.deleteUser(authUserId)
        if(authDeleteError && !String(authDeleteError.message||'').toLowerCase().includes('not found')) throw authDeleteError
      }

      const {error:linkDeleteError}=await admin.from('client_users').delete().eq('profile_id',profileId)
      if(linkDeleteError) throw linkDeleteError
      const {error:profileDeleteError}=await admin.from('profiles').delete().eq('id',profileId).eq('role','client')
      if(profileDeleteError) throw profileDeleteError

      try{
        await admin.from('audit_logs').insert({
          organization_id:caller.organization_id,
          actor_external_uid:caller.external_uid||null,
          action:'client_portal_account_deleted',
          details:{clientId:clientId||null,profileId,authUserId:authUserId||null,email:target.email||null}
        })
      }catch{}
      return json({ok:true,deleted:true,profileId,authUserId:authUserId||null,email:target.email||null})
    }

    if(action==='delete'){
      if(caller.role!=='admin') return json({ok:false,error:'Suppression réservée à un administrateur'},403)
      const authUserId=String(body.authUserId||'').trim()
      if(!authUserId) return json({ok:false,error:'authUserId requis'},400)
      if(authUserId===callerId) return json({ok:false,error:'Impossible de supprimer son propre compte'},400)
      const {data:target,error:targetError}=await admin.from('profiles')
        .select('id,organization_id,auth_user_id,external_uid,role').eq('auth_user_id',authUserId).maybeSingle()
      if(targetError) throw targetError
      if(!target||target.organization_id!==caller.organization_id) return json({ok:false,error:'Compte hors organisation ou introuvable'},404)
      if(target.role==='admin') return json({ok:false,error:'Supprime un autre administrateur uniquement depuis une procédure dédiée'},403)
      const {error:deleteError}=await admin.auth.admin.deleteUser(authUserId)
      if(deleteError && !String(deleteError.message||'').toLowerCase().includes('not found')) throw deleteError
      return json({ok:true,authUserDeleted:true,externalUid:target.external_uid})
    }
    return json({ok:false,error:'Action inconnue'},400)
  }catch(error){
    console.error(error)
    return json({ok:false,error:String((error as Error)?.message||error)},500)
  }
})
