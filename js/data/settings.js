/*!
 * 蓝调勘景仪 Blue Hour Scout — js/data/settings.js
 *
 * 项目设置：摄影机、镜头、蓝调区间、灯具。全部存在 IndexedDB 的 settings 库里。
 * 预填的光圈值可能不准，界面上都做成可编辑的。
 */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  root.BH = root.BH || {};
  root.BH.Settings = api;
  if (typeof module === 'object' && module.exports) { module.exports = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var KEY = 'project';
  var SCHEMA = 1;

  // 机器只记算法需要知道的能力：原生 ISO。
  // 帧率和快门角度是按镜头设计的创作选择，不是机器属性，存在每个勘景点上。
  var DEFAULT_CAMERA = {
    name: 'Blackmagic Pyxis 6K',
    isoLow: 400,          // 双原生 ISO 低档
    isoHigh: 3200         // 双原生 ISO 高档；单原生 ISO 的机器两档一样
  };

  function copyCamera(c) {
    return { name: c.name, isoLow: c.isoLow, isoHigh: c.isoHigh };
  }

  function defaults() {
    var d = {
      key: KEY,
      schema: SCHEMA,
      // 摄影机和镜头、灯具一样是个列表，选一台当前在用的。
      cameras: [copyCamera(DEFAULT_CAMERA)],
      selectedCamera: 0,
      camera: null,         // 派生字段：当前在用的那台，见 normalize()
      // 光圈值按厂标预填，可能和实际 T 档有出入，随时可改
      lenses: [
        { name: 'Sigma 14-24mm F2.8', maxAperture: 2.8 },
        { name: 'Canon 24-70mm F2.8', maxAperture: 2.8 },
        { name: 'Canon 70-200mm F2.8', maxAperture: 2.8 },
        { name: 'Canon nFD 50mm F1.4', maxAperture: 1.4 },
        { name: 'Canon nFD 135mm F2.8', maxAperture: 2.8 },
        { name: 'Canon FD 35mm SC F2', maxAperture: 2.0 }
      ],
      selectedLens: 3,        // 默认选 nFD 50/1.4，蓝调时刻最常用的那支
      blueRange: { upper: 0, lower: -9 },
      // 照度留空，由你自己填厂商标称值或实测值
      lights: [
        { name: 'Nanlite Pavotube II 15X', lux: null, distance: 1 },
        { name: 'Amaran Ray 120c', lux: null, distance: 1 }
      ],
      setups: 3
    };
    d.camera = d.cameras[0];
    return d;
  }

  function num(v, fallback, lo, hi) {
    var n = (typeof v === 'number') ? v : parseFloat(v);
    if (!isFinite(n)) { return fallback; }
    if (lo !== undefined && n < lo) { return fallback; }
    if (hi !== undefined && n > hi) { return fallback; }
    return n;
  }

  /** 把任意输入规整成合法设置，缺的字段用默认值补齐。 */
  function normalize(input) {
    var d = defaults();
    if (!input || typeof input !== 'object') { return d; }

    // ---- 摄影机列表
    // 早期版本只存了一个 camera 对象，没有 cameras 列表。碰到这种旧数据
    // 就把它迁成只有一台的列表，已经填好的参数不丢。
    var camIn = Array.isArray(input.cameras) ? input.cameras
      : (input.camera && typeof input.camera === 'object') ? [input.camera]
      : null;
    if (camIn) {
      var cs = [];
      camIn.forEach(function (c) {
        if (c && typeof c === 'object') { cs.push(normCamera(c)); }
      });
      if (cs.length) { d.cameras = cs; }
    }
    d.selectedCamera = clampIndex(input.selectedCamera, d.cameras.length, 0);
    // 派生：当前在用的那台。core/timeline.js 读的是 settings.camera，
    // 这样核心计算不用改；存盘时也留着它，旧版本的页面读得到。
    d.camera = d.cameras[d.selectedCamera];

    if (Array.isArray(input.lenses)) {
      var ls = [];
      input.lenses.forEach(function (L) {
        if (!L || typeof L.name !== 'string' || !L.name.trim()) { return; }
        ls.push({
          name: L.name.slice(0, 80),
          maxAperture: num(L.maxAperture, null, 0.5, 64)
        });
      });
      // 空列表也要照收。原来写的是 if (ls.length)，结果在设置里把镜头删光之后，
      // 一存盘六支默认镜头又全冒出来了。没有镜头是合法状态（时间轴就不做光圈约束）。
      // 只有 lenses 根本不是数组（缺失或垃圾）时才用默认列表。
      d.lenses = ls;
    }
    d.selectedLens = clampIndex(input.selectedLens, d.lenses.length, d.selectedLens);

    var b = input.blueRange || {};
    d.blueRange.upper = num(b.upper, d.blueRange.upper, -90, 90);
    d.blueRange.lower = num(b.lower, d.blueRange.lower, -90, 90);
    if (d.blueRange.lower > d.blueRange.upper) {
      var t = d.blueRange.lower; d.blueRange.lower = d.blueRange.upper; d.blueRange.upper = t;
    }

    if (Array.isArray(input.lights)) {
      var gs = [];
      input.lights.forEach(function (L) {
        if (!L || typeof L.name !== 'string' || !L.name.trim()) { return; }
        gs.push({
          name: L.name.slice(0, 80),
          lux: num(L.lux, null, 0.0001, 1e9),
          distance: num(L.distance, 1, 0.01, 1000)
        });
      });
      d.lights = gs;          // 允许清空
    }

    d.setups = num(input.setups, d.setups, 1, 99);
    if (d.setups !== null) { d.setups = Math.round(d.setups); }

    d.key = KEY;
    d.schema = SCHEMA;
    return d;
  }

  /**
   * 规整一台摄影机。单原生 ISO 的机器高档可以不填；两档写反了就对调。
   * 旧数据里机器上带的 fps / shutterAngle 在这里丢掉——它们现在属于勘景点。
   */
  function normCamera(c) {
    var lo = num(c.isoLow, DEFAULT_CAMERA.isoLow, 1, 1000000);
    var hi = num(c.isoHigh, null, 1, 1000000);
    if (hi === null) { hi = lo; }
    if (hi < lo) { var t = lo; lo = hi; hi = t; }
    return {
      name: (typeof c.name === 'string' && c.name.trim()) ? c.name.slice(0, 80) : DEFAULT_CAMERA.name,
      isoLow: lo,
      isoHigh: hi
    };
  }

  /** 列表下标：越界或无效时退回 fallback（它也越界就退回 0）；空列表返回 null。 */
  function clampIndex(v, len, fallback) {
    if (!len) { return null; }
    var n = num(v, null, 0, len - 1);
    if (n === null) { n = (typeof fallback === 'number' && fallback >= 0 && fallback < len) ? fallback : 0; }
    return Math.round(n);
  }

  var cached = null;

  function load() {
    if (cached) { return Promise.resolve(cached); }
    return root.BH.DB.get('settings', KEY).then(function (row) {
      cached = normalize(row);
      return cached;
    }).catch(function () {
      cached = defaults();
      return cached;
    });
  }

  function save(s) {
    cached = normalize(s);
    return root.BH.DB.put('settings', cached).then(function () { return cached; });
  }

  function reset() {
    cached = defaults();
    return root.BH.DB.put('settings', cached).then(function () { return cached; });
  }

  /** 强制下次 load() 重新读库。 */
  function invalidate() { cached = null; }

  return {
    KEY: KEY,
    SCHEMA: SCHEMA,
    DEFAULT_CAMERA: DEFAULT_CAMERA,
    defaults: defaults,
    normalize: normalize,
    load: load,
    save: save,
    reset: reset,
    invalidate: invalidate
  };
});
