#!/usr/bin/env python3
"""Helper for the daily suggestion run. It talks to Supabase with the secret key.

The key and the project address come from the file .env in the repo folder:
    SUPABASE_URL=https://vongllgjlahappivjjtr.supabase.co
    SUPABASE_SECRET_KEY=sb_secret_...
The file .env is never uploaded to GitHub (see .gitignore).

Commands (run from the repo folder):
    python3 worker/sb.py new                    list suggestions that wait for a search
    python3 worker/sb.py claim ID               mark a suggestion as "being searched"
    python3 worker/sb.py photos ID              save its photos to worker/photos/ID/
    python3 worker/sb.py existing               list the outfits already on the site
    python3 worker/sb.py check-img URL          check that a photo address loads from outside the shop
    python3 worker/sb.py add ID FILE.json       add outfits found for suggestion ID
    python3 worker/sb.py finish ID done "note"  close a suggestion (done or skipped)
    python3 worker/sb.py release ID             put a suggestion back to "new"
    python3 worker/sb.py hide ITEM_ID           take an outfit off the site (likes are kept)
    python3 worker/sb.py show ITEM_ID           put a hidden outfit back

FILE.json holds a list of outfits:
    [{"name": "Peach ombre long jacket", "brand": "Kalki", "shop": "Kalki",
      "price": 34599, "currency": "INR", "group": "ready",
      "url": "https://...product page...", "img": "https://...photo...",
      "note": "Same peach ombre and long jacket as the photo"}]
"""
import base64
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
STALE_HOURS = 6          # a "working" suggestion older than this is treated as new again
MAX_ADD = 8              # outfits per suggestion


def load_env():
    env = {}
    path = os.path.join(ROOT, ".env")
    if os.path.exists(path):
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    for k in ("SUPABASE_URL", "SUPABASE_SECRET_KEY", "SUPABASE_REST"):
        if os.environ.get(k):
            env[k] = os.environ[k]
    if not env.get("SUPABASE_URL") or not env.get("SUPABASE_SECRET_KEY"):
        sys.exit("Missing SUPABASE_URL or SUPABASE_SECRET_KEY. Copy .env.example to .env and fill it in.")
    return env


ENV = None


def api(method, path, body=None, prefer=None):
    """Calls the Supabase REST API. path is like 'items?select=id'."""
    global ENV
    ENV = ENV or load_env()
    base = ENV.get("SUPABASE_REST") or ENV["SUPABASE_URL"].rstrip("/") + "/rest/v1"
    key = ENV["SUPABASE_SECRET_KEY"]
    headers = {"apikey": key, "Content-Type": "application/json", "Accept": "application/json"}
    if key.startswith("eyJ"):                       # older JWT-style keys also need this header
        headers["Authorization"] = "Bearer " + key
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + "/" + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            text = r.read().decode()
    except urllib.error.HTTPError as e:
        sys.exit(f"Supabase error {e.code}: {e.read().decode()[:400]}")
    return json.loads(text) if text.strip() else None


def out(obj):
    print(json.dumps(obj, indent=2, ensure_ascii=False, default=str))


def get_suggestion(sid):
    rows = api("GET", f"suggestions?id=eq.{int(sid)}&select=id,voter_display,links,note,status,created_at")
    if not rows:
        sys.exit(f"No suggestion with id {sid}.")
    return rows[0]


def cmd_new():
    stale = (datetime.now(timezone.utc) - timedelta(hours=STALE_HOURS)).isoformat()
    q = ("suggestions?select=id,voter_display,links,note,status,created_at,processed_at,suggestion_photos(count)"
         f"&or=(status.eq.new,and(status.eq.working,processed_at.lt.{urllib.parse.quote(stale)}))"
         "&order=created_at.asc")
    rows = api("GET", q)
    for r in rows:
        r["photo_count"] = (r.pop("suggestion_photos") or [{"count": 0}])[0]["count"]
    out(rows)


def cmd_claim(sid):
    api("PATCH", f"suggestions?id=eq.{int(sid)}", {"status": "working", "processed_at": datetime.now(timezone.utc).isoformat()})
    print(f"Suggestion {sid} is now marked as being searched.")


def cmd_release(sid):
    api("PATCH", f"suggestions?id=eq.{int(sid)}", {"status": "new", "processed_at": None})
    print(f"Suggestion {sid} is back to new.")


def cmd_photos(sid):
    rows = api("GET", f"suggestion_photos?suggestion_id=eq.{int(sid)}&select=idx,photo&order=idx")
    folder = os.path.join(ROOT, "worker", "photos", str(int(sid)))
    os.makedirs(folder, exist_ok=True)
    paths = []
    for r in rows:
        m = re.match(r"^data:image/(jpeg|png|webp);base64,(.+)$", r["photo"], re.S)
        if not m:
            continue
        ext = "jpg" if m.group(1) == "jpeg" else m.group(1)
        p = os.path.join(folder, f"{r['idx']}.{ext}")
        with open(p, "wb") as f:
            f.write(base64.b64decode(m.group(2)))
        paths.append(p)
    out({"suggestion": get_suggestion(sid), "photos": paths})


def cmd_existing():
    rows = api("GET", "items?select=id,name,brand,shop,url,status,suggestion_id&order=sort_order,added_at,id")
    out(rows)


def cmd_check_img(url):
    req = urllib.request.Request(url, method="GET", headers={
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36",
        "Referer": "https://prasunsrivastava.github.io/"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            ctype = r.headers.get("Content-Type", "")
            size = len(r.read(2_000_000))
        ok = ctype.startswith("image/") and size > 2000
        out({"ok": ok, "status": r.status, "type": ctype, "bytes": size})
        if not ok:
            sys.exit(1)
    except Exception as e:  # noqa: BLE001
        out({"ok": False, "error": str(e)[:200]})
        sys.exit(1)


def next_ids(n):
    rows = api("GET", "items?select=id&id=like.s*")
    nums = [int(r["id"][1:]) for r in rows if re.fullmatch(r"s\d+", r["id"])]
    start = max(nums, default=0) + 1
    return [f"s{start + i:03d}" for i in range(n)]


def cmd_add(sid, file):
    sug = get_suggestion(sid)
    data = json.load(sys.stdin if file == "-" else open(file, encoding="utf-8"))
    if isinstance(data, dict):
        data = [data]
    if not data:
        sys.exit("The file has no outfits.")
    if len(data) > MAX_ADD:
        sys.exit(f"Add at most {MAX_ADD} outfits for one suggestion.")
    have = {r["url"].rstrip("/").lower() for r in api("GET", "items?select=url")}
    rows, problems = [], []
    for n, it in enumerate(data, 1):
        def need(k):
            v = it.get(k)
            if v in (None, ""):
                problems.append(f"outfit {n}: '{k}' is missing")
            return v
        name, brand, shop, url, img = (need(k) for k in ("name", "brand", "shop", "url", "img"))
        price, currency = need("price"), it.get("currency", "INR")
        group = it.get("group") or it.get("grp") or "ready"
        if url and not str(url).startswith("https://"):
            problems.append(f"outfit {n}: url must start with https://")
        if img and not str(img).startswith("https://"):
            problems.append(f"outfit {n}: img must start with https://")
        if currency not in ("INR", "USD"):
            problems.append(f"outfit {n}: currency must be INR or USD")
        if group not in ("ready", "designer"):
            problems.append(f"outfit {n}: group must be ready or designer")
        try:
            price = float(price)
        except (TypeError, ValueError):
            problems.append(f"outfit {n}: price must be a number")
        if url and url.rstrip("/").lower() in have:
            problems.append(f"outfit {n}: already on the site ({url})")
        rows.append({"name": str(name)[:80] if name else name, "brand": brand, "shop": shop, "price": price,
                     "currency": currency, "grp": group, "url": url, "img": img,
                     "note": (it.get("note") or "")[:200], "suggestion_id": int(sid), "sort_order": 1000})
    if problems:
        sys.exit("Nothing was added. Fix these first:\n- " + "\n- ".join(problems))
    for row, new_id in zip(rows, next_ids(len(rows))):
        row["id"] = new_id
    api("POST", "items", rows, prefer="return=minimal")
    print(f"Added {len(rows)} outfit(s) for suggestion {sid} from {sug['voter_display']}: " + ", ".join(r["id"] for r in rows))


def cmd_finish(sid, status, note):
    if status not in ("done", "skipped"):
        sys.exit("Status must be done or skipped.")
    api("PATCH", f"suggestions?id=eq.{int(sid)}",
        {"status": status, "result_note": (note or "")[:300], "processed_at": datetime.now(timezone.utc).isoformat()})
    print(f"Suggestion {sid} closed as {status}.")


def cmd_status(item_id, status):
    api("PATCH", f"items?id=eq.{urllib.parse.quote(item_id)}", {"status": status})
    print(f"Outfit {item_id} is now {status}.")


def main(a):
    if not a or a[0] in ("-h", "--help", "help"):
        print(__doc__)
        return
    c = a[0]
    try:
        if c == "new": cmd_new()
        elif c == "claim": cmd_claim(a[1])
        elif c == "release": cmd_release(a[1])
        elif c == "photos": cmd_photos(a[1])
        elif c == "existing": cmd_existing()
        elif c == "check-img": cmd_check_img(a[1])
        elif c == "add": cmd_add(a[1], a[2])
        elif c == "finish": cmd_finish(a[1], a[2], a[3] if len(a) > 3 else "")
        elif c == "hide": cmd_status(a[1], "hidden")
        elif c == "show": cmd_status(a[1], "live")
        else: sys.exit(f"Unknown command: {c}. Run with --help.")
    except IndexError:
        sys.exit("Missing a value. Run with --help.")


if __name__ == "__main__":
    main(sys.argv[1:])
