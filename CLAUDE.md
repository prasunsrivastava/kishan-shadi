# Kishan Shadi outfit site: notes for Claude Code

A small site where Prasun's family votes on outfits for Kishan's wedding functions
(sangeet and others). Family members can also suggest outfits with photos or
links. A daily run on Prasun's laptop finds similar outfits for sale in India and
adds them for voting.

- Live site: https://prasunsrivastava.github.io/kishan-shadi/
- Results page: https://prasunsrivastava.github.io/kishan-shadi/analytics.html
- Repo: https://github.com/prasunsrivastava/kishan-shadi (public)
- Supabase project: https://vongllgjlahappivjjtr.supabase.co (free tier)

## Writing style for Prasun

- Give options first and let him choose before you build anything large.
- Ask clarifying questions one at a time.
- Use plain, short sentences in active voice (ASD-STE100 style). No jargon, no
  metaphors, no filler.

## How it works

- Static site on GitHub Pages: plain HTML, CSS and JavaScript. No build step.
- Supabase stores the data. The site uses only the **publishable** key, which is
  in `config.js` (Prasun accepted that it is public).
- All tables are locked (RLS on, no grants to `anon`/`authenticated`). The site can
  only call password-checked functions (`security definer`). The family
  password is stored as a bcrypt hash in `app_secret`.
- The daily run uses the **secret** key from `.env` on Prasun's laptop. Never put
  the secret key in any tracked file, in the site, or in a commit.

## Files

| File | What it does |
|---|---|
| `index.html`, `gallery.js` | Outfit gallery: sign-in, hearts, filters (All, New, Ready to buy, Designer, My likes), photo viewer, "Suggest an outfit" form and the person's own suggestions |
| `analytics.html`, `analytics.js` | Results: totals, most liked, who liked what |
| `common.js` | Shared code: API calls, demo mode, sign-in card, outfit list loading, photo shrinking, refresh only while the tab is visible |
| `style.css` | All styles, light and dark |
| `config.js` | Supabase URL and publishable key. Empty values = demo mode (password `demo`) |
| `items.js` | The first 56 outfits. Now only a fallback and demo data. The live list is the `items` table |
| `supabase/setup.sql` | Step 1: likes, family password, sign-in and like functions |
| `supabase/setup2.sql` | Step 2: `items`, `suggestions`, `suggestion_photos` tables and their functions, plus the 56 seed outfits |
| `worker/sb.py` | Helper for the daily run (reads suggestions, saves photos, adds outfits). Python standard library only |
| `worker/PROCESS_SUGGESTIONS.md` | The instructions for the daily run |
| `worker/run-daily.sh` | Runs the daily search headless with `claude -p` |
| `TASTE.local.md` | Prasun's notes on the style he likes. Not in git. Ask him for it if it is missing |

## Database

Tables (all locked to the public key):
- `likes(voter, voter_display, item_id, created_at)`. `voter` is the lower-case name.
- `app_secret(id=1, pw_hash)`.
- `items(id, name, brand, shop, price, currency, url unique, img, grp, status live|hidden, suggestion_id, note, sort_order, added_at)`.
- `suggestions(id, voter, voter_display, links text[], note, status new|working|done|skipped, result_note, created_at, processed_at)`.
- `suggestion_photos(suggestion_id, idx 1..10, photo)`. Photos are JPEG data URLs, shrunk in the browser to at most 1000 px.

Functions the site calls (each checks the family password):
`family_sign_in`, `family_set_like`, `family_all_likes`, `family_items`,
`family_suggest` (1 to 10 photos and/or 1 to 10 links; 10 suggestions per person
per day; 100 waiting in total), `family_my_suggestions`.

To change the family password, run only the last statement of `setup.sql`.

## Outfit ids

- `r..` ready-to-buy and `d..` designer outfits from the first list.
- `s001`, `s002`, ... outfits added from suggestions (`sb.py add` picks the next id).
- Never reuse or rename an id. Likes are stored against it. To remove an outfit,
  hide it: `python3 worker/sb.py hide ID`.
- An outfit shows the "New" tag for 14 days after `added_at`.

## Daily run

- Setup on the laptop: copy `.env.example` to `.env` and paste the secret key
  (Supabase > Project Settings > API Keys > Secret keys). Then test with
  `python3 worker/sb.py new`.
- Manual run: open Claude Code in this folder and say "process new suggestions".
  Follow `worker/PROCESS_SUGGESTIONS.md`.
- Scheduled run: `worker/run-daily.sh`, once a day. On macOS use launchd or cron,
  for example `crontab -e` with
  `30 9 * * * /bin/bash /path/to/kishan-shadi/worker/run-daily.sh`.
  The laptop must be awake. Chrome must be open if the run uses Claude in Chrome.
  Logs go to `worker/logs/`.
- The run can use Claude in Chrome or the agent-browser command. Check that the
  flags in `run-daily.sh` match the installed Claude Code version
  (`claude --help`).

## Making changes

- Test locally: `python3 -m http.server 8000` and open http://localhost:8000.
  With real keys in `config.js` it uses the real database, so test with a test
  name and remove the rows after. With empty keys it runs in demo mode.
- GitHub Pages and browsers keep old files for up to 10 minutes. After you
  change a `.js` or `.css` file, increase the `?v=` number in the `<script>` and
  `<link>` tags of both HTML files (now `?v=2`), so families get the new file at once.
- New SQL: write a new file (for example `supabase/setup3.sql`) that can run more
  than once. Prasun runs it in the Supabase SQL Editor. Lock new tables the same
  way and check the password in every new function.
- Keep the site free of build tools and frameworks. Plain files only.
- Photos load from the shop websites. Check new photo addresses with
  `python3 worker/sb.py check-img URL`.
- The pages ask search engines not to list them (`noindex`). Keep that.
