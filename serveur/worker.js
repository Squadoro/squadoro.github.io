/*
 * Squadoro : serveur de l'appli (Cloudflare Worker).
 *
 * - Lecture des captures : reçoit les captures envoyées par le site ou l'appli, ajoute la consigne
 *   correspondante et demande la lecture à Claude (API d'Anthropic). La clé d'API reste ici,
 *   jamais dans l'appli. Les images ne sont pas enregistrées.
 * - Limites : 50 captures le premier jour d'utilisation d'un appareil, puis 20 par jour,
 *   et 1000 captures par jour pour tous les joueurs ensemble.
 * - Base commune des cartes : recherche par nom, note, version, club, nation, ligue, poste ;
 *   confirmations par plusieurs joueurs, signalements, corrections à la majorité.
 * - Transfert d'un club d'un appareil à l'autre avec un code à 6 chiffres (10 minutes, une seule fois).
 *
 * Réglages du Worker (Settings → Variables and Secrets) :
 *   ANTHROPIC_API_KEY  (Secret, obligatoire) : ta clé d'API Anthropic.
 *   MODEL              (Text, facultatif)    : modèle utilisé, "claude-haiku-5-5" par défaut.
 *   FIRST_DAY_LIMIT    (Text, facultatif)    : captures le premier jour d'utilisation d'un appareil, 50 par défaut.
 *   DAILY_LIMIT        (Text, facultatif)    : captures par jour ensuite, 20 par défaut.
 *   GLOBAL_DAILY_LIMIT (Text, facultatif)    : captures par jour pour tous les joueurs ensemble, 1000 par défaut.
 *   SALT               (Secret, facultatif)  : sert à rendre anonymes les identifiants (sinon dérivé de la clé d'API).
 * Liaisons (Bindings) :
 *   DB (D1 database) : limites, base commune des cartes et transferts. Les tables sont créées
 *     et mises à jour automatiquement.
 *   LIMITS (KV namespace, facultatif) : ancien stockage des limites, utilisé seulement si DB manque
 *     ou ne répond pas.
 */

const PROMPTS = {
  "scan": "Tu reçois des captures d'écran ou des photos du club EA SPORTS FC 27 Ultimate Team d'un joueur (cartes de joueurs).\nPour CHAQUE carte de joueur visible, renvoie un objet. Réponds UNIQUEMENT avec un tableau JSON, sans texte autour.\nChamps de chaque objet :\n- \"name\" : nom affiché sur la carte (texte exact).\n- \"fullName\" : prénom et nom du vrai joueur (ex. « Kylian Mbappé »), reconnu grâce à la note, au poste, au club, à la nation et à la version de la carte. C'est important quand plusieurs joueurs ont le même nom sur leur carte (ex. Kylian Mbappé et Ethan Mbappé, tous deux « Mbappé ») : ce sont des joueurs différents. Pour un joueur connu sous un seul nom (ex. « Rodrygo », « Pedri »), répète ce nom. null si tu n'es pas sûr du joueur.\n- \"ovr\" : note générale (entier).\n- \"pos\" : poste principal affiché (ex. \"ST\", \"BU\", \"CM\", \"MC\", \"GK\", \"G\").\n- \"alt\" : postes alternatifs s'ils sont visibles (tableau), sinon [].\n- \"nation\", \"league\", \"club\" : d'après le drapeau, le logo de ligue et l'écusson visibles, ou ta connaissance du vrai joueur si tu es sûr (noms usuels en français, ex. « Angleterre », « Premier League »), sinon null.\n- \"kind\" : \"base\" (carte normale or/argent/bronze), \"totw\" (équipe de la semaine), \"icon\", \"hero\", \"hof\" (Hall of FUT) ou \"special\" (autre promo).\n- \"rare\" : true / false si visible (carte rare = design brillant), sinon null.\n- \"score\" : score d'objet (petit nombre avec un losange) s'il est affiché, sinon null.\n- \"untradeable\" : true si la carte est marquée non échangeable, false si clairement échangeable, sinon null.\n- \"stats\" : [VIT, TIR, PAS, DRI, DEF, PHY] si les six valeurs sont visibles, sinon null.\n- \"playstyles\" : PlayStyles visibles (noms, avec « + » pour un PlayStyle+), sinon [].\n- \"roles\" : rôles FC 27 visibles avec leur niveau (ex. \"Avant-centre++\", \"Faux 9+\"), sinon [].\n- \"wf\" : pied faible (1-5) et \"sm\" : gestes techniques (1-5) si visibles, sinon null. \"height\" : taille en cm si visible, sinon null.\n- \"promo\" : nom de la promo ou de la version écrit sur la carte ou sous elle (ex. « Ultimate Scream », « TOTW », « Showdown »), sinon null.\n- \"loan\" : si la carte porte une petite bulle bleue avec un nombre (joueur en prêt), ce nombre (matchs restants) ; sinon 0.\n- \"qty\" : nombre d'exemplaires si un compteur est affiché, sinon 1.\n- \"confidence\" : \"haute\", \"moyenne\" ou \"basse\".\nN'invente rien : mets null quand une information n'est pas lisible. Ignore les emplacements vides, les badges, les consommables et tout ce qui n'est pas une carte de joueur.\nNe compte pas deux fois la même carte si elle apparaît sur deux images qui se chevauchent.\n",
  "fill": "Voici des footballeurs réels présents dans EA SPORTS FC 27 (saison 2026-2027), avec leur note, leur poste et la version de leur carte. Pour chacun, donne sa nation (sélection sportive), sa ligue et son club dans FC 27, avec les noms usuels en français (ex. « Angleterre », « Premier League », « Liverpool »). Quand une information est indiquée comme connue, garde-la et sers-t'en pour reconnaître le joueur (ex. un club connu donne sa ligue). Le nom inscrit sur la carte peut être un nom court ou un surnom : retrouve le vrai joueur grâce à la note, au poste et aux infos connues. Pour une ICÔNE, mets ligue et club « ICÔNES » ; pour un Héros, mets club « HÉROS » et sa ligue. Donne chaque information dont tu es raisonnablement sûr, même si tu ne connais pas les autres : la nation d'un joueur ne change presque jamais, son club a pu changer au dernier mercato (donne alors le club le plus probable pour 2026-2027). Mets null seulement pour une information que tu ne peux vraiment pas déterminer. Réponds UNIQUEMENT avec un tableau JSON : [{\"i\": numéro, \"nation\": \"...\", \"league\": \"...\", \"club\": \"...\"}].\n\n",
  "sbc": "Tu reçois une capture d'écran d'un DCE (Défi Création d'Équipe / SBC) d'EA SPORTS FC 27 Ultimate Team, en français ou en anglais. Lis ses conditions et réponds UNIQUEMENT par un objet JSON au format :\n{\"name\": \"nom du DCE (ou du défi)\", \"set\": \"nom du set s'il y en a un, sinon \\\"\\\"\", \"type\": \"score\" ou \"classic\", \"target\": score requis (si type score), \"minOvr\": note min des cartes ou 0, \"maxOvr\": note max ou 0, \"repeat\": 1, \"formation\": \"any\" ou une formation parmi 4-3-3, 4-4-2, 4-2-3-1, 3-5-2, 3-4-3, 4-1-2-1-2, 4-5-1, 5-3-2, \"reward\": \"récompense en quelques mots\", \"conds\": [ ... ]}\nConditions (type classic) : {\"t\":\"rating\",\"n\":N} note d'équipe min ; {\"t\":\"chem\",\"n\":N} collectif total min ; {\"t\":\"chemPlayer\",\"n\":N} ; {\"t\":\"quality\",\"op\":\"min|max|exactly\",\"n\":0|1|2} (0 Bronze, 1 Argent, 2 Or) ; {\"t\":\"qcount\",\"q\":0|1|2,\"op\":\"min|max|exactly\",\"n\":N} nombre de joueurs Or/Argent/Bronze ; {\"t\":\"rare\",\"op\":\"min\",\"n\":N} ; {\"t\":\"totw\",\"op\":\"min\",\"n\":N} ; {\"t\":\"special\",\"op\":\"min\",\"n\":N} ; {\"t\":\"from\",\"field\":\"league|nation|club\",\"op\":\"min|max|exactly\",\"n\":N,\"value\":\"Nom1, Nom2\"} ; {\"t\":\"distinct\",\"field\":\"league|nation|club\",\"op\":\"min|max|exactly\",\"n\":N} (nombre de ligues/nations/clubs dans l'équipe) ; {\"t\":\"same\",\"field\":\"league|nation|club\",\"op\":\"min|max\",\"n\":N} (joueurs de la même ligue/nation/club) ; {\"t\":\"ovrMin\",\"n\":N} ; {\"t\":\"ovrMax\",\"n\":N}.\nSi une valeur n'est pas lisible, omets la condition plutôt que de l'inventer."
};

const ALLOWED_ORIGINS = ['https://squadoro.github.io', 'squadoro://app'];
const SEED_URL = 'https://squadoro.github.io/cards-seed/index.json';
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

// Jour local (Bruxelles) pour que les limites se remettent à zéro à minuit, comme dans l'appli.
function dayOf(t) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
}
function today() { return dayOf(Date.now()); }
function daysAgo(n) { return dayOf(Date.now() - n * 864e5); }
function num(v, d) { const n = parseInt(v, 10); return n > 0 ? n : d; }
function int(v) { const n = Math.round(+v); return Number.isFinite(n) ? n : 0; }
function validDevice(d) { return typeof d === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(d); }
function clientIp(request) { return request.headers.get('CF-Connecting-IP') || 'inconnu'; }

// Identifiant anonyme : empreinte d'un appareil ou d'une adresse IP, impossible à retrouver sans le secret.
async function hid(env, s, len) {
  const data = new TextEncoder().encode(String(s) + '|' + (env.SALT || env.ANTHROPIC_API_KEY || 'squadoro'));
  const h = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  let out = '';
  for (let i = 0; i < (len || 10); i++) out += h[i].toString(16).padStart(2, '0');
  return out;
}

/* ---------- Limites ---------- */
// Par appareil : 50 captures le premier jour d'utilisation, puis 20 par jour.
// Garde-fous : 150 captures par jour et par adresse IP, 1000 par jour pour tous les joueurs,
// 40 recherches nation/ligue/club par jour et par appareil.
const CNT_UP = 'INSERT INTO cnt (k, n, day) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET n = cnt.n + excluded.n';
async function quotaD1(env, db, day, dev, ip, task, images) {
  const dh = await hid(env, dev), iph = await hid(env, 'ip:' + ip);
  if (task === 'fill') {
    const k = 'fill:' + day + ':' + dh;
    const used = (await db.prepare('SELECT n FROM cnt WHERE k = ?1').bind(k).first('n')) || 0;
    if (used >= 40) return { ok: false, status: 429, body: { error: 'rate_limited' } };
    await db.prepare(CNT_UP).bind(k, 1, day).run();
    return { ok: true };
  }
  const kd = 'img:' + day + ':' + dh, ki = 'ipimg:' + day + ':' + iph, kg = 'all:' + day;
  const [r1, r2] = await db.batch([
    db.prepare('SELECT first FROM devs WHERE d = ?1').bind(dh),
    db.prepare('SELECT k, n FROM cnt WHERE k IN (?1, ?2, ?3)').bind(kd, ki, kg)
  ]);
  let first = r1.results && r1.results[0] ? r1.results[0].first : null;
  if (!first && env.LIMITS) { try { first = await env.LIMITS.get('first:' + dev); } catch (e) { first = null; } }
  if (!first) first = day;
  const got = {};
  (r2.results || []).forEach((r) => { got[r.k] = r.n; });
  const isFirst = first === day;
  const max = isFirst ? num(env.FIRST_DAY_LIMIT, 50) : num(env.DAILY_LIMIT, 20);
  const used = got[kd] || 0, ipUsed = got[ki] || 0, all = got[kg] || 0;
  if (used + images > max || ipUsed + images > 150) return { ok: false, status: 429, body: { error: 'quota', max, used, first: isFirst } };
  if (all + images > num(env.GLOBAL_DAILY_LIMIT, 1000)) return { ok: false, status: 429, body: { error: 'busy' } };
  const stmts = [
    db.prepare('INSERT INTO devs (d, first, last) VALUES (?1, ?2, ?3) ON CONFLICT(d) DO UPDATE SET last = excluded.last').bind(dh, first, day),
    db.prepare(CNT_UP).bind(kd, images, day), db.prepare(CNT_UP).bind(ki, images, day), db.prepare(CNT_UP).bind(kg, images, day)
  ];
  if (Math.random() < 0.03) {
    stmts.push(db.prepare('DELETE FROM cnt WHERE day < ?1').bind(daysAgo(3)));
    stmts.push(db.prepare('DELETE FROM devs WHERE last < ?1').bind(daysAgo(60)));
  }
  await db.batch(stmts);
  return { ok: true };
}
async function quotaKV(env, day, dev, ip, task, images) {
  const kv = env.LIMITS;
  if (task === 'fill') {
    const key = 'fill:' + day + ':' + dev;
    const used = parseInt((await kv.get(key)) || '0', 10);
    if (used >= 40) return { ok: false, status: 429, body: { error: 'rate_limited' } };
    await kv.put(key, String(used + 1), { expirationTtl: 172800 });
    return { ok: true };
  }
  let first = await kv.get('first:' + dev);
  if (!first) { first = day; await kv.put('first:' + dev, day); }
  const isFirst = first === day;
  const max = isFirst ? num(env.FIRST_DAY_LIMIT, 50) : num(env.DAILY_LIMIT, 20);
  const key = 'img:' + day + ':' + dev, ipKey = 'ipimg:' + day + ':' + ip, allKey = 'all:' + day;
  const used = parseInt((await kv.get(key)) || '0', 10);
  const ipUsed = parseInt((await kv.get(ipKey)) || '0', 10);
  const all = parseInt((await kv.get(allKey)) || '0', 10);
  if (used + images > max || ipUsed + images > 150) return { ok: false, status: 429, body: { error: 'quota', max, used, first: isFirst } };
  if (all + images > num(env.GLOBAL_DAILY_LIMIT, 1000)) return { ok: false, status: 429, body: { error: 'busy' } };
  await kv.put(key, String(used + images), { expirationTtl: 172800 });
  await kv.put(ipKey, String(ipUsed + images), { expirationTtl: 172800 });
  await kv.put(allKey, String(all + images), { expirationTtl: 172800 });
  return { ok: true };
}
async function checkQuota(env, request, device, task, images) {
  const ip = clientIp(request), day = today();
  const dev = validDevice(device) ? device : 'ip-' + ip;
  if (env.DB) {
    try { await ensureSchema(env.DB); return await quotaD1(env, env.DB, day, dev, ip, task, images); } catch (e) { /* on essaie le KV */ }
  }
  if (env.LIMITS) {
    try { return await quotaKV(env, day, dev, ip, task, images); } catch (e) { /* stockage indisponible */ }
  }
  // Sans aucun stockage relié, on laisse passer (la limite de dépense Anthropic reste le garde-fou).
  // Si un stockage est relié mais ne répond pas, on refuse les captures pour ne jamais dépasser la limite globale.
  if (!env.DB && !env.LIMITS) return { ok: true };
  return task === 'fill' ? { ok: true } : { ok: false, status: 503, body: { error: 'busy' } };
}

/* ---------- Base commune des cartes (D1) ---------- */
const KINDS = ['base', 'totw', 'special', 'hero', 'hof', 'icon'];
const POSITIONS = ['GK', 'LB', 'CB', 'RB', 'CDM', 'CM', 'CAM', 'LM', 'RM', 'LW', 'RW', 'ST'];
const SCHEMA = 4;
const MAX_VOTERS = 20;   // au-delà, la carte est largement confirmée : on ne compte plus de nouveaux votes
const MAX_VARIANTS = 6;  // versions différentes gardées par champ
const VF = ['name', 'pos', 'alt', 'nation', 'league', 'club', 'stats', 'extra'];
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS cards (k TEXT PRIMARY KEY, name TEXT NOT NULL, n1 TEXT NOT NULL, n2 TEXT NOT NULL, n3 TEXT NOT NULL, ovr INTEGER NOT NULL, kind TEXT NOT NULL, rare INTEGER NOT NULL DEFAULT 0, pos TEXT NOT NULL, alt TEXT, nation TEXT, league TEXT, club TEXT, stats TEXT, extra TEXT, seen INTEGER NOT NULL DEFAULT 1, updated TEXT)'),
    db.prepare('CREATE INDEX IF NOT EXISTS cards_n1 ON cards(n1)'),
    db.prepare('CREATE INDEX IF NOT EXISTS cards_n2 ON cards(n2)'),
    db.prepare('CREATE INDEX IF NOT EXISTS cards_n3 ON cards(n3)'),
    db.prepare('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT) WITHOUT ROWID')
  ]);
  const ver = +((await db.prepare("SELECT v FROM meta WHERE k = 'schema'").first('v')) || 0);
  if (ver < SCHEMA) await migrate(db, ver);
  schemaReady = true;
}
async function migrate(db, ver) {
  if (ver < 2) await migrate2(db);
  if (ver < 3) await mergeDuplicates(db);
  if (ver < 4) await migrate4(db);
  await db.prepare("INSERT INTO meta (k, v) VALUES ('schema', ?1) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(String(SCHEMA)).run();
}
async function migrate2(db) {
  const cols = ['conf INTEGER NOT NULL DEFAULT 1', 'rep INTEGER NOT NULL DEFAULT 0', 'votes TEXT', 'cn TEXT', 'nn TEXT', 'ln TEXT', 'src INTEGER NOT NULL DEFAULT 0'];
  for (const c of cols) { try { await db.prepare('ALTER TABLE cards ADD COLUMN ' + c).run(); } catch (e) { /* déjà là */ } }
  await db.batch([
    db.prepare('CREATE INDEX IF NOT EXISTS cards_cn ON cards(cn, ovr)'),
    db.prepare('CREATE INDEX IF NOT EXISTS cards_nn ON cards(nn, ovr)'),
    db.prepare('CREATE INDEX IF NOT EXISTS cards_ln ON cards(ln, ovr)'),
    db.prepare('CREATE INDEX IF NOT EXISTS cards_pos ON cards(pos, ovr)'),
    db.prepare('CREATE TABLE IF NOT EXISTS cnt (k TEXT PRIMARY KEY, n INTEGER NOT NULL, day TEXT NOT NULL) WITHOUT ROWID'),
    db.prepare('CREATE TABLE IF NOT EXISTS devs (d TEXT PRIMARY KEY, first TEXT NOT NULL, last TEXT NOT NULL) WITHOUT ROWID'),
    db.prepare('CREATE TABLE IF NOT EXISTS xfer (code TEXT PRIMARY KEY, data TEXT NOT NULL, exp INTEGER NOT NULL) WITHOUT ROWID'),
    db.prepare('DROP TABLE IF EXISTS contrib')
  ]);
  const old = await db.prepare('SELECT k, nation, league, club FROM cards WHERE cn IS NULL AND nn IS NULL AND ln IS NULL LIMIT 5000').all();
  const rows = (old.results || []).map((r) => ({ k: r.k, cn: norm(r.club) || null, nn: norm(r.nation) || null, ln: norm(r.league) || null }));
  if (rows.length) {
    await db.prepare("UPDATE cards SET cn = json_extract(j.value, '$.cn'), nn = json_extract(j.value, '$.nn'), ln = json_extract(j.value, '$.ln') FROM json_each(?1) AS j WHERE cards.k = json_extract(j.value, '$.k')")
      .bind(JSON.stringify(rows)).run();
  }
}
// Schéma 4 : profils d'amis (pseudo, code ami, résumé de progression) et amitiés (deux lignes par amitié)
async function migrate4(db) {
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS prof (id INTEGER PRIMARY KEY, th TEXT NOT NULL UNIQUE, code TEXT NOT NULL UNIQUE, name TEXT NOT NULL, snap TEXT, upd INTEGER NOT NULL, made INTEGER NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS fr (a INTEGER NOT NULL, b INTEGER NOT NULL, since INTEGER NOT NULL, PRIMARY KEY (a, b)) WITHOUT ROWID'),
    db.prepare('CREATE INDEX IF NOT EXISTS fr_b ON fr(b)')
  ]);
}
function norm(s) {
  return String(s || '').replace(/[øØ]/g, 'o').replace(/[łŁ]/g, 'l').replace(/[æÆ]/g, 'ae').replace(/ß/g, 'ss').replace(/[đĐ]/g, 'd').replace(/ı/g, 'i')
    .normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 .'-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
}
function text(v, max) { v = typeof v === 'string' ? v.trim() : ''; return v && v !== '—' ? v.slice(0, max || 40) : ''; }
function validNat(c) { return typeof c === 'string' && /^[a-z]{2}(-[a-z]{3})?$/.test(c); }
function natKey(nation, iso) { return validNat(iso) ? iso : (norm(nation) || null); }
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
  const promo = text(c.promo, 30); if (promo) extra.promo = promo;
  const words = n1.split(' '), nation = text(c.nation);
  return { k: n1 + '|' + ovr + '|' + kind, name, n1, n2: words.length > 1 ? words.slice(1).join(' ') : n1, n3: words[words.length - 1], ovr, kind, rare: c.rare ? 1 : 0, pos, alt: alt.join(','),
    nation, nn: nation ? natKey(nation, String(c.iso || '').toLowerCase()) : null, league: text(c.league), club: text(c.club), stats: stats ? JSON.stringify(stats) : null,
    extra: (extra.playstyles.length || extra.roles.length || extra.wf || extra.sm || extra.height || extra.promo) ? JSON.stringify(extra) : null };
}
function dedupe(cards) { const seen = {}; return cards.filter((c) => (seen[c.k] ? false : (seen[c.k] = 1))); }

// Votes : chaque appareil (ou la source « seed » de Squadoro, qui compte triple) donne sa version de chaque champ.
// La version la plus envoyée l'emporte. Les jetons de vote sont propres à chaque carte : ils ne relient pas les cartes entre elles.
function fnv(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
function weightOf(tok) { return tok === 'seed' ? 3 : 1; }
function voteVals(c) {
  return { name: c.name, pos: c.pos, alt: c.alt || '', nation: c.nation ? c.nation + '|' + (c.nn || '') : '', league: c.league || '', club: c.club || '', stats: c.stats || '', extra: c.extra || '' };
}
function rowVals(r) {
  return { name: r.name, pos: r.pos, alt: r.alt || '', nation: r.nation ? r.nation + '|' + (r.nn || norm(r.nation)) : '', league: r.league || '', club: r.club || '', stats: r.stats || '', extra: r.extra || '' };
}
function parseVotes(r) {
  let V = null;
  try { V = r && r.votes ? JSON.parse(r.votes) : null; } catch (e) { V = null; }
  if (V && V.c && V.v) { if (!Array.isArray(V.r)) V.r = []; return V; }
  V = { c: {}, v: {}, r: [] };
  if (r) { // carte d'avant les votes : sa version compte pour une voix
    const vals = rowVals(r), mine = V.v._old = {};
    VF.forEach((f) => { if (vals[f]) { const id = fnv(vals[f]); V.c[f] = { [id]: [1, vals[f]] }; mine[f] = id; } });
  }
  return V;
}
function applyVote(V, tok, vals) {
  const w = weightOf(tok);
  let mine = V.v[tok], fresh = false;
  if (!mine) { if (Object.keys(V.v).length >= MAX_VOTERS) return false; mine = V.v[tok] = {}; fresh = true; }
  let changed = fresh;
  for (const f of VF) {
    const val = vals[f]; if (!val) continue;
    const id = fnv(val);
    if (mine[f] === id) continue;
    const cf = V.c[f] || (V.c[f] = {});
    if (mine[f] && cf[mine[f]]) { cf[mine[f]][0] -= w; if (cf[mine[f]][0] <= 0) delete cf[mine[f]]; }
    if (cf[id]) cf[id][0] += w;
    else {
      cf[id] = [w, val];
      const ids = Object.keys(cf).filter((x) => x !== id);
      if (ids.length >= MAX_VARIANTS) { ids.sort((a, b) => cf[a][0] - cf[b][0]); delete cf[ids[0]]; }
    }
    mine[f] = id; changed = true;
  }
  return changed;
}
function pick(cf, cur) {
  let best = null, bn = -1;
  for (const id in cf) { const n = cf[id][0]; if (n > bn || (n === bn && cf[id][1] === cur)) { best = cf[id][1]; bn = n; } }
  return best;
}
function confOf(V) { let n = 0; for (const t in V.v) n += weightOf(t); return n; }
// Valeurs finales d'une carte à partir de ses votes
function finalize(base, V, row) {
  const cur = row ? rowVals(row) : {}, fin = {};
  VF.forEach((f) => { const p = V.c[f] ? pick(V.c[f], cur[f]) : null; fin[f] = p || cur[f] || ''; });
  const bar = fin.nation.lastIndexOf('|'), nation = bar >= 0 ? fin.nation.slice(0, bar) : fin.nation, nn = bar >= 0 ? fin.nation.slice(bar + 1) : '';
  return { k: base.k, name: fin.name || base.name, n1: base.n1, n2: base.n2, n3: base.n3, ovr: base.ovr, kind: base.kind, rare: Math.max(row ? row.rare : 0, base.rare || 0), pos: fin.pos || base.pos, alt: fin.alt,
    nation, nn: nation ? (nn || norm(nation)) : null, league: fin.league, ln: norm(fin.league) || null, club: fin.club, cn: norm(fin.club) || null, stats: fin.stats || null, extra: fin.extra || null,
    conf: confOf(V), rep: V.r.length, votes: JSON.stringify(V), src: (row && row.src) || base.src || 0 };
}
// Même joueur écrit autrement : « Mbappé », « K. Mbappé » et « Kylian Mbappé » (même note, même version, même poste, même nation).
function nameWords(n1) { return String(n1 || '').replace(/\./g, ' ').split(' ').filter(Boolean); }
function compatNames(a, b) {
  if (a === b) return true;
  const A = nameWords(a), B = nameWords(b);
  if (!A.length || !B.length) return false;
  const S = A.length <= B.length ? A : B, L = A.length <= B.length ? B : A;
  if (S.length === 1 && L.length > 1 && L[0] === S[0] && S[0].length >= 3) return true; // nom d'usage = prénom (« Rodrygo » / « Rodrygo Goes »)
  if (A[A.length - 1] !== B[B.length - 1]) return false;
  let j = 0;
  for (let i = 0; i < S.length - 1; i++) {
    const w = S[i]; let found = false;
    while (j < L.length - 1) { const v = L[j++]; if (v === w || (w.length === 1 && v[0] === w) || (v.length === 1 && w[0] === v)) { found = true; break; } }
    if (!found) return false;
  }
  return true;
}
function altList(x) { return Array.isArray(x.alt) ? x.alt : String(x.alt || '').split(',').filter(Boolean); }
function sameCard(r, c) {
  if (r.ovr !== c.ovr || r.kind !== c.kind || !compatNames(r.n1, c.n1)) return false;
  const posOk = r.pos === c.pos || altList(r).includes(c.pos) || altList(c).includes(r.pos);
  const nnOk = !r.nn || !c.nn || r.nn === c.nn;
  return posOk && nnOk;
}
function fuller(a, b) { const x = nameWords(a.n1).length, y = nameWords(b.n1).length; return x !== y ? x > y : a.n1.length > b.n1.length; }
// Fiches qui peuvent désigner le même joueur : même dernier mot, ou nom d'usage = premier mot
async function candidates(db, names, cols) {
  const lw = new Set(), fw = new Set(), single = new Set();
  names.forEach((n1) => { const w = n1.split(' '); lw.add(w[w.length - 1]); if (w.length === 1) single.add(n1); else fw.add(w[0]); });
  const stmts = [db.prepare('SELECT ' + cols + ' FROM cards WHERE n3 IN (SELECT value FROM json_each(?1)) OR n1 IN (SELECT value FROM json_each(?2))').bind(JSON.stringify([...lw]), JSON.stringify([...fw]))];
  [...single].slice(0, 60).forEach((n) => stmts.push(db.prepare('SELECT ' + cols + ' FROM cards WHERE n1 > ?1 AND n1 < ?2').bind(n + ' ', n + ' ~')));
  const res = await db.batch(stmts), seen = {}, out = [];
  res.forEach((r) => (r.results || []).forEach((row) => { if (!seen[row.k]) { seen[row.k] = 1; out.push(row); } }));
  return out;
}
// Parmi plusieurs fiches possibles : si elles désignent toutes le même joueur, on garde la plus complète ; sinon on ne devine pas
function resolve(cands) {
  if (!cands.length) return null;
  const sorted = cands.slice().sort((a, b) => (fuller(a, b) ? -1 : fuller(b, a) ? 1 : 0)), top = sorted[0];
  return sorted.every((r) => r === top || sameCard(top, r)) ? top : null;
}
// Fusionne les votes d'une fiche en double dans la fiche gardée
function absorb(V, W) {
  for (const f in W.c) {
    const cf = V.c[f] || (V.c[f] = {});
    for (const id in W.c[f]) { if (cf[id]) cf[id][0] += W.c[f][id][0]; else cf[id] = W.c[f][id].slice(); }
    const ids = Object.keys(cf); if (ids.length > MAX_VARIANTS) { ids.sort((a, b) => cf[b][0] - cf[a][0]); ids.slice(MAX_VARIANTS).forEach((id) => { delete cf[id]; }); }
  }
  for (const t in W.v) if (!V.v[t] && Object.keys(V.v).length < MAX_VOTERS) V.v[t] = W.v[t];
  W.r.forEach((t) => { if (V.r.indexOf(t) < 0 && V.r.length < 30) V.r.push(t); });
  return V;
}
const W_COLS = ['k', 'name', 'n1', 'n2', 'n3', 'ovr', 'kind', 'rare', 'pos', 'alt', 'nation', 'league', 'club', 'stats', 'extra', 'conf', 'rep', 'votes', 'cn', 'nn', 'ln', 'src'];
function upsertSql(withIndexed) {
  const set = ['name', 'rare', 'alt', 'nation', 'league', 'club', 'stats', 'extra', 'conf', 'rep', 'votes', 'src'].concat(withIndexed ? ['pos', 'cn', 'nn', 'ln'] : []);
  return 'INSERT INTO cards (' + W_COLS.join(', ') + ', seen, updated) SELECT ' + W_COLS.map((c) => "json_extract(value, '$." + c + "')").join(', ') + ', 1, ?2 FROM json_each(?1) WHERE true ' +
    'ON CONFLICT(k) DO UPDATE SET ' + set.map((c) => c + ' = excluded.' + c).join(', ') + ', seen = cards.seen + 1, updated = excluded.updated';
}
const DEL_SQL = 'DELETE FROM cards WHERE k IN (SELECT value FROM json_each(?1))';
const ROW_COST = { new: 9, idx: 9, rekey: 18, plain: 2, none: 0 }; // lignes écrites estimées (table + index)
async function writeCards(db, cards, tokFor) {
  if (!cards.length) return { changed: 0, cost: 0 };
  const ex = await db.prepare('SELECT * FROM cards WHERE k IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(cards.map((c) => c.k))).all();
  const byK = {}; (ex.results || []).forEach((r) => { byK[r.k] = r; });
  const items = cards.map((c) => ({ c, row: byK[c.k] || null }));
  // Pas de doublon : une carte inconnue sous ce nom exact est rattachée à la fiche existante du même joueur
  const missing = items.filter((it) => !it.row);
  if (missing.length) {
    const cand = await candidates(db, missing.map((it) => it.c.n1), '*');
    missing.forEach((it) => { it.row = resolve(cand.filter((r) => sameCard(r, it.c))); });
  }
  // Regroupe les envois qui visent la même carte (y compris « Mbappé » et « Kylian Mbappé » dans le même envoi)
  const groups = [];
  for (const it of items) {
    let g = null;
    if (it.row) g = groups.find((x) => x.row && x.row.k === it.row.k);
    else { const m = groups.filter((x) => !x.row && x.items.some((c) => sameCard(c, it.c))); if (m.length === 1) g = m[0]; }
    if (!g && it.row) g = groups.find((x) => !x.row && x.items.some((c) => sameCard(c, it.row)));
    if (!g) { g = { row: it.row, items: [] }; groups.push(g); }
    g.items.push(it.c);
  }
  const full = [], plain = [], del = []; let cost = 0;
  for (const g of groups) {
    let base = g.row ? { k: g.row.k, n1: g.row.n1, n2: g.row.n2, n3: g.row.n3 } : null;
    g.items.forEach((c) => { if (!base || fuller(c, base)) base = { k: c.k, n1: c.n1, n2: c.n2, n3: c.n3 }; }); // la fiche garde le nom le plus complet
    const tok = await tokFor({ k: base.k });
    const V = parseVotes(g.row);
    g.items.forEach((c) => applyVote(V, tok, voteVals(c)));
    const first = g.items[0];
    const out = finalize(Object.assign({}, first, base, { rare: Math.max.apply(null, g.items.map((c) => c.rare || 0)), src: tok === 'seed' ? 1 : 0 }), V, g.row);
    let mode;
    if (!g.row) mode = 'new';
    else if (g.row.k !== out.k) { mode = 'rekey'; del.push(g.row.k); }
    else if (out.pos !== g.row.pos || out.cn !== (g.row.cn || null) || out.nn !== (g.row.nn || null) || out.ln !== (g.row.ln || null)) mode = 'idx';
    else mode = out.votes === g.row.votes && out.rare === g.row.rare && out.src === (g.row.src || 0) ? 'none' : 'plain';
    cost += ROW_COST[mode];
    if (mode === 'plain') plain.push(out); else if (mode !== 'none') full.push(out);
  }
  const now = new Date().toISOString(), stmts = [];
  if (del.length) stmts.push(db.prepare(DEL_SQL).bind(JSON.stringify(del)));
  if (full.length) stmts.push(db.prepare(upsertSql(true)).bind(JSON.stringify(full), now));
  if (plain.length) stmts.push(db.prepare(upsertSql(false)).bind(JSON.stringify(plain), now));
  return { stmts, changed: full.length + plain.length, cost };
}
// Nettoyage unique des doublons déjà présents (passage au schéma 3)
async function mergeDuplicates(db) {
  const res = await db.prepare('SELECT * FROM cards LIMIT 20000').all();
  const groups = {};
  (res.results || []).forEach((r) => {
    const add = (g) => { (groups[g] = groups[g] || []).push(r); };
    add(r.ovr + '|' + r.kind + '|l:' + r.n3); add(r.ovr + '|' + r.kind + '|f:' + r.n1.split(' ')[0]);
  });
  const keep = [], del = [], gone = {}, kept = {};
  for (const g in groups) {
    const rows = groups[g].filter((r) => !gone[r.k]); if (rows.length < 2) continue;
    rows.sort((a, b) => (fuller(a, b) ? -1 : fuller(b, a) ? 1 : 0));
    // fiches les plus complètes d'abord : chacune rejoint l'unique fiche plus complète du même joueur, sinon elle reste seule
    const anchors = [];
    for (const r of rows) {
      const m = anchors.filter((a) => sameCard(a.row, r));
      if (m.length === 1) { m[0].V = absorb(m[0].V, r._V || parseVotes(r)); m[0].n++; del.push(r.k); gone[r.k] = 1; }
      else if (!m.length) anchors.push({ row: r, V: r._V || parseVotes(r), n: 0 });
    }
    anchors.filter((a) => a.n).forEach((a) => { a.row._V = a.V; kept[a.row.k] = a.row; });
  }
  if (!del.length) return 0;
  Object.values(kept).forEach((r) => { if (!gone[r.k]) keep.push(finalize(r, r._V, r)); });
  const now = new Date().toISOString();
  await db.batch([db.prepare(DEL_SQL).bind(JSON.stringify(del)), db.prepare(upsertSql(true)).bind(JSON.stringify(keep), now)]);
  return del.length;
}
const OUT_COLS = 'k, name, ovr, kind, rare, pos, alt, nation, league, club, stats, extra, conf, src';
const VISIBLE = 'NOT (rep >= 3 AND rep >= conf)'; // carte signalée par plus de joueurs qu'elle n'a de confirmations : cachée
function outCard(r) {
  let extra = {}; try { extra = r.extra ? JSON.parse(r.extra) : {}; } catch (e) { extra = {}; }
  let stats = null; try { stats = r.stats ? JSON.parse(r.stats) : null; } catch (e) { stats = null; }
  return { k: r.k, name: r.name, ovr: r.ovr, kind: r.kind, rare: !!r.rare, pos: r.pos, alt: r.alt ? r.alt.split(',').filter(Boolean) : [], nation: r.nation || '', league: r.league || '', club: r.club || '',
    stats, playstyles: extra.playstyles || [], roles: extra.roles || [], wf: extra.wf || 0, sm: extra.sm || 0, height: extra.height || 0, promo: extra.promo || '', conf: r.conf || 1, seed: !!r.src };
}
function confTier(r) { return r.conf >= 3 ? 2 : r.conf === 2 ? 1 : 0; }
function filterSql(f, args) {
  const w = [VISIBLE];
  const p = (v) => { args.push(v); return '?' + args.length; };
  if (f.ovr >= 40 && f.ovr <= 99) w.push('ovr = ' + p(f.ovr));
  else {
    if (f.omin >= 40 && f.omin <= 99) w.push('ovr >= ' + p(f.omin));
    if (f.omax >= 40 && f.omax <= 99) w.push('ovr <= ' + p(f.omax));
  }
  if (f.tier === 'gold') w.push('ovr >= 75'); else if (f.tier === 'silver') w.push('ovr >= 65 AND ovr <= 74'); else if (f.tier === 'bronze') w.push('ovr <= 64');
  if (f.kind) w.push('kind = ' + p(f.kind));
  if (f.rare === 0 || f.rare === 1) w.push('rare = ' + p(f.rare));
  if (f.pos) w.push("(pos = " + p(f.pos) + " OR instr(',' || IFNULL(alt, '') || ',', ',' || ?" + args.length + " || ',') > 0)");
  if (f.nat) w.push('nn = ' + p(f.nat));
  return w;
}
async function searchCards(db, body) {
  const q = norm(body.q), toks = q ? q.split(' ') : [];
  const f = { ovr: int(body.ovr), omin: int(body.omin), omax: int(body.omax), kind: KINDS.includes(body.kind) ? body.kind : '', rare: body.rare === 1 || body.rare === 0 ? body.rare : null,
    tier: ['gold', 'silver', 'bronze'].includes(body.tier) ? body.tier : '', pos: POSITIONS.includes(body.pos) ? body.pos : '', nat: validNat(body.nat) ? body.nat : '' };
  const qs = [];
  const add = (where, params, order) => {
    const args = params.slice(), w = [where].concat(filterSql(f, args));
    qs.push(db.prepare('SELECT ' + OUT_COLS + ' FROM cards WHERE ' + w.join(' AND ') + ' ORDER BY ' + order + ' LIMIT 20').bind(...args));
  };
  const NAME = '((n1 >= ?1 AND n1 < ?2) OR (n2 >= ?1 AND n2 < ?2) OR (n3 >= ?1 AND n3 < ?2))';
  if (q.length >= 2) {
    add(NAME, [q, q + '~'], 'conf DESC, ovr DESC');
    if (toks.length > 1 && toks[0].length >= 2) { // ex. « mbappe real » : nom + autre mot (club, ligue, nation)
      const args = [toks[0], toks[0] + '~']; let w = NAME;
      toks.slice(1, 4).forEach((t) => { args.push(t); w += " AND instr(n1 || ' ' || IFNULL(cn, '') || ' ' || IFNULL(ln, '') || ' ' || IFNULL(nn, ''), ?" + args.length + ') > 0'; });
      add(w, args, 'conf DESC, ovr DESC');
    }
    add('cn >= ?1 AND cn < ?2', [q, q + '~'], 'ovr DESC');
    add('ln >= ?1 AND ln < ?2', [q, q + '~'], 'ovr DESC');
    add('nn >= ?1 AND nn < ?2', [q, q + '~'], 'ovr DESC');
  } else if (f.nat) add('nn = ?1', [f.nat], 'ovr DESC');
  else if (f.pos) add('pos = ?1', [f.pos], 'ovr DESC');
  else return [];
  const res = await db.batch(qs), seen = {}, all = [];
  res.forEach((r) => (r.results || []).forEach((row) => { if (!seen[row.k]) { seen[row.k] = 1; all.push(row); } }));
  all.sort((a, b) => confTier(b) - confTier(a) || b.ovr - a.ovr || (b.conf || 0) - (a.conf || 0));
  return all.slice(0, 15).map(outCard);
}
async function counters(db, keys) {
  const r = await db.prepare('SELECT k, n FROM cnt WHERE k IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(keys)).all();
  const got = {}; (r.results || []).forEach((x) => { got[x.k] = x.n; });
  return got;
}
const ROWS_DAY_MAX = 70000; // garde de la place dans les 100 000 lignes écrites par jour de l'offre gratuite de D1

/* ---------- Cartes de départ publiées chaque soir par Squadoro (cards-seed) ---------- */
// Une partie (150 cartes au plus) est importée à la fois, en arrière-plan d'une requête, pour rester léger.
let seedLast = 0;
function seedStep(env, ctx) {
  if (!ctx || !ctx.waitUntil || Date.now() - seedLast < 20000) return;
  seedLast = Date.now();
  ctx.waitUntil(importSeedPart(env).catch(() => {}));
}
async function importSeedPart(env) {
  const db = env.DB, day = today();
  let st = {};
  try { st = JSON.parse((await db.prepare("SELECT v FROM meta WHERE k = 'seed'").first('v')) || '{}') || {}; } catch (e) { st = {}; }
  if (st.done && st.day === day) return;
  const save = (s) => db.prepare("INSERT INTO meta (k, v) VALUES ('seed', ?1) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(JSON.stringify(s)).run();
  const res = await fetch(SEED_URL + '?d=' + day, { headers: { Accept: 'application/json' } });
  if (!res.ok) { await save(Object.assign({}, st, { done: true, day })); return; }
  const index = await res.json(), parts = Array.isArray(index.parts) ? index.parts.slice(0, 40) : [];
  const ver = String(index.updatedAt || '');
  if (st.ver !== ver) st = { ver, next: 0 };
  if (st.next >= parts.length) { await save(Object.assign(st, { done: true, day })); return; }
  const part = parts[st.next];
  await save(Object.assign({}, st, { next: st.next + 1, done: false }));
  if (typeof part !== 'string' || !/^[a-z0-9/_-]+\.json$/i.test(part)) return;
  const pr = await fetch(new URL(part, SEED_URL).toString() + '?v=' + encodeURIComponent(ver), { headers: { Accept: 'application/json' } });
  if (!pr.ok) return;
  const data = await pr.json();
  const cards = dedupe((Array.isArray(data.cards) ? data.cards : []).slice(0, 150).map(cleanCard).filter(Boolean));
  const w = await writeCards(db, cards, async () => 'seed');
  const stmts = (w.stmts || []).concat([db.prepare(CNT_UP).bind('addrows:' + day, w.cost, day)]);
  await db.batch(stmts);
}

/* ---------- Requêtes de la base (cartes, transferts) ---------- */
async function handleData(env, ctx, request, task, body, origin) {
  const db = env.DB;
  if (!db) return reply({ error: 'no_db' }, 503, origin);
  await ensureSchema(db);
  const day = today();
  if (task.indexOf('cards_') === 0) seedStep(env, ctx);

  if (task === 'cards_search') return reply({ cards: await searchCards(db, body) }, 200, origin);

  if (task === 'cards_lookup') {
    const items = (Array.isArray(body.items) ? body.items : []).slice(0, 80).map((it) => { const n1 = norm(it && it.name), w = n1.split(' '); return { n1, n3: w[w.length - 1] || '', ovr: int(it && it.ovr) }; });
    const names = [...new Set(items.map((it) => it.n1).filter((n) => n.length >= 2))];
    if (!names.length) return reply({ found: items.map(() => null) }, 200, origin);
    // joueurs qui peuvent correspondre, puis tri : nom exact d'abord, sinon même joueur écrit autrement
    const rows = (await candidates(db, names, OUT_COLS + ', n1, n3, rep')).filter((r) => !(r.rep >= 3 && r.rep >= r.conf));
    const found = items.map((it) => {
      let list = rows.filter((r) => (it.ovr >= 40 && it.ovr <= 99 ? r.ovr === it.ovr : true));
      const exact = list.filter((r) => r.n1 === it.n1);
      if (exact.length) list = exact;
      else {
        list = list.filter((r) => compatNames(r.n1, it.n1));
        const players = new Set(list.map((r) => r.n1)); if (players.size !== 1) return null; // plusieurs joueurs possibles : on ne devine pas
      }
      if (!list.length) return null;
      list.sort((a, b) => (b.conf || 0) - (a.conf || 0) || (a.kind === 'base' ? -1 : 0) - (b.kind === 'base' ? -1 : 0));
      return outCard(list[0]);
    });
    return reply({ found }, 200, origin);
  }

  const device = validDevice(body.device) ? body.device : null;
  if (!device) return reply({ error: 'bad_request' }, 400, origin);
  const dh = await hid(env, device), iph = await hid(env, 'ip:' + clientIp(request));

  if (task === 'cards_add') {
    const cards = dedupe((Array.isArray(body.cards) ? body.cards : []).slice(0, 200).map(cleanCard).filter(Boolean));
    if (!cards.length) return reply({ added: 0 }, 200, origin);
    const kd = 'add:' + day + ':' + dh, ki = 'addip:' + day + ':' + iph, kg = 'addrows:' + day;
    const got = await counters(db, [kd, ki, kg]);
    if ((got[kg] || 0) > ROWS_DAY_MAX) return reply({ error: 'busy' }, 429, origin);
    const room = Math.max(0, Math.min(600 - (got[kd] || 0), 3000 - (got[ki] || 0)));
    const take = cards.slice(0, room);
    if (!take.length) return reply({ error: 'rate_limited' }, 429, origin);
    const w = await writeCards(db, take, (c) => hid(env, device + '|' + c.k, 5));
    const stmts = (w.stmts || []).concat([db.prepare(CNT_UP).bind(kd, take.length, day), db.prepare(CNT_UP).bind(ki, take.length, day), db.prepare(CNT_UP).bind(kg, w.cost, day)]);
    await db.batch(stmts);
    return reply({ added: take.length, changed: w.changed }, 200, origin);
  }

  if (task === 'cards_report') {
    const k = typeof body.k === 'string' ? body.k.slice(0, 120) : '';
    if (!k) return reply({ error: 'bad_request' }, 400, origin);
    const kr = 'rep:' + day + ':' + dh;
    const got = await counters(db, [kr]);
    if ((got[kr] || 0) >= 50) return reply({ error: 'rate_limited' }, 429, origin);
    const row = await db.prepare('SELECT k, votes, rep, name, pos, alt, nation, nn, league, club, stats, extra, conf, seen FROM cards WHERE k = ?1').bind(k).first();
    if (!row) return reply({ ok: true }, 200, origin);
    const V = parseVotes(row), tok = await hid(env, device + '|' + k, 5);
    if (V.r.indexOf(tok) < 0 && V.r.length < 30) V.r.push(tok);
    await db.batch([
      db.prepare('UPDATE cards SET rep = ?2, votes = ?3 WHERE k = ?1').bind(k, V.r.length, JSON.stringify(V)),
      db.prepare(CNT_UP).bind(kr, 1, day)
    ]);
    return reply({ ok: true, hidden: V.r.length >= 3 && V.r.length >= (row.conf || 1) }, 200, origin);
  }

  if (task === 'xfer_put') {
    const data = typeof body.data === 'string' ? body.data : '';
    if (!data || data.length > 1800000) return reply({ error: data ? 'too_big' : 'bad_request' }, 400, origin);
    const kp = 'xput:' + day + ':' + dh, kg = 'xputall:' + day;
    const got = await counters(db, [kp, kg]);
    if ((got[kp] || 0) >= 10 || (got[kg] || 0) >= 3000) return reply({ error: 'rate_limited' }, 429, origin);
    const now = Date.now(), exp = now + 10 * 60 * 1000;
    await db.prepare('DELETE FROM xfer WHERE exp < ?1').bind(now).run();
    for (let i = 0; i < 6; i++) {
      const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0');
      const r = await db.prepare('INSERT INTO xfer (code, data, exp) VALUES (?1, ?2, ?3) ON CONFLICT(code) DO NOTHING').bind(code, data, exp).run();
      if (r && r.meta && r.meta.changes === 0) continue;
      await db.batch([db.prepare(CNT_UP).bind(kp, 1, day), db.prepare(CNT_UP).bind(kg, 1, day)]);
      return reply({ code, exp }, 200, origin);
    }
    return reply({ error: 'busy' }, 503, origin);
  }

  if (task === 'xfer_get') {
    const code = String(body.code || '').replace(/\D/g, '');
    if (code.length !== 6) return reply({ error: 'bad_code' }, 400, origin);
    const kg = 'xget:' + day + ':' + iph;
    const got = await counters(db, [kg]);
    if ((got[kg] || 0) >= 30) return reply({ error: 'rate_limited' }, 429, origin);
    await db.prepare(CNT_UP).bind(kg, 1, day).run();
    const row = await db.prepare('SELECT data, exp FROM xfer WHERE code = ?1').bind(code).first();
    if (!row || row.exp < Date.now()) return reply({ error: 'not_found' }, 404, origin);
    await db.prepare('DELETE FROM xfer WHERE code = ?1').bind(code).run();
    return reply({ data: row.data }, 200, origin);
  }

  if (task.indexOf('social_') === 0) return handleSocial(env, db, day, dh, iph, task, body, origin);

  return reply({ error: 'bad_task' }, 400, origin);
}

/* ---------- Amis : profil (pseudo + code ami), progression partagée avec les amis seulement ---------- */
const CODE_ABC = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // sans 0/O, 1/I/L
const MAX_FRIENDS = 100;
const SNAP_MAX = 6000;
function newCode() {
  const r = crypto.getRandomValues(new Uint8Array(8));
  let c = ''; for (let i = 0; i < 8; i++) c += CODE_ABC[r[i] % CODE_ABC.length];
  return c;
}
function validTok(t) { return typeof t === 'string' && /^[A-Za-z0-9_-]{24,64}$/.test(t); }
function cleanCode(c) { c = String(c || '').toUpperCase().replace(/[^0-9A-Z]/g, ''); return /^[2-9A-HJKMNP-Z]{8}$/.test(c) ? c : ''; }
function cleanName(n) {
  n = String(n || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 20);
  return n.length >= 2 ? n : '';
}
function outFriend(r) { let snap = null; try { snap = r.snap ? JSON.parse(r.snap) : null; } catch (e) { snap = null; } return { code: r.code, name: r.name, snap, upd: r.upd || 0 }; }
async function insertProfile(db, th, name, now) {
  for (let i = 0; i < 6; i++) {
    const code = newCode();
    const r = await db.prepare('INSERT INTO prof (th, code, name, upd, made) VALUES (?1, ?2, ?3, ?4, ?4) ON CONFLICT DO NOTHING').bind(th, code, name, now).run();
    if (r && r.meta && r.meta.changes) return code;
    const again = await db.prepare('SELECT code FROM prof WHERE th = ?1').bind(th).first('code');
    if (again) return again;
  }
  return '';
}
async function handleSocial(env, db, day, dh, iph, task, body, origin) {
  if (!validTok(body.tok)) return reply({ error: 'bad_request' }, 400, origin);
  const th = await hid(env, 'prof:' + body.tok, 16), now = Date.now();
  const me = await db.prepare('SELECT id, code, name, upd FROM prof WHERE th = ?1').bind(th).first();

  if (task === 'social_me') { // créer le profil ou changer de pseudo
    const name = cleanName(body.name);
    if (!name) return reply({ error: 'bad_name' }, 400, origin);
    if (me) {
      if (me.name !== name) await db.prepare('UPDATE prof SET name = ?2 WHERE id = ?1').bind(me.id, name).run();
      return reply({ code: me.code, name }, 200, origin);
    }
    const ki = 'pnew:' + day + ':' + iph, kg = 'pnewall:' + day;
    const got = await counters(db, [ki, kg]);
    if ((got[ki] || 0) >= 10 || (got[kg] || 0) >= 5000) return reply({ error: 'rate_limited' }, 429, origin);
    // ménage : profils inutilisés depuis un an
    const old = await db.prepare('SELECT id FROM prof WHERE upd < ?1 LIMIT 20').bind(now - 365 * 864e5).all();
    const ids = (old.results || []).map((x) => x.id);
    if (ids.length) {
      const j = JSON.stringify(ids);
      await db.batch([
        db.prepare('DELETE FROM fr WHERE a IN (SELECT value FROM json_each(?1)) OR b IN (SELECT value FROM json_each(?1))').bind(j),
        db.prepare('DELETE FROM prof WHERE id IN (SELECT value FROM json_each(?1))').bind(j)
      ]);
    }
    const code = await insertProfile(db, th, name, now);
    if (!code) return reply({ error: 'busy' }, 503, origin);
    await db.batch([db.prepare(CNT_UP).bind(ki, 1, day), db.prepare(CNT_UP).bind(kg, 1, day)]);
    return reply({ code, name, created: true }, 200, origin);
  }

  if (!me) return reply({ error: 'no_profile' }, 404, origin);

  if (task === 'social_push') { // résumé envoyé par l'appli quand la progression change
    const raw = typeof body.snap === 'string' ? body.snap : '';
    if (!raw || raw.length > SNAP_MAX) return reply({ error: 'bad_request' }, 400, origin);
    let snap; try { snap = JSON.parse(raw); } catch (e) { snap = null; }
    if (!snap || typeof snap !== 'object' || Array.isArray(snap)) return reply({ error: 'bad_request' }, 400, origin);
    const kp = 'ppush:' + day + ':' + me.id, kg = 'addrows:' + day;
    const got = await counters(db, [kp, kg]);
    if ((got[kp] || 0) >= 150 || (got[kg] || 0) > ROWS_DAY_MAX) return reply({ error: 'rate_limited' }, 429, origin);
    await db.batch([
      db.prepare('UPDATE prof SET snap = ?2, upd = ?3 WHERE id = ?1').bind(me.id, JSON.stringify(snap), now),
      db.prepare(CNT_UP).bind(kp, 1, day), db.prepare(CNT_UP).bind(kg, 1, day)
    ]);
    return reply({ ok: true }, 200, origin);
  }

  if (task === 'social_list') {
    const r = await db.prepare('SELECT p.code, p.name, p.snap, p.upd FROM fr JOIN prof p ON p.id = fr.b WHERE fr.a = ?1 ORDER BY fr.since LIMIT ?2').bind(me.id, MAX_FRIENDS).all();
    return reply({ me: { code: me.code, name: me.name }, friends: (r.results || []).map(outFriend) }, 200, origin);
  }

  if (task === 'social_add') { // ajouter un ami avec son code : l'amitié vaut dans les deux sens
    const code = cleanCode(body.code);
    if (!code) return reply({ error: 'bad_code' }, 400, origin);
    if (code === me.code) return reply({ error: 'self' }, 400, origin);
    const ka = 'padd:' + day + ':' + me.id, kf = 'pfail:' + day + ':' + iph;
    const got = await counters(db, [ka, kf]);
    if ((got[ka] || 0) >= 30 || (got[kf] || 0) >= 30) return reply({ error: 'rate_limited' }, 429, origin);
    const fr = await db.prepare('SELECT id, code, name, snap, upd FROM prof WHERE code = ?1').bind(code).first();
    if (!fr) { await db.prepare(CNT_UP).bind(kf, 1, day).run(); return reply({ error: 'not_found' }, 404, origin); }
    const n = await db.prepare('SELECT (SELECT COUNT(*) FROM fr WHERE a = ?1) AS mine, (SELECT COUNT(*) FROM fr WHERE a = ?2) AS theirs, (SELECT COUNT(*) FROM fr WHERE a = ?1 AND b = ?2) AS already').bind(me.id, fr.id).first();
    if (n && n.already) return reply({ friend: outFriend(fr), already: true }, 200, origin);
    if (n && (n.mine >= MAX_FRIENDS || n.theirs >= MAX_FRIENDS)) return reply({ error: 'too_many' }, 400, origin);
    await db.batch([
      db.prepare('INSERT INTO fr (a, b, since) VALUES (?1, ?2, ?3), (?2, ?1, ?3) ON CONFLICT DO NOTHING').bind(me.id, fr.id, now),
      db.prepare(CNT_UP).bind(ka, 1, day)
    ]);
    return reply({ friend: outFriend(fr) }, 200, origin);
  }

  if (task === 'social_del') { // retirer un ami (des deux côtés)
    const code = cleanCode(body.code);
    const fr = code ? await db.prepare('SELECT id FROM prof WHERE code = ?1').bind(code).first() : null;
    if (fr) await db.prepare('DELETE FROM fr WHERE (a = ?1 AND b = ?2) OR (a = ?2 AND b = ?1)').bind(me.id, fr.id).run();
    return reply({ ok: true }, 200, origin);
  }

  if (task === 'social_code') { // nouveau code ami : l'ancien ne marche plus, les amis restent
    const kc = 'pcode:' + day + ':' + me.id;
    const got = await counters(db, [kc]);
    if ((got[kc] || 0) >= 5) return reply({ error: 'rate_limited' }, 429, origin);
    for (let i = 0; i < 6; i++) {
      const code = newCode();
      const r = await db.prepare('UPDATE prof SET code = ?2 WHERE id = ?1 AND NOT EXISTS (SELECT 1 FROM prof WHERE code = ?2)').bind(me.id, code).run();
      if (r && r.meta && r.meta.changes) { await db.prepare(CNT_UP).bind(kc, 1, day).run(); return reply({ code }, 200, origin); }
    }
    return reply({ error: 'busy' }, 503, origin);
  }

  if (task === 'social_drop') { // supprimer son profil et ses amitiés
    await db.batch([
      db.prepare('DELETE FROM fr WHERE a = ?1 OR b = ?1').bind(me.id),
      db.prepare('DELETE FROM prof WHERE id = ?1').bind(me.id)
    ]);
    return reply({ ok: true }, 200, origin);
  }

  return reply({ error: 'bad_task' }, 400, origin);
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const allowOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    if (request.method === 'OPTIONS') return reply(null, 204, allowOrigin);
    if (request.method !== 'POST') return reply({ error: 'method_not_allowed' }, 405, allowOrigin);
    if (!ALLOWED_ORIGINS.includes(origin)) return reply({ error: 'forbidden_origin' }, 403, allowOrigin);
    if (!env.ANTHROPIC_API_KEY) return reply({ error: 'not_configured' }, 500, allowOrigin);

    let body;
    try { body = await request.json(); } catch (e) { return reply({ error: 'bad_request' }, 400, allowOrigin); }
    const task = body && body.task;
    if (typeof task === 'string' && (task.indexOf('cards_') === 0 || task.indexOf('xfer_') === 0 || task.indexOf('social_') === 0)) {
      try { return await handleData(env, ctx, request, task, body, allowOrigin); }
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
    const extraText = String((body && body.text) || '').slice(0, MAX_TEXT);

    const quota = await checkQuota(env, request, body.device, task, images.length);
    if (!quota.ok) return reply(quota.body, quota.status || 429, allowOrigin);

    const content = images.map((im) => ({ type: 'image', source: { type: 'base64', media_type: im.type, data: im.data } }));
    content.push({ type: 'text', text: PROMPTS[task] + extraText });

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
