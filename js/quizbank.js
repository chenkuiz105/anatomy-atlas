// Past-exam question bank: filter by chapter / unanswered / wrong, one question at a time.
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

  const $ = (s) => document.querySelector(s);
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  let bank = [];
  let queue = [];
  let pos = 0;
  let session = { right: 0, done: 0 };

  fetch('notes/quizzes.json').then((r) => r.json()).then((b) => {
    bank = b.filter((q) => q.ans >= 0);
    const chapters = new Map();
    for (const q of bank) chapters.set(q.slug, q.title);
    const sel = $('#chapter');
    for (const [slug, title] of chapters) {
      const n = bank.filter((q) => q.slug === slug).length;
      sel.insertAdjacentHTML('beforeend', `<option value="${slug}">${esc(title)}（${n}）</option>`);
    }
    const h = new URLSearchParams(location.hash.slice(1));
    if (h.get('ch')) sel.value = h.get('ch');
    renderStats();
  });

  function result(q) { return store.get(`quiz.${q.key}`, null); }

  function renderStats() {
    const ch = $('#chapter').value;
    const list = bank.filter((q) => !ch || q.slug === ch);
    const done = list.filter(result);
    const right = done.filter((q) => result(q).ok);
    $('#stats').textContent = `共 ${list.length} 題 · 做過 ${done.length} · 答對 ${right.length} · 答錯 ${done.length - right.length}`;
  }
  $('#chapter').onchange = renderStats;

  $('#start').onclick = () => {
    const ch = $('#chapter').value;
    const f = $('#filter').value;
    queue = bank.filter((q) => (!ch || q.slug === ch)
      && (f === 'all' || (f === 'new' && !result(q)) || (f === 'wrong' && result(q) && !result(q).ok)));
    if ($('#shuffle').checked) {
      for (let i = queue.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [queue[i], queue[j]] = [queue[j], queue[i]]; }
    }
    pos = 0;
    session = { right: 0, done: 0 };
    show();
  };

  function show() {
    const stage = $('#stage');
    if (!queue.length) { stage.innerHTML = '<p>這個範圍沒有題目。</p>'; return; }
    if (pos >= queue.length) {
      stage.innerHTML = `<div class="quiz-card"><div class="qtext">這一輪完成：${session.right} / ${session.done} 題答對。</div></div>`;
      renderStats();
      return;
    }
    const q = queue[pos];
    const L = 'ABCDE';
    stage.innerHTML = `
      <div class="quiz-card">
        <div class="qhead"><span class="badge">${esc(q.id)}</span><span class="qsrc">${esc(q.page)} · <a href="notes/${q.slug}.html#book">${esc(q.title)}</a></span><span class="spacer"></span><span>${pos + 1} / ${queue.length}</span></div>
        <div class="qtext">${q.q}</div>
        <div class="qopts">${q.opts.map((o, i) => `<button class="qopt" data-i="${i}">(${L[i]}) ${o}</button>`).join('')}</div>
        ${q.expl ? `<div class="qexpl" hidden>💡 ${q.expl}</div>` : ''}
        <div class="qnext" hidden><button id="next">下一題 →</button></div>
      </div>`;
    stage.querySelectorAll('.qopt').forEach((b) => {
      b.onclick = () => {
        const i = +b.dataset.i;
        const ok = i === q.ans;
        stage.querySelectorAll('.qopt').forEach((x) => {
          x.disabled = true;
          if (+x.dataset.i === q.ans) x.classList.add('right');
          else if (x === b) x.classList.add('wrong');
        });
        const ex = stage.querySelector('.qexpl'); if (ex) ex.hidden = false;
        stage.querySelector('.qnext').hidden = false;
        store.set(`quiz.${q.key}`, { ok, at: Date.now() });
        session.done++; if (ok) session.right++;
        renderStats();
        $('#next').focus();
      };
    });
    stage.querySelector('#next').onclick = () => { pos++; show(); };
  }
  addEventListener('keydown', (e) => {
    if (e.target.matches('select, input')) return;
    const n = '1234abcd'.indexOf(e.key.toLowerCase());
    const btns = document.querySelectorAll('#stage .qopt:not(:disabled)');
    if (n >= 0 && btns[n % 4]) btns[n % 4].click();
    else if (e.key === 'Enter') { const nx = document.getElementById('next'); if (nx && !nx.closest('[hidden]')) nx.click(); }
  });
})();
