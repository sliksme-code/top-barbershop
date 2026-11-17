import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { sql } from './db';
import { str } from './forms';

export const UPLOAD_ROOT = process.env.UPLOAD_ROOT || '/data/uploads';
const MAX_PHOTOS = 15, MAX_SIZE = 10 * 1024 * 1024;

export async function formRefs() {
  const [locations, metros, features] = await Promise.all([
    sql`select l.id, l.name, l.path, p.name as country from locations l left join locations p on p.id = l.parent_id order by p.name nulls first, l.name`,
    sql`select id, name, city_code from metro order by name`,
    sql`select key, label, kind from features order by kind, sort`,
  ]);
  return { locations, metros, features };
}

const TR: Record<string, string> = { а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'j',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'shh',ъ:'',ы:'y',ь:'',э:'e',ю:'yu',я:'ya' };
export const slugify = (s: string) => s.toLowerCase().split('').map((c) => TR[c] ?? c).join('').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'barbershop';
async function uniqueSlug(base: string, exceptId?: number) {
  let s = base, i = 2;
  while ((await sql`select 1 from barbershops where slug = ${s} ${exceptId ? sql`and id <> ${exceptId}` : sql``}`).length) s = `${base}-${i++}`;
  return s;
}

const imgType = (b: Buffer) =>
  b[0] === 0xff && b[1] === 0xd8 ? 'jpg' : b.slice(0, 8).toString('hex') === '89504e470d0a1a0a' ? 'png' : b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' ? 'webp' : null;

/** Сохраняет загруженные фото в uploads/ГГГГ/ММ/ — тот же формат путей, что у старого сайта (/media/...). */
async function savePhotos(form: FormData): Promise<{ paths: string[]; errors: string[] }> {
  const files = form.getAll('photos').filter((f): f is File => f instanceof File && f.size > 0).slice(0, MAX_PHOTOS);
  const d = new Date(), ym = `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}`;
  const paths: string[] = [], errors: string[] = [];
  if (files.length) await mkdir(`${UPLOAD_ROOT}/${ym}`, { recursive: true });
  for (const f of files) {
    if (f.size > MAX_SIZE) { errors.push(`«${f.name}» больше 10 МБ`); continue; }
    const buf = Buffer.from(await f.arrayBuffer());
    const ext = imgType(buf);
    if (!ext) { errors.push(`«${f.name}» — не JPG, PNG или WebP`); continue; }
    const name = `${randomBytes(6).toString('hex')}.${ext}`;
    await writeFile(`${UPLOAD_ROOT}/${ym}/${name}`, buf);
    paths.push(`/media/${ym}/${name}`);
  }
  return { paths, errors };
}

const num = (v: string) => { const n = Number(v.replace(/[^\d.]/g, '')); return Number.isFinite(n) && n > 0 ? Math.round(n) : null; };
const url = (v: string) => (!v ? null : /^https?:\/\//i.test(v) ? v : 'https://' + v);
const paras = (t: string) => t.split(/\n{2,}|\r\n\r\n/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${p.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/\n/g, '<br>')}</p>`).join('\n');

export async function readShopForm(form: FormData, features: any[], existing?: any) {
  const errors: string[] = [];
  const title = str(form, 'title', 120);
  const location_id = Number(form.get('location_id')) || null;
  const address = str(form, 'address', 200);
  if (title.length < 2) errors.push('Укажите название барбершопа');
  if (!location_id) errors.push('Выберите город');
  if (address.length < 3) errors.push('Укажите адрес');
  const services: Record<string, number> = {};
  const amenities: string[] = [];
  for (const f of features) {
    if (f.kind === 'service') { const v = num(str(form, 'svc_' + f.key, 12)); if (v) services[f.key] = v; }
    if (f.kind === 'amenity' && form.get('am_' + f.key)) amenities.push(f.key);
  }
  const hours = [1, 2, 3, 4, 5, 6, 7].flatMap((d) => {
    if (form.get('off_' + d)) return [];
    const from = str(form, 'from_' + d, 5), to = str(form, 'to_' + d, 5);
    return /^\d{1,2}:\d{2}$/.test(from) && /^\d{1,2}:\d{2}$/.test(to) ? [{ day: d, from, to, note: null }] : [];
  });
  const lat = Number(form.get('lat')), lng = Number(form.get('lng'));
  const metroIds = form.getAll('metro').map(Number).filter(Boolean).slice(0, 5);
  const { paths, errors: perr } = await savePhotos(form);
  errors.push(...perr);
  const keep = form.getAll('keep_photo').map(String).filter((p) => (existing?.gallery || []).includes(p) || p === existing?.cover_image);
  const gallery = [...keep, ...paths];
  const cover = form.get('cover') && gallery.includes(String(form.get('cover'))) ? String(form.get('cover')) : gallery[0] || null;
  const data = {
    title, location_id, address, map_address: address,
    lat: Number.isFinite(lat) && lat ? lat : null, lng: Number.isFinite(lng) && lng ? lng : null,
    phone: str(form, 'phone', 40) || null, email: str(form, 'email', 120) || null,
    website: url(str(form, 'website', 200)), booking_url: url(str(form, 'booking_url', 300)),
    instagram: url(str(form, 'instagram', 200)), vk: url(str(form, 'vk', 200)),
    description: paras(str(form, 'description', 6000)) || null,
    services, amenities, opening_hours: hours.length ? hours : null,
    gallery: gallery.filter((g) => g !== cover), cover_image: cover,
  };
  return { data, metroIds, errors };
}

export async function saveShop(data: any, metroIds: number[], userId: number, id?: number) {
  const json = (v: any) => sql.json(v);
  let shopId = id;
  if (id) {
    await sql`update barbershops set title=${data.title}, location_id=${data.location_id}, address=${data.address}, map_address=${data.map_address}, lat=${data.lat}, lng=${data.lng},
      phone=${data.phone}, email=${data.email}, website=${data.website}, booking_url=${data.booking_url}, instagram=${data.instagram}, vk=${data.vk},
      description=${data.description}, services=${json(data.services)}, amenities=${json(data.amenities)}, opening_hours=${data.opening_hours ? json(data.opening_hours) : null},
      gallery=${json(data.gallery)}, cover_image=${data.cover_image}, updated_at=now() where id=${id}`;
  } else {
    const slug = await uniqueSlug(slugify(data.title));
    const [r] = await sql`insert into barbershops (slug, title, status, location_id, address, map_address, lat, lng, phone, email, website, booking_url, instagram, vk, description,
      services, amenities, opening_hours, gallery, cover_image, owner_id, submitted_by, created_at, updated_at)
      values (${slug}, ${data.title}, 'pending', ${data.location_id}, ${data.address}, ${data.map_address}, ${data.lat}, ${data.lng}, ${data.phone}, ${data.email}, ${data.website},
      ${data.booking_url}, ${data.instagram}, ${data.vk}, ${data.description}, ${json(data.services)}, ${json(data.amenities)}, ${data.opening_hours ? json(data.opening_hours) : null},
      ${json(data.gallery)}, ${data.cover_image}, ${userId}, ${userId}, now(), now()) returning id`;
    shopId = r.id;
  }
  await sql`delete from barbershop_metro where barbershop_id = ${shopId!}`;
  for (const m of metroIds) await sql`insert into barbershop_metro (barbershop_id, metro_id) values (${shopId!}, ${m})`;
  return shopId!;
}

export const canEdit = (user: any, shop: any) => user && (shop.owner_id === user.id || shop.submitted_by === user.id || ['administrator', 'editor'].includes(user.role));
