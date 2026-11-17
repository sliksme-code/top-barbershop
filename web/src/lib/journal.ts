import { sql } from './db';
export const PPP = 12;
export async function listPosts(where: any, page: number) {
  const [{ n }] = await sql`select count(*)::int n from posts p where p.status='published' and ${where}`;
  const posts = await sql`select p.slug, p.title, p.cover_image, p.excerpt, left(p.content, 600) as content, p.published_at from posts p
    where p.status='published' and ${where} order by p.published_at desc limit ${PPP} offset ${(page - 1) * PPP}`;
  return { posts, pages: Math.max(1, Math.ceil(n / PPP)) };
}
export const usedCats = () => sql`select c.slug, c.name from categories c where c.slug <> 'bez-rubriki' and exists (select 1 from post_categories pc join posts p on p.id = pc.post_id and p.status='published' where pc.category_id = c.id) order by c.name`;
