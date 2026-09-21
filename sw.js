/*!
 * 蓝调勘景仪 Blue Hour Scout — sw.js
 *
 * 离线缓存。除天气接口外，断网时全部功能可用。
 *
 * 策略：
 *  - 同源静态资源：stale-while-revalidate（先给缓存，后台顺手更新）
 *  - 导航请求：网络优先，失败回落到缓存的 index.html
 *  - 跨源请求（Open-Meteo）：直接放行，不进 SW 缓存；
 *    天气数据由页面自己存进 IndexedDB，这样断网时能连"获取时间"一起显示
 *
 * 路径全部用相对写法，部署到 GitHub Pages 子路径不用改。
 */
'use strict';

var VERSION = 'v4';
var CACHE = 'bluehour-' + VERSION;

var ASSETS = [
  './',
  './index.html',
  './test.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/core/solar.js',
  './js/core/tz.js',
  './js/core/horizon.js',
  './js/data/db.js',
  './js/data/records.js',
  './js/ui/app.js',
  './js/ui/compass.js',
  './js/ui/horizon-ui.js',
  './js/ui/scout.js',
  './js/ui/compass-sim.js',
  './js/test/harness.js',
  './js/test/solar.test.js',
  './js/test/horizon.test.js',
  './js/test/compass.test.js',
  './js/test/ui-geometry.test.js',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', function (ev) {
  ev.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // 逐个 add，单个文件失败不至于让整次安装挂掉
      return Promise.all(ASSETS.map(function (url) {
        return cache.add(new Request(url, { cache: 'reload' })).catch(function () { return null; });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (ev) {
  ev.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (ev) {
  var req = ev.request;
  if (req.method !== 'GET') { return; }

  var url;
  try { url = new URL(req.url); } catch (e) { return; }

  // 跨源（天气接口）不拦截
  if (url.origin !== self.location.origin) { return; }

  if (req.mode === 'navigate') {
    ev.respondWith(
      fetch(req).catch(function () {
        return caches.match('./index.html').then(function (r) {
          return r || caches.match('./');
        });
      })
    );
    return;
  }

  ev.respondWith(
    caches.match(req).then(function (cached) {
      var net = fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === 'basic') {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return cached; });
      return cached || net;
    })
  );
});

// 页面要求立刻启用新版本
self.addEventListener('message', function (ev) {
  if (ev.data === 'skipWaiting') { self.skipWaiting(); }
});
