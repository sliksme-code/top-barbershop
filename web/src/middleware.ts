import { defineMiddleware } from 'astro:middleware';
import { getSessionUser } from './lib/auth';
export const onRequest = defineMiddleware(async (ctx, next) => {
  (ctx.locals as any).user = ctx.cookies.has('tb_s') ? await getSessionUser(ctx.cookies).catch(() => null) : null;
  const res = await next();
  if ((ctx.locals as any).user) res.headers.set('Cache-Control', 'private, no-store');
  return res;
});
