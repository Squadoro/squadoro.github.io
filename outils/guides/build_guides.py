"""Construit les pages de texte du site Squadoro : guides, À propos, plan du site.
Usage : python3 build_guides.py <dossier du site>"""
import os, sys, re, html, json, importlib.util

OUT = sys.argv[1].rstrip('/') + '/'
HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location('articles', os.path.join(HERE, 'articles.py'))
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
ARTICLES = mod.ARTICLES
spec2 = importlib.util.spec_from_file_location('extras', os.path.join(HERE, 'extras.py'))
ex = importlib.util.module_from_spec(spec2); spec2.loader.exec_module(ex)
for _a in ARTICLES:
    _add = ex.EXTRAS.get(_a['slug'], [])
    _b = _a['blocks']
    _i = next((k for k, x in enumerate(_b) if x == ('h2', 'Dans Squadoro')), None)
    if _i is None: _i = next((k for k, x in enumerate(_b) if x[0] == 'app'), len(_b))
    _a['blocks'] = _b[:_i] + _add + _b[_i:]

SITE = 'https://squadoro.github.io/'
CLIENT = 'ca-pub-7663840153020314'
SLOT = '1994178215'
CF_TOKEN = '3821d8c7969343669c2bdd75ff697576'
UPDATED = '2026-11-11'
UPDATED_FR = '11 novembre 2026'

FACES = [('Barlow', 'normal', 400, 'barlow-regular'), ('Barlow', 'normal', 600, 'barlow-semibold'), ('Barlow', 'normal', 700, 'barlow-bold'),
         ('Barlow Condensed', 'normal', 700, 'barlowcondensed-bold'), ('Barlow Condensed', 'italic', 800, 'barlowcondensed-extrabolditalic')]


def head(title, desc, canon, root, ads):
    ff = '\n'.join("@font-face{font-family:'%s';font-style:%s;font-weight:%d;font-display:swap;src:url(%sfonts/%s.woff) format('woff')}" % (a, b, c, root, d) for a, b, c, d in FACES)
    return ('<!doctype html>\n<html lang="fr">\n<head>\n<meta charset="utf-8">\n'
            '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n'
            '<title>' + html.escape(title) + '</title>\n'
            '<meta name="description" content="' + html.escape(desc) + '">\n'
            '<link rel="canonical" href="' + canon + '">\n'
            '<meta name="google-adsense-account" content="' + CLIENT + '">\n'
            '<meta name="theme-color" content="#0A0F1C">\n'
            '<meta property="og:title" content="' + html.escape(title) + '">\n'
            '<meta property="og:description" content="' + html.escape(desc) + '">\n'
            '<meta property="og:type" content="article">\n<meta property="og:url" content="' + canon + '">\n'
            '<link rel="icon" type="image/png" sizes="192x192" href="' + root + 'icon-192.png">\n'
            '<link rel="apple-touch-icon" href="' + root + 'apple-touch-icon.png">\n'
            '<style>\n' + ff + '\n</style>\n'
            '<link rel="stylesheet" href="' + root + 'guides/guides.css">\n'
            + ('<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=' + CLIENT + '" crossorigin="anonymous"></script>\n' if ads else '')
            + "<script defer src='https://static.cloudflareinsights.com/beacon.min.js' data-cf-beacon='{\"token\": \"" + CF_TOKEN + "\"}'></script>\n"
            '</head>\n<body>\n')


def top(root, cur):
    nav = [('Guides', root + 'guides/', cur == 'guides'), ('À propos', root + 'a-propos.html', cur == 'about')]
    return ('<header class="top"><div class="wrap">'
            '<a class="brand" href="' + root + 'guides/"><span class="mark" aria-hidden="true">S</span>Squadoro</a>'
            '<nav aria-label="Navigation du site">' + ''.join('<a href="%s"%s>%s</a>' % (h, ' aria-current="page"' if c else '', t) for t, h, c in nav) +
            '<a class="cta" href="' + root + '">Ouvrir l\'appli</a></nav></div></header>\n')


def foot(root):
    return ('<footer class="foot"><div class="wrap">'
            '<p>Squadoro est un outil indépendant créé par des fans. Il n\'est pas affilié à Electronic Arts ni à EA SPORTS FC, et n\'est ni approuvé ni soutenu par eux. '
            'Les noms de joueurs, clubs et compétitions appartiennent à leurs propriétaires.</p>'
            '<p><a href="' + root + '">L\'appli</a> · <a href="' + root + 'guides/">Guides</a> · <a href="' + root + 'a-propos.html">À propos</a> · '
            '<a href="' + root + 'privacy.html">Confidentialité</a></p></div></footer>\n</body>\n</html>\n')


def ad():
    return ('<aside class="ad" aria-label="Publicité"><span class="ad-label">Publicité</span>'
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


def render_blocks(blocks, root):
    out, h2 = [], 0
    for t, c in blocks:
        c = nb(c)
        if t == 'p': out.append('<p>' + c + '</p>')
        elif t == 'h2':
            h2 += 1
            if h2 == 3: out.append(ad())  # une annonce au milieu de l'article, entre deux parties
            out.append('<h2>' + html.escape(c) + '</h2>')
        elif t == 'ul': out.append('<ul>' + ''.join('<li>' + x + '</li>' for x in c) + '</ul>')
        elif t == 'ol': out.append('<ol>' + ''.join('<li>' + x + '</li>' for x in c) + '</ol>')
        elif t == 'tip': out.append('<p class="tip"><strong>Astuce</strong> ' + c + '</p>')
        elif t == 'app': out.append('<p class="app"><a class="btn" href="' + root + '#' + c[1] + '">' + html.escape(c[0]) + ' →</a></p>')
    return '\n'.join(out)


os.makedirs(OUT + 'guides', exist_ok=True)
pages = []
for i, a in enumerate(ARTICLES):
    root = '../'
    url = SITE + 'guides/' + a['slug'] + '.html'
    mins = max(2, round(words(a['blocks']) / 200))
    rel = [ARTICLES[(i + k) % len(ARTICLES)] for k in (1, 2, 3)]
    ld = {'@context': 'https://schema.org', '@type': 'Article', 'headline': a['title'], 'description': a['desc'], 'inLanguage': 'fr',
          'datePublished': UPDATED, 'dateModified': UPDATED, 'mainEntityOfPage': url, 'publisher': {'@type': 'Organization', 'name': 'Squadoro', 'url': SITE}}
    body = (head(a['title'] + ' · Guides Squadoro', a['desc'], url, root, True) + top(root, 'guides') +
            '<main class="wrap article">\n<p class="crumbs"><a href="./">Guides</a> › <span>' + html.escape(a['title']) + '</span></p>\n'
            '<article>\n<h1>' + html.escape(a['title']) + '</h1>\n<p class="lead">' + html.escape(a['desc']) + '</p>\n'
            '<p class="meta">Mis à jour le ' + UPDATED_FR + ' · ' + str(mins) + ' min de lecture</p>\n' +
            render_blocks(a['blocks'], root) + '\n</article>\n' + ad() +
            '<section class="related"><h2>À lire aussi</h2><ul>' + ''.join('<li><a href="%s.html">%s</a><span>%s</span></li>' % (r['slug'], html.escape(r['title']), html.escape(r['desc'])) for r in rel) + '</ul></section>\n'
            '<script type="application/ld+json">' + json.dumps(ld, ensure_ascii=False) + '</script>\n</main>\n' + foot(root))
    open(OUT + 'guides/' + a['slug'] + '.html', 'w').write(body)
    pages.append(url)

# index des guides
idx = (head('Guides des DCE de FC 27 · Squadoro', "Guides pratiques pour réussir tes DCE dans FC 27 Ultimate Team : rentabilité, score d'objet, fourrage, collectif, postes verrouillés, sets et DCE joueur.", SITE + 'guides/', '../', True) + top('../', 'guides') +
       '<main class="wrap">\n<h1>Guides des DCE</h1>\n'
       '<p class="lead">Des guides courts et concrets pour faire un maximum de défis de création d\'équipe dans FC 27 sans vider ton club : savoir si un DCE est rentable, choisir les cartes à sacrifier, réussir le collectif, finir un set. '
       'Chaque guide renvoie à l\'écran de Squadoro qui fait le calcul pour toi.</p>\n'
       '<ul class="cards">' + ''.join('<li><a href="%s.html"><strong>%s</strong><span>%s</span></a></li>' % (a['slug'], html.escape(a['title']), html.escape(a['desc'])) for a in ARTICLES) + '</ul>\n'
       '<section class="about-box"><h2>Squadoro, c\'est quoi ?</h2><p>Squadoro est une appli gratuite qui part des cartes de ton club FC 27 pour compléter un maximum de DCE en sacrifiant le moins de valeur possible, et pour trouver ta meilleure équipe. '
       'Tes données restent sur ton appareil. <a href="../a-propos.html">En savoir plus</a> ou <a href="../">ouvrir l\'appli</a>.</p></section>\n</main>\n' + foot('../'))
open(OUT + 'guides/index.html', 'w').write(idx)

# À propos
about = (head('À propos de Squadoro', "Squadoro est une appli gratuite et indépendante pour réussir ses DCE dans FC 27 Ultimate Team et trouver sa meilleure équipe à partir de son propre club.", SITE + 'a-propos.html', '', True) + top('', 'about') +
         '<main class="wrap article">\n<article>\n<h1>À propos de Squadoro</h1>\n'
         '<p class="lead">Squadoro est une appli gratuite et indépendante, faite par des joueurs pour des joueurs de FC 27 Ultimate Team.</p>\n'
         '<h2>Ce que fait l\'appli</h2>\n<ul>'
         '<li><strong>DCE</strong> : elle répartit les cartes de ton club entre les défis de création d\'équipe du moment pour en compléter un maximum, en sacrifiant d\'abord les doublons et les cartes non échangeables, et classe les DCE du plus au moins rentable.</li>'
         '<li><strong>Meilleure équipe</strong> : elle cherche le onze avec la meilleure note sans sacrifier le collectif.</li>'
         '<li><strong>Mon club</strong> : import par captures d\'écran, fichier CSV ou à la main, et conseils sur les cartes à garder, à sacrifier ou à vendre.</li>'
         '<li><strong>Catalogue</strong> : la liste des DCE du moment, mise à jour chaque soir avec leurs conditions, leur formation et leur date de fin.</li></ul>\n'
         '<h2>Tes données</h2>\n<p>Squadoro n\'a pas de comptes et ne se connecte pas à ton compte de jeu. Ton club, tes DCE et tes réglages restent sur ton appareil. Les détails sont dans la page <a href="privacy.html">Confidentialité</a>.</p>\n'
         '<h2>Gratuit, financé par la publicité et les dons</h2>\n<p>L\'appli est gratuite. Les pages de guides peuvent afficher des publicités, et tu peux soutenir le projet par un don facultatif sur <a href="https://ko-fi.com/squadoro" rel="noopener">Ko-fi</a>. L\'appli elle-même, les écrans de calcul et l\'appli iPhone n\'affichent pas de publicité.</p>\n'
         '<h2>Contact</h2>\n<p>Une erreur dans un DCE, une idée ou un problème ? Ouvre un ticket sur <a href="https://github.com/Squadoro/squadoro.github.io/issues" rel="noopener">la page GitHub de Squadoro</a> (un compte GitHub gratuit suffit). Nous lisons chaque message.</p>\n'
         '<h2>Pour commencer</h2>\n<p>Lis <a href="guides/bien-debuter-dce.html">Bien débuter avec les DCE</a>, puis <a href="./">ouvre l\'appli</a> et importe ton club.</p>\n'
         '</article>\n</main>\n' + foot(''))
open(OUT + 'a-propos.html', 'w').write(about)

# plan du site et robots.txt
urls = [SITE, SITE + 'guides/'] + pages + [SITE + 'a-propos.html', SITE + 'privacy.html']
open(OUT + 'sitemap.xml', 'w').write('<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
                                     ''.join('  <url><loc>%s</loc><lastmod>%s</lastmod></url>\n' % (u, UPDATED) for u in urls) + '</urlset>\n')
open(OUT + 'robots.txt', 'w').write('User-agent: *\nAllow: /\n\nSitemap: ' + SITE + 'sitemap.xml\n')
import shutil
shutil.copy(os.path.join(HERE, 'guides.css'), OUT + 'guides/guides.css')
print('pages', len(pages) + 2, 'mots', sum(words(a['blocks']) for a in ARTICLES))
