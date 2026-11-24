/* Апта — standalone runtime for the app's .dc.html screens.
   Renders the <x-dc> template with the page's Component class, re-rendering on setState
   with a keyed DOM patch so scroll positions, refs and running animations survive. */
(function () {
  'use strict';
  var hide = document.createElement('style');
  hide.textContent = 'x-dc{display:none!important}html,body{margin:0;height:100%;overflow:hidden;overscroll-behavior:none;-webkit-text-size-adjust:100%}#apta-stage{position:fixed;left:0;top:0;transform-origin:0 0}';
  document.head.appendChild(hide);
  if (!document.querySelector('meta[name=viewport]')) {
    var mv = document.createElement('meta'); mv.name = 'viewport'; mv.content = 'width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no, interactive-widget=overlays-content'; document.head.appendChild(mv);
  }

  // light <-> dark twin of every screen; the profile's theme choice (or the phone's) picks one
  var PAIRS = [['Main', 'Dark'], ['CalLight', 'CalDark'], ['CalHabits', 'CalHabitsDark'], ['FinLight', 'FinDark'], ['ProfLight', 'ProfDark'], ['NotesLight', 'NotesDark'],
    ['NotesDiary', 'NotesDiaryDark'], ['OnboardLight', 'OnboardDark'], ['AuthLight', 'AuthDark']];
  function wantDark() {
    var t = 'auto'; try { t = ((JSON.parse(localStorage.getItem('apta.v1') || '{}') || {}).profile || {}).theme || 'auto'; } catch (e) {}
    if (t === 'light') return false; if (t === 'dark') return true;
    return !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  }
  window.__aptaTheme = function () {
    var file = (location.pathname.split('/').pop() || '').replace('.dc.html', ''), dark = wantDark();
    for (var i = 0; i < PAIRS.length; i++) {
      var p = PAIRS[i], to = null;
      if (file === p[0] && dark) to = p[1]; else if (file === p[1] && !dark) to = p[0];
      if (to) { location.replace(to + '.dc.html' + location.search + location.hash); return true; }
    }
    return false;
  };
  if (window.__aptaTheme()) return;
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { window.__aptaTheme(); }); } catch (e) {}
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (r) { try { r.update(); } catch (e) {} }).catch(function () {});

  var HOLE = /\{\{\s*([^}]+?)\s*\}\}/g;
  var uid = 0;

  function parts(str) {
    var out = [], last = 0, m; HOLE.lastIndex = 0;
    while ((m = HOLE.exec(str))) { if (m.index > last) out.push(str.slice(last, m.index)); out.push({ e: m[1] }); last = HOLE.lastIndex; }
    if (last < str.length) out.push(str.slice(last));
    return out;
  }
  function hasHole(p) { for (var i = 0; i < p.length; i++) if (typeof p[i] !== 'string') return true; return false; }

  function compile(n, isRoot) {
    if (n.nodeType === 3) { var p = parts(n.nodeValue); return { t: 'x', p: p, id: ++uid }; }
    if (n.nodeType !== 1) return null;
    var tag = n.localName;
    var kids = []; for (var c = n.firstChild; c; c = c.nextSibling) { var k = compile(c, false); if (k) kids.push(k); }
    if (tag === 'sc-if') return { t: 'if', v: parts(n.getAttribute('value') || ''), k: kids, id: ++uid };
    if (tag === 'sc-for') return { t: 'for', l: parts(n.getAttribute('list') || ''), as: n.getAttribute('as') || 'item', k: kids, id: ++uid };
    if (tag === 'helmet' || tag === 'script') return null;
    var attrs = [], ev = [], ref = null;
    for (var i = 0; i < n.attributes.length; i++) {
      var a = n.attributes[i], name = a.name, val = a.value;
      if (name.indexOf('hint-') === 0) continue;
      if (name === 'ref') { ref = parts(val); continue; }
      if (/^on[a-z]+$/.test(name) && val.indexOf('{{') >= 0) { ev.push([name.slice(2), parts(val)]); continue; }
      if (isRoot && name === 'style') val = val.replace('height: 844px', 'height: var(--appH, 844px)');
      attrs.push([name, parts(val)]);
    }
    return { t: 'e', tag: tag, ns: n.namespaceURI, a: attrs, ev: ev, ref: ref, k: kids, id: ++uid };
  }

  function look(expr, scope) {
    if (expr === 'true') return true; if (expr === 'false') return false;
    var path = expr.split('.'), v;
    for (var s = scope; s; s = s.up) { if (s.v && Object.prototype.hasOwnProperty.call(s.v, path[0])) { v = s.v[path[0]]; break; } }
    for (var i = 1; i < path.length && v != null; i++) v = v[path[i]];
    return v;
  }
  function val(p, scope) {
    if (p.length === 1 && typeof p[0] !== 'string') return look(p[0].e, scope);
    var s = ''; for (var i = 0; i < p.length; i++) { var x = p[i]; if (typeof x === 'string') s += x; else { var v = look(x.e, scope); s += v == null || v === false ? (v === false ? 'false' : '') : v; } }
    return s;
  }

  function render(list, scope, key, out) {
    for (var i = 0; i < list.length; i++) {
      var n = list[i];
      if (n.t === 'x') { out.push({ key: key + n.id, text: hasHole(n.p) ? String(val(n.p, scope) == null ? '' : val(n.p, scope)) : n.p.join('') }); continue; }
      if (n.t === 'if') { if (val(n.v, scope)) render(n.k, scope, key, out); continue; }
      if (n.t === 'for') {
        var arr = val(n.l, scope) || [];
        for (var j = 0; j < arr.length; j++) { var v = {}; v[n.as] = arr[j]; render(n.k, { v: v, up: scope }, key + n.id + ':' + j + '/', out); }
        continue;
      }
      var at = {}; for (var a = 0; a < n.a.length; a++) { var r = val(n.a[a][1], scope); if (r === undefined || r === null) continue; at[n.a[a][0]] = r === true ? 'true' : String(r); }
      var ev = null; for (var e = 0; e < n.ev.length; e++) { var f = val(n.ev[e][1], scope); if (typeof f === 'function') (ev || (ev = {}))[n.ev[e][0]] = f; }
      var kids = []; render(n.k, scope, key, kids);
      out.push({ key: key + n.id, tag: n.tag, ns: n.ns, at: at, ev: ev, ref: n.ref ? val(n.ref, scope) : null, k: kids });
    }
    return out;
  }

  var refQ = [];
  function create(v) {
    if (v.text !== undefined) { var t = document.createTextNode(v.text); v.el = t; return t; }
    var el = v.ns && v.ns !== 'http://www.w3.org/1999/xhtml' ? document.createElementNS(v.ns, v.tag) : document.createElement(v.tag);
    for (var k in v.at) el.setAttribute(k, v.at[k]);
    setEv(el, v.ev);
    for (var i = 0; i < v.k.length; i++) el.appendChild(create(v.k[i]));
    v.el = el; if (typeof v.ref === 'function') refQ.push([v.ref, el]);
    return el;
  }
  function setEv(el, ev) {
    var cur = el.__ev || (el.__ev = {});
    for (var t in cur) if (!ev || !ev[t]) cur[t] = null;
    if (ev) for (var u in ev) {
      if (!(u in cur)) el.addEventListener(u, (function (type) { return function (e) { var h = el.__ev[type]; if (h) h(e); }; })(u), u === 'wheel' || u === 'touchmove' ? { passive: false } : false);
      cur[u] = ev[u];
    }
  }
  function update(o, v) {
    var el = o.el; v.el = el;
    if (v.text !== undefined) { if (o.text !== v.text) el.nodeValue = v.text; return; }
    for (var k in v.at) if (o.at[k] !== v.at[k]) el.setAttribute(k, v.at[k]);
    for (var j in o.at) if (!(j in v.at)) el.removeAttribute(j);
    setEv(el, v.ev);
    patch(el, o.k, v.k);
    if (typeof v.ref === 'function') refQ.push([v.ref, el]);
  }
  function drop(o) { if (o.text === undefined) { if (typeof o.ref === 'function') { try { o.ref(null); } catch (e) {} } for (var i = 0; i < o.k.length; i++) drop(o.k[i]); } }
  function patch(parent, olds, news) {
    var byKey = {}; for (var i = 0; i < olds.length; i++) byKey[olds[i].key] = olds[i];
    var used = {};
    for (var n = 0; n < news.length; n++) {
      var v = news[n], o = byKey[v.key];
      if (o && !used[v.key] && (o.text !== undefined) === (v.text !== undefined) && o.tag === v.tag) { used[v.key] = 1; update(o, v); }
      else create(v);
      var at = parent.childNodes[n];
      if (at !== v.el) parent.insertBefore(v.el, at || null);
    }
    if (olds.length) {
      var keep = new Set(); for (var q = 0; q < news.length; q++) keep.add(news[q].el);
      for (var r = 0; r < olds.length; r++) { var x = olds[r]; if (!keep.has(x.el)) { drop(x); if (x.el.parentNode === parent) parent.removeChild(x.el); } }
    }
  }

  function DCLogic(props) { this.props = props || {}; this.state = {}; }
  DCLogic.prototype.setState = function (p, cb) {
    var patch_ = typeof p === 'function' ? p(this.state, this.props) : p;
    if (patch_) { var next = {}; for (var k in this.state) next[k] = this.state[k]; for (var j in patch_) next[j] = patch_[j]; this.state = next; }
    if (this.__sched) this.__sched(); if (typeof cb === 'function') Promise.resolve().then(cb);
  };
  DCLogic.prototype.forceUpdate = function () { if (this.__sched) this.__sched(); };
  window.DCLogic = DCLogic;

  /* ---- native text editing: the screens draw their own caret; in the installed app a real
     <input>/<textarea> is laid exactly over the field that has that caret, so the phone's own
     keyboard (every language, hold-to-delete, select, copy, cut, paste) edits the page's state. */
  window.__aptaApp = true;
  var css = document.createElement('style');
  css.textContent = '[role="group"][aria-label="Пернетақта"]{display:none!important}' +
    '#apta-stage [style*="aptaBlink"]{visibility:hidden!important;width:0!important;margin:0!important}' +
    '.apta-hide,.apta-hide *{color:transparent!important;-webkit-text-fill-color:transparent!important}' +
    '.apta-nf{position:absolute;z-index:50;box-sizing:border-box;margin:0;padding:0;border:none;outline:none;background:transparent;resize:none;overflow:hidden;' +
    '-webkit-user-select:text;user-select:text;-webkit-tap-highlight-color:transparent;border-radius:0;appearance:none}' +
    '.apta-nf.rich{color:transparent!important;-webkit-text-fill-color:transparent}' +
    '.apta-nf::selection{background:rgba(120,160,255,0.35)}' +
    '#apta-stage section[role="dialog"]{max-height:calc(var(--appH, 844px) - var(--kbH, 0px) - 64px);overflow-y:auto;overscroll-behavior:contain;scrollbar-width:none}#apta-stage section[role="dialog"]:not([style*="; top: "])>*{flex-shrink:0}';
  document.head.appendChild(css);
  window.__aptaKbH = 0;
  var KB = { full: 0, scale: 1, onChange: null };
  function kbSet(px) { var h = Math.max(0, Math.round(px / (KB.scale || 1))); if (h < 60) h = 0; if (h !== window.__aptaKbH) { window.__aptaKbH = h; var st = document.getElementById('apta-stage'); if (st) st.style.setProperty('--kbH', h + 'px'); if (KB.onChange) KB.onChange(); } }
  try { if ('virtualKeyboard' in navigator) { navigator.virtualKeyboard.overlaysContent = true; navigator.virtualKeyboard.addEventListener('geometrychange', function (e) { kbSet(e.target.boundingRect.height); }); } } catch (x) {}
  if (window.visualViewport) visualViewport.addEventListener('resize', function () { if (!('virtualKeyboard' in navigator)) kbSet(Math.max(0, (KB.full || window.innerHeight) - visualViewport.height)); });
  var NF = { el: null, row: null, key: null, comp: null, stage: null, sel: null };
  window.__aptaSel = function () { var x = NF.el && NF.sel ? { s: NF.sel.s, e: NF.sel.e, key: NF.key } : NF.last; if (!x || !(x.s < x.e)) return null; return { s: x.s, e: x.e, key: String(x.key || '').split('|')[0] }; };
  function nfOf(comp) { return comp && comp.state && comp.state.srOpen ? comp._nfSr : comp && comp._nf; }
  function clickKey(names) {
    for (var i = 0; i < names.length; i++) { var b = NF.stage.querySelector('[aria-label="Пернетақта"] button[aria-label="' + names[i] + '"]'); if (b) { b.click(); return true; } }
    return false;
  }
  function saveSel() { var e = NF.el; if (e && document.activeElement === e) NF.sel = { s: e.selectionStart, e: e.selectionEnd }; }
  function scrollParent(n) { for (var p = n.parentElement; p && p !== NF.stage; p = p.parentElement) { var o = getComputedStyle(p).overflowY; if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p; } return null; }
  function place(scale) {
    var e = NF.el, r = NF.row; if (!e || !r || !r.isConnected) return;
    var rr = r.getBoundingClientRect(), sr = NF.stage.getBoundingClientRect(); var s = scale || (sr.width / 390) || 1;
    var pr = r.parentElement ? r.parentElement.getBoundingClientRect() : rr, pcs = r.parentElement ? getComputedStyle(r.parentElement) : null;
    var cs0 = getComputedStyle(r); var centered = cs0.textAlign === 'center' || cs0.justifyContent === 'center';
    var right = centered ? rr.right : Math.max(rr.right, pr.right - (pcs ? parseFloat(pcs.paddingRight) || 0 : 0) * s);
    var w = (right - rr.left) / s, h = rr.height / s, k = r.offsetWidth ? (rr.width / s) / r.offsetWidth : 1; if (Math.abs(k - 1) < 0.03) k = 1;
    var cs = getComputedStyle(r);
    e.style.left = (rr.left - sr.left) / s + 'px'; e.style.top = (rr.top - sr.top) / s + 'px'; e.style.width = Math.max(w, 24) + 'px'; e.style.height = Math.max(h, parseFloat(cs.fontSize) * 1.3 * k) + 'px';
    e.style.fontFamily = cs.fontFamily; e.style.fontWeight = cs.fontWeight; e.style.fontStyle = cs.fontStyle; e.style.letterSpacing = cs.letterSpacing;
    e.style.fontSize = parseFloat(cs.fontSize) * k + 'px'; e.style.lineHeight = cs.lineHeight === 'normal' ? 'normal' : parseFloat(cs.lineHeight) * k + 'px';
    e.style.textAlign = cs.textAlign === 'center' ? 'center' : 'left';
    if (!e.classList.contains('rich')) e.style.color = NF.color || cs.color;
    var ac = '#C8F542'; try { ac = NF.comp.accentNow(); } catch (x) {} e.style.caretColor = /^#(fff|ffffff)$/i.test(ac) ? cs.color : ac;
    if (centered) {
      var box = r, bcs = cs; for (var i = 0; i < 3 && box; i++) { bcs = getComputedStyle(box); if ((bcs.backgroundColor && !/rgba\(0, 0, 0, 0\)|transparent/.test(bcs.backgroundColor)) || bcs.backgroundImage !== 'none') break; box = box.parentElement; }
      if (!box) { box = r; bcs = cs; }
      var br = box.getBoundingClientRect(); var fs = parseFloat(cs.fontSize) * k;
      var ctx = (NF.cv || (NF.cv = document.createElement('canvas'))).getContext('2d'); ctx.font = cs.fontWeight + ' ' + fs + 'px ' + cs.fontFamily;
      var tw = ctx.measureText(e.value || ' ').width; var bw = br.width / s, bh = br.height / s; var W = Math.max(bw, tw + 28 * k), H = Math.max(bh, fs * 1.6);
      var cx = (br.left + br.width / 2 - sr.left) / s, cy = (br.top + br.height / 2 - sr.top) / s;
      e.style.left = (cx - W / 2) + 'px'; e.style.top = (cy - H / 2) + 'px'; e.style.width = W + 'px'; e.style.height = H + 'px'; e.style.lineHeight = H + 'px';
      e.style.textAlign = 'center'; e.style.padding = '0 ' + (12 * k) + 'px'; e.style.borderRadius = bcs.borderRadius;
      e.style.background = bcs.backgroundImage !== 'none' ? bcs.backgroundImage + ', ' + bcs.backgroundColor : bcs.backgroundColor; e.style.boxShadow = bcs.boxShadow; e.style.border = bcs.border;
      e.style.color = NF.color || cs.color;
    }
    // never show the text layer outside the part of the screen its field is visible in
    var clipEl = scrollParent(r) || r.closest('section[role="dialog"]'); var vtop = sr.top, vbot = Math.min(sr.bottom, window.innerHeight - (window.__aptaKbH || 0) * s);
    if (clipEl) { var cr = clipEl.getBoundingClientRect(); vtop = Math.max(vtop, cr.top); vbot = Math.min(vbot, cr.bottom); }
    var er = { top: parseFloat(e.style.top) * s + sr.top, h: parseFloat(e.style.height) * s };
    var ct = Math.max(0, (vtop - er.top) / s), cb = Math.max(0, (er.top + er.h - vbot) / s);
    e.style.clipPath = (ct || cb) ? 'inset(' + Math.min(ct, 4000) + 'px 0 ' + Math.min(cb, 4000) + 'px 0)' : '';
  }
  // keep the text layer glued to its field while sheets slide (keyboard opening/closing)
  function follow(ms) { var until = Date.now() + (ms || 600); if (NF.fol) { NF.folUntil = Math.max(NF.folUntil, until); return; } NF.fol = true; NF.folUntil = until;
    (function step() { place(); if (Date.now() < NF.folUntil && NF.el) requestAnimationFrame(step); else NF.fol = false; })(); }
  function reveal() {
    var r = NF.row; if (!r || !r.isConnected) return; var sp = scrollParent(r); if (!sp) return;
    var a = r.getBoundingClientRect(), b = sp.getBoundingClientRect(); var vb = Math.min(b.bottom, window.innerHeight - (window.__aptaKbH || 0) * (KB.scale || 1));
    if (a.top < b.top + 8) sp.scrollTop -= b.top + 8 - a.top; else if (a.bottom > vb - 12) sp.scrollTop += Math.min(a.bottom - vb + 12, a.top - b.top - 8);
  }
  function detach() {
    if (NF.el && NF.sel) NF.last = { s: NF.sel.s, e: NF.sel.e, key: NF.key };
    if (NF.row) NF.row.classList.remove('apta-hide');
    if (NF.el) { var e = NF.el; NF.el = null; if (e.parentNode) e.parentNode.removeChild(e); }
    NF.row = null; NF.key = null; NF.sel = null;
  }
  function attach(row, nf, comp) {
    var rcs = getComputedStyle(row), isC = rcs.textAlign === 'center' || rcs.justifyContent === 'center'; var rich = row.hasAttribute('data-rich'), inner = row.querySelector('span') || row, wrap = rich || (!isC) && !(/nowrap/.test(getComputedStyle(row).whiteSpace) || /nowrap/.test(getComputedStyle(inner).whiteSpace));
    NF.color = getComputedStyle(inner).color;
    var type = nf.type || 'text';
    var e = type === 'text' && (rich || wrap) ? document.createElement('textarea') : document.createElement('input');
    if (e.tagName === 'INPUT') { e.type = type; e.autocomplete = type === 'password' ? 'current-password' : type === 'email' ? 'email' : 'off'; if (type === 'email') e.inputMode = 'email'; }
    else { e.rows = 1; e.style.whiteSpace = 'pre-wrap'; e.style.overflowWrap = 'anywhere'; }
    e.className = 'apta-nf' + (rich ? ' rich' : ''); e.spellcheck = true; e.setAttribute('autocapitalize', type === 'text' ? 'sentences' : 'none');
    e.value = nf.get() || '';
    e.addEventListener('input', function () { var f = nfOf(comp); if (f) f.set(e.value); saveSel(); });
    ['select', 'keyup', 'pointerup', 'focus'].forEach(function (t) { e.addEventListener(t, saveSel); });
    e.addEventListener('keydown', function (ev) {
      var f = nfOf(comp); if (!f) return;
      if (ev.key === 'Enter' && !ev.isComposing) {
        if (f.enter) { ev.preventDefault(); var c = f.enter(e.selectionStart, e.value); if (typeof c === 'number') NF.pendingCaret = c; return; }
        if (e.tagName === 'INPUT') { ev.preventDefault(); if (!clickKey(['↵', 'Келесі', 'Дайын'])) e.blur(); }
        return;
      }
      if (ev.key === 'Backspace' && f.back0 && e.selectionStart === 0 && e.selectionEnd === 0) { ev.preventDefault(); var c2 = f.back0(); if (typeof c2 === 'number') NF.pendingCaret = c2; }
    });
    NF.stage.appendChild(e); NF.el = e; NF.row = row;
    if (!rich) row.classList.add('apta-hide');
    place();
    try { e.focus({ preventScroll: true }); var n = e.value.length; if (typeof NF.pendingCaret === 'number') { n = Math.min(NF.pendingCaret, n); NF.pendingCaret = null; } e.setSelectionRange(n, n); } catch (x) {}
    setTimeout(reveal, 60);
  }
  function syncField(comp, stage) {
    NF.stage = stage; NF.comp = comp;
    var nf = nfOf(comp), caret = null;
    var cs = stage.querySelectorAll('[style*="aptaBlink"]');
    for (var i = 0; i < cs.length; i++) { if (cs[i].getClientRects().length || cs[i].parentElement.getClientRects().length) { caret = cs[i]; break; } }
    if (!caret || !nf) { detach(); return; }
    var row = caret.parentElement, key = (nf.key || '') + '|' + (nf.type || '');
    if (NF.row !== row || NF.key !== key || !NF.el) {
      var hadFocus = NF.el && document.activeElement === NF.el; detach(); NF.last = null; NF.key = key; attach(row, nf, comp);
      if (!hadFocus && NF.el) { /* first open keeps focus from the tap that caused it */ }
      return;
    }
    if (!row.hasAttribute('data-rich')) row.classList.add('apta-hide');
    var v = nf.get() || '';
    if (NF.el.value !== v && !NF.composing) { var p = NF.el.selectionStart; NF.el.value = v; try { NF.el.setSelectionRange(Math.min(p, v.length), Math.min(p, v.length)); } catch (x) {} }
    if (typeof NF.pendingCaret === 'number') { try { var q = Math.min(NF.pendingCaret, NF.el.value.length); NF.el.setSelectionRange(q, q); } catch (x) {} NF.pendingCaret = null; }
    place(); follow(500); reveal();
  }
  document.addEventListener('compositionstart', function () { NF.composing = true; }, true);
  document.addEventListener('compositionend', function () { NF.composing = false; }, true);
  document.addEventListener('selectionchange', saveSel);
  // tapping a button while typing keeps the text focused and its selection (so tools act on it)
  document.addEventListener('mousedown', function (ev) { if (NF.el && document.activeElement === NF.el && ev.target.closest && ev.target.closest('button,[role="button"]') && ev.target !== NF.el) ev.preventDefault(); }, true);
  document.addEventListener('pointerdown', function () { NF.downEl = NF.el && document.activeElement === NF.el ? NF.el : null; }, true);
  document.addEventListener('click', function (ev) { var e = NF.el; if (!e || e !== NF.downEl || document.activeElement !== e || !ev.target.closest) return; var t = ev.target;
    if (t === e || t.closest('[role="toolbar"]') || t.closest('[aria-label="Пернетақта"]') || (NF.row && t.contains && t.contains(NF.row))) return;
    var was = e; setTimeout(function () { if (NF.el === was && document.activeElement === was) was.blur(); }, 0); });
  var TM = null;
  document.addEventListener('touchstart', function (ev) { TM = ev.touches && ev.touches[0] ? { x: ev.touches[0].clientX, y: ev.touches[0].clientY } : null; }, { passive: true, capture: true });
  document.addEventListener('touchmove', function (ev) { var e = NF.el; if (!e || !TM || document.activeElement !== e || ev.target === e) return; var c = NF.comp, st = (c && c.state) || {};
    if (c && (c._armed || c._vArm || (st.drag && st.drag.id != null) || st.vdrag)) return; var t = ev.touches && ev.touches[0]; if (t && Math.hypot(t.clientX - TM.x, t.clientY - TM.y) > 12) { TM = null; e.blur(); } }, { passive: true, capture: true });
  document.addEventListener('scroll', function () { if (NF.el) place(); }, true);
  // after a long press picks something up, the finger moves it instead of scrolling the page
  document.addEventListener('touchmove', function (ev) { var c = NF.comp; if (!c) return; var st = c.state || {};
    if (c._armed || c._vArm || (st.drag && st.drag.id != null) || st.vdrag || (st.mDrag) || st.bDrag) { if (ev.cancelable) ev.preventDefault(); } }, { passive: false });
  document.addEventListener('contextmenu', function (ev) { var t = ev.target; if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return; ev.preventDefault(); });
  document.addEventListener('transitionend', function () { if (NF.el) place(); }, true);
  document.addEventListener('animationend', function () { if (NF.el) place(); }, true);

  function fit(stage) {
    var W = window.innerWidth, H = window.innerHeight, s, h, x = 0;
    if (NF.el && document.activeElement === NF.el && KB.full && H < KB.full && W === KB.w) H = KB.full; else { KB.full = H; KB.w = W; }
    if (W / H < 0.66) { s = W / 390; h = H / s; } else { s = Math.min(1, H / 844); h = 844; x = (W - 390 * s) / 2; }
    KB.scale = s; stage.style.transform = 'translate(' + x + 'px,0) scale(' + s + ')';
    stage.style.setProperty('--appH', Math.round(h) + 'px');
    stage.style.width = '390px'; stage.style.height = Math.round(h) + 'px';
  }

  function boot() {
    var x = document.querySelector('x-dc'); if (!x) return;
    var helmet = x.querySelector('helmet');
    if (helmet) { Array.prototype.slice.call(helmet.childNodes).forEach(function (n) { if (n.nodeType === 1) document.head.appendChild(n); }); helmet.parentNode.removeChild(helmet); }
    var sc = document.querySelector('script[data-dc-script]');
    var props = {};
    try { var dp = JSON.parse(sc.getAttribute('data-props') || '{}'); for (var k in dp) if (k.charAt(0) !== '$' && dp[k] && 'default' in dp[k]) props[k] = dp[k].default; } catch (e) {}
    var Comp = new Function('DCLogic', sc.textContent + '\n;return Component;')(DCLogic);
    var tpl = [], first = true;
    for (var c = x.firstChild; c; c = c.nextSibling) { var t = compile(c, c.nodeType === 1 && first); if (c.nodeType === 1) first = false; if (t) tpl.push(t); }
    x.parentNode.removeChild(x);
    var stage = document.createElement('div'); stage.id = 'apta-stage'; document.body.appendChild(stage);
    fit(stage); window.addEventListener('resize', function () { fit(stage); if (NF.el) { place(); setTimeout(reveal, 50); } });
    var comp = new Comp(props), tree = [], queued = false;
    KB.onChange = function () { comp.forceUpdate(); if (NF.el) { follow(700); setTimeout(reveal, 350); } };
    function draw() {
      queued = false; var vals;
      try { vals = comp.renderVals(); } catch (e) { console.error(e); return; }
      var next = render(tpl, { v: vals, up: null }, '', []);
      refQ = []; patch(stage, tree, next); tree = next;
      var q = refQ; refQ = []; for (var i = 0; i < q.length; i++) { try { q[i][0](q[i][1]); } catch (e) { console.error(e); } }
      try { syncField(comp, stage); } catch (e) { console.error(e); }
      if (!document.body.__bg) { var r = stage.firstElementChild; if (r) { document.body.style.background = getComputedStyle(r).backgroundColor; document.body.__bg = 1; } }
    }
    comp.__sched = function () { if (!queued) { queued = true; Promise.resolve().then(draw); } };
    draw();
    window.addEventListener('pagehide', function () { try { comp.componentWillUnmount && comp.componentWillUnmount(); } catch (e) {} });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
