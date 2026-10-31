-- Kishan Shadi outfit picker: Supabase setup
-- Run this whole file once in Supabase: SQL Editor > New query > paste > Run.
-- Then set the family password with the last statement at the bottom.

create extension if not exists pgcrypto with schema extensions;

-- 1. Tables ---------------------------------------------------------------

create table if not exists public.likes (
  voter          text        not null,   -- name in lower case, used as the key
  voter_display  text        not null,   -- name as the person typed it
  item_id        text        not null,
  created_at     timestamptz not null default now(),
  primary key (voter, item_id)
);

create table if not exists public.app_secret (
  id       int  primary key default 1 check (id = 1),
  pw_hash  text not null
);

-- Lock both tables. The website never reads them directly.
-- It can only call the three functions below.
alter table public.likes      enable row level security;
alter table public.app_secret enable row level security;
revoke all on public.likes      from anon, authenticated;
revoke all on public.app_secret from anon, authenticated;

-- 2. Helpers --------------------------------------------------------------

create or replace function public._family_pw_ok(p_password text)
returns boolean
language sql
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1 from public.app_secret
    where pw_hash = extensions.crypt(coalesce(p_password, ''), pw_hash)
  );
$$;

create or replace function public._family_clean_name(p_name text)
returns text
language sql
immutable
as $$
  select left(trim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 40);
$$;

revoke all on function public._family_pw_ok(text)       from public, anon, authenticated;
revoke all on function public._family_clean_name(text)  from public, anon, authenticated;

-- 3. Functions the website calls -----------------------------------------

-- Sign in. Returns the item ids this person already liked.
create or replace function public.family_sign_in(p_name text, p_password text)
returns json
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name text := public._family_clean_name(p_name);
begin
  if not public._family_pw_ok(p_password) then
    perform pg_sleep(0.5);
    raise exception 'wrong_password' using errcode = '28P01';
  end if;
  if length(v_name) < 2 then
    raise exception 'name_too_short' using errcode = '22023';
  end if;
  return json_build_object(
    'name', v_name,
    'likes', coalesce((select json_agg(item_id) from public.likes where voter = lower(v_name)), '[]'::json)
  );
end;
$$;

-- Like or unlike one outfit.
create or replace function public.family_set_like(p_name text, p_password text, p_item text, p_liked boolean)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name text := public._family_clean_name(p_name);
begin
  if not public._family_pw_ok(p_password) then
    perform pg_sleep(0.5);
    raise exception 'wrong_password' using errcode = '28P01';
  end if;
  if length(v_name) < 2 then
    raise exception 'name_too_short' using errcode = '22023';
  end if;
  if p_item is null or length(p_item) not between 1 and 20 then
    raise exception 'bad_item' using errcode = '22023';
  end if;

  if p_liked then
    insert into public.likes (voter, voter_display, item_id)
    values (lower(v_name), v_name, p_item)
    on conflict (voter, item_id) do update set voter_display = excluded.voter_display;
  else
    delete from public.likes where voter = lower(v_name) and item_id = p_item;
  end if;
end;
$$;

-- All likes, for the gallery counts and the analytics page.
create or replace function public.family_all_likes(p_password text)
returns table (voter text, voter_display text, item_id text, created_at timestamptz)
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if not public._family_pw_ok(p_password) then
    perform pg_sleep(0.5);
    raise exception 'wrong_password' using errcode = '28P01';
  end if;
  return query
    select l.voter, l.voter_display, l.item_id, l.created_at
    from public.likes l
    order by l.created_at;
end;
$$;

revoke all on function public.family_sign_in(text, text)                    from public;
revoke all on function public.family_set_like(text, text, text, boolean)    from public;
revoke all on function public.family_all_likes(text)                        from public;
grant execute on function public.family_sign_in(text, text)                 to anon, authenticated;
grant execute on function public.family_set_like(text, text, text, boolean) to anon, authenticated;
grant execute on function public.family_all_likes(text)                     to anon, authenticated;

-- 4. Set the family password ----------------------------------------------
-- Replace CHANGE-ME with the password you will share with the family, then run
-- only this statement. Run it again any time to change the password.
-- The password is stored as a one-way hash, not as plain text.

insert into public.app_secret (id, pw_hash)
values (1, extensions.crypt('CHANGE-ME', extensions.gen_salt('bf')))
on conflict (id) do update set pw_hash = excluded.pw_hash;
