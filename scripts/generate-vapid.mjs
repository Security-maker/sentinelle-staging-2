import { createECDH } from 'node:crypto';

const projectRef = 'ksoyqtsrhtsfbwmxipqz';
const subject = process.env.VAPID_SUBJECT || 'mailto:ncr-formations@outlook.fr';
const ecdh = createECDH('prime256v1');
ecdh.generateKeys();
const b64url = buffer => Buffer.from(buffer).toString('base64url');
const publicKey = b64url(ecdh.getPublicKey(null, 'uncompressed'));
const privateKey = b64url(ecdh.getPrivateKey());

console.log('\nSentinelle Pro V5.8.8 — clés VAPID générées');
console.log('Ne mets JAMAIS la clé privée dans GitHub.\n');
console.log(`WEB_PUSH_VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`WEB_PUSH_VAPID_PRIVATE_KEY=${privateKey}`);
console.log(`WEB_PUSH_VAPID_SUBJECT=${subject}`);
console.log('\nCommande Supabase prête à copier :\n');
console.log(`supabase secrets set WEB_PUSH_VAPID_PUBLIC_KEY=${publicKey} WEB_PUSH_VAPID_PRIVATE_KEY=${privateKey} WEB_PUSH_VAPID_SUBJECT=${subject} --project-ref ${projectRef}`);
console.log('\nPuis déploie :');
console.log(`supabase functions deploy send-web-push --project-ref ${projectRef}`);
