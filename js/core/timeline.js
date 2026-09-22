/*!
 * 蓝调勘景仪 Blue Hour Scout — js/core/timeline.js
 *
 * 分钟级光线时间轴。纯计算，无 DOM。
 *
 * 范围：日落前 40 分钟 → 航海暮光结束。
 * 高度角一律用**视高度角**（含大气折射），理由见 exposure.js 顶部。
 * 遮挡判定按项目约定用**日面中心**，不加日面半径偏移。
 */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  root.BH = root.BH || {};
  root.BH.Timeline = api;
  if (typeof module === 'object' && module.exports) { module.exports = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var MIN = 60000;
  var LEAD_MINUTES = 40;        // 日落前多少分钟开始
  var FALLBACK_TAIL = 120;      // 拿不到航海暮光时（高纬夏季）往后顺延多少分钟
  var MIN_PER_SETUP = 8;        // 每个 setup 低于这么多分钟就警告

  function S() { return root.BH.Solar; }
  function H() { return root.BH.Horizon; }
  function E() { return root.BH.Exposure; }
  function Z() { return root.BH.Tz; }

  /**
   * 在两行之间线性插值，求某个量穿过 target 的时刻。
   * rows 必须按时间升序，且 key 在该区间内单调。
   * @returns {number|null} UTC epoch 毫秒
   */
  function crossingBetween(rows, key, target, descending) {
    for (var i = 1; i < rows.length; i++) {
      var a = rows[i - 1][key], b = rows[i][key];
      if (a === null || b === null) { continue; }
      var hit = descending ? (a >= target && b < target) : (a <= target && b > target);
      if (!hit) { continue; }
      var t = (target - a) / (b - a);
      return rows[i - 1].ms + t * (rows[i].ms - rows[i - 1].ms);
    }
    return null;
  }

  /**
   * 算一条时间轴。
   *
   * @param {Object} opts
   *   rec       勘景记录（要有 lat / lon / tz / horizon）
   *   dateKey   'YYYY-MM-DD'，按记录自己的时区解释
   *   settings  项目设置
   *   calib     校准系数 {a,b,...} 或 null
   * @returns {Object} ok 为 false 时看 error
   */
  function build(opts) {
    var rec = opts.rec, settings = opts.settings || {}, calib = opts.calib || null;
    var cam = settings.camera || {};
    var solar = S(), horizon = H(), exp = E(), tz = Z();

    if (!rec || rec.lat === null || rec.lon === null ||
        rec.lat === undefined || rec.lon === undefined) {
      return { ok: false, error: '这条记录还没有坐标，先去第 1 步补上。' };
    }
    var d = tz.parseDateKey(opts.dateKey);
    if (!d) { return { ok: false, error: '日期格式不对，应该是 YYYY-MM-DD。' }; }
    if (!tz.isValidZone(rec.tz)) { return { ok: false, error: '记录里的时区无效。' }; }

    var noonRef = tz.localNoonMs(rec.tz, d.year, d.month, d.day);
    var ev = solar.events(noonRef, rec.lat, rec.lon);
    if (ev.sunset === null) {
      return { ok: false, error: '这一天在这个纬度没有日落（极昼或极夜）。' };
    }

    var startMs = ev.sunset - LEAD_MINUTES * MIN;
    var tailFallback = ev.nauticalDusk === null;
    var endMs = tailFallback ? ev.sunset + FALLBACK_TAIL * MIN : ev.nauticalDusk;

    var shutterSec = exp.shutterSeconds(cam.shutterAngle, cam.fps);
    var isoLow = cam.isoLow > 0 ? cam.isoLow : 400;
    var isoHigh = cam.isoHigh > 0 ? cam.isoHigh : 3200;
    var lens = pickLens(settings);
    var maxAperture = lens ? lens.maxAperture : null;

    var hasHorizon = horizon.count(rec.horizon) > 0;

    // ------------------------------------------------------------ 逐分钟
    var rows = [];
    var m0 = Math.floor(startMs / MIN), m1 = Math.ceil(endMs / MIN);
    for (var m = m0; m <= m1; m++) {
      var ms = m * MIN;
      var p = solar.position(ms, rec.lat, rec.lon);
      var alt = p.apparentAltitude;
      var az = p.azimuth;

      var hz = hasHorizon ? horizon.elevationAt(rec.horizon, az) : null;
      var occluded = hz !== null && alt < hz;

      var ev100 = exp.ev100At(alt, calib);
      var cct = exp.colorTempAt(alt);

      var nLow = exp.tStop(ev100, isoLow, shutterSec);
      var nHigh = exp.tStop(ev100, isoHigh, shutterSec);
      var auto = exp.chooseISO(ev100, isoLow, isoHigh, shutterSec, maxAperture);
      var rLow = exp.stopRange(nLow), rHigh = exp.stopRange(nHigh);

      rows.push({
        ms: ms,
        altitude: alt,
        azimuth: az,
        horizonElev: hz,
        clearance: hz === null ? null : alt - hz,
        occluded: occluded,
        ev100: ev100,
        cct: cct,
        cctInRange: exp.colorTempInRange(alt),
        low: { iso: isoLow, n: nLow, nearest: rLow.nearest, under: rLow.under, over: rLow.over },
        high: { iso: isoHigh, n: nHigh, nearest: rHigh.nearest, under: rHigh.under, over: rHigh.over },
        auto: auto,
        inBlue: false,
        isRealSunset: false,
        lights: []
      });
    }

    // -------------------------------------------------- 真实日落（被遮挡）
    var realSunsetMs = null, realSunsetIndex = -1, occludedFromStart = false;
    if (hasHorizon && rows.length) {
      if (rows[0].occluded) {
        // 一开始就被挡住了：西边有很高的山或楼，遮挡发生在时间轴起点之前
        occludedFromStart = true;
      } else {
        for (var i = 1; i < rows.length; i++) {
          if (rows[i].occluded && !rows[i - 1].occluded) {
            realSunsetIndex = i;
            rows[i].isRealSunset = true;
            // 用相邻两行的余量插值，给到秒
            var c0 = rows[i - 1].clearance, c1 = rows[i].clearance;
            realSunsetMs = (c0 !== null && c1 !== null && c0 !== c1)
              ? rows[i - 1].ms + (c0 / (c0 - c1)) * MIN
              : rows[i].ms;
            break;
          }
        }
      }
    }

    // ---------------------------------------------------------- 蓝调窗口
    var blue = settings.blueRange || { upper: 0, lower: -9 };
    var blueUpper = typeof blue.upper === 'number' ? blue.upper : 0;
    var blueLower = typeof blue.lower === 'number' ? blue.lower : -9;
    if (blueLower > blueUpper) { var sw = blueLower; blueLower = blueUpper; blueUpper = sw; }

    var blueStart = solar.apparentAltitudeCrossing(noonRef, rec.lat, rec.lon, blueUpper, false);
    var blueEnd = solar.apparentAltitudeCrossing(noonRef, rec.lat, rec.lon, blueLower, false);
    var blueMinutes = (blueStart !== null && blueEnd !== null)
      ? (blueEnd - blueStart) / MIN : null;

    for (var k = 0; k < rows.length; k++) {
      rows[k].inBlue = rows[k].altitude <= blueUpper && rows[k].altitude >= blueLower;
    }

    // ------------------------------------------------------ 补光交叉点
    var lights = [];
    (settings.lights || []).forEach(function (L) {
      if (!(L.lux > 0)) { return; }
      var evL = exp.luxToEV100(L.lux);
      var at = crossingBetween(rows, 'ev100', evL, true);
      if (at === null) { return; }
      lights.push({ name: L.name, lux: L.lux, distance: L.distance, ev100: evL, ms: at });
      // 标到最近的那一分钟上
      var idx = Math.round((at - rows[0].ms) / MIN);
      if (idx >= 0 && idx < rows.length) { rows[idx].lights.push(L.name); }
    });

    // ---------------------------------------------------------- 拍摄量
    var setups = settings.setups > 0 ? Math.round(settings.setups) : null;
    var budget = null;
    if (setups && blueMinutes !== null && blueMinutes > 0) {
      var per = blueMinutes / setups;
      var maxSetups = Math.floor(blueMinutes / MIN_PER_SETUP);
      budget = {
        setups: setups,
        perSetup: per,
        ok: per >= MIN_PER_SETUP,
        minPerSetup: MIN_PER_SETUP,
        maxSetups: maxSetups,
        cut: Math.max(0, setups - maxSetups)
      };
    }

    return {
      ok: true,
      error: null,
      dateKey: opts.dateKey,
      tz: rec.tz,
      lens: lens,
      shutterSec: shutterSec,
      isoLow: isoLow,
      isoHigh: isoHigh,
      calib: calib,
      hasHorizon: hasHorizon,
      events: ev,
      startMs: rows.length ? rows[0].ms : startMs,
      endMs: rows.length ? rows[rows.length - 1].ms : endMs,
      tailFallback: tailFallback,
      rows: rows,
      stats: {
        blueUpper: blueUpper,
        blueLower: blueLower,
        blueStart: blueStart,
        blueEnd: blueEnd,
        blueMinutes: blueMinutes,
        astroSunsetMs: ev.sunset,
        realSunsetMs: realSunsetMs,
        realSunsetIndex: realSunsetIndex,
        occludedFromStart: occludedFromStart,
        // 真实日落比天文日落早多少分钟（正值＝提前）
        sunsetShiftMinutes: realSunsetMs === null ? null : (ev.sunset - realSunsetMs) / MIN,
        civilDuskMs: ev.civilDusk,
        nauticalDuskMs: ev.nauticalDusk,
        lights: lights,
        budget: budget
      }
    };
  }

  /** 取当前选中的镜头。没选或越界时返回 null。 */
  function pickLens(settings) {
    var list = settings.lenses || [];
    var i = settings.selectedLens;
    if (typeof i !== 'number' || i < 0 || i >= list.length) { return null; }
    var L = list[i];
    return (L && L.maxAperture > 0) ? L : null;
  }

  /** 找出 ms 对应的行下标；不在范围内返回 −1。 */
  function indexForTime(result, ms) {
    if (!result || !result.ok || !result.rows.length) { return -1; }
    var i = Math.round((ms - result.rows[0].ms) / MIN);
    return (i >= 0 && i < result.rows.length) ? i : -1;
  }

  return {
    LEAD_MINUTES: LEAD_MINUTES,
    MIN_PER_SETUP: MIN_PER_SETUP,
    build: build,
    indexForTime: indexForTime,
    crossingBetween: crossingBetween,
    pickLens: pickLens
  };
});
