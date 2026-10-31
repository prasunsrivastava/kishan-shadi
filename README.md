# Kishan Shadi Outfits

A small website for the family to like outfits for Kishan's wedding functions.

- `index.html`: the outfit gallery. Each person types their name and the family password, then taps hearts.
- `analytics.html`: the results page. It shows the most liked outfits, who liked what, and totals. It updates every 30 seconds.
- `items.js`: the list of 56 outfits (31 ready to buy, 25 designer).
- `config.js`: your Supabase address and key.
- `supabase/setup.sql`: the database setup.

The site has no server. GitHub Pages hosts the pages for free. Supabase (free tier) stores the likes.

## Step 1: Set up Supabase (about 10 minutes)

1. Sign in at https://supabase.com and click **New project**. Give it any name, for example `kishan-shadi`. Pick the region **Mumbai** (ap-south-1). Set a database password and keep it safe. You do not need it for the site.
2. When the project is ready, open **SQL Editor** in the left menu, then click **New query**.
3. Open `supabase/setup.sql`, copy all of it, and paste it into the editor.
4. Near the bottom of the file, replace `CHANGE-ME` with the family password you want to use.
5. Click **Run**. You should see "Success. No rows returned".
6. Open **Project Settings > API Keys** (on some screens: **Data API**). Copy:
   - the **Project URL** (looks like `https://abcdefghijkl.supabase.co`)
   - the **publishable** key (starts with `sb_publishable_`). The older **anon** key also works.

Both values are safe to put on a public website. The tables are locked. The site can only call three functions, and each one checks the family password inside Supabase.

To change the password later, run only the last statement of `setup.sql` again with the new password.

## Step 2: Add the values to config.js

Open `config.js` and paste the two values:

```js
SUPABASE_URL: "https://abcdefghijkl.supabase.co",
SUPABASE_KEY: "sb_publishable_xxxxxxxx",
```

If you leave them empty, the site runs in demo mode. The demo password is `demo`, and likes stay only on that device.

## Step 3: GitHub Pages

This repository is already set up to publish from the `main` branch. The site is at https://prasunsrivastava.github.io/kishan-shadi/ and the results page is at https://prasunsrivastava.github.io/kishan-shadi/analytics.html.

After you change a file on GitHub, the site updates in about a minute.

The repository is public, so anyone can see the code and the outfit list. They cannot see or change the likes without the family password. The pages also ask search engines not to list them.

## Day-to-day notes

- Ask each person to use the same name every time. "Meena Aunty" and "meena aunty" count as the same person. "Meena" is a different person.
- To remove a stray name or all likes, open Supabase **Table Editor > likes** and delete the rows.
- To add an outfit, copy one line in `items.js`, give it a new `id` (for example `r32`), and upload the file again. Never reuse an old `id`, because likes are stored against it.
- Photos load from the shop websites. If a shop removes a product, its photo will stop showing.
