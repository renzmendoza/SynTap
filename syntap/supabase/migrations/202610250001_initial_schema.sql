create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users where user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create table if not exists public.digital_cards (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique
    check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  full_name text not null check (length(trim(full_name)) between 1 and 120),
  job_title text not null default '',
  company text not null default '',
  bio text not null default '',
  profile_image text not null default '',
  company_logo text not null default '',
  cover_image text not null default '',
  phone text not null default '',
  email text not null default '',
  whatsapp text not null default '',
  website text not null default '',
  address text not null default '',
  map_url text not null default '',
  booking_url text not null default '',
  theme_settings jsonb not null default '{"theme":"light","primary":"#111827","button_appearance":"soft","button_shape":"rounded","alignment":"center"}'::jsonb,
  section_settings jsonb not null default '{"about":true,"contact":true,"social":true,"location":true,"booking":true}'::jsonb,
  social_links jsonb not null default '[]'::jsonb check (jsonb_typeof(social_links) = 'array'),
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists digital_cards_status_updated_idx
  on public.digital_cards (status, updated_at desc);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_digital_cards_updated_at on public.digital_cards;
create trigger set_digital_cards_updated_at
before update on public.digital_cards
for each row execute function public.set_updated_at();

create table if not exists public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.digital_cards (id) on delete cascade,
  event_type text not null check (event_type = 'view'),
  attribution text not null default 'direct'
    check (attribution in ('direct', 'qr', 'nfc')),
  created_at timestamptz not null default now()
);

create index if not exists analytics_events_card_created_idx
  on public.analytics_events (card_id, created_at desc);
create index if not exists analytics_events_created_idx
  on public.analytics_events (created_at desc);

create table if not exists public.nfc_tags (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references public.digital_cards (id) on delete cascade,
  tag_identifier text not null unique,
  notes text not null default '',
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;
alter table public.digital_cards enable row level security;
alter table public.analytics_events enable row level security;
alter table public.nfc_tags enable row level security;

grant usage on schema public to anon, authenticated;
grant select on public.digital_cards to anon, authenticated;
grant insert, update, delete on public.digital_cards to authenticated;
grant select on public.admin_users to authenticated;
grant select on public.analytics_events to authenticated;
grant select, insert, update, delete on public.nfc_tags to authenticated;

drop policy if exists "Admins can view their own admin record" on public.admin_users;
create policy "Admins can view their own admin record"
  on public.admin_users for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "Published cards are publicly readable" on public.digital_cards;
create policy "Published cards are publicly readable"
  on public.digital_cards for select to anon, authenticated
  using (status = 'published');
drop policy if exists "Admins can manage digital cards" on public.digital_cards;
create policy "Admins can manage digital cards"
  on public.digital_cards for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

drop policy if exists "Admins can read analytics" on public.analytics_events;
create policy "Admins can read analytics"
  on public.analytics_events for select to authenticated
  using ((select public.is_admin()));
drop policy if exists "Admins can manage NFC tags" on public.nfc_tags;
create policy "Admins can manage NFC tags"
  on public.nfc_tags for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create or replace function public.record_profile_view(profile_slug text, attribution text default 'direct')
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_card_id uuid;
  safe_attribution text;
begin
  select id into target_card_id
  from public.digital_cards
  where slug = profile_slug and status = 'published';

  if target_card_id is null then
    return false;
  end if;

  safe_attribution := case
    when attribution in ('qr', 'nfc') then attribution
    else 'direct'
  end;

  insert into public.analytics_events (card_id, event_type, attribution)
  values (target_card_id, 'view', safe_attribution);
  return true;
end;
$$;

revoke all on function public.record_profile_view(text, text) from public;
grant execute on function public.record_profile_view(text, text) to anon, authenticated;

drop function if exists public.admin_analytics(integer);
create function public.admin_analytics(days_back integer default 30)
returns table (card_id uuid, attribution text, view_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  bounded_days integer;
begin
  if not (select public.is_admin()) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  bounded_days := greatest(1, least(coalesce(days_back, 30), 36500));
  return query
    select
      e.card_id,
      e.attribution,
      count(*)
    from public.analytics_events as e
    where e.created_at >= now() - make_interval(days => bounded_days)
    group by e.card_id, e.attribution;
end;
$$;

revoke all on function public.admin_analytics(integer) from public;
grant execute on function public.admin_analytics(integer) to authenticated;

create or replace function public.admin_daily_analytics(days_back integer default 30)
returns table (view_date date, attribution text, view_count bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  bounded_days integer;
begin
  if not (select public.is_admin()) then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;

  bounded_days := greatest(1, least(coalesce(days_back, 30), 36500));
  return query
    select e.created_at::date, e.attribution, count(*)
    from public.analytics_events as e
    where e.created_at >= now() - make_interval(days => bounded_days)
    group by e.created_at::date, e.attribution;
end;
$$;

revoke all on function public.admin_daily_analytics(integer) from public;
grant execute on function public.admin_daily_analytics(integer) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('card-media', 'card-media', false, 5242880, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Published profile images are publicly readable" on storage.objects;
drop policy if exists "Published profile images are readable" on storage.objects;
create policy "Published profile images are readable"
  on storage.objects for select to anon, authenticated
  using (
    bucket_id = 'card-media'
    and exists (
      select 1
      from public.digital_cards
      where status = 'published'
        and storage.objects.name in (profile_image, company_logo, cover_image)
    )
  );
drop policy if exists "Admins can read profile images" on storage.objects;
create policy "Admins can read profile images"
  on storage.objects for select to authenticated
  using (bucket_id = 'card-media' and (select public.is_admin()));
drop policy if exists "Admins can upload profile images" on storage.objects;
create policy "Admins can upload profile images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'card-media' and (select public.is_admin()));
drop policy if exists "Admins can update profile images" on storage.objects;
create policy "Admins can update profile images"
  on storage.objects for update to authenticated
  using (bucket_id = 'card-media' and (select public.is_admin()))
  with check (bucket_id = 'card-media' and (select public.is_admin()));
drop policy if exists "Admins can delete profile images" on storage.objects;
create policy "Admins can delete profile images"
  on storage.objects for delete to authenticated
  using (bucket_id = 'card-media' and (select public.is_admin()));
