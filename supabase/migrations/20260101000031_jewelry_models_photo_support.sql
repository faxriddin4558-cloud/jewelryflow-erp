-- ============================================================================
-- JewelryFlow ERP — Migration 031
-- Jewelry Models Photo Support: Primary Image URL in Model Creation & Update
-- ============================================================================

-- Ensure primary_image_url exists in jewelry_models
alter table public.jewelry_models
  add column if not exists primary_image_url text;

-- Update rpc_create_jewelry_model to support p_primary_image_url
create or replace function public.rpc_create_jewelry_model(
  p_name text,
  p_category text default 'Серьги',
  p_decorations text default null,
  p_reference_weight_grams numeric default null,
  p_purity text default '585',
  p_model_code text default null,
  p_organization_id uuid default null,
  p_primary_image_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_org_id uuid;
  v_model_code text := trim(p_model_code);
  v_next_num integer;
  v_new_model record;
  v_purity_val integer;
  v_purity_text text;
  v_img_url text := nullif(trim(p_primary_image_url), '');
begin
  -- Validation: name is required
  if p_name is null or trim(p_name) = '' then
    raise exception 'Model nomi kiritilishi shart!';
  end if;

  -- Organization assignment
  v_org_id := coalesce(p_organization_id, public.current_organization_id());
  if v_org_id is null then
    select id into v_org_id from public.organizations order by created_at asc limit 1;
  end if;

  -- Advisory lock to prevent concurrent duplicate model codes
  perform pg_advisory_xact_lock(hashtext('jewelry_models_sequence_lock'));

  -- Clean and parse purity
  v_purity_text := trim(coalesce(p_purity, '585'));
  begin
    v_purity_val := nullif(regexp_replace(v_purity_text, '[^0-9]', '', 'g'), '')::integer;
  exception when others then
    v_purity_val := 585;
  end;
  if v_purity_val is null or v_purity_val <= 0 then
    v_purity_val := 585;
  end if;

  -- Generate or normalize sequential model_code (e.g. JF-M-0001, JF-M-0002)
  if v_model_code is null or v_model_code = '' or v_model_code ~* '^JF-M-0*$' then
    select coalesce(max(substring(model_code from 'JF-M-([0-9]+)')::integer), 0) + 1
      into v_next_num
      from public.jewelry_models
     where model_code ~ '^JF-M-[0-9]+';

    v_model_code := 'JF-M-' || lpad(v_next_num::text, 4, '0');
  else
    -- If custom code provided, check for duplicate collision
    if exists (select 1 from public.jewelry_models where upper(model_code) = upper(v_model_code)) then
      select coalesce(max(substring(model_code from 'JF-M-([0-9]+)')::integer), 0) + 1
        into v_next_num
        from public.jewelry_models
       where model_code ~ '^JF-M-[0-9]+';

      v_model_code := 'JF-M-' || lpad(v_next_num::text, 4, '0');
    end if;
  end if;

  -- Insert atomic record
  insert into public.jewelry_models (
    organization_id,
    model_code,
    name,
    category,
    decorations,
    reference_weight_grams,
    gold_purity,
    proba,
    primary_image_url,
    is_active
  )
  values (
    v_org_id,
    upper(v_model_code),
    trim(p_name),
    trim(coalesce(p_category, 'Серьги')),
    nullif(trim(p_decorations), ''),
    case when p_reference_weight_grams is not null and p_reference_weight_grams > 0
         then p_reference_weight_grams else null end,
    v_purity_val::text,
    v_purity_val,
    v_img_url,
    true
  )
  returning * into v_new_model;

  -- Record audit log
  if to_regclass('public.audit_logs') is not null then
    insert into public.audit_logs (
      organization_id,
      table_name,
      record_id,
      action,
      new_data,
      reason,
      created_at
    ) values (
      v_org_id,
      'jewelry_models',
      v_new_model.id::text,
      'create_model',
      jsonb_build_object(
        'model_code', v_new_model.model_code,
        'name', v_new_model.name,
        'category', v_new_model.category,
        'purity', v_purity_val,
        'weight', v_new_model.reference_weight_grams,
        'primary_image_url', v_new_model.primary_image_url
      ),
      'Created new permanent jewelry model with photo support',
      now()
    );
  end if;

  return to_jsonb(v_new_model);
end;
$$;

grant execute on function public.rpc_create_jewelry_model(text, text, text, numeric, text, text, uuid, text) to authenticated;
grant execute on function public.rpc_create_jewelry_model(text, text, text, numeric, text, text, uuid, text) to anon;

-- RPC for updating existing model photo
create or replace function public.rpc_update_jewelry_model_photo(
  p_model_id uuid,
  p_primary_image_url text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_updated record;
begin
  update public.jewelry_models
     set primary_image_url = nullif(trim(p_primary_image_url), ''),
         updated_at = now()
   where id = p_model_id
  returning * into v_updated;

  if not found then
    raise exception 'Model topilmadi (ID: %)', p_model_id;
  end if;

  return to_jsonb(v_updated);
end;
$$;

grant execute on function public.rpc_update_jewelry_model_photo(uuid, text) to authenticated;
grant execute on function public.rpc_update_jewelry_model_photo(uuid, text) to anon;
