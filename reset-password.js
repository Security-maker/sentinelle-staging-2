import { supabaseConfig } from './supabase-config.js';

const form=document.querySelector('#reset-password-form');
const lead=document.querySelector('#reset-lead');
const messageBox=document.querySelector('#client-message');
const actions=document.querySelector('#reset-actions');
const primary=document.querySelector('#reset-return-primary');
const other=document.querySelector('#reset-return-other');
const returnTarget=new URLSearchParams(location.search).get('return')==='client'?'client':'main';
let supabase=null;
let recoveryReady=false;

function message(text,type='error'){
  messageBox.className=type;
  messageBox.textContent=text;
}
function clearStoredSentinelleSessions(){
  try{localStorage.removeItem('sentinelle-client-v591-auth');}catch{}
  try{localStorage.removeItem('sentinelle-pro-v590-auth');}catch{}
}
function configureReturnButtons(){
  const primaryUrl=returnTarget==='client'?'./client.html':'./index.html';
  const otherUrl=returnTarget==='client'?'./index.html':'./client.html';
  primary.textContent=returnTarget==='client'?'Retour à l’espace client':'Retour connexion équipe';
  other.textContent=returnTarget==='client'?'Connexion équipe':'Espace client';
  primary.onclick=()=>location.replace(primaryUrl);
  other.onclick=()=>location.replace(otherUrl);
}
function setReady(){
  if(recoveryReady)return;
  recoveryReady=true;
  lead.textContent='Choisissez un nouveau mot de passe d’au moins 8 caractères.';
  form.hidden=false;
  message('Lien sécurisé validé.','success');
}
function setInvalid(){
  if(recoveryReady)return;
  lead.textContent='Ce lien de récupération est expiré, invalide ou a déjà été utilisé.';
  form.hidden=true;
  actions.style.display='flex';
  message('Demandez un nouveau lien depuis l’écran de connexion.');
}

async function boot(){
  if(!supabaseConfig?.enabled||!supabaseConfig?.url||!supabaseConfig?.publishableKey){
    setInvalid();return;
  }
  const {createClient}=await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
  // Stockage volontairement séparé et non persistant : aucune ancienne session Agent/Admin/Client
  // ne peut décider de l’espace ouvert par le lien de récupération.
  supabase=createClient(supabaseConfig.url,supabaseConfig.publishableKey,{
    auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:true,storageKey:'sentinelle-reset-v593-auth'}
  });
  configureReturnButtons();
  supabase.auth.onAuthStateChange((event,session)=>{
    if((event==='PASSWORD_RECOVERY'||event==='SIGNED_IN')&&session)setReady();
  });
  for(const wait of [0,120,350,800]){
    if(wait)await new Promise(r=>setTimeout(r,wait));
    const {data:{session}}=await supabase.auth.getSession();
    if(session){setReady();break;}
  }
  if(!recoveryReady)setInvalid();
}

form?.addEventListener('submit',async event=>{
  event.preventDefault();
  if(!recoveryReady||!supabase)return message('Lien de récupération invalide.');
  const fd=new FormData(form);
  const password=String(fd.get('password')||'');
  const confirm=String(fd.get('confirm')||'');
  if(password.length<8)return message('Le mot de passe doit contenir au moins 8 caractères.');
  if(password!==confirm)return message('Les deux mots de passe ne correspondent pas.');
  const button=form.querySelector('button[type="submit"]');button.disabled=true;
  const {error}=await supabase.auth.updateUser({password});
  if(error){button.disabled=false;return message(error.message||'Impossible de modifier le mot de passe.');}
  await supabase.auth.signOut({scope:'local'}).catch(()=>{});
  clearStoredSentinelleSessions();
  recoveryReady=false;form.hidden=true;
  lead.textContent='Votre mot de passe a été modifié.';
  message('Reconnectez-vous manuellement avec votre adresse e-mail et votre nouveau mot de passe.','success');
  actions.style.display='flex';
  history.replaceState({},'',new URL('./reset-password.html',location.href).href);
});

boot().catch(error=>{console.error(error);configureReturnButtons();setInvalid();});
