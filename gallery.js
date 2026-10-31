(function () {
  const { rpc, errorText, session, items, loadItems, isNew, price, thumb, el, renderSignIn, demoBanner, whileVisible, shrinkPhoto, MAX_PHOTOS, MAX_LINKS } = window.KS;
  const $ = id => document.getElementById(id);
  const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.4 4.5 6.9 4.5c2.1 0 3.6 1.2 5.1 3 1.5-1.8 3-3 5.1-3 3.5 0 5.5 3.5 4.2 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"/></svg>';

  let me = null;              // { name, password }
  let mine = new Set();       // item ids I like
  let all = [];               // rows from the server: { voter, voter_display, item_id }
  let filter = "all", sort = "list", lbIndex = -1, view = [];
  let stopRefresh = null, itemsLoadedAt = -Infinity;
  const pending = new Set();

  const banner = demoBanner(); if (banner) $("demo").append(banner);

  function toast(msg) {
    const t = el("div", { class: "toast", role: "status" }, msg);
    document.body.append(t); setTimeout(() => t.remove(), 3200);
  }

  function likersOf(id) {
    const names = all.filter(r => r.item_id === id && r.voter !== me.name.toLowerCase()).map(r => r.voter_display);
    if (mine.has(id)) names.unshift("You");
    return names;
  }
  const countOf = id => likersOf(id).length;

  function heartBtn(item, cls) {
    const on = mine.has(item.id), n = countOf(item.id);
    const b = el("button", { class: cls || "heart", type: "button", "aria-pressed": on ? "true" : "false", "aria-label": (on ? "Remove like from " : "Like ") + item.name });
    b.innerHTML = HEART + "<span>" + (on ? "Liked" : "Like") + (n ? " · " + n : "") + "</span>";
    b.addEventListener("click", () => toggle(item));
    return b;
  }

  async function toggle(item) {
    if (pending.has(item.id)) return;
    const want = !mine.has(item.id);
    pending.add(item.id);
    want ? mine.add(item.id) : mine.delete(item.id);
    render(); if (!$("lb").hidden) showLB();
    try {
      await rpc("family_set_like", { p_name: me.name, p_password: me.password, p_item: item.id, p_liked: want });
    } catch (e) {
      want ? mine.delete(item.id) : mine.add(item.id);
      render(); if (!$("lb").hidden) showLB();
      toast(errorText(e));
      if (String(e.message).includes("wrong_password")) signOut();
    } finally { pending.delete(item.id); }
  }

  function visible() {
    let v = items.filter(i =>
      filter === "all" ? true :
      filter === "mine" ? mine.has(i.id) :
      filter === "new" ? isNew(i) :
      i.group === filter);
    if (sort === "list") {
      // Newly added outfits first (newest at the top), then the rest in list order.
      const fresh = v.filter(isNew).sort((a, b) => new Date(b.added_at) - new Date(a.added_at));
      v = fresh.concat(v.filter(i => !isNew(i)));
    }
    if (sort === "likes") v = [...v].sort((a, b) => countOf(b.id) - countOf(a.id));
    if (sort === "price") {
      const inr = i => i.currency === "USD" ? i.price * 85 : i.price;   // rough rate, only for sorting
      v = [...v].sort((a, b) => inr(a) - inr(b));
    }
    return v;
  }

  function renderFilters() {
    const nNew = items.filter(isNew).length;
    const opts = [["all", "All"], ["new", "New" + (nNew ? " (" + nNew + ")" : "")], ["ready", "Ready to buy"], ["designer", "Designer"], ["mine", "My likes"]];
    $("filters").replaceChildren(...opts.map(([k, label]) =>
      el("button", { type: "button", "aria-pressed": filter === k ? "true" : "false", onclick: () => { filter = k; renderFilters(); render(); } }, label)));
  }

  function render() {
    view = visible();
    $("mycount").textContent = "♥ " + mine.size + " liked";
    $("shown").textContent = view.length + " outfit" + (view.length === 1 ? "" : "s");
    const grid = $("grid");
    if (!view.length) {
      grid.replaceChildren(el("div", { class: "empty", style: "grid-column:1/-1" }, filter === "mine" ? "You have not liked any outfit yet. Tap a heart to add one." :
        filter === "new" ? "No new outfits in the last two weeks. Suggest an outfit, and similar ones will show up here." : "No outfits here."));
      return;
    }
    grid.replaceChildren(...view.map((item, idx) =>
      el("article", { class: "card" },
        el("button", { class: "ph", type: "button", "aria-label": "See " + item.name + " large", onclick: () => openLB(idx) },
          el("img", { src: thumb(item, 500), alt: item.name, loading: "lazy", referrerpolicy: "no-referrer" }),
          el("span", { class: "tag" + (item.group === "designer" ? " designer" : "") }, item.group === "designer" ? "Designer" : "Ready to buy"),
          isNew(item) ? el("span", { class: "tag new" }, "New") : null),
        el("div", { class: "body" },
          el("div", { class: "name" }, item.name),
          el("div", { class: "meta" }, el("span", {}, item.brand), el("span", { class: "price" }, price(item))),
          item.suggested_by ? el("div", { class: "from" }, "From " + item.suggested_by + "'s idea") : null),
        el("div", { class: "foot" },
          heartBtn(item),
          el("a", { class: "shop-link", href: item.url, target: "_blank", rel: "noopener" }, item.shop + " ↗")))));
  }

  function openLB(idx) { lbIndex = idx; $("lb").hidden = false; document.body.style.overflow = "hidden"; showLB(); $("lb-close").focus(); }
  function closeLB() { $("lb").hidden = true; document.body.style.overflow = ""; }
  function showLB() {
    const item = view[lbIndex]; if (!item) return closeLB();
    $("lb-img").src = thumb(item, 1200); $("lb-img").alt = item.name;
    $("lb-name").textContent = item.name;
    $("lb-sub").textContent = item.brand + " · " + price(item) + " · " + (lbIndex + 1) + " of " + view.length;
    const why = [item.suggested_by ? "From " + item.suggested_by + "'s idea." : "", item.note].filter(Boolean).join(" ");
    $("lb-note").textContent = why; $("lb-note").hidden = !why;
    const h = heartBtn(item); h.id = "lb-heart"; $("lb-heart").replaceWith(h);
    const who = likersOf(item.id);
    $("lb-who").textContent = who.length ? "Liked by: " + who.join(", ") : "No likes yet.";
    $("lb-link").href = item.url; $("lb-link").textContent = "Open on " + item.shop + " ↗";
  }
  const step = d => { lbIndex = (lbIndex + d + view.length) % view.length; showLB(); };
  $("lb-prev").onclick = () => step(-1);
  $("lb-next").onclick = () => step(1);
  $("lb-close").onclick = closeLB;
  $("lb").addEventListener("click", e => { if (e.target.id === "lb" || e.target.classList.contains("stage")) closeLB(); });
  document.addEventListener("keydown", e => {
    if ($("lb").hidden) return;
    if (e.key === "Escape") closeLB();
    else if (e.key === "ArrowRight") step(1);
    else if (e.key === "ArrowLeft") step(-1);
  });
  let touchX = null;
  $("lb").addEventListener("touchstart", e => { touchX = e.touches[0].clientX; }, { passive: true });
  $("lb").addEventListener("touchend", e => { if (touchX == null) return; const dx = e.changedTouches[0].clientX - touchX; if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1); touchX = null; });

  $("sort").addEventListener("change", e => { sort = e.target.value; render(); });

  async function refresh() {
    if (!me) return;
    if (Date.now() - itemsLoadedAt > 10 * 60000) {        // the outfit list changes at most once a day
      try { await loadItems(me.password); itemsLoadedAt = Date.now(); renderFilters(); } catch (e) {}
    }
    try {
      all = await rpc("family_all_likes", { p_password: me.password }) || [];
      const server = new Set(all.filter(r => r.voter === me.name.toLowerCase()).map(r => r.item_id));
      pending.forEach(id => { mine.has(id) ? server.add(id) : server.delete(id); });   // keep taps still in flight
      mine = server;
      render(); if (!$("lb").hidden) showLB();
    } catch (e) { /* keep showing what we have */ }
  }

  async function start(s) {
    me = { name: s.name, password: s.password };
    mine = new Set(s.likes || []);
    $("signin").hidden = true; $("app").hidden = false;
    $("me").textContent = me.name;
    $("grid").replaceChildren(el("div", { class: "empty", style: "grid-column:1/-1" }, "Loading outfits…"));
    try { await loadItems(me.password); itemsLoadedAt = Date.now(); } catch (e) {}
    renderFilters(); render(); refresh();
    if (stopRefresh) stopRefresh();
    stopRefresh = whileVisible(refresh, 30000);              // no calls while the tab is hidden
  }
  function signOut() {
    session.clear(); me = null; if (stopRefresh) { stopRefresh(); stopRefresh = null; }
    closeSG();
    $("app").hidden = true; $("signin").hidden = false;
    renderSignIn($("signin"), start, "Type your name and the family password. Use the same name each time so your likes stay together.");
  }
  $("signout").onclick = signOut;

  // ---- Suggest an outfit -------------------------------------------------
  let photos = [];          // [{ file, url }]
  let sending = false;

  function openSG() {
    $("sg").hidden = false; document.body.style.overflow = "hidden";
    $("sg-msg").hidden = true; renderPhotos(); loadMine(); $("sg-close").focus();
  }
  function closeSG() {
    if ($("sg").hidden) return;
    $("sg").hidden = true; document.body.style.overflow = "";
  }
  function resetForm() {
    photos.forEach(p => URL.revokeObjectURL(p.url)); photos = [];
    $("sg-links").value = ""; $("sg-note").value = ""; $("sg-files").value = "";
    renderPhotos();
  }
  function msg(text, ok) { const m = $("sg-msg"); m.textContent = text; m.className = ok ? "form-ok" : "form-error"; m.hidden = false; }

  function renderPhotos() {
    $("sg-count").textContent = photos.length + " of " + MAX_PHOTOS + " photos";
    $("sg-add").hidden = photos.length >= MAX_PHOTOS;
    $("sg-thumbs").replaceChildren(...photos.map((p, i) =>
      el("div", { class: "sg-thumb" },
        el("img", { src: p.url, alt: "Photo " + (i + 1) }),
        el("button", { type: "button", "aria-label": "Remove photo " + (i + 1), onclick: () => { URL.revokeObjectURL(p.url); photos.splice(i, 1); renderPhotos(); } }, "×"))));
  }

  $("sg-files").addEventListener("change", e => {
    const files = [...e.target.files].filter(f => f.type.startsWith("image/") || /\.(heic|heif)$/i.test(f.name));
    const room = MAX_PHOTOS - photos.length;
    if (files.length > room) msg("You can send up to " + MAX_PHOTOS + " photos at a time. Only the first " + room + " were added.", false);
    else $("sg-msg").hidden = true;
    files.slice(0, room).forEach(f => photos.push({ file: f, url: URL.createObjectURL(f) }));
    e.target.value = "";
    renderPhotos();
  });

  $("sg-form").addEventListener("submit", async ev => {
    ev.preventDefault();
    if (sending) return;
    const links = $("sg-links").value.split(/[\s,]+/).map(s => s.trim()).filter(Boolean);
    if (!links.length && !photos.length) return msg("Please add at least one photo or one link.", false);
    if (links.length > MAX_LINKS) return msg("You can send up to " + MAX_LINKS + " links at a time.", false);
    const bad = links.find(l => !/^https?:\/\/\S+$/i.test(l));
    if (bad) return msg("This is not a web address: " + bad.slice(0, 60) + ". Each link must start with http:// or https://.", false);
    sending = true;
    const btn = $("sg-send"); btn.disabled = true;
    try {
      const shrunk = [];
      for (let i = 0; i < photos.length; i++) {
        btn.textContent = "Preparing photo " + (i + 1) + " of " + photos.length + "…";
        try { shrunk.push(await shrinkPhoto(photos[i].file)); }
        catch (e) { throw new Error("Photo " + (i + 1) + " could not be opened. Please use a JPG or PNG photo, or remove it."); }
      }
      btn.textContent = "Sending…";
      await rpc("family_suggest", { p_name: me.name, p_password: me.password, p_links: links, p_note: $("sg-note").value, p_photos: shrunk });
      resetForm();
      msg("Thank you. We got your suggestion. Similar outfits will show up under New, usually within a day.", true);
      loadMine();
    } catch (e) {
      msg(e.message.startsWith("Photo ") ? e.message : errorText(e), false);
      if (String(e.message).includes("wrong_password")) signOut();
    } finally {
      sending = false; btn.disabled = false; btn.textContent = "Send suggestion";
    }
  });

  function statusText(s) {
    if (s.status === "new") return "Waiting. We check new suggestions once a day.";
    if (s.status === "working") return "We are looking for similar outfits now.";
    if (s.status === "done") {
      const n = (s.added || []).length;
      return (n ? n + (n === 1 ? " outfit" : " outfits") + " added under New." : "Done.") + (s.result_note ? " " + s.result_note : "");
    }
    return "Not added." + (s.result_note ? " " + s.result_note : "");
  }

  async function loadMine() {
    const box = $("sg-mine");
    try {
      const list = await rpc("family_my_suggestions", { p_name: me.name, p_password: me.password }) || [];
      if (!list.length) { box.replaceChildren(el("p", { class: "muted" }, "You have not sent any suggestions yet.")); return; }
      box.replaceChildren(...list.map(s =>
        el("div", { class: "sg-item" },
          s.cover ? el("img", { src: s.cover, alt: "Your photo" }) : el("div", { class: "sg-noimg", "aria-hidden": "true" }, "🔗"),
          el("div", {},
            el("div", { class: "sg-when" }, new Date(s.created_at).toLocaleDateString([], { day: "numeric", month: "short" }) + " · " +
              [s.photo_count ? s.photo_count + (s.photo_count === 1 ? " photo" : " photos") : "", s.links.length ? s.links.length + (s.links.length === 1 ? " link" : " links") : ""].filter(Boolean).join(", ")),
            el("div", { class: "sg-status " + s.status }, statusText(s)),
            s.status === "done" && (s.added || []).length ? el("button", { type: "button", class: "linkbtn", onclick: () => { closeSG(); filter = "new"; renderFilters(); render(); } }, "Show new outfits") : null))));
    } catch (e) {
      box.replaceChildren(el("p", { class: "muted" }, errorText(e)));
    }
  }

  document.querySelectorAll("[data-suggest]").forEach(b => b.addEventListener("click", openSG));
  $("sg-close").onclick = closeSG;
  $("sg").addEventListener("click", e => { if (e.target.id === "sg") closeSG(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("sg").hidden) closeSG(); });

  const saved = session.load();
  if (saved) {
    rpc("family_sign_in", { p_name: saved.name, p_password: saved.password })
      .then(r => start({ name: r.name, password: saved.password, likes: r.likes }))
      .catch(signOut);
  } else signOut();
})();
