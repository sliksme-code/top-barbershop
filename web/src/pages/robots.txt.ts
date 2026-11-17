import type { APIRoute } from 'astro';
import { isProdHost } from '../data/site';
export const GET: APIRoute = ({ url }) => {
  const body = isProdHost(url)
    ? ['User-agent: *', 'Disallow: /login/', 'Disallow: /logout/', 'Disallow: /register/', 'Disallow: /my/', 'Disallow: /my-favorites/', 'Disallow: /edit/', 'Disallow: /add/', 'Disallow: /remove/', 'Disallow: /change-password/', 'Disallow: /search/', 'Disallow: /api/', 'Disallow: /*?', '', 'Sitemap: https://top-barbershop.com/sitemap.xml'].join('\n')
    : 'User-agent: *\nDisallow: /\n';
  return new Response(body + '\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
