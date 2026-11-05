#!/usr/bin/env python3
# Base des joueurs FC 27 pour Squadoro, à partir de players.csv (notes publiques d'EA, instantané du 12/09/2026, projet EA_FC_ANALYSIS)
# Utilisation : python3 build_base.py players.csv players-fc27.json [--meta base-source.json --sha <commit du dépôt source>]
import csv, json, sys, gzip, datetime
args = sys.argv[1:]
def opt(name):
    if name in args: i = args.index(name); v = args[i + 1]; del args[i:i + 2]; return v
    return None
meta_path, sha = opt('--meta'), opt('--sha')
src, dst = args[0], args[1]
NAT = {"Afghanistan":"Afghanistan","Albania":"Albanie","Algeria":"Algérie","Andorra":"Andorre","Angola":"Angola","Antigua and Barbuda":"Antigua-et-Barbuda","Argentina":"Argentine","Armenia":"Arménie","Australia":"Australie","Austria":"Autriche","Azerbaijan":"Azerbaïdjan","Bangladesh":"Bangladesh","Barbados":"Barbade","Belarus":"Biélorussie","Belgium":"Belgique","Benin":"Bénin","Bermuda":"Bermudes","Bolivia":"Bolivie","Bosnia and Herzegovina":"Bosnie-Herzégovine","Brazil":"Brésil","Bulgaria":"Bulgarie","Burkina Faso":"Burkina Faso","Burundi":"Burundi","Cameroon":"Cameroun","Canada":"Canada","Cape Verde Islands":"Cap-Vert","Central African Republic":"Centrafrique","Chad":"Tchad","Chile":"Chili","China PR":"Chine","Chinese Taipei":"Taipei chinois","Colombia":"Colombie","Comoros":"Comores","Congo":"Congo","Congo DR":"RD Congo","Costa Rica":"Costa Rica","Croatia":"Croatie","Cuba":"Cuba","Curaçao":"Curaçao","Cyprus":"Chypre","Czech Republic":"Tchéquie","Côte d'Ivoire":"Côte d'Ivoire","Denmark":"Danemark","Dominican Republic":"République dominicaine","Ecuador":"Équateur","Egypt":"Égypte","El Salvador":"Salvador","England":"Angleterre","Equatorial Guinea":"Guinée équatoriale","Eritrea":"Érythrée","Estonia":"Estonie","Faroe Islands":"Îles Féroé","Finland":"Finlande","France":"France","Gabon":"Gabon","Gambia":"Gambie","Georgia":"Géorgie","Germany":"Allemagne","Ghana":"Ghana","Gibraltar":"Gibraltar","Greece":"Grèce","Grenada":"Grenade","Guatemala":"Guatemala","Guinea":"Guinée","Guinea-Bissau":"Guinée-Bissau","Guyana":"Guyana","Haiti":"Haïti","Holland":"Pays-Bas","Honduras":"Honduras","Hong Kong":"Hong Kong","Hungary":"Hongrie","Iceland":"Islande","India":"Inde","Indonesia":"Indonésie","Iran":"Iran","Iraq":"Irak","Israel":"Israël","Italy":"Italie","Jamaica":"Jamaïque","Japan":"Japon","Jordan":"Jordanie","Kazakhstan":"Kazakhstan","Kenya":"Kenya","Korea DPR":"Corée du Nord","Korea Republic":"Corée du Sud","Kosovo":"Kosovo","Latvia":"Lettonie","Lebanon":"Liban","Liberia":"Liberia","Libya":"Libye","Liechtenstein":"Liechtenstein","Lithuania":"Lituanie","Luxembourg":"Luxembourg","Madagascar":"Madagascar","Malawi":"Malawi","Mali":"Mali","Malta":"Malte","Mauritania":"Mauritanie","Mauritius":"Maurice","Mexico":"Mexique","Moldova":"Moldavie","Montenegro":"Monténégro","Montserrat":"Montserrat","Morocco":"Maroc","Mozambique":"Mozambique","Namibia":"Namibie","New Caledonia":"Nouvelle-Calédonie","New Zealand":"Nouvelle-Zélande","Niger":"Niger","Nigeria":"Nigeria","North Macedonia":"Macédoine du Nord","Northern Ireland":"Irlande du Nord","Norway":"Norvège","Oman":"Oman","Pakistan":"Pakistan","Palestine":"Palestine","Panama":"Panama","Paraguay":"Paraguay","Peru":"Pérou","Philippines":"Philippines","Poland":"Pologne","Portugal":"Portugal","Puerto Rico":"Porto Rico","Qatar":"Qatar","Republic of Ireland":"Irlande","Romania":"Roumanie","Russia":"Russie","Rwanda":"Rwanda","Saudi Arabia":"Arabie saoudite","Scotland":"Écosse","Senegal":"Sénégal","Serbia":"Serbie","Sierra Leone":"Sierra Leone","Slovakia":"Slovaquie","Slovenia":"Slovénie","Somalia":"Somalie","South Africa":"Afrique du Sud","Spain":"Espagne","Sri Lanka":"Sri Lanka","St. Kitts and Nevis":"Saint-Christophe-et-Niévès","St. Lucia":"Sainte-Lucie","Suriname":"Suriname","Sweden":"Suède","Switzerland":"Suisse","Syria":"Syrie","São Tomé e Príncipe":"Sao Tomé-et-Principe","Tanzania":"Tanzanie","Thailand":"Thaïlande","Togo":"Togo","Trinidad and Tobago":"Trinité-et-Tobago","Tunisia":"Tunisie","Turkey":"Turquie","Uganda":"Ouganda","Ukraine":"Ukraine","United Arab Emirates":"Émirats arabes unis","United States":"États-Unis","Uruguay":"Uruguay","Uzbekistan":"Ouzbékistan","Vanuatu":"Vanuatu","Venezuela":"Venezuela","Wales":"Pays de Galles","Yemen":"Yémen","Zambia":"Zambie","Zimbabwe":"Zimbabwe"}
ISO = {"Afghanistan":"af","Albania":"al","Algeria":"dz","Andorra":"ad","Angola":"ao","Antigua and Barbuda":"ag","Argentina":"ar","Armenia":"am","Australia":"au","Austria":"at","Azerbaijan":"az","Bangladesh":"bd","Barbados":"bb","Belarus":"by","Belgium":"be","Benin":"bj","Bermuda":"bm","Bolivia":"bo","Bosnia and Herzegovina":"ba","Brazil":"br","Bulgaria":"bg","Burkina Faso":"bf","Burundi":"bi","Cameroon":"cm","Canada":"ca","Cape Verde Islands":"cv","Central African Republic":"cf","Chad":"td","Chile":"cl","China PR":"cn","Chinese Taipei":"tw","Colombia":"co","Comoros":"km","Congo":"cg","Congo DR":"cd","Costa Rica":"cr","Croatia":"hr","Cuba":"cu","Curaçao":"cw","Cyprus":"cy","Czech Republic":"cz","Côte d'Ivoire":"ci","Denmark":"dk","Dominican Republic":"do","Ecuador":"ec","Egypt":"eg","El Salvador":"sv","England":"gb-eng","Equatorial Guinea":"gq","Eritrea":"er","Estonia":"ee","Faroe Islands":"fo","Finland":"fi","France":"fr","Gabon":"ga","Gambia":"gm","Georgia":"ge","Germany":"de","Ghana":"gh","Gibraltar":"gi","Greece":"gr","Grenada":"gd","Guatemala":"gt","Guinea":"gn","Guinea-Bissau":"gw","Guyana":"gy","Haiti":"ht","Holland":"nl","Honduras":"hn","Hong Kong":"hk","Hungary":"hu","Iceland":"is","India":"in","Indonesia":"id","Iran":"ir","Iraq":"iq","Israel":"il","Italy":"it","Jamaica":"jm","Japan":"jp","Jordan":"jo","Kazakhstan":"kz","Kenya":"ke","Korea DPR":"kp","Korea Republic":"kr","Kosovo":"xk","Latvia":"lv","Lebanon":"lb","Liberia":"lr","Libya":"ly","Liechtenstein":"li","Lithuania":"lt","Luxembourg":"lu","Madagascar":"mg","Malawi":"mw","Mali":"ml","Malta":"mt","Mauritania":"mr","Mauritius":"mu","Mexico":"mx","Moldova":"md","Montenegro":"me","Montserrat":"ms","Morocco":"ma","Mozambique":"mz","Namibia":"na","New Caledonia":"nc","New Zealand":"nz","Niger":"ne","Nigeria":"ng","North Macedonia":"mk","Northern Ireland":"gb-nir","Norway":"no","Oman":"om","Pakistan":"pk","Palestine":"ps","Panama":"pa","Paraguay":"py","Peru":"pe","Philippines":"ph","Poland":"pl","Portugal":"pt","Puerto Rico":"pr","Qatar":"qa","Republic of Ireland":"ie","Romania":"ro","Russia":"ru","Rwanda":"rw","Saudi Arabia":"sa","Scotland":"gb-sct","Senegal":"sn","Serbia":"rs","Sierra Leone":"sl","Slovakia":"sk","Slovenia":"si","Somalia":"so","South Africa":"za","Spain":"es","Sri Lanka":"lk","St. Kitts and Nevis":"kn","St. Lucia":"lc","Suriname":"sr","Sweden":"se","Switzerland":"ch","Syria":"sy","São Tomé e Príncipe":"st","Tanzania":"tz","Thailand":"th","Togo":"tg","Trinidad and Tobago":"tt","Tunisia":"tn","Turkey":"tr","Uganda":"ug","Ukraine":"ua","United Arab Emirates":"ae","United States":"us","Uruguay":"uy","Uzbekistan":"uz","Vanuatu":"vu","Venezuela":"ve","Wales":"gb-wls","Yemen":"ye","Zambia":"zm","Zimbabwe":"zw"}
LEA = {"LALIGA EA SPORTS":"LaLiga","LALIGA HYPERMOTION":"LaLiga Hypermotion","Ligue 1 McDonald's":"Ligue 1","Ligue 2 BKT":"Ligue 2","Serie A Enilive":"Serie A","Serie BKT":"Serie B","Liga F Moeve":"Liga F","Trendyol Süper Lig":"Süper Lig","Liga BBVA MX":"Liga MX","Isuzu UTE A League":"A-League","1A Pro League":"Pro League","GPFBL":"Frauen-Bundesliga","Arkema PL":"Arkema Première Ligue"}
rows = list(csv.DictReader(open(src, encoding='utf-8')))
need = ['first_name', 'last_name', 'common_name', 'overall_rating', 'position', 'alternate_positions', 'club', 'league', 'nationality', 'gender', 'skill_moves', 'weak_foot', 'playstyles', 'pace', 'shooting', 'passing', 'dribbling', 'defending', 'physicality']
miss_cols = [c for c in need if rows and c not in rows[0]]
if len(rows) < 10000 or miss_cols: print('ERREUR : fichier inattendu', len(rows), 'lignes, colonnes manquantes', miss_cols); sys.exit(2)
missing = sorted(set(r['nationality'] for r in rows) - set(NAT))
if missing: print('Attention : nations sans nom français (gardées en anglais) :', missing)
def snap(r):
    v = (r.get('snapshot_date') or '').strip()
    for f in ('%d-%m-%Y', '%Y-%m-%d', '%d/%m/%Y'):
        try: return datetime.datetime.strptime(v, f).strftime('%Y-%m-%d')
        except ValueError: pass
    return ''
at = max((snap(r) for r in rows), default='') or datetime.date.today().isoformat()
dic = {'nat': [], 'iso': [], 'lea': [], 'club': [], 'ps': []}
idx = {k: {} for k in dic}
def ix(k, v):
    if v not in idx[k]: idx[k][v] = len(dic[k]); dic[k].append(v)
    return idx[k][v]
P = []
for r in rows:
    try: ovr = int(r['overall_rating'])
    except ValueError: continue
    full = (r['first_name'] + ' ' + r['last_name']).strip()
    name = (r['common_name'] or full).strip()
    pos = ' '.join([r['position']] + [p for p in r['alternate_positions'].split() if p and p != r['position']])
    n = r['nationality']; ni = ix('nat', NAT.get(n, n))
    if len(dic['iso']) < len(dic['nat']): dic['iso'].append(ISO.get(n, ''))
    st = [int(r[k] or 0) for k in ['pace', 'shooting', 'passing', 'dribbling', 'defending', 'physicality']]
    ps = [ix('ps', p.strip()) for p in r['playstyles'].split(',') if p.strip()]
    P.append([name, full if full != name else 0, ovr, pos, ni, ix('lea', LEA.get(r['league'], r['league'])), ix('club', r['club']), int(r['weak_foot'] or 0), int(r['skill_moves'] or 0),
              '.'.join(map(str, st)) if all(st) else 0, ps or 0, 1 if r['gender'].startswith('Women') else 0])
P.sort(key=lambda p: -p[2])
out = {'v': 1, 'game': 'FC 27', 'at': at, 'src': "Notes publiques d'EA SPORTS FC 27 (instantané du " + at + "), via le projet EA_FC_ANALYSIS (github.com/lakshmikanth11/EA_FC_ANALYSIS)",
       'n': len(P), 'nat': dic['nat'], 'iso': dic['iso'], 'lea': dic['lea'], 'club': dic['club'], 'ps': dic['ps'],
       'f': ['name', 'full', 'ovr', 'pos', 'nat', 'lea', 'club', 'wf', 'sm', 'stats', 'ps', 'w'], 'p': P}
s = json.dumps(out, ensure_ascii=False, separators=(',', ':'))
open(dst, 'w', encoding='utf-8').write(s)
if meta_path: json.dump({'sha': sha or '', 'at': at, 'n': len(P), 'built': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')}, open(meta_path, 'w'), ensure_ascii=False, indent=1)
print('instantané', at, 'joueurs', len(P), 'nations', len(dic['nat']), 'ligues', len(dic['lea']), 'clubs', len(dic['club']), 'playstyles', len(dic['ps']))
print('taille', len(s.encode()), 'gzip', len(gzip.compress(s.encode(), 9)))
