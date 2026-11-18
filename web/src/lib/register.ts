import type { AstroCookies } from 'astro';
import { sql } from './db';
import { hashPassword, createSession } from './auth';
import { rateLimited, ipOf, sameOrigin, str, validEmail, captchaOk } from './forms';

/** Регистрация: возвращает текст ошибки или null (и создаёт сессию). */
export async function registerUser(f: FormData, req: Request, cookies: AstroCookies) {
  const name = str(f, 'name', 80), email = str(f, 'email', 120).toLowerCase(), pw = str(f, 'password', 200);
  if (!sameOrigin(req) || str(f, 'website_url')) return 'Обновите страницу и попробуйте снова.';
  if (rateLimited('reg:' + ipOf(req), 5, 3600)) return 'Слишком много регистраций с вашего адреса. Попробуйте позже.';
  if (!validEmail(email)) return 'Проверьте e-mail.';
  if (pw.length < 8) return 'Пароль — не короче 8 символов.';
  if (!f.get('agree')) return 'Нужно согласие с правилами сервиса.';
  if (!(await captchaOk(f, req))) return 'Подтвердите, что вы не робот.';
  if ((await sql`select 1 from site_users where lower(email) = ${email}`).length) return 'Этот e-mail уже зарегистрирован. Войдите или восстановите пароль.';
  const [u] = await sql`insert into site_users (login, email, display_name, role, pass_hash, registered_at, phone) values (${email}, ${email}, ${name || null}, 'author', ${hashPassword(pw)}, now(), ${str(f, 'phone', 40) || null}) returning id`;
  await createSession(cookies, u.id, req);
  return null;
}
