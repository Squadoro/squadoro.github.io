/*
 * Squadoro : serveur de lecture des captures (Cloudflare Worker).
 *
 * Il reçoit les captures envoyées par le site ou l'appli, ajoute la consigne
 * correspondante et demande la lecture à Claude (API d'Anthropic). La clé d'API
 * reste ici, jamais dans l'appli. Les images ne sont pas enregistrées.
 *
 * Réglages du Worker (Settings → Variables and Secrets) :
 *   ANTHROPIC_API_KEY  (Secret, obligatoire) : ta clé d'API Anthropic.
 *   MODEL              (Text, facultatif)    : modèle utilisé, "claude-haiku-5-5" par défaut.
 *   FIRST_DAY_LIMIT    (Text, facultatif)    : captures le premier jour d'utilisation d'un appareil, 50 par défaut.
 *   DAILY_LIMIT        (Text, facultatif)    : captures par jour ensuite, 20 par défaut.
 * Liaison (Settings → Bindings) :
 *   LIMITS (KV namespace) : nécessaire pour appliquer les limites côté serveur.
 *   Sans elle, seule l'appli compte les captures (contournable en effaçant ses données).
 */

const PROMPTS = {
  "scan": "Tu reçois des captures d'écran ou des photos du club EA SPORTS FC 27 Ultimate Team d'un joueur (cartes de joueurs).\nPour CHAQUE carte de joueur visible, renvoie un objet. Réponds UNIQUEMENT avec un tableau JSON, sans texte autour.\nChamps de chaque objet :\n- \"name\" : nom affiché sur la carte (texte exact).\n- \"ovr\" : note générale (entier).\n- \"pos\" : poste principal affiché (ex. \"ST\", \"BU\", \"CM\", \"MC\", \"GK\", \"G\").\n- \"alt\" : postes alternatifs s'ils sont visibles (tableau), sinon [].\n- \"nation\", \"league\", \"club\" : d'après le drapeau, le logo de ligue et l'écusson visibles, ou ta connaissance du vrai joueur si tu es sûr (noms usuels en français, ex. « Angleterre », « Premier League »), sinon null.\n- \"kind\" : \"base\" (carte normale or/argent/bronze), \"totw\" (équipe de la semaine), \"icon\", \"hero\", \"hof\" (Hall of FUT) ou \"special\" (autre promo).\n- \"rare\" : true / false si visible (carte rare = design brillant), sinon null.\n- \"score\" : score d'objet (petit nombre avec un losange) s'il est affiché, sinon null.\n- \"untradeable\" : true si la carte est marquée non échangeable, false si clairement échangeable, sinon null.\n- \"stats\" : [VIT, TIR, PAS, DRI, DEF, PHY] si les six valeurs sont visibles, sinon null.\n- \"playstyles\" : PlayStyles visibles (noms, avec « + » pour un PlayStyle+), sinon [].\n- \"roles\" : rôles FC 27 visibles avec leur niveau (ex. \"Avant-centre++\", \"Faux 9+\"), sinon [].\n- \"wf\" : pied faible (1-5) et \"sm\" : gestes techniques (1-5) si visibles, sinon null. \"height\" : taille en cm si visible, sinon null.\n- \"qty\" : nombre d'exemplaires si un compteur est affiché, sinon 1.\n- \"confidence\" : \"haute\", \"moyenne\" ou \"basse\".\nN'invente rien : mets null quand une information n'est pas lisible. Ignore les emplacements vides, les badges, les consommables et tout ce qui n'est pas une carte de joueur.\nNe compte pas deux fois la même carte si elle apparaît sur deux images qui se chevauchent.\n",
  "fill": "Voici des footballeurs réels présents dans EA SPORTS FC 27 (saison 2026-2027), avec leur note et leur poste. Pour chacun, donne sa nation (sélection sportive), sa ligue et son club actuels, avec les noms usuels en français (ex. « Angleterre », « Premier League », « Liverpool »). Pour une ICÔNE, mets ligue et club « ICÔNES » ; pour un Héros, mets club « HÉROS » et sa ligue. Si tu ne reconnais pas le joueur avec certitude, mets null pour les trois champs. Réponds UNIQUEMENT avec un tableau JSON : [{\"i\": numéro, \"nation\": \"...\", \"league\": \"...\", \"club\": \"...\"}].\n\n",
  "sbc": "Tu reçois une capture d'écran d'un DCE (Défi Création d'Équipe / SBC) d'EA SPORTS FC 27 Ultimate Team, en français ou en anglais. Lis ses conditions et réponds UNIQUEMENT par un objet JSON au format :\n{\"name\": \"nom du DCE (ou du défi)\", \"set\": \"nom du set s'il y en a un, sinon \\\"\\\"\", \"type\": \"score\" ou \"classic\", \"target\": score requis (si type score), \"minOvr\": note min des cartes ou 0, \"maxOvr\": note max ou 0, \"repeat\": 1, \"formation\": \"any\" ou une formation parmi 4-3-3, 4-4-2, 4-2-3-1, 3-5-2, 3-4-3, 4-1-2-1-2, 4-5-1, 5-3-2, \"reward\": \"récompense en quelques mots\", \"conds\": [ ... ]}\nConditions (type classic) : {\"t\":\"rating\",\"n\":N} note d'équipe min ; {\"t\":\"chem\",\"n\":N} collectif total min ; {\"t\":\"chemPlayer\",\"n\":N} ; {\"t\":\"quality\",\"op\":\"min|max|exactly\",\"n\":0|1|2} (0 Bronze, 1 Argent, 2 Or) ; {\"t\":\"qcount\",\"q\":0|1|2,\"op\":\"min|max|exactly\",\"n\":N} nombre de joueurs Or/Argent/Bronze ; {\"t\":\"rare\",\"op\":\"min\",\"n\":N} ; {\"t\":\"totw\",\"op\":\"min\",\"n\":N} ; {\"t\":\"special\",\"op\":\"min\",\"n\":N} ; {\"t\":\"from\",\"field\":\"league|nation|club\",\"op\":\"min|max|exactly\",\"n\":N,\"value\":\"Nom1, Nom2\"} ; {\"t\":\"distinct\",\"field\":\"league|nation|club\",\"op\":\"min|max|exactly\",\"n\":N} (nombre de ligues/nations/clubs dans l'équipe) ; {\"t\":\"same\",\"field\":\"league|nation|club\",\"op\":\"min|max\",\"n\":N} (joueurs de la même ligue/nation/club) ; {\"t\":\"ovrMin\",\"n\":N} ; {\"t\":\"ovrMax\",\"n\":N}.\nSi une valeur n'est pas lisible, omets la condition plutôt que de l'inventer."
};

const ALLOWED_ORIGINS = ['https://squadoro.github.io', 'squadoro://app'];
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_IMAGES = 4;
const MAX_IMAGE_CHARS = 6500000; // environ 4,8 Mo une fois décodé
const MAX_TEXT = 8000;

function reply(body, status, origin) {
  return new Response(body === null ? null : JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    }
  });
}

// Jour local (Bruxelles) pour que la limite se remette à zéro à minuit, comme dans l'appli.
function today() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

// Limites : 50 captures le premier jour d'utilisation d'un appareil, puis 20 par jour.
// Garde-fous en plus : 150 captures par jour et par adresse IP, 40 recherches nation/ligue/club par jour et par appareil.
async function checkQuota(env, request, device, task, images) {
  if (!env.LIMITS) return { ok: true };
  try {
    const ip = request.headers.get('CF-Connecting-IP') || 'inconnu';
    const day = today();
    const dev = /^[A-Za-z0-9-]{8,64}$/.test(device || '') ? device : 'ip-' + ip;
    if (task === 'fill') {
      const key = 'fill:' + day + ':' + dev;
      const used = parseInt((await env.LIMITS.get(key)) || '0', 10);
      if (used >= 40) return { ok: false, body: { error: 'rate_limited' } };
      await env.LIMITS.put(key, String(used + 1), { expirationTtl: 172800 });
      return { ok: true };
    }
    let first = await env.LIMITS.get('first:' + dev);
    if (!first) { first = day; await env.LIMITS.put('first:' + dev, day); }
    const isFirst = first === day;
    const max = isFirst ? parseInt(env.FIRST_DAY_LIMIT || '50', 10) : parseInt(env.DAILY_LIMIT || '20', 10);
    const key = 'img:' + day + ':' + dev, ipKey = 'ipimg:' + day + ':' + ip;
    const used = parseInt((await env.LIMITS.get(key)) || '0', 10);
    const ipUsed = parseInt((await env.LIMITS.get(ipKey)) || '0', 10);
    if (used + images > max || ipUsed + images > 150) {
      return { ok: false, body: { error: 'quota', max, used, first: isFirst } };
    }
    await env.LIMITS.put(key, String(used + images), { expirationTtl: 172800 });
    await env.LIMITS.put(ipKey, String(ipUsed + images), { expirationTtl: 172800 });
    return { ok: true };
  } catch (e) {
    return { ok: true }; // en cas de souci de stockage, on laisse passer : la limite de dépense Anthropic reste le garde-fou
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    if (request.method === 'OPTIONS') return reply(null, 204, allowOrigin);
    if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405, allowOrigin);
    if (!ALLOWED_ORIGINS.includes(origin)) return reply({ error: 'forbidden_origin' }, 403, allowOrigin);
    if (!env.ANTHROPIC_API_KEY) return reply({ error: 'not_configured' }, 500, allowOrigin);

    let body;
    try { body = await request.json(); } catch (e) { return reply({ error: 'bad_request' }, 400, allowOrigin); }
    const task = body && body.task;
    if (!Object.prototype.hasOwnProperty.call(PROMPTS, task)) return reply({ error: 'bad_task' }, 400, allowOrigin);

    const images = Array.isArray(body.images) ? body.images.slice(0, MAX_IMAGES) : [];
    if ((task === 'scan' || task === 'sbc') && images.length === 0) return reply({ error: 'no_image' }, 400, allowOrigin);
    if (task === 'fill' && images.length) return reply({ error: 'bad_request' }, 400, allowOrigin);
    for (const im of images) {
      if (!im || !IMAGE_TYPES.includes(im.type) || typeof im.data !== 'string' || im.data.length > MAX_IMAGE_CHARS) {
        return reply({ error: 'bad_image' }, 400, allowOrigin);
      }
    }
    const text = String((body && body.text) || '').slice(0, MAX_TEXT);

    const quota = await checkQuota(env, request, body.device, task, images.length);
    if (!quota.ok) return reply(quota.body, 429, allowOrigin);

    const content = images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.type, data: im.data } }));
    content.push({ type: 'text', text: PROMPTS[task] + text });

    let upstream;
    try {
      upstream = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: env.MODEL || 'claude-haiku-5-5',
          max_tokens: task === 'scan' ? 8000 : 3000,
          messages: [{ role: 'user', content }]
        })
      });
    } catch (e) {
      return reply({ error: 'upstream_unreachable' }, 502, allowOrigin);
    }
    if (upstream.status === 429) return reply({ error: 'rate_limited' }, 429, allowOrigin);
    if (!upstream.ok) return reply({ error: 'upstream', status: upstream.status }, 502, allowOrigin);
    const data = await upstream.json();
    const out = (data.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
    return reply({ text: out }, 200, allowOrigin);
  }
};
