-- Пакет для сетей: один заказ PRO на несколько филиалов.
alter table orders add column if not exists shop_ids int[];
alter table orders add column if not exists discount int default 0;
create or replace function tb_order_paid() returns trigger language plpgsql as $$
begin
  if new.status = 'paid' and old.status is distinct from 'paid' then
    new.paid_at := coalesce(new.paid_at, now());
    if new.kind = 'pro' then
      update barbershops set pro_until = greatest(coalesce(pro_until, now()), now()) + make_interval(months => coalesce(new.months, 1))
      where id = new.barbershop_id or id = any(coalesce(new.shop_ids, '{}'));
    elsif new.kind = 'priority' then
      update priority_slots set status = 'paid' where order_id = new.id;
    end if;
  elsif new.status = 'cancelled' and old.status is distinct from 'cancelled' and new.kind = 'priority' then
    update priority_slots set status = 'cancelled' where order_id = new.id;
  end if;
  return new;
end $$;
