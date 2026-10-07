#!/usr/bin/env python3
"""Build static HTML note pages from Notion's official HTML export.

Usage: python3 tools/build_notes.py <unzipped export dir> <site_dir>

Page order and slugs come from tools/pages.txt (one Notion page id per line; slug = line
number). Colours/highlights are mapped to the site's classes, images are copied to
notes/img/<pageid>/, supplements/<slug>.md (book notes + past-exam quizzes) are appended,
and notes/index.json, notes/quizzes.json and models/zh.json are written.
"""
import html
import json
import os
import re
import shutil
import sys

SRC, SITE = sys.argv[1], sys.argv[2]
OUT = os.path.join(SITE, 'notes')

COLOR_RE = r'(gray|brown|orange|yellow|green|blue|purple|pink|red|default)'


def color_class(c):
    if not c or c == 'default':
        return ''
    if c.endswith('_bg'):
        return 'b-' + c[:-3]
    return 'c-' + c


# ---------------------------------------------------------------- inline
ESC = '\x00'


def inline(s):
    """Notion rich text -> HTML."""
    # protect backslash escapes
    s = re.sub(r'\\(.)', lambda m: f'{ESC}{ord(m.group(1))}{ESC}', s)
    s = s.replace('&', '&amp;')
    # inline math $`x`$ and code `x`
    s = re.sub(r'\$`([^`]*)`\$', lambda m: f'<span class="eq">{m.group(1)}</span>', s)
    s = re.sub(r'`([^`]*)`', lambda m: f'<code>{m.group(1)}</code>', s)
    # spans
    def span(m):
        attrs = dict(re.findall(r'(\w+)="([^"]*)"', m.group(1)))
        cls = [color_class(attrs.get('color'))]
        if attrs.get('underline') == 'true':
            cls.append('u')
        cls = ' '.join(c for c in cls if c)
        return f'<span class="{cls}">' if cls else '<span>'
    s = re.sub(r'<span((?:\s+[\w-]+="[^"]*")*)\s*>', span, s)
    # mentions
    s = re.sub(r'<mention-page url="([^"]*)"\s*/?>(.*?)(</mention-page>)?',
               lambda m: f'<a href="{m.group(1)}" target="_blank" rel="noopener">{m.group(2) or "頁面"}</a>', s)
    s = re.sub(r'<mention-[a-z-]+[^>]*/>', '', s)
    s = re.sub(r'<mention-([a-z-]+)[^>]*>(.*?)</mention-\1>', r'\2', s)
    # emphasis
    s = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', s)
    s = re.sub(r'(?<![\w*])\*(?!\s)(.+?)(?<!\s)\*(?![\w*])', r'<i>\1</i>', s)
    s = re.sub(r'~~(.+?)~~', r'<s>\1</s>', s)
    # links
    s = re.sub(r'\[([^\]]+)\]\(([^)\s]+)\)',
               lambda m: f'<a href="{m.group(2)}" target="_blank" rel="noopener">{m.group(1)}</a>', s)
    s = re.sub(r'\[\^[^\]]*\]', '', s)
    # exam stars: ★ inside a coloured span gets a marker class
    s = s.replace('★', '<span class="star">★</span>')
    # stray tags Notion may leave that we do not support -> drop
    s = re.sub(r'</?(?!span|b|i|s|a|code|br|sup|sub)\w[\w-]*(?:\s[^<>]*)?/?>', '', s)
    # restore escapes (HTML-escaped)
    s = re.sub(f'{ESC}(\\d+){ESC}', lambda m: html.escape(chr(int(m.group(1)))), s)
    return s


ATTR_TAIL = re.compile(r'\s*\{((?:\s*[\w-]+="[^"]*")+)\s*\}\s*$')


def split_attrs(text):
    m = ATTR_TAIL.search(text)
    if not m:
        return text, {}
    return text[:m.start()], dict(re.findall(r'([\w-]+)="([^"]*)"', m.group(1)))


# ---------------------------------------------------------------- blocks
def indent_of(line):
    return len(line) - len(line.lstrip('\t'))


class Ctx:
    def __init__(self, page_id, img_map):
        self.page_id = page_id
        self.img_map = img_map
        self.headings = []


def parse(lines, i, base, ctx, out):
    """Parse sibling blocks at indentation >= base starting from lines[i]. Returns new i."""
    list_stack = []  # open list tags at this level

    def close_list():
        while list_stack:
            out.append(f'</{list_stack.pop()}>')

    while i < len(lines):
        raw = lines[i]
        if not raw.strip():
            i += 1
            continue
        ind = indent_of(raw)
        if ind < base:
            break
        line = raw.strip()

        # closing tags end the current container
        if re.match(r'^</(details|callout|column|columns|tabs|tab|synced_block|synced_block_reference)>$', line):
            break

        # table: grab raw lines until </table>
        if line.startswith('<table'):
            close_list()
            j = i
            buf = []
            while j < len(lines):
                buf.append(lines[j].strip())
                if lines[j].strip() == '</table>':
                    break
                j += 1
            out.append(render_table(buf))
            i = j + 1
            continue

        m_list = re.match(r'^(-|\d+\.)\s+(\[[ x]\]\s+)?(.*)$', line)
        if m_list:
            tag = 'ol' if m_list.group(1)[0].isdigit() else 'ul'
            if list_stack and list_stack[-1] != tag:
                close_list()
            if not list_stack:
                out.append(f'<{tag}>')
                list_stack.append(tag)
            text, attrs = split_attrs(m_list.group(3))
            cb = ''
            if m_list.group(2):
                cb = '<input type="checkbox" disabled{}> '.format(' checked' if 'x' in m_list.group(2) else '')
            cls = color_class(attrs.get('color'))
            out.append(f'<li{f" class={chr(34)}{cls}{chr(34)}" if cls else ""}>{cb}{inline(text)}')
            i = parse(lines, i + 1, ind + 1, ctx, out)
            out.append('</li>')
            continue
        close_list()

        m_h = re.match(r'^(#{1,6})\s+(.*)$', line)
        if m_h:
            level = min(len(m_h.group(1)) + 1, 5)  # page title is h1
            text, attrs = split_attrs(m_h.group(2))
            hid = f'h{len(ctx.headings) + 1}'
            ctx.headings.append((level, hid, re.sub('<[^>]+>', '', inline(text))))
            cls = color_class(attrs.get('color'))
            hhtml = f'<h{level} id="{hid}"{f" class={chr(34)}{cls}{chr(34)}" if cls else ""}>{inline(text)}</h{level}>'
            if attrs.get('toggle') == 'true':
                out.append(f'<details open><summary>{hhtml}</summary>')
                i = parse(lines, i + 1, ind + 1, ctx, out)
                out.append('</details>')
            else:
                out.append(hhtml)
                i = parse(lines, i + 1, ind + 1, ctx, out)
            continue

        if line == '<empty-block/>':
            out.append('<div class="gap"></div>')
            i += 1
            continue
        if line == '---':
            out.append('<hr>')
            i += 1
            continue

        m_x = re.match(r'^<(details|callout|columns|column|tabs|tab|synced_block|synced_block_reference)((?:\s+[\w-]+="[^"]*")*)\s*>$', line)
        if m_x:
            tag = m_x.group(1)
            attrs = dict(re.findall(r'([\w-]+)="([^"]*)"', m_x.group(2)))
            cls = color_class(attrs.get('color'))
            inner = []
            j = i + 1
            if tag == 'details':
                summary = ''
                if j < len(lines) and lines[j].strip().startswith('<summary>'):
                    summary = re.sub(r'^<summary>(.*)</summary>$', r'\1', lines[j].strip())
                    j += 1
                j = parse(lines, j, ind + 1, ctx, inner)
                out.append(f'<details class="{cls}"><summary>{inline(summary)}</summary>{"".join(inner)}</details>')
            elif tag == 'callout':
                j = parse(lines, j, ind + 1, ctx, inner)
                icon = attrs.get('icon', '💡')
                icon = icon if not icon.startswith('icons/') else '💡'
                out.append(f'<div class="callout {cls}"><span>{html.escape(icon)}</span><div>{"".join(inner)}</div></div>')
            elif tag == 'columns':
                j = parse(lines, j, ind + 1, ctx, inner)
                out.append(f'<div class="columns">{"".join(inner)}</div>')
            elif tag == 'column':
                j = parse(lines, j, ind + 1, ctx, inner)
                out.append(f'<div class="column">{"".join(inner)}</div>')
            elif tag == 'tabs':
                j = parse(lines, j, ind + 1, ctx, inner)
                out.append(f'<div class="tabs">{"".join(inner)}</div>')
            elif tag == 'tab':
                title = lines[j].strip() if j < len(lines) else ''
                j = parse(lines, j + 1, ind + 1, ctx, inner)
                out.append(f'<details open class="tab"><summary>{inline(title)}</summary>{"".join(inner)}</details>')
            else:
                j = parse(lines, j, ind + 1, ctx, inner)
                out.append(''.join(inner))
            # skip the closing tag
            if j < len(lines) and lines[j].strip() == f'</{tag}>':
                j += 1
            i = j
            continue

        m_img = re.match(r'^!\[([^\]]*)\]\(([^)]*)\)\s*(\{[^}]*\})?\s*(<!--\s*local:\s*(\S+)\s*-->)?', line)
        if m_img:
            local = m_img.group(5)
            if local:
                name = local.split('/', 1)[1]
                src = f'img/{name}'
                ctx.img_map.append((local, name))
                cap = inline(m_img.group(1))
                out.append(f'<figure><img loading="lazy" src="{src}" alt="{html.escape(m_img.group(1))}">'
                           + (f'<figcaption>{cap}</figcaption>' if cap else '') + '</figure>')
            else:
                out.append('<p class="c-gray">［圖片未匯出］</p>')
            i += 1
            continue

        if line.startswith('<unknown') or line.startswith('<page ') or line.startswith('<database') \
                or line.startswith('<table_of_contents') or line.startswith('<!--'):
            i += 1
            continue
        if re.match(r'^<(file|pdf|video|audio|embed)\b', line):
            i += 1
            continue

        if line == '$$':
            j = i + 1
            eq = []
            while j < len(lines) and lines[j].strip() != '$$':
                eq.append(lines[j].strip())
                j += 1
            out.append(f'<p class="eq">{html.escape(" ".join(eq))}</p>')
            i = j + 1
            continue
        if line.startswith('```'):
            j = i + 1
            code = []
            while j < len(lines) and not lines[j].strip().startswith('```'):
                code.append(lines[j][ind:])
                j += 1
            out.append(f'<pre><code>{html.escape(chr(10).join(code))}</code></pre>')
            i = j + 1
            continue

        if line.startswith('> '):
            text, attrs = split_attrs(line[2:])
            cls = color_class(attrs.get('color'))
            out.append(f'<blockquote class="{cls}">{inline(text)}')
            i = parse(lines, i + 1, ind + 1, ctx, out)
            out.append('</blockquote>')
            continue

        # paragraph
        text, attrs = split_attrs(line)
        cls = color_class(attrs.get('color'))
        out.append(f'<p{f" class={chr(34)}{cls}{chr(34)}" if cls else ""}>{inline(text)}</p>')
        if i + 1 < len(lines) and lines[i + 1].strip() and indent_of(lines[i + 1]) > ind:
            out.append('<div class="children">')
            i = parse(lines, i + 1, ind + 1, ctx, out)
            out.append('</div>')
        else:
            i += 1
    close_list()
    return i


def render_table(buf):
    s = '\n'.join(buf)
    head_row = 'header-row="true"' in buf[0]
    rows = re.findall(r'<tr([^>]*)>(.*?)</tr>', s, re.S)
    out = ['<div class="table-wrap"><table>']
    for ri, (rattrs, body) in enumerate(rows):
        rc = color_class(dict(re.findall(r'([\w-]+)="([^"]*)"', rattrs)).get('color'))
        out.append(f'<tr class="{rc}">')
        for cattrs, cell in re.findall(r'<td([^>]*)>(.*?)</td>', body, re.S):
            cc = color_class(dict(re.findall(r'([\w-]+)="([^"]*)"', cattrs)).get('color'))
            t = 'th' if head_row and ri == 0 else 'td'
            out.append(f'<{t} class="{cc}">{inline(cell.strip())}</{t}>')
        out.append('</tr>')
    out.append('</table></div>')
    return ''.join(out)


# ---------------------------------------------------------------- pages
PAGE_TMPL = '''<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title_txt}</title>
<link rel="stylesheet" href="../css/style.css">
</head>
<body>
<header class="topbar">
  <a class="brand" href="../index.html">🦴 Anatomy Atlas</a>
  <nav><a href="../index.html" class="active">筆記</a><a href="../quiz.html">題庫</a><a href="../viewer.html">3D 檢視器</a></nav>
  <span class="spacer"></span>
  <button id="theme" title="切換深淺色">🌓</button>
</header>
<div class="note-layout">
  <aside class="toc">
    <div class="section-label">{section}</div>
    {toc}
    <hr>
    {prevnext}
  </aside>
  <main>
    <article class="note" id="note" data-page="{slug}">
      <h1>{title}</h1>
      <div class="tools">
        <button id="cloze" aria-pressed="false" title="把橘色螢光重點遮起來，點一下顯示">🙈 遮住重點</button>
        <button id="examOnly" aria-pressed="false" title="淡化沒有 ★ 的內容">★ 只看國考點</button>
        <button id="expand" title="展開/收合所有折疊">⇕ 展開全部</button>
        <span class="progress">
          <label><input type="checkbox" data-key="r1"> 複習 1</label>
          <label><input type="checkbox" data-key="r2"> 複習 2</label>
          <label><input type="checkbox" data-key="r3"> 複習 3</label>
        </span>
      </div>
      {body}
    </article>
    <nav class="pager">{prevnext}</nav>
  </main>
</div>
<div class="lightbox" id="lightbox"><img alt=""></div>
<script src="../js/notes.js"></script>
</body>
</html>
'''


QUIZZES = []
CURRENT = {}


def quiz_key(exam_id, qtext):
    plain = re.sub(r'[^\w\u4e00-\u9fff]', '', re.sub(r'<[^>]+>', '', qtext))
    return f'{exam_id}|{plain[:10]}'


def render_quiz(head, lines):
    """:::quiz <exam id> | <page>  /  question  /  '- wrong' or '* right' options  /  '> explanation'."""
    src, _, page = head.partition('|')
    q, opts, expl = [], [], []
    for ln in lines:
        t = ln.strip()
        if t.startswith(('- ', '* ')):
            opts.append((t[0] == '*', t[2:]))
        elif t.startswith('> '):
            expl.append(t[2:])
        elif t:
            q.append(t)
    letters = 'ABCDE'
    qtext = " ".join(q)
    key = quiz_key(src.strip(), qtext)
    QUIZZES.append(dict(key=key, id=src.strip(), page=page.strip(), q=inline(qtext),
                        opts=[inline(t) for _, t in opts], ans=[i for i, (ok, _) in enumerate(opts) if ok][0] if any(ok for ok, _ in opts) else -1,
                        expl=inline(" ".join(expl)) if expl else '', slug=CURRENT['slug'], title=CURRENT['title'], section=CURRENT['section']))
    out = [f'<div class="quiz-card" data-q="{html.escape(key)}">',
           f'<div class="qhead"><span class="badge">{html.escape(src.strip())}</span>'
           f'<span class="qsrc">{html.escape(page.strip())}</span></div>',
           f'<div class="qtext">{inline(" ".join(q))}</div><div class="qopts">']
    for i, (ok, text) in enumerate(opts):
        out.append(f'<button class="qopt" data-ok="{1 if ok else 0}">({letters[i]}) {inline(text)}</button>')
    out.append('</div>')
    if expl:
        out.append(f'<div class="qexpl" hidden>💡 {inline(" ".join(expl))}</div>')
    out.append('</div>')
    return ''.join(out)


def render_supplement(path, ctx):
    lines = open(path, encoding='utf-8').read().split('\n')
    out, buf, i = [], [], 0
    while i < len(lines):
        if lines[i].startswith(':::quiz'):
            if buf:
                parse(buf, 0, 0, ctx, out)
                buf = []
            j = i + 1
            while j < len(lines) and lines[j].strip() != ':::':
                j += 1
            out.append(render_quiz(lines[i][len(':::quiz'):], lines[i + 1:j]))
            i = j + 1
        else:
            buf.append(lines[i])
            i += 1
    if buf:
        parse(buf, 0, 0, ctx, out)
    return '<section class="supplement" id="book">' + '\n'.join(out) + '</section>'


def slugify(n, page_id):
    return f'{n:02d}'


def build_zh(index):
    """Chinese names for 3D structures, taken from the notes' own "中文(english)" pairs."""
    terms_path = os.path.join(SITE, 'models', 'terms.json')
    if not os.path.exists(terms_path):
        return
    terms = json.load(open(terms_path, encoding='utf-8'))
    counts = {}
    pat = re.compile(r'([\u4e00-\u9fff]{2,12})\s*[(（]\s*([a-z][a-z \-\']{2,60}?)\s*[)）]')
    for p in index:
        for zh, en in pat.findall(p['text']):
            en = re.sub(r'\s+', ' ', en.strip())
            if en.endswith('s') and en[:-1] in terms:
                en = en[:-1]
            if en in terms:
                counts.setdefault(en, {}).setdefault(zh, 0)
                counts[en][zh] += 1
    parts = json.load(open(os.path.join(SITE, 'models', 'parts.json'), encoding='utf-8'))
    zh = {}
    for en, c in counts.items():
        name = max(c.items(), key=lambda kv: kv[1])[0]
        layers = {parts[i]['l'] for i in terms[en] if i in parts}
        if layers == {'muscles'} and '肌' not in name:
            continue  # e.g. "三角(deltoid)" was about a region, not the muscle
        zh[en] = name
    json.dump(zh, open(os.path.join(SITE, 'models', 'zh.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, separators=(',', ':'))
    print(f'{len(zh)} Chinese names from notes')


def load_export(export_dir):
    """Pages from Notion's official HTML export (Export -> HTML, include subpages)."""
    from bs4 import BeautifulSoup, NavigableString
    order = [l.strip() for l in open(os.path.join(os.path.dirname(__file__), 'pages.txt')) if l.strip()]
    files = {}
    for root, _, fs in os.walk(export_dir):
        for f in fs:
            m = re.search(r'([0-9a-f]{32})\.html$', f)
            if m:
                files[m.group(1)] = os.path.join(root, f)
    slug_of = {pid: f'{i + 1:02d}' for i, pid in enumerate(order)}
    pages = []
    for i, pid in enumerate(order):
        path = files.get(pid)
        if not path:
            print('missing in export:', pid)
            continue
        soup = BeautifulSoup(open(path, encoding='utf-8').read(), 'html.parser')
        title = soup.find('h1', class_='page-title').get_text()
        icon = soup.find('article').get('data-notion-page-icon', '')
        if icon and not icon.startswith(('http', '/')):
            title = f'{icon} {title}'
        props = {}
        for row in soup.select('table.properties tr'):
            k = row.find('th').get_text().strip()
            td = row.find('td')
            cb = td.find('input')
            props[k] = ('__YES__' if cb.has_attr('checked') else '__NO__') if cb else td.get_text().strip()
        body = soup.find('div', class_='page-body')
        base = os.path.dirname(path)
        imgs = []
        for img in body.find_all('img'):
            src = img.get('src', '')
            if src.startswith('http'):
                continue
            from urllib.parse import unquote
            local = os.path.normpath(os.path.join(base, unquote(src)))
            name = f'{pid}/{len(imgs) + 1}{os.path.splitext(local)[1].lower()}'
            imgs.append((local, name))
            img.attrs = {'src': f'img/{name}', 'loading': 'lazy', 'alt': ''}
            a = img.find_parent('a')
            if a:
                a.unwrap()
        for a in body.find_all('a'):
            href = a.get('href', '')
            m = re.search(r'([0-9a-f]{32})\.html', href)
            if m and m.group(1) in slug_of:
                a['href'] = f'{slug_of[m.group(1)]}.html'
            elif href.startswith('http'):
                a['target'] = '_blank'; a['rel'] = 'noopener'
        # colours: Notion export uses "teal" for what the editor calls green
        def cmap(c):
            return 'green' if c.startswith('teal') else c
        for el in body.find_all(True):
            cls = el.get('class') or []
            new = []
            for c in cls:
                m = re.match(r'(?:highlight|block-color)-(\w+?)(_background)?$', c)
                if m:
                    if m.group(1) != 'default':
                        new.append(('b-' if m.group(2) else 'c-') + cmap(m.group(1)))
                elif c in ('column-list',):
                    new.append('columns')
                elif c in ('column', 'callout', 'toggle', 'indented', 'simple-table', 'image', 'link-to-page'):
                    new.append(c)
            style = el.get('style', '')
            if 'border-bottom' in style:
                new.append('u')
            for attr in ('style', 'data-notion-highlight', 'data-notion-column-list', 'data-notion-column-ratio', 'dir'):
                if attr in el.attrs:
                    del el.attrs[attr]
            if el.name in ('th', 'td') and el.get('id') and not re.match(r'^[0-9a-f-]{36}$', el['id']):
                del el['id']
            if new:
                el['class'] = new
            elif 'class' in el.attrs:
                del el['class']
            if el.name == 'mark':
                el.name = 'span'
        for fig in body.find_all('figure', class_='callout'):
            fig.name = 'div'
        for t in list(body.find_all(string=lambda x: x and '★' in x)):
            parts = t.split('★')
            frag = []
            for j, part in enumerate(parts):
                if j:
                    st = soup.new_tag('span'); st['class'] = ['star']; st.string = '★'; frag.append(st)
                if part:
                    frag.append(NavigableString(part))
            t.replace_with(*frag)
        headings = []
        for h in body.find_all(['h1', 'h2', 'h3', 'h4']):
            lv = min(int(h.name[1]) + 1, 5)
            h.name = f'h{lv}'
            hid = h.get('id') or f'h{len(headings)}'
            h['id'] = hid
            headings.append((lv, hid, html.escape(h.get_text())))
        pages.append(dict(n=i + 1, pid=pid, title=title, props=props, slug=slug_of[pid],
                          html=body.decode_contents(), imgs=imgs, headings=headings))
    return pages


def main():
    os.makedirs(os.path.join(OUT, 'img'), exist_ok=True)
    pages = load_export(SRC)

    index = []
    for k, p in enumerate(pages):
        ctx = Ctx(p['pid'], [])
        ctx.headings = list(p['headings'])
        body = p['html']
        CURRENT.update(slug=p['slug'], title=p['title'], section=p['props'].get('區段', ''))
        sup = os.path.join(SITE, 'supplements', f'{p["slug"]}.md')
        if os.path.exists(sup):
            body += '\n' + render_supplement(sup, ctx)
        for srcf, name in p['imgs']:
            dst = os.path.join(OUT, 'img', name)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            if os.path.exists(srcf):
                shutil.copyfile(srcf, dst)
        toc = '\n'.join(f'<a class="l{lv}" href="#{hid}">{t}</a>' for lv, hid, t in ctx.headings if lv <= 3)
        prev_ = pages[k - 1] if k > 0 else None
        next_ = pages[k + 1] if k + 1 < len(pages) else None
        pn = ''
        if prev_:
            pn += f'<a href="{prev_["slug"]}.html">← {html.escape(prev_["title"])}</a>'
        if next_:
            pn += f'<a href="{next_["slug"]}.html">{html.escape(next_["title"])} →</a>'
        title_html = inline(p['title'])
        section = p['props'].get('區段', '')
        page_html = PAGE_TMPL.format(
            title_txt=html.escape(p['title']), title=title_html, toc=toc, body=body, slug=p['slug'],
            prevnext=pn, section=html.escape(section))
        open(os.path.join(OUT, f'{p["slug"]}.html'), 'w', encoding='utf-8').write(page_html)
        plain = re.sub(r'<[^>]+>', ' ', body)
        plain = html.unescape(re.sub(r'\s+', ' ', plain)).lower()
        index.append(dict(slug=p['slug'], title=p['title'], section=section,
                          subject=p['props'].get('科目', ''), done=p['props'].get('整理完畢') == '__YES__',
                          stars=body.count('class="star"'), text=plain))
    build_zh(index)
    seen, bank = set(), []
    for qz in QUIZZES:
        if qz['key'] in seen:
            continue
        seen.add(qz['key'])
        bank.append(qz)
    json.dump(bank, open(os.path.join(OUT, 'quizzes.json'), 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print(f'{len(bank)} unique quiz questions ({len(QUIZZES)} incl. repeats)')
    json.dump(dict(pages=index), open(os.path.join(OUT, 'index.json'), 'w', encoding='utf-8'),
              ensure_ascii=False, separators=(',', ':'))
    print(f'{len(pages)} pages written')


main()
