-- 079 — Goldia Sales: owner decisions D-A1 and D-A2 (2026-11-06).
--
-- D-A1  A NEW sale to an archived ("o'chirilgan") customer is refused on the server. Old debts stay collectible:
--       payments (gram / UZS / USD / scrap), payment reversals, sale reversals and legacy-debt corrections are not
--       sales and are NOT affected. Implemented as one BEFORE INSERT guard on jewelry_sales, so every sale path is
--       covered (rpc_record_weight_sale, rpc_record_barcode_piece_sale, rpc_record_client_jewelry_sale,
--       rpc_record_currency_sale, rpc_create_jewelry_sale and any direct insert). Restore the customer to sell again.
--
-- D-A2  A seller cannot assign a customer to himself (or move one to anybody) by changing customers.seller_id:
--       not an unassigned customer, not his own customer to another seller. Director / manager (equal rights) keep
--       assigning customers. RPCs running as the function owner are not affected (none of them reassigns a customer).
--       Selling to an unassigned customer stays as it is (076 rule) and does not assign it.
--
-- No row is changed by this migration (guards only). No rate, accounting or profit rule is changed (D-C1…D-C5).

-- ---------------------------------------------------------------- D-A1
create or replace function public._goldia_guard_sale_archived_customer()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.customer_id is not null
     and exists (select 1 from public.customers c where c.id = new.customer_id and coalesce(c.is_archived, false)) then
    raise exception 'ERR_CUSTOMER_ARCHIVED: Mijoz arxivlangan (o''chirilgan) - unga yangi savdo qilib bo''lmaydi. Eski qarz to''lovini qabul qilish mumkin; savdo uchun avval mijozni tiklang.'
      using errcode = '22023';
  end if;
  return new;
end;
$$;
revoke all on function public._goldia_guard_sale_archived_customer() from public, anon, authenticated;

drop trigger if exists trg_goldia_guard_sale_archived_customer on public.jewelry_sales;
create trigger trg_goldia_guard_sale_archived_customer
  before insert on public.jewelry_sales
  for each row execute function public._goldia_guard_sale_archived_customer();

-- ---------------------------------------------------------------- D-A2
-- SECURITY INVOKER: must see the caller (a SECURITY DEFINER trigger would always see the owner and never guard).
create or replace function public._goldia_guard_customer_assignment()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.seller_id is not distinct from old.seller_id then
    return new;
  end if;
  if public._goldia_is_management_role(public.current_employee_role_text()) then
    return new;
  end if;
  raise exception 'Ruxsat etilmadi: mijozni sotuvchiga faqat direktor yoki menejer biriktiradi' using errcode = '42501';
end;
$$;
revoke all on function public._goldia_guard_customer_assignment() from public, anon, authenticated;

drop trigger if exists trg_goldia_guard_customer_assignment on public.customers;
create trigger trg_goldia_guard_customer_assignment
  before update of seller_id on public.customers
  for each row execute function public._goldia_guard_customer_assignment();

notify pgrst, 'reload schema';
