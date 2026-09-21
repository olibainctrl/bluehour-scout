/*!
 * 蓝调勘景仪 Blue Hour Scout — js/ui/compass.js
 *
 * 设备方向 → 瞄准方向（方位角 + 仰角）。
 *
 * 瞄准约定：**竖着举手机，像拍照一样用背面（后摄）对准目标**。
 * 瞄准轴 = 设备坐标系的 −z 轴。这么定有两个好处：
 *   1. 手机立起来（beta≈90°）时瞄的正好是水平方向，姿势自然；
 *   2. 瞄准轴固定在机身上，横握竖握都对，不需要屏幕方向补偿。
 *
 * iOS 的坑（都在这个文件里处理掉了）
 * ---------------------------------
 * 1. 必须 HTTPS。localhost 在 iOS 上不算安全上下文，和桌面浏览器不一样。
 * 2. iOS 13+ 必须先调 DeviceOrientationEvent.requestPermission()，
 *    而且**只能在用户手势的同步回调里**调，页面加载时调会直接抛 NotAllowedError。
 *    所以这个模块只暴露 request()，由界面上的「启用罗盘」按钮触发。
 * 3. iOS 的真北方位角在 event.webkitCompassHeading，不在 alpha；
 *    alpha 在 iOS 上是相对起始姿态的，不能当罗盘用。
 * 4. 权限被拒绝、设备没有磁力计、或者事件始终不来，都要能降级到手动输入。
 */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  root.BH = root.BH || {};
  root.BH.Compass = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var RAD = Math.PI / 180;
  var DEG = 180 / Math.PI;
  var SMOOTH_MS = 260;          // 平滑窗口
  var NO_DATA_MS = 2600;        // 多久收不到事件就判定"没有罗盘数据"

  var state = 'idle';           // idle | granted | denied | unsupported | insecure | nodata
  var listening = false;
  var handler = null;
  var onReading = null;
  var onState = null;
  var buffer = [];              // {t, sin, cos, elev, acc, absolute}
  var last = null;
  var eventName = null;
  var noDataTimer = null;
  var gotAny = false;

  // 保证结果落在 [0,360)，见 core/horizon.js 里的同名函数
  function norm360(a) {
    a = a % 360;
    if (a < 0) { a += 360; }
    return a < 360 ? a : 0;
  }

  // 能力探测一律包 try/catch：某些宿主（例如 macOS 的 JXA）会拦截
  // 全局对象上未定义属性的访问并抛错，而不是老实返回 undefined。
  function hasOrientationEvent() {
    try {
      return typeof root.DeviceOrientationEvent !== 'undefined' &&
             root.DeviceOrientationEvent !== null;
    } catch (e) { return false; }
  }

  /** iOS 13+ 才有这个静态方法。 */
  function needsPermission() {
    try {
      return hasOrientationEvent() &&
             typeof root.DeviceOrientationEvent.requestPermission === 'function';
    } catch (e) { return false; }
  }

  function isSecure() {
    try { return root.isSecureContext === true; } catch (e) { return false; }
  }

  function supported() { return hasOrientationEvent(); }

  /** 当前屏幕旋转角。瞄准轴不需要它，只用来提示用户把手机竖起来。 */
  function screenAngle() {
    try {
      if (root.screen && root.screen.orientation &&
          typeof root.screen.orientation.angle === 'number') {
        return root.screen.orientation.angle;
      }
      if (typeof root.orientation === 'number') { return norm360(root.orientation); }
    } catch (e) { /* 探测失败按 0 处理 */ }
    return 0;
  }

  /**
   * 由 W3C DeviceOrientation 的 alpha/beta/gamma 求后摄瞄准轴在
   * 东-北-天世界坐标系里的单位向量。
   *
   * 旋转矩阵按规范的 Z-X'-Y'' 内旋定义，设备 −z 轴即为后摄朝向，
   * 取旋转矩阵第三列取负即可。
   */
  function cameraAxis(alpha, beta, gamma) {
    var cA = Math.cos(alpha * RAD), sA = Math.sin(alpha * RAD);
    var cB = Math.cos(beta * RAD), sB = Math.sin(beta * RAD);
    var cG = Math.cos(gamma * RAD), sG = Math.sin(gamma * RAD);
    return {
      e: -(cA * sG + cG * sA * sB),    // 东
      n: -(sA * sG - cA * cG * sB),    // 北
      u: -(cB * cG)                    // 天
    };
  }

  /**
   * 仰角。只取瞄准轴的"天"分量，与 alpha 无关，
   * 所以就算罗盘方位不可用（比如没磁力计），俯仰依然是准的。
   * 同时自动补偿了横滚（gamma），手机歪一点不影响读数。
   */
  function elevationOf(beta, gamma) {
    var u = -(Math.cos(beta * RAD) * Math.cos(gamma * RAD));
    if (u > 1) { u = 1; } else if (u < -1) { u = -1; }
    return Math.asin(u) * DEG;
  }

  /** 从事件里取真北方位角，取不到返回 null。 */
  function headingOf(ev) {
    // iOS：webkitCompassHeading 就是真北方位角，顺时针 0–360。
    // 负值（−1）表示罗盘还没校准好，这时候不能用。
    if (typeof ev.webkitCompassHeading === 'number' && ev.webkitCompassHeading >= 0) {
      return { heading: norm360(ev.webkitCompassHeading), absolute: true, src: 'ios' };
    }
    // 其它平台：只认绝对方向。非绝对的 alpha 是相对起始姿态的，当罗盘用会错得离谱。
    if (ev.absolute === true && typeof ev.alpha === 'number' &&
        typeof ev.beta === 'number' && typeof ev.gamma === 'number') {
      var v = cameraAxis(ev.alpha, ev.beta, ev.gamma);
      var horiz = Math.sqrt(v.e * v.e + v.n * v.n);
      // 手机几乎指天或指地时水平分量趋零，方位角没有意义
      if (horiz < 0.02) { return { heading: null, absolute: true, src: 'w3c' }; }
      return { heading: norm360(Math.atan2(v.e, v.n) * DEG), absolute: true, src: 'w3c' };
    }
    return null;
  }

  function accuracyOf(ev) {
    if (typeof ev.webkitCompassAccuracy === 'number') {
      return ev.webkitCompassAccuracy < 0 ? null : ev.webkitCompassAccuracy;
    }
    return null;
  }

  function push(t, heading, elev, acc, absolute) {
    if (heading !== null) {
      buffer.push({
        t: t,
        sin: Math.sin(heading * RAD),
        cos: Math.cos(heading * RAD),
        elev: elev, acc: acc, absolute: absolute
      });
    } else {
      buffer.push({ t: t, sin: null, cos: null, elev: elev, acc: acc, absolute: absolute });
    }
    while (buffer.length && t - buffer[0].t > SMOOTH_MS) { buffer.shift(); }
  }

  /** 方位角按单位向量求均值，避免 359°/1° 之间平均出 180° 的经典错误。 */
  function smoothed() {
    if (!buffer.length) { return null; }
    var s = 0, c = 0, n = 0, e = 0, en = 0, acc = null, absolute = false;
    for (var i = 0; i < buffer.length; i++) {
      var b = buffer[i];
      if (b.sin !== null) { s += b.sin; c += b.cos; n++; }
      if (b.elev !== null) { e += b.elev; en++; }
      if (b.acc !== null && (acc === null || b.acc > acc)) { acc = b.acc; }
      if (b.absolute) { absolute = true; }
    }
    return {
      heading: n ? norm360(Math.atan2(s / n, c / n) * DEG) : null,
      elevation: en ? e / en : null,
      accuracy: acc,
      absolute: absolute,
      samples: buffer.length
    };
  }

  function setState(s) {
    if (state === s) { return; }
    state = s;
    if (onState) { onState(s); }
  }

  function makeHandler() {
    return function (ev) {
      if (typeof ev.beta !== 'number' || typeof ev.gamma !== 'number') { return; }
      gotAny = true;
      if (noDataTimer) { clearTimeout(noDataTimer); noDataTimer = null; }
      if (state !== 'granted') { setState('granted'); }

      var h = headingOf(ev);
      var elev = elevationOf(ev.beta, ev.gamma);
      push(Date.now(), h ? h.heading : null, elev, accuracyOf(ev), h ? h.absolute : false);

      var sm = smoothed();
      last = {
        heading: sm.heading,
        elevation: sm.elevation,
        accuracy: sm.accuracy,
        absolute: sm.absolute,
        source: h ? h.src : null,
        screenAngle: screenAngle(),
        raw: { alpha: ev.alpha, beta: ev.beta, gamma: ev.gamma },
        at: Date.now()
      };
      if (onReading) { onReading(last); }
    };
  }

  /**
   * 申请权限。**必须在用户手势（点击）的回调里同步调用**，
   * 否则 iOS 会抛 NotAllowedError 或者静默失败。
   * @returns {Promise<string>} 'granted' | 'denied' | 'unsupported' | 'insecure'
   */
  function request() {
    if (!supported()) { setState('unsupported'); return Promise.resolve('unsupported'); }
    if (!isSecure()) { setState('insecure'); return Promise.resolve('insecure'); }
    if (!needsPermission()) { setState('granted'); return Promise.resolve('granted'); }

    var p;
    try {
      p = root.DeviceOrientationEvent.requestPermission();
    } catch (e) {
      // 不在用户手势里调就会走到这里
      setState('denied');
      return Promise.resolve('denied');
    }
    return Promise.resolve(p).then(function (res) {
      var s = res === 'granted' ? 'granted' : 'denied';
      setState(s);
      return s;
    }).catch(function () {
      setState('denied');
      return 'denied';
    });
  }

  /**
   * 开始监听。会优先用 deviceorientationabsolute（Android 上才有真北），
   * 没有就退回 deviceorientation。
   * @param {function} readingCb 每次有新读数时调用
   * @param {function} [stateCb] 状态变化时调用
   */
  function start(readingCb, stateCb) {
    onReading = readingCb || null;
    onState = stateCb || null;
    if (listening) { return; }
    if (!supported()) { setState('unsupported'); return; }

    handler = makeHandler();
    gotAny = false;
    buffer = [];

    // Android 上 deviceorientationabsolute 才是相对地磁北的；
    // iOS 没有这个事件，会落到 deviceorientation + webkitCompassHeading。
    eventName = 'deviceorientation';
    try {
      if ('ondeviceorientationabsolute' in root) { eventName = 'deviceorientationabsolute'; }
    } catch (e) { /* 探测失败就用普通事件 */ }
    root.addEventListener(eventName, handler, true);
    listening = true;

    noDataTimer = setTimeout(function () {
      if (!gotAny) {
        // 绝对方向事件没来，再试一次普通的
        if (eventName === 'deviceorientationabsolute') {
          root.removeEventListener(eventName, handler, true);
          eventName = 'deviceorientation';
          root.addEventListener(eventName, handler, true);
          noDataTimer = setTimeout(function () {
            if (!gotAny) { setState('nodata'); }
          }, NO_DATA_MS);
        } else {
          setState('nodata');
        }
      }
    }, NO_DATA_MS);
  }

  function stop() {
    if (handler && eventName) { root.removeEventListener(eventName, handler, true); }
    if (noDataTimer) { clearTimeout(noDataTimer); noDataTimer = null; }
    listening = false;
    handler = null;
    onReading = null;
    onState = null;
    buffer = [];
  }

  /** 人话版的状态说明，界面直接显示。 */
  function explain(s) {
    switch (s || state) {
      case 'granted': return '罗盘已启用';
      case 'denied': return '罗盘权限被拒绝。Safari 里可在「设置 → Safari → 网站设置」重新允许，或者直接手动输入方位角。';
      case 'unsupported': return '这台设备不支持方向传感器，请手动输入方位角。';
      case 'insecure': return '罗盘需要 HTTPS。iOS 上 localhost 也不算，请用 GitHub Pages 或带证书的本地服务访问。';
      case 'nodata': return '收不到罗盘数据。可能是设备没有磁力计，或者需要手持画个 8 字校准一下。也可以手动输入。';
      default: return '罗盘尚未启用';
    }
  }

  return {
    supported: supported,
    needsPermission: needsPermission,
    isSecure: isSecure,
    state: function () { return state; },
    screenAngle: screenAngle,
    request: request,
    start: start,
    stop: stop,
    reading: function () { return last; },
    explain: explain,
    // 导出供测试使用
    _cameraAxis: cameraAxis,
    _elevationOf: elevationOf,
    _norm360: norm360
  };
});
