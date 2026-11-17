import type { APIRoute } from 'astro';
import { sql } from '../../lib/db';
import { sameOrigin, rateLimited, ipOf, captchaOk, str } from '../../lib/forms';
import { sendMail, ADMIN_EMAIL } from '../../lib/mail';
// Отзыв: только для вошедших, по одному на барбершоп, публикуется после модерации.
export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const f = await request.formData();
  const id = Number(f.get('id')) || 0;
  const [s] = id ? await sql`select id, slug, title from barbershops where id = ${id} and status = 'published'` : [];
  if (!s) return new Response('Not found', { status: 404 });
  const back = (q: string) => redirect(`/place/${s.slug}/?review=${q}#reviews`, 303);
  const user = locals.user;
  if (!user) return redirect(`/login/?next=${encodeURIComponent(`/place/${s.slug}/#reviews`)}`, 303);
  if (!sameOrigin(request) || str(f, 'website_url')) return back('error');
  if (rateLimited('rv:' + ipOf(request), 6, 3600)) return back('limit');
  const rating = Math.min(5, Math.max(1, Number(f.get('rating')) || 0));
  const content = str(f, 'content', 3000), pros = str(f, 'pros', 1000), cons = str(f, 'cons', 1000);
  if (!rating || (content + pros + cons).length < 20) return back('short');
  if (!(await captchaOk(f, request))) return back('captcha');
  if ((await sql`select 1 from reviews where barbershop_id = ${id} and user_id = ${user.id}`).length) return back('dup');
  await sql`insert into reviews (barbershop_id, user_id, author_name, author_email, rating, pros, cons, content, status, user_ip)
    values (${id}, ${user.id}, ${user.display_name || user.email.split('@')[0]}, ${user.email}, ${rating}, ${pros || null}, ${cons || null}, ${content || null}, 'pending', ${ipOf(request)})`;
  if (ADMIN_EMAIL) sendMail(ADMIN_EMAIL, `Новый отзыв на модерации: ${s.title}`, `Оценка ${rating}/5 от ${user.email}\n\n${[pros, cons, content].filter(Boolean).join('\n\n')}\n\nМодерация: https://cms.top-barbershop.com/admin/content/reviews`);
  return back('ok');
};
