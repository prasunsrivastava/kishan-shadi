(function () {
  const { rpc, errorText, session, items, byId, loadItems, price, thumb, el, renderSignIn, demoBanner, whileVisible } = window.KS;
  const $ = id => document.getElementById(id);
  let me = null, rows = [], stopRefresh = null, itemsLoadedAt = -Infinity;

  const banner = demoBanner(); if (banner) $("demo").append(banner);

  function stat(n, label) { return el("div", { class: "stat" }, el("div", { class: "n" }, n), el("div", { class: "l" }, label)); }

  function render() {
    const valid = rows.filter(r => byId[r.item_id]);
    const people = new Map();     // voter -> { name, ids[] }
    valid.forEach(r => {
      if (!people.has(r.voter)) people.set(r.voter, { name: r.voter_display, ids: [] });
      const p = people.get(r.voter); p.name = r.voter_display; p.ids.push(r.item_id);
    });
    const perItem = new Map();    // item -> names[]
    valid.forEach(r => { if (!perItem.has(r.item_id)) perItem.set(r.item_id, []); perItem.get(r.item_id).push(r.voter_display); });

    $("stats").replaceChildren(
      stat(people.size, people.size === 1 ? "person has voted" : "people have voted"),
      stat(valid.length, "likes in total"),
      stat(perItem.size + " / " + items.length, "outfits with at least one like"));

    const ranked = [...perItem.entries()].sort((a, b) => b[1].length - a[1].length || items.indexOf(byId[a[0]]) - items.indexOf(byId[b[0]]));
    const max = ranked.length ? ranked[0][1].length : 1;
    if (!ranked.length) {
      $("rank").replaceChildren(el("li", { class: "empty", style: "display:block" }, "No likes yet. Share the outfits page with the family."));
    } else {
      let pos = 0, last = null;
      $("rank").replaceChildren(...ranked.map(([id, names], i) => {
        if (names.length !== last) { pos = i + 1; last = names.length; }
        const it = byId[id];
        return el("li", {},
          el("span", { class: "pos" }, pos),
          el("a", { href: it.url, target: "_blank", rel: "noopener", "aria-label": "Open " + it.name + " on " + it.shop },
            el("img", { src: thumb(it, 160), alt: it.name, loading: "lazy", referrerpolicy: "no-referrer" })),
          el("div", { class: "main" },
            el("div", { class: "title" }, el("b", {}, it.name), el("span", {}, it.brand + " · " + price(it) + (it.suggested_by ? " · from " + it.suggested_by + "'s idea" : ""))),
            el("div", { class: "track", role: "img", "aria-label": names.length + " likes" }, el("i", { style: "width:" + Math.max(6, Math.round(names.length / max * 100)) + "%" })),
            el("div", { class: "names" }, el("span", { class: "cnt" }, names.length + (names.length === 1 ? " like" : " likes")), " · " + names.join(", "))));
      }));
    }

    const ppl = [...people.values()].sort((a, b) => b.ids.length - a.ids.length || a.name.localeCompare(b.name));
    $("people").replaceChildren(...(ppl.length ? ppl.map(p =>
      el("div", { class: "person" },
        el("h3", {}, el("span", {}, p.name), el("span", { class: "cnt" }, p.ids.length)),
        el("div", { class: "thumbs" }, ...p.ids.map(id => el("img", { src: thumb(byId[id], 120), alt: byId[id].name, title: byId[id].name, loading: "lazy", referrerpolicy: "no-referrer" })))))
      : [el("div", { class: "empty" }, "Nobody has voted yet.")]));

    const g = k => valid.filter(r => byId[r.item_id].group === k).length;
    $("split").replaceChildren(
      stat(g("ready"), "likes for ready-to-buy outfits (" + items.filter(i => i.group === "ready").length + " outfits)"),
      stat(g("designer"), "likes for designer outfits (" + items.filter(i => i.group === "designer").length + " outfits)"));
  }

  async function load() {
    if (!me) return;
    try {
      if (Date.now() - itemsLoadedAt > 10 * 60000) { await loadItems(me.password); itemsLoadedAt = Date.now(); }
      rows = await rpc("family_all_likes", { p_password: me.password }) || [];
      render();
      $("updated").textContent = "Updated " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    } catch (e) {
      $("updated").textContent = errorText(e);
      if (String(e.message).includes("wrong_password")) signOut();
    }
  }

  function start(s) {
    me = { name: s.name, password: s.password };
    $("signin").hidden = true; $("app").hidden = false;
    $("me").textContent = me.name;
    load();
    if (stopRefresh) stopRefresh();
    stopRefresh = whileVisible(load, 30000);               // no calls while the tab is hidden
  }
  function signOut() {
    session.clear(); me = null; if (stopRefresh) { stopRefresh(); stopRefresh = null; }
    $("app").hidden = true; $("signin").hidden = false;
    renderSignIn($("signin"), start, "Type your name and the family password to see the results.");
  }
  $("reload").onclick = load;

  const saved = session.load();
  if (saved) start(saved); else signOut();
})();
