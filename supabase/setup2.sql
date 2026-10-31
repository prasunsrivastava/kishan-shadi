-- Kishan Shadi outfit picker: step 2 (outfit list in the database + family suggestions)
-- Run this whole file once in Supabase: SQL Editor > New query > paste > Run.
-- Run setup.sql first. This file is safe to run again. It does not touch the likes
-- or the family password.

-- 1. Tables ---------------------------------------------------------------

-- The outfits people vote on. The site reads this list after sign-in.
create table if not exists public.items (
  id             text primary key check (id ~ '^[a-z0-9]{1,20}$'),
  name           text not null,
  brand          text not null,
  shop           text not null,
  price          numeric not null check (price >= 0),
  currency       text not null check (currency in ('INR', 'USD')),
  url            text not null unique,
  img            text not null,
  grp            text not null check (grp in ('ready', 'designer')),
  status         text not null default 'live' check (status in ('live', 'hidden')),
  suggestion_id  bigint,                 -- set when the outfit came from a family suggestion
  note           text,                   -- short reason it matches, shown to the family
  sort_order     int not null default 1000,
  added_at       timestamptz not null default now()
);

-- Outfit ideas that family members send in.
create table if not exists public.suggestions (
  id             bigint generated always as identity primary key,
  voter          text not null,          -- name in lower case
  voter_display  text not null,          -- name as typed
  links          text[] not null default '{}',
  note           text not null default '',
  status         text not null default 'new' check (status in ('new', 'working', 'done', 'skipped')),
  result_note    text,                   -- what the daily search found, shown to the person
  created_at     timestamptz not null default now(),
  processed_at   timestamptz
);

-- Up to 10 photos for each suggestion. Each photo is a small JPEG stored as text.
create table if not exists public.suggestion_photos (
  suggestion_id  bigint not null references public.suggestions(id) on delete cascade,
  idx            int    not null check (idx between 1 and 10),
  photo          text   not null,
  primary key (suggestion_id, idx)
);

create index if not exists suggestions_status_idx on public.suggestions (status, created_at);
create index if not exists items_suggestion_idx on public.items (suggestion_id);

-- Lock the tables. The website can only use the functions below.
-- The daily search on Prasun's laptop uses the secret key (service_role).
alter table public.items             enable row level security;
alter table public.suggestions       enable row level security;
alter table public.suggestion_photos enable row level security;
revoke all on public.items, public.suggestions, public.suggestion_photos from anon, authenticated;
grant select, insert, update, delete on public.items, public.suggestions, public.suggestion_photos to service_role;
grant usage, select on all sequences in schema public to service_role;

-- 2. Functions the website calls -----------------------------------------

-- The outfit list. Needs the family password.
create or replace function public.family_items(p_password text)
returns table (id text, name text, brand text, shop text, price numeric, currency text,
               url text, img text, grp text, note text, added_at timestamptz, suggested_by text)
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
    select i.id, i.name, i.brand, i.shop, i.price, i.currency, i.url, i.img, i.grp, i.note, i.added_at,
           s.voter_display
    from public.items i
    left join public.suggestions s on s.id = i.suggestion_id
    where i.status = 'live'
    order by i.sort_order, i.added_at, i.id;
end;
$$;

-- Send a suggestion: 1 to 10 photos and/or 1 to 10 links, plus an optional note.
create or replace function public.family_suggest(p_name text, p_password text, p_links text[], p_note text, p_photos text[])
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_name   text := public._family_clean_name(p_name);
  v_links  text[];
  v_photos text[] := coalesce(p_photos, '{}');
  v_note   text := left(trim(coalesce(p_note, '')), 500);
  v_id     bigint;
  v_photo  text;
  i        int := 0;
begin
  if not public._family_pw_ok(p_password) then
    perform pg_sleep(0.5);
    raise exception 'wrong_password' using errcode = '28P01';
  end if;
  if length(v_name) < 2 then
    raise exception 'name_too_short' using errcode = '22023';
  end if;

  select coalesce(array_agg(l), '{}') into v_links
  from (select trim(x) as l from unnest(coalesce(p_links, '{}')) x) t
  where l <> '';

  if cardinality(v_links) > 10 then
    raise exception 'too_many_links' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_links) l where l !~* '^https?://[^\s]+$' or length(l) > 1000) then
    raise exception 'bad_link' using errcode = '22023';
  end if;
  if cardinality(v_photos) > 10 then
    raise exception 'too_many_photos' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(v_photos) p
             where p !~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' or length(p) > 400000) then
    raise exception 'bad_photo' using errcode = '22023';
  end if;
  if cardinality(v_links) = 0 and cardinality(v_photos) = 0 then
    raise exception 'empty_suggestion' using errcode = '22023';
  end if;

  -- Limits: 10 suggestions per person per day, 100 waiting in total.
  if (select count(*) from public.suggestions
      where voter = lower(v_name) and created_at > now() - interval '24 hours') >= 10 then
    raise exception 'daily_limit' using errcode = '22023';
  end if;
  if (select count(*) from public.suggestions where status in ('new', 'working')) >= 100 then
    raise exception 'queue_full' using errcode = '22023';
  end if;

  insert into public.suggestions (voter, voter_display, links, note)
  values (lower(v_name), v_name, v_links, v_note)
  returning suggestions.id into v_id;

  foreach v_photo in array v_photos loop
    i := i + 1;
    insert into public.suggestion_photos (suggestion_id, idx, photo) values (v_id, i, v_photo);
  end loop;

  return v_id;
end;
$$;

-- The signed-in person's own suggestions (latest 20), with the first photo
-- and the ids of the outfits that were added from each one.
create or replace function public.family_my_suggestions(p_name text, p_password text)
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
  return coalesce((
    select json_agg(t order by t.created_at desc)
    from (
      select s.id, s.links, s.note, s.status, s.result_note, s.created_at,
             (select count(*) from public.suggestion_photos p where p.suggestion_id = s.id) as photo_count,
             (select p.photo from public.suggestion_photos p where p.suggestion_id = s.id order by p.idx limit 1) as cover,
             coalesce((select json_agg(i.id order by i.id) from public.items i
                       where i.suggestion_id = s.id and i.status = 'live'), '[]'::json) as added
      from public.suggestions s
      where s.voter = lower(v_name)
      order by s.created_at desc
      limit 20
    ) t
  ), '[]'::json);
end;
$$;

revoke all on function public.family_items(text)                                from public;
revoke all on function public.family_suggest(text, text, text[], text, text[])  from public;
revoke all on function public.family_my_suggestions(text, text)                 from public;
grant execute on function public.family_items(text)                             to anon, authenticated;
grant execute on function public.family_suggest(text, text, text[], text, text[]) to anon, authenticated;
grant execute on function public.family_my_suggestions(text, text)              to anon, authenticated;

-- 3. The first 56 outfits (from items.js) -------------------------------------
-- Outfits that are already in the table are left as they are, so running this again changes nothing.

insert into public.items (id, name, brand, shop, price, currency, url, img, grp, sort_order, added_at) values
('r01', 'Ochre kurta, asymmetric hem', 'Kalki', 'Kalki', 8995, 'INR', 'https://in.kalkifashion.com/products/ocher-yellow-festive-kurta-in-mini-silk-with-asymmetrical-bottom-cut-and-cocktail-look', 'https://cdn.shopify.com/s/files/1/0636/0134/4666/files/kalki_inka_gold_yellow_festive_kurta_in_mini_silk-sg117948_2.jpg', 'ready', 1, '2026-10-01T00:00:00+05:30'),
('r02', 'Pink suede draped set', 'Kalki', 'Kalki', 29950, 'INR', 'https://in.kalkifashion.com/products/pink-suede-indo-western-suit-for-men-with-pearl-detailing', 'https://cdn.shopify.com/s/files/1/0636/0134/4666/files/pink-suede-indo-western-suit-for-men-with-pearl-detailing-sg356718-1.jpg', 'ready', 2, '2026-10-01T00:00:00+05:30'),
('r03', 'Peach ombre foil-work set', 'Kalki', 'Kalki', 34599, 'INR', 'https://in.kalkifashion.com/products/peach-ombre-indowestern-set-with-foil-work-for-men', 'https://cdn.shopify.com/s/files/1/0636/0134/4666/files/peach_ombre_indowestern_set_with_foil_work_for_men-sg235626_4_f2b84b76-c49f-41d7-9e60-14a8a69cb907.jpg', 'ready', 3, '2026-10-01T00:00:00+05:30'),
('r04', 'Mustard zardosi set', 'Kalki', 'Kalki', 37999, 'INR', 'https://in.kalkifashion.com/products/mustard-yellow-silk-indo-western-set-with-zardosi-work', 'https://cdn.shopify.com/s/files/1/0636/0134/4666/files/mustard_yellow_silk_indo_western_set_with_zardosi_work-sg251023_5_56d37ad3-afb1-4522-a3fd-de18ab16ba16.jpg', 'ready', 4, '2026-10-01T00:00:00+05:30'),
('r05', 'Rust raw silk jodhpuri', 'Kalki', 'Kalki', 53799, 'INR', 'https://in.kalkifashion.com/products/orange-rust-raw-silk-mens-jodhpuris-with-thread-resham-detail-work', 'https://cdn.shopify.com/s/files/1/0636/0134/4666/files/orange-rust-raw-silk-mens-jodhpuris-with-thread-resham-detail-work-sg364814-1_4dad18a6-567b-4d48-855f-c8688130b012.jpg', 'ready', 5, '2026-10-01T00:00:00+05:30'),
('r06', 'Mustard mirror-work jacket set', 'Kalki', 'Kalki', 24799, 'INR', 'https://in.kalkifashion.com/products/mustard-yellow-mirror-embroidered-silk-kurta-jacket-set-for-men', 'https://cdn.shopify.com/s/files/1/0636/0134/4666/files/mustard_yellow_mirror_embroidered_silk_kurta_jacket_set_for_-sg229230_5_cf0bf31d-eafc-4cf5-9e96-b789b6e89b3b.jpg', 'ready', 6, '2026-10-01T00:00:00+05:30'),
('r07', 'Rose blush jacket set', 'Mahavir NX', 'Mahavir NX', 14995, 'INR', 'https://www.mahavir-nx.com/products/rose-blush-embroidered-jacket-kurta-set', 'https://cdn.shopify.com/s/files/1/0714/0635/4595/files/1565_w4080_h6120.jpg', 'ready', 7, '2026-10-01T00:00:00+05:30'),
('r08', 'Yellow ombre long jacket', 'Mahavir NX', 'Mahavir NX', 19995, 'INR', 'https://www.mahavir-nx.com/products/yellow-ombre-indo-western-with-floral-hand-work', 'https://cdn.shopify.com/s/files/1/0714/0635/4595/files/yellow-ombre-indo-western-with-floral-hand-work.jpg', 'ready', 8, '2026-10-01T00:00:00+05:30'),
('r09', 'Pink-lilac ombre long jacket', 'Mahavir NX', 'Mahavir NX', 25995, 'INR', 'https://www.mahavir-nx.com/products/ombre-pink-embroidered-indo-western-for-men', 'https://cdn.shopify.com/s/files/1/0714/0635/4595/files/ombre-pink-embroidered-indo-western-for-men.jpg', 'ready', 9, '2026-10-01T00:00:00+05:30'),
('r10', 'Sage patchwork long jacket', 'Mahavir NX', 'Mahavir NX', 18995, 'INR', 'https://www.mahavir-nx.com/products/sage-royale-patchwork-indo-western', 'https://cdn.shopify.com/s/files/1/0714/0635/4595/files/indo-western-for-men-sage-royale-patchwork-indo-western.jpg', 'ready', 10, '2026-10-01T00:00:00+05:30'),
('r11', 'Pink open jacket', 'G3+ Fashion', 'G3+ Fashion', 257, 'USD', 'https://g3fashion.com/products/pink-embroidered-open-jacket-men-indo-western', 'https://cdn.shopify.com/s/files/1/1079/3477/7630/files/1792060025_A_2137_MARGENTA_PINK_1.jpg', 'ready', 11, '2026-10-01T00:00:00+05:30'),
('r12', 'Mustard trellis jacket', 'G3+ Fashion', 'G3+ Fashion', 257, 'USD', 'https://g3fashion.com/products/mustard-yellow-floral-trellis-men-indo-western', 'https://cdn.shopify.com/s/files/1/1079/3477/7630/files/1792061198_A_2137_MARIGOLD_YELLOW_1.jpg', 'ready', 12, '2026-10-01T00:00:00+05:30'),
('r13', 'Pink-orange ombre bandhani', 'G3+ Fashion', 'G3+ Fashion', 401, 'USD', 'https://g3fashion.com/products/pink-orange-ombre-bandhani-indo-western-for-men', 'https://cdn.shopify.com/s/files/1/1079/3477/7630/files/1788076152_ID5401_1_1.jpg', 'ready', 13, '2026-10-01T00:00:00+05:30'),
('r14', 'Sky blue all-over work set', 'G3+ Fashion', 'G3+ Fashion', 201, 'USD', 'https://g3fashion.com/products/sky-blue-heritage-embroidered-indo-western-for-men', 'https://cdn.shopify.com/s/files/1/1079/3477/7630/files/1788070383_ID5319_1_BLUE_2.jpg', 'ready', 14, '2026-10-01T00:00:00+05:30'),
('r15', 'Peach-tan set', 'G3+ Fashion', 'G3+ Fashion', 188, 'USD', 'https://g3fashion.com/products/peach-signature-mens-indo-western', 'https://cdn.shopify.com/s/files/1/1079/3477/7630/files/1791287320_14435.jpg', 'ready', 15, '2026-10-01T00:00:00+05:30'),
('r16', 'Gold brocade over mustard', 'G3+ Fashion', 'G3+ Fashion', 219, 'USD', 'https://g3fashion.com/products/mustard-yellow-luxury-mens-indo-western', 'https://cdn.shopify.com/s/files/1/1079/3477/7630/files/1790412983_AS3791533_1_01.jpg', 'ready', 16, '2026-10-01T00:00:00+05:30'),
('r17', 'Orange cutdana silk set', 'G3+ Fashion', 'G3+ Fashion', 293, 'USD', 'https://g3fashion.com/products/orange-cutdana-worked-silk-indowestern-set', 'https://cdn.shopify.com/s/files/1/1079/3477/7630/files/1775632149_ID5224_ORANGE_5.jpg', 'ready', 17, '2026-10-01T00:00:00+05:30'),
('r18', 'Cream stripe long jacket', 'G3+ Fashion', 'G3+ Fashion', 832, 'USD', 'https://g3fashion.com/products/cream-cotton-silk-indo-western-with-embroidery-work', 'https://cdn.shopify.com/s/files/1/1079/3477/7630/files/cream_cotton_silk_indo_western_with_embroidery_work_17563638093195_cream_5.jpg', 'ready', 18, '2026-10-01T00:00:00+05:30'),
('r19', 'Orange-yellow long jacket', 'G3+ Fashion', 'G3+ Fashion', 141, 'USD', 'https://g3fashion.com/products/white-and-orange-silk-indowestern', 'https://cdn.shopify.com/s/files/1/1079/3477/7630/files/white_and_orange_silk_indowestern_17099008636397.jpg', 'ready', 19, '2026-10-01T00:00:00+05:30'),
('r20', 'Mauve all-over pattern set', 'G3+ Fashion', 'G3+ Fashion', 181, 'USD', 'https://g3fashion.com/products/charming-pink-indowestern-for-wedding-radiance', 'https://cdn.shopify.com/s/files/1/1079/3477/7630/files/charming_pink_indowestern_for_wedding_radiance_17365054976898_d.jpg', 'ready', 20, '2026-10-01T00:00:00+05:30'),
('r21', 'Yellow shaded long jacket', 'G3+ Fashion', 'G3+ Fashion', 114, 'USD', 'https://g3fashion.com/products/elegant-yellow-shaded-indowestern-jacket-for-the-modern-man', 'https://cdn.shopify.com/s/files/1/1079/3477/7630/files/elegant_yellow_shaded_indowestern_jacket_for_the_modern_man_17364240806766_d.jpg', 'ready', 21, '2026-10-01T00:00:00+05:30'),
('r22', 'Yellow jacket set', 'G3+ Fashion', 'G3+ Fashion', 179, 'USD', 'https://g3fashion.com/products/yellow-terry-rayon-indowestern-with-minimal-thread-work', 'https://cdn.shopify.com/s/files/1/1079/3477/7630/files/yellow_terry_rayon_indowestern_with_minimal_thread_work_17350406961798_yellow.jpg', 'ready', 22, '2026-10-01T00:00:00+05:30'),
('r23', 'Baby pink mirror-work set', 'KoraNM', 'KoraNM', 43050, 'INR', 'https://koranm.com/products/baby-pink-indo-western-set-with-mirror-work-and-trouser', 'https://cdn.shopify.com/s/files/1/0583/3221/7421/files/KO-62044-B-8.jpg', 'ready', 23, '2026-10-01T00:00:00+05:30'),
('r24', 'Pink ombre long jacket', 'KoraNM', 'KoraNM', 37850, 'INR', 'https://koranm.com/products/ivory-and-pink-indo-western-kurta-set', 'https://cdn.shopify.com/s/files/1/0583/3221/7421/files/KO-62046-Ivory_Pink-1.jpg', 'ready', 24, '2026-10-01T00:00:00+05:30'),
('r25', 'Cream-pista ombre with dupatta', 'KoraNM', 'KoraNM', 23990, 'INR', 'https://koranm.com/products/cream-pista-bundi-and-kurta-set-that-is-ombre-dyed-with-embroided-motifs-with-a-dupatta-and-an-off-white-aligadhi-pant', 'https://cdn.shopify.com/s/files/1/0583/3221/7421/files/KBR-50158-Cream_Pista-4.jpg', 'ready', 25, '2026-10-01T00:00:00+05:30'),
('r26', 'Ivory-yellow ombre with scarf', 'KoraNM', 'KoraNM', 17985, 'INR', 'https://koranm.com/products/off-white-and-yellow-ombre-kurta-bandi-set', 'https://cdn.shopify.com/s/files/1/0583/3221/7421/files/KBR-50106-YELLOW-1.jpg', 'ready', 26, '2026-10-01T00:00:00+05:30'),
('r27', 'Ivory-green ombre with scarf', 'KoraNM', 'KoraNM', 17985, 'INR', 'https://koranm.com/products/fresh-leaf-green-ombre-kurta-bandi-set', 'https://cdn.shopify.com/s/files/1/0583/3221/7421/files/KBR-50106-GREEN-2.jpg', 'ready', 27, '2026-10-01T00:00:00+05:30'),
('r28', 'Grey-green asymmetric sherwani', 'KoraNM', 'KoraNM', 39965, 'INR', 'https://koranm.com/products/greyish-green-embroidered-traditional-sherwani-set', 'https://cdn.shopify.com/s/files/1/0583/3221/7421/files/NM-61015-PISTA-4.jpg', 'ready', 28, '2026-10-01T00:00:00+05:30'),
('r29', 'Ivory-blue ombre with scarf', 'KoraNM', 'KoraNM', 17985, 'INR', 'https://koranm.com/products/ocean-blue-ombre-kurta-bandi-set', 'https://cdn.shopify.com/s/files/1/0583/3221/7421/files/KBR-50106-BLUE-1.jpg', 'ready', 29, '2026-10-01T00:00:00+05:30'),
('r30', 'Pink stripe sherwani', 'KoraNM', 'KoraNM', 27900, 'INR', 'https://koranm.com/products/pink-hil-silk-sherwani-with-aligarhi-for-men', 'https://cdn.shopify.com/s/files/1/0583/3221/7421/files/pink-hil-silk-sherwani-aligarhi-side-view.jpg', 'ready', 30, '2026-10-01T00:00:00+05:30'),
('r31', 'Grape velvet indo-western', 'Manyavar', 'Manyavar', 15999, 'INR', 'https://www.manyavar.com/en-in/indo-western/grape-velvet-splendor-indo-western/UC147718.html', 'https://manyavar.scene7.com/is/image/manyavar/CPIW769V-322-Wine-4-101_17-08-2021-04-48', 'ready', 31, '2026-10-01T00:00:00+05:30'),
('d01', 'Dusty pink draped set', 'Philocaly', 'Pernia''s Pop-Up Shop', 45000, 'INR', 'https://www.perniaspopupshop.com/philocaly-dusty-pink-raw-silk-satin-embroidered-indowestern-set-phila082614.html', 'https://img.perniaspopupshop.com/catalog/product/p/h/PHILA082614_1.jpg', 'designer', 32, '2026-10-01T00:00:00+05:30'),
('d02', 'Orange mirror-work long jacket', 'Sharad Raghav', 'Pernia''s Pop-Up Shop', 64999, 'INR', 'https://www.perniaspopupshop.com/sharad-raghav-men-orange-zari-silk-mirror-work-indowestern-set-shrag0726124.html', 'https://img.perniaspopupshop.com/catalog/product/s/h/SHRAG0726124_1.jpg', 'designer', 33, '2026-10-01T00:00:00+05:30'),
('d03', 'Yellow tie-dye draped kurta', 'Kushal''s', 'Pernia''s Pop-Up Shop', 18000, 'INR', 'https://www.perniaspopupshop.com/kushal-s-men-yellow-chanderi-tie-dye-draped-kurta-set-kush102305.html', 'https://img.perniaspopupshop.com/catalog/product/k/u/KUSH102305_1.jpg', 'designer', 34, '2026-10-01T00:00:00+05:30'),
('d04', 'Dusty pink long jacket', 'Salil Bhatia', 'Pernia''s Pop-Up Shop', 28800, 'INR', 'https://www.perniaspopupshop.com/salil-bhatia-dusty-pink-dola-silk-thread-work-long-jacket-set-sabh062631.html', 'https://img.perniaspopupshop.com/catalog/product/s/a/SABH062631_1.jpg', 'designer', 35, '2026-10-01T00:00:00+05:30'),
('d05', 'Brocade jacket, dhoti drape', 'Soniya G', 'Pernia''s Pop-Up Shop', 37425, 'INR', 'https://www.perniaspopupshop.com/soniya-g-men-mustard-yellow-handloom-embroidered-jacket-set-sngc102524.html', 'https://img.perniaspopupshop.com/catalog/product/s/n/SNGC102524_1.JPG', 'designer', 36, '2026-10-01T00:00:00+05:30'),
('d06', 'Rose quartz applique set', 'Shantanu & Nikhil', 'Pernia''s Pop-Up Shop', 270500, 'INR', 'https://www.perniaspopupshop.com/shantnu-nikhil-men-rose-quartz-matka-silk-applique-embroidered-indowestern-set-nasc122413.html', 'https://img.perniaspopupshop.com/catalog/product/n/a/NASC122413_1.jpg', 'designer', 37, '2026-10-01T00:00:00+05:30'),
('d07', 'Peach long jacket set', 'Sammohan', 'Pernia''s Pop-Up Shop', 73700, 'INR', 'https://www.perniaspopupshop.com/sammohan-peach-raw-silk-hand-machine-embroidered-indowestern-set-samm062555.html', 'https://img.perniaspopupshop.com/catalog/product/s/a/samm062555_1.jpg', 'designer', 38, '2026-10-01T00:00:00+05:30'),
('d08', 'Blush jacket, scarf at neck', 'Dolly J', 'Pernia''s Pop-Up Shop', 240000, 'INR', 'https://www.perniaspopupshop.com/dolly-j-man-blush-handloom-matka-silk-hand-embroidered-long-jacket-set-dllcm082659.html', 'https://img.perniaspopupshop.com/catalog/product/d/l/DLLCM082659_1.jpg', 'designer', 39, '2026-10-01T00:00:00+05:30'),
('d09', 'Blush hand-embroidered long jacket', 'Dolly J', 'Pernia''s Pop-Up Shop', 260000, 'INR', 'https://www.perniaspopupshop.com/dolly-j-man-blush-handloom-matka-silk-hand-embroidered-long-jacket-set-dllcm082660.html', 'https://img.perniaspopupshop.com/catalog/product/d/l/DLLCM082660_1.jpg', 'designer', 40, '2026-10-01T00:00:00+05:30'),
('d10', 'Mint embroidered bomber set', 'Jayesh & Kaajal Shah', 'Pernia''s Pop-Up Shop', 81900, 'INR', 'https://www.perniaspopupshop.com/jayesh-and-kaajal-shah-men-mint-silk-embroidered-bomber-jacket-set-jash062641.html', 'https://img.perniaspopupshop.com/catalog/product/j/a/jash062641_1_1.jpg', 'designer', 41, '2026-10-01T00:00:00+05:30'),
('d11', 'Pink tie-dye open jacket', 'Dev Kumar', 'Pernia''s Pop-Up Shop', 40792, 'INR', 'https://www.perniaspopupshop.com/dev-kumar-baby-pink-raw-silk-pearl-embroidered-tie-dye-open-jacket-set-devk082607.html', 'https://img.perniaspopupshop.com/catalog/product/d/e/DEVK082607_1.jpg', 'designer', 42, '2026-10-01T00:00:00+05:30'),
('d12', 'Yellow asymmetric jacket', 'Dapper Dare', 'Pernia''s Pop-Up Shop', 97500, 'INR', 'https://www.perniaspopupshop.com/dapper-dare-yellow-silk-satin-resham-cutdana-work-asymmetric-jacket-set-dadr112503.html', 'https://img.perniaspopupshop.com/catalog/product/d/a/DADR112503_1.jpg', 'designer', 43, '2026-10-01T00:00:00+05:30'),
('d13', 'Wine velvet set with drape', 'Rohit Gandhi + Rahul Khanna', 'Pernia''s Pop-Up Shop', 246400, 'INR', 'https://www.perniaspopupshop.com/rohit-gandhi-rahul-khanna-men-wine-velvet-indowestern-set-rgmc092503.html', 'https://img.perniaspopupshop.com/catalog/product/r/g/RGMC092503_1.jpg', 'designer', 44, '2026-10-01T00:00:00+05:30'),
('d14', 'Plum velvet sculpted set', 'Amit Aggarwal', 'Pernia''s Pop-Up Shop', 275000, 'INR', 'https://www.perniaspopupshop.com/amit-aggarwal-men-plum-velvet-indowestern-set-aagm052505.html', 'https://img.perniaspopupshop.com/catalog/product/a/a/AAGM052505_1.jpg', 'designer', 45, '2026-10-01T00:00:00+05:30'),
('d15', 'Peach Kashmiri bandhgala, drape', 'Asuka', 'Pernia''s Pop-Up Shop', 52500, 'INR', 'https://www.perniaspopupshop.com/asuka-peach-linen-kashmiri-embroidered-bandhgala-set-ausk122453.html', 'https://img.perniaspopupshop.com/catalog/product/a/u/AUSK122453_1.jpg', 'designer', 46, '2026-10-01T00:00:00+05:30'),
('d16', 'Blush silk jacket set', 'Contrast by Parth', 'Pernia''s Pop-Up Shop', 52000, 'INR', 'https://www.perniaspopupshop.com/contrast-by-parth-blush-pink-bhagalpuri-silk-hand-machine-embroidered-jacket-set-cspt102601.html', 'https://img.perniaspopupshop.com/catalog/product/c/s/CSPT102601_1.jpg', 'designer', 47, '2026-10-01T00:00:00+05:30'),
('d17', 'Pink sequin indo-western', 'Dhananjay', 'Pernia''s Pop-Up Shop', 52900, 'INR', 'https://www.perniaspopupshop.com/dhananjay-pink-linen-silk-sequins-embroidered-indowestern-set-dhaj062667.html', 'https://img.perniaspopupshop.com/catalog/product/d/h/DHAJ062667_1.jpg', 'designer', 48, '2026-10-01T00:00:00+05:30'),
('d18', 'Lilac velvet bandhgala, drape', 'Asuka', 'Pernia''s Pop-Up Shop', 34500, 'INR', 'https://www.perniaspopupshop.com/asuka-lilac-velvet-embroidered-bandhgala-jacket-set-ausk072313.html', 'https://img.perniaspopupshop.com/catalog/product/a/u/AUSK072313_1.jpg', 'designer', 49, '2026-10-01T00:00:00+05:30'),
('d19', 'Floral bandhgala jacket', 'Asuka', 'Pernia''s Pop-Up Shop', 34500, 'INR', 'https://www.perniaspopupshop.com/asuka-off-white-embroidered-bandhgala-jacket-set-ausk012326.html', 'https://img.perniaspopupshop.com/catalog/product/a/u/AUSK012326_1.jpg', 'designer', 50, '2026-10-01T00:00:00+05:30'),
('d20', 'Pastel pink jacquard set', 'Zoop', 'Pernia''s Pop-Up Shop', 22942, 'INR', 'https://www.perniaspopupshop.com/zoop-pastel-pink-poly-cotton-jacquard-printed-indo-western-set-zoop042313.html', 'https://img.perniaspopupshop.com/catalog/product/z/o/ZOOP042313_1.jpg', 'designer', 51, '2026-10-01T00:00:00+05:30'),
('d21', 'Peach cutdana open jacket', 'Nero by Shaifali & Satya', 'Pernia''s Pop-Up Shop', 42000, 'INR', 'https://www.perniaspopupshop.com/nero-by-shaifali-satya-peach-silk-cutdana-handwork-open-jacket-set-nbss082638.html', 'https://img.perniaspopupshop.com/catalog/product/n/b/NBSS082638_1.jpg', 'designer', 52, '2026-10-01T00:00:00+05:30'),
('d22', 'Black-ivory floral long jacket', 'Gargee', 'Pernia''s Pop-Up Shop', 68000, 'INR', 'https://www.perniaspopupshop.com/gargee-designers-black-polyester-floral-embroidered-indowestern-set-garg092628.html', 'https://img.perniaspopupshop.com/catalog/product/g/a/GARG092628_1.jpg', 'designer', 53, '2026-10-01T00:00:00+05:30'),
('d23', 'Royal blue geometric long jacket', 'Asuka', 'Pernia''s Pop-Up Shop', 47500, 'INR', 'https://www.perniaspopupshop.com/asuka-royal-blue-cotton-silk-embroidered-indowestern-set-ausk032301.html', 'https://img.perniaspopupshop.com/catalog/product/a/u/AUSK032301_1.jpg', 'designer', 54, '2026-10-01T00:00:00+05:30'),
('d24', 'Burgundy velvet Vanguard bandhgala', 'Rohit Gandhi + Rahul Khanna', 'Aza Fashions', 245000, 'INR', 'https://www.azafashions.com/products/rohit-gandhi-rahul-khanna-vanguard-embroidered-bandhgala/763965', 'https://static3.azafashions.com/tr:w-900/uploads/product_gallery/1791291956948_1.jpg', 'designer', 55, '2026-10-01T00:00:00+05:30'),
('d25', 'Black velvet embroidered tuxedo', 'Rohit Bal', 'Aza Fashions', 99999, 'INR', 'https://www.azafashions.com/products/rohit-bal-velvet-embroidered-tuxedo/532993', 'https://static3.azafashions.com/tr:w-900/uploads/product_gallery/1717252837430_1.jpg', 'designer', 56, '2026-10-01T00:00:00+05:30')
on conflict do nothing;
