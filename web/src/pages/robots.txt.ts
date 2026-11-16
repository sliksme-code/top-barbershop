import type { APIRoute } from 'astro';
import { isProduction } from '../data/site';

export const GET: APIRoute = ({ site }) => {
  const body = isProduction
    ? [
        'User-agent: *',
        'Disallow: /login/', 'Disallow: /logout/', 'Disallow: /my-favorites/', 'Disallow: /edit/',
        'Disallow: /add/', 'Disallow: /remove/', 'Disallow: /change-password/', 'Disallow: /kabinet/',
        'Disallow: /api/', 'Disallow: /*?*sort-by=', '',
        `Sitemap: ${new URL('sitemap-index.xml', site)}`,
      ].join('\n')
    : 'User-agent: *\nDisallow: /\n';
  return new Response(body + '\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
