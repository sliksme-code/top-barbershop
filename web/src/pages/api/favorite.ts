import type { APIRoute } from 'astro';
import { sql } from '../../lib/db';
import { sameOrigin } from '../../lib/forms';
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return Response.json({ login: true }, { status: 401 });
  if (!sameOrigin(request)) return Response.json({ error: 'origin' }, { status: 403 });
  const { id } = await request.json().catch(() => ({}));
  const sid = Number(id);
  if (!sid) return Response.json({ error: 'id' }, { status: 400 });
  const del = await sql`delete from favorites where user_id = ${user.id} and barbershop_id = ${sid} returning id`;
  if (!del.length) await sql`insert into favorites (user_id, barbershop_id) values (${user.id}, ${sid}) on conflict do nothing`;
  return Response.json({ fav: !del.length });
};
