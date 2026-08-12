import 'dotenv/config'
import process from 'node:process'
import { createClient } from '@supabase/supabase-js'

function env(name){const value=process.env[name];if(!value)throw new Error(`${name} manquant.`);return value}
const supabase=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}})
const organizationId=env('SUPABASE_ORGANIZATION_ID')
const email=env('CLIENT_EMAIL').trim().toLowerCase()
const clientId=env('CLIENT_ID')
const siteIds=String(process.env.CLIENT_SITE_IDS||'').split(',').map(v=>v.trim()).filter(Boolean)
const redirectTo=process.env.CLIENT_REDIRECT_URL||undefined

const {data:invite,error:inviteError}=await supabase.auth.admin.inviteUserByEmail(email,redirectTo?{redirectTo}:undefined)
if(inviteError && !String(inviteError.message).toLowerCase().includes('already')) throw inviteError
let user=invite?.user||null
if(!user){
  const {data:list,error:listError}=await supabase.auth.admin.listUsers({page:1,perPage:1000})
  if(listError)throw listError
  user=list.users.find(row=>String(row.email||'').toLowerCase()===email)||null
}
if(!user)throw new Error('Utilisateur Supabase introuvable après invitation.')

const names=String(process.env.CLIENT_NAME||'Client').trim().split(/\s+/)
const {data:profile,error:profileError}=await supabase.from('profiles').upsert({
  organization_id:organizationId,auth_user_id:user.id,role:'client',email,
  first_name:names[0]||null,last_name:names.slice(1).join(' ')||null,active:true,updated_at:new Date().toISOString()
},{onConflict:'auth_user_id'}).select('id').single()
if(profileError)throw profileError

const {error:linkError}=await supabase.from('client_users').upsert({organization_id:organizationId,client_id:clientId,profile_id:profile.id},{onConflict:'client_id,profile_id'})
if(linkError)throw linkError
if(siteIds.length){
  const rows=siteIds.map(siteId=>({organization_id:organizationId,client_id:clientId,site_id:siteId}))
  const {error}=await supabase.from('client_sites').upsert(rows,{onConflict:'client_id,site_id'})
  if(error)throw error
}
console.log(`Accès client créé pour ${email}. Invitation envoyée${redirectTo?` vers ${redirectTo}`:''}.`)
