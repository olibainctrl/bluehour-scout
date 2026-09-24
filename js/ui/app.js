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

  // ------------------------------------------------------------ 图标
  //
  // 全部单色、描边用 currentColor，跟着文字颜色和主题走。
  // 原来用的 📍🧭📷☀☁ 是彩色 emoji：在暗色界面里每个都是一小块亮色，
  // 违背"不要有亮色块、别破坏暗适应"的原则；而且各平台渲染不一，☀ 在
  // 圆形徽章里小到几乎看不见。

  var ICONS = {
    sun: '<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6"/>',
    moon: '<path d="M20 14.6A8.2 8.2 0 1 1 9.4 4a6.6 6.6 0 0 0 10.6 10.6z"/>',
    pin: '<path d="M12 21.2s-6.6-5.7-6.6-11.1a6.6 6.6 0 0 1 13.2 0c0 5.4-6.6 11.1-6.6 11.1z"/><circle cx="12" cy="10.1" r="2.4"/>',
    compass: '<circle cx="12" cy="12" r="9"/><path d="M15.6 8.4l-2.3 5-4.9 2.2 2.3-5z"/>',
    camera: '<path d="M4 8.2h3.1l1.7-2.3h6.4l1.7 2.3H20V19H4z"/><circle cx="12" cy="13.4" r="3.4"/>',
    cloud: '<path d="M7.2 18.2h10a4.1 4.1 0 0 0 .5-8.2 5.6 5.6 0 0 0-10.6-.9 4.6 4.6 0 0 0 .1 9.1z"/>',
    sunset: '<path d="M3 17.5h18M6.5 17.5a5.5 5.5 0 0 1 11 0M12 5v2.6M5 9.3l1.8 1.8M19 9.3l-1.8 1.8M3.5 21h17"/>',
    back: '<path d="M14.8 5.2 8 12l6.8 6.8"/>',
    sliders: '<path d="M4 8h8.6M17.4 8H20M4 16h2.6M11.4 16H20"/><circle cx="15" cy="8" r="2.4"/><circle cx="9" cy="16" r="2.4"/>',
    plus: '<path d="M12 5.5v13M5.5 12h13"/>',
    minus: '<path d="M5.5 12h13"/>'
  };

  function icon(name, size) {
    var sz = size || 18;
    var span = document.createElement('span');
    span.className = 'ico';
    span.setAttribute('aria-hidden', 'true');
    span.innerHTML = '<svg viewBox="0 0 24 24" width="' + sz + '" height="' + sz + '" fill="none" ' +
      'stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      (ICONS[name] || '') + '</svg>';
    return span;
  }

  function clear(node) {
    while (node.firstChild) { node.removeChild(node.firstChild); }
    return node;
  }

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }

  // ------------------------------------------------------------ 数字输入

  /**
   * 数字输入框。
   *
   * 用 type="text" + inputmode="decimal"，**不用** type="number"：
   *  - iOS 的 decimal 小键盘上**没有负号**。南半球的纬度、剖面的负仰角、
   *    蓝调区间下界 −9°、航海暮光时的 EV100 全都输不进去——
   *    在悉尼连自己的纬度都填不了。所以 signed 为 true 时带一个 ± 键。
   *  - type="number" 下单独一个 "-" 是非法值，value 会被清空，
   *    没法实现"先按负号再输数字"。
   *  - 某些地区的小键盘小数点是逗号，这里统一换成点再解析。
   *
   * @param {Object} o {value, placeholder, signed, integer, onInput(num|null), ariaLabel}
   * @returns {{node, input, value: function():(number|null), set: function(v)}}
   */
  function numInput(o) {
    o = o || {};
    var input = h('input', {
      type: 'text',
      inputmode: o.integer ? 'numeric' : 'decimal',
      autocomplete: 'off', autocorrect: 'off', autocapitalize: 'off', spellcheck: 'false',
      placeholder: o.placeholder || null,
      'aria-label': o.ariaLabel || null
    });
    input.value = (o.value === null || o.value === undefined) ? '' : String(o.value);

    function parse() {
      var t = String(input.value).replace(/[\u2212\u2013\u2014]/g, '-').replace(',', '.').trim();
      if (t === '' || t === '-' || t === '.' || t === '-.') { return null; }
      var n = o.integer ? parseInt(t, 10) : parseFloat(t);
      return isFinite(n) ? n : null;
    }

    input.addEventListener('input', function () {
      // 只留数字、一个小数点，以及（signed 时）开头一个负号
      var raw = input.value;
      var clean = raw.replace(/[\u2212\u2013\u2014]/g, '-').replace(/,/g, '.');
      var neg = !!o.signed && clean.charAt(0) === '-';
      clean = clean.replace(/[^0-9.]/g, '');
      if (o.integer) { clean = clean.replace(/\./g, ''); }
      var dot = clean.indexOf('.');
      if (dot >= 0) { clean = clean.slice(0, dot + 1) + clean.slice(dot + 1).replace(/\./g, ''); }
      clean = (neg ? '-' : '') + clean;
      if (clean !== raw) { input.value = clean; }
      if (o.onInput) { o.onInput(parse()); }
    });

    var kids = [input];
    if (o.signed) {
      var pm = h('button', { class: 'pm', type: 'button', 'aria-label': '切换正负号' }, '±');
      // 按下时阻止默认行为，焦点留在输入框里，键盘不会收起再弹出
      pm.addEventListener('pointerdown', function (e) { e.preventDefault(); });
      pm.addEventListener('mousedown', function (e) { e.preventDefault(); });
      pm.addEventListener('click', function () {
        var v = input.value;
        input.value = v.charAt(0) === '-' ? v.slice(1) : '-' + v;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.focus();
      });
      kids.push(pm);
    }
    return {
      node: h('div', { class: 'num-wrap' + (o.signed ? ' signed' : '') }, kids),
      input: input,
      value: parse,
      set: function (v) { input.value = (v === null || v === undefined) ? '' : String(v); }
    };
  }

  /**
   * 整数步进器 − n +。小范围整数（比如 setup 数）不该弹键盘。
   * nullable 为 true 时，在最小值上再按 − 会回到"未填"。
   */
  function stepper(o) {
    var v = (typeof o.value === 'number' && isFinite(o.value)) ? o.value : null;
    var out = h('span', { class: 'sv' });
    var dec = h('button', { class: 'sb', type: 'button', 'aria-label': '减一' }, icon('minus', 18));
    var inc = h('button', { class: 'sb', type: 'button', 'aria-label': '加一' }, icon('plus', 18));

    function paint() {
      out.textContent = v === null ? (o.emptyText || '—') : String(v);
      dec.disabled = v === null || (!o.nullable && v <= o.min);
      inc.disabled = v !== null && v >= o.max;
    }
    function set(n, silent) {
      if (n !== null) { n = Math.max(o.min, Math.min(o.max, Math.round(n))); }
      v = n;
      paint();
      if (!silent && o.onChange) { o.onChange(v); }
    }
    dec.addEventListener('click', function () {
      if (v === null) { return; }
      set(v <= o.min ? (o.nullable ? null : o.min) : v - 1);
    });
    inc.addEventListener('click', function () {
      set(v === null ? (o.start || o.min) : v + 1);
    });
    paint();
    return {
      node: h('div', { class: 'stepper' }, [dec, out, inc]),
      value: function () { return v; },
      set: function (n) { set(n, true); }
    };
  }

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

  /** 数字输入抽屉。返回 Promise<number|null|'clear'>。opts.signed 为 true 时带 ± 键。 */
  function numberSheet(opts) {
    var ni = numInput({
      value: opts.value, placeholder: opts.placeholder,
      signed: !!opts.signed, integer: !!opts.integer
    });
    var input = ni.input;
    var actions = [{ label: '取消', value: null, kind: 'ghost' }];
    if (opts.allowClear) { actions.push({ label: '清空', value: 'clear', kind: 'danger' }); }
    actions.push({ label: '确定', value: '__ok', kind: 'primary' });

    return sheet({
      title: opts.title,
      sub: opts.sub,
      dismissValue: null,
      body: h('div', { class: 'field' }, [
        opts.label ? h('label', { text: opts.label }) : null,
        ni.node
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
      var n = ni.value();
      if (n === null) { return null; }
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
      }, icon('back', 22)));
    }
    topbarEl.appendChild(h('h1', null, [
      opts.title || '',
      opts.sub ? h('span', { class: 'sub', text: opts.sub }) : null
    ]));
    var acts = (opts.actions || []).slice();
    // 设置和日/夜切换每一页都有；只在设置页自己那里不放设置按钮
    if (currentPath() !== '/settings') { acts.push(settingsButton()); }
    acts.push(themeButton());
    topbarEl.appendChild(h('div', { class: 'actions' }, acts));
  }

  function settingsButton() {
    return h('button', {
      class: 'theme-btn', type: 'button', 'aria-label': '项目设置', title: '项目设置',
      on: { click: function () { go('/settings'); } }
    }, icon('sliders', 19));
  }

  /** 日/夜切换按钮。每一页的顶栏右上角都有，一下就能切。 */
  function themeButton() {
    var T = root.BH.Theme;
    var light = T && T.get() === 'light';
    var btn = h('button', {
      class: 'theme-btn', type: 'button',
      'aria-label': light ? '切到夜间' : '切到日间',
      title: light ? '切到夜间' : '切到日间'
    }, icon(light ? 'moon' : 'sun', 19));
    btn.addEventListener('click', function () {
      if (!T) { return; }
      var now = T.toggle();
      clear(btn);
      btn.appendChild(icon(now === 'light' ? 'moon' : 'sun', 19));
      btn.setAttribute('aria-label', now === 'light' ? '切到夜间' : '切到日间');
      toast(now === 'light' ? '日间模式' : '夜间模式', 1200);
    });
    return btn;
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

    // iOS 上 body 是 position:fixed、内容在 .view 里滚，键盘弹起时
    // 系统不一定会把正在输入的框滚进视野，这里补一下
    viewEl.addEventListener('focusin', function (e) {
      var t = e.target;
      if (!t || !/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) { return; }
      setTimeout(function () {
        try { t.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
        catch (x) { t.scrollIntoView(); }
      }, 320);
    });

    // iOS 键盘弹起时 layout viewport 不缩，固定在底部的抽屉会被键盘整个盖住——
    // 剖面格子手填、记录实测都是在抽屉里输数字的。用 visualViewport 量出
    // 键盘高度写进 --kb，抽屉据此整体上移。
    if (root.visualViewport) {
      var vv = root.visualViewport;
      var syncKb = function () {
        var kb = Math.max(0, root.innerHeight - vv.height - vv.offsetTop);
        document.documentElement.style.setProperty('--kb', Math.round(kb) + 'px');
      };
      vv.addEventListener('resize', syncKb);
      vv.addEventListener('scroll', syncKb);
      syncKb();
    }

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
    h: h, svg: svg, clear: clear, append: append, $: $, icon: icon,
    fx: fx, deg: deg, pad2: pad2, compassName: compassName, relTime: relTime,
    toast: toast, sheet: sheet, confirm: confirm, numberSheet: numberSheet,
    numInput: numInput, stepper: stepper,
    route: route, go: go, back: back, start: start,
    setTop: setTop, setDock: setDock, currentPath: currentPath,
    download: download
  };
});
