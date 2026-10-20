-- Docdog: unified HS Code check, ACFTA/Form E dataset, trade-remedy snapshots, roles, RLS.
-- Apply with: supabase db push   (after `supabase link --project-ref <ref>`)
-- NOT yet applied/tested against a live Supabase project.

------------------------------------------------------------------ roles
create type public.app_role as enum ('admin', 'reviewer', 'member');

create table public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  granted_by uuid references auth.users(id),
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);
alter table public.user_roles enable row level security;

create or replace function public.has_role(_role public.app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = auth.uid() and role = _role);
$$;
revoke all on function public.has_role(public.app_role) from public, anon;
grant execute on function public.has_role(public.app_role) to authenticated;

create policy roles_select on public.user_roles for select to authenticated
  using (user_id = auth.uid() or public.has_role('admin'));
create policy roles_admin_write on public.user_roles for all to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));

-- New sign-ups are members ONLY. Never admin.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.user_roles (user_id, role) values (new.id, 'member') on conflict do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- One-time admin bootstrap. Run from the SQL editor / service role only; refuses if an admin exists.
create or replace function public.bootstrap_first_admin(_email text) returns void
language plpgsql security definer set search_path = public as $$
declare _uid uuid;
begin
  if exists (select 1 from public.user_roles where role = 'admin') then
    raise exception 'an admin already exists';
  end if;
  select id into _uid from auth.users where email = _email;
  if _uid is null then raise exception 'user % not found (sign up first)', _email; end if;
  insert into public.user_roles (user_id, role) values (_uid, 'admin'), (_uid, 'reviewer') on conflict do nothing;
end $$;
revoke all on function public.bootstrap_first_admin(text) from public, anon, authenticated;

------------------------------------------------------------------ ACFTA documents
create table public.acfta_documents (
  id uuid primary key default gen_random_uuid(),
  dataset_key text not null default 'ACFTA',
  name text not null,
  version text not null,
  status text not null default 'UPLOADED'
    check (status in ('UPLOADED','IN_REVIEW','EXTRACTION_FAILED','PUBLISHED','SUPERSEDED','REJECTED')),
  storage_path text not null unique,
  sha256 text not null,
  page_count int,
  uploaded_by uuid not null references auth.users(id),
  uploaded_at timestamptz not null default now(),
  supersedes uuid references public.acfta_documents(id),
  superseded_by uuid references public.acfta_documents(id),
  extraction_error text,
  ocr_required_pages int[] not null default '{}',
  published_by uuid references auth.users(id),
  published_at timestamptz,
  unique (dataset_key, name, version)
);
-- only one live document per dataset: replacement must be an explicit supersede
create unique index acfta_one_published on public.acfta_documents (dataset_key) where status = 'PUBLISHED';
alter table public.acfta_documents enable row level security;

create policy docs_select_staff on public.acfta_documents for select to authenticated
  using (public.has_role('admin') or public.has_role('reviewer'));
create policy docs_select_members on public.acfta_documents for select to authenticated
  using (status in ('PUBLISHED','SUPERSEDED'));
create policy docs_admin_insert on public.acfta_documents for insert to authenticated
  with check (public.has_role('admin') and uploaded_by = auth.uid());
create policy docs_admin_update on public.acfta_documents for update to authenticated
  using (public.has_role('admin')) with check (public.has_role('admin'));
-- no delete policy: documents are never deleted through the API

------------------------------------------------------------------ ACFTA records
create table public.acfta_records (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.acfta_documents(id),
  page_number int not null check (page_number > 0),
  hs_code_raw text not null,
  hs_code_digits text not null check (hs_code_digits ~ '^[0-9]{6,11}$'),
  description_raw text,
  rate_raw text,
  rate_value numeric,                -- NULL means "not in document". No default, never coalesced to 0.
  conditions_raw text,
  effective_from date,
  effective_to date,
  source_text text not null,
  extraction_method text not null check (extraction_method in ('TEXT_LAYER','OCR')),
  confidence text not null check (confidence in ('LOW','MEDIUM')),
  review_status text not null default 'PENDING' check (review_status in ('PENDING','APPROVED','REJECTED')),
  edited_by_reviewer boolean not null default false,
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_note text,
  candidate_snapshot jsonb not null
);
create index acfta_records_hs on public.acfta_records (hs_code_digits text_pattern_ops);
create index acfta_records_doc on public.acfta_records (document_id, review_status);
alter table public.acfta_records enable row level security;

create policy rec_select_staff on public.acfta_records for select to authenticated
  using (public.has_role('admin') or public.has_role('reviewer'));
create policy rec_select_members on public.acfta_records for select to authenticated
  using (review_status = 'APPROVED'
         and exists (select 1 from public.acfta_documents d where d.id = document_id and d.status = 'PUBLISHED'));
create policy rec_admin_insert on public.acfta_records for insert to authenticated
  with check (public.has_role('admin'));
create policy rec_reviewer_update on public.acfta_records for update to authenticated
  using (public.has_role('reviewer') or public.has_role('admin'))
  with check (public.has_role('reviewer') or public.has_role('admin'));

-- Provenance columns are immutable; records of a published/superseded document are frozen.
create or replace function public.acfta_records_guard() returns trigger
language plpgsql security definer set search_path = public as $$
declare _status text;
begin
  select status into _status from public.acfta_documents where id = old.document_id;
  if _status <> 'IN_REVIEW' then
    raise exception 'records are frozen unless the document is IN_REVIEW (current: %)', _status;
  end if;
  if new.document_id <> old.document_id or new.page_number <> old.page_number
     or new.source_text <> old.source_text or new.candidate_snapshot <> old.candidate_snapshot
     or new.extraction_method <> old.extraction_method then
    raise exception 'provenance columns are immutable';
  end if;
  if new.review_status <> old.review_status and new.review_status <> 'PENDING' then
    new.reviewed_by := auth.uid(); new.reviewed_at := now();
  end if;
  if (new.hs_code_raw, new.hs_code_digits, new.description_raw, new.rate_raw, new.rate_value,
      new.conditions_raw, new.effective_from, new.effective_to)
     is distinct from
     (old.hs_code_raw, old.hs_code_digits, old.description_raw, old.rate_raw, old.rate_value,
      old.conditions_raw, old.effective_from, old.effective_to) then
    new.edited_by_reviewer := true;
    new.review_status := 'PENDING'; new.reviewed_by := null; new.reviewed_at := null;
  end if;
  return new;
end $$;
create trigger acfta_records_guard before update on public.acfta_records
  for each row execute function public.acfta_records_guard();

------------------------------------------------------------------ audit log (append-only)
create table public.acfta_review_events (
  id bigint generated always as identity primary key,
  document_id uuid not null references public.acfta_documents(id),
  record_id uuid references public.acfta_records(id),
  action text not null,
  actor_id uuid not null,
  at timestamptz not null default now(),
  before jsonb, after jsonb, note text
);
alter table public.acfta_review_events enable row level security;
create policy evt_select_staff on public.acfta_review_events for select to authenticated
  using (public.has_role('admin') or public.has_role('reviewer'));
-- no insert/update/delete policy for users: rows are written only by the SECURITY DEFINER trigger/functions below

create or replace function public.acfta_records_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.acfta_review_events (document_id, record_id, action, actor_id, before, after, note)
  values (new.document_id, new.id,
          case when new.edited_by_reviewer and not old.edited_by_reviewer or
                    (new.hs_code_raw, new.rate_raw, new.rate_value, new.description_raw)
                    is distinct from (old.hs_code_raw, old.rate_raw, old.rate_value, old.description_raw)
               then 'EDIT' else new.review_status end,
          auth.uid(),
          to_jsonb(old) - 'candidate_snapshot' - 'source_text',
          to_jsonb(new) - 'candidate_snapshot' - 'source_text',
          new.review_note);
  return new;
end $$;
create trigger acfta_records_audit after update on public.acfta_records
  for each row execute function public.acfta_records_audit();

------------------------------------------------------------------ publish / supersede (atomic, admin only)
create or replace function public.acfta_publish_document(_doc uuid, _supersedes uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare d public.acfta_documents; old public.acfta_documents;
begin
  if not public.has_role('admin') then raise exception 'admin only'; end if;
  select * into d from public.acfta_documents where id = _doc for update;
  if d.id is null or d.status <> 'IN_REVIEW' then raise exception 'document must be IN_REVIEW'; end if;
  if exists (select 1 from public.acfta_records where document_id = _doc and review_status = 'PENDING') then
    raise exception 'pending records remain'; end if;
  if not exists (select 1 from public.acfta_records where document_id = _doc and review_status = 'APPROVED') then
    raise exception 'no approved records'; end if;
  select * into old from public.acfta_documents
    where dataset_key = d.dataset_key and status = 'PUBLISHED' for update;
  if old.id is not null and (_supersedes is null or _supersedes <> old.id) then
    raise exception 'a published document exists; pass it as _supersedes to replace it'; end if;
  if _supersedes is not null and old.id is distinct from _supersedes then
    raise exception 'document to supersede is not the published one'; end if;
  if old.id is not null then
    update public.acfta_documents set status = 'SUPERSEDED', superseded_by = _doc where id = old.id;
  end if;
  update public.acfta_documents
    set status = 'PUBLISHED', supersedes = _supersedes, published_by = auth.uid(), published_at = now()
    where id = _doc;
  insert into public.acfta_review_events (document_id, action, actor_id, after)
    values (_doc, 'PUBLISH', auth.uid(), jsonb_build_object('supersedes', _supersedes));
end $$;
revoke all on function public.acfta_publish_document(uuid, uuid) from public, anon;
grant execute on function public.acfta_publish_document(uuid, uuid) to authenticated;

------------------------------------------------------------------ trade remedies snapshots (written by service role)
create table public.trade_remedy_snapshots (
  id uuid primary key default gen_random_uuid(),
  source_url text not null,
  retrieved_at timestamptz not null,
  parser_version text not null,
  complete boolean not null,
  case_count int not null
);
create table public.trade_remedy_cases (
  snapshot_id uuid not null references public.trade_remedy_snapshots(id) on delete cascade,
  case_id text not null,
  data jsonb not null,           -- full TradeRemedyCase incl. raw HS text and parse notes
  hs_codes text[] not null,
  primary key (snapshot_id, case_id)
);
create index trade_remedy_cases_hs on public.trade_remedy_cases using gin (hs_codes);
alter table public.trade_remedy_snapshots enable row level security;
alter table public.trade_remedy_cases enable row level security;
create policy trs_read on public.trade_remedy_snapshots for select to authenticated using (true);
create policy trc_read on public.trade_remedy_cases for select to authenticated using (true);
-- no write policies: only the service role (sync script) can write

------------------------------------------------------------------ shared search history
create table public.hs_check_history (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  hs_code text not null,
  context jsonb not null default '{}',
  result jsonb not null,
  created_at timestamptz not null default now()
);
create index hs_check_history_user on public.hs_check_history (user_id, created_at desc);
alter table public.hs_check_history enable row level security;
create policy hist_own_select on public.hs_check_history for select to authenticated
  using (user_id = auth.uid() or public.has_role('admin'));
create policy hist_own_insert on public.hs_check_history for insert to authenticated
  with check (user_id = auth.uid());

------------------------------------------------------------------ private bucket for original PDFs
insert into storage.buckets (id, name, public) values ('acfta-pdfs', 'acfta-pdfs', false)
  on conflict (id) do nothing;
create policy acfta_pdf_admin_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'acfta-pdfs' and public.has_role('admin'));
create policy acfta_pdf_staff_select on storage.objects for select to authenticated
  using (bucket_id = 'acfta-pdfs' and (public.has_role('admin') or public.has_role('reviewer')));
-- no update/delete policies: originals are immutable
