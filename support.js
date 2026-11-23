/* Апта — standalone runtime for the app's .dc.html screens.
   Renders the <x-dc> template with the page's Component class, re-rendering on setState
   with a keyed DOM patch so scroll positions, refs and running animations survive. */
(function () {
  'use strict';
  var hide = document.createElement('style');
  hide.textContent = 'x-dc{display:none!important}html,body{margin:0;height:100%;overflow:hidden;overscroll-behavior:none;-webkit-text-size-adjust:100%}#apta-stage{position:fixed;left:0;top:0;transform-origin:0 0}';
  document.head.appendChild(hide);
  if (!document.querySelector('meta[name=viewport]')) {
    var mv = document.createElement('meta'); mv.name = 'viewport'; mv.content = 'width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no'; document.head.appendChild(mv);
  }

  // light <-> dark twin of every screen; the profile's theme choice (or the phone's) picks one
  var PAIRS = [['Main', 'Dark'], ['CalLight', 'CalDark'], ['CalHabits', 'CalHabitsDark'], ['FinLight', 'FinDark'], ['ProfLight', 'ProfDark'], ['NotesLight', 'NotesDark'],
    ['NotesDiary', 'NotesDiaryDark'], ['NotesMapLight', 'NotesMap'], ['OnboardLight', 'OnboardDark'], ['AuthLight', 'AuthDark']];
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
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(function () {});

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

  function fit(stage) {
    var W = window.innerWidth, H = window.innerHeight, s, h, x = 0;
    if (W / H < 0.66) { s = W / 390; h = H / s; } else { s = Math.min(1, H / 844); h = 844; x = (W - 390 * s) / 2; }
    stage.style.transform = 'translate(' + x + 'px,0) scale(' + s + ')';
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
    fit(stage); window.addEventListener('resize', function () { fit(stage); });
    var comp = new Comp(props), tree = [], queued = false;
    function draw() {
      queued = false; var vals;
      try { vals = comp.renderVals(); } catch (e) { console.error(e); return; }
      var next = render(tpl, { v: vals, up: null }, '', []);
      refQ = []; patch(stage, tree, next); tree = next;
      var q = refQ; refQ = []; for (var i = 0; i < q.length; i++) { try { q[i][0](q[i][1]); } catch (e) { console.error(e); } }
      if (!document.body.__bg) { var r = stage.firstElementChild; if (r) { document.body.style.background = getComputedStyle(r).backgroundColor; document.body.__bg = 1; } }
    }
    comp.__sched = function () { if (!queued) { queued = true; Promise.resolve().then(draw); } };
    draw();
    window.addEventListener('pagehide', function () { try { comp.componentWillUnmount && comp.componentWillUnmount(); } catch (e) {} });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
