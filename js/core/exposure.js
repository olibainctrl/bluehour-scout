/*!
 * 蓝调勘景仪 Blue Hour Scout — js/core/exposure.js
 *
 * 曝光与色温模型。纯计算，无 DOM、无依赖。
 *
 * 自变量统一用**视高度角**（apparentAltitude，含大气折射）
 * ------------------------------------------------------
 * 全项目只用这一个高度角，界面显示的、遮挡判定用的、EV 和色温模型吃的
 * 都是它，不做任何暗中切换——否则表里的读数和算出来的 T 档对不上。
 *
 * 代价是：天文日落那一刻视高度角是 −0.44° 而不是 0.00°（NOAA 的折射模型
 * 在地平线给 0.48°，而日落用的 90.833° 天顶角隐含 34′=0.567°，两者不自洽，
 * 见 solar.js 的说明）。所以 EV 锚点里的「0 度（日落）」严格说差了 0.44°，
 * 折算成 EV 约 0.4 档。这在模型本身的误差范围之内，而且正是校准要吃掉的东西。
 *
 * 低于 −3° 之后折射量已经小于 0.11°，视高度角和几何高度角基本重合，
 * 民用/航海暮光那几个锚点不受影响。
 */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  root.BH = root.BH || {};
  root.BH.Exposure = api;
  if (typeof module === 'object' && module.exports) { module.exports = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  /**
   * EV100 锚点。以太阳视高度角（度）为自变量，中间线性插值。
   * 这是初始估计值，会被实测校准整体覆盖。
   */
  var EV_ANCHORS = [
    [10, 12],
    [0, 9.5],
    [-3, 7],
    [-6, 4.5],
    [-9, 1.5],
    [-12, -1]
  ];

  /** 色温锚点，单位 K。同样以视高度角为自变量。 */
  var CCT_ANCHORS = [
    [0, 3200],
    [-4, 6500],
    [-8, 9000],
    [-12, 12000]
  ];

  /** 常用光圈档位（1/3 级序列）。算出来的精确值对到最近的一档显示。 */
  var STOPS = [
    1.0, 1.1, 1.2, 1.4, 1.6, 1.8, 2.0, 2.2, 2.5, 2.8, 3.2, 3.5,
    4.0, 4.5, 5.0, 5.6, 6.3, 7.1, 8.0, 9.0, 10, 11, 13, 14, 16, 18, 20, 22
  ];

  /**
   * 在锚点表上做分段线性插值。超出两端时沿最外侧那一段的斜率外推，
   * 这样 +15° 或 −15° 也能给出数，不会突然变成常数。
   * 锚点按自变量降序排列。
   */
  function interpolate(anchors, x) {
    var n = anchors.length;
    if (x >= anchors[0][0]) {
      // 高端外推
      var s0 = (anchors[0][1] - anchors[1][1]) / (anchors[0][0] - anchors[1][0]);
      return anchors[0][1] + (x - anchors[0][0]) * s0;
    }
    if (x <= anchors[n - 1][0]) {
      var s1 = (anchors[n - 2][1] - anchors[n - 1][1]) / (anchors[n - 2][0] - anchors[n - 1][0]);
      return anchors[n - 1][1] + (x - anchors[n - 1][0]) * s1;
    }
    for (var i = 0; i < n - 1; i++) {
      var hi = anchors[i], lo = anchors[i + 1];
      if (x <= hi[0] && x >= lo[0]) {
        var t = (x - lo[0]) / (hi[0] - lo[0]);
        return lo[1] + t * (hi[1] - lo[1]);
      }
    }
    return anchors[n - 1][1];
  }

  /** 通用模型给出的 EV100（未校准）。 */
  function baseEV100(altDeg) {
    return interpolate(EV_ANCHORS, altDeg);
  }

  /**
   * EV100。calib 为 {a, b} 时返回 a × 基础值 + b。
   * @param {number} altDeg 太阳视高度角
   * @param {Object} [calib] 校准系数，见 fitCalibration()
   */
  function ev100At(altDeg, calib) {
    var base = baseEV100(altDeg);
    if (!calib || typeof calib.a !== 'number' || typeof calib.b !== 'number') { return base; }
    return calib.a * base + calib.b;
  }

  /**
   * 天光色温，K。
   *
   * 注意：锚点只覆盖 0° 到 −12°，**0° 以上没有模型**。
   * 不能沿 0→−4 段的斜率往上外推——那一段是"太阳越低越蓝"，
   * 而 0° 以上趋势是反的（太阳升高、大气消光减少、直射光变冷），
   * 照着外推会在日落前 40 分钟给出 1800K 这种明显错误的数。
   * 所以 0° 以上一律返回顶端锚点值，并用 colorTempInRange() 告诉界面
   * 这个数超出了模型范围，显示时应当标注出来。
   */
  function colorTempAt(altDeg) {
    var top = CCT_ANCHORS[0];
    if (altDeg >= top[0]) { return top[1]; }
    var k = interpolate(CCT_ANCHORS, altDeg);
    if (k > 20000) { k = 20000; }     // 极低角外推，夹住避免荒谬的数
    return k;
  }

  /** 该高度角是否落在色温模型的有效范围内（0° 及以下）。 */
  function colorTempInRange(altDeg) {
    return altDeg <= CCT_ANCHORS[0][0];
  }

  // -------------------------------------------------------------- 曝光换算

  /** 快门速度，秒。t = 快门角度 / (360 × 帧率) */
  function shutterSeconds(shutterAngle, fps) {
    if (!(shutterAngle > 0) || !(fps > 0)) { return null; }
    return shutterAngle / (360 * fps);
  }

  /** 把 EV100 折算到指定 ISO 下的 EV。 */
  function evAtISO(ev100, iso) {
    return ev100 + Math.log(iso / 100) / Math.LN2;
  }

  /**
   * 需要的 T 档（精确值）。N = sqrt(t × 2^EV_at_ISO)
   * @returns {number|null}
   */
  function tStop(ev100, iso, shutterSec) {
    if (!(shutterSec > 0) || !(iso > 0)) { return null; }
    var ev = evAtISO(ev100, iso);
    var n = Math.sqrt(shutterSec * Math.pow(2, ev));
    return isFinite(n) && n > 0 ? n : null;
  }

  /**
   * 档位表是否装得下这个值。超出两端时界面应显示「＞T22」「＜T1」这样的形式，
   * 而不是静默夹到端点——那会让人以为 T22 拍得了，实际需要 T39。
   */
  function stopRange(n) {
    if (!(n > 0)) { return { nearest: null, under: false, over: false }; }
    return {
      nearest: nearestStop(n),
      under: n < STOPS[0],
      over: n > STOPS[STOPS.length - 1]
    };
  }

  /**
   * 由实拍参数反算 EV100。现场测光表给的是光圈+快门+ISO，
   * 记录实测点时需要换回 EV100。
   */
  function ev100From(n, shutterSec, iso) {
    if (!(n > 0) || !(shutterSec > 0) || !(iso > 0)) { return null; }
    var evAt = Math.log(n * n / shutterSec) / Math.LN2;
    return evAt - Math.log(iso / 100) / Math.LN2;
  }

  /** 对到最近的常用档位。在 log2 空间里比较，这才是"差几分之一档"的正确度量。 */
  function nearestStop(n) {
    if (!(n > 0)) { return null; }
    var best = STOPS[0], bestD = Infinity;
    for (var i = 0; i < STOPS.length; i++) {
      var d = Math.abs(Math.log(STOPS[i] / n) / Math.LN2);
      if (d < bestD) { bestD = d; best = STOPS[i]; }
    }
    return best;
  }

  /** 精确值与最近档位之间差多少级（正值表示精确值比档位更暗）。 */
  function stopsFromNearest(n) {
    var s = nearestStop(n);
    if (s === null) { return null; }
    return 2 * Math.log(n / s) / Math.LN2;   // 光圈是二次关系，×2 换算成曝光级数
  }

  /**
   * 在双原生 ISO 之间选一档。
   * 低档拍得到就用低档（噪点少）；低档需要的光圈比镜头最大光圈还大就换高档。
   * @param {number} maxAperture 当前镜头的最大光圈，没选镜头时传 null
   * @returns {{iso:number, n:number, nearest:number, overLens:boolean, switched:boolean}}
   */
  function chooseISO(ev100, isoLow, isoHigh, shutterSec, maxAperture) {
    var nLow = tStop(ev100, isoLow, shutterSec);
    if (nLow === null) { return null; }
    var hasLens = maxAperture !== null && maxAperture !== undefined;

    // 单原生 ISO 的机器（两档填一样，或高档没填）：没得切，
    // 不能像双原生那样报"已切到高原生 ISO"
    if (!(isoHigh > 0) || isoHigh === isoLow) {
      return {
        iso: isoLow, n: nLow, nearest: nearestStop(nLow),
        overLens: hasLens && nLow < maxAperture,
        switched: false
      };
    }
    var nHigh = tStop(ev100, isoHigh, shutterSec);

    var canLow = (maxAperture === null || maxAperture === undefined) ? true : nLow >= maxAperture;
    var iso = canLow ? isoLow : isoHigh;
    var n = canLow ? nLow : nHigh;
    var over = (maxAperture !== null && maxAperture !== undefined) && n < maxAperture;

    return {
      iso: iso,
      n: n,
      nearest: nearestStop(n),
      overLens: over,           // 连高原生 ISO 也开不到这么大，拍不了
      switched: !canLow         // 需要切到高原生 ISO
    };
  }

  // -------------------------------------------------------------- 灯具照度

  /** 照度换算成 EV100。EV100 = log2(lux / 2.5) */
  function luxToEV100(lux) {
    if (!(lux > 0)) { return null; }
    return Math.log(lux / 2.5) / Math.LN2;
  }

  /** 反过来：EV100 对应多少 lux。设置页显示用。 */
  function ev100ToLux(ev100) {
    return 2.5 * Math.pow(2, ev100);
  }

  /** 平方反比：在 fromM 米处是 lux，则 toM 米处是多少。 */
  function luxAtDistance(lux, fromM, toM) {
    if (!(lux > 0) || !(fromM > 0) || !(toM > 0)) { return null; }
    return lux * (fromM * fromM) / (toM * toM);
  }

  // ---------------------------------------------------------------- 校准

  var MIN_FOR_SLOPE = 3;     // 至少几个点才敢拟合斜率
  var SLOPE_MIN = 0.5, SLOPE_MAX = 2.0;   // 点少时斜率容易跑飞，夹住

  /**
   * 对 (模型值, 实测值) 做最小二乘，得到 实测 ≈ a × 模型 + b。
   * 点太少或自变量没有跨度时退化成只求偏移量（a = 1）。
   */
  function leastSquares(pairs) {
    var n = pairs.length;
    if (n === 0) { return null; }

    var sx = 0, sy = 0;
    for (var i = 0; i < n; i++) { sx += pairs[i][0]; sy += pairs[i][1]; }
    var mx = sx / n, my = sy / n;

    if (n < MIN_FOR_SLOPE) {
      return { a: 1, b: my - mx, n: n, slopeFitted: false };
    }

    var sxx = 0, sxy = 0;
    for (var j = 0; j < n; j++) {
      var dx = pairs[j][0] - mx;
      sxx += dx * dx;
      sxy += dx * (pairs[j][1] - my);
    }
    // 所有点都挤在同一个模型值上，解不出斜率
    if (sxx < 1e-6) {
      return { a: 1, b: my - mx, n: n, slopeFitted: false };
    }

    var a = sxy / sxx;
    if (a < SLOPE_MIN) { a = SLOPE_MIN; }
    if (a > SLOPE_MAX) { a = SLOPE_MAX; }
    return { a: a, b: my - a * mx, n: n, slopeFitted: true };
  }

  /**
   * 由实测点求校准系数。
   *
   * 取数顺序（"优先同一地点，不足退回全局"）：
   *   1. 本地点 ≥3 个点 → 用本地点拟合斜率+偏移
   *   2. 否则全局 ≥3 个点 → 用全局拟合
   *   3. 否则本地点 ≥1 个点 → 用本地点只求偏移
   *   4. 否则全局 ≥1 个点 → 用全局只求偏移
   *   5. 都没有 → 不校准，用通用模型
   *
   * @param {Array} all 全部实测点 [{alt, ev100, recordId}]
   * @param {string} recordId 当前地点
   * @returns {{a,b,n,slopeFitted,source}|null} source 为 'location' 或 'global'
   */
  function fitCalibration(all, recordId) {
    if (!all || !all.length) { return null; }
    var local = [], global = [];
    for (var i = 0; i < all.length; i++) {
      var p = all[i];
      if (typeof p.alt !== 'number' || typeof p.ev100 !== 'number' ||
          !isFinite(p.alt) || !isFinite(p.ev100)) { continue; }
      var pair = [baseEV100(p.alt), p.ev100];
      global.push(pair);
      if (recordId && p.recordId === recordId) { local.push(pair); }
    }

    var fit = null, source = null;
    if (local.length >= MIN_FOR_SLOPE) { fit = leastSquares(local); source = 'location'; }
    else if (global.length >= MIN_FOR_SLOPE) { fit = leastSquares(global); source = 'global'; }
    else if (local.length >= 1) { fit = leastSquares(local); source = 'location'; }
    else if (global.length >= 1) { fit = leastSquares(global); source = 'global'; }

    if (!fit) { return null; }
    fit.source = source;
    return fit;
  }

  /** 校准后相对通用模型的残差均方根，用来显示拟合有多好。 */
  function calibrationRMS(all, recordId, calib) {
    if (!all || !all.length || !calib) { return null; }
    var n = 0, ss = 0;
    for (var i = 0; i < all.length; i++) {
      var p = all[i];
      if (recordId && calib.source === 'location' && p.recordId !== recordId) { continue; }
      if (typeof p.alt !== 'number' || typeof p.ev100 !== 'number') { continue; }
      var d = ev100At(p.alt, calib) - p.ev100;
      ss += d * d; n++;
    }
    return n ? Math.sqrt(ss / n) : null;
  }

  return {
    EV_ANCHORS: EV_ANCHORS,
    CCT_ANCHORS: CCT_ANCHORS,
    STOPS: STOPS,
    MIN_FOR_SLOPE: MIN_FOR_SLOPE,
    interpolate: interpolate,
    baseEV100: baseEV100,
    ev100At: ev100At,
    colorTempAt: colorTempAt,
    colorTempInRange: colorTempInRange,
    stopRange: stopRange,
    shutterSeconds: shutterSeconds,
    evAtISO: evAtISO,
    tStop: tStop,
    ev100From: ev100From,
    nearestStop: nearestStop,
    stopsFromNearest: stopsFromNearest,
    chooseISO: chooseISO,
    luxToEV100: luxToEV100,
    ev100ToLux: ev100ToLux,
    luxAtDistance: luxAtDistance,
    leastSquares: leastSquares,
    fitCalibration: fitCalibration,
    calibrationRMS: calibrationRMS
  };
});
