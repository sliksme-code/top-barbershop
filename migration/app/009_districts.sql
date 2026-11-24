-- Районы городов: обратное геокодирование координат барбершопов (Яндекс Геокодер).
-- Заполняется скриптом web/scripts/fill-districts.mjs
create table if not exists districts (
  id serial primary key,
  location_id int not null references locations(id) on delete cascade,
  name text not null,
  unique (location_id, name)
);
alter table barbershops add column if not exists district_id int references districts(id) on delete set null;
create index if not exists barbershops_district on barbershops(district_id);
