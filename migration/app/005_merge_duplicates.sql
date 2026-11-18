-- Точные дубли карточек (то же название, адрес и город): оставляем самую полную, остальные → status 'merged' + 301.
alter table barbershops add column if not exists merged_into int references barbershops(id);
with g as (
  select id, slug,
    first_value(id) over w as keeper,
    row_number() over w as rn
  from barbershops
  where status = 'published'
  window w as (partition by lower(regexp_replace(title, '[^[:alnum:]]', '', 'g')), lower(regexp_replace(coalesce(address, ''), '[^[:alnum:]]', '', 'g')), location_id
               order by coalesce(jsonb_array_length(gallery), 0) desc, (pro_until > now()) desc nulls last, length(coalesce(description, '')) desc, created_at)
), d as (select id, keeper from g where rn > 1 and exists (select 1 from g g2 where g2.keeper = g.keeper and g2.rn = 1))
update barbershops b set status = 'merged', merged_into = d.keeper, updated_at = now() from d where b.id = d.id;
-- отзывы и избранное переносим на основную карточку
update reviews r set barbershop_id = b.merged_into from barbershops b where b.id = r.barbershop_id and b.status = 'merged';
insert into favorites (user_id, barbershop_id) select f.user_id, b.merged_into from favorites f join barbershops b on b.id = f.barbershop_id and b.status = 'merged' on conflict do nothing;
-- владелец дубля получает доступ к основной карточке, если у той владельца нет
update barbershops k set owner_id = b.owner_id from barbershops b where b.merged_into = k.id and b.status = 'merged' and k.owner_id is null and b.owner_id is not null;
