/*
 * Doldadress help-center widget.
 *
 * Drop-in popup any website can embed. It offers an AI assistant that answers
 * strictly from the public knowledge base (streaming, with source links) plus
 * classic article search. It talks only to the public, read-only help API
 * (/api/public/kb/*), so no API key is needed.
 *
 * Usage on the customer's site:
 *   <script src="https://YOUR-APP-DOMAIN/kb-widget.js"
 *           data-kb-base="https://YOUR-APP-DOMAIN"></script>
 *
 * The script self-initializes on load and injects a floating "Hjälp" button.
 */
(function () {
  'use strict';

  var script = document.currentScript;
  var base = (script && script.getAttribute('data-kb-base')) || '';
  base = base.replace(/\/$/, '');

  var ACCENT = '#7C5CFF';
  var open = false;
  var tab = 'chat';
  var timer = null;
  var busy = false;
  var history = []; // [{role, content}]

  function el(tag, attrs, html) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (html != null) node.innerHTML = html;
    return node;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // Minimal, safe Markdown-ish renderer: escapes first, then turns **bold**,
  // `code`, "- " bullet lines and blank lines into light HTML. No raw HTML is
  // ever interpreted, so model output can't inject markup.
  function mdToHtml(text) {
    var safe = escapeHtml(text);
    safe = safe.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    safe = safe.replace(/`([^`]+)`/g, '<code>$1</code>');
    var lines = safe.split('\n');
    var out = '';
    var inList = false;
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i];
      var m = ln.match(/^\s*[-*]\s+(.*)$/);
      if (m) {
        if (!inList) { out += '<ul>'; inList = true; }
        out += '<li>' + m[1] + '</li>';
      } else {
        if (inList) { out += '</ul>'; inList = false; }
        if (ln.trim() === '') out += '<br>';
        else out += '<div>' + ln + '</div>';
      }
    }
    if (inList) out += '</ul>';
    return out;
  }

  function style() {
    var css = '' +
      '.kbw-btn{position:fixed;bottom:20px;right:20px;z-index:2147483000;background:' + ACCENT + ';color:#fff;border:none;border-radius:9999px;padding:12px 18px;font:600 14px system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25)}' +
      '.kbw-panel{position:fixed;bottom:78px;right:20px;z-index:2147483000;width:360px;max-width:calc(100vw - 40px);height:70vh;max-height:560px;display:none;flex-direction:column;background:#fff;color:#0f172a;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.25);font:14px system-ui,sans-serif;overflow:hidden}' +
      '.kbw-panel.kbw-open{display:flex}' +
      '.kbw-head{padding:14px 16px;font-weight:600;color:#fff;background:' + ACCENT + '}' +
      '.kbw-tabs{display:flex;border-bottom:1px solid #eef2f7}' +
      '.kbw-tab{flex:1;padding:10px;background:none;border:none;cursor:pointer;font:600 13px system-ui;color:#64748b}' +
      '.kbw-tab.kbw-active{color:' + ACCENT + ';box-shadow:inset 0 -2px 0 ' + ACCENT + '}' +
      '.kbw-body{flex:1;overflow:auto;display:flex;flex-direction:column}' +
      '.kbw-search{margin:12px 16px;width:calc(100% - 32px);box-sizing:border-box;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;font:14px system-ui}' +
      '.kbw-results a{display:block;padding:10px 16px;color:#0f172a;text-decoration:none;border-top:1px solid #f1f5f9}' +
      '.kbw-results a:hover{background:#f8fafc}' +
      '.kbw-results .kbw-t{font-weight:600}' +
      '.kbw-results .kbw-e{color:#64748b;font-size:12px;margin-top:2px}' +
      '.kbw-empty{padding:14px 16px;color:#64748b}' +
      '.kbw-msgs{flex:1;overflow:auto;padding:14px 16px;display:flex;flex-direction:column;gap:10px}' +
      '.kbw-msg{max-width:85%;padding:8px 12px;border-radius:14px;line-height:1.45}' +
      '.kbw-msg ul{margin:6px 0;padding-left:20px}.kbw-msg code{background:rgba(128,128,128,.16);padding:1px 5px;border-radius:4px}' +
      '.kbw-user{align-self:flex-end;background:' + ACCENT + ';color:#fff}' +
      '.kbw-bot{align-self:flex-start;background:#f1f5f9;color:#0f172a}' +
      '.kbw-src{margin-top:8px;border-top:1px solid #e2e8f0;padding-top:6px}' +
      '.kbw-src .kbw-sl{font-size:11px;color:#64748b;margin-bottom:3px}' +
      '.kbw-src a{display:block;font-size:12px;color:' + ACCENT + ';text-decoration:none}' +
      '.kbw-src a:hover{text-decoration:underline}' +
      '.kbw-form{display:flex;gap:8px;padding:10px;border-top:1px solid #eef2f7}' +
      '.kbw-input{flex:1;padding:9px 12px;border:1px solid #cbd5e1;border-radius:10px;font:14px system-ui}' +
      '.kbw-send{background:' + ACCENT + ';color:#fff;border:none;border-radius:10px;padding:0 14px;font:600 14px system-ui;cursor:pointer}' +
      '.kbw-send:disabled{opacity:.45;cursor:default}';
    document.head.appendChild(el('style', null, css));
  }

  // --- Search tab ---------------------------------------------------------

  function renderSearch(results, query) {
    var box = document.querySelector('.kbw-results');
    if (!box) return;
    if (!query || query.length < 2) { box.innerHTML = ''; return; }
    if (!results.length) { box.innerHTML = '<div class="kbw-empty">Inga träffar för ”' + escapeHtml(query) + '”.</div>'; return; }
    box.innerHTML = results.map(function (a) {
      return '<a href="' + base + '/help/' + encodeURIComponent(a.slug) + '" target="_blank" rel="noopener">' +
        '<div class="kbw-t">' + escapeHtml(a.title) + '</div>' +
        (a.excerpt ? '<div class="kbw-e">' + escapeHtml(a.excerpt) + '</div>' : '') +
        '</a>';
    }).join('');
  }

  function search(q) {
    fetch(base + '/api/public/kb/search?q=' + encodeURIComponent(q))
      .then(function (r) { return r.json(); })
      .then(function (d) { renderSearch(d.results || [], q); })
      .catch(function () { renderSearch([], q); });
  }

  // --- Chat tab -----------------------------------------------------------

  function addMsg(role, html) {
    var msgs = document.querySelector('.kbw-msgs');
    var node = el('div', { class: 'kbw-msg ' + (role === 'user' ? 'kbw-user' : 'kbw-bot') });
    node.innerHTML = html;
    msgs.appendChild(node);
    msgs.scrollTop = msgs.scrollHeight;
    return node;
  }

  function renderSources(node, sources) {
    if (!sources || !sources.length) return;
    var box = el('div', { class: 'kbw-src' });
    box.appendChild(el('div', { class: 'kbw-sl' }, 'Källor'));
    sources.forEach(function (s) {
      var a = el('a', { href: base + '/help/' + encodeURIComponent(s.slug), target: '_blank', rel: 'noopener' });
      a.textContent = s.title;
      box.appendChild(a);
    });
    node.appendChild(box);
    var msgs = document.querySelector('.kbw-msgs');
    msgs.scrollTop = msgs.scrollHeight;
  }

  function setBusy(b) {
    busy = b;
    var btn = document.querySelector('.kbw-send');
    if (btn) btn.disabled = b;
  }

  function sendChat(question) {
    if (busy || !question) return;
    setBusy(true);
    addMsg('user', escapeHtml(question));

    var bot = addMsg('bot', '<span style="color:#64748b">Söker i hjälpcentret…</span>');
    var answer = '';
    var msgs = document.querySelector('.kbw-msgs');

    var priorHistory = history.slice();
    history.push({ role: 'user', content: question });

    fetch(base + '/api/public/kb/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: question, history: priorHistory })
    }).then(function (res) {
      if (!res.ok || !res.body) throw new Error('failed');
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';

      function handleLine(line) {
        var t = line.trim();
        if (!t) return;
        var evt;
        try { evt = JSON.parse(t); } catch (e) { return; }
        if (evt.type === 'delta' && typeof evt.text === 'string') {
          answer += evt.text;
          bot.innerHTML = mdToHtml(answer);
          msgs.scrollTop = msgs.scrollHeight;
        } else if (evt.type === 'done') {
          if (!answer) bot.innerHTML = escapeHtml('Något gick fel. Försök igen.');
          renderSources(bot, evt.sources);
          history.push({ role: 'assistant', content: answer });
        }
      }

      function pump() {
        return reader.read().then(function (r) {
          if (r.done) { if (buffer.trim()) handleLine(buffer); return; }
          buffer += decoder.decode(r.value, { stream: true });
          var lines = buffer.split('\n');
          buffer = lines.pop() || '';
          lines.forEach(handleLine);
          return pump();
        });
      }
      return pump();
    }).catch(function () {
      if (!answer) bot.innerHTML = escapeHtml('Något gick fel. Försök igen om en liten stund.');
    }).then(function () {
      setBusy(false);
    });
  }

  // --- Tabs / build -------------------------------------------------------

  function showTab(name) {
    tab = name;
    var chat = document.querySelector('.kbw-chat');
    var srch = document.querySelector('.kbw-srch');
    var tChat = document.querySelector('.kbw-tab-chat');
    var tSrch = document.querySelector('.kbw-tab-srch');
    if (chat) chat.style.display = name === 'chat' ? 'flex' : 'none';
    if (srch) srch.style.display = name === 'search' ? 'block' : 'none';
    if (tChat) tChat.classList.toggle('kbw-active', name === 'chat');
    if (tSrch) tSrch.classList.toggle('kbw-active', name === 'search');
    if (name === 'chat') { var ci = document.querySelector('.kbw-input'); if (ci) ci.focus(); }
  }

  function build() {
    style();

    var btn = el('button', { class: 'kbw-btn', 'aria-label': 'Hjälp' }, 'Hjälp');
    var panel = el('div', { class: 'kbw-panel' });
    panel.appendChild(el('div', { class: 'kbw-head' }, 'Hjälpcenter'));

    var tabs = el('div', { class: 'kbw-tabs' });
    var tabChat = el('button', { class: 'kbw-tab kbw-tab-chat kbw-active' }, 'Fråga AI');
    var tabSrch = el('button', { class: 'kbw-tab kbw-tab-srch' }, 'Sök');
    tabs.appendChild(tabChat);
    tabs.appendChild(tabSrch);
    panel.appendChild(tabs);

    var body = el('div', { class: 'kbw-body' });

    // Chat view
    var chat = el('div', { class: 'kbw-chat', style: 'flex:1;display:flex;flex-direction:column;min-height:0' });
    var msgs = el('div', { class: 'kbw-msgs' });
    msgs.appendChild(el('div', { class: 'kbw-msg kbw-bot' }, 'Hej! Ställ en fråga så söker jag svar i hjälpcentret.'));
    chat.appendChild(msgs);
    var form = el('div', { class: 'kbw-form' });
    var input = el('input', { class: 'kbw-input', type: 'text', placeholder: 'Skriv din fråga…', maxlength: '1000' });
    var send = el('button', { class: 'kbw-send' }, 'Skicka');
    form.appendChild(input);
    form.appendChild(send);
    chat.appendChild(form);
    body.appendChild(chat);

    // Search view
    var srch = el('div', { class: 'kbw-srch', style: 'display:none' });
    var sInput = el('input', { class: 'kbw-search', type: 'search', placeholder: 'Sök…' });
    srch.appendChild(sInput);
    srch.appendChild(el('div', { class: 'kbw-results' }));
    body.appendChild(srch);

    panel.appendChild(body);

    function submit() {
      var q = input.value.trim();
      if (!q) return;
      input.value = '';
      sendChat(q);
    }
    send.addEventListener('click', submit);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); submit(); } });

    sInput.addEventListener('input', function () {
      var q = sInput.value.trim();
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { search(q); }, 250);
    });

    tabChat.addEventListener('click', function () { showTab('chat'); });
    tabSrch.addEventListener('click', function () { showTab('search'); });

    btn.addEventListener('click', function () {
      open = !open;
      panel.classList.toggle('kbw-open', open);
      if (open) showTab(tab);
    });

    document.body.appendChild(btn);
    document.body.appendChild(panel);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', build);
  } else {
    build();
  }
})();
