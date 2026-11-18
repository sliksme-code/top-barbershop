-- Тарифы: FREE / PRO (1990 ₽/мес за барбершоп) и приоритет в городе (3000 ₽/неделя, 3 места на город).
alter table barbershops add column if not exists pro_until timestamptz;

create table if not exists orders (
  id serial primary key,
  user_id int references site_users(id) on delete set null,
  barbershop_id int references barbershops(id) on delete cascade,
  kind text not null check (kind in ('pro', 'priority')),
  months int,                 -- для PRO
  week_start date,            -- для приоритета (понедельник)
  amount int not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled')),
  payment_id text,            -- ID платежа ЮKassa
  comment text,
  created_at timestamptz default now(),
  paid_at timestamptz);
create index if not exists orders_shop on orders(barbershop_id);

create table if not exists priority_slots (
  id serial primary key,
  location_id int not null references locations(id),
  week_start date not null,
  barbershop_id int not null references barbershops(id) on delete cascade,
  order_id int references orders(id) on delete cascade,
  status text not null default 'reserved' check (status in ('reserved', 'paid', 'cancelled')),
  created_at timestamptz default now(),
  unique (barbershop_id, week_start));
create index if not exists priority_slots_loc on priority_slots(location_id, week_start);

-- Занято = оплачено или забронировано не позже 48 часов назад (неоплаченная бронь сгорает).
create or replace view priority_busy as
  select location_id, week_start, count(*)::int as taken from priority_slots
  where status = 'paid' or (status = 'reserved' and created_at > now() - interval '48 hours')
  group by 1, 2;

-- Оплата заказа (вручную в админке или вебхуком ЮKassa) включает услугу.
create or replace function tb_order_paid() returns trigger language plpgsql as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    new.paid_at := coalesce(new.paid_at, now());
    if new.kind = 'pro' then
      update barbershops set pro_until = greatest(coalesce(pro_until, now()), now()) + make_interval(months => coalesce(new.months, 1)) where id = new.barbershop_id;
    elsif new.kind = 'priority' then
      update priority_slots set status = 'paid' where order_id = new.id;
    end if;
  elsif new.status = 'cancelled' and old.status is distinct from 'cancelled' and new.kind = 'priority' then
    update priority_slots set status = 'cancelled' where order_id = new.id;
  end if;
  return new;
end $$;
drop trigger if exists orders_paid on orders;
create trigger orders_paid before update on orders for each row execute function tb_order_paid();

-- Админка Directus: заказы и календарь приоритета
do $$ begin
  if exists (select 1 from information_schema.tables where table_name = 'directus_collections') then
    insert into directus_collections (collection, icon, note, sort, archive_field, archive_value, unarchive_value)
      select 'orders', 'payments', 'Заказы: PRO и приоритет. Отметить «paid» = включить услугу', 30, 'status', 'cancelled', 'pending'
      where not exists (select 1 from directus_collections where collection = 'orders');
    insert into directus_collections (collection, icon, note, sort)
      select 'priority_slots', 'event', 'Календарь приоритета: 3 места на город в неделю', 31
      where not exists (select 1 from directus_collections where collection = 'priority_slots');
    insert into directus_fields (collection, field, interface, options, display, sort, width, note)
      select 'orders', 'status', 'select-dropdown', '{"choices":[{"text":"Ожидает оплаты","value":"pending"},{"text":"Оплачен","value":"paid"},{"text":"Отменён","value":"cancelled"}]}', 'labels', 1, 'half', 'Оплачен → PRO продлевается / слот приоритета подтверждается'
      where not exists (select 1 from directus_fields where collection = 'orders' and field = 'status');
    insert into directus_fields (collection, field, interface, display, sort, width, note)
      select 'barbershops', 'pro_until', 'datetime', 'datetime', 2, 'half', 'PRO действует до (пусто = бесплатный тариф)'
      where not exists (select 1 from directus_fields where collection = 'barbershops' and field = 'pro_until');
  end if;
end $$;
