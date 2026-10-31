# Kishan Shadi Outfits

A small website for the family to like outfits for Kishan's wedding functions, and to suggest new ones.

- Site: https://prasunsrivastava.github.io/kishan-shadi/
- Results: https://prasunsrivastava.github.io/kishan-shadi/analytics.html

What is in this folder:

- `index.html`: the outfit gallery. Each person types their name and the family password, then taps hearts. They can also suggest an outfit with up to 10 photos or links.
- `analytics.html`: the results page. It shows the most liked outfits, who liked what, and totals.
- `config.js`: the Supabase address and the publishable key.
- `supabase/setup.sql` and `supabase/setup2.sql`: the database setup.
- `worker/`: the daily search that turns suggestions into outfits. It runs on Prasun's laptop.
- `items.js`: the first 56 outfits. The live list is now in Supabase.
- `CLAUDE.md`: notes for Claude Code.

The site has no server. GitHub Pages hosts the pages for free. Supabase (free tier) stores the likes, the outfit list and the suggestions. The pages refresh every 30 seconds, but only while they are on screen.

## Setup (already done)

1. Supabase project created. `supabase/setup.sql` run with the family password in place of `CHANGE-ME`.
2. Project URL and publishable key added to `config.js`.
3. GitHub Pages publishes from the `main` branch.

## Step 4: Switch on suggestions

1. In Supabase, open **SQL Editor** and click **New query**.
2. Copy all of `supabase/setup2.sql`, paste it, and click **Run**. You should see "Success. No rows returned".

This moves the outfit list into Supabase and switches on the "Suggest an outfit" form. It does not change the likes or the password. You can run it again safely.

Until you run it, the site shows the 56 outfits from `items.js`, and the suggestion form says the feature is not switched on yet.

## Step 5: Set up the daily search on the laptop

1. Install Claude Code, then run `git clone https://github.com/prasunsrivastava/kishan-shadi` and `cd kishan-shadi`.
2. Put `TASTE.local.md` in this folder. It is never uploaded to GitHub.
3. Copy `.env.example` to `.env`. In Supabase, open **Project Settings > API Keys > Secret keys**, create or copy a secret key, and paste it into `.env`. Never put the secret key anywhere else.
4. Test the connection: `python3 worker/sb.py new`. It prints the waiting suggestions (an empty list `[]` is fine).
5. Run `claude` in the folder and say "set up the daily run from CLAUDE.md". Claude Code checks `worker/run-daily.sh` and schedules it.

To run the search by hand, open Claude Code in the folder and say "process new suggestions".

## Day-to-day notes

- Ask each person to use the same name every time. "Meena Aunty" and "meena aunty" count as the same person. "Meena" is a different person.
- To remove a stray name or all likes, open Supabase **Table Editor > likes** and delete the rows.
- To take an outfit off the site, run `python3 worker/sb.py hide ID`. Never delete or reuse an id, because likes are stored against it.
- Photos load from the shop websites. If a shop removes a product, its photo stops showing.
- To change the family password, run only the last statement of `setup.sql` again with the new password.
- To protect the project: keep sign-ups off in **Authentication > Sign In / Providers**. If the publishable key is misused, create a new one in **Project Settings > API Keys**, delete the old one, and update `config.js`.
