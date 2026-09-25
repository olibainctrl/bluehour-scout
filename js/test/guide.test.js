/*!
 * 蓝调勘景仪 Blue Hour Scout — js/test/guide.test.js
 *
 * 使用方法和声明两页。两件事：
 *   1. 灯泡按钮从各页面跳到使用方法里对应的那一步；
 *   2. 声明页里引用的数（BH.Guide.CLAIMS）和代码的实际表现一致——
 *      说明写的和算的对不上，比没有说明更糟。
 * 各算法测试里另有几条同类检查（NOAA / GA 最大差、WMM 偏差）。
 */
(function () {
  'use strict';

  var T = BH.Test;
  var S = BH.Solar, Z = BH.Tz, E = BH.Exposure;
  var GU = BH.Guide;
  var C = GU.CLAIMS;
  var LAT = -33.8599, LON = 151.2009, TZ = 'Australia/Sydney';

  function eachDay2026(fn) {
    for (var d = 0; d < 365; d++) {
      var dt = new Date(Date.UTC(2026, 0, 1) + d * 86400000);
      fn(Z.localNoonMs(TZ, dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate()));
    }
  }

  function stepIds() {
    var ids = [];
    GU.GUIDE.forEach(function (sec) { sec.steps.forEach(function (st) { ids.push(st.id); }); });
    return ids;
  }

  T.suite('说明页：灯泡跳转', function () {

    T.test('各页面对应到使用方法里的哪一步', function () {
      [
        ['/', null], ['/rec/r_1', 'record'], ['/rec/r_1/s/place', 'place'],
        ['/rec/r_1/s/heading', 'heading'], ['/rec/r_1/s/notes', 'notes'],
        ['/rec/r_1/horizon', 'horizon'], ['/rec/r_1/timeline', 'timeline'],
        ['/rec/r_1/weather', 'weather'], ['/settings', 'settings'],
        ['/guide', null], ['/statement', null], ['/rec/r_1/s/bogus', 'record'], ['', null]
      ].forEach(function (c) {
        T.equal(GU.sectionFor(c[0]), c[1], (c[0] || '（空）') + ' → ' + c[1]);
      });
    });

    T.test('跳转目标在使用方法里都存在，步骤 id 不重复', function () {
      var ids = stepIds();
      ['record', 'place', 'heading', 'notes', 'horizon', 'timeline', 'weather', 'settings']
        .forEach(function (id) { T.ok(ids.indexOf(id) >= 0, id + ' 有对应的步骤'); });
      var seen = {}, dup = [];
      ids.forEach(function (id) { if (seen[id]) { dup.push(id); } seen[id] = true; });
      T.equal(dup.length, 0, '没有重复的 id' + (dup.length ? '：' + dup.join('、') : ''));
    });
  });

  T.suite('说明页：声明里的数和代码一致', function () {

    T.test('蓝调窗口时长（悉尼 2026 全年，默认区间）', function () {
      var blue = BH.Settings.defaults().blueRange;
      var lo = Infinity, hi = -Infinity;
      eachDay2026(function (noon) {
        var a = S.apparentAltitudeCrossing(noon, LAT, LON, blue.upper, false);
        var b = S.apparentAltitudeCrossing(noon, LAT, LON, blue.lower, false);
        var m = (b - a) / 60000;
        if (m < lo) { lo = m; }
        if (m > hi) { hi = m; }
      });
      T.ok(Math.round(lo) >= C.blueMinutes[0] && Math.round(hi) <= C.blueMinutes[1],
           '实际 ' + lo.toFixed(1) + '–' + hi.toFixed(1) + ' 分钟，声明写 ' +
           C.blueMinutes[0] + '–' + C.blueMinutes[1]);
    });

    T.test('太阳落到天际线高度时的下降速度，以及天际线 1° 对应几分钟', function () {
      // 在常见遮挡的高度上量（+0.5° 到 +10°），不在 0° 量：
      // NOAA 折射模型在地平线以下变化很快，那里的速度偏大，和遮挡判定无关
      var lo = Infinity, hi = -Infinity;
      eachDay2026(function (noon) {
        [0.5, 1, 2, 3, 5, 8, 10].forEach(function (h) {
          var t = S.apparentAltitudeCrossing(noon, LAT, LON, h, false);
          var r = S.position(t - 30000, LAT, LON).apparentAltitude -
                  S.position(t + 30000, LAT, LON).apparentAltitude;
          if (r < lo) { lo = r; }
          if (r > hi) { hi = r; }
        });
      });
      T.ok(lo >= C.sunsetRate[0] - 0.005 && hi <= C.sunsetRate[1] + 0.005,
           '每分钟降 ' + lo.toFixed(3) + '–' + hi.toFixed(3) + '°，声明写 ' + C.sunsetRate.join('–'));
      T.ok(Math.round(1 / hi) >= C.minutesPerDegree[0] && Math.round(1 / lo) <= C.minutesPerDegree[1],
           '1° ≈ ' + (1 / hi).toFixed(2) + '–' + (1 / lo).toFixed(2) + ' 分钟，声明写 ' +
           C.minutesPerDegree.join('–'));
      var limb = 0.267 / ((lo + hi) / 2);
      T.ok(Math.abs(limb - C.limbMinutes) < 0.25,
           '日面半径 0.267° 对应 ' + limb.toFixed(2) + ' 分钟，声明写约 ' + C.limbMinutes);
    });

    T.test('蓝调窗口里环境 EV 每分钟的变化，以及 1 档对应几分钟', function () {
      var lo = Infinity, hi = -Infinity;
      eachDay2026(function (noon) {
        var a = S.apparentAltitudeCrossing(noon, LAT, LON, 0, false);
        var b = S.apparentAltitudeCrossing(noon, LAT, LON, -9, false);
        for (var t = a; t + 60000 <= b; t += 60000) {
          var r = E.baseEV100(S.position(t, LAT, LON).apparentAltitude) -
                  E.baseEV100(S.position(t + 60000, LAT, LON).apparentAltitude);
          if (r < lo) { lo = r; }
          if (r > hi) { hi = r; }
        }
      });
      T.ok(Math.round(1 / hi) >= C.minutesPerEV[0] && Math.round(1 / lo) <= C.minutesPerEV[1],
           '1 档 ≈ ' + (1 / hi).toFixed(2) + '–' + (1 / lo).toFixed(2) + ' 分钟，声明写 ' +
           C.minutesPerEV.join('–'));
      T.ok(lo >= C.evPerMinute[0] - 0.005 && hi <= C.evPerMinute[1] + 0.005,
           '每分钟暗 ' + lo.toFixed(3) + '–' + hi.toFixed(3) + ' 档，声明写 ' + C.evPerMinute.join('–'));
    });

    T.test('天文日落时视高度角的口径差折算成 EV', function () {
      var ev = S.events(Z.localNoonMs(TZ, 2026, 9, 23), LAT, LON);
      var app = S.position(ev.sunset, LAT, LON).apparentAltitude;
      var d = E.baseEV100(0) - E.baseEV100(app);
      T.near(d, C.refractionEV, 0.01, '视高度角 ' + app.toFixed(3) + '° 对应 ' + d.toFixed(3) + ' EV', 'EV');
    });
  });

  T.suite('说明页：页面渲染', function () {

    var hasDOM = typeof document !== 'undefined' && document && typeof document.createElement === 'function';

    T.test('使用方法：从某一页进来时，那一步标成当前页面', function () {
      if (!hasDOM) { T.ok(true, '命令行没有 DOM，跳过'); return; }
      var view = document.createElement('div');
      GU.renderGuide({ section: 'timeline' }, view);
      var here = view.querySelectorAll('.g-step.here');
      T.equal(here.length, 1, '只有一步被标出来');
      T.equal(here[0] && here[0].id, 'g-timeline', '标的是光线时间轴');
      T.ok(/当前页面/.test(here[0].textContent), '带「当前页面」标签');
      var holes = [].filter.call(view.querySelectorAll('[data-k]'), function (s) {
        return !/\d/.test(s.textContent);
      });
      T.equal(holes.length, 0, '文案里引用的常量都填上了数');
      T.equal(view.querySelectorAll('.g-step').length, stepIds().length, '每一步都渲染了');
    });

    T.test('使用方法：直接打开时从头开始，没有标记', function () {
      if (!hasDOM) { T.ok(true, '命令行没有 DOM，跳过'); return; }
      var view = document.createElement('div');
      GU.renderGuide({}, view);
      T.equal(view.querySelectorAll('.g-step.here').length, 0, '没有标记');
    });

    T.test('声明：锚点表从代码读，引用的数都在', function () {
      if (!hasDOM) { T.ok(true, '命令行没有 DOM，跳过'); return; }
      var view = document.createElement('div');
      GU.renderStatement({}, view);
      var text = view.textContent;
      T.ok(E.EV_ANCHORS.every(function (a) { return text.indexOf(a[1].toFixed(1).replace('-', '−')) >= 0; }),
           'EV 锚点全部出现在表里');
      T.ok(E.CCT_ANCHORS.every(function (a) { return text.indexOf(a[1] + ' K') >= 0; }), '色温锚点全部出现');
      T.ok(text.indexOf(C.gaMaxSec + ' 秒') >= 0, 'GA 最大差');
      T.ok(text.indexOf(C.noaaNoonMaxSec + ' 秒') >= 0, 'NOAA 正午最大差');
      T.ok(text.indexOf(BH.Cloud.LOW_GOOD + '%') >= 0, '云量阈值从代码读');
      T.ok(view.querySelectorAll('details.fold.doc').length >= 10, '每个算法一节');
      T.ok(!/undefined|NaN/.test(text), '没有 undefined / NaN 漏出来');
    });
  });
})();
