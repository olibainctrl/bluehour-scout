/*!
 * 蓝调勘景仪 Blue Hour Scout — js/core/solar.js
 *
 * NOAA 太阳位置算法的本地实现。无网络、无依赖、无 DOM。
 * 移植自 NOAA Global Monitoring Laboratory Solar Calculator
 * (https://gml.noaa.gov/grad/solcalc/) 所使用的天文公式，
 * 底层出处为 Jean Meeus《Astronomical Algorithms》第 2 版。
 *
 * 设计约定：
 *  - 所有对外的时刻都是 UTC epoch 毫秒（Number）。时区只在 UI 层出现。
 *  - altitude        = 几何高度角（日面中心，不含大气折射）
 *  - apparentAltitude= 视高度角（含 NOAA 折射修正），肉眼/手机测到的就是这个
 *  - azimuth         = 真北起算、顺时针为正的方位角，0..360
 *  - 日出日落用 NOAA 的 90.833° 天顶角约定，即几何高度角 -0.833°
 *    （0.833° = 大气折射 34' + 日面半径 16'）；各级暮光用几何高度角
 *    -6 / -12 / -18°，与各国天文台公布值的口径一致。
 *
 * 经典 <script> 加载，同时兼容 CommonJS（便于在 node 里跑测试）。
 */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  root.BH = root.BH || {};
  root.BH.Solar = api;
  if (typeof module === 'object' && module.exports) { module.exports = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var RAD = Math.PI / 180;
  var DEG = 180 / Math.PI;
  var MS_DAY = 86400000;
  var MS_HOUR = 3600000;
  var J1970 = 2440587.5;   // 1970-01-01T00:00:00Z 的儒略日
  var J2000 = 2451545.0;

  // 日出/日落判定用的几何高度角
  var ALT_SUNRISE = -0.833;
  var ALT_CIVIL = -6;
  var ALT_NAUTICAL = -12;
  var ALT_ASTRONOMICAL = -18;

  function mod360(d) { d = d % 360; return d < 0 ? d + 360 : d; }
  function toJulian(ms) { return ms / MS_DAY + J1970; }
  function fromJulian(jd) { return (jd - J1970) * MS_DAY; }
  function julianCentury(jd) { return (jd - J2000) / 36525.0; }

  // ---------------------------------------------------------------- 天文量
  // 以下函数的自变量 t 均为 J2000 起算的儒略世纪数。

  /** 太阳几何平黄经，度 */
  function geomMeanLongSun(t) {
    return mod360(280.46646 + t * (36000.76983 + t * 0.0003032));
  }

  /** 太阳几何平近点角，度 */
  function geomMeanAnomalySun(t) {
    return 357.52911 + t * (35999.05029 - 0.0001537 * t);
  }

  /** 地球轨道偏心率，无量纲 */
  function eccentricityEarthOrbit(t) {
    return 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
  }

  /** 太阳中心差，度 */
  function sunEqOfCenter(t) {
    var m = geomMeanAnomalySun(t) * RAD;
    return Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
           Math.sin(2 * m) * (0.019993 - 0.000101 * t) +
           Math.sin(3 * m) * 0.000289;
  }

  /** 太阳真黄经，度 */
  function sunTrueLong(t) { return geomMeanLongSun(t) + sunEqOfCenter(t); }

  /** 太阳视黄经（含章动与光行差近似），度 */
  function sunApparentLong(t) {
    return sunTrueLong(t) - 0.00569 -
           0.00478 * Math.sin((125.04 - 1934.136 * t) * RAD);
  }

  /** 黄赤交角平均值，度 */
  function meanObliquityOfEcliptic(t) {
    var seconds = 21.448 - t * (46.815 + t * (0.00059 - t * 0.001813));
    return 23.0 + (26.0 + seconds / 60.0) / 60.0;
  }

  /** 黄赤交角（含章动修正），度 */
  function obliquityCorrection(t) {
    return meanObliquityOfEcliptic(t) +
           0.00256 * Math.cos((125.04 - 1934.136 * t) * RAD);
  }

  /** 太阳赤纬，度 */
  function sunDeclination(t) {
    var e = obliquityCorrection(t) * RAD;
    var lambda = sunApparentLong(t) * RAD;
    return Math.asin(Math.sin(e) * Math.sin(lambda)) * DEG;
  }

  /** 时差（真太阳时 − 平太阳时），分钟 */
  function equationOfTime(t) {
    var epsilon = obliquityCorrection(t) * RAD;
    var l0 = geomMeanLongSun(t) * RAD;
    var e = eccentricityEarthOrbit(t);
    var m = geomMeanAnomalySun(t) * RAD;
    var y = Math.tan(epsilon / 2);
    y *= y;
    var eqTime = y * Math.sin(2 * l0) -
                 2 * e * Math.sin(m) +
                 4 * e * y * Math.sin(m) * Math.cos(2 * l0) -
                 0.5 * y * y * Math.sin(4 * l0) -
                 1.25 * e * e * Math.sin(2 * m);
    return eqTime * 4 * DEG;   // 弧度 → 度 → 分钟
  }

  /**
   * 大气折射修正，度。NOAA Solar Calculator 使用的分段近似。
   * @param {number} elev 几何（视外）高度角，度
   */
  function refraction(elev) {
    if (elev > 85.0) { return 0.0; }
    var te = Math.tan(elev * RAD);
    var arcsec;
    if (elev > 5.0) {
      arcsec = 58.1 / te - 0.07 / (te * te * te) + 0.000086 / Math.pow(te, 5);
    } else if (elev > -0.575) {
      arcsec = 1735.0 + elev * (-518.2 + elev * (103.4 + elev * (-12.79 + elev * 0.711)));
    } else {
      arcsec = -20.774 / te;
    }
    return arcsec / 3600.0;
  }

  // ------------------------------------------------------------ 位置与时角

  /**
   * 给定时刻的太阳位置。
   * @param {number|Date} when   UTC epoch 毫秒，或 Date
   * @param {number} lat  纬度，度，北为正
   * @param {number} lon  经度，度，东为正
   * @returns {{altitude:number, apparentAltitude:number, azimuth:number,
   *            declination:number, hourAngle:number, equationOfTime:number,
   *            julianDay:number, ms:number}}
   */
  function position(when, lat, lon) {
    var ms = (when instanceof Date) ? when.getTime() : when;
    var jd = toJulian(ms);
    var t = julianCentury(jd);
    var eqTime = equationOfTime(t);
    var dec = sunDeclination(t);

    // 当日 00:00 UTC 起算的分钟数
    var minutesUTC = (((ms % MS_DAY) + MS_DAY) % MS_DAY) / 60000;
    var trueSolarTime = minutesUTC + eqTime + 4 * lon;
    trueSolarTime = ((trueSolarTime % 1440) + 1440) % 1440;

    var hourAngle = trueSolarTime / 4 - 180;      // 度，−180..180
    var haRad = hourAngle * RAD;
    var latRad = lat * RAD;
    var decRad = dec * RAD;

    var csz = Math.sin(latRad) * Math.sin(decRad) +
              Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad);
    if (csz > 1) { csz = 1; } else if (csz < -1) { csz = -1; }
    var zenith = Math.acos(csz) * DEG;
    var altitude = 90 - zenith;

    var azimuth;
    var azDenom = Math.cos(latRad) * Math.sin(zenith * RAD);
    if (Math.abs(azDenom) > 0.001) {
      var azRad = (Math.sin(latRad) * Math.cos(zenith * RAD) - Math.sin(decRad)) / azDenom;
      if (azRad > 1) { azRad = 1; } else if (azRad < -1) { azRad = -1; }
      azimuth = 180 - Math.acos(azRad) * DEG;
      if (hourAngle > 0) { azimuth = -azimuth; }
    } else {
      azimuth = (lat > 0) ? 180 : 0;
    }
    azimuth = mod360(azimuth);

    return {
      ms: ms,
      julianDay: jd,
      altitude: altitude,
      apparentAltitude: altitude + refraction(altitude),
      azimuth: azimuth,
      declination: dec,
      hourAngle: hourAngle,
      equationOfTime: eqTime
    };
  }

  /**
   * 求给定几何高度角对应的时角大小，度（0..180）。
   * 返回 null 表示当天太阳达不到（极昼/极夜一侧）。
   */
  function hourAngleForAltitude(altDeg, latDeg, decDeg) {
    var latRad = latDeg * RAD;
    var decRad = decDeg * RAD;
    var cosH = (Math.sin(altDeg * RAD) - Math.sin(latRad) * Math.sin(decRad)) /
               (Math.cos(latRad) * Math.cos(decRad));
    if (cosH > 1 || cosH < -1) { return null; }
    return Math.acos(cosH) * DEG;
  }

  /**
   * 距 refMs 最近的一次真太阳正午（时角 = 0）。
   * 时角已归一化到 −180..180，所以直接迭代即可收敛到最近的一次。
   * @returns {number} UTC epoch 毫秒
   */
  function solarNoon(refMs, lat, lon) {
    var ms = (refMs instanceof Date) ? refMs.getTime() : refMs;
    for (var i = 0; i < 4; i++) {
      ms -= position(ms, lat, lon).hourAngle / 15 * MS_HOUR;
    }
    return ms;
  }

  /**
   * 求太阳几何高度角穿越 targetAlt 的时刻。
   * 先用时角公式给初值，再对几何高度角做牛顿迭代（中心差分求导），
   * 收敛到毫秒级，不受单次迭代残差的影响。
   *
   * @param {number} noonMs    当日真太阳正午
   * @param {boolean} rising   true = 上升穿越（晨），false = 下降穿越（昏）
   * @returns {number|null} UTC epoch 毫秒；当天不发生则为 null
   */
  function crossing(noonMs, lat, lon, targetAlt, rising) {
    var t = julianCentury(toJulian(noonMs));
    var ha = hourAngleForAltitude(targetAlt, lat, sunDeclination(t));
    if (ha === null) { return null; }

    var guess = noonMs + (rising ? -ha : ha) / 15 * MS_HOUR;
    var x = guess;
    for (var i = 0; i < 8; i++) {
      var f = position(x, lat, lon).altitude - targetAlt;
      var slope = (position(x + 30000, lat, lon).altitude -
                   position(x - 30000, lat, lon).altitude) / 60000;
      if (slope === 0) { break; }
      var step = f / slope;
      // 限幅，避免在极区附近导数趋零时迭代跑飞
      if (step > MS_HOUR) { step = MS_HOUR; }
      if (step < -MS_HOUR) { step = -MS_HOUR; }
      x -= step;
      if (Math.abs(step) < 1) { break; }
    }
    // 结果必须仍在该次正午的同一天之内，否则视为当天不发生
    if (Math.abs(x - noonMs) > 12 * MS_HOUR) { return null; }
    if (Math.abs(position(x, lat, lon).altitude - targetAlt) > 0.01) { return null; }
    return x;
  }

  /**
   * 一天的全部太阳事件。
   * @param {number|Date} refMs 该日当地正午附近的任意时刻（UTC epoch 毫秒）
   * @returns {Object} 各事件的 UTC epoch 毫秒，不发生的为 null
   */
  function events(refMs, lat, lon) {
    var noon = solarNoon(refMs, lat, lon);
    return {
      solarNoon: noon,
      sunrise: crossing(noon, lat, lon, ALT_SUNRISE, true),
      sunset: crossing(noon, lat, lon, ALT_SUNRISE, false),
      civilDawn: crossing(noon, lat, lon, ALT_CIVIL, true),
      civilDusk: crossing(noon, lat, lon, ALT_CIVIL, false),
      nauticalDawn: crossing(noon, lat, lon, ALT_NAUTICAL, true),
      nauticalDusk: crossing(noon, lat, lon, ALT_NAUTICAL, false),
      astronomicalDawn: crossing(noon, lat, lon, ALT_ASTRONOMICAL, true),
      astronomicalDusk: crossing(noon, lat, lon, ALT_ASTRONOMICAL, false)
    };
  }

  /**
   * 求太阳几何高度角下降穿越任意角度的时刻（蓝调区间上下界用）。
   */
  function altitudeCrossing(refMs, lat, lon, targetAlt, rising) {
    return crossing(solarNoon(refMs, lat, lon), lat, lon, targetAlt, rising);
  }

  return {
    ALT_SUNRISE: ALT_SUNRISE,
    ALT_CIVIL: ALT_CIVIL,
    ALT_NAUTICAL: ALT_NAUTICAL,
    ALT_ASTRONOMICAL: ALT_ASTRONOMICAL,
    position: position,
    events: events,
    solarNoon: solarNoon,
    altitudeCrossing: altitudeCrossing,
    refraction: refraction,
    hourAngleForAltitude: hourAngleForAltitude,
    // 以下为内部量，导出供测试与调试使用
    _internal: {
      toJulian: toJulian,
      fromJulian: fromJulian,
      julianCentury: julianCentury,
      equationOfTime: equationOfTime,
      sunDeclination: sunDeclination,
      geomMeanLongSun: geomMeanLongSun,
      obliquityCorrection: obliquityCorrection
    }
  };
});
