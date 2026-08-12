import 'dotenv/config'
import fs from 'node:fs/promises'
import process from 'node:process'
import { initializeApp, cert } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'

const serviceAccountPath=process.env.FIREBASE_SERVICE_ACCOUNT_JSON
if(!serviceAccountPath) throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON manquant.')
if(process.env.APPLY_FIREBASE_CLAIMS!=='true') throw new Error('Sécurité : définissez APPLY_FIREBASE_CLAIMS=true pour exécuter réellement la mise à jour.')
const account=JSON.parse(await fs.readFile(serviceAccountPath,'utf8'))
initializeApp({credential:cert(account)})
const auth=getAuth()
let pageToken
let updated=0
let skipped=0
do{
  const page=await auth.listUsers(1000,pageToken)
  for(const user of page.users){
    const existing=user.customClaims||{}
    if(existing.role==='authenticated'){skipped++;continue}
    await auth.setCustomUserClaims(user.uid,{...existing,role:'authenticated'})
    updated++
    console.log(`Claim Supabase ajouté : ${user.email||user.uid}`)
  }
  pageToken=page.pageToken
}while(pageToken)
console.log(`Terminé : ${updated} utilisateur(s) mis à jour, ${skipped} déjà configuré(s).`)
