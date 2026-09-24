/*!
 * 蓝调勘景仪 Blue Hour Scout — js/test/theme.test.js
 *
 * 两套主题的对比度，以及"组件里不许写死色值"这条规矩。
 *
 * 对比度直接读 css/app.css 里的变量，不在测试里再抄一份色值——
 * 抄一份就会和真实样式漂移。所以这组测试只在浏览器里有意义。
 * 曾经踩过：次要文字 #6b6459 在近黑底上只有 3.44:1，黄昏户外根本看不清。
 */
(function () {
  'use strict';

  var T = BH.Test;
  var hasDOM = (typeof document !== 'undefined' && !!document.createElement &&
                typeof getComputedStyle === 'function');

  function lum(hex) {
    var h = hex.replace('#', '');
    if (h.length === 3) { h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2]; }
    var c = [0, 2, 4].map(function (i) { return parseInt(h.substr(i, 2), 16) / 255; });
    var f = function (x) { return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  }
  function ratio(a, b) {
    var la = lum(a), lb = lum(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  /** 在一个挂了 data-theme 的探针元素上读变量。 */
  function palette(theme) {
    var probe = document.createElement('div');
    probe.setAttribute('data-theme', theme);
    probe.style.display = 'none';
    document.body.appendChild(probe);
    var cs = getComputedStyle(probe);
    var names = ['bg', 'bg-raise', 'bg-sunk', 'bg-row', 'ink', 'ink-dim', 'ink-faint',
                 'amber', 'amber-wash', 'ok', 'ok-bg', 'warn', 'warn-bg', 'bad', 'bad-bg',
                 'bad-ink', 'toast-bg', 'toast-ink', 'row-rs', 'row-now', 'row-blue', 'th-bg',
                 'g-label', 'g-empty'];
    var out = {};
    names.forEach(function (n) { out[n] = cs.getPropertyValue('--' + n).trim(); });
    document.body.removeChild(probe);
    return out;
  }

  // 真正在界面上出现的"文字 / 背景"组合
  var PAIRS = [
    ['ink', 'bg'], ['ink', 'bg-raise'], ['ink', 'bg-sunk'],
    ['ink-dim', 'bg'], ['ink-dim', 'bg-raise'], ['ink-dim', 'bg-sunk'],
    ['ink-faint', 'bg'], ['ink-faint', 'bg-raise'], ['ink-faint', 'bg-sunk'],
    ['ink-faint', 'amber-wash'],
    ['amber', 'bg'], ['amber', 'bg-raise'], ['amber', 'amber-wash'],
    ['ok', 'ok-bg'], ['warn', 'warn-bg'], ['bad', 'bad-bg'],
    ['bad-ink', 'bg-raise'], ['toast-ink', 'toast-bg'],
    ['amber', 'row-rs'], ['ink', 'row-now'], ['amber', 'row-now'],
    ['ink-dim', 'row-blue'], ['ink-faint', 'th-bg']
  ];

  ['dark', 'light'].forEach(function (theme) {
    T.suite('主题：' + (theme === 'dark' ? '夜间' : '日间') + '对比度（WCAG AA ≥ 4.5）', function () {
      T.test('界面上出现的每一组文字 / 背景', function () {
        if (!hasDOM) { T.ok(true, '当前宿主没有 DOM，此项只在浏览器里有意义'); return; }
        var p = palette(theme);
        T.ok(/^#[0-9a-f]{6}$/i.test(p.bg), '读到了 --bg = ' + p.bg);
        PAIRS.forEach(function (pr) {
          var fg = p[pr[0]], bg = p[pr[1]];
          if (!/^#[0-9a-f]{6}$/i.test(fg) || !/^#[0-9a-f]{6}$/i.test(bg)) {
            T.ok(false, pr[0] + ' / ' + pr[1] + ' 没读到颜色（' + fg + ' / ' + bg + '）');
            return;
          }
          var r = ratio(fg, bg);
          T.ok(r >= 4.5, pr[0] + ' 在 ' + pr[1] + ' 上 ' + r.toFixed(2) + ':1');
          T.row([pr[0] + ' / ' + pr[1], fg + ' / ' + bg, r.toFixed(2), r >= 4.5 ? '通过' : '失败']);
        });
      });
    });
  });

  T.suite('主题：结构约束', function () {

    T.test('两套主题定义的变量完全一致（切主题不会有漏网的）', function () {
      if (!hasDOM) { T.ok(true, '当前宿主没有 DOM'); return; }
      var d = palette('dark'), l = palette('light');
      Object.keys(d).forEach(function (k) {
        T.ok(d[k] !== '' && l[k] !== '', '--' + k + ' 两套都有定义');
      });
      T.ok(d.bg !== l.bg, '两套的背景确实不同');
    });

    T.test('组件样式里不许写死色值', function () {
      if (!hasDOM || typeof XMLHttpRequest === 'undefined') { T.ok(true, '当前宿主读不到样式表'); return; }
      var xhr = new XMLHttpRequest();
      xhr.open('GET', 'css/app.css', false);    // 同步读，测试里无所谓
      try { xhr.send(null); } catch (e) { T.ok(true, '读不到样式表（file:// 下），跳过'); return; }
      if (xhr.status !== 200 && xhr.status !== 0) { T.ok(true, '读不到样式表，跳过'); return; }
      var css = xhr.responseText.replace(/\/\*[\s\S]*?\*\//g, '');
      var offenders = [];
      css.split('}').forEach(function (chunk) {
        var i = chunk.indexOf('{');
        if (i < 0) { return; }
        var sel = chunk.slice(0, i).trim(), body = chunk.slice(i + 1);
        // 允许：两个变量定义块；取景器（叠在相机画面上，本来就该固定）
        if (/:root|\[data-theme=/.test(sel) && /--[a-z]/.test(body)) { return; }
        if (/\.vf\b/.test(sel)) { return; }
        if (/#[0-9a-fA-F]{3,6}\b|rgba?\(/.test(body)) { offenders.push(sel.replace(/\s+/g, ' ').slice(-60)); }
      });
      T.equal(offenders.length, 0, '写死色值的规则：' + (offenders.slice(0, 5).join(' | ') || '无'));
    });

    T.test('主题模块的开关', function () {
      if (!hasDOM || !BH.Theme) { T.ok(true, '当前宿主没有 DOM'); return; }
      var before = BH.Theme.get();
      T.ok(before === 'dark' || before === 'light', '当前主题 ' + before);
      var after = BH.Theme.toggle();
      T.ok(after !== before, '切换后变成 ' + after);
      T.equal(document.documentElement.getAttribute('data-theme'), after, '写到了 <html> 上');
      BH.Theme.set(before);
      T.equal(BH.Theme.get(), before, '切回原样');
      T.equal(BH.Theme.set('garbage'), 'dark', '非法值一律当夜间');
      BH.Theme.set(before);
    });
  });
}());
