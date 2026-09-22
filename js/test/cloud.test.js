/*!
 * 蓝调勘景仪 Blue Hour Scout — js/test/cloud.test.js
 * 云量加权平均与结论判定，以及 Open-Meteo 请求的纯逻辑部分。
 */
(function () {
  'use strict';

  var T = BH.Test;
  var C = BH.Cloud;
  var W = BH.Weather;

  var H = 3600000;
  var T0 = Date.UTC(2026, 8, 22, 0, 0, 0);   // 2026-09-22 00:00 UTC

  /** 造一段逐小时数据。vals 为每小时的 [低,中,高,雨,温] */
  function hourly(vals) {
    var o = { time: [] };
    C.FIELDS.forEach(function (f) { o[f] = []; });
    vals.forEach(function (v, i) {
      o.time.push((T0 + i * H) / 1000);
      o.cloud_cover_low.push(v[0]);
      o.cloud_cover_mid.push(v[1]);
      o.cloud_cover_high.push(v[2]);
      o.precipitation_probability.push(v[3]);
      o.temperature_2m.push(v[4]);
    });
    return o;
  }

  T.suite('云量：按重叠时长加权', function () {

    T.test('窗口完全落在一个小时内就取该小时的值', function () {
      var h = hourly([[10, 20, 30, 5, 15], [80, 0, 0, 50, 12]]);
      var a = C.aggregate(h, T0 + 10 * 60000, T0 + 50 * 60000);
      T.near(a.cloud_cover_low, 10, 1e-9, '低云取第 1 小时的 10', '%');
      T.near(a.cloud_cover_mid, 20, 1e-9, '中云 20', '%');
      T.near(a.cloud_cover_high, 30, 1e-9, '高云 30', '%');
      T.near(a.temperature_2m, 15, 1e-9, '气温 15', '°C');
      T.near(a.coverage, 1, 1e-9, '窗口被完全覆盖', '');
      T.equal(a.hours, 1, '只碰到 1 个小时桶');
    });

    T.test('跨两个整点时按重叠时长加权，不是简单平均', function () {
      var h = hourly([[0, 0, 0, 0, 10], [100, 100, 100, 100, 20]]);
      // 00:45–01:15：前一小时占 15 分钟，后一小时占 15 分钟 → 50/50
      var even = C.aggregate(h, T0 + 45 * 60000, T0 + 75 * 60000);
      T.near(even.cloud_cover_low, 50, 1e-9, '各占一半时得 50', '%');
      // 00:45–01:45：前 15 分钟 + 后 45 分钟 → 25/75
      var skew = C.aggregate(h, T0 + 45 * 60000, T0 + 105 * 60000);
      T.near(skew.cloud_cover_low, 75, 1e-9, '15:45 分钟的权重得 75，不是 50', '%');
      T.near(skew.temperature_2m, 17.5, 1e-9, '气温同样加权', '°C');
      T.row(['00:45–01:15', even.cloud_cover_low.toFixed(1) + '%', '50%']);
      T.row(['00:45–01:45', skew.cloud_cover_low.toFixed(1) + '%', '75%（不是 50）']);
    });

    T.test('跨三个整点', function () {
      var h = hourly([[0, 0, 0, 0, 0], [60, 0, 0, 0, 0], [120, 0, 0, 0, 0]]);
      // 00:30–02:30：各 30 / 60 / 30 分钟 → (0*30 + 60*60 + 120*30)/120 = 60
      var a = C.aggregate(h, T0 + 30 * 60000, T0 + 150 * 60000);
      T.near(a.cloud_cover_low, 60, 1e-9, '三段加权得 60', '%');
      T.equal(a.hours, 3, '碰到 3 个小时桶');
      T.near(a.coverage, 1, 1e-9, '完全覆盖', '');
    });

    T.test('预报没覆盖到时 coverage 反映出来', function () {
      var h = hourly([[10, 0, 0, 0, 0], [20, 0, 0, 0, 0]]);
      // 窗口 01:30–03:30，只有 01:30–02:00 有数据
      var a = C.aggregate(h, T0 + 90 * 60000, T0 + 210 * 60000);
      T.near(a.coverage, 0.25, 1e-9, '只覆盖了四分之一', '');
      T.near(a.cloud_cover_low, 20, 1e-9, '用有数据的那半小时', '%');
      // 完全没有交集
      var none = C.aggregate(h, T0 + 10 * H, T0 + 11 * H);
      T.equal(none.coverage, 0, '完全没覆盖时 coverage 为 0');
      T.isNull(none.cloud_cover_low, '没数据时返回 null');
      T.equal(none.hours, 0, '没碰到任何小时桶');
    });

    T.test('单个字段为 null 时只跳过该字段', function () {
      var h = hourly([[10, null, 30, 5, 15], [20, 40, null, 15, 25]]);
      var a = C.aggregate(h, T0, T0 + 2 * H);
      T.near(a.cloud_cover_low, 15, 1e-9, '低云两小时都有，平均 15', '%');
      T.near(a.cloud_cover_mid, 40, 1e-9, '中云只有第 2 小时有值', '%');
      T.near(a.cloud_cover_high, 30, 1e-9, '高云只有第 1 小时有值', '%');
      T.near(a.coverage, 1, 1e-9, '仍算完全覆盖（每小时至少有一个字段）', '');
    });

    T.test('脏输入不抛错', function () {
      T.isNull(C.aggregate(null, T0, T0 + H).cloud_cover_low, 'hourly 为 null');
      T.isNull(C.aggregate({}, T0, T0 + H).cloud_cover_low, 'hourly 为空对象');
      T.isNull(C.aggregate(hourly([[10, 0, 0, 0, 0]]), T0, T0).cloud_cover_low, '零长度窗口');
      T.isNull(C.aggregate(hourly([[10, 0, 0, 0, 0]]), T0 + H, T0).cloud_cover_low, '起止颠倒');
      var nan = C.aggregate(hourly([[NaN, 0, 0, 0, 0]]), T0, T0 + H);
      T.isNull(nan.cloud_cover_low, 'NaN 被当作无数据');
    });
  });

  T.suite('云量：结论判定', function () {

    T.test('阈值边界', function () {
      var cases = [
        [0, 'good', '好'], [19.9, 'good', '好'],
        [20, 'maybe', '可能'], [35, 'maybe', '可能'], [50, 'maybe', '可能'],
        [50.1, 'bad', '不建议'], [100, 'bad', '不建议']
      ];
      cases.forEach(function (c) {
        var v = C.verdict(c[0], 0);
        T.equal(v.level, c[1], '低云 ' + c[0] + '% → ' + c[1]);
        T.equal(v.label, c[2], '标签为「' + c[2] + '」');
        T.row(['低云 ' + c[0] + '%', v.label, c[1]]);
      });
    });

    T.test('没有低云数据时给「无数据」', function () {
      var v = C.verdict(null, 40);
      T.equal(v.level, 'none', '级别为 none');
      T.equal(v.label, '无数据', '标签为无数据');
      T.ok(v.note, '高云的提示仍然给出');
    });

    T.test('高云够高时额外标注', function () {
      T.isNull(C.verdict(10, 0).note, '高云 0% 不标注');
      T.isNull(C.verdict(10, 29.9).note, '高云 29.9% 不标注');
      T.ok(C.verdict(10, 30).note, '高云 30% 开始标注');
      T.ok(C.verdict(10, 80).note, '高云 80% 标注');
      T.ok(/层次/.test(C.verdict(10, 50).note), '提示语提到"层次"：' + C.verdict(10, 50).note);
      T.isNull(C.verdict(10, null).note, '高云无数据时不标注');
    });

    T.test('低云好且高云高 —— 最想要的那种天', function () {
      var v = C.verdict(5, 55);
      T.equal(v.label, '好', '结论是好');
      T.ok(v.note, '同时提示高云可能增加层次');
    });
  });

  T.suite('云量：逐日汇总', function () {

    T.test('正常的一天', function () {
      var h = hourly([[10, 20, 40, 5, 15], [10, 20, 40, 5, 15], [10, 20, 40, 5, 15]]);
      var rows = C.buildRows(h, [
        { dateKey: '2026-09-22', startMs: T0 + 30 * 60000, endMs: T0 + 90 * 60000 }
      ]);
      T.equal(rows.length, 1, '一行');
      var r = rows[0];
      T.near(r.low, 10, 1e-9, '低云 10%', '%');
      T.near(r.mid, 20, 1e-9, '中云 20%', '%');
      T.near(r.high, 40, 1e-9, '高云 40%', '%');
      T.near(r.precip, 5, 1e-9, '降水 5%', '%');
      T.near(r.temp, 15, 1e-9, '气温 15°C', '°C');
      T.equal(r.verdict.label, '好', '结论为好');
      T.ok(r.verdict.note, '高云 40% 有层次提示');
    });

    T.test('没有蓝调窗口的那一天', function () {
      var rows = C.buildRows(hourly([[10, 0, 0, 0, 0]]),
        [{ dateKey: '2026-06-21', startMs: null, endMs: null }]);
      T.equal(rows[0].verdict.label, '无窗口', '标为无窗口');
      T.isNull(rows[0].low, '不给云量');
      T.equal(rows[0].coverage, 0, 'coverage 为 0');
    });

    T.test('空输入', function () {
      T.equal(C.buildRows(null, null).length, 0, '两个都为 null 时返回空数组');
      T.equal(C.buildRows(hourly([]), []).length, 0, '没有窗口时返回空数组');
    });
  });

  T.suite('天气接口：请求与校验（不联网）', function () {

    T.test('缓存键按坐标取到千分之一度', function () {
      T.equal(W.cacheKey(-33.8599, 151.2009), 'om:-33.860,151.201', '四舍五入到 3 位小数');
      T.equal(W.cacheKey(-33.8599, 151.2009), W.cacheKey(-33.8601, 151.2011),
              '相距约 20 米的两点共用一份缓存');
      T.ok(W.cacheKey(-33.86, 151.2) !== W.cacheKey(-33.87, 151.2),
           '差 0.01 度（约 1 公里）则是不同的缓存');
    });

    T.test('URL 包含全部必需参数', function () {
      var u = W.buildURL(-33.8599, 151.2009);
      ['latitude=-33.8599', 'longitude=151.2009', 'cloud_cover_low', 'cloud_cover_mid',
       'cloud_cover_high', 'precipitation_probability', 'temperature_2m',
       'timezone=UTC', 'timeformat=unixtime'].forEach(function (frag) {
        T.ok(u.indexOf(frag) >= 0, 'URL 含 ' + frag);
      });
      T.ok(u.indexOf('forecast_days=' + W.FORECAST_DAYS) >= 0,
           '拉 ' + W.FORECAST_DAYS + ' 天（比需要的 7 天多一天留余量）');
      T.ok(u.indexOf('api.open-meteo.com') >= 0, '打的是 Open-Meteo');
      T.ok(u.indexOf('key') < 0 && u.indexOf('token') < 0, 'URL 里没有任何密钥');
    });

    T.test('返回数据的形状校验', function () {
      T.notNull(W.validate(null), 'null 被拒');
      T.notNull(W.validate({}), '空对象被拒');
      T.notNull(W.validate({ hourly: {} }), '没有 time 被拒');
      T.notNull(W.validate({ hourly: { time: [] } }), '空 time 被拒');
      T.notNull(W.validate({ hourly: { time: [1, 2] } }), '缺字段被拒');
      var short = { hourly: { time: [1, 2] } };
      C.FIELDS.forEach(function (f) { short.hourly[f] = [1]; });
      T.notNull(W.validate(short), '字段长度对不上被拒');
      var good = { hourly: { time: [1, 2] } };
      C.FIELDS.forEach(function (f) { good.hourly[f] = [1, 2]; });
      T.isNull(W.validate(good), '完整数据通过');
    });
  });
}());
