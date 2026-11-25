-- Данные из онлайн-записи YClients: услуги с актуальными ценами и мастера.
-- Заполняется скриптом web/scripts/sync-yclients.mjs
create table if not exists yclients_services (
  barbershop_id int not null references barbershops(id) on delete cascade,
  ext_id bigint not null,
  title text not null,
  category text,
  price_min numeric(10, 2),
  price_max numeric(10, 2),
  synced_at timestamptz not null default now(),
  primary key (barbershop_id, ext_id)
);
create table if not exists yclients_staff (
  barbershop_id int not null references barbershops(id) on delete cascade,
  ext_id bigint not null,
  name text not null,
  specialization text,
  rating numeric(3, 2),
  reviews int,
  avatar text,
  synced_at timestamptz not null default now(),
  primary key (barbershop_id, ext_id)
);
-- company_id в YClients (отличается от id поддомена nNNNNN.yclients.com)
-- и отметка последней попытки синхронизации (null в company_id = записи нет/закрыта)
alter table barbershops add column if not exists yclients_company_id bigint;
alter table barbershops add column if not exists yclients_synced_at timestamptz;
create index if not exists yclients_services_shop on yclients_services(barbershop_id);
create index if not exists yclients_staff_shop on yclients_staff(barbershop_id);
