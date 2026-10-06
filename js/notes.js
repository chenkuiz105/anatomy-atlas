// Note page interactions: review (cloze) mode, exam-only filter, toggles,
// review progress, image lightbox, theme, and links from anatomy terms to the 3D viewer.
(function () {
  const note = document.getElementById('note');
  const page = note.dataset.page;
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };

  // theme
  const theme = store.get('theme', null);
  if (theme) document.documentElement.dataset.theme = theme;
  document.getElementById('theme').onclick = () => {
    const dark = getComputedStyle(document.documentElement).colorScheme.includes('dark');
    const next = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store.set('theme', next);
  };

  function toggleBtn(id, cls, key) {
    const b = document.getElementById(id);
    const apply = (on) => { note.classList.toggle(cls, on); b.setAttribute('aria-pressed', on); };
    apply(store.get(key, false));
    b.onclick = () => { const on = !note.classList.contains(cls); apply(on); store.set(key, on); };
  }
  toggleBtn('cloze', 'cloze', 'pref.cloze');
  toggleBtn('examOnly', 'only-exam', 'pref.examOnly');

  // in review mode, tap a blank to reveal it (tap again to hide)
  note.addEventListener('click', (e) => {
    if (!note.classList.contains('cloze')) return;
    const s = e.target.closest('.b-orange');
    if (s) { s.classList.toggle('shown'); e.preventDefault(); }
  });

  // expand / collapse all toggles
  let expanded = false;
  document.getElementById('expand').onclick = () => {
    expanded = !expanded;
    note.querySelectorAll('details').forEach((d) => { d.open = expanded; });
  };

  // review progress
  note.querySelectorAll('.progress input').forEach((cb) => {
    const k = `progress.${page}.${cb.dataset.key}`;
    cb.checked = store.get(k, false);
    cb.onchange = () => store.set(k, cb.checked);
  });

  // lightbox
  const lb = document.getElementById('lightbox');
  note.addEventListener('click', (e) => {
    if (e.target.tagName === 'IMG' && !note.classList.contains('cloze')) {
      lb.querySelector('img').src = e.target.src;
      lb.classList.add('open');
    }
  });
  lb.onclick = () => lb.classList.remove('open');
  addEventListener('keydown', (e) => { if (e.key === 'Escape') lb.classList.remove('open'); });

  // anatomy terms -> 3D viewer links
  fetch('../models/terms.json').then((r) => r.json()).then((terms) => {
    const names = Object.keys(terms);
    const list = [...names].sort((a, b) => b.length - a.length)
      .map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!list.length) return;
    const re = new RegExp(`\\b(${list.join('|')})s?\\b`, 'gi');
    const walker = document.createTreeWalker(note, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement.closest('a, h1, .tools, code, summary') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) {
      const t = n.nodeValue;
      re.lastIndex = 0;
      if (!re.test(t)) continue;
      re.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0;
      for (const m of t.matchAll(re)) {
        frag.append(t.slice(last, m.index));
        const a = document.createElement('a');
        a.className = 'anat-link';
        a.href = `../viewer.html#t=${encodeURIComponent(m[1].toLowerCase())}`;
        a.title = '在 3D 檢視器中查看';
        a.textContent = m[0];
        frag.append(a);
        last = m.index + m[0].length;
      }
      frag.append(t.slice(last));
      n.replaceWith(frag);
    }
  }).catch(() => {});
})();
