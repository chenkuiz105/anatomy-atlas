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

  // learning progress: quiz results per chapter + export / import of this browser's records
  const PREFIXES = ['quiz.', 'progress.', 'pref.', 'viewer.', 'theme'];
  const ours = (k) => PREFIXES.some((p) => k.startsWith(p));
  function allRecords() {
    const out = {};
    try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (ours(k)) out[k] = localStorage.getItem(k); } } catch { /* unavailable */ }
    return out;
  }
  function renderProgress(quizzes) {
    const box = document.getElementById('progressStats');
    const byCh = new Map();
    let done = 0, right = 0;
    for (const z of quizzes) {
      const r = store.get(`quiz.${z.key}`, null);
      const c = byCh.get(z.slug) || { title: z.title, n: 0, done: 0, right: 0 };
      c.n++;
      if (r) { c.done++; done++; if (r.ok) { c.right++; right++; } }
      byCh.set(z.slug, c);
    }
    const reviewed = pages.filter((p) => reviewCount(p.slug) > 0).length;
    const rows = [...byCh].filter(([, c]) => c.done).sort((a, b) => b[1].done - a[1].done).slice(0, 12)
      .map(([slug, c]) => `<a href="quiz.html#ch=${slug}">${esc(c.title)}</a>：${c.done}/${c.n} 題，答對 ${c.right}${c.done - c.right ? `，<span class="c-red">錯 ${c.done - c.right}</span>` : ''}`);
    box.innerHTML = `<p>題庫 ${quizzes.length} 題：做過 <b>${done}</b>，答對 <b>${right}</b>${done ? `（${Math.round((100 * right) / done)}%）` : ''}；已開始複習 <b>${reviewed}</b> / ${pages.length} 章。</p>`
      + (rows.length ? `<ul style="font-size:14px;margin:4px 0">${rows.map((r) => `<li>${r}</li>`).join('')}</ul>` : '');
  }
  Promise.all([fetch('notes/quizzes.json').then((r) => r.json()), fetch('notes/index.json').then((r) => r.json())])
    .then(([qz, j]) => { pages = j.pages; renderProgress(qz); }).catch(() => { document.getElementById('progressStats').textContent = ''; });
  document.getElementById('exportProgress').onclick = () => {
    const blob = new Blob([JSON.stringify({ app: 'anatomy-atlas', at: new Date().toISOString(), records: allRecords() }, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `anatomy-atlas-progress-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const fileIn = document.getElementById('importFile');
  document.getElementById('importProgress').onclick = () => fileIn.click();
  fileIn.onchange = async () => {
    const f = fileIn.files[0]; if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      const rec = j.records || j;
      let n = 0;
      for (const [k, v] of Object.entries(rec)) if (ours(k) && typeof v === 'string') { localStorage.setItem(k, v); n++; }
      alert(`已匯入 ${n} 筆紀錄。`);
      location.reload();
    } catch { alert('這個檔案不是本站匯出的進度檔。'); }
    fileIn.value = '';
  };
  document.getElementById('clearProgress').onclick = () => {
    if (!confirm('確定要清除這個瀏覽器裡所有作答與複習紀錄嗎？（建議先匯出備份）')) return;
    for (const k of Object.keys(allRecords())) localStorage.removeItem(k);
    location.reload();
  };

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
