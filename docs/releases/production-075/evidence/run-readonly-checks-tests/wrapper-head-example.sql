\set ON_ERROR_STOP on
begin transaction read only;
do $goldia_ro$ begin if current_setting('transaction_read_only') <> 'on' then raise exception 'GOLDIA_RO_GUARD: transaction is not read-only - stopped before any check'; end if; end $goldia_ro$;
select 'GOLDIA_RO_GUARD|' || current_setting('transaction_read_only');
;
select 'GOLDIA_RO_END|' || current_setting('transaction_read_only');
rollback;
