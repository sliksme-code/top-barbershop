"""Перенос данных WordPress (дамп в контейнере wp-mysql) → PostgreSQL (Directus).

Запуск на сервере (см. .github/workflows/migrate.yml):
  docker run --rm --network top-barbershop_default -v $PWD/migration/etl:/etl -e ... python:3.12-slim python /etl/etl.py
Скрипт идемпотентный: пересоздаёт таблицы контента и заливает всё заново.
"""
import json
import os
import re
import sys
from datetime import datetime, timezone

import phpserialize
import psycopg
import pymysql

MY = dict(host=os.environ.get('WP_HOST', 'wp-mysql'), user='root', password=os.environ.get('WP_PASS', 'legacy'),
          database='wp', charset='utf8mb4', cursorclass=pymysql.cursors.DictCursor)
PG = os.environ['PG_DSN']
SITE = 'https://top-barbershop.com'

STATUS = {'publish': 'published', 'pending': 'pending', 'draft': 'draft', 'future': 'draft', 'private': 'draft'}
DAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']


def log(*a):
    print(*a, flush=True)


def unser(v):
    """PHP-сериализация → python (str вместо bytes)."""
    if v is None or v == '':
        return None
    if isinstance(v, bytes):
        v = v.decode('utf8', 'replace')
    if not re.match(r'^[aisbdON]:', v):
        return v
    try:
        def dec(x):
            if isinstance(x, bytes):
                return x.decode('utf8', 'replace')
            if isinstance(x, dict):
                return {dec(k): dec(val) for k, val in x.items()}
            if isinstance(x, (list, tuple)):
                return [dec(i) for i in x]
            return x
        return dec(phpserialize.loads(v.encode('utf8'), decode_strings=False))
    except Exception:
        return v


def media_path(url):
    """Абсолютный URL картинки → путь /media/... (старые пути сохраняются 1:1)."""
    if not url:
        return None
    u = str(url).strip()
    u = re.sub(r'^https?://(www\.)?top-barbershop\.com', '', u)
    u = u.replace('/wp-content/uploads/', '/media/')
    return u if u.startswith('/') else None


def to24(t):
    if not t:
        return None
    m = re.match(r'\s*(\d{1,2}):(\d{2})\s*([AP]M)?', t, re.I)
    if not m:
        return t
    h, mi, ap = int(m.group(1)), m.group(2), (m.group(3) or '').upper()
    if ap == 'PM' and h < 12:
        h += 12
    if ap == 'AM' and h == 12:
        h = 0
    return f'{h:02d}:{mi}'


def hours(v):
    d = unser(v)
    if not isinstance(d, dict) and not isinstance(d, list):
        return None
    items = d.values() if isinstance(d, dict) else d
    out = []
    for it in items:
        if not isinstance(it, dict):
            continue
        day = it.get('listing_day')
        out.append({'day': DAYS.index(day) + 1 if day in DAYS else day,
                    'from': to24(it.get('listing_time_from')), 'to': to24(it.get('listing_time_to')),
                    'note': it.get('listing_custom') or None})
    return out or None


def autop(html):
    """Упрощённый wpautop: абзацы из пустых строк, переносы → <br>. Блочные теги не оборачиваются."""
    if not html:
        return html
    html = html.replace('\r\n', '\n')
    # чистка опасного: скрипты, обработчики событий, iframe кроме YouTube/VK/Vimeo
    html = re.sub(r'<script[\s\S]*?</script>', '', html, flags=re.I)
    html = re.sub(r'\son\w+="[^"]*"', '', html, flags=re.I)
    html = re.sub(r'<iframe(?![^>]*(youtube\.com|youtu\.be|vk\.com|vimeo\.com))[\s\S]*?</iframe>', '', html, flags=re.I)
    html = html.replace('https://top-barbershop.com/wp-content/uploads/', '/media/').replace('http://top-barbershop.com/wp-content/uploads/', '/media/')
    html = re.sub(r'https?://top-barbershop\.com/media/', '/media/', html)
    block = r'(?:table|thead|tfoot|caption|col|colgroup|tbody|tr|td|th|div|dl|dd|dt|ul|ol|li|pre|form|map|area|blockquote|address|math|style|p|h[1-6]|hr|fieldset|legend|section|article|aside|hgroup|header|footer|nav|figure|figcaption|details|menu|summary|iframe)'
    parts = [p.strip() for p in re.split(r'\n\s*\n', html) if p.strip()]
    res = []
    for p in parts:
        if re.match(rf'^</?{block}[\s/>]', p, re.I):
            res.append(p)
        else:
            res.append('<p>' + p.replace('\n', '<br>\n') + '</p>')
    return '\n'.join(res)


def strip_shortcodes(html):
    return re.sub(r'\[/?[a-z_\-]+[^\]]*\]', '', html or '', flags=re.I)


def ts(v):
    if not v or str(v).startswith('0000'):
        return None
    return v.replace(tzinfo=timezone.utc) if isinstance(v, datetime) else v


def main():
    my = pymysql.connect(**MY)
    cur = my.cursor()
    pg = psycopg.connect(PG, autocommit=False)
    pc = pg.cursor()

    log('== схема')
    pc.execute(open(os.path.join(os.path.dirname(__file__), 'schema.sql')).read())

    # ---------- справочник полей
    cur.execute("""SELECT p.ID, p.post_title, p.menu_order,
        MAX(CASE WHEN m.meta_key='field_identifier' THEN m.meta_value END) ident,
        MAX(CASE WHEN m.meta_key='field_type' THEN m.meta_value END) ftype,
        MAX(CASE WHEN m.meta_key='field_metabox' THEN m.meta_value END) box,
        MAX(CASE WHEN m.meta_key='field_filter_field' THEN m.meta_value END) filt
        FROM wp_posts p JOIN wp_postmeta m ON m.post_id=p.ID WHERE p.post_type='field' AND p.post_status='publish' GROUP BY p.ID""")
    services, amenities = {}, {}
    for i, r in enumerate(cur.fetchall()):
        box = str(unser(r['box']) or '')
        if r['ftype'] == 'text_money':
            services[r['ident']] = r['post_title']
            pc.execute('INSERT INTO features VALUES (%s,%s,%s,%s,%s)', (r['ident'], r['post_title'], 'service', i, False))
        elif r['ftype'] == 'checkbox':
            amenities[r['ident']] = r['post_title']
            pc.execute('INSERT INTO features VALUES (%s,%s,%s,%s,%s)', (r['ident'], r['post_title'], 'amenity', i, r['filt'] == 'on'))
    log('услуги', len(services), 'удобства', len(amenities))

    # ---------- термины
    cur.execute("""SELECT t.term_id, t.name, t.slug, tt.taxonomy, tt.parent, tt.description, tt.count,
        (SELECT meta_value FROM wp_termmeta tm WHERE tm.term_id=t.term_id AND tm.meta_key='_aioseop_title' LIMIT 1) seo_title,
        (SELECT meta_value FROM wp_termmeta tm WHERE tm.term_id=t.term_id AND tm.meta_key='image_id' LIMIT 1) image_id
        FROM wp_terms t JOIN wp_term_taxonomy tt ON tt.term_id=t.term_id""")
    terms = cur.fetchall()
    by_tax = {}
    for t in terms:
        by_tax.setdefault(t['taxonomy'], []).append(t)

    locs = {t['term_id']: t for t in by_tax.get('locations', [])}

    def loc_path(tid, seen=None):
        t = locs[tid]
        p = t['parent']
        return (loc_path(p) + '/' if p and p in locs else '') + t['slug']
    # родители раньше детей
    for t in sorted(locs.values(), key=lambda x: loc_path(x['term_id']).count('/')):
        pc.execute('INSERT INTO locations VALUES (%s,%s,%s,%s,%s,%s,%s,%s)',
                   (t['term_id'], t['name'], t['slug'], t['parent'] if t['parent'] in locs else None,
                    loc_path(t['term_id']), t['seo_title'], t['description'] or None, t['count']))
    for t in by_tax.get('metros', []):
        m = re.search(r'\(([^)]+)\)\s*$', t['name'])
        pc.execute('INSERT INTO metro VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT (slug) DO NOTHING',
                   (t['term_id'], t['name'], t['slug'], m.group(1) if m else None, t['seo_title'], t['count']))
    for t in by_tax.get('chain', []):
        pc.execute('INSERT INTO chains VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT (slug) DO NOTHING',
                   (t['term_id'], t['name'], t['slug'], t['description'] or None, t['seo_title'], None))
    for t in by_tax.get('collection', []):
        pc.execute('INSERT INTO collections VALUES (%s,%s,%s,%s,%s) ON CONFLICT (slug) DO NOTHING',
                   (t['term_id'], t['name'], t['slug'], t['description'] or None, t['seo_title']))
    for t in by_tax.get('category', []):
        pc.execute('INSERT INTO categories VALUES (%s,%s,%s,%s,%s) ON CONFLICT (slug) DO NOTHING',
                   (t['term_id'], t['name'], t['slug'], t['description'] or None, t['seo_title']))
    for tax, table in (('bs_school_city', 'school_cities'), ('bs_vacancy_city', 'vacancy_cities')):
        for t in by_tax.get(tax, []):
            pc.execute(f'INSERT INTO {table} VALUES (%s,%s,%s) ON CONFLICT DO NOTHING', (t['term_id'], t['name'], t['slug']))
    log('города', len(locs), 'метро', len(by_tax.get('metros', [])), 'сети', len(by_tax.get('chain', [])))

    # связи объект → термины
    cur.execute("""SELECT tr.object_id, tt.taxonomy, tt.term_id FROM wp_term_relationships tr
        JOIN wp_term_taxonomy tt ON tt.term_taxonomy_id=tr.term_taxonomy_id""")
    rel = {}
    for r in cur.fetchall():
        rel.setdefault(r['object_id'], {}).setdefault(r['taxonomy'], []).append(r['term_id'])

    # ---------- пользователи
    cur.execute('SELECT * FROM wp_users')
    users = cur.fetchall()
    cur.execute("SELECT user_id, meta_key, meta_value FROM wp_usermeta WHERE meta_key IN ('first_name','last_name','user_general_phone','user_general_image','moopenid_user_avatar','user_address_city','user_social_instagram','user_social_vk','user_social_facebook','wp_capabilities','favorites')")
    um = {}
    for r in cur.fetchall():
        um.setdefault(r['user_id'], {})[r['meta_key']] = r['meta_value']
    favs = []
    for u in users:
        m = um.get(u['ID'], {})
        caps = unser(m.get('wp_capabilities'))
        role = ','.join(k for k, v in caps.items() if v) if isinstance(caps, dict) else None
        socials = {k.replace('user_social_', ''): m[k] for k in ('user_social_instagram', 'user_social_vk', 'user_social_facebook') if m.get(k)}
        pc.execute('INSERT INTO site_users VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,NULL)',
                   (u['ID'], u['user_login'], (u['user_email'] or '').lower() or None, u['display_name'], m.get('first_name') or None,
                    m.get('last_name') or None, m.get('user_general_phone') or None,
                    media_path(m.get('user_general_image')) or m.get('moopenid_user_avatar') or None, m.get('user_address_city') or None,
                    json.dumps(socials, ensure_ascii=False) if socials else None, role, u['user_pass'], ts(u['user_registered'])))
        f = unser(m.get('favorites'))
        if isinstance(f, dict):
            f = list(f.values())
        if isinstance(f, list):
            favs += [(u['ID'], int(x)) for x in f if str(x).isdigit()]
    log('пользователи', len(users))

    # ---------- медиа: id вложения → путь
    cur.execute("SELECT post_id, meta_value FROM wp_postmeta WHERE meta_key='_wp_attached_file'")
    att = {r['post_id']: '/media/' + r['meta_value'] for r in cur.fetchall()}

    def thumb(meta):
        tid = meta.get('_thumbnail_id')
        return att.get(int(tid)) if tid and str(tid).isdigit() else None

    def postmeta(ids):
        if not ids:
            return {}
        cur.execute(f"SELECT post_id, meta_key, meta_value FROM wp_postmeta WHERE post_id IN ({','.join(map(str, ids))})")
        pm = {}
        for r in cur.fetchall():
            pm.setdefault(r['post_id'], {})[r['meta_key']] = r['meta_value']
        return pm

    # ---------- барбершопы
    cur.execute("SELECT * FROM wp_posts WHERE post_type='barbershop' AND post_status IN ('publish','pending','draft')")
    shops = cur.fetchall()
    pm = postmeta([s['ID'] for s in shops])
    user_ids = {u['ID'] for u in users}
    chain_ids = {t['term_id'] for t in by_tax.get('chain', [])}
    metro_ids = {t['term_id'] for t in by_tax.get('metros', [])}
    coll_ids = {t['term_id'] for t in by_tax.get('collection', [])}
    seen_slugs = set()
    n = 0
    for s in shops:
        m = pm.get(s['ID'], {})
        st = STATUS.get(s['post_status'], 'draft')
        slug = s['post_name'] or None
        if st == 'published':
            if slug in seen_slugs:
                slug = f"{slug}-{s['ID']}"
            seen_slugs.add(slug)
        svc = {}
        for k in services:
            v = (m.get('listing_' + k) or '').strip()
            if v and re.match(r'^\d+([.,]\d+)?$', v) and float(v.replace(',', '.')) > 0:
                svc[k] = int(float(v.replace(',', '.')))
        am = [k for k in amenities if (m.get('listing_' + k) or '') == 'on']
        gal = unser(m.get('listing_gallery'))
        gal = [media_path(u) for u in (gal.values() if isinstance(gal, dict) else gal or [])] if isinstance(gal, (dict, list)) else []
        gal = [g for g in gal if g]
        loc = rel.get(s['ID'], {}).get('locations', [])
        loc = max(loc, key=lambda x: loc_path(x).count('/')) if loc else None  # самый глубокий (город)
        chain = rel.get(s['ID'], {}).get('chain', [None])[0]
        lat = m.get('listing_map_location_latitude')
        lng = m.get('listing_map_location_longitude')
        try:
            lat, lng = float(lat), float(lng)
        except (TypeError, ValueError):
            lat = lng = None
        raw = {k: v for k, v in m.items() if not re.match(r'^(_edit|essb|wbounce|yt|eg_|snp_|onesignal|template_meta|_oembed|listing_(street|inside)_view)', k)}
        pc.execute("""INSERT INTO barbershops (id,slug,title,status,description,address,map_address,lat,lng,phone,email,website,booking_url,booking_url_alt,
            instagram,instagram_login,vk,facebook,youtube,video,featured,views,rating,location_id,chain_id,owner_id,amenities,services,opening_hours,
            gallery,cover_image,seo_title,seo_description,legacy_meta,created_at,updated_at)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
                   (s['ID'], slug, (m.get('listing_title') or s['post_title']).strip(), st,
                    autop(strip_shortcodes(m.get('listing_description') or s['post_content'])),
                    m.get('listing_address'), m.get('listing_map_location_address'), lat, lng,
                    m.get('listing_phone'), m.get('listing_email'), m.get('listing_website'), m.get('listing_onlineme'), m.get('listing_onlinemes'),
                    m.get('listing_instagram'), m.get('listing_instshop'), m.get('listing_vk'), m.get('listing_facebook'), m.get('listing_youtube'),
                    m.get('listing_video'), m.get('listing_featured') == 'on',
                    int(m.get('inventor_statistics_post_total_views') or 0) if str(m.get('inventor_statistics_post_total_views') or '0').isdigit() else 0,
                    float(m['inventor_reviews_post_total_rating']) if (m.get('inventor_reviews_post_total_rating') or '').replace('.', '', 1).isdigit() and float(m['inventor_reviews_post_total_rating']) > 0 else None,
                    loc, chain if chain in chain_ids else None, s['post_author'] if s['post_author'] in user_ids else None,
                    json.dumps(am), json.dumps(svc), json.dumps(hours(m.get('listing_opening_hours')), ensure_ascii=False),
                    json.dumps(gal), media_path(m.get('listing_featured_image')) or thumb(m),
                    m.get('_aioseop_title'), m.get('_aioseop_description'), json.dumps(raw, ensure_ascii=False, default=str),
                    ts(s['post_date']), ts(s['post_modified'])))
        for mid in rel.get(s['ID'], {}).get('metros', []):
            if mid in metro_ids:
                pc.execute('INSERT INTO barbershop_metro (barbershop_id, metro_id) VALUES (%s,%s)', (s['ID'], mid))
        for cid in rel.get(s['ID'], {}).get('collection', []):
            if cid in coll_ids:
                pc.execute('INSERT INTO barbershop_collections (barbershop_id, collection_id) VALUES (%s,%s)', (s['ID'], cid))
        n += 1
    log('барбершопы', n)
    shop_ids = {s['ID'] for s in shops}
    for uid, bid in favs:
        if bid in shop_ids:
            pc.execute('INSERT INTO favorites (user_id, barbershop_id) VALUES (%s,%s)', (uid, bid))
    log('избранное', len(favs))

    # ---------- отзывы и комментарии
    cur.execute("""SELECT c.*, p.post_type,
        (SELECT meta_value FROM wp_commentmeta cm WHERE cm.comment_id=c.comment_ID AND meta_key='rating') rating,
        (SELECT meta_value FROM wp_commentmeta cm WHERE cm.comment_id=c.comment_ID AND meta_key='pros') pros,
        (SELECT meta_value FROM wp_commentmeta cm WHERE cm.comment_id=c.comment_ID AND meta_key='cons') cons
        FROM wp_comments c JOIN wp_posts p ON p.ID=c.comment_post_ID WHERE c.comment_type IN ('','comment','review')""")
    rv = 0
    comments = cur.fetchall()
    post_rows = []
    for c in comments:
        st = {'1': 'published', '0': 'pending', 'spam': 'spam'}.get(str(c['comment_approved']), 'pending')
        if c['post_type'] == 'barbershop' and c['comment_post_ID'] in shop_ids:
            pc.execute('INSERT INTO reviews VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)',
                       (c['comment_ID'], c['comment_post_ID'], c['user_id'] if c['user_id'] in user_ids else None, c['comment_author'],
                        c['comment_author_email'] or None, int(c['rating']) if (c['rating'] or '').isdigit() else None,
                        c['pros'], c['cons'], c['comment_content'], st, ts(c['comment_date_gmt'])))
            rv += 1
        elif c['post_type'] == 'post':
            post_rows.append(c)
    pc.execute("""UPDATE barbershops b SET reviews_count=x.n, rating=COALESCE(b.rating, x.avg) FROM
        (SELECT barbershop_id, COUNT(*) n, ROUND(AVG(rating)::numeric,2) avg FROM reviews WHERE status='published' GROUP BY barbershop_id) x WHERE x.barbershop_id=b.id""")
    log('отзывы', rv)

    # ---------- статьи, страницы
    cur.execute("SELECT * FROM wp_posts WHERE post_type IN ('post','page') AND post_status IN ('publish','draft','pending','private')")
    pp = cur.fetchall()
    pm = postmeta([p['ID'] for p in pp])
    for p in pp:
        m = pm.get(p['ID'], {})
        st = STATUS.get(p['post_status'], 'draft')
        if not p['post_name']:
            continue
        if p['post_type'] == 'post':
            pc.execute('INSERT INTO posts VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (slug) DO NOTHING',
                       (p['ID'], p['post_name'], p['post_title'], st, autop(strip_shortcodes(p['post_content'])), p['post_excerpt'] or None,
                        thumb(m), p['post_author'], m.get('_aioseop_title'), m.get('_aioseop_description'), m.get('_aioseop_noindex') == 'on',
                        ts(p['post_date']), ts(p['post_modified'])))
            for cid in rel.get(p['ID'], {}).get('category', []):
                pc.execute('INSERT INTO post_categories (post_id, category_id) SELECT %s,%s WHERE EXISTS (SELECT 1 FROM posts WHERE id=%s)', (p['ID'], cid, p['ID']))
        else:
            pc.execute('INSERT INTO pages VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (slug) DO NOTHING',
                       (p['ID'], p['post_name'], p['post_title'], st, autop(p['post_content']), m.get('_wp_page_template'),
                        m.get('_aioseop_title'), m.get('_aioseop_description'), m.get('_aioseop_noindex') == 'on', ts(p['post_modified'])))
    for c in post_rows:
        pc.execute('INSERT INTO post_comments VALUES (%s,%s,%s,%s,%s,%s) ON CONFLICT DO NOTHING',
                   (c['comment_ID'], c['comment_post_ID'], c['comment_author'], c['comment_content'],
                    {'1': 'published'}.get(str(c['comment_approved']), 'pending'), ts(c['comment_date_gmt'])))
    log('статьи и страницы', len(pp))

    # ---------- школы, вакансии
    cur.execute("SELECT * FROM wp_posts WHERE post_type IN ('bs_school','bs_vacancy') AND post_status IN ('publish','draft','pending')")
    sv = cur.fetchall()
    pm = postmeta([p['ID'] for p in sv])
    for p in sv:
        m = pm.get(p['ID'], {})
        st = STATUS.get(p['post_status'], 'draft')
        if p['post_type'] == 'bs_school':
            city = (rel.get(p['ID'], {}).get('bs_school_city') or [None])[0]
            pc.execute('INSERT INTO schools VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (slug) DO NOTHING',
                       (p['ID'], p['post_name'], p['post_title'], st, autop(strip_shortcodes(p['post_content'])), thumb(m), city,
                        m.get('bs_school_phone'), m.get('bs_school_addres'), m.get('bs_school_site'), m.get('bs_school_trud'),
                        m.get('bs_school_zero'), m.get('bs_school_kredit'), m.get('bs_school_tools'), ts(p['post_modified'])))
        else:
            city = (rel.get(p['ID'], {}).get('bs_vacancy_city') or [None])[0]
            pc.execute('INSERT INTO vacancies VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (slug) DO NOTHING',
                       (p['ID'], p['post_name'], p['post_title'], st, autop(strip_shortcodes(p['post_content'])), thumb(m), city,
                        m.get('bs_vacancy_addres'), m.get('bs_vacancy_barbershop'), m.get('bs_vacancy_barbershop_link'),
                        m.get('bs_vacancy_gr'), m.get('bs_vacancy_zp'), m.get('bs_vacancy_phone'), ts(p['post_date'])))
    log('школы и вакансии', len(sv))

    register_directus(pc)
    pg.commit()

    # ---------- отчёт сверки
    log('\n== СВЕРКА')
    for q in ["SELECT status, COUNT(*) FROM barbershops GROUP BY status ORDER BY 1",
              "SELECT COUNT(*) FILTER (WHERE lat IS NOT NULL) coords, COUNT(*) FILTER (WHERE jsonb_array_length(gallery)>0) with_gallery, COUNT(*) FILTER (WHERE services<>'{}') with_prices, COUNT(*) FILTER (WHERE location_id IS NULL) no_city FROM barbershops WHERE status='published'",
              "SELECT 'locations', COUNT(*) FROM locations UNION ALL SELECT 'metro', COUNT(*) FROM metro UNION ALL SELECT 'chains', COUNT(*) FROM chains UNION ALL SELECT 'collections', COUNT(*) FROM collections UNION ALL SELECT 'posts', COUNT(*) FROM posts UNION ALL SELECT 'pages', COUNT(*) FROM pages UNION ALL SELECT 'schools', COUNT(*) FROM schools UNION ALL SELECT 'vacancies', COUNT(*) FROM vacancies UNION ALL SELECT 'users', COUNT(*) FROM site_users UNION ALL SELECT 'reviews', COUNT(*) FROM reviews UNION ALL SELECT 'favorites', COUNT(*) FROM favorites UNION ALL SELECT 'bs_metro', COUNT(*) FROM barbershop_metro",
              "SELECT l.path, COUNT(*) FROM barbershops b JOIN locations l ON l.id=b.location_id WHERE b.status='published' GROUP BY l.path ORDER BY 2 DESC LIMIT 8",
              "SELECT id, slug, title, services, amenities, opening_hours->0, jsonb_array_length(gallery) FROM barbershops WHERE slug='portos'"]:
        pc.execute(q)
        for row in pc.fetchall():
            log('  ', row)


def register_directus(pc):
    """Регистрирует таблицы как коллекции Directus (иконки, группы, шаблоны отображения) и связи m2o."""
    cols = [
        ('barbershops', 'content_cut', '{{title}}', 'Каталог', 'status'), ('locations', 'location_city', '{{name}}', 'Каталог', None),
        ('metro', 'subway', '{{name}}', 'Каталог', None), ('chains', 'hub', '{{name}}', 'Каталог', None),
        ('collections', 'collections_bookmark', '{{name}}', 'Каталог', None), ('features', 'tune', '{{label}}', 'Каталог', None),
        ('reviews', 'reviews', '{{author_name}} — {{rating}}', 'Каталог', 'status'),
        ('posts', 'article', '{{title}}', 'Журнал', 'status'), ('categories', 'folder', '{{name}}', 'Журнал', None),
        ('post_comments', 'comment', '{{author_name}}', 'Журнал', 'status'), ('pages', 'description', '{{title}}', 'Страницы', 'status'),
        ('schools', 'school', '{{title}}', 'Школы и вакансии', 'status'), ('school_cities', 'location_on', '{{name}}', 'Школы и вакансии', None),
        ('vacancies', 'work', '{{title}}', 'Школы и вакансии', 'status'), ('vacancy_cities', 'location_on', '{{name}}', 'Школы и вакансии', None),
        ('site_users', 'group', '{{display_name}} ({{email}})', 'Пользователи', None), ('favorites', 'favorite', '{{user_id}} → {{barbershop_id}}', 'Пользователи', None),
        ('barbershop_metro', 'link', None, None, None), ('barbershop_collections', 'link', None, None, None), ('post_categories', 'link', None, None, None),
    ]
    pc.execute("SELECT to_regclass('public.directus_collections')")
    if not pc.fetchone()[0]:
        log('directus_* не найдены — пропускаю регистрацию')
        return
    groups = sorted({c[3] for c in cols if c[3]})
    for i, g in enumerate(groups):
        pc.execute("""INSERT INTO directus_collections (collection, icon, hidden, singleton, sort, translations) VALUES (%s,'folder',false,false,%s,%s)
                      ON CONFLICT (collection) DO UPDATE SET translations=EXCLUDED.translations""",
                   ('grp_' + re.sub(r'\W+', '_', g.lower()), i, json.dumps([{'language': 'ru-RU', 'translation': g, 'singular': g, 'plural': g}], ensure_ascii=False)))
    for i, (c, icon, tmpl, grp, arch) in enumerate(cols):
        pc.execute("""INSERT INTO directus_collections (collection, icon, display_template, hidden, singleton, archive_field, archive_value, unarchive_value, sort, "group", accountability)
                      VALUES (%s,%s,%s,%s,false,%s,%s,%s,%s,%s,'all')
                      ON CONFLICT (collection) DO UPDATE SET icon=EXCLUDED.icon, display_template=EXCLUDED.display_template, "group"=EXCLUDED."group" """,
                   (c, icon, tmpl, grp is None, arch, 'archived' if arch else None, 'draft' if arch else None, i,
                    'grp_' + re.sub(r'\W+', '_', grp.lower()) if grp else None))
    names = {'barbershops': 'Барбершопы', 'locations': 'Города и страны', 'metro': 'Метро', 'chains': 'Сети', 'collections': 'Подборки',
             'features': 'Услуги и удобства', 'reviews': 'Отзывы', 'posts': 'Статьи', 'categories': 'Рубрики', 'post_comments': 'Комментарии',
             'pages': 'Страницы', 'schools': 'Школы', 'school_cities': 'Города школ', 'vacancies': 'Вакансии', 'vacancy_cities': 'Города вакансий',
             'site_users': 'Пользователи сайта', 'favorites': 'Избранное'}
    for c, n in names.items():
        pc.execute('UPDATE directus_collections SET translations=%s WHERE collection=%s',
                   (json.dumps([{'language': 'ru-RU', 'translation': n, 'singular': n, 'plural': n}], ensure_ascii=False), c))
    rels = [('barbershops', 'location_id', 'locations'), ('barbershops', 'chain_id', 'chains'), ('barbershops', 'owner_id', 'site_users'),
            ('locations', 'parent_id', 'locations'), ('reviews', 'barbershop_id', 'barbershops'), ('reviews', 'user_id', 'site_users'),
            ('favorites', 'user_id', 'site_users'), ('favorites', 'barbershop_id', 'barbershops'),
            ('barbershop_metro', 'barbershop_id', 'barbershops'), ('barbershop_metro', 'metro_id', 'metro'),
            ('barbershop_collections', 'barbershop_id', 'barbershops'), ('barbershop_collections', 'collection_id', 'collections'),
            ('post_categories', 'post_id', 'posts'), ('post_categories', 'category_id', 'categories'),
            ('post_comments', 'post_id', 'posts'), ('schools', 'city_id', 'school_cities'), ('vacancies', 'city_id', 'vacancy_cities')]
    pc.execute("DELETE FROM directus_relations WHERE many_collection = ANY(%s)", ([r[0] for r in rels],))
    for many, field, one in rels:
        pc.execute('INSERT INTO directus_relations (many_collection, many_field, one_collection) VALUES (%s,%s,%s)', (many, field, one))
    # поля-связи как выпадающие списки
    pc.execute("DELETE FROM directus_fields WHERE collection = ANY(%s)", ([c[0] for c in cols],))
    for many, field, one in rels:
        pc.execute("""INSERT INTO directus_fields (collection, field, special, interface, display, hidden, readonly, required)
                      VALUES (%s,%s,'m2o','select-dropdown-m2o','related-values',false,false,false)""", (many, field))
    for coll in ('barbershops', 'posts', 'pages', 'schools', 'vacancies', 'reviews', 'post_comments'):
        pc.execute("""INSERT INTO directus_fields (collection, field, interface, display, options, display_options, hidden, readonly, required)
                      VALUES (%s,'status','select-dropdown','labels',%s,%s,false,false,false)""",
                   (coll, json.dumps({'choices': [{'text': 'Опубликовано', 'value': 'published'}, {'text': 'На проверке', 'value': 'pending'},
                                                  {'text': 'Черновик', 'value': 'draft'}, {'text': 'Архив', 'value': 'archived'}]}),
                    json.dumps({'choices': [{'text': 'Опубликовано', 'value': 'published', 'background': '#2ECDA7'},
                                            {'text': 'На проверке', 'value': 'pending', 'background': '#FFA439'},
                                            {'text': 'Черновик', 'value': 'draft', 'background': '#A2B5CD'}]})))
    for coll, field in (('barbershops', 'description'), ('posts', 'content'), ('pages', 'content'), ('schools', 'content'), ('vacancies', 'content')):
        pc.execute("""INSERT INTO directus_fields (collection, field, interface, hidden, readonly, required) VALUES (%s,%s,'input-rich-text-html',false,false,false)""", (coll, field))
    for coll, field in (('barbershops', 'amenities'), ('barbershops', 'services'), ('barbershops', 'opening_hours'), ('barbershops', 'gallery'), ('barbershops', 'legacy_meta')):
        pc.execute("""INSERT INTO directus_fields (collection, field, special, interface, hidden, readonly, required) VALUES (%s,%s,'cast-json','input-code',%s,false,false)""",
                   (coll, field, field == 'legacy_meta'))
    pc.execute("UPDATE directus_fields SET hidden=true WHERE collection='site_users' AND field='wp_pass_hash'")
    pc.execute("""INSERT INTO directus_fields (collection, field, hidden, readonly, required) VALUES ('site_users','wp_pass_hash',true,true,false)""")
    log('Directus: коллекции и связи зарегистрированы')


if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        import traceback
        traceback.print_exc()
        sys.exit(1)
