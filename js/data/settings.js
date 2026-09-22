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

  function defaults() {
    return {
      key: KEY,
      schema: SCHEMA,
      camera: {
        name: 'Blackmagic Pyxis 6K',
        isoLow: 400,          // 双原生 ISO 低档
        isoHigh: 3200,        // 双原生 ISO 高档
        fps: 24,
        shutterAngle: 180
      },
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

    var c = input.camera || {};
    d.camera.name = typeof c.name === 'string' && c.name ? c.name.slice(0, 80) : d.camera.name;
    d.camera.isoLow = num(c.isoLow, d.camera.isoLow, 1, 1000000);
    d.camera.isoHigh = num(c.isoHigh, d.camera.isoHigh, 1, 1000000);
    d.camera.fps = num(c.fps, d.camera.fps, 0.1, 1000);
    d.camera.shutterAngle = num(c.shutterAngle, d.camera.shutterAngle, 1, 360);

    if (Array.isArray(input.lenses)) {
      var ls = [];
      input.lenses.forEach(function (L) {
        if (!L || typeof L.name !== 'string' || !L.name.trim()) { return; }
        ls.push({
          name: L.name.slice(0, 80),
          maxAperture: num(L.maxAperture, null, 0.5, 64)
        });
      });
      if (ls.length) { d.lenses = ls; }
    }
    d.selectedLens = num(input.selectedLens, d.selectedLens, 0, d.lenses.length - 1);
    if (d.selectedLens !== null) { d.selectedLens = Math.round(d.selectedLens); }

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
    defaults: defaults,
    normalize: normalize,
    load: load,
    save: save,
    reset: reset,
    invalidate: invalidate
  };
});
