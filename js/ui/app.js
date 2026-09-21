/*!
 * 蓝调勘景仪 Blue Hour Scout — js/ui/app.js
 *
 * 应用外壳：DOM 小工具、哈希路由、吐司、底部抽屉。
 * 没有框架，也不需要构建步骤。
 */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  root.BH = root.BH || {};
  root.BH.App = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  // ---------------------------------------------------------------- DOM

  /**
   * h('div', {class:'card', text:'…', on:{click:fn}}, [子元素…])
   * 子元素可以是节点、字符串，或 null（会被跳过）。
   */
  function h(tag, props, children) {
    var n = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === null || v === undefined || v === false) { return; }
        if (k === 'class') { n.className = v; }
        else if (k === 'text') { n.textContent = v; }
        else if (k === 'html') { n.innerHTML = v; }
        else if (k === 'style') { n.setAttribute('style', v); }
        else if (k === 'on') {
          Object.keys(v).forEach(function (ev) { n.addEventListener(ev, v[ev]); });
        } else if (k === 'data') {
          Object.keys(v).forEach(function (d) { n.setAttribute('data-' + d, v[d]); });
        } else if (v === true) { n.setAttribute(k, ''); }
        else { n.setAttribute(k, v); }
      });
    }
    append(n, children);
    return n;
  }

  function append(parent, children) {
    if (children === null || children === undefined) { return parent; }
    if (!Array.isArray(children)) { children = [children]; }
    children.forEach(function (c) {
      if (c === null || c === undefined || c === false) { return; }
      parent.appendChild(typeof c === 'string' || typeof c === 'number'
        ? document.createTextNode(String(c)) : c);
    });
    return parent;
  }

  function svg(tag, props, children) {
    var n = document.createElementNS('http://www.w3.org/2000/svg', tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (v === null || v === undefined || v === false) { return; }
        if (k === 'on') {
          Object.keys(v).forEach(function (ev) { n.addEventListener(ev, v[ev]); });
        } else { n.setAttribute(k, v); }
      });
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach(function (c) {
        if (c) { n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); }
      });
    }
    return n;
  }

  function clear(node) {
    while (node.firstChild) { node.removeChild(node.firstChild); }
    return node;
  }

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }

  // ------------------------------------------------------------ 数字格式

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /** 保留 n 位小数，去掉多余的 0。 */
  function fx(v, n) {
    if (v === null || v === undefined || !isFinite(v)) { return '—'; }
    var s = Number(v).toFixed(n === undefined ? 1 : n);
    return s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  }

  /** 带符号的度数，用于仰角这种有正负的量。 */
  function deg(v, n) {
    if (v === null || v === undefined || !isFinite(v)) { return '—'; }
    var s = Number(v).toFixed(n === undefined ? 1 : n);
    return (v > 0 ? '+' : '') + s + '°';
  }

  /** 方位角 → 八方位中文简称。 */
  function compassName(az) {
    if (az === null || az === undefined || !isFinite(az)) { return ''; }
    var names = ['北', '东北', '东', '东南', '南', '西南', '西', '西北'];
    return names[Math.round(((az % 360) + 360) % 360 / 45) % 8];
  }

  function relTime(ms) {
    if (!ms) { return ''; }
    var d = Date.now() - ms;
    if (d < 60000) { return '刚刚'; }
    if (d < 3600000) { return Math.floor(d / 60000) + ' 分钟前'; }
    if (d < 86400000) { return Math.floor(d / 3600000) + ' 小时前'; }
    if (d < 2592000000) { return Math.floor(d / 86400000) + ' 天前'; }
    var t = new Date(ms);
    return t.getFullYear() + '-' + pad2(t.getMonth() + 1) + '-' + pad2(t.getDate());
  }

  // ---------------------------------------------------------------- 吐司

  var toastEl = null, toastTimer = null;

  function toast(msg, ms) {
    if (!toastEl) {
      toastEl = h('div', { class: 'toast' });
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    if (toastTimer) { clearTimeout(toastTimer); }
    toastTimer = setTimeout(function () { toastEl.classList.remove('show'); }, ms || 2200);
  }

  // ------------------------------------------------------------ 底部抽屉

  var sheetStack = [];

  function sheet(opts) {
    return new Promise(function (resolve) {
      var done = false;
      function finish(v) {
        if (done) { return; }
        done = true;
        back.classList.remove('show');
        setTimeout(function () {
          if (back.parentNode) { back.parentNode.removeChild(back); }
          sheetStack.pop();
        }, 190);
        resolve(v);
      }

      var body = h('div', null, opts.body || null);
      var actions = h('div', { class: 'btn-bar', style: 'margin-top:18px' },
        (opts.actions || []).map(function (a) {
          return h('button', {
            class: 'btn ' + (a.kind || 'ghost') + (a.block ? ' block' : ''),
            type: 'button',
            style: a.block ? '' : 'flex:1',
            on: { click: function () { finish(a.value); } }
          }, a.label);
        }));

      var panel = h('div', { class: 'sheet' }, [
        opts.title ? h('h3', { text: opts.title }) : null,
        opts.sub ? h('p', { class: 'sub', text: opts.sub }) : null,
        body, actions
      ]);

      var back = h('div', {
        class: 'sheet-back',
        on: {
          click: function (e) { if (e.target === back) { finish(opts.dismissValue); } }
        }
      }, panel);

      document.body.appendChild(back);
      sheetStack.push(finish);
      requestAnimationFrame(function () { back.classList.add('show'); });

      if (opts.onOpen) { setTimeout(function () { opts.onOpen(panel, finish); }, 30); }
    });
  }

  function confirm(title, sub, okLabel, kind) {
    return sheet({
      title: title, sub: sub, dismissValue: false,
      actions: [
        { label: '取消', value: false, kind: 'ghost' },
        { label: okLabel || '确定', value: true, kind: kind || 'primary' }
      ]
    }).then(function (v) { return v === true; });
  }

  /** 数字输入抽屉。返回 Promise<number|null|'clear'>。 */
  function numberSheet(opts) {
    var input = h('input', {
      type: 'number',
      step: opts.step === undefined ? 'any' : opts.step,
      inputmode: 'decimal',
      value: (opts.value === null || opts.value === undefined) ? '' : String(opts.value),
      placeholder: opts.placeholder || ''
    });
    var actions = [{ label: '取消', value: null, kind: 'ghost' }];
    if (opts.allowClear) { actions.push({ label: '清空', value: 'clear', kind: 'danger' }); }
    actions.push({ label: '确定', value: '__ok', kind: 'primary' });

    return sheet({
      title: opts.title,
      sub: opts.sub,
      dismissValue: null,
      body: h('div', { class: 'field' }, [
        opts.label ? h('label', { text: opts.label }) : null,
        input
      ]),
      actions: actions,
      onOpen: function (panel, finish) {
        input.focus();
        input.select();
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); finish('__ok'); }
        });
      }
    }).then(function (v) {
      if (v === null || v === undefined) { return null; }
      if (v === 'clear') { return 'clear'; }
      var n = parseFloat(input.value);
      if (!isFinite(n)) { return null; }
      if (opts.min !== undefined && n < opts.min) { n = opts.min; }
      if (opts.max !== undefined && n > opts.max) { n = opts.max; }
      return n;
    });
  }

  // ---------------------------------------------------------------- 路由

  var routes = [];
  var topbarEl = null, viewEl = null, dockEl = null;
  var currentCleanup = null;

  function route(pattern, handler) {
    // '#/rec/:id/horizon' → 正则 + 参数名
    var names = [];
    var re = new RegExp('^' + pattern.replace(/:[a-zA-Z_]+/g, function (m) {
      names.push(m.slice(1));
      return '([^/]+)';
    }) + '$');
    routes.push({ re: re, names: names, handler: handler });
  }

  function go(hash, replace) {
    if (replace) { location.replace('#' + hash); }
    else { location.hash = hash; }
  }

  function back() {
    if (history.length > 1) { history.back(); } else { go('/', true); }
  }

  function currentPath() {
    var raw = location.hash.replace(/^#/, '');
    return raw || '/';
  }

  function dispatch() {
    var path = currentPath();
    if (currentCleanup) {
      try { currentCleanup(); } catch (e) { /* 清理失败不该阻塞导航 */ }
      currentCleanup = null;
    }
    // 关掉还开着的抽屉
    while (sheetStack.length) { sheetStack.pop()(undefined); }

    for (var i = 0; i < routes.length; i++) {
      var m = routes[i].re.exec(path);
      if (!m) { continue; }
      var params = {};
      routes[i].names.forEach(function (n, k) { params[n] = decodeURIComponent(m[k + 1]); });
      clear(viewEl);
      viewEl.scrollTop = 0;
      setDock(null);
      var r = routes[i].handler(params, viewEl);
      if (typeof r === 'function') { currentCleanup = r; }
      return;
    }
    go('/', true);
  }

  function setTop(opts) {
    clear(topbarEl);
    if (opts.back) {
      topbarEl.appendChild(h('button', {
        class: 'back', type: 'button', 'aria-label': '返回',
        on: { click: opts.back === true ? back : opts.back }
      }, '‹'));
    }
    topbarEl.appendChild(h('h1', null, [
      opts.title || '',
      opts.sub ? h('span', { class: 'sub', text: opts.sub }) : null
    ]));
    if (opts.actions && opts.actions.length) {
      topbarEl.appendChild(h('div', { class: 'actions' }, opts.actions));
    }
  }

  function setDock(nodes) {
    clear(dockEl);
    if (!nodes || !nodes.length) { dockEl.style.display = 'none'; return; }
    dockEl.style.display = '';
    append(dockEl, nodes);
  }

  function start(opts) {
    topbarEl = opts.topbar;
    viewEl = opts.view;
    dockEl = opts.dock;
    window.addEventListener('hashchange', dispatch);
    dispatch();
  }

  // ------------------------------------------------------------ 文件下载

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: mime || 'application/json;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = h('a', { href: url, download: filename, style: 'display:none' });
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1500);
  }

  return {
    h: h, svg: svg, clear: clear, append: append, $: $,
    fx: fx, deg: deg, pad2: pad2, compassName: compassName, relTime: relTime,
    toast: toast, sheet: sheet, confirm: confirm, numberSheet: numberSheet,
    route: route, go: go, back: back, start: start,
    setTop: setTop, setDock: setDock, currentPath: currentPath,
    download: download
  };
});
