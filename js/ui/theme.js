/*!
 * 蓝调勘景仪 Blue Hour Scout — js/ui/theme.js
 *
 * 日 / 夜主题，手动切换。
 *
 * 夜间是默认：这个工具主要在黄昏和夜里用，暗适应优先。
 * 日间给白天在大太阳底下勘景用——那时候深色界面反光看不清。
 *
 * 存储用 localStorage 而不是 IndexedDB，这是有意的：
 * 主题必须在**首次绘制之前**定下来，否则每次打开都会先闪一下夜间再跳成日间。
 * IndexedDB 是异步的，赶不上；localStorage 是同步的，index.html 的 <head>
 * 里有一小段脚本在样式表加载前就读它。这是界面偏好，不是项目设置，
 * 不跟着 JSON 导出走。
 */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  root.BH = root.BH || {};
  root.BH.Theme = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var KEY = 'bh-theme';
  var listeners = [];

  function doc() { return root.document ? root.document.documentElement : null; }

  function get() {
    var el = doc();
    return (el && el.getAttribute('data-theme') === 'light') ? 'light' : 'dark';
  }

  /** 从存储读偏好。读不到（无痕模式等）就返回 null，调用方用默认。 */
  function stored() {
    try {
      var t = root.localStorage.getItem(KEY);
      return (t === 'light' || t === 'dark') ? t : null;
    } catch (e) { return null; }
  }

  function set(t) {
    t = t === 'light' ? 'light' : 'dark';
    var el = doc();
    if (el) { el.setAttribute('data-theme', t); }
    try { root.localStorage.setItem(KEY, t); } catch (e) { /* 存不进去就只在本次生效 */ }
    syncMeta();
    listeners.slice().forEach(function (fn) {
      try { fn(t); } catch (e) { /* 一个监听者出错不影响其它 */ }
    });
    return t;
  }

  function toggle() { return set(get() === 'light' ? 'dark' : 'light'); }

  /**
   * 浏览器外壳的颜色（地址栏、Android 状态栏）跟着主题走。
   * 直接读 CSS 变量，不在这里再写一份色值。
   */
  function syncMeta() {
    if (!root.document) { return; }
    var bg = '';
    try { bg = root.getComputedStyle(doc()).getPropertyValue('--bg').trim(); } catch (e) { bg = ''; }
    var m = root.document.querySelector('meta[name="theme-color"]');
    if (m && bg) { m.setAttribute('content', bg); }
    var cs = root.document.querySelector('meta[name="color-scheme"]');
    if (cs) { cs.setAttribute('content', get()); }
  }

  function onChange(fn) {
    listeners.push(fn);
    return function () {
      var i = listeners.indexOf(fn);
      if (i >= 0) { listeners.splice(i, 1); }
    };
  }

  return {
    KEY: KEY,
    get: get,
    set: set,
    toggle: toggle,
    stored: stored,
    syncMeta: syncMeta,
    onChange: onChange
  };
});
