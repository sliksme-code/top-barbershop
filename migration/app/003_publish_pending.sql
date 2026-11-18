-- Разовая операция 18.11.2026: барбершопы «на модерации» (наследие старого сайта) → опубликованы.
-- 1) убираем пометки модератора в названиях «(добавьте фото…)», «(без фото)»;
-- 2) у 392 записей нет адреса (slug) — генерируем транслитом из названия, с уникальностью;
-- 3) публикуем.
create or replace function tb_slugify(t text) returns text language sql immutable as $$
  select coalesce(nullif(left(btrim(regexp_replace(regexp_replace(
    replace(replace(replace(replace(replace(replace(replace(
      translate(lower(t), 'абвгдеёзийклмнопрстуфхцыэ', 'abvgdeezijklmnoprstufhcye'),
      'ж', 'zh'), 'ч', 'ch'), 'ш', 'sh'), 'щ', 'shh'), 'ю', 'yu'), 'я', 'ya'), 'ъ', ''),
    'ь', '', 'g'), '[^a-z0-9]+', '-', 'g'), '-'), 60), ''), 'barbershop');
$$;

update barbershops set title = btrim(regexp_replace(title, '\s*\((добав|без |мало |нет |нужно|заполн|не хватает)[^)]*\)', '', 'gi'))
where status = 'pending' and created_at < '2026-11-17';

do $$
declare r record; base text; s text; n int;
begin
  for r in select id, title, slug from barbershops where status = 'pending' and created_at < '2026-11-17' order by id loop
    base := coalesce(nullif(r.slug, ''), tb_slugify(r.title));
    s := base; n := 2;
    while exists (select 1 from barbershops where slug = s and id <> r.id and (status = 'published' or slug is not null and id < r.id and status = 'pending')) loop
      s := base || '-' || n; n := n + 1;
    end loop;
    update barbershops set slug = s, status = 'published', updated_at = now() where id = r.id;
  end loop;
end $$;
