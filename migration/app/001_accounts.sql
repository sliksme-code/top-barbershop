-- Личный кабинет: пароли, сессии, сброс пароля, заявки на владение, автонумерация, пересчёт рейтинга.
-- Идемпотентно: можно запускать повторно.
alter table site_users add column if not exists pass_hash text;
alter table site_users add column if not exists created_at timestamptz default now();
alter table site_users add column if not exists last_login_at timestamptz;
create unique index if not exists site_users_email_lower on site_users (lower(email)) where email is not null and email <> '' and id > 0;

do $$ declare t text; begin
  foreach t in array array['site_users','barbershops','reviews'] loop
    execute format('create sequence if not exists %I_id_seq owned by %I.id', t, t);
    execute format('alter table %I alter column id set default nextval(%L)', t, t || '_id_seq');
    execute format('select setval(%L, greatest((select coalesce(max(id),0) from %I), 1) + 1000, false)', t || '_id_seq', t);
  end loop;
end $$;

create table if not exists sessions (
  id text primary key, user_id int not null references site_users(id) on delete cascade,
  created_at timestamptz default now(), expires_at timestamptz not null, ip text, ua text);
create index if not exists sessions_user on sessions(user_id);

create table if not exists password_resets (
  token text primary key, user_id int not null references site_users(id) on delete cascade,
  expires_at timestamptz not null, used bool default false);

create table if not exists claims (
  id serial primary key, barbershop_id int references barbershops(id) on delete cascade, user_id int references site_users(id) on delete cascade,
  name text, phone text, message text, status text default 'pending', created_at timestamptz default now());

alter table reviews alter column created_at set default now();
alter table reviews add column if not exists user_ip text;
alter table barbershops alter column created_at set default now();
alter table barbershops add column if not exists submitted_by int references site_users(id);
create unique index if not exists favorites_uniq on favorites(user_id, barbershop_id);

-- рейтинг и число отзывов считаются из опубликованных отзывов
create or replace function tb_recalc_rating() returns trigger language plpgsql as $$
declare bid int := coalesce(new.barbershop_id, old.barbershop_id);
begin
  update barbershops b set
    rating = (select round(avg(rating)::numeric, 2) from reviews r where r.barbershop_id = bid and r.status = 'published' and r.rating between 1 and 5),
    reviews_count = (select count(*) from reviews r where r.barbershop_id = bid and r.status = 'published')
  where b.id = bid;
  if tg_op = 'UPDATE' and old.barbershop_id is distinct from new.barbershop_id then
    update barbershops b set
      rating = (select round(avg(rating)::numeric, 2) from reviews r where r.barbershop_id = old.barbershop_id and r.status = 'published' and r.rating between 1 and 5),
      reviews_count = (select count(*) from reviews r where r.barbershop_id = old.barbershop_id and r.status = 'published')
    where b.id = old.barbershop_id;
  end if;
  return null;
end $$;
drop trigger if exists reviews_rating on reviews;
create trigger reviews_rating after insert or update or delete on reviews for each row execute function tb_recalc_rating();

-- заявки на владение — в админке Directus
insert into directus_collections (collection, icon, note, "group", sort, archive_field, archive_value, unarchive_value)
select 'claims', 'verified_user', 'Заявки «Это мой барбершоп»', 'grp_каталог', 20, 'status', 'rejected', 'pending'
where exists (select 1 from information_schema.tables where table_name = 'directus_collections')
  and not exists (select 1 from directus_collections where collection = 'claims');
insert into directus_fields (collection, field, interface, options, display, special, readonly, hidden, sort, width, note)
select 'claims', 'status', 'select-dropdown', '{"choices":[{"text":"Новая","value":"pending"},{"text":"Одобрена","value":"approved"},{"text":"Отклонена","value":"rejected"}]}', 'labels', null, false, false, 1, 'half', 'Одобрить = назначить пользователя владельцем (поле owner_id у барбершопа)'
where exists (select 1 from information_schema.tables where table_name = 'directus_fields')
  and not exists (select 1 from directus_fields where collection = 'claims' and field = 'status');

-- одобренная заявка сразу делает пользователя владельцем
create or replace function tb_claim_approved() returns trigger language plpgsql as $$
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    update barbershops set owner_id = new.user_id where id = new.barbershop_id;
  end if;
  return new;
end $$;
drop trigger if exists claims_approved on claims;
create trigger claims_approved after update on claims for each row execute function tb_claim_approved();
