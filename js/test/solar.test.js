/*!
 * 蓝调勘景仪 Blue Hour Scout — js/test/solar.test.js
 *
 * 太阳位置算法与时区工具的单元测试。用 test.html 在浏览器里打开即可运行。
 *
 * 基准数据来源
 * ------------
 * A. NOAA Global Monitoring Laboratory Solar Calculator（主基准，容差 ±60 秒）
 *    https://gml.noaa.gov/grad/solcalc/table.php?lat=-33.8688&lon=151.2093&year=2026
 *    坐标 -33.8688 / 151.2093，时区 Australia/Sydney。
 *    日出日落取整到分钟；太阳正午精确到秒。
 *
 * B. Geoscience Australia 大地测量计算器（交叉参考，容差 ±120 秒）
 *    https://geodesyapps.ga.gov.au/sunrise
 *    GA 只接受度+整分的坐标，实际使用 -33°52' / +151°12'，
 *    即 -33.866667 / 151.2，所以这一组按 GA 自己的坐标计算。
 *    GA 用的是比 NOAA 更高精度的算法，两者本身就会差几十秒，
 *    因此这里只作为"没有系统性错误"的旁证，容差放宽到 2 分钟。
 */
(function () {
  'use strict';

  var T = BH.Test;
  var S = BH.Solar;
  var Z = BH.Tz;

  var SYD_TZ = 'Australia/Sydney';
  var NOAA_LAT = -33.8688, NOAA_LON = 151.2093;
  var GA_LAT = -33.866667, GA_LON = 151.2;

  // ---------------------------------------------------------------- 工具函数

  function hmsToSec(s) {
    var p = String(s).split(':');
    return (+p[0]) * 3600 + (+p[1]) * 60 + (p.length > 2 ? +p[2] : 0);
  }

  /** 某时刻在悉尼当地是当天的第几秒。 */
  function localSecOfDay(ms, tz) {
    var p = Z.zonedParts(ms, tz);
    return p.hour * 3600 + p.minute * 60 + p.second;
  }

  /** 计算值与基准值之差，秒；自动处理跨日回绕。 */
  function deltaSec(ms, expectedHms, tz) {
    var d = localSecOfDay(ms, tz) - hmsToSec(expectedHms);
    if (d > 43200) { d -= 86400; }
    if (d < -43200) { d += 86400; }
    return d;
  }

  function fmtDelta(d) {
    return (d >= 0 ? '+' : '') + (Math.round(d * 10) / 10) + 's';
  }

  function eventsForDate(dateKey, lat, lon, tz) {
    var d = Z.parseDateKey(dateKey);
    return S.events(Z.localNoonMs(tz, d.year, d.month, d.day), lat, lon);
  }

  // ------------------------------------------------------------ NOAA 基准数据
  // [日期, 日出, 日落, 太阳正午]，悉尼当地时间（夏令时已包含在内）
  var NOAA = [
    ['2026-01-05', '05:51', '20:10', '13:00:09'],
    ['2026-02-14', '06:29', '19:49', '13:09:21'],
    ['2026-03-20', '06:58', '19:07', '13:02:52'],
    ['2026-04-05', '06:10', '17:45', '11:58:06'],   // 夏令时结束当天
    ['2026-05-01', '06:29', '17:15', '11:52:23'],
    ['2026-06-21', '07:00', '16:54', '11:56:47'],   // 冬至
    ['2026-07-15', '06:58', '17:04', '12:01:05'],
    ['2026-08-30', '06:17', '17:36', '11:56:05'],
    ['2026-09-23', '05:44', '17:52', '11:47:53'],   // 春分
    ['2026-10-04', '06:29', '19:00', '12:44:10'],   // 夏令时开始当天
    ['2026-11-15', '05:44', '19:36', '12:39:34'],
    ['2026-12-21', '05:41', '20:05', '12:52:47'],   // 夏至
    ['2025-03-15', '06:54', '19:13', '13:04:14'],
    ['2025-06-30', '07:01', '16:57', '11:58:44'],
    ['2025-09-10', '06:02', '17:43', '11:52:24'],
    ['2025-12-05', '05:37', '19:55', '12:45:30']
  ];

  // -------------------------------------------------------- GA 交叉参考数据
  // [日期, 日出, 日落, 民用晨光始, 民用昏影终, 航海晨光始, 航海昏影终, 太阳中天]
  var GA = [
    ['2026-06-21', '07:00', '16:53', '06:32', '17:21', '06:01', '17:52', '11:56'],
    ['2026-12-21', '05:40', '20:05', '05:11', '20:34', '04:35', '21:10', '12:53'],
    ['2026-03-20', '06:58', '19:07', '06:33', '19:31', '06:03', '20:00', '13:02'],
    ['2026-09-23', '05:44', '17:52', '05:19', '18:16', '04:50', '18:46', '11:47'],
    ['2026-05-01', '06:29', '17:14', '06:03', '17:40', '05:34', '18:10', '11:52'],
    ['2026-11-15', '05:43', '19:36', '05:16', '20:03', '04:43', '20:36', '12:39']
  ];

  // ============================================================ 测试开始

  T.suite('NOAA 基准：悉尼日出 / 日落（主基准，容差 ±60 秒）', function () {

    T.test('16 个日期的日出时间', function () {
      var worst = 0;
      for (var i = 0; i < NOAA.length; i++) {
        var f = NOAA[i];
        var ev = eventsForDate(f[0], NOAA_LAT, NOAA_LON, SYD_TZ);
        var d = deltaSec(ev.sunrise, f[1], SYD_TZ);
        if (Math.abs(d) > Math.abs(worst)) { worst = d; }
        T.row([f[0], Z.formatTime(ev.sunrise, SYD_TZ, true), f[1], fmtDelta(d),
               Math.abs(d) <= 60 ? '通过' : '失败']);
        T.ok(Math.abs(d) <= 60, f[0] + ' 日出误差 ' + fmtDelta(d));
      }
      T.ok(true, '最大误差 ' + fmtDelta(worst));
    });

    T.test('16 个日期的日落时间', function () {
      var worst = 0;
      for (var i = 0; i < NOAA.length; i++) {
        var f = NOAA[i];
        var ev = eventsForDate(f[0], NOAA_LAT, NOAA_LON, SYD_TZ);
        var d = deltaSec(ev.sunset, f[2], SYD_TZ);
        if (Math.abs(d) > Math.abs(worst)) { worst = d; }
        T.row([f[0], Z.formatTime(ev.sunset, SYD_TZ, true), f[2], fmtDelta(d),
               Math.abs(d) <= 60 ? '通过' : '失败']);
        T.ok(Math.abs(d) <= 60, f[0] + ' 日落误差 ' + fmtDelta(d));
      }
      T.ok(true, '最大误差 ' + fmtDelta(worst));
    });

    T.test('更严的检查：四舍五入到分钟后与 NOAA 完全相同', function () {
      // NOAA 公布值本身就是取整到分钟的，所以这是能做的最严格比对。
      for (var i = 0; i < NOAA.length; i++) {
        var f = NOAA[i];
        var ev = eventsForDate(f[0], NOAA_LAT, NOAA_LON, SYD_TZ);
        var riseMin = Math.round(localSecOfDay(ev.sunrise, SYD_TZ) / 60) % 1440;
        var setMin = Math.round(localSecOfDay(ev.sunset, SYD_TZ) / 60) % 1440;
        var riseStr = Z.pad(Math.floor(riseMin / 60), 2) + ':' + Z.pad(riseMin % 60, 2);
        var setStr = Z.pad(Math.floor(setMin / 60), 2) + ':' + Z.pad(setMin % 60, 2);
        T.row([f[0], riseStr + ' / ' + setStr, f[1] + ' / ' + f[2],
               (riseStr === f[1] && setStr === f[2]) ? '一致' : '不一致',
               (riseStr === f[1] && setStr === f[2]) ? '通过' : '失败']);
        T.equal(riseStr, f[1], f[0] + ' 日出取整');
        T.equal(setStr, f[2], f[0] + ' 日落取整');
      }
    });
  });

  T.suite('NOAA 基准：太阳正午（精确到秒，容差 ±30 秒）', function () {
    T.test('16 个日期的真太阳正午', function () {
      // NOAA 这一列的时差只迭代一趟，取值时刻比真正的正午早约半天，
      // 在时差变化最快的 12 月底可以差到十几秒。本实现迭代到收敛，
      // 是更接近真值的那个，因此这里容差取 30 秒。
      var worst = 0;
      for (var i = 0; i < NOAA.length; i++) {
        var f = NOAA[i];
        var ev = eventsForDate(f[0], NOAA_LAT, NOAA_LON, SYD_TZ);
        var d = deltaSec(ev.solarNoon, f[3], SYD_TZ);
        if (Math.abs(d) > Math.abs(worst)) { worst = d; }
        T.row([f[0], Z.formatTime(ev.solarNoon, SYD_TZ, true), f[3], fmtDelta(d),
               Math.abs(d) <= 30 ? '通过' : '失败']);
        T.ok(Math.abs(d) <= 30, f[0] + ' 太阳正午误差 ' + fmtDelta(d));
      }
      T.ok(true, '最大误差 ' + fmtDelta(worst));
      // 声明页写了「太阳正午最大差 N 秒」，算法一变这里就会提醒去改说明
      var CL = BH.Guide && BH.Guide.CLAIMS;
      if (CL) {
        T.equal(NOAA.length, CL.noaaDates, '声明页写的日期数');
        T.ok(Math.round(Math.abs(worst)) <= CL.noaaNoonMaxSec,
             '声明页写正午最大差 ' + CL.noaaNoonMaxSec + ' 秒，实际 ' + fmtDelta(worst));
      }
    });
  });

  T.suite('Geoscience Australia 交叉参考（容差 ±120 秒）', function () {

    var LABELS = [
      [1, 'sunrise', '日出'], [2, 'sunset', '日落'],
      [3, 'civilDawn', '民用晨光始'], [4, 'civilDusk', '民用昏影终'],
      [5, 'nauticalDawn', '航海晨光始'], [6, 'nauticalDusk', '航海昏影终'],
      [7, 'solarNoon', '太阳中天']
    ];

    for (var li = 0; li < LABELS.length; li++) {
      (function (col, key, label) {
        T.test(label + '（6 个日期）', function () {
          var worst = 0;
          for (var i = 0; i < GA.length; i++) {
            var f = GA[i];
            var ev = eventsForDate(f[0], GA_LAT, GA_LON, SYD_TZ);
            var d = deltaSec(ev[key], f[col], SYD_TZ);
            if (Math.abs(d) > Math.abs(worst)) { worst = d; }
            T.row([f[0], Z.formatTime(ev[key], SYD_TZ, true), f[col], fmtDelta(d),
                   Math.abs(d) <= 120 ? '通过' : '失败']);
            T.ok(Math.abs(d) <= 120, f[0] + ' ' + label + '误差 ' + fmtDelta(d));
          }
          T.ok(true, '最大误差 ' + fmtDelta(worst));
        });
      }(LABELS[li][0], LABELS[li][1], LABELS[li][2]));
    }

    T.test('声明页引用的总数和最大差', function () {
      var CL = BH.Guide && BH.Guide.CLAIMS;
      if (!CL) { T.ok(true, '没加载说明页，跳过'); return; }
      var worst = 0, n = 0;
      LABELS.forEach(function (L) {
        GA.forEach(function (f) {
          var ev = eventsForDate(f[0], GA_LAT, GA_LON, SYD_TZ);
          var d = Math.abs(deltaSec(ev[L[1]], f[L[0]], SYD_TZ));
          n++;
          if (d > worst) { worst = d; }
        });
      });
      T.equal(GA.length, CL.gaDates, '声明页写的日期数');
      T.equal(n, CL.gaEvents, '声明页写的时刻数');
      T.ok(Math.round(worst) <= CL.gaMaxSec,
           '声明页写最大差 ' + CL.gaMaxSec + ' 秒，实际 ' + Math.round(worst) + ' 秒');
    });
  });

  T.suite('算法内部一致性：2026 全年逐日扫描（悉尼）', function () {

    T.test('每日事件时刻处的太阳高度角精确等于定义值', function () {
      var maxErr = { sunrise: 0, sunset: 0, civilDusk: 0, nauticalDusk: 0, astronomicalDusk: 0 };
      var targets = {
        sunrise: S.ALT_SUNRISE, sunset: S.ALT_SUNRISE, civilDusk: S.ALT_CIVIL,
        nauticalDusk: S.ALT_NAUTICAL, astronomicalDusk: S.ALT_ASTRONOMICAL
      };
      var days = 0;
      for (var doy = 0; doy < 365; doy++) {
        var base = Date.UTC(2026, 0, 1) + doy * 86400000;
        var dk = Z.parseDateKey(Z.dateKey(base, SYD_TZ));
        var ev = S.events(Z.localNoonMs(SYD_TZ, dk.year, dk.month, dk.day), NOAA_LAT, NOAA_LON);
        days++;
        for (var k in targets) {
          if (ev[k] === null) { continue; }
          var e = Math.abs(S.position(ev[k], NOAA_LAT, NOAA_LON).altitude - targets[k]);
          if (e > maxErr[k]) { maxErr[k] = e; }
        }
      }
      T.equal(days, 365, '扫描了 365 天');
      for (var key in maxErr) {
        T.row([key, maxErr[key].toExponential(2) + '°', '< 0.001°',
               maxErr[key] < 0.001 ? '通过' : '失败']);
        T.ok(maxErr[key] < 0.001, key + ' 的高度角最大偏差 ' + maxErr[key].toExponential(2) + '°');
      }
    });

    T.test('太阳正午处的时角为零', function () {
      var maxHa = 0;
      for (var doy = 0; doy < 365; doy++) {
        var base = Date.UTC(2026, 0, 1) + doy * 86400000;
        var dk = Z.parseDateKey(Z.dateKey(base, SYD_TZ));
        var noon = S.solarNoon(Z.localNoonMs(SYD_TZ, dk.year, dk.month, dk.day), NOAA_LAT, NOAA_LON);
        var ha = Math.abs(S.position(noon, NOAA_LAT, NOAA_LON).hourAngle);
        if (ha > maxHa) { maxHa = ha; }
      }
      T.ok(maxHa < 0.001, '全年最大时角残差 ' + maxHa.toExponential(2) + '°');
    });

    T.test('事件先后次序全年成立', function () {
      var bad = 0, badDay = '';
      for (var doy = 0; doy < 365; doy++) {
        var base = Date.UTC(2026, 0, 1) + doy * 86400000;
        var dk = Z.parseDateKey(Z.dateKey(base, SYD_TZ));
        var key = Z.dateKey(base, SYD_TZ);
        var ev = S.events(Z.localNoonMs(SYD_TZ, dk.year, dk.month, dk.day), NOAA_LAT, NOAA_LON);
        var ordered = ev.astronomicalDawn < ev.nauticalDawn &&
                      ev.nauticalDawn < ev.civilDawn &&
                      ev.civilDawn < ev.sunrise &&
                      ev.sunrise < ev.solarNoon &&
                      ev.solarNoon < ev.sunset &&
                      ev.sunset < ev.civilDusk &&
                      ev.civilDusk < ev.nauticalDusk &&
                      ev.nauticalDusk < ev.astronomicalDusk;
        if (!ordered) { bad++; if (!badDay) { badDay = key; } }
      }
      T.equal(bad, 0, '次序错误的天数（首个：' + (badDay || '无') + '）');
    });

    T.test('日落前后逐分钟的高度角单调下降', function () {
      var ev = eventsForDate('2026-06-21', NOAA_LAT, NOAA_LON, SYD_TZ);
      var prev = Infinity, bad = 0;
      for (var m = -40; m <= 80; m++) {
        var alt = S.position(ev.sunset + m * 60000, NOAA_LAT, NOAA_LON).altitude;
        if (alt >= prev) { bad++; }
        prev = alt;
      }
      T.equal(bad, 0, '日落前 40 分钟到后 80 分钟共 121 个采样点全部单调');
    });
  });

  T.suite('几何合理性', function () {

    T.test('悉尼二至日的正午太阳高度角', function () {
      // 正午高度角 = 90 − |纬度 − 赤纬|
      var winter = eventsForDate('2026-06-21', NOAA_LAT, NOAA_LON, SYD_TZ);
      var summer = eventsForDate('2026-12-21', NOAA_LAT, NOAA_LON, SYD_TZ);
      var wAlt = S.position(winter.solarNoon, NOAA_LAT, NOAA_LON).altitude;
      var sAlt = S.position(summer.solarNoon, NOAA_LAT, NOAA_LON).altitude;
      T.near(wAlt, 32.69, 0.2, '冬至正午高度角约 32.7°', '°');
      T.near(sAlt, 79.57, 0.2, '夏至正午高度角约 79.6°', '°');
      T.row(['冬至正午', wAlt.toFixed(2) + '°', '32.69°', '±0.2°']);
      T.row(['夏至正午', sAlt.toFixed(2) + '°', '79.57°', '±0.2°']);
    });

    T.test('悉尼位于南回归线以南，正午太阳永远在正北', function () {
      var maxOff = 0;
      for (var doy = 0; doy < 365; doy += 7) {
        var base = Date.UTC(2026, 0, 1) + doy * 86400000;
        var dk = Z.parseDateKey(Z.dateKey(base, SYD_TZ));
        var noon = S.solarNoon(Z.localNoonMs(SYD_TZ, dk.year, dk.month, dk.day), NOAA_LAT, NOAA_LON);
        var az = S.position(noon, NOAA_LAT, NOAA_LON).azimuth;
        var off = Math.min(Math.abs(az - 0), Math.abs(az - 360));
        if (off > maxOff) { maxOff = off; }
      }
      T.ok(maxOff < 0.5, '正午方位角与正北的最大偏差 ' + maxOff.toFixed(3) + '°');
    });

    T.test('日出在东侧、日落在西侧，且冬夏偏移方向正确', function () {
      var w = eventsForDate('2026-06-21', NOAA_LAT, NOAA_LON, SYD_TZ);
      var s = eventsForDate('2026-12-21', NOAA_LAT, NOAA_LON, SYD_TZ);
      var wSet = S.position(w.sunset, NOAA_LAT, NOAA_LON).azimuth;
      var sSet = S.position(s.sunset, NOAA_LAT, NOAA_LON).azimuth;
      var wRise = S.position(w.sunrise, NOAA_LAT, NOAA_LON).azimuth;
      T.ok(wRise > 55 && wRise < 65, '冬至日出方位角在东偏北 55–65° 之间（得到 ' + wRise.toFixed(1) + '°）');
      T.ok(wSet > 295 && wSet < 305, '冬至日落方位角在西偏北 295–305° 之间（得到 ' + wSet.toFixed(1) + '°）');
      T.ok(sSet > 235 && sSet < 245, '夏至日落方位角在西偏南 235–245° 之间（得到 ' + sSet.toFixed(1) + '°）');
      T.ok(wSet - sSet > 55, '冬夏日落方位角相差 ' + (wSet - sSet).toFixed(1) + '°，超过 55°');
      T.row(['冬至日出', wRise.toFixed(1) + '°', '55–65°']);
      T.row(['冬至日落', wSet.toFixed(1) + '°', '295–305°']);
      T.row(['夏至日落', sSet.toFixed(1) + '°', '235–245°']);
    });

    T.test('大气折射模型', function () {
      T.near(S.refraction(0), 0.482, 0.01, '地平线处折射约 0.48°', '°');
      T.near(S.refraction(90), 0, 1e-9, '天顶处折射为零', '°');
      T.ok(S.refraction(0) > S.refraction(10), '折射量随高度角增大而减小');
      T.ok(S.refraction(10) > S.refraction(45), '折射量随高度角增大而减小（高段）');
      var ev = eventsForDate('2026-06-21', NOAA_LAT, NOAA_LON, SYD_TZ);
      var p = S.position(ev.sunset, NOAA_LAT, NOAA_LON);
      T.near(p.altitude, -0.833, 0.001, '日落时刻的几何高度角为 −0.833°', '°');
      // NOAA 有一处内部不自洽，这里固化下来免得以后踩：
      // 日出日落用的 90.833° 天顶角隐含地平折射 34′（0.567°），
      // 但 calcRefraction() 在地平线给出的是 0.482°。两者差 0.085°，
      // 于是日落这一刻的"视高度角"是 −0.436° 而不是 0°。
      // 折算成时间在悉尼约 25 秒，界面上一律显示视高度角，
      // 不要误以为日落对应 0.000°。
      T.near(S.refraction(0), 0.4819, 0.0005, '地平线折射量 0.482°（而非 34′ = 0.567°）', '°');
      T.near(p.apparentAltitude, -0.436, 0.01, '日落时刻的视高度角为 −0.436°', '°');
      T.row(['日落几何高度角', p.altitude.toFixed(4) + '°', '−0.8330°']);
      T.row(['日落视高度角', p.apparentAltitude.toFixed(4) + '°', '−0.4361°']);
    });
  });

  T.suite('极区与边界情况', function () {

    T.test('特罗姆瑟夏至：极昼，无日出日落', function () {
      var ev = eventsForDate('2026-06-21', 69.6492, 18.9553, 'Europe/Oslo');
      T.isNull(ev.sunrise, '无日出');
      T.isNull(ev.sunset, '无日落');
      T.ok(S.position(ev.solarNoon, 69.6492, 18.9553).altitude > 0, '正午太阳在地平线之上');
    });

    T.test('特罗姆瑟冬至：极夜，无日出日落', function () {
      var ev = eventsForDate('2026-12-21', 69.6492, 18.9553, 'Europe/Oslo');
      T.isNull(ev.sunrise, '无日出');
      T.isNull(ev.sunset, '无日落');
      T.ok(S.position(ev.solarNoon, 69.6492, 18.9553).altitude < 0, '正午太阳仍在地平线之下');
    });

    T.test('雷克雅未克夏至：有日落但没有民用昏影终', function () {
      var ev = eventsForDate('2026-06-21', 64.1466, -21.9426, 'Atlantic/Reykjavik');
      T.notNull(ev.sunset, '有日落');
      T.isNull(ev.civilDusk, '太阳降不到 −6°，无民用昏影终');
      T.isNull(ev.nauticalDusk, '太阳降不到 −12°，无航海昏影终');
    });

    T.test('赤道与本初子午线：正午太阳接近天顶', function () {
      var ev = eventsForDate('2026-03-20', 0, 0, 'UTC');
      var alt = S.position(ev.solarNoon, 0, 0).altitude;
      T.ok(alt > 89, '春分赤道正午高度角 ' + alt.toFixed(2) + '°，接近 90°');
      T.near(Z.formatTime(ev.solarNoon, 'UTC').length, 5, 0, '时间格式为 HH:MM');
    });
  });

  T.suite('时区工具（Australia/Sydney 夏令时）', function () {

    T.test('夏令时结束：2026-04-05', function () {
      T.equal(Z.offsetMinutes(Z.localNoonMs(SYD_TZ, 2026, 4, 4), SYD_TZ), 660, '4 月 4 日仍为 UTC+11');
      T.equal(Z.offsetMinutes(Z.localNoonMs(SYD_TZ, 2026, 4, 5), SYD_TZ), 600, '4 月 5 日已为 UTC+10');
      var b = Z.dayBounds(SYD_TZ, 2026, 4, 5);
      T.equal(b.end - b.start, 25 * 3600000, '当天长 25 小时');
    });

    T.test('夏令时开始：2026-10-04', function () {
      T.equal(Z.offsetMinutes(Z.localNoonMs(SYD_TZ, 2026, 10, 3), SYD_TZ), 600, '10 月 3 日为 UTC+10');
      T.equal(Z.offsetMinutes(Z.localNoonMs(SYD_TZ, 2026, 10, 4), SYD_TZ), 660, '10 月 4 日为 UTC+11');
      var b = Z.dayBounds(SYD_TZ, 2026, 10, 4);
      T.equal(b.end - b.start, 23 * 3600000, '当天长 23 小时');
    });

    T.test('本地时刻往返转换', function () {
      var cases = [[2026, 6, 21, 17, 30], [2026, 12, 21, 20, 5], [2026, 1, 1, 0, 0], [2026, 10, 4, 23, 59]];
      for (var i = 0; i < cases.length; i++) {
        var c = cases[i];
        var ms = Z.zonedTimeToMs(SYD_TZ, c[0], c[1], c[2], c[3], c[4], 0);
        var want = Z.pad(c[3], 2) + ':' + Z.pad(c[4], 2);
        var got = Z.formatTime(ms, SYD_TZ);
        var key = Z.pad(c[0], 4) + '-' + Z.pad(c[1], 2) + '-' + Z.pad(c[2], 2);
        T.equal(got, want, key + ' ' + want + ' 往返一致');
        T.equal(Z.dateKey(ms, SYD_TZ), key, key + ' 日期一致');
      }
    });

    T.test('不存在与重复的本地时刻不会抛错', function () {
      // 2026-10-04 02:30 在悉尼不存在（时钟从 02:00 跳到 03:00）
      var gap = Z.zonedTimeToMs(SYD_TZ, 2026, 10, 4, 2, 30, 0);
      T.ok(isFinite(gap), '跳变缺口内的时刻返回了有限值：' + Z.formatTime(gap, SYD_TZ));
      // 2026-04-05 02:30 在悉尼出现两次
      var dup = Z.zonedTimeToMs(SYD_TZ, 2026, 4, 5, 2, 30, 0);
      T.ok(isFinite(dup), '重复区间内的时刻返回了有限值：' + Z.formatTime(dup, SYD_TZ));
    });

    T.test('时区名校验与偏移量标签', function () {
      T.ok(Z.isValidZone('Australia/Sydney'), '接受 Australia/Sydney');
      T.ok(Z.isValidZone('UTC'), '接受 UTC');
      T.ok(!Z.isValidZone('Mars/Olympus'), '拒绝不存在的时区');
      T.ok(!Z.isValidZone(''), '拒绝空字符串');
      T.equal(Z.offsetLabel(Z.localNoonMs(SYD_TZ, 2026, 6, 21), SYD_TZ), '+10:00', '冬季标签 +10:00');
      T.equal(Z.offsetLabel(Z.localNoonMs(SYD_TZ, 2026, 12, 21), SYD_TZ), '+11:00', '夏季标签 +11:00');
      T.ok(Z.isValidZone(Z.deviceZone()), '设备时区可用：' + Z.deviceZone());
    });

    T.test('跨时区规划：人在别处也能算对悉尼的时刻', function () {
      // 无论设备时区是什么，只要指定 Australia/Sydney，结果都应一致。
      var a = eventsForDate('2026-06-21', NOAA_LAT, NOAA_LON, SYD_TZ);
      var d = Z.parseDateKey('2026-06-21');
      var b = S.events(Z.zonedTimeToMs(SYD_TZ, d.year, d.month, d.day, 12, 0, 0), NOAA_LAT, NOAA_LON);
      T.equal(a.sunset, b.sunset, '两种锚点算出同一个日落时刻');
      T.equal(Z.formatTime(a.sunset, SYD_TZ), '16:53', '悉尼当地显示为 16:53');
      T.equal(Z.formatTime(a.sunset, 'UTC'), '06:53', '同一时刻的 UTC 显示为 06:53');
    });
  });

  T.suite('接口契约', function () {
    T.test('position() 返回完整字段且 Date 与毫秒等价', function () {
      var ms = Date.UTC(2026, 5, 21, 7, 0, 0);
      var a = S.position(ms, NOAA_LAT, NOAA_LON);
      var b = S.position(new Date(ms), NOAA_LAT, NOAA_LON);
      var fields = ['altitude', 'apparentAltitude', 'azimuth', 'declination',
                    'hourAngle', 'equationOfTime', 'julianDay', 'ms'];
      for (var i = 0; i < fields.length; i++) {
        T.ok(typeof a[fields[i]] === 'number' && isFinite(a[fields[i]]),
             'position().' + fields[i] + ' 为有限数值');
        T.equal(a[fields[i]], b[fields[i]], 'Date 与毫秒入参结果一致：' + fields[i]);
      }
      T.ok(a.azimuth >= 0 && a.azimuth < 360, '方位角落在 0–360 区间');
    });

    T.test('儒略日换算', function () {
      T.near(S._internal.toJulian(Date.UTC(2000, 0, 1, 12, 0, 0)), 2451545.0, 1e-6, 'J2000.0 = 2451545.0');
      T.near(S._internal.toJulian(0), 2440587.5, 1e-6, 'Unix 元年 = JD 2440587.5');
      T.near(S._internal.julianCentury(2451545.0), 0, 1e-12, 'J2000 处儒略世纪数为 0');
    });

    T.test('altitudeCrossing() 可求任意高度角（蓝调区间边界用）', function () {
      var d = Z.parseDateKey('2026-06-21');
      var noonRef = Z.localNoonMs(SYD_TZ, d.year, d.month, d.day);
      var minus9 = S.altitudeCrossing(noonRef, NOAA_LAT, NOAA_LON, -9, false);
      T.notNull(minus9, '求得 −9° 下降穿越时刻');
      T.near(S.position(minus9, NOAA_LAT, NOAA_LON).altitude, -9, 0.001, '该时刻高度角为 −9°', '°');
      var ev = S.events(noonRef, NOAA_LAT, NOAA_LON);
      T.ok(minus9 > ev.civilDusk && minus9 < ev.nauticalDusk, '−9° 落在民用与航海昏影终之间');
      T.row(['−9° 昏影', Z.formatTime(minus9, SYD_TZ, true),
             '介于 ' + Z.formatTime(ev.civilDusk, SYD_TZ) + ' 与 ' + Z.formatTime(ev.nauticalDusk, SYD_TZ)]);
    });
  });
}());
