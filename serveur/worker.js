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
 * Liaisons (Bindings) :
 *   LIMITS (KV namespace) : nécessaire pour appliquer les limites côté serveur.
 *     Sans elle, seule l'appli compte les captures (contournable en effaçant ses données).
 *   DB (D1 database) : base commune des cartes (recherche par nom, note, version).
 *     Les tables sont créées automatiquement au premier appel.
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

/* ---------- Base commune des cartes (D1) ---------- */
const KINDS = ['base', 'totw', 'special', 'hero', 'hof', 'icon'];
const POSITIONS = ['GK', 'LB', 'CB', 'RB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST'];
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS cards (k TEXT PRIMARY KEY, name TEXT NOT NULL, n1 TEXT NOT NULL, n2 TEXT NOT NULL, n3 TEXT NOT NULL, ovr INTEGER NOT NULL, kind TEXT NOT NULL, rare INTEGER NOT NULL DEFAULT 0, pos TEXT NOT NULL, alt TEXT, nation TEXT, league TEXT, club TEXT, stats TEXT, extra TEXT, seen INTEGER NOT NULL DEFAULT 1, updated TEXT)'),
    db.prepare('CREATE INDEX IF NOT EXISTS cards_n1 ON cards(n1)'),
    db.prepare('CREATE INDEX IF NOT EXISTS cards_n2 ON cards(n2)'),
    db.prepare('CREATE INDEX IF NOT EXISTS cards_n3 ON cards(n3)'),
    db.prepare('CREATE TABLE IF NOT EXISTS contrib (d TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL, PRIMARY KEY (d, day))')
  ]);
  schemaReady = true;
}
function norm(s) {
  return String(s || '').replace(/[øØ]/g, 'o').replace(/[łŁ]/g, 'l').replace(/[æÆ]/g, 'ae').replace(/ß/g, 'ss').replace(/[đĐ]/g, 'd').replace(/ı/g, 'i')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 .'-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}
function text(v, max) { v = typeof v === 'string' ? v.trim() : ''; return v && v !== '—' ? v.slice(0, max || 40) : ''; }
function cleanCard(c) {
  if (!c || typeof c !== 'object') return null;
  const name = text(c.name, 40), n1 = norm(name), ovr = Math.round(+c.ovr);
  if (n1.length < 2 || !/[a-z]/.test(n1) || !(ovr >= 40 && ovr <= 99)) return null;
  const kind = KINDS.includes(c.kind) ? c.kind : 'base', pos = POSITIONS.includes(c.pos) ? c.pos : null;
  if (!pos) return null;
  const alt = (Array.isArray(c.alt) ? c.alt : []).filter((p) => POSITIONS.includes(p) && p !== pos).slice(0, 4);
  const stats = Array.isArray(c.stats) && c.stats.length === 6 && c.stats.every((v) => Number.isInteger(+v) && +v >= 1 && +v <= 99) ? c.stats.map(Number) : null;
  const list = (a, n) => (Array.isArray(a) ? a : []).map((x) => text(x, 30)).filter(Boolean).slice(0, n);
  const extra = { playstyles: list(c.playstyles, 12), roles: list(c.roles, 8) };
  if (+c.wf >= 1 && +c.wf <= 5) extra.wf = +c.wf;
  if (+c.sm >= 1 && +c.sm <= 5) extra.sm = +c.sm;
  if (+c.height >= 140 && +c.height <= 215) extra.height = +c.height;
  const words = n1.split(' ');
  return { k: n1 + '|' + ovr + '|' + kind, name, n1, n2: words.length > 1 ? words.slice(1).join(' ') : n1, n3: words[words.length - 1], ovr, kind, rare: c.rare ? 1 : 0, pos, alt: alt.join(','),
    nation: text(c.nation), league: text(c.league), club: text(c.club), stats: stats ? JSON.stringify(stats) : null,
    extra: (extra.playstyles.length || extra.roles.length || extra.wf || extra.sm || extra.height) ? JSON.stringify(extra) : null };
}
function outCard(r) {
  let extra = {}; try { extra = r.extra ? JSON.parse(r.extra) : {}; } catch (e) { extra = {}; }
  let stats = null; try { stats = r.stats ? JSON.parse(r.stats) : null; } catch (e) { stats = null; }
  return { name: r.name, ovr: r.ovr, kind: r.kind, rare: !!r.rare, pos: r.pos, alt: r.alt ? r.alt.split(',').filter(Boolean) : [], nation: r.nation || '', league: r.league || '', club: r.club || '',
    stats, playstyles: extra.playstyles || [], roles: extra.roles || [], wf: extra.wf || 0, sm: extra.sm || 0, height: extra.height || 0, seen: r.seen };
}
const COLS = 'name, ovr, kind, rare, pos, alt, nation, league, club, stats, extra, seen';
async function handleCards(env, task, body, origin) {
  const db = env.DB;
  if (!db) return reply({ error: 'no_db' }, 503, origin);
  await ensureSchema(db);
  if (task === 'cards_search') {
    const q = norm(body.q);
    if (q.length < 2) return reply({ cards: [] }, 200, origin);
    let sql = 'SELECT ' + COLS + ' FROM cards WHERE ((n1 >= ?1 AND n1 < ?2) OR (n2 >= ?1 AND n2 < ?2) OR (n3 >= ?1 AND n3 < ?2))';
    const args = [q, q + '~'];
    const ovr = Math.round(+body.ovr);
    if (ovr >= 40 && ovr <= 99) { sql += ' AND ovr = ?' + (args.length + 1); args.push(ovr); }
    if (KINDS.includes(body.kind)) { sql += ' AND kind = ?' + (args.length + 1); args.push(body.kind); }
    sql += ' ORDER BY seen DESC, ovr DESC LIMIT 15';
    const res = await db.prepare(sql).bind(...args).all();
    return reply({ cards: (res.results || []).map(outCard) }, 200, origin);
  }
  if (task === 'cards_lookup') {
    const items = (Array.isArray(body.items) ? body.items : []).slice(0, 80);
    if (!items.length) return reply({ found: [] }, 200, origin);
    const stmts = items.map((it) => {
      const n1 = norm(it && it.name), ovr = Math.round(+(it && it.ovr));
      return ovr >= 40 && ovr <= 99
        ? db.prepare('SELECT ' + COLS + ' FROM cards WHERE n1 = ?1 AND ovr = ?2 ORDER BY seen DESC LIMIT 1').bind(n1, ovr)
        : db.prepare('SELECT ' + COLS + ' FROM cards WHERE n1 = ?1 ORDER BY seen DESC LIMIT 1').bind(n1);
    });
    const res = await db.batch(stmts);
    return reply({ found: res.map((r) => (r.results && r.results[0] ? outCard(r.results[0]) : null)) }, 200, origin);
  }
  if (task === 'cards_add') {
    const device = /^[A-Za-z0-9-]{8,64}$/.test(body.device || '') ? body.device : null;
    if (!device) return reply({ error: 'bad_request' }, 400, origin);
    const cards = (Array.isArray(body.cards) ? body.cards : []).slice(0, 200).map(cleanCard).filter(Boolean);
    if (!cards.length) return reply({ added: 0 }, 200, origin);
    const day = today();
    const used = await db.prepare('SELECT n FROM contrib WHERE d = ?1 AND day = ?2').bind(device, day).first('n') || 0;
    const room = Math.max(0, 600 - used);
    const take = cards.slice(0, room);
    if (!take.length) return reply({ error: 'rate_limited' }, 429, origin);
    const now = new Date().toISOString();
    const up = db.prepare('INSERT INTO cards (k, name, n1, n2, n3, ovr, kind, rare, pos, alt, nation, league, club, stats, extra, seen, updated) VALUES (?1, ?2, ?3, ?4, ?16, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 1, ?15) ' +
      "ON CONFLICT(k) DO UPDATE SET seen = cards.seen + 1, updated = excluded.updated, rare = MAX(cards.rare, excluded.rare), " +
      "alt = CASE WHEN cards.alt IS NULL OR cards.alt = '' THEN excluded.alt ELSE cards.alt END, " +
      "nation = CASE WHEN cards.nation IS NULL OR cards.nation = '' THEN excluded.nation ELSE cards.nation END, " +
      "league = CASE WHEN cards.league IS NULL OR cards.league = '' THEN excluded.league ELSE cards.league END, " +
      "club = CASE WHEN cards.club IS NULL OR cards.club = '' THEN excluded.club ELSE cards.club END, " +
      'stats = COALESCE(cards.stats, excluded.stats), extra = COALESCE(cards.extra, excluded.extra)');
    const stmts = take.map((c) => up.bind(c.k, c.name, c.n1, c.n2, c.ovr, c.kind, c.rare, c.pos, c.alt, c.nation, c.league, c.club, c.stats, c.extra, now, c.n3));
    stmts.push(db.prepare('INSERT INTO contrib (d, day, n) VALUES (?1, ?2, ?3) ON CONFLICT(d, day) DO UPDATE SET n = contrib.n + excluded.n').bind(device, day, take.length));
    if (Math.random() < 0.02) {
      const old = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
      stmts.push(db.prepare('DELETE FROM contrib WHERE day < ?1').bind(old));
    }
    await db.batch(stmts);
    return reply({ added: take.length }, 200, origin);
  }
  return reply({ error: 'bad_task' }, 400, origin);
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
    if (typeof task === 'string' && task.indexOf('cards_') === 0) {
      try { return await handleCards(env, task, body, allowOrigin); }
      catch (e) { return reply({ error: 'db_error' }, 500, allowOrigin); }
    }
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
