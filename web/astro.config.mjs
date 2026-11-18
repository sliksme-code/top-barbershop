import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// Канонический домен всегда боевой (тестовый new.* закрыт noindex по имени хоста)
const SITE = 'https://top-barbershop.com';

export default defineConfig({
  security: { checkOrigin: false },
  site: SITE,
  output: 'server',            // каталог читается из Postgres на лету
  adapter: node({ mode: 'standalone' }),
  trailingSlash: 'always',     // старые URL WordPress были со слешем
  build: { format: 'directory' },
});
