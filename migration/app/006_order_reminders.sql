-- Напоминание об оплате: письмо уходит один раз через час после неоплаченного заказа
alter table orders add column if not exists reminded_at timestamptz;
create index if not exists orders_pending_remind on orders(created_at) where status = 'pending' and reminded_at is null;
-- старые неоплаченные заказы (до запуска напоминаний) писем не получают
update orders set reminded_at = now() where status = 'pending' and reminded_at is null and created_at < now() - interval '1 hour';
