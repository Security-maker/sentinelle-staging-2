import 'dotenv/config'
import fs from 'node:fs/promises'
import process from 'node:process'
import { initializeApp, cert } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { createClient } from '@supabase/supabase-js'

function env(name, required=true){
  const value=process.env[name]
  if(required&&!value) throw new Error(`Variable ${name} manquante.`)
  return value
}
function iso(value){
  if(!value)return null
  if(typeof value.toDate==='function') return value.toDate().toISOString()
  const d=new Date(value)
  return Number.isNaN(d.getTime())?null:d.toISOString()
}
function clean(value){
  if(value===undefined)return null
  if(value===null||typeof value!=='object')return value
  if(typeof value.toDate==='function')return value.toDate().toISOString()
  if(Array.isArray(value))return value.map(clean)
  return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,clean(v)]))
}
function dataUrlToBuffer(value){
  const match=String(value||'').match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s)
  if(!match)return null
  return {mime:match[1],buffer:Buffer.from(match[2],'base64')}
}
async function upsert(table,rows,onConflict){
  if(!rows.length)return
  if(process.env.DRY_RUN==='true'){console.log(`[DRY] ${table}: ${rows.length}`);return}
  for(let i=0;i<rows.length;i+=250){
    const batch=rows.slice(i,i+250)
    const {error}=await supabase.from(table).upsert(batch,{onConflict})
    if(error)throw new Error(`${table}: ${error.message}`)
  }
  console.log(`${table}: ${rows.length}`)
}
async function collectionRows(name){
  const snap=await firestore.collection(name).get()
  return snap.docs.map(doc=>({id:doc.id,...doc.data()}))
}

const account=JSON.parse(await fs.readFile(env('FIREBASE_SERVICE_ACCOUNT_JSON'),'utf8'))
initializeApp({credential:cert(account)})
const firestore=getFirestore()
const supabase=createClient(env('SUPABASE_URL'),env('SUPABASE_SERVICE_ROLE_KEY'),{auth:{persistSession:false,autoRefreshToken:false}})
const organizationId=env('SUPABASE_ORGANIZATION_ID')
const photoBucket=process.env.SUPABASE_REPORT_PHOTO_BUCKET||'report-photos'

console.log(`Migration vers organisation ${organizationId}${process.env.DRY_RUN==='true'?' (DRY RUN)':''}`)

const [users,sites,missions,shifts,reports,documents]=await Promise.all([
  collectionRows('users'),collectionRows('sites'),collectionRows('missions'),collectionRows('shifts'),collectionRows('reports'),collectionRows('generatedDocuments')
])

await upsert('profiles',users.map(u=>({
  organization_id:organizationId,external_uid:u.id,role:['admin','superviseur','agent','client'].includes(u.role)?u.role:'agent',
  first_name:u.prenom||null,last_name:u.nom||null,email:u.email||null,phone:u.telephone||null,active:u.active!==false,
  firebase_payload:clean(u),updated_at:new Date().toISOString()
})),'external_uid')

// Un client est créé pour chaque nom de client unique présent dans les sites.
const clientNames=[...new Set(sites.map(s=>String(s.clientName||'').trim()).filter(Boolean))]
await upsert('clients',clientNames.map(name=>({organization_id:organizationId,firebase_id:`client:${name.toLowerCase()}`,name,report_email:null,updated_at:new Date().toISOString()})),'organization_id,firebase_id')
const {data:clients,error:clientsError}=process.env.DRY_RUN==='true'?{data:[],error:null}:await supabase.from('clients').select('id,firebase_id,name').eq('organization_id',organizationId)
if(clientsError)throw clientsError
const clientByName=new Map((clients||[]).map(c=>[c.name,c.id]))

await upsert('sites',sites.map(s=>({
  organization_id:organizationId,client_id:clientByName.get(s.clientName)||null,firebase_id:s.id,name:s.name||s.siteNom||s.id,
  address:s.address||null,client_name:s.clientName||null,report_email:s.reportEmail||s.clientEmail||s.billingEmail||null,
  active:s.active!==false,payload:clean(s),updated_at:new Date().toISOString()
})),'organization_id,firebase_id')

await upsert('missions',missions.map(m=>({
  organization_id:organizationId,firebase_id:m.id,firebase_site_id:m.siteId||null,firebase_agent_uid:m.agentId||null,status:m.status||null,
  scheduled_start:iso(m.scheduledStart),scheduled_end:iso(m.scheduledEnd),actual_start:iso(m.actualStart),actual_end:iso(m.actualEnd),
  payload:clean(m),updated_at:new Date().toISOString()
})),'organization_id,firebase_id')

await upsert('shifts',shifts.map(s=>({
  organization_id:organizationId,firebase_id:s.id,firebase_mission_id:s.missionId||null,firebase_site_id:s.siteId||null,
  firebase_agent_uid:s.agentId||null,status:s.status||null,started_at:iso(s.startTime),completed_at:iso(s.completedAt),
  payload:clean(s),updated_at:new Date().toISOString()
})),'organization_id,firebase_id')

const reportRows=[]
for(const r of reports){
  let photoPath=null
  const image=dataUrlToBuffer(r.photoUrl)
  if(image&&process.env.DRY_RUN!=='true'){
    const ext=image.mime.includes('png')?'png':'jpg'
    photoPath=`${organizationId}/${r.id}.${ext}`
    const {error}=await supabase.storage.from(photoBucket).upload(photoPath,image.buffer,{contentType:image.mime,upsert:true})
    if(error)console.warn(`Photo ${r.id} non migrée: ${error.message}`)
  }
  reportRows.push({
    organization_id:organizationId,firebase_id:r.id,firebase_mission_id:r.missionId||null,firebase_shift_id:r.shiftId||null,
    firebase_site_id:r.siteId||null,firebase_agent_uid:r.agentId||null,occurred_at:iso(r.occurredAt||r.createdAt||r.photoCapturedAt),
    category:r.category||null,severity:r.severity||null,message:r.message||null,photo_bucket:photoPath?photoBucket:null,photo_path:photoPath,
    payload:clean({...r,photoUrl:image?'[migrated-to-storage]':r.photoUrl}),updated_at:new Date().toISOString()
  })
}
await upsert('reports',reportRows,'organization_id,firebase_id')

// Les anciens documents Firestore ne contiennent pas toujours un vrai fichier PDF.
// Ils sont migrés comme métadonnées et seront régénérés lors du premier téléchargement.
await upsert('generated_documents',documents.map(d=>({
  organization_id:organizationId,firebase_id:d.id,firebase_site_id:d.siteId||null,firebase_mission_id:d.missionId||null,
  type:d.type||'mission',title:d.title||'Document migré',row_count:Number(d.rowCount||0),storage_bucket:'main-courantes',
  storage_path:`${organizationId}/legacy/${d.id}.pdf`,payload:clean(d.payload||{}),status:d.status||'legacy',delivery_status:'legacy_pending_pdf',
  created_by_external_uid:d.createdBy||null,created_at:iso(d.createdAt)||new Date().toISOString(),updated_at:new Date().toISOString()
})),'organization_id,firebase_id')

console.log('Migration terminée. Contrôlez les comptages et les relations avant d’activer le mode dual.')
