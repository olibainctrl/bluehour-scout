/*!
 * 蓝调勘景仪 Blue Hour Scout — js/core/tz.js
 *
 * IANA 时区工具。只用浏览器内置的 Intl API，不引入任何时区库。
 * 每条勘景记录存一个 IANA 时区名（默认取设备时区），这样人在国外
 * 也能正确规划悉尼的拍摄；夏令时切换由 Intl 处理。
 *
 * 约定：内部一律是 UTC epoch 毫秒，时区只影响"这一天是哪一天"和显示。
 */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  root.BH = root.BH || {};
  root.BH.Tz = api;
  if (typeof module === 'object' && module.exports) { module.exports = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var MS_MIN = 60000;
  var partsCache = Object.create(null);

  function partsFormatter(tz) {
    if (!partsCache[tz]) {
      partsCache[tz] = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    }
    return partsCache[tz];
  }

  /** 设备当前时区的 IANA 名称，取不到时退回 UTC。 */
  function deviceZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch (e) {
      return 'UTC';
    }
  }

  /** 时区名是否被当前浏览器支持。 */
  function isValidZone(tz) {
    if (!tz || typeof tz !== 'string') { return false; }
    try { partsFormatter(tz); return true; } catch (e) { return false; }
  }

  /**
   * 把某一时刻拆成该时区的日历字段。
   * @returns {{year:number,month:number,day:number,hour:number,minute:number,second:number}}
   */
  function zonedParts(ms, tz) {
    var parts = partsFormatter(tz).formatToParts(new Date(ms));
    var out = {};
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      if (p.type !== 'literal') { out[p.type] = parseInt(p.value, 10); }
    }
    // 某些实现在午夜会给出 24
    if (out.hour === 24) { out.hour = 0; }
    return {
      year: out.year, month: out.month, day: out.day,
      hour: out.hour, minute: out.minute, second: out.second
    };
  }

  /** 该时刻在该时区的 UTC 偏移量，分钟（东为正）。 */
  function offsetMinutes(ms, tz) {
    var p = zonedParts(ms, tz);
    var asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
    return Math.round((asUTC - Math.floor(ms / 1000) * 1000) / MS_MIN);
  }

  /**
   * 把某时区的本地日历时刻转成 UTC epoch 毫秒。
   * 两趟修正：第一趟用猜测时刻的偏移量，第二趟用落点自身的偏移量，
   * 这样跨夏令时切换也是对的。
   */
  function zonedTimeToMs(tz, year, month, day, hour, minute, second) {
    var guess = Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0);
    var off = offsetMinutes(guess, tz);
    var ms = guess - off * MS_MIN;
    var off2 = offsetMinutes(ms, tz);
    if (off2 !== off) { ms = guess - off2 * MS_MIN; }
    return ms;
  }

  /** 该时区该日期的当地 12:00，作为太阳事件计算的锚点。 */
  function localNoonMs(tz, year, month, day) {
    return zonedTimeToMs(tz, year, month, day, 12, 0, 0);
  }

  /** "YYYY-MM-DD" → {year,month,day}，解析失败返回 null。 */
  function parseDateKey(key) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || ''));
    if (!m) { return null; }
    return { year: +m[1], month: +m[2], day: +m[3] };
  }

  /** 某时刻在该时区的 "YYYY-MM-DD"。 */
  function dateKey(ms, tz) {
    var p = zonedParts(ms, tz);
    return pad(p.year, 4) + '-' + pad(p.month, 2) + '-' + pad(p.day, 2);
  }

  function pad(n, w) {
    var s = String(Math.abs(n));
    while (s.length < w) { s = '0' + s; }
    return (n < 0 ? '-' : '') + s;
  }

  /** "HH:MM"；withSeconds 为 true 时 "HH:MM:SS"。 */
  function formatTime(ms, tz, withSeconds) {
    var p = zonedParts(ms, tz);
    var s = pad(p.hour, 2) + ':' + pad(p.minute, 2);
    return withSeconds ? s + ':' + pad(p.second, 2) : s;
  }

  /** "+11:00" 这样的偏移量标签。 */
  function offsetLabel(ms, tz) {
    var off = offsetMinutes(ms, tz);
    var sign = off < 0 ? '-' : '+';
    off = Math.abs(off);
    return sign + pad(Math.floor(off / 60), 2) + ':' + pad(off % 60, 2);
  }

  /** 该时区该日的 00:00 与次日 00:00（处理 23 或 25 小时的夏令时日）。 */
  function dayBounds(tz, year, month, day) {
    var start = zonedTimeToMs(tz, year, month, day, 0, 0, 0);
    var next = new Date(Date.UTC(year, month - 1, day + 1));
    var end = zonedTimeToMs(tz, next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), 0, 0, 0);
    return { start: start, end: end };
  }

  return {
    deviceZone: deviceZone,
    isValidZone: isValidZone,
    zonedParts: zonedParts,
    offsetMinutes: offsetMinutes,
    offsetLabel: offsetLabel,
    zonedTimeToMs: zonedTimeToMs,
    localNoonMs: localNoonMs,
    dateKey: dateKey,
    parseDateKey: parseDateKey,
    formatTime: formatTime,
    dayBounds: dayBounds,
    pad: pad
  };
});
