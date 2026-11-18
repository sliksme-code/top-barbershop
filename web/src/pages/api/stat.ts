import type { APIRoute } from 'astro';
import { BOT, track } from '../../lib/stats';
import { ipOf, rateLimited } from '../../lib/forms';

// Приём событий статистики (navigator.sendBeacon). Тело: {"e":"imp|view|booking|phone|site|social","ids":[1,2,3]}
export const POST: APIRoute = async ({ request }) => {
  const ua = request.headers.get('user-agent') || '';
  const ip = ipOf(request);
  if (!ua || BOT.test(ua) || rateLimited('stat:' + ip, 300, 600)) return new Response(null, { status: 204 });
  const j: any = await request.json().catch(() => null);
  const ids = Array.isArray(j?.ids) ? [...new Set(j.ids.map(Number).filter((n: number) => Number.isInteger(n) && n > 0))].slice(0, 100) as number[] : [];
  if (ids.length && typeof j?.e === 'string') track(j.e, ids, ip + '|' + ua);
  return new Response(null, { status: 204 });
};
