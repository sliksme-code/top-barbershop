import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import sitemap from '@astrojs/sitemap';

const SITE = process.env.SITE_URL || 'https://top-barbershop.com';

export default defineConfig({
  site: SITE,
  output: 'static',            // страницы собираются заранее; SSR — только там, где prerender = false
  adapter: node({ mode: 'standalone' }),
  trailingSlash: 'always',     // старые URL WordPress были со слешем
  build: { format: 'directory' },
  integrations: [
    sitemap({
      filter: (p) => !/\/(404|login|logout|my-favorites|edit|add|remove|change-password|kabinet|spasibo)\//.test(p),
    }),
  ],
});
