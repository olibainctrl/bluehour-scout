/*!
 * 蓝调勘景仪 Blue Hour Scout — sw.js
 *
 * 离线缓存。除天气接口外，断网时全部功能可用。
 *
 * 策略：**网络优先，缓存兜底**（带 2 秒超时）
 *
 * 早先用的是 stale-while-revalidate（先给缓存、后台更新）。那个策略有个
 * 要命的毛病：浏览器只在 sw.js 自身字节变化时才认为 SW 有更新，所以只改
 * 业务代码、不动 sw.js 的那种发布，既不会弹「有新版本」，也会继续把旧代码
 * 喂给用户——改完推上去，打开还是旧的，还以为没生效。
 *
 * 现在改成：有网就一定拿最新的；网络失败或 2 秒没响应才退回缓存。
 * 这些文件都只有几十 KB，多一个往返换"改完就生效"，值。
 * 完全断网时 fetch 会立刻拒绝，不会真等 2 秒，所以离线体验不受影响。
 *
 * 跨源请求（Open-Meteo）直接放行，不进 SW 缓存；天气数据由页面自己存进
 * IndexedDB，这样断网时能连"获取时间"一起显示。
 *
 * 路径全部用相对写法，部署到 GitHub Pages 子路径不用改。
 */
'use strict';

var VERSION = 'v13';
var CACHE = 'bluehour-' + VERSION;
var NET_TIMEOUT = 2000;   // 网络多久没响应就先用缓存顶上

var ASSETS = [
  './',
  './index.html',
  './test.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/core/solar.js',
  './js/core/tz.js',
  './js/core/horizon.js',
  './js/core/exposure.js',
  './js/core/timeline.js',
  './js/core/cloud.js',
  './js/data/db.js',
  './js/data/records.js',
  './js/data/settings.js',
  './js/data/calibration.js',
  './js/data/weather.js',
  './js/ui/theme.js',
  './js/ui/app.js',
  './js/ui/compass.js',
  './js/ui/viewfinder.js',
  './js/ui/horizon-ui.js',
  './js/ui/scout.js',
  './js/ui/timeline-ui.js',
  './js/ui/settings-ui.js',
  './js/ui/weather-ui.js',
  './js/ui/compass-sim.js',
  './js/test/harness.js',
  './js/test/solar.test.js',
  './js/test/horizon.test.js',
  './js/test/compass.test.js',
  './js/test/ui-geometry.test.js',
  './js/test/viewfinder.test.js',
  './js/test/exposure.test.js',
  './js/test/timeline.test.js',
  './js/test/cloud.test.js',
  './js/test/edge.test.js',
  './js/test/theme.test.js',
  './js/test/ui.test.js',
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
    })
    // 这里**不**调 skipWaiting：新 SW 先进入 waiting，由页面弹「有新版本 / 刷新」
    // 让用户自己决定什么时候切。现场可能正在转圈采集剖面，突然重载会把
    // 罗盘和相机权限一起丢掉。
    // 首次安装时本来就没有旧 SW 占位，会直接激活，不受影响。
    // 反正业务代码走网络优先，每次打开都是最新的，SW 自身晚一点换没代价。
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

/**
 * 强制回源校验的请求。
 *
 * 这一步是必须的，缺了它"网络优先"就是假的：SW 里的 fetch(req) **仍然会命中
 * 浏览器自己的 HTTP 缓存**。GitHub Pages 会发 Cache-Control: max-age=600，
 * python 的 http.server 只发 Last-Modified 让浏览器启用启发式新鲜度——
 * 两种情况下 fetch 都可能压根不碰网络，于是改完推上去打开还是旧的。
 *
 * cache:'no-cache' 强制带条件头回源。文件没变时服务器回 304，很便宜。
 */
function revalidating(req) {
  try {
    // 从 URL 重新构造：navigate 模式的 Request 不能用 new Request(req, init) 克隆
    return new Request(req.url, {
      cache: 'no-cache',
      credentials: 'same-origin',
      redirect: 'follow'
    });
  } catch (e) {
    return req;
  }
}

/**
 * 网络优先。拿到就用并顺手更新缓存；失败或超时则退回缓存。
 * 超时退回缓存之后，那次 fetch 仍会继续跑完并刷新缓存，所以下一次必然是新的。
 */
function networkFirst(req, fallbackPath) {
  return new Promise(function (resolve) {
    var settled = false;

    function finish(res) {
      if (settled || !res) { return; }
      settled = true;
      resolve(res);
    }

    function fromCache() {
      return caches.match(req).then(function (hit) {
        if (hit) { return hit; }
        return fallbackPath ? caches.match(fallbackPath) : null;
      });
    }

    var timer = setTimeout(function () {
      if (settled) { return; }
      fromCache().then(finish);
    }, NET_TIMEOUT);

    fetch(revalidating(req)).then(function (res) {
      clearTimeout(timer);
      if (res && res.status === 200 && res.type === 'basic') {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      finish(res);
    }).catch(function () {
      clearTimeout(timer);
      fromCache().then(function (hit) {
        if (hit) { finish(hit); return; }
        // 既没网也没缓存，只能如实报错
        finish(new Response('离线且无缓存', {
          status: 504, statusText: 'Offline',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' }
        }));
      });
    });
  });
}

self.addEventListener('fetch', function (ev) {
  var req = ev.request;
  if (req.method !== 'GET') { return; }

  var url;
  try { url = new URL(req.url); } catch (e) { return; }

  // 跨源（天气接口）不拦截
  if (url.origin !== self.location.origin) { return; }

  if (req.mode === 'navigate') {
    ev.respondWith(networkFirst(req, './index.html'));
    return;
  }
  ev.respondWith(networkFirst(req, null));
});

// 页面要求立刻启用新版本
self.addEventListener('message', function (ev) {
  if (ev.data === 'skipWaiting') { self.skipWaiting(); }
});
