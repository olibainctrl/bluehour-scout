/*!
 * 蓝调勘景仪 Blue Hour Scout — js/core/horizon.js
 *
 * 地平线遮挡剖面。纯逻辑，无 DOM、无依赖。
 *
 * 剖面是一个 36 元素的数组，下标 i 对应真北起算、顺时针的方位角 i×10°。
 * 元素值是该方位上天际线的仰角（度，可以为负，比如站在山顶俯视）。
 * null 表示该扇区还没采过。
 *
 * 遮挡判定按项目约定用**日面中心**：太阳中心高度角低于该方位插值出的
 * 天际线仰角即为被遮挡。好处是和时间轴里显示的高度角列读数自洽。
 */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  root.BH = root.BH || {};
  root.BH.Horizon = api;
  if (typeof module === 'object' && module.exports) { module.exports = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var SECTORS = 36;
  var SECTOR_DEG = 360 / SECTORS;   // 10°

  // 保证结果落在 [0,360)。极小负数加 360 后浮点会吸收成正好 360，
  // 不夹一下的话 359.9999999° 会显示成 360°，扇区计算也会多绕一圈。
  function norm360(a) {
    a = a % 360;
    if (a < 0) { a += 360; }
    return a < 360 ? a : 0;
  }

  function isSet(v) { return typeof v === 'number' && isFinite(v); }

  /** 新建一个全空剖面。 */
  function empty() {
    var a = new Array(SECTORS);
    for (var i = 0; i < SECTORS; i++) { a[i] = null; }
    return a;
  }

  /** 把任意输入规整成合法的 36 元素剖面（导入 JSON 时用）。 */
  function normalize(input) {
    var out = empty();
    if (!input) { return out; }
    for (var i = 0; i < SECTORS; i++) {
      var v = input[i];
      if (typeof v === 'string' && v !== '') { v = parseFloat(v); }
      if (isSet(v) && v > -90 && v < 90) { out[i] = v; }
    }
    return out;
  }

  /** 方位角落在哪个扇区（就近取整，0–35）。 */
  function sectorFor(az) { return Math.round(norm360(az) / SECTOR_DEG) % SECTORS; }

  /** 扇区中心的方位角。 */
  function azimuthOf(i) { return ((i % SECTORS) + SECTORS) % SECTORS * SECTOR_DEG; }

  /** 已采样扇区数。 */
  function count(profile) {
    var n = 0;
    for (var i = 0; i < SECTORS; i++) { if (isSet(profile[i])) { n++; } }
    return n;
  }

  function isComplete(profile) { return count(profile) === SECTORS; }

  /** 尚未采样的扇区下标数组。 */
  function missing(profile) {
    var out = [];
    for (var i = 0; i < SECTORS; i++) { if (!isSet(profile[i])) { out.push(i); } }
    return out;
  }

  /**
   * 把未采样的扇区并成连续区间，用来提示"还缺哪些角度"。
   * 跨 0° 的缺口会合并成一段。
   * @returns {Array<{from:number,to:number,count:number}>} from/to 为方位角（度）
   */
  function missingRanges(profile) {
    var miss = missing(profile);
    if (miss.length === 0) { return []; }
    if (miss.length === SECTORS) {
      return [{ from: 0, to: 360, count: SECTORS }];
    }
    // 从一个"已采样"的扇区后面开始扫，保证不会把一段缺口从中间切开
    var start = 0;
    while (!isSet(profile[start])) { start = (start + 1) % SECTORS; }

    var ranges = [], run = null;
    for (var k = 1; k <= SECTORS; k++) {
      var i = (start + k) % SECTORS;
      if (!isSet(profile[i])) {
        if (!run) { run = { from: i, count: 0 }; }
        run.to = i;
        run.count++;
      } else if (run) {
        ranges.push(run);
        run = null;
      }
    }
    if (run) { ranges.push(run); }

    return ranges.map(function (r) {
      return {
        from: norm360(azimuthOf(r.from) - SECTOR_DEG / 2),
        to: norm360(azimuthOf(r.to) + SECTOR_DEG / 2),
        count: r.count
      };
    });
  }

  /**
   * 任意方位角上的天际线仰角，在最近的两个**已采样**扇区之间线性插值。
   * 缺口会被跨过去插值，所以剖面不完整时也能给出估计值。
   * @returns {number|null} 一个点都没采过时返回 null
   */
  function elevationAt(profile, az) {
    var p = norm360(az) / SECTOR_DEG;          // 连续扇区坐标 0–36
    var base = Math.floor(p) % SECTORS;
    var frac = p - Math.floor(p);

    var a = -1, da = 0;
    for (var i = 0; i < SECTORS; i++) {
      var bi = ((base - i) % SECTORS + SECTORS) % SECTORS;
      if (isSet(profile[bi])) { a = bi; da = i; break; }
    }
    if (a < 0) { return null; }

    var b = -1, db = 0;
    for (var j = 1; j <= SECTORS; j++) {
      var fi = (base + j) % SECTORS;
      if (isSet(profile[fi])) { b = fi; db = j; break; }
    }
    if (b < 0 || b === a) { return profile[a]; }

    var distA = da + frac;          // 从查询点往回到 a 的距离
    var distB = db - frac;          // 从查询点往前到 b 的距离
    if (distA <= 0) { return profile[a]; }
    var w = distA / (distA + distB);
    return profile[a] + w * (profile[b] - profile[a]);
  }

  /**
   * 整体旋转剖面：结果第 j 格 = 原剖面在 (azimuthOf(j) − deg) 方向上的值。
   * 用来把旧版本按磁北采的剖面转回真北（deg = 磁偏角）。
   * 只在相邻两格之间插值；落在缺口里就留空，不凭空补数。
   */
  function rotate(profile, deg) {
    var out = empty();
    if (!Array.isArray(profile)) { return out; }
    if (typeof deg !== 'number' || !isFinite(deg)) { return profile.slice(0, SECTORS); }
    for (var j = 0; j < SECTORS; j++) {
      var p = norm360(azimuthOf(j) - deg) / SECTOR_DEG;
      var i0 = Math.floor(p) % SECTORS, i1 = (i0 + 1) % SECTORS;
      var f = p - Math.floor(p);
      var a = profile[i0], b = profile[i1];
      var v = null;
      if (isSet(a) && isSet(b)) { v = a + f * (b - a); }
      else if (isSet(a) && f <= 0.5) { v = a; }
      else if (isSet(b) && f >= 0.5) { v = b; }
      out[j] = v === null ? null : Math.round(v * 100) / 100;
    }
    return out;
  }

  /**
   * 太阳（或任何目标）是否被地平线挡住。
   * 按项目约定用日面中心比较，不加日面半径偏移。
   * @param {number} altitude 目标高度角（度）
   * @returns {boolean} 没有任何剖面数据时返回 false（不判遮挡）
   */
  function isOccluded(profile, az, altitude) {
    var h = elevationAt(profile, az);
    if (h === null) { return false; }
    return altitude < h;
  }

  /** 遮挡余量：正值表示太阳还在天际线之上多少度。无数据时为 null。 */
  function clearance(profile, az, altitude) {
    var h = elevationAt(profile, az);
    if (h === null) { return null; }
    return altitude - h;
  }

  /** 剖面概况，列表页和图形显示用。 */
  function stats(profile) {
    var n = 0, min = Infinity, max = -Infinity, sum = 0;
    for (var i = 0; i < SECTORS; i++) {
      if (!isSet(profile[i])) { continue; }
      n++; sum += profile[i];
      if (profile[i] < min) { min = profile[i]; }
      if (profile[i] > max) { max = profile[i]; }
    }
    if (n === 0) { return { count: 0, min: null, max: null, mean: null }; }
    return { count: n, min: min, max: max, mean: sum / n };
  }

  /**
   * 按一个方位角区间取剖面的最高点，用来快速判断"日落方向被挡得厉害吗"。
   * fromAz→toAz 顺时针方向，允许跨 0°。
   */
  function maxBetween(profile, fromAz, toAz) {
    var from = norm360(fromAz), to = norm360(toAz);
    var span = norm360(to - from);
    var best = null;
    for (var d = 0; d <= span; d += 1) {
      var v = elevationAt(profile, from + d);
      if (v !== null && (best === null || v > best)) { best = v; }
    }
    return best;
  }

  return {
    SECTORS: SECTORS,
    rotate: rotate,
    SECTOR_DEG: SECTOR_DEG,
    empty: empty,
    normalize: normalize,
    sectorFor: sectorFor,
    azimuthOf: azimuthOf,
    count: count,
    isComplete: isComplete,
    missing: missing,
    missingRanges: missingRanges,
    elevationAt: elevationAt,
    isOccluded: isOccluded,
    clearance: clearance,
    stats: stats,
    maxBetween: maxBetween,
    norm360: norm360
  };
});
