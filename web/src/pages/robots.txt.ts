import type { APIRoute } from 'astro';
import { isProdHost } from '../data/site';
export const GET: APIRoute = ({ request }) => {
  const body = isProdHost(request)
    ? ['User-agent: *', 'Disallow: /login/', 'Disallow: /logout/', 'Disallow: /register/', 'Disallow: /my/', 'Disallow: /my-favorites/', 'Disallow: /edit/', 'Disallow: /remove/', 'Disallow: /change-password/', 'Disallow: /lost-password/', 'Disallow: /reset-password/', 'Disallow: /billing/', 'Disallow: /claim/', 'Disallow: /search/', 'Disallow: /api/', 'Disallow: /*?', '', 'Clean-param: utm_source&utm_medium&utm_campaign&utm_content&utm_term&yclid&gclid&fbclid&ysclid&_openstat&from&etext', '', 'Sitemap: https://top-barbershop.com/sitemap.xml'].join('\n')
    : 'User-agent: *\nDisallow: /\n';
  return new Response(body + '\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
