// Home page: chapter list grouped by section, review progress, full-text search.
(function () {
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };
  const theme = store.get('theme', null);
  if (theme) document.documentElement.dataset.theme = theme;
  document.getElementById('theme').onclick = () => {
    const dark = getComputedStyle(document.documentElement).colorScheme.includes('dark');
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store.set('theme', next);
  };

  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let pages = [];

  fetch('notes/index.json').then((r) => r.json()).then((j) => {
    pages = j.pages;
    renderSections();
  }).catch(() => {
    document.getElementById('sections').innerHTML = '<p>筆記尚未建立。</p>';
  });

  function reviewCount(slug) {
    return ['r1', 'r2', 'r3'].filter((k) => store.get(`progress.${slug}.${k}`, false)).length;
  }

  function renderSections() {
    const groups = new Map();
    for (const p of pages) {
      const s = p.section || '總論與其他';
      if (!groups.has(s)) groups.set(s, []);
      groups.get(s).push(p);
    }
    const box = document.getElementById('sections');
    box.innerHTML = '';
    for (const [name, list] of groups) {
      const h = document.createElement('h2');
      h.className = 'section-title';
      h.textContent = name;
      const grid = document.createElement('div');
      grid.className = 'cards';
      for (const p of list) {
        const n = reviewCount(p.slug);
        grid.insertAdjacentHTML('beforeend', `
          <a class="card" href="notes/${p.slug}.html">
            <div class="t">${esc(p.title)}</div>
            <div class="m">
              ${p.stars ? `<span class="badge">★ ×${p.stars}</span>` : ''}
              <span class="badge ${n ? 'done' : ''}">複習 ${n}/3</span>
            </div>
          </a>`);
      }
      box.append(h, grid);
    }
  }

  const q = document.getElementById('q');
  const hits = document.getElementById('hits');
  q.addEventListener('input', () => {
    const term = q.value.trim().toLowerCase();
    hits.innerHTML = '';
    document.getElementById('sections').hidden = !!term;
    if (!term) return;
    const res = [];
    for (const p of pages) {
      let i = p.text.indexOf(term);
      if (i < 0 && !p.title.toLowerCase().includes(term)) continue;
      const snippets = [];
      let from = 0;
      while (i >= 0 && snippets.length < 3) {
        snippets.push(p.text.slice(Math.max(0, i - 30), i + term.length + 40));
        from = i + term.length;
        i = p.text.indexOf(term, from);
      }
      res.push({ p, snippets });
    }
    if (!res.length) { hits.innerHTML = '<p>找不到。</p>'; return; }
    const re = new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    hits.innerHTML = res.map(({ p, snippets }) => `
      <a class="card hit" href="notes/${p.slug}.html#:~:text=${encodeURIComponent(term)}">
        <div class="t">${esc(p.title)}</div>
        ${snippets.map((s) => `<div class="m">…${esc(s).replace(re, (m) => `<mark>${m}</mark>`)}…</div>`).join('')}
      </a>`).join('');
  });
})();
