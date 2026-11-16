// Проверка SEO собранных страниц: один H1, title, description, canonical, валидный JSON-LD. Сборка падает при ошибке.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
const root = 'dist/client';
const files = [];
const walk = (d) => readdirSync(d).forEach((f) => { const p = join(d, f); statSync(p).isDirectory() ? walk(p) : p.endsWith('.html') && files.push(p); });
walk(root);
let errors = 0;
for (const f of files) {
  const h = readFileSync(f, 'utf8');
  const fail = (m) => { errors++; console.error(`✗ ${f}: ${m}`); };
  if ((h.match(/<h1[\s>]/g) || []).length !== 1) fail('должен быть ровно один H1');
  if (!/<title>[^<]{5,}<\/title>/.test(h)) fail('нет title');
  if (!/<meta name="description" content="[^"]{20,}"/.test(h)) fail('нет description');
  if (!/<link rel="canonical"/.test(h)) fail('нет canonical');
  for (const m of h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) { try { JSON.parse(m[1]); } catch { fail('битый JSON-LD'); } }
}
console.log(`${files.length} страниц проверено, ошибок: ${errors}`);
process.exit(errors ? 1 : 0);
