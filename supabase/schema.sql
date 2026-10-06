-- Polytrack Codes v2 (tracks with releases and comments).
-- Run this whole file in Supabase -> SQL Editor. It works on a fresh project AND on a project that already
-- ran the v1 file: the old single-table `tracks` is renamed to `tracks_legacy` (kept, never dropped) and its
-- rows are copied into the new tables as one track with one release each. Safe to re-run.

-- ---------------------------------------------------------------- v1 leftovers: move the old table aside
do $$ begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'tracks' and column_name = 'code') then
    alter table public.tracks rename to tracks_legacy;
    alter index if exists public.tracks_pkey rename to tracks_legacy_pkey;
    alter index if exists public.tracks_code_unique rename to tracks_legacy_code_unique;
    alter index if exists public.tracks_created_idx rename to tracks_legacy_created_idx;
  end if;
end $$;

-- ---------------------------------------------------------------- people
create table if not exists public.profiles (
  id   uuid primary key references auth.users (id) on delete cascade,
  name text not null default 'Driver' check (char_length(name) between 1 and 40)
);

create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid())
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name)
  values (new.id, left(coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), 'Driver'), 40))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- tracks, releases, comments
-- Times are server-side milliseconds since epoch so clients cannot forge them.
create table if not exists public.tracks (
  id          uuid   primary key default gen_random_uuid(),
  name        text   not null check (char_length(name) between 1 and 60),
  description text   not null default '' check (char_length(description) <= 500),
  author_id   uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  created_at  bigint not null default (extract(epoch from now()) * 1000)::bigint,
  updated_at  bigint not null default (extract(epoch from now()) * 1000)::bigint
);

create table if not exists public.track_releases (
  id           uuid   primary key default gen_random_uuid(),
  track_id     uuid   not null references public.tracks (id) on delete cascade,
  game_version text   not null check (game_version ~ '^[A-Za-z0-9][A-Za-z0-9._+\- ]{0,23}$'),
  channel      text   not null check (channel in ('stable', 'dev')),
  code         text   not null check (char_length(code) between 1 and 200000),
  code_length  int    generated always as (char_length(code)) stored,
  notes        text   not null default '' check (char_length(notes) <= 1000),
  author_id    uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  created_at   bigint not null default (extract(epoch from now()) * 1000)::bigint
);

create table if not exists public.comments (
  id         uuid   primary key default gen_random_uuid(),
  track_id   uuid   not null references public.tracks (id) on delete cascade,
  release_id uuid   references public.track_releases (id) on delete set null,
  author_id  uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  body       text   not null check (char_length(body) between 1 and 2000),
  created_at bigint not null default (extract(epoch from now()) * 1000)::bigint
);

create index if not exists tracks_updated_idx    on public.tracks (updated_at desc);
create index if not exists releases_track_idx    on public.track_releases (track_id, created_at desc);
create unique index if not exists releases_code_unique on public.track_releases (track_id, md5(code));
create index if not exists comments_track_idx    on public.comments (track_id, created_at);

-- A new release bumps the track's "updated" time.
create or replace function public.touch_track() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.tracks set updated_at = new.created_at where id = new.track_id;
  return new;
end $$;

drop trigger if exists release_touch_track on public.track_releases;
create trigger release_touch_track after insert on public.track_releases
  for each row execute function public.touch_track();

-- Homepage summary: one row per track, never includes the (large) code.
create or replace view public.track_summaries with (security_invoker = true) as
select t.id, t.name, t.description, t.author_id, t.created_at, t.updated_at,
  (select count(*)::int from public.track_releases r where r.track_id = t.id) as release_count,
  (select count(*)::int from public.comments c where c.track_id = t.id)       as comment_count,
  (select r.game_version from public.track_releases r
     where r.track_id = t.id and r.channel = 'stable' order by r.created_at desc limit 1) as latest_stable,
  (select r.game_version from public.track_releases r
     where r.track_id = t.id and r.channel = 'dev' order by r.created_at desc limit 1)    as latest_dev,
  coalesce((select array_agg(distinct r.game_version) from public.track_releases r where r.track_id = t.id),
           '{}'::text[]) as game_versions
from public.tracks t;

-- ---------------------------------------------------------------- migrate v1 rows (once)
do $$ begin
  if to_regclass('public.tracks_legacy') is not null and not exists (select 1 from public.tracks) then
    insert into public.tracks (id, name, description, author_id, created_at, updated_at)
      select id, name, left(coalesce(notes, ''), 500), author_id, created_at, created_at from public.tracks_legacy;
    insert into public.track_releases (track_id, game_version, channel, code, notes, author_id, created_at)
      select id, version, channel, code, '', author_id, created_at from public.tracks_legacy;
  end if;
end $$;

-- ---------------------------------------------------------------- Data API grants
-- Supabase no longer exposes new public tables automatically (new projects since 2026-05-30, existing
-- projects from 2026-10-30). Grants only let the API *see* a table; the policies below decide which rows.
grant usage on schema public to anon, authenticated;
grant select on public.tracks, public.track_releases, public.comments, public.track_summaries, public.profiles to anon;
grant select on public.tracks, public.track_releases, public.comments, public.track_summaries to authenticated;
grant insert, delete on public.tracks, public.track_releases, public.comments to authenticated;
grant update (name, description) on public.tracks to authenticated;
grant select, update on public.profiles to authenticated;
grant select on public.admins to authenticated;
grant execute on function public.is_admin() to anon, authenticated;
grant all on public.tracks, public.track_releases, public.comments, public.profiles, public.admins to service_role;

-- ---------------------------------------------------------------- Row Level Security
alter table public.profiles       enable row level security;
alter table public.admins         enable row level security;
alter table public.tracks         enable row level security;
alter table public.track_releases enable row level security;
alter table public.comments       enable row level security;

drop policy if exists "profiles readable" on public.profiles;
create policy "profiles readable" on public.profiles for select using (true);
drop policy if exists "own profile editable" on public.profiles;
create policy "own profile editable" on public.profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "admins see own row" on public.admins;
create policy "admins see own row" on public.admins for select using (auth.uid() = user_id);

drop policy if exists "tracks readable" on public.tracks;
create policy "tracks readable" on public.tracks for select using (true);
drop policy if exists "signed-in users create own tracks" on public.tracks;
create policy "signed-in users create own tracks" on public.tracks for insert to authenticated
  with check (author_id = auth.uid());
drop policy if exists "owners edit tracks" on public.tracks;
create policy "owners edit tracks" on public.tracks for update to authenticated
  using (author_id = auth.uid()) with check (author_id = auth.uid());
drop policy if exists "owners and admins delete tracks" on public.tracks;
create policy "owners and admins delete tracks" on public.tracks for delete to authenticated
  using (author_id = auth.uid() or public.is_admin());

drop policy if exists "releases readable" on public.track_releases;
create policy "releases readable" on public.track_releases for select using (true);
drop policy if exists "owners publish releases" on public.track_releases;
create policy "owners publish releases" on public.track_releases for insert to authenticated
  with check (author_id = auth.uid()
              and exists (select 1 from public.tracks t where t.id = track_id and t.author_id = auth.uid()));
drop policy if exists "owners and admins delete releases" on public.track_releases;
create policy "owners and admins delete releases" on public.track_releases for delete to authenticated
  using (author_id = auth.uid() or public.is_admin());

drop policy if exists "comments readable" on public.comments;
create policy "comments readable" on public.comments for select using (true);
drop policy if exists "signed-in users comment as themselves" on public.comments;
create policy "signed-in users comment as themselves" on public.comments for insert to authenticated
  with check (author_id = auth.uid());
drop policy if exists "authors and admins delete comments" on public.comments;
create policy "authors and admins delete comments" on public.comments for delete to authenticated
  using (author_id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------- live updates
do $$ declare t text; begin
  foreach t in array array['tracks', 'track_releases', 'comments'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null; end;
  end loop;
end $$;

-- To make yourself an admin (can delete any track, release or comment), after creating an account:
--   insert into public.admins (user_id) select id from auth.users where email = 'you@example.com';
