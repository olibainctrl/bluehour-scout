/*!
 * 蓝调勘景仪 Blue Hour Scout — js/core/cloud.js
 *
 * 云量决策的纯计算部分：把逐小时预报按蓝调窗口加权平均，再给结论。
 * 不碰网络、不碰 DOM。拉数据和缓存在 data/weather.js。
 *
 * 加权方式：每个小时桶 [h, h+1h) 与蓝调窗口的**重叠时长**就是它的权重。
 * 窗口通常只有四十来分钟，往往横跨两个整点，简单取整点值会偏；
 * 按重叠时长加权才对得上真正会拍的那段时间。
 */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  root.BH = root.BH || {};
  root.BH.Cloud = api;
  if (typeof module === 'object' && module.exports) { module.exports = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var HOUR = 3600000;

  /** 结论阈值。主要看低云——低云才是真正挡光、把天空压成一片灰的那层。 */
  var LOW_GOOD = 20;      // 低于这个百分比算「好」
  var LOW_MAYBE = 50;     // 到这个百分比为止算「可能」，再高就「不建议」
  var HIGH_TEXTURE = 30;  // 高云到这个百分比就值得提一句"可能增加天空层次"

  var FIELDS = ['cloud_cover_low', 'cloud_cover_mid', 'cloud_cover_high',
                'precipitation_probability', 'temperature_2m'];

  function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }

  /**
   * 把逐小时数据在 [startMs, endMs) 上按重叠时长加权平均。
   *
   * @param {Object} hourly Open-Meteo 的 hourly 对象，time 为 unixtime（秒）
   * @returns {Object} 每个字段一个均值（无数据为 null），外加 coverage
   *                   coverage = 有数据的时长 / 窗口总时长，0–1
   */
  function aggregate(hourly, startMs, endMs) {
    var out = { coverage: 0, hours: 0 };
    FIELDS.forEach(function (f) { out[f] = null; });

    if (!hourly || !hourly.time || !hourly.time.length) { return out; }
    var span = endMs - startMs;
    if (!(span > 0)) { return out; }

    var sums = {}, weights = {};
    FIELDS.forEach(function (f) { sums[f] = 0; weights[f] = 0; });
    var covered = 0, touched = 0;

    for (var i = 0; i < hourly.time.length; i++) {
      var h0 = hourly.time[i] * 1000;
      var h1 = h0 + HOUR;
      var lo = Math.max(h0, startMs), hi = Math.min(h1, endMs);
      var w = hi - lo;
      if (w <= 0) { continue; }
      touched++;
      var anyField = false;
      FIELDS.forEach(function (f) {
        var v = hourly[f] ? num(hourly[f][i]) : null;
        if (v === null) { return; }
        sums[f] += v * w;
        weights[f] += w;
        anyField = true;
      });
      if (anyField) { covered += w; }
    }

    FIELDS.forEach(function (f) {
      out[f] = weights[f] > 0 ? sums[f] / weights[f] : null;
    });
    out.coverage = covered / span;
    out.hours = touched;
    return out;
  }

  /**
   * 结论。主要看低云，高云高时额外提示。
   * @returns {{level:string, label:string, note:string|null}}
   *          level 为 good | maybe | bad | none
   */
  function verdict(lowPct, highPct) {
    var note = (num(highPct) !== null && highPct >= HIGH_TEXTURE)
      ? '高云可能增加天空层次' : null;
    if (num(lowPct) === null) {
      return { level: 'none', label: '无数据', note: note };
    }
    if (lowPct < LOW_GOOD) { return { level: 'good', label: '好', note: note }; }
    if (lowPct <= LOW_MAYBE) { return { level: 'maybe', label: '可能', note: note }; }
    return { level: 'bad', label: '不建议', note: note };
  }

  /**
   * 逐日汇总。
   * @param {Object} hourly
   * @param {Array} windows [{dateKey, startMs, endMs}]，startMs 为 null 表示当天没有窗口
   */
  function buildRows(hourly, windows) {
    return (windows || []).map(function (w) {
      if (w.startMs === null || w.endMs === null) {
        return {
          dateKey: w.dateKey, startMs: null, endMs: null,
          low: null, mid: null, high: null, precip: null, temp: null,
          coverage: 0, hours: 0,
          verdict: { level: 'none', label: '无窗口', note: null }
        };
      }
      var a = aggregate(hourly, w.startMs, w.endMs);
      return {
        dateKey: w.dateKey,
        startMs: w.startMs,
        endMs: w.endMs,
        low: a.cloud_cover_low,
        mid: a.cloud_cover_mid,
        high: a.cloud_cover_high,
        precip: a.precipitation_probability,
        temp: a.temperature_2m,
        coverage: a.coverage,
        hours: a.hours,
        verdict: verdict(a.cloud_cover_low, a.cloud_cover_high)
      };
    });
  }

  return {
    LOW_GOOD: LOW_GOOD,
    LOW_MAYBE: LOW_MAYBE,
    HIGH_TEXTURE: HIGH_TEXTURE,
    FIELDS: FIELDS,
    aggregate: aggregate,
    verdict: verdict,
    buildRows: buildRows
  };
});
