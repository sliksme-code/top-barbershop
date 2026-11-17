import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

const SITE = process.env.SITE_URL || 'https://top-barbershop.com';

export default defineConfig({
  security: { checkOrigin: false },
  site: SITE,
  output: 'server',            // каталог читается из Postgres на лету
  adapter: node({ mode: 'standalone' }),
  trailingSlash: 'always',     // старые URL WordPress были со слешем
  build: { format: 'directory' },
});
