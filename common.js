// Shared code for the gallery and the results page.
(function () {
  const C = window.CONFIG || {};
  const DEMO = !C.SUPABASE_URL || !C.SUPABASE_KEY;
  const KEY_NAME = "ks_name", KEY_PW = "ks_pw", KEY_DEMO = "ks_demo_likes";

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
    return "Something went wrong (" + m.slice(0, 80) + "). Please try again.";
  }

  const session = {
    load() { const n = store.get(KEY_NAME), p = store.get(KEY_PW); return n && p ? { name: n, password: p } : null; },
    save(n, p) { store.set(KEY_NAME, n); store.set(KEY_PW, p); },
    clear() { store.del(KEY_NAME); store.del(KEY_PW); }
  };

  const items = window.ITEMS || [];
  const byId = Object.fromEntries(items.map(i => [i.id, i]));

  function price(i) {
    if (i.currency === "USD") return "US$" + i.price.toLocaleString("en-US");
    return "₹" + i.price.toLocaleString("en-IN");
  }
  function thumb(i, w) {
    if (i.img.includes("cdn.shopify.com")) return i.img + "?width=" + w;
    if (i.img.includes("scene7.com")) return i.img + "?wid=" + w;
    if (i.img.includes("azafashions.com")) return i.img.replace("tr:w-900", "tr:w-" + w);
    return i.img;
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

  window.KS = { rpc, errorText, session, items, byId, price, thumb, el, renderSignIn, demoBanner, DEMO };
})();
