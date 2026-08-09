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
