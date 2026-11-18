-- Статистика карточек барбершопов по дням: показы в списках, просмотры карточки, клики по контактам
create table if not exists shop_stats (
  barbershop_id int not null references barbershops(id) on delete cascade,
  day date not null,
  impressions int not null default 0,  -- карточка попала в видимую область списка (город, метро, сеть, главная, «рядом»)
  views int not null default 0,        -- открыли страницу барбершопа
  booking int not null default 0,      -- нажали «Записаться онлайн»
  phone int not null default 0,        -- нажали на телефон
  site int not null default 0,         -- перешли на сайт
  social int not null default 0,       -- перешли в соцсети
  primary key (barbershop_id, day));
create index if not exists shop_stats_day on shop_stats(day);
