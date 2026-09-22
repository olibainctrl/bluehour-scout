/*!
 * 蓝调勘景仪 Blue Hour Scout — js/data/weather.js
 *
 * 唯一联网的地方：Open-Meteo 的 forecast 接口，免费、不需要 API key。
 *
 * 时间口径用 timezone=UTC + timeformat=unixtime，拿到的是干净的 epoch 秒。
 * 蓝调窗口本来就是 epoch 毫秒，两边直接对齐，不需要解析任何时区字符串。
 *
 * 每次成功拉取都写进 IndexedDB。断网时回落到缓存，并把获取时间一起交给界面，
 * 让人知道自己看的是什么时候的数据。
 */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  root.BH = root.BH || {};
  root.BH.Weather = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var ENDPOINT = 'https://api.open-meteo.com/v1/forecast';
  var HOURLY = 'cloud_cover_low,cloud_cover_mid,cloud_cover_high,' +
               'precipitation_probability,temperature_2m';
  var FORECAST_DAYS = 8;     // 要 7 天，多拉一天留余量：当地傍晚可能落在 UTC 的次日
  var TIMEOUT_MS = 15000;
  var FRESH_MS = 30 * 60000; // 半小时内的缓存直接用，不重复打接口

  function DB() { return root.BH.DB; }

  /** 缓存键按坐标取到千分之一度（约 100 米），同一机位复用同一份。 */
  function cacheKey(lat, lon) {
    return 'om:' + lat.toFixed(3) + ',' + lon.toFixed(3);
  }

  function buildURL(lat, lon) {
    return ENDPOINT +
      '?latitude=' + encodeURIComponent(lat.toFixed(4)) +
      '&longitude=' + encodeURIComponent(lon.toFixed(4)) +
      '&hourly=' + HOURLY +
      '&timezone=UTC&timeformat=unixtime' +
      '&forecast_days=' + FORECAST_DAYS;
  }

  /** 校验接口返回的形状，坏数据不写进缓存。 */
  function validate(json) {
    if (!json || !json.hourly || !Array.isArray(json.hourly.time) ||
        !json.hourly.time.length) {
      return '接口返回的数据里没有逐小时序列';
    }
    var n = json.hourly.time.length;
    var missing = root.BH.Cloud.FIELDS.filter(function (f) {
      return !Array.isArray(json.hourly[f]) || json.hourly[f].length !== n;
    });
    if (missing.length) { return '缺少字段：' + missing.join('、'); }
    return null;
  }

  function fetchFresh(lat, lon) {
    return new Promise(function (resolve, reject) {
      if (typeof fetch !== 'function') { reject(new Error('这个浏览器不支持 fetch')); return; }

      var done = false;
      var timer = setTimeout(function () {
        if (done) { return; }
        done = true;
        reject(new Error('请求超时，可能没有网络'));
      }, TIMEOUT_MS);

      fetch(buildURL(lat, lon), { cache: 'no-store' }).then(function (res) {
        if (!res.ok) { throw new Error('接口返回 ' + res.status); }
        return res.json();
      }).then(function (json) {
        if (done) { return; }
        clearTimeout(timer);
        done = true;
        var bad = validate(json);
        if (bad) { reject(new Error(bad)); return; }
        resolve({
          key: cacheKey(lat, lon),
          lat: lat, lon: lon,
          hourly: json.hourly,
          units: json.hourly_units || null,
          elevation: json.elevation,
          fetchedAt: Date.now()
        });
      }).catch(function (e) {
        if (done) { return; }
        clearTimeout(timer);
        done = true;
        reject(e);
      });
    });
  }

  function readCache(lat, lon) {
    return DB().get('weather', cacheKey(lat, lon)).then(function (row) {
      return row || null;
    }).catch(function () { return null; });
  }

  function writeCache(payload) {
    return DB().put('weather', payload).catch(function () { /* 写不进去也不该拦住显示 */ });
  }

  /**
   * 取数据。默认先看缓存够不够新，不够就联网；联网失败回落到缓存。
   * @param {Object} [opts] opts.force 为 true 时跳过新鲜度判断，强制联网
   * @returns {Promise<{hourly, fetchedAt, cached:boolean, stale:boolean, error:string|null}>}
   */
  function load(lat, lon, opts) {
    opts = opts || {};
    return readCache(lat, lon).then(function (cached) {
      var fresh = cached && (Date.now() - cached.fetchedAt < FRESH_MS);
      if (fresh && !opts.force) {
        return {
          hourly: cached.hourly, fetchedAt: cached.fetchedAt,
          cached: true, stale: false, error: null
        };
      }
      return fetchFresh(lat, lon).then(function (payload) {
        return writeCache(payload).then(function () {
          return {
            hourly: payload.hourly, fetchedAt: payload.fetchedAt,
            cached: false, stale: false, error: null
          };
        });
      }).catch(function (e) {
        if (cached) {
          return {
            hourly: cached.hourly, fetchedAt: cached.fetchedAt,
            cached: true, stale: true,
            error: e && e.message ? e.message : String(e)
          };
        }
        return {
          hourly: null, fetchedAt: null, cached: false, stale: false,
          error: e && e.message ? e.message : String(e)
        };
      });
    });
  }

  return {
    ENDPOINT: ENDPOINT,
    FORECAST_DAYS: FORECAST_DAYS,
    FRESH_MS: FRESH_MS,
    cacheKey: cacheKey,
    buildURL: buildURL,
    validate: validate,
    load: load,
    fetchFresh: fetchFresh
  };
});
