/*
 * Doldadress help-center widget.
 *
 * Drop-in search popup that any website can embed. It talks only to the
 * public, read-only help API (/api/public/kb/*), so no API key is needed.
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
  var timer = null;

  function el(tag, attrs, html) {
    var node = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    if (html != null) node.innerHTML = html;
    return node;
  }

  function style() {
    var css = '' +
      '.kbw-btn{position:fixed;bottom:20px;right:20px;z-index:2147483000;background:' + ACCENT + ';color:#fff;border:none;border-radius:9999px;padding:12px 18px;font:600 14px system-ui,sans-serif;cursor:pointer;box-shadow:0 4px 14px rgba(0,0,0,.25)}' +
      '.kbw-panel{position:fixed;bottom:78px;right:20px;z-index:2147483000;width:340px;max-width:calc(100vw - 40px);max-height:70vh;overflow:auto;background:#fff;color:#0f172a;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.25);font:14px system-ui,sans-serif;display:none}' +
      '.kbw-panel.kbw-open{display:block}' +
      '.kbw-head{padding:14px 16px;font-weight:600;border-bottom:1px solid #eef2f7}' +
      '.kbw-search{margin:12px 16px;width:calc(100% - 32px);box-sizing:border-box;padding:10px 12px;border:1px solid #cbd5e1;border-radius:10px;font:14px system-ui}' +
      '.kbw-results a{display:block;padding:10px 16px;color:#0f172a;text-decoration:none;border-top:1px solid #f1f5f9}' +
      '.kbw-results a:hover{background:#f8fafc}' +
      '.kbw-results .kbw-t{font-weight:600}' +
      '.kbw-results .kbw-e{color:#64748b;font-size:12px;margin-top:2px}' +
      '.kbw-empty{padding:14px 16px;color:#64748b}';
    document.head.appendChild(el('style', null, css));
  }

  function render(results, query) {
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

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function search(q) {
    fetch(base + '/api/public/kb/search?q=' + encodeURIComponent(q))
      .then(function (r) { return r.json(); })
      .then(function (d) { render(d.results || [], q); })
      .catch(function () { render([], q); });
  }

  function build() {
    style();

    var btn = el('button', { class: 'kbw-btn', 'aria-label': 'Hjälp' }, 'Hjälp');
    var panel = el('div', { class: 'kbw-panel' });
    panel.appendChild(el('div', { class: 'kbw-head' }, 'Hjälpcenter'));
    var input = el('input', { class: 'kbw-search', type: 'search', placeholder: 'Sök…' });
    panel.appendChild(input);
    panel.appendChild(el('div', { class: 'kbw-results' }));

    btn.addEventListener('click', function () {
      open = !open;
      panel.classList.toggle('kbw-open', open);
      if (open) input.focus();
    });

    input.addEventListener('input', function () {
      var q = input.value.trim();
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { search(q); }, 250);
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
