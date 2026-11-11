"""Construit les pages de texte du site Squadoro : guides (français, anglais, espagnol), À propos, plan du site.
Usage : python3 build_guides.py <dossier du site>"""
import os, sys, re, html, json, importlib.util, shutil

OUT = sys.argv[1].rstrip('/') + '/'
HERE = os.path.dirname(os.path.abspath(__file__))


def load(name):
    spec = importlib.util.spec_from_file_location(name, os.path.join(HERE, name + '.py'))
    mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
    return mod


ARTICLES = {'fr': load('articles').ARTICLES, 'en': load('articles_en').ARTICLES, 'es': load('articles_es').ARTICLES}
ex = load('extras')
for _a in ARTICLES['fr']:  # exemples et questions fréquentes insérés avant « Dans Squadoro »
    _add = ex.EXTRAS.get(_a['slug'], [])
    _b = _a['blocks']
    _i = next((k for k, x in enumerate(_b) if x == ('h2', 'Dans Squadoro')), None)
    if _i is None: _i = next((k for k, x in enumerate(_b) if x[0] == 'app'), len(_b))
    _a['blocks'] = _b[:_i] + _add + _b[_i:]
    _a['fr'] = _a['slug']

SITE = 'https://squadoro.github.io/'
CLIENT = 'ca-pub-7663840153020314'
SLOT = '1994178215'
CF_TOKEN = '3821d8c7969343669c2bdd75ff697576'
UPDATED = '2026-11-11'
ORDER = ['fr', 'en', 'es']

L = {
 'fr': dict(dir='guides/', about='a-propos.html', locale='fr_FR', name='Français', updated='11 novembre 2026', app_q='',
            nav='Navigation du site', guides='Guides', about_t='À propos', open='Ouvrir l\'appli', the_app='L\'appli', privacy='Confidentialité',
            ad='Publicité', tip='Astuce', meta='Mis à jour le {d} · {m} min de lecture', related='À lire aussi', lang_nav='Langue',
            disclaimer="Squadoro est un outil indépendant créé par des fans. Il n'est pas affilié à Electronic Arts ni à EA SPORTS FC, et n'est ni approuvé ni soutenu par eux. Les noms de joueurs, clubs et compétitions appartiennent à leurs propriétaires.",
            idx_title='Guides des DCE de FC 27 · Squadoro', idx_h1='Guides des DCE', guide_suffix=' · Guides Squadoro',
            idx_desc="Guides pratiques pour réussir tes DCE dans FC 27 Ultimate Team : rentabilité, score d'objet, fourrage, collectif, postes verrouillés, sets et DCE joueur.",
            idx_lead="Des guides courts et concrets pour faire un maximum de défis de création d'équipe dans FC 27 sans vider ton club : savoir si un DCE est rentable, choisir les cartes à sacrifier, réussir le collectif, finir un set. Chaque guide renvoie à l'écran de Squadoro qui fait le calcul pour toi.",
            box_h="Squadoro, c'est quoi ?",
            box="Squadoro est une appli gratuite qui part des cartes de ton club FC 27 pour compléter un maximum de DCE en sacrifiant le moins de valeur possible, et pour trouver ta meilleure équipe. Tes données restent sur ton appareil. <a href=\"{about}\">En savoir plus</a> ou <a href=\"{app}\">ouvrir l'appli</a>."),
 'en': dict(dir='en/guides/', about='en/about.html', locale='en_GB', name='English', updated='11 November 2026', app_q='?lang=en',
            nav='Site navigation', guides='Guides', about_t='About', open='Open the app', the_app='The app', privacy='Privacy',
            ad='Advertisement', tip='Tip', meta='Updated {d} · {m} min read', related='Read next', lang_nav='Language',
            disclaimer="Squadoro is an independent tool made by fans. It is not affiliated with Electronic Arts or EA SPORTS FC, and is not endorsed or supported by them. Player, club and competition names belong to their owners.",
            idx_title='FC 27 SBC guides · Squadoro', idx_h1='SBC guides', guide_suffix=' · Squadoro guides',
            idx_desc="Practical guides to Squad Building Challenges in FC 27 Ultimate Team: value, item score, fodder, chemistry, locked positions, sets and player SBCs.",
            idx_lead="Short, practical guides to complete as many Squad Building Challenges as possible in FC 27 without emptying your club: tell whether an SBC is worth it, choose which cards to submit, get the chemistry right, finish a set. Each guide links to the Squadoro screen that does the maths for you.",
            box_h='What is Squadoro?',
            box="Squadoro is a free app that starts from the cards in your FC 27 club to complete as many SBCs as possible while giving away as little value as possible, and to find your best team. Your data stays on your device. <a href=\"{about}\">Learn more</a> or <a href=\"{app}\">open the app</a>."),
 'es': dict(dir='es/guias/', about='es/acerca-de.html', locale='es_ES', name='Español', updated='11 de noviembre de 2026', app_q='?lang=es',
            nav='Navegación del sitio', guides='Guías', about_t='Acerca de', open='Abrir la app', the_app='La app', privacy='Privacidad',
            ad='Publicidad', tip='Consejo', meta='Actualizado el {d} · {m} min de lectura', related='Sigue leyendo', lang_nav='Idioma',
            disclaimer="Squadoro es una herramienta independiente creada por aficionados. No está afiliada a Electronic Arts ni a EA SPORTS FC, y no cuenta con su aprobación ni su apoyo. Los nombres de jugadores, clubes y competiciones pertenecen a sus propietarios.",
            idx_title='Guías de SBC de FC 27 · Squadoro', idx_h1='Guías de SBC', guide_suffix=' · Guías de Squadoro',
            idx_desc="Guías prácticas para los SBC de FC 27 Ultimate Team: rentabilidad, puntuación de objeto, forraje, química, posiciones bloqueadas, sets y SBC de jugador.",
            idx_lead="Guías cortas y prácticas para completar el máximo de desafíos de creación de plantillas en FC 27 sin vaciar tu club: saber si un SBC es rentable, elegir qué cartas entregar, acertar con la química, terminar un set. Cada guía lleva a la pantalla de Squadoro que hace el cálculo por ti.",
            box_h='¿Qué es Squadoro?',
            box="Squadoro es una app gratuita que parte de las cartas de tu club de FC 27 para completar el máximo de SBC entregando el menor valor posible, y para encontrar tu mejor equipo. Tus datos se quedan en tu dispositivo. <a href=\"{about}\">Más información</a> o <a href=\"{app}\">abrir la app</a>."),
}

ABOUT = {
 'fr': dict(title='À propos de Squadoro', desc="Squadoro est une appli gratuite et indépendante pour réussir ses DCE dans FC 27 Ultimate Team et trouver sa meilleure équipe à partir de son propre club.", body=
    '<h1>À propos de Squadoro</h1>\n'
    '<p class="lead">Squadoro est une appli gratuite et indépendante, faite par des joueurs pour des joueurs de FC 27 Ultimate Team.</p>\n'
    '<h2>Ce que fait l\'appli</h2>\n<ul>'
    '<li><strong>DCE</strong> : elle répartit les cartes de ton club entre les défis de création d\'équipe du moment pour en compléter un maximum, en sacrifiant d\'abord les doublons et les cartes non échangeables, et classe les DCE du plus au moins rentable.</li>'
    '<li><strong>Meilleure équipe</strong> : elle cherche le onze avec la meilleure note sans sacrifier le collectif.</li>'
    '<li><strong>Mon club</strong> : import par captures d\'écran, fichier CSV ou à la main, et conseils sur les cartes à garder, à sacrifier ou à vendre.</li>'
    '<li><strong>Catalogue</strong> : la liste des DCE du moment, mise à jour chaque soir avec leurs conditions, leur formation et leur date de fin. Sur le site, tu peux être prévenu par une notification des nouveaux DCE.</li></ul>\n'
    '<h2>Tes données</h2>\n<p>Squadoro n\'a pas de comptes et ne se connecte pas à ton compte de jeu. Ton club, tes DCE et tes réglages restent sur ton appareil. Les détails sont dans la page <a href="{root}privacy.html">Confidentialité</a>.</p>\n'
    '<h2>Gratuit, financé par la publicité et les dons</h2>\n<p>L\'appli est gratuite. Les pages de guides peuvent afficher des publicités, et tu peux soutenir le projet par un don facultatif sur <a href="https://ko-fi.com/squadoro" rel="noopener">Ko-fi</a>. L\'appli elle-même, les écrans de calcul et l\'appli iPhone n\'affichent pas de publicité.</p>\n'
    '<h2>Contact</h2>\n<p>Une erreur dans un DCE, une idée ou un problème ? Écris-nous directement depuis l\'appli avec le bouton « Une idée ou un bug ? » (en bas de l\'écran ou dans les Réglages). Tu peux aussi ouvrir un ticket sur <a href="https://github.com/Squadoro/squadoro.github.io/issues" rel="noopener">la page GitHub de Squadoro</a>. Nous lisons chaque message.</p>\n'
    '<h2>Pour commencer</h2>\n<p>Lis <a href="{guides}bien-debuter-dce.html">Bien débuter avec les DCE</a>, puis <a href="{app}">ouvre l\'appli</a> et importe ton club.</p>\n'),
 'en': dict(title='About Squadoro', desc="Squadoro is a free, independent app to complete Squad Building Challenges in FC 27 Ultimate Team and find your best team from your own club.", body=
    '<h1>About Squadoro</h1>\n'
    '<p class="lead">Squadoro is a free, independent app, made by players for FC 27 Ultimate Team players.</p>\n'
    '<h2>What the app does</h2>\n<ul>'
    '<li><strong>SBCs</strong>: it spreads the cards in your club across the current Squad Building Challenges to complete as many as possible, using duplicates and untradeable cards first, and ranks SBCs from best to worst value.</li>'
    '<li><strong>Best team</strong>: it looks for the starting eleven with the highest rating without sacrificing chemistry.</li>'
    '<li><strong>My club</strong>: import with screenshots, a CSV file or by hand, plus advice on which cards to keep, submit or sell.</li>'
    '<li><strong>Catalogue</strong>: the list of current SBCs, updated every evening with their requirements, formation and end date. On the website, you can get a notification when new SBCs arrive.</li></ul>\n'
    '<h2>Your data</h2>\n<p>Squadoro has no accounts and never connects to your game account. Your club, your SBCs and your settings stay on your device. The details are on the <a href="{root}privacy.html">Privacy</a> page.</p>\n'
    '<h2>Free, funded by ads and donations</h2>\n<p>The app is free. The guide pages may show ads, and you can support the project with an optional donation on <a href="https://ko-fi.com/squadoro" rel="noopener">Ko-fi</a>. The app itself, its calculation screens and the iPhone app show no ads.</p>\n'
    '<h2>Contact</h2>\n<p>A mistake in an SBC, an idea or a problem? Write to us right from the app with the “An idea or a bug?” button (at the bottom of the screen or in Settings). You can also open an issue on <a href="https://github.com/Squadoro/squadoro.github.io/issues" rel="noopener">Squadoro\'s GitHub page</a>. We read every message.</p>\n'
    '<h2>Getting started</h2>\n<p>Read <a href="{guides}getting-started-sbcs.html">Getting started with SBCs</a>, then <a href="{app}">open the app</a> and import your club.</p>\n'),
 'es': dict(title='Acerca de Squadoro', desc="Squadoro es una app gratuita e independiente para completar los SBC de FC 27 Ultimate Team y encontrar tu mejor equipo a partir de tu propio club.", body=
    '<h1>Acerca de Squadoro</h1>\n'
    '<p class="lead">Squadoro es una app gratuita e independiente, hecha por jugadores para jugadores de FC 27 Ultimate Team.</p>\n'
    '<h2>Lo que hace la app</h2>\n<ul>'
    '<li><strong>SBC</strong>: reparte las cartas de tu club entre los desafíos de creación de plantillas del momento para completar el máximo, usando primero los duplicados y las cartas intransferibles, y ordena los SBC de más a menos rentable.</li>'
    '<li><strong>Mejor equipo</strong>: busca el once con la valoración más alta sin sacrificar la química.</li>'
    '<li><strong>Mi club</strong>: importación con capturas de pantalla, archivo CSV o a mano, y consejos sobre qué cartas conservar, entregar o vender.</li>'
    '<li><strong>Catálogo</strong>: la lista de SBC del momento, actualizada cada noche con sus requisitos, su formación y su fecha de fin. En la web puedes recibir una notificación cuando llegan SBC nuevos.</li></ul>\n'
    '<h2>Tus datos</h2>\n<p>Squadoro no tiene cuentas y nunca se conecta a tu cuenta del juego. Tu club, tus SBC y tus ajustes se quedan en tu dispositivo. Los detalles están en la página de <a href="{root}privacy.html">Privacidad</a> (en francés e inglés).</p>\n'
    '<h2>Gratis, gracias a la publicidad y las donaciones</h2>\n<p>La app es gratuita. Las páginas de guías pueden mostrar publicidad, y puedes apoyar el proyecto con una donación opcional en <a href="https://ko-fi.com/squadoro" rel="noopener">Ko-fi</a>. La app en sí, sus pantallas de cálculo y la app de iPhone no muestran publicidad.</p>\n'
    '<h2>Contacto</h2>\n<p>¿Un error en un SBC, una idea o un problema? Escríbenos directamente desde la app con el botón «¿Una idea o un error?» (abajo en la pantalla o en Ajustes). También puedes abrir una incidencia en <a href="https://github.com/Squadoro/squadoro.github.io/issues" rel="noopener">la página de GitHub de Squadoro</a>. Leemos todos los mensajes.</p>\n'
    '<h2>Para empezar</h2>\n<p>Lee <a href="{guides}empezar-con-los-sbc.html">Empezar con los SBC</a>, luego <a href="{app}">abre la app</a> e importa tu club.</p>\n'),
}

FACES = [('Barlow', 'normal', 400, 'barlow-regular'), ('Barlow', 'normal', 600, 'barlow-semibold'), ('Barlow', 'normal', 700, 'barlow-bold'),
         ('Barlow Condensed', 'normal', 700, 'barlowcondensed-bold'), ('Barlow Condensed', 'italic', 800, 'barlowcondensed-extrabolditalic')]


def rootof(path):  # chemin relatif vers la racine du site depuis une page
    return '../' * path.count('/')


def head(lang, title, desc, path, alts, ads, kind='article'):
    root = rootof(path)
    ff = '\n'.join("@font-face{font-family:'%s';font-style:%s;font-weight:%d;font-display:swap;src:url(%sfonts/%s.woff) format('woff')}" % (a, b, c, root, d) for a, b, c, d in FACES)
    canon = SITE + (path[:-len('index.html')] if path.endswith('index.html') else path)
    alt = ''.join('<link rel="alternate" hreflang="%s" href="%s">\n' % (l, SITE + (p[:-len('index.html')] if p.endswith('index.html') else p)) for l, p in alts.items())
    if 'en' in alts: alt += '<link rel="alternate" hreflang="x-default" href="%s">\n' % (SITE + (alts['en'][:-len('index.html')] if alts['en'].endswith('index.html') else alts['en']))
    return ('<!doctype html>\n<html lang="' + lang + '">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
            '<title>' + html.escape(title) + '</title>\n'
            '<meta name="description" content="' + html.escape(desc) + '">\n'
            '<link rel="canonical" href="' + canon + '">\n' + alt +
            '<meta name="google-adsense-account" content="' + CLIENT + '">\n'
            '<meta name="theme-color" content="#0A0F1C">\n'
            '<meta property="og:title" content="' + html.escape(title) + '">\n'
            '<meta property="og:description" content="' + html.escape(desc) + '">\n'
            '<meta property="og:type" content="' + kind + '">\n<meta property="og:url" content="' + canon + '">\n'
            '<meta property="og:locale" content="' + L[lang]['locale'] + '">\n'
            '<link rel="icon" type="image/png" sizes="192x192" href="' + root + 'icon-192.png">\n'
            '<link rel="apple-touch-icon" href="' + root + 'apple-touch-icon.png">\n'
            '<style>\n' + ff + '\n</style>\n'
            '<link rel="stylesheet" href="' + root + 'guides/guides.css">\n'
            + ('<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + CLIENT + '" crossorigin="anonymous"></script>\n' if ads else '')
            + "<script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{\"token\": \"" + CF_TOKEN + "\"}'></script>\n"
            '</head>\n<body>\n')


def top(lang, path, cur, alts):
    T, root = L[lang], rootof(path)
    nav = [(T['guides'], root + T['dir'], cur == 'guides'), (T['about_t'], root + T['about'], cur == 'about')]
    langs = ''.join('<a href="%s" hreflang="%s" lang="%s"%s>%s</a>' % (root + (alts[l][:-len('index.html')] if alts[l].endswith('index.html') else alts[l]), l, l, ' aria-current="true"' if l == lang else '', l.upper()) for l in ORDER if l in alts)
    return ('<header class="top"><div class="wrap">'
            '<a class="brand" href="' + root + T['dir'] + '"><span class="mark" aria-hidden="true">S</span>Squadoro</a>'
            '<nav aria-label="' + T['nav'] + '">' + ''.join('<a href="%s"%s>%s</a>' % (h, ' aria-current="page"' if c else '', t) for t, h, c in nav) +
            '<span class="langs" role="group" aria-label="' + T['lang_nav'] + '">' + langs + '</span>'
            '<a class="cta" href="' + root + T['app_q'] + '">' + html.escape(T['open']) + '</a></nav></div></header>\n')


def foot(lang, path):
    T, root = L[lang], rootof(path)
    return ('<footer class="foot"><div class="wrap">'
            '<p>' + html.escape(T['disclaimer']) + '</p>'
            '<p><a href="' + root + T['app_q'] + '">' + html.escape(T['the_app']) + '</a> · <a href="' + root + T['dir'] + '">' + T['guides'] + '</a> · <a href="' + root + T['about'] + '">' + html.escape(T['about_t']) + '</a> · '
            '<a href="' + root + 'privacy.html">' + T['privacy'] + '</a></p></div></footer>\n</body>\n</html>\n')


def ad(lang):
    return ('<aside class="ad" aria-label="' + L[lang]['ad'] + '"><span class="ad-label">' + L[lang]['ad'] + '</span>'
            '<ins class="adsbygoogle" style="display:block" data-ad-client="' + CLIENT + '" data-ad-slot="' + SLOT + '" data-ad-format="auto" data-full-width-responsive="true"></ins>'
            '<script>(adsbygoogle = window.adsbygoogle || []).push({});</script></aside>\n')


def words(blocks):
    n = 0
    for t, c in blocks:
        if isinstance(c, str): n += len(re.sub('<[^>]+>', '', c).split())
        elif isinstance(c, list): n += sum(len(re.sub('<[^>]+>', '', x).split()) for x in c)
    return n


def nb(x):  # pas de retour à la ligne au milieu d'un nombre (5 000)
    return re.sub(r'(\d) (\d{3})', '\\1\u202f\\2', x) if isinstance(x, str) else [nb(y) for y in x] if isinstance(x, list) else x


def render_blocks(lang, blocks, root):
    out, h2 = [], 0
    for t, c in blocks:
        c = nb(c)
        if t == 'p': out.append('<p>' + c + '</p>')
        elif t == 'h2':
            h2 += 1
            if h2 == 3: out.append(ad(lang))  # une annonce au milieu de l'article, entre deux parties
            out.append('<h2>' + html.escape(c) + '</h2>')
        elif t == 'ul': out.append('<ul>' + ''.join('<li>' + x + '</li>' for x in c) + '</ul>')
        elif t == 'ol': out.append('<ol>' + ''.join('<li>' + x + '</li>' for x in c) + '</ol>')
        elif t == 'tip': out.append('<p class="tip"><strong>' + L[lang]['tip'] + '</strong> ' + c + '</p>')
        elif t == 'app': out.append('<p class="app"><a class="btn" href="' + root + L[lang]['app_q'] + '#' + c[1] + '">' + html.escape(c[0]) + ' →</a></p>')
    return '\n'.join(out)


# chemins de chaque article dans chaque langue, d'après le slug français
by_fr = {l: {a['fr']: a for a in ARTICLES[l]} for l in ORDER}
for l in ORDER: assert set(by_fr[l]) == set(by_fr['fr']), l
groups = []  # (alts) pour le plan du site
for lang in ORDER:
    T, arts = L[lang], ARTICLES[lang]
    os.makedirs(OUT + T['dir'], exist_ok=True)
    for i, a in enumerate(arts):
        path = T['dir'] + a['slug'] + '.html'
        alts = {l: L[l]['dir'] + by_fr[l][a['fr']]['slug'] + '.html' for l in ORDER}
        root = rootof(path)
        mins = max(2, round(words(a['blocks']) / 200))
        rel = [arts[(i + k) % len(arts)] for k in (1, 2, 3)]
        ld = {'@context': 'https://schema.org', '@type': 'Article', 'headline': a['title'], 'description': a['desc'], 'inLanguage': lang,
              'datePublished': UPDATED, 'dateModified': UPDATED, 'mainEntityOfPage': SITE + path, 'publisher': {'@type': 'Organization', 'name': 'Squadoro', 'url': SITE}}
        body = (head(lang, a['title'] + T['guide_suffix'], a['desc'], path, alts, True) + top(lang, path, 'guides', alts) +
                '<main class="wrap article">\n<p class="crumbs"><a href="./">' + T['guides'] + '</a> › <span>' + html.escape(a['title']) + '</span></p>\n'
                '<article>\n<h1>' + html.escape(a['title']) + '</h1>\n<p class="lead">' + html.escape(a['desc']) + '</p>\n'
                '<p class="meta">' + T['meta'].format(d=T['updated'], m=mins) + '</p>\n' +
                render_blocks(lang, a['blocks'], root) + '\n</article>\n' + ad(lang) +
                '<section class="related"><h2>' + T['related'] + '</h2><ul>' + ''.join('<li><a href="%s.html">%s</a><span>%s</span></li>' % (r['slug'], html.escape(r['title']), html.escape(r['desc'])) for r in rel) + '</ul></section>\n'
                '<script type="application/ld+json">' + json.dumps(ld, ensure_ascii=False) + '</script>\n</main>\n' + foot(lang, path))
        open(OUT + path, 'w').write(body)
        if lang == 'fr': groups.append(alts)
    # index des guides
    path = T['dir'] + 'index.html'
    alts = {l: L[l]['dir'] + 'index.html' for l in ORDER}
    root = rootof(path)
    idx = (head(lang, T['idx_title'], T['idx_desc'], path, alts, True, 'website') + top(lang, path, 'guides', alts) +
           '<main class="wrap">\n<h1>' + T['idx_h1'] + '</h1>\n'
           '<p class="lead">' + html.escape(T['idx_lead']) + '</p>\n'
           '<ul class="cards">' + ''.join('<li><a href="%s.html"><strong>%s</strong><span>%s</span></a></li>' % (a['slug'], html.escape(a['title']), html.escape(a['desc'])) for a in arts) + '</ul>\n'
           '<section class="about-box"><h2>' + html.escape(T['box_h']) + '</h2><p>' + T['box'].format(about=root + T['about'], app=root + T['app_q']) + '</p></section>\n</main>\n' + foot(lang, path))
    open(OUT + path, 'w').write(idx)
    # À propos
    A = ABOUT[lang]
    path = T['about']
    alts_a = {l: L[l]['about'] for l in ORDER}
    root = rootof(path)
    if '/' in path: os.makedirs(OUT + os.path.dirname(path), exist_ok=True)
    about = (head(lang, A['title'], A['desc'], path, alts_a, True, 'website') + top(lang, path, 'about', alts_a) +
             '<main class="wrap article">\n<article>\n' + A['body'].format(root=root, guides=root + T['dir'], app=root + T['app_q']) + '</article>\n</main>\n' + foot(lang, path))
    open(OUT + path, 'w').write(about)
groups = [{l: L[l]['dir'] + 'index.html' for l in ORDER}] + groups + [{l: L[l]['about'] for l in ORDER}]

# plan du site (avec les versions dans chaque langue) et robots.txt
def url(p): return SITE + (p[:-len('index.html')] if p.endswith('index.html') else p)
entries = ['  <url><loc>%s</loc><lastmod>%s</lastmod></url>\n' % (SITE, UPDATED)]
for g in groups:
    links = ''.join('<xhtml:link rel="alternate" hreflang="%s" href="%s"/>' % (l, url(g[l])) for l in ORDER)
    for l in ORDER: entries.append('  <url><loc>%s</loc><lastmod>%s</lastmod>%s</url>\n' % (url(g[l]), UPDATED, links))
entries.append('  <url><loc>%sprivacy.html</loc><lastmod>%s</lastmod></url>\n' % (SITE, UPDATED))
open(OUT + 'sitemap.xml', 'w').write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n' + ''.join(entries) + '</urlset>\n')
open(OUT + 'robots.txt', 'w').write('User-agent: *\nAllow: /\n\nSitemap: ' + SITE + 'sitemap.xml\n')
shutil.copy(os.path.join(HERE, 'guides.css'), OUT + 'guides/guides.css')
print('pages', sum(len(ARTICLES[l]) + 2 for l in ORDER), 'mots', {l: sum(words(a['blocks']) for a in ARTICLES[l]) for l in ORDER})
