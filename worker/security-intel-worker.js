// Sentinelle Pro V4.8.2 — Worker Veille Sécurité renforcé
// Multi-sources sans clé API : geo.api.gouv.fr + GDELT + Google News RSS.
// Objectif : ne jamais casser l'app si une source publique est indisponible.

const KEYWORDS = [
  { type:'Manifestation', words:['manifestation','rassemblement','cortege','cortège','protestation','mobilisation','blocage','barrage'], weight:18 },
  { type:'Grève', words:['greve','grève','preavis','préavis','transport perturbe','transport perturbé','sncf','ratp','mouvement social','debrayage','débrayage'], weight:16 },
  { type:'Incident urbain', words:['violence','emeute','émeute','degradation','dégradation','incendie','affrontement','tension','trouble','rixe','intrusion'], weight:22 },
  { type:'Sécurité publique', words:['police','prefecture','préfecture','securite','sécurité','evacuation','évacuation','perimetre','périmètre','intervention','alerte'], weight:10 },
  { type:'Transport', words:['trafic','circulation','route fermee','route fermée','perturbation','accident','retard','bouchon','gare'], weight:9 },
  { type:'Événement', words:['concert','match','festival','evenement','événement','foire','salon','stade'], weight:7 }
];

const DEFAULT_RECOMMENDATIONS = [
  'Vérifier les canaux officiels : préfecture, mairie, transports, forces de l’ordre.',
  'Confirmer les consignes avec le client si le site est sensible.',
  'Rappeler aux agents de signaler tout rassemblement, accès bloqué ou situation inhabituelle.',
  'Relancer la veille avant une prise de poste critique ou événementielle.'
];

function cors(origin, env){
  const allowed = env.ALLOWED_ORIGIN || '*';
  const allowOrigin = allowed === '*' ? '*' : (origin === allowed || origin?.startsWith(allowed + '/') ? origin : allowed);
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  };
}
function json(data, status=200, origin='', env={}){
  return new Response(JSON.stringify(data), { status, headers:cors(origin, env) });
}
function normalize(s){ return String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,''); }
function stripHtml(s){ return String(s||'').replace(/<[^>]*>/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/\s+/g,' ').trim(); }
function domainFromUrl(url){ try { return new URL(url).hostname.replace(/^www\./,''); } catch(e){ return ''; } }
function timeoutFetch(url, options={}, ms=7000){
  const controller = new AbortController();
  const id = setTimeout(()=>controller.abort('timeout'), ms);
  return fetch(url, { ...options, signal: controller.signal }).finally(()=>clearTimeout(id));
}

async function resolveCity(city){
  try {
    const url = `https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(city)}&fields=nom,code,codeDepartement,centre&limit=1`;
    const res = await timeoutFetch(url, { headers:{ 'Accept':'application/json' } }, 6000);
    if (!res.ok) return null;
    const rows = await res.json();
    return rows?.[0] || null;
  } catch(e){ return null; }
}

async function fetchGdelt(city){
  const query = `(${city}) (manifestation OR grève OR greve OR rassemblement OR blocage OR violence OR incident OR perturbation OR sécurité OR police OR préfecture OR transport OR évacuation OR accident)`;
  const url = 'https://api.gdeltproject.org/api/v2/doc/doc?' + new URLSearchParams({
    query,
    mode:'ArtList',
    format:'json',
    maxrecords:'35',
    sort:'HybridRel',
    timespan:'7d',
    sourcelang:'french'
  }).toString();
  const res = await timeoutFetch(url, { headers:{ 'Accept':'application/json', 'User-Agent':'SentinellePro/4.8.2' } }, 9000);
  if (!res.ok) throw new Error(`GDELT HTTP ${res.status}`);
  const data = await res.json();
  const rows = Array.isArray(data.articles) ? data.articles : [];
  return rows.map(a => ({
    title: stripHtml(a.title || 'Article'),
    url: a.url || '',
    domain: a.domain || domainFromUrl(a.url),
    date: a.seendate || '',
    source: 'GDELT'
  }));
}

async function fetchGoogleNews(city){
  const q = `${city} manifestation OR grève OR incident OR sécurité OR transport`;
  const url = 'https://news.google.com/rss/search?' + new URLSearchParams({
    q,
    hl:'fr',
    gl:'FR',
    ceid:'FR:fr'
  }).toString();
  const res = await timeoutFetch(url, { headers:{ 'Accept':'application/rss+xml, text/xml, */*' } }, 9000);
  if (!res.ok) throw new Error(`Google News HTTP ${res.status}`);
  const xml = await res.text();
  const items = [...xml.matchAll(/<item>[\s\S]*?<\/item>/g)].slice(0, 20).map(m => m[0]);
  return items.map(item => {
    const title = stripHtml((item.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) || item.match(/<title>([\s\S]*?)<\/title>/) || [,'Article'])[1]);
    const link = stripHtml((item.match(/<link>([\s\S]*?)<\/link>/) || [,''])[1]);
    const pubDate = stripHtml((item.match(/<pubDate>([\s\S]*?)<\/pubDate>/) || [,''])[1]);
    const source = stripHtml((item.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [,'Google News'])[1]);
    return { title, url: link, domain: source || domainFromUrl(link), date: pubDate, source:'Google News' };
  }).filter(x => x.title && !/^Article$/.test(x.title));
}

async function collectArticles(city){
  const status = [];
  let articles = [];
  const gdelt = await fetchGdelt(city).then(rows => ({ ok:true, rows })).catch(err => ({ ok:false, error:err.message }));
  status.push({ name:'GDELT', ok:gdelt.ok, count:gdelt.rows?.length || 0, error:gdelt.error || null });
  if (gdelt.ok) articles = articles.concat(gdelt.rows);

  const news = await fetchGoogleNews(city).then(rows => ({ ok:true, rows })).catch(err => ({ ok:false, error:err.message }));
  status.push({ name:'Google News RSS', ok:news.ok, count:news.rows?.length || 0, error:news.error || null });
  if (news.ok) articles = articles.concat(news.rows);

  const seen = new Set();
  articles = articles.filter(a => {
    const key = normalize(a.title).slice(0,120);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 40);
  return { articles, status };
}

function analyze(city, articles, status){
  if (!articles.length) {
    return {
      score: 0,
      level: 'Analyse limitée',
      limited: true,
      summary: `Aucun résultat public exploitable n’a pu être récupéré automatiquement pour ${city}. Cela ne doit pas être interprété comme une absence de risque. Vérifie les canaux officiels, le client, la préfecture, la mairie, les transports et les consignes QG.`,
      signals: [{ type:'Sources', count:0, weight:0, label:'Sources publiques non exploitables ou temporairement indisponibles', levelClass:'warning' }],
      recommendations: DEFAULT_RECOMMENDATIONS,
      sourceStatus: status
    };
  }

  const joined = articles.map(a => `${a.title||''} ${a.date||''} ${a.domain||''} ${a.source||''}`).join(' \n ');
  const text = normalize(joined);
  const signals = KEYWORDS.map(k => {
    const count = k.words.reduce((acc,w)=> acc + (text.includes(normalize(w)) ? 1 : 0), 0);
    return count ? { type:k.type, count, weight:k.weight, label:`Signal ${k.type.toLowerCase()} détecté dans les résultats publics`, levelClass: k.weight >= 18 ? 'orange' : 'warning' } : null;
  }).filter(Boolean);

  let score = Math.min(100, signals.reduce((acc,s)=> acc + s.count * s.weight, 0) + Math.min(18, articles.length));
  let level = 'Normal';
  if (score >= 75) level = 'Risque élevé';
  else if (score >= 45) level = 'Attention';
  else if (score >= 22) level = 'Vigilance légère';

  const summary = signals.length
    ? `Des signaux publics liés à ${signals.map(s=>s.type.toLowerCase()).join(', ')} ressortent autour de ${city}. Niveau proposé : ${level}. À confirmer avec les consignes officielles et le client.`
    : `Des résultats publics existent autour de ${city}, mais aucun signal sécurité fort n’a été identifié automatiquement. Maintiens une veille normale et vérifie les canaux officiels avant mission sensible.`;

  const recommendations = score >= 75 ? [
    'Informer les agents avant prise de poste et rappeler les consignes QG.',
    'Vérifier les accès au site, itinéraires alternatifs et contacts d’urgence.',
    'Prévoir un message Flash si des agents sont en poste dans la zone.',
    'Surveiller les canaux officiels : préfecture, mairie, forces de l’ordre, client.'
  ] : score >= 45 ? [
    'Prévenir les agents concernés et demander une vigilance accrue.',
    'Contrôler les accès sensibles et anticiper les retards de transport.',
    'Mettre à jour les consignes mission si nécessaire.',
    'Relancer la veille avant le début de poste.'
  ] : [
    'Maintenir la veille normale.',
    'Vérifier les consignes site et les contacts QG avant prise de poste.',
    'Relancer l’analyse avant une mission sensible ou événementielle.'
  ];

  return { score, level, limited:false, summary, signals, recommendations, sourceStatus: status };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { headers:cors(origin, env) });
    try {
      let body = {};
      if (request.method === 'POST') body = await request.json().catch(()=>({}));
      else if (request.method === 'GET') body.city = new URL(request.url).searchParams.get('city');
      else return json({ error:'Méthode non autorisée' }, 405, origin, env);

      const city = String(body.city || '').trim();
      if (!city || city.length < 2) return json({ error:'Ville manquante' }, 400, origin, env);
      const resolved = await resolveCity(city);
      const cityName = resolved?.nom || city;
      const { articles, status } = await collectArticles(cityName);
      const analysis = analyze(cityName, articles, status);
      const sources = articles.slice(0,12).map(a => ({
        title:a.title || 'Source',
        url:a.url || '',
        domain:a.domain || domainFromUrl(a.url),
        date:a.date || '',
        source:a.source || ''
      }));

      return json({
        ok:true,
        city:cityName,
        department:resolved?.codeDepartement || null,
        generatedAt:new Date().toISOString(),
        score:analysis.score,
        level:analysis.level,
        limited:analysis.limited,
        summary:analysis.summary,
        signals:analysis.signals,
        recommendations:analysis.recommendations,
        sources,
        sourceStatus:analysis.sourceStatus,
        disclaimer:'Veille automatique de sources publiques. À confirmer avec les canaux officiels, le client et les consignes QG.'
      }, 200, origin, env);
    } catch(error) {
      return json({
        ok:true,
        city:'',
        generatedAt:new Date().toISOString(),
        score:0,
        level:'Analyse limitée',
        limited:true,
        summary:`Analyse automatique limitée : ${error?.message || 'source indisponible'}. Vérifie les canaux officiels et les consignes QG.`,
        signals:[{ type:'Erreur source', count:0, weight:0, label:'Source publique indisponible', levelClass:'warning' }],
        recommendations:DEFAULT_RECOMMENDATIONS,
        sources:[],
        sourceStatus:[{ name:'Worker', ok:false, count:0, error:error?.message || 'Erreur inconnue' }],
        disclaimer:'Réponse de secours. Ne pas interpréter comme une absence de risque.'
      }, 200, origin, env);
    }
  }
};
