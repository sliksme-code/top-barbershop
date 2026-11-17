import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { AstroCookies } from 'astro';
import { sql } from './db';

// ---- пароли ----
// Старые пароли WordPress (phpass, $P$...) проверяем как есть; после успешного входа сохраняем новый хеш (scrypt).
const itoa64 = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
function encode64(input: Buffer, count: number) {
  let out = '', i = 0;
  do {
    let value = input[i++];
    out += itoa64[value & 0x3f];
    if (i < count) value |= input[i] << 8;
    out += itoa64[(value >> 6) & 0x3f];
    if (i++ >= count) break;
    if (i < count) value |= input[i] << 16;
    out += itoa64[(value >> 12) & 0x3f];
    if (i++ >= count) break;
    out += itoa64[(value >> 18) & 0x3f];
  } while (i < count);
  return out;
}
export function phpassCheck(password: string, stored: string): boolean {
  if (!stored) return false;
  if (/^[a-f0-9]{32}$/i.test(stored)) return safeEq(createHash('md5').update(password).digest('hex'), stored.toLowerCase());
  if (!stored.startsWith('$P$') && !stored.startsWith('$H$')) return false;
  const countLog2 = itoa64.indexOf(stored[3]);
  if (countLog2 < 7 || countLog2 > 30) return false;
  const salt = stored.slice(4, 12);
  if (salt.length !== 8) return false;
  const pw = Buffer.from(password, 'utf8');
  let hash = createHash('md5').update(Buffer.concat([Buffer.from(salt, 'latin1'), pw])).digest();
  for (let n = 1 << countLog2; n > 0; n--) hash = createHash('md5').update(Buffer.concat([hash, pw])).digest();
  return safeEq(stored.slice(0, 12) + encode64(hash, 16), stored);
}
const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function hashPassword(password: string) {
  const salt = randomBytes(16);
  const h = scryptSync(password, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('base64')}$${h.toString('base64')}`;
}
function scryptCheck(password: string, stored: string) {
  const [, s, h] = stored.split('$');
  if (!s || !h) return false;
  const calc = scryptSync(password, Buffer.from(s, 'base64'), 32, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(calc, Buffer.from(h, 'base64'));
}

export type User = { id: number; email: string; display_name: string | null; login: string | null; role: string | null; phone: string | null };

export async function verifyLogin(loginOrEmail: string, password: string): Promise<User | null> {
  const v = loginOrEmail.trim().toLowerCase();
  if (!v || !password) return null;
  const [u] = await sql`select id, email, display_name, login, role, phone, pass_hash, wp_pass_hash from site_users where lower(email) = ${v} or lower(login) = ${v} order by (lower(email) = ${v}) desc limit 1`;
  if (!u) return null;
  let ok = false;
  if (u.pass_hash) ok = scryptCheck(password, u.pass_hash);
  else if (u.wp_pass_hash) {
    ok = phpassCheck(password, u.wp_pass_hash);
    if (ok) await sql`update site_users set pass_hash = ${hashPassword(password)} where id = ${u.id}`;
  }
  if (!ok) return null;
  await sql`update site_users set last_login_at = now() where id = ${u.id}`;
  return { id: u.id, email: u.email, display_name: u.display_name, login: u.login, role: u.role, phone: u.phone };
}

// ---- сессии ----
export const COOKIE = 'tb_s';
const DAYS = 60;
export async function createSession(cookies: AstroCookies, userId: number, req: Request) {
  const id = randomBytes(32).toString('base64url');
  await sql`insert into sessions (id, user_id, expires_at, ip, ua) values (${sha(id)}, ${userId}, now() + ${DAYS + ' days'}::interval, ${req.headers.get('x-forwarded-for')?.split(',')[0] ?? null}, ${(req.headers.get('user-agent') || '').slice(0, 200)})`;
  cookies.set(COOKIE, id, { path: '/', httpOnly: true, secure: true, sameSite: 'lax', maxAge: DAYS * 86400 });
}
export async function getSessionUser(cookies: AstroCookies): Promise<User | null> {
  const id = cookies.get(COOKIE)?.value;
  if (!id) return null;
  const [u] = await sql`select u.id, u.email, u.display_name, u.login, u.role, u.phone from sessions s join site_users u on u.id = s.user_id where s.id = ${sha(id)} and s.expires_at > now()`;
  return (u as User) || null;
}
export async function destroySession(cookies: AstroCookies) {
  const id = cookies.get(COOKIE)?.value;
  if (id) await sql`delete from sessions where id = ${sha(id)}`;
  cookies.delete(COOKIE, { path: '/' });
}
export const sha = (s: string) => createHash('sha256').update(s).digest('hex');
export const token = () => randomBytes(32).toString('base64url');
