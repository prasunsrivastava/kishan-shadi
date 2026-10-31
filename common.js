// Shared code for the gallery and the results page.
(function () {
  const C = window.CONFIG || {};
  const DEMO = !C.SUPABASE_URL || !C.SUPABASE_KEY;
  const KEY_NAME = "ks_name", KEY_PW = "ks_pw", KEY_DEMO = "ks_demo_likes", KEY_DEMO_SUG = "ks_demo_suggestions";
  const MAX_PHOTOS = 10, MAX_LINKS = 10;

  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del(k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  // Demo backend: keeps likes on this device only.
  function demoRows() { try { return JSON.parse(store.get(KEY_DEMO) || "[]"); } catch (e) { return []; } }
  function demo(fn, b) {
    if (b.p_password !== "demo") throw new Error("wrong_password");
    const clean = s => (s || "").replace(/\s+/g, " ").trim().slice(0, 40);
    let rows = demoRows();
    if (fn === "family_sign_in") {
      const n = clean(b.p_name);
      if (n.length < 2) throw new Error("name_too_short");
      return { name: n, likes: rows.filter(r => r.voter === n.toLowerCase()).map(r => r.item_id) };
    }
    if (fn === "family_set_like") {
      const n = clean(b.p_name), v = n.toLowerCase();
      rows = rows.filter(r => !(r.voter === v && r.item_id === b.p_item));
      if (b.p_liked) rows.push({ voter: v, voter_display: n, item_id: b.p_item, created_at: new Date().toISOString() });
      store.set(KEY_DEMO, JSON.stringify(rows));
      return null;
    }
    if (fn === "family_all_likes") return rows;
    if (fn === "family_items") return (window.ITEMS || []).map(i => Object.assign({ grp: i.group }, i));
    let sug = [];
    try { sug = JSON.parse(store.get(KEY_DEMO_SUG) || "[]"); } catch (e) {}
    if (fn === "family_suggest") {
      const links = (b.p_links || []).map(s => s.trim()).filter(Boolean), photos = b.p_photos || [];
      if (links.length > MAX_LINKS) throw new Error("too_many_links");
      if (photos.length > MAX_PHOTOS) throw new Error("too_many_photos");
      if (links.some(l => !/^https?:\/\/\S+$/i.test(l))) throw new Error("bad_link");
      if (!links.length && !photos.length) throw new Error("empty_suggestion");
      // Demo keeps only the first photo, so the device storage does not fill up.
      sug.unshift({ id: Date.now(), voter: clean(b.p_name).toLowerCase(), links, note: b.p_note || "", status: "new", result_note: null,
        created_at: new Date().toISOString(), photo_count: photos.length, cover: photos[0] || null, added: [] });
      store.set(KEY_DEMO_SUG, JSON.stringify(sug.slice(0, 5)));
      return sug[0].id;
    }
    if (fn === "family_my_suggestions") return sug.filter(s => s.voter === clean(b.p_name).toLowerCase());
    throw new Error("unknown");
  }

  async function rpc(fn, body) {
    if (DEMO) return demo(fn, body);
    const headers = { "Content-Type": "application/json", apikey: C.SUPABASE_KEY };
    if (C.SUPABASE_KEY.startsWith("eyJ")) headers.Authorization = "Bearer " + C.SUPABASE_KEY;
    let r;
    try {
      r = await fetch(C.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/rpc/" + fn, { method: "POST", headers, body: JSON.stringify(body) });
    } catch (e) { throw new Error("network"); }
    const text = await r.text();
    if (!r.ok) {
      let msg = text;
      try { msg = JSON.parse(text).message || text; } catch (e) {}
      throw new Error(msg || "http_" + r.status);
    }
    return text ? JSON.parse(text) : null;
  }

  function errorText(e) {
    const m = String(e && e.message || e);
    if (m.includes("wrong_password")) return "That password is not right. Ask " + (C.ORGANISER || "the organiser") + " for the family password.";
    if (m.includes("name_too_short")) return "Please type your name (at least 2 letters).";
    if (m === "network") return "Could not reach the server. Check your internet and try again.";
    if (m.includes("empty_suggestion")) return "Please add at least one photo or one link.";
    if (m.includes("too_many_photos")) return "You can send up to " + MAX_PHOTOS + " photos at a time.";
    if (m.includes("too_many_links")) return "You can send up to " + MAX_LINKS + " links at a time.";
    if (m.includes("bad_link")) return "One of the links is not a web address. Each link must start with http:// or https://.";
    if (m.includes("bad_photo")) return "One of the photos could not be used. Please try a different photo.";
    if (m.includes("daily_limit")) return "You have sent 10 suggestions today. Please send more tomorrow.";
    if (m.includes("queue_full")) return "There are many suggestions waiting. Please try again in a day or two.";
    if (m.includes("Could not find the function") || m.includes("PGRST202")) return "This feature is not switched on yet. Ask " + (C.ORGANISER || "the organiser") + " to finish the setup.";
    return "Something went wrong (" + m.slice(0, 80) + "). Please try again.";
  }

  const session = {
    load() { const n = store.get(KEY_NAME), p = store.get(KEY_PW); return n && p ? { name: n, password: p } : null; },
    save(n, p) { store.set(KEY_NAME, n); store.set(KEY_PW, p); },
    clear() { store.del(KEY_NAME); store.del(KEY_PW); }
  };

  // The outfit list. It starts with items.js and is replaced by the list from
  // Supabase after sign-in. The array and the lookup object are changed in place,
  // so other files can keep their references.
  const items = [], byId = {};
  function setItems(list) {
    items.length = 0;
    for (const k of Object.keys(byId)) delete byId[k];
    for (const r of list) {
      const it = { id: r.id, name: r.name, brand: r.brand, shop: r.shop, price: Number(r.price), currency: r.currency,
        url: r.url, img: r.img, group: r.group || r.grp, note: r.note || "", added_at: r.added_at || null, suggested_by: r.suggested_by || "" };
      items.push(it); byId[it.id] = it;
    }
  }
  setItems(window.ITEMS || []);

  // Loads the list from Supabase. If step 2 of the setup is not done yet, it keeps items.js.
  async function loadItems(password) {
    try {
      const list = await rpc("family_items", { p_password: password });
      if (Array.isArray(list) && list.length) setItems(list);
      return true;
    } catch (e) {
      if (String(e.message).includes("wrong_password")) throw e;
      return false;
    }
  }

  const NEW_DAYS = 14;
  function isNew(i) { return !!i.added_at && (Date.now() - new Date(i.added_at).getTime()) < NEW_DAYS * 864e5; }

  function price(i) {
    if (i.currency === "USD") return "US$" + i.price.toLocaleString("en-US");
    return "₹" + i.price.toLocaleString("en-IN");
  }
  function thumb(i, w) {
    const src = i.img || "";
    if (src.includes("cdn.shopify.com")) return src + (src.includes("?") ? "&" : "?") + "width=" + w;
    if (src.includes("scene7.com")) return src + (src.includes("?") ? "&" : "?") + "wid=" + w;
    if (src.includes("azafashions.com")) return src.replace("tr:w-900", "tr:w-" + w);
    return src;
  }

  // Runs fn every ms milliseconds, but only while the page is on screen.
  // When the person comes back to the page, it runs fn at once.
  function whileVisible(fn, ms) {
    let t = null;
    const on = () => document.visibilityState === "visible";
    const arm = () => { clearInterval(t); t = on() ? setInterval(fn, ms) : null; };
    const onChange = () => { if (on()) fn(); arm(); };
    document.addEventListener("visibilitychange", onChange);
    arm();
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onChange); };
  }

  // Shrinks a photo to a JPEG that is at most 1000 px on the long side.
  // Returns a data URL (about 100 to 250 KB of text).
  async function shrinkPhoto(file) {
    const url = URL.createObjectURL(file);
    try {
      const img = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error("bad_photo")); i.src = url; });
      for (const [side, q] of [[1000, 0.78], [850, 0.68], [700, 0.6], [560, 0.55]]) {
        const s = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
        const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        const d = c.toDataURL("image/jpeg", q);
        if (d.length <= 380000) return d;
      }
      throw new Error("bad_photo");
    } finally { URL.revokeObjectURL(url); }
  }
  function el(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
      else if (k === "class") e.className = v;
      else e.setAttribute(k, v === true ? "" : v);
    }
    for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
    return e;
  }

  // Sign-in card. Calls onDone({name, password, likes}) after a good sign-in.
  function renderSignIn(mount, onDone, intro) {
    mount.replaceChildren();
    const err = el("p", { class: "form-error", role: "alert", hidden: true });
    const nameIn = el("input", { id: "si-name", name: "name", autocomplete: "name", required: true, maxlength: "40", placeholder: "For example: Meena Aunty" });
    const pwIn = el("input", { id: "si-pw", name: "password", type: "password", autocomplete: "current-password", required: true, placeholder: DEMO ? "Demo password: demo" : "" });
    const btn = el("button", { class: "btn-primary", type: "submit" }, "Enter");
    const form = el("form", { class: "signin", novalidate: true },
      el("h2", {}, "Who is choosing?"),
      el("p", { class: "lede" }, intro),
      el("label", { for: "si-name" }, "Your name"), nameIn,
      el("label", { for: "si-pw" }, "Family password"), pwIn,
      err, btn);
    form.addEventListener("submit", async ev => {
      ev.preventDefault();
      err.hidden = true;
      btn.disabled = true; btn.textContent = "Checking…";
      try {
        const res = await rpc("family_sign_in", { p_name: nameIn.value, p_password: pwIn.value });
        session.save(res.name, pwIn.value);
        onDone({ name: res.name, password: pwIn.value, likes: res.likes || [] });
      } catch (e) {
        err.textContent = errorText(e); err.hidden = false;
        btn.disabled = false; btn.textContent = "Enter";
      }
    });
    mount.append(form);
    nameIn.focus();
  }

  function demoBanner() {
    if (!DEMO) return null;
    return el("div", { class: "demo-banner" }, "Demo mode: likes stay on this device only. Add the Supabase details in config.js to share likes with the family.");
  }

  window.KS = { rpc, errorText, session, items, byId, setItems, loadItems, isNew, price, thumb, el, renderSignIn, demoBanner,
    whileVisible, shrinkPhoto, MAX_PHOTOS, MAX_LINKS, DEMO };
})();
