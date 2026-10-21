-- Batched bulk approve/reject for ACFTA records. SECURITY INVOKER: the caller's RLS policies and the
-- guard/audit triggers still apply to every row, so only reviewers/admins can use it and each row is audited.
-- Call repeatedly until it returns 0 (the API does this).
create or replace function public.acfta_bulk_review(
  _doc uuid, _status text, _confidence text default null, _limit int default 2000
) returns int
language plpgsql security invoker set search_path = public as $$
declare n int;
begin
  if _status not in ('APPROVED', 'REJECTED') then raise exception 'invalid status'; end if;
  with picked as (
    select id from public.acfta_records
    where document_id = _doc and review_status = 'PENDING' and (_confidence is null or confidence = _confidence)
    limit _limit
  )
  update public.acfta_records r set review_status = _status from picked where r.id = picked.id;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.acfta_bulk_review(uuid, text, text, int) from public, anon;
grant execute on function public.acfta_bulk_review(uuid, text, text, int) to authenticated;
