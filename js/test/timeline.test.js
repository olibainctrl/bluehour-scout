/*!
 * 蓝调勘景仪 Blue Hour Scout — js/test/timeline.test.js
 * 分钟级光线时间轴。
 */
(function () {
  'use strict';

  var T = BH.Test;
  var TL = BH.Timeline;
  var S = BH.Solar;
  var H = BH.Horizon;
  var Z = BH.Tz;
  var E = BH.Exposure;

  var TZ = 'Australia/Sydney';
  var LAT = -33.8599, LON = 151.2009;
  var DATE = '2026-06-21';     // 悉尼冬至

  function flatHorizon(v) {
    var p = H.empty();
    for (var i = 0; i < 36; i++) { p[i] = v; }
    return p;
  }

  /** 平地 + 西侧（260°–320°）一片指定高度的遮挡 */
  function westWall(height) {
    var p = flatHorizon(0.5);
    for (var i = 26; i <= 32; i++) { p[i] = height; }
    return p;
  }

  function rec(horizon) {
    return { id: 'A', lat: LAT, lon: LON, tz: TZ, horizon: horizon || H.empty() };
  }

  function settings(over) {
    var s = {
      camera: { isoLow: 400, isoHigh: 3200, fps: 24, shutterAngle: 180 },
      lenses: [{ name: 'nFD 50 F1.4', maxAperture: 1.4 }],
      selectedLens: 0,
      blueRange: { upper: 0, lower: -9 },
      lights: [],
      setups: null
    };
    if (over) { Object.keys(over).forEach(function (k) { s[k] = over[k]; }); }
    return s;
  }

  function build(horizon, over) {
    return TL.build({ rec: rec(horizon), dateKey: DATE, settings: settings(over), calib: null });
  }

  T.suite('时间轴：范围与结构', function () {

    T.test('从日落前 40 分钟到航海暮光结束', function () {
      var r = build(westWall(3));
      T.ok(r.ok, '构建成功');
      var lead = (r.stats.astroSunsetMs - r.startMs) / 60000;
      T.ok(lead >= 40 && lead < 41, '起点在日落前 ' + lead.toFixed(1) + ' 分钟');
      var tail = Math.abs(r.endMs - r.stats.nauticalDuskMs) / 60000;
      T.ok(tail <= 1, '终点与航海昏影终相差 ' + tail.toFixed(2) + ' 分钟以内');
      T.ok(!r.tailFallback, '拿到了真正的航海昏影终，没有走兜底');
      T.row(['起点', Z.formatTime(r.startMs, TZ), '日落前 ' + lead.toFixed(0) + ' 分']);
      T.row(['天文日落', Z.formatTime(r.stats.astroSunsetMs, TZ, true), '']);
      T.row(['航海昏影终', Z.formatTime(r.stats.nauticalDuskMs, TZ), '']);
      T.row(['行数', r.rows.length, '']);
    });

    T.test('每行相隔正好一分钟，且都落在整分上', function () {
      var r = build(westWall(3));
      var bad = 0, offMinute = 0;
      for (var i = 0; i < r.rows.length; i++) {
        if (r.rows[i].ms % 60000 !== 0) { offMinute++; }
        if (i > 0 && r.rows[i].ms - r.rows[i - 1].ms !== 60000) { bad++; }
      }
      T.equal(offMinute, 0, '全部落在整分钟上');
      T.equal(bad, 0, '相邻两行间隔全部为 60 秒');
      T.ok(r.rows.length > 80 && r.rows.length < 130, '行数 ' + r.rows.length + ' 在合理区间');
    });

    T.test('高度角单调下降、方位角连续', function () {
      var r = build(westWall(3));
      var badAlt = 0, badAz = 0;
      for (var i = 1; i < r.rows.length; i++) {
        if (r.rows[i].altitude >= r.rows[i - 1].altitude) { badAlt++; }
        var d = Math.abs(r.rows[i].azimuth - r.rows[i - 1].azimuth);
        if (d > 2) { badAz++; }
      }
      T.equal(badAlt, 0, '高度角逐行下降');
      T.equal(badAz, 0, '方位角没有跳变');
    });

    T.test('每行的量都算出来了', function () {
      var r = build(westWall(3));
      var w = r.rows[Math.floor(r.rows.length / 2)];
      ['ms', 'altitude', 'azimuth', 'ev100', 'cct'].forEach(function (k) {
        T.ok(typeof w[k] === 'number' && isFinite(w[k]), k + ' 是有限数值');
      });
      T.ok(typeof w.occluded === 'boolean', 'occluded 是布尔值');
      T.ok(w.low && w.high && w.auto, '两档 ISO 和自动选择都有');
      T.ok(w.low.iso === 400 && w.high.iso === 3200, '两档 ISO 分别是 400 / 3200');
    });
  });

  T.suite('时间轴：真实日落（地平线遮挡）', function () {

    T.test('西侧 3° 遮挡让日落提前十几分钟', function () {
      var r = build(westWall(3));
      T.notNull(r.stats.realSunsetMs, '检测到了真实日落');
      T.ok(r.stats.realSunsetMs < r.stats.astroSunsetMs, '真实日落早于天文日落');
      var shift = r.stats.sunsetShiftMinutes;
      T.ok(shift > 12 && shift < 28, '提前 ' + shift.toFixed(1) + ' 分钟，落在 12–28 分的合理区间');
      T.ok(!r.stats.occludedFromStart, '不是一开始就被挡住');
      T.row(['天文日落', Z.formatTime(r.stats.astroSunsetMs, TZ, true), '']);
      T.row(['真实日落', Z.formatTime(r.stats.realSunsetMs, TZ, true), '提前 ' + shift.toFixed(1) + ' 分']);
    });

    T.test('遮挡越高日落越早', function () {
      var a = build(westWall(1)).stats.sunsetShiftMinutes;
      var b = build(westWall(3)).stats.sunsetShiftMinutes;
      var c = build(westWall(6)).stats.sunsetShiftMinutes;
      T.ok(a < b && b < c, '1°/3°/6° 遮挡分别提前 ' +
           a.toFixed(1) + ' / ' + b.toFixed(1) + ' / ' + c.toFixed(1) + ' 分钟');
    });

    T.test('恰好标出遮挡发生的那一分钟', function () {
      var r = build(westWall(3));
      var marked = r.rows.filter(function (w) { return w.isRealSunset; });
      T.equal(marked.length, 1, '只标一行');
      var i = r.stats.realSunsetIndex;
      T.ok(i > 0, '不是第一行');
      T.ok(!r.rows[i - 1].occluded, '前一分钟还没被挡');
      T.ok(r.rows[i].occluded, '这一分钟被挡住了');
      T.ok(r.stats.realSunsetMs >= r.rows[i - 1].ms && r.stats.realSunsetMs <= r.rows[i].ms,
           '插值出的时刻落在这两分钟之间');
    });

    T.test('没有剖面就不判真实日落', function () {
      var r = build(null);
      T.ok(!r.hasHorizon, 'hasHorizon 为 false');
      T.isNull(r.stats.realSunsetMs, '不给出真实日落');
      T.isNull(r.stats.sunsetShiftMinutes, '不给出提前量');
      T.equal(r.rows.filter(function (w) { return w.occluded; }).length, 0, '没有任何一行判为遮挡');
    });

    T.test('一开始就被挡住时明确标记', function () {
      var r = build(westWall(20));   // 西边 20° 的大山
      T.ok(r.stats.occludedFromStart, '标记为起点即被遮挡');
      T.isNull(r.stats.realSunsetMs, '遮挡发生在时间轴之前，不给具体时刻');
    });

    T.test('平地剖面下真实日落与天文日落只差一点点', function () {
      var r = build(flatHorizon(0));
      T.notNull(r.stats.realSunsetMs, '仍能检测到');
      // 视高度角 0 比天文日落早约 1.4 分钟（折射口径差，见 solar.js 说明）
      T.ok(Math.abs(r.stats.sunsetShiftMinutes) < 3,
           '平地时两者相差 ' + r.stats.sunsetShiftMinutes.toFixed(2) + ' 分钟');
    });
  });

  T.suite('时间轴：蓝调窗口', function () {

    T.test('窗口端点的高度角正好等于设定的上下界', function () {
      var r = build(westWall(3));
      T.near(S.position(r.stats.blueStart, LAT, LON).apparentAltitude, 0, 0.01,
             '窗口起点处视高度角为 0°', '°');
      T.near(S.position(r.stats.blueEnd, LAT, LON).apparentAltitude, -9, 0.01,
             '窗口终点处视高度角为 −9°', '°');
      T.near(r.stats.blueMinutes, (r.stats.blueEnd - r.stats.blueStart) / 60000, 1e-9,
             '分钟数就是两端之差', '分');
      T.row(['蓝调窗口', Z.formatTime(r.stats.blueStart, TZ) + '–' + Z.formatTime(r.stats.blueEnd, TZ),
             r.stats.blueMinutes.toFixed(1) + ' 分钟']);
    });

    T.test('逐行的 inBlue 标记和上下界一致', function () {
      var r = build(westWall(3));
      var bad = 0;
      for (var i = 0; i < r.rows.length; i++) {
        var w = r.rows[i];
        var should = w.altitude <= 0 && w.altitude >= -9;
        if (should !== w.inBlue) { bad++; }
      }
      T.equal(bad, 0, '每一行的标记都对');
      var n = r.rows.filter(function (w) { return w.inBlue; }).length;
      T.ok(Math.abs(n - r.stats.blueMinutes) <= 2,
           '标记为蓝调的行数 ' + n + ' 与窗口时长 ' + r.stats.blueMinutes.toFixed(1) + ' 分钟相符');
    });

    T.test('区间改宽，窗口就变长', function () {
      var narrow = build(westWall(3), { blueRange: { upper: -2, lower: -6 } }).stats.blueMinutes;
      var wide = build(westWall(3), { blueRange: { upper: 0, lower: -9 } }).stats.blueMinutes;
      var wider = build(westWall(3), { blueRange: { upper: 2, lower: -12 } }).stats.blueMinutes;
      T.ok(narrow < wide && wide < wider,
           '三档区间分别 ' + narrow.toFixed(1) + ' / ' + wide.toFixed(1) + ' / ' + wider.toFixed(1) + ' 分钟');
    });

    T.test('上下界写反了也能正常处理', function () {
      var a = build(westWall(3), { blueRange: { upper: -9, lower: 0 } });
      var b = build(westWall(3), { blueRange: { upper: 0, lower: -9 } });
      T.near(a.stats.blueMinutes, b.stats.blueMinutes, 1e-9, '自动交换上下界', '分');
      T.equal(a.stats.blueUpper, 0, '上界归位为 0');
      T.equal(a.stats.blueLower, -9, '下界归位为 −9');
    });
  });

  T.suite('时间轴：补光交叉点', function () {

    T.test('环境 EV 降到灯具 EV 的那一刻', function () {
      var r = build(westWall(3), { lights: [{ name: 'Pavotube', lux: 200, distance: 1 }] });
      T.equal(r.stats.lights.length, 1, '找到 1 个交叉点');
      var L = r.stats.lights[0];
      T.near(L.ev100, E.luxToEV100(200), 1e-12, '灯具 EV100 = log2(200/2.5)', '');
      var at = TL.indexForTime(r, L.ms);
      T.ok(at > 0, '落在时间轴范围内');
      T.ok(r.rows[at - 1].ev100 >= L.ev100 && r.rows[at + 1].ev100 <= L.ev100,
           '前一分钟环境光更亮、后一分钟更暗');
      T.row(['Pavotube 200lux', 'EV100 ' + L.ev100.toFixed(2), Z.formatTime(L.ms, TZ, true)]);
    });

    T.test('灯越亮，交叉点越早', function () {
      var bright = build(westWall(3), { lights: [{ name: 'A', lux: 2000, distance: 1 }] }).stats.lights[0];
      var dim = build(westWall(3), { lights: [{ name: 'B', lux: 50, distance: 1 }] }).stats.lights[0];
      T.ok(bright.ms < dim.ms, '2000lux 的交叉点 ' + Z.formatTime(bright.ms, TZ) +
           ' 早于 50lux 的 ' + Z.formatTime(dim.ms, TZ));
    });

    T.test('没填照度的灯具被跳过', function () {
      var r = build(westWall(3), { lights: [
        { name: '未填', lux: null, distance: 1 },
        { name: '已填', lux: 200, distance: 1 }
      ] });
      T.equal(r.stats.lights.length, 1, '只算填了照度的那一支');
      T.equal(r.stats.lights[0].name, '已填', '跳过了没填的');
    });

    T.test('太亮的灯在这段时间里没有交叉点', function () {
      var r = build(westWall(3), { lights: [{ name: '巨亮', lux: 1e7, distance: 1 }] });
      T.equal(r.stats.lights.length, 0, '环境光从头到尾都比它暗，不标交叉点');
    });
  });

  T.suite('时间轴：拍摄量核算', function () {

    T.test('setup 数合理时不报警', function () {
      var r = build(westWall(3), { setups: 4 });
      var b = r.stats.budget;
      T.equal(b.setups, 4, '4 个 setup');
      T.near(b.perSetup, r.stats.blueMinutes / 4, 1e-9, '每个 setup 的平均时间', '分');
      T.ok(b.ok, '每个 ' + b.perSetup.toFixed(1) + ' 分钟，不低于 8 分钟');
      T.equal(b.cut, 0, '不需要削减');
    });

    T.test('setup 太多时给出警告和建议削减数', function () {
      var r = build(westWall(3), { setups: 9 });
      var b = r.stats.budget;
      T.ok(!b.ok, '每个只有 ' + b.perSetup.toFixed(1) + ' 分钟，低于 8 分钟门槛');
      T.equal(b.maxSetups, Math.floor(r.stats.blueMinutes / 8),
              '最多能排 ' + b.maxSetups + ' 个');
      T.equal(b.cut, 9 - b.maxSetups, '建议削减 ' + b.cut + ' 个');
      T.ok(b.cut > 0, '削减数为正');
      T.row(['9 个 setup', b.perSetup.toFixed(1) + ' 分/个', '建议减到 ' + b.maxSetups + ' 个']);
    });

    T.test('没填 setup 数时不给核算', function () {
      T.isNull(build(westWall(3), { setups: null }).stats.budget, '不做核算');
    });
  });

  T.suite('时间轴：错误与边界', function () {

    T.test('没有坐标时明确拒绝', function () {
      var r = TL.build({ rec: { lat: null, lon: null, tz: TZ, horizon: H.empty() },
                         dateKey: DATE, settings: settings() });
      T.ok(!r.ok, '构建失败');
      T.ok(/坐标/.test(r.error), '错误信息提到坐标：' + r.error);
    });

    T.test('日期格式不对时明确拒绝', function () {
      var r = TL.build({ rec: rec(), dateKey: '2026/6/21', settings: settings() });
      T.ok(!r.ok, '构建失败');
      T.ok(/日期/.test(r.error), '错误信息提到日期：' + r.error);
    });

    T.test('极昼时明确拒绝', function () {
      var r = TL.build({
        rec: { lat: 69.6492, lon: 18.9553, tz: 'Europe/Oslo', horizon: H.empty() },
        dateKey: '2026-06-21', settings: settings()
      });
      T.ok(!r.ok, '特罗姆瑟夏至构建失败');
      T.ok(/极昼|极夜|日落/.test(r.error), '错误信息说明原因：' + r.error);
    });

    T.test('拿不到航海暮光时走兜底', function () {
      // 雷克雅未克夏至：有日落，但太阳降不到 −12°
      var r = TL.build({
        rec: { lat: 64.1466, lon: -21.9426, tz: 'Atlantic/Reykjavik', horizon: H.empty() },
        dateKey: '2026-06-21', settings: settings()
      });
      T.ok(r.ok, '仍然能出时间轴');
      T.ok(r.tailFallback, '标记为走了兜底');
      T.isNull(r.stats.nauticalDuskMs, '确实没有航海昏影终');
      T.ok(r.rows.length > 100, '兜底后仍有 ' + r.rows.length + ' 行');
    });

    T.test('indexForTime', function () {
      var r = build(westWall(3));
      T.equal(TL.indexForTime(r, r.rows[0].ms), 0, '第一行');
      T.equal(TL.indexForTime(r, r.rows[10].ms), 10, '第 11 行');
      T.equal(TL.indexForTime(r, r.rows[0].ms - 60000), -1, '早于范围返回 −1');
      T.equal(TL.indexForTime(r, r.endMs + 600000), -1, '晚于范围返回 −1');
      T.equal(TL.indexForTime(r, r.rows[5].ms + 20000), 5, '落在某一分钟内归到该行');
    });

    T.test('crossingBetween 的插值', function () {
      var rows = [{ ms: 0, v: 10 }, { ms: 60000, v: 8 }, { ms: 120000, v: 6 }];
      T.near(TL.crossingBetween(rows, 'v', 9, true), 30000, 1e-9, '9 落在前两行中点', 'ms');
      T.near(TL.crossingBetween(rows, 'v', 7, true), 90000, 1e-9, '7 落在后两行中点', 'ms');
      T.isNull(TL.crossingBetween(rows, 'v', 20, true), '超出范围返回 null');
      T.isNull(TL.crossingBetween(rows, 'v', 1, true), '低于范围返回 null');
    });
  });

  T.suite('时间轴：档位与色温的越界标注', function () {

    T.test('超出常用档位表时标注而不是静默夹住', function () {
      var r = build(westWall(3));
      var first = r.rows[0];
      T.ok(first.high.over, '起点处 ISO3200 需要的光圈超出 T22，已标注 over');
      T.ok(first.high.n > 22, '精确值 T' + first.high.n.toFixed(1) + ' 确实大于 22');
      var last = r.rows[r.rows.length - 1];
      T.ok(last.low.under, '终点处 ISO400 需要的光圈小于 T1，已标注 under');
      T.ok(last.low.n < 1, '精确值 T' + last.low.n.toFixed(2) + ' 确实小于 1');
    });

    T.test('0° 以上的色温标为超出模型范围', function () {
      var r = build(westWall(3));
      var above = r.rows.filter(function (w) { return w.altitude > 0; });
      var below = r.rows.filter(function (w) { return w.altitude <= 0; });
      T.ok(above.length > 0 && below.length > 0, '两边都有行');
      T.equal(above.filter(function (w) { return w.cctInRange; }).length, 0,
              '0° 以上全部标为超出范围');
      T.equal(below.filter(function (w) { return !w.cctInRange; }).length, 0,
              '0° 以下全部在范围内');
      T.equal(above[0].cct, 3200, '超出范围时返回顶端锚点 3200K，不是外推出的荒谬值');
    });
  });
}());
