(function () {
  const { rpc, errorText, session, items, price, thumb, el, renderSignIn, demoBanner } = window.KS;
  const $ = id => document.getElementById(id);
  const HEART = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.3-9.2C1.4 8 3.4 4.5 6.9 4.5c2.1 0 3.6 1.2 5.1 3 1.5-1.8 3-3 5.1-3 3.5 0 5.5 3.5 4.2 6.8-1.8 4.6-9.3 9.2-9.3 9.2z"/></svg>';

  let me = null;              // { name, password }
  let mine = new Set();       // item ids I like
  let all = [];               // rows from the server: { voter, voter_display, item_id }
  let filter = "all", sort = "list", lbIndex = -1, view = [];
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
      i.group === filter);
    if (sort === "likes") v = [...v].sort((a, b) => countOf(b.id) - countOf(a.id));
    if (sort === "price") {
      const inr = i => i.currency === "USD" ? i.price * 85 : i.price;   // rough rate, only for sorting
      v = [...v].sort((a, b) => inr(a) - inr(b));
    }
    return v;
  }

  function renderFilters() {
    const opts = [["all", "All"], ["ready", "Ready to buy"], ["designer", "Designer"], ["mine", "My likes"]];
    $("filters").replaceChildren(...opts.map(([k, label]) =>
      el("button", { type: "button", "aria-pressed": filter === k ? "true" : "false", onclick: () => { filter = k; renderFilters(); render(); } }, label)));
  }

  function render() {
    view = visible();
    $("mycount").textContent = "♥ " + mine.size + " liked";
    $("shown").textContent = view.length + " outfit" + (view.length === 1 ? "" : "s");
    const grid = $("grid");
    if (!view.length) {
      grid.replaceChildren(el("div", { class: "empty", style: "grid-column:1/-1" }, filter === "mine" ? "You have not liked any outfit yet. Tap a heart to add one." : "No outfits here."));
      return;
    }
    grid.replaceChildren(...view.map((item, idx) =>
      el("article", { class: "card" },
        el("button", { class: "ph", type: "button", "aria-label": "See " + item.name + " large", onclick: () => openLB(idx) },
          el("img", { src: thumb(item, 500), alt: item.name, loading: "lazy", referrerpolicy: "no-referrer" }),
          el("span", { class: "tag" + (item.group === "designer" ? " designer" : "") }, item.group === "designer" ? "Designer" : "Ready to buy")),
        el("div", { class: "body" },
          el("div", { class: "name" }, item.name),
          el("div", { class: "meta" }, el("span", {}, item.brand), el("span", { class: "price" }, price(item)))),
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
    try {
      all = await rpc("family_all_likes", { p_password: me.password }) || [];
      const server = new Set(all.filter(r => r.voter === me.name.toLowerCase()).map(r => r.item_id));
      pending.forEach(id => { mine.has(id) ? server.add(id) : server.delete(id); });   // keep taps still in flight
      mine = server;
      render(); if (!$("lb").hidden) showLB();
    } catch (e) { /* keep showing what we have */ }
  }

  function start(s) {
    me = { name: s.name, password: s.password };
    mine = new Set(s.likes || []);
    $("signin").hidden = true; $("app").hidden = false;
    $("me").textContent = me.name;
    renderFilters(); render(); refresh();
    clearInterval(start.t); start.t = setInterval(refresh, 30000);
  }
  function signOut() {
    session.clear(); me = null; clearInterval(start.t);
    $("app").hidden = true; $("signin").hidden = false;
    renderSignIn($("signin"), start, "Type your name and the family password. Use the same name each time so your likes stay together.");
  }
  $("signout").onclick = signOut;

  const saved = session.load();
  if (saved) {
    rpc("family_sign_in", { p_name: saved.name, p_password: saved.password })
      .then(r => start({ name: r.name, password: saved.password, likes: r.likes }))
      .catch(signOut);
  } else signOut();
})();
