/*!
 * 蓝调勘景仪 Blue Hour Scout — js/ui/compass-sim.js
 *
 * 罗盘模拟器。**只在网址带 ?sim=1 时启用**，平时完全不干活。
 *
 * 为什么需要它：Mac 上没有磁力计，真值测不了，但采样交互（自动落点、
 * 停留进度、扇区填充、转多快才跟得上）是可以也应该在电脑上先验一遍的。
 *
 * 做法是直接往 window 派发合成的 deviceorientation 事件，
 * compass.js 一行都不用改——它收到的和真机上一模一样。
 */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  root.BH = root.BH || {};
  root.BH.CompassSim = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var HZ = 30;
  var JITTER_AZ = 0.8;      // 模拟磁罗盘抖动，顺便验证平滑逻辑
  var JITTER_EL = 0.4;

  var timer = null, panel = null;
  var az = 0, el = 2, running = true;
  var sweeping = false, sweepSpeed = 12;   // 度/秒
  var lastTick = 0;

  function norm360(a) { a = a % 360; if (a < 0) { a += 360; } return a < 360 ? a : 0; }

  function enabled() {
    try { return /[?&]sim=1(?:&|$)/.test(root.location.search); } catch (e) { return false; }
  }

  /** 一条假天际线：西边一排高楼，东边开阔。自动扫的时候用。 */
  function fakeSkyline(a) {
    var e = 1.2 + 0.8 * Math.sin(a * Math.PI / 90);
    if (a >= 235 && a <= 315) { e += 9 * Math.exp(-Math.pow((a - 275) / 22, 2)); }
    if (a >= 55 && a <= 115) { e -= 0.9; }
    return e;
  }

  function fire(type, heading, elev) {
    var ev;
    try { ev = new Event(type); } catch (e) { return; }
    var props = {
      alpha: norm360(-heading),
      beta: 90 + elev,
      gamma: 0,
      absolute: true,
      webkitCompassHeading: heading,
      webkitCompassAccuracy: 8
    };
    Object.keys(props).forEach(function (k) {
      try { Object.defineProperty(ev, k, { value: props[k], configurable: true }); }
      catch (e) { ev[k] = props[k]; }
    });
    root.dispatchEvent(ev);
  }

  function tick() {
    if (!running) { return; }
    var now = Date.now();
    var dt = lastTick ? (now - lastTick) / 1000 : 0;
    lastTick = now;

    if (sweeping) {
      az = norm360(az + sweepSpeed * dt);
      el = fakeSkyline(az);
      syncInputs();
    }

    var h = norm360(az + (Math.random() - 0.5) * JITTER_AZ);
    var e = el + (Math.random() - 0.5) * JITTER_EL;

    // compass.js 只监听其中一个事件名，两个都派发不会重复计数
    fire('deviceorientation', h, e);
    fire('deviceorientationabsolute', h, e);

    if (readAz) { readAz.textContent = Math.round(az) + '°'; }
    if (readEl) { readEl.textContent = (el > 0 ? '+' : '') + el.toFixed(1) + '°'; }
  }

  var azInput = null, elInput = null, readAz = null, readEl = null, sweepBtn = null;

  function syncInputs() {
    if (azInput && document.activeElement !== azInput) { azInput.value = Math.round(az); }
    if (elInput && document.activeElement !== elInput) { elInput.value = el.toFixed(1); }
  }

  function build() {
    var A = root.BH.App;

    azInput = A.h('input', { type: 'range', min: 0, max: 359, step: 1, value: az,
                             style: 'width:100%;min-height:26px' });
    elInput = A.h('input', { type: 'range', min: -20, max: 40, step: 0.5, value: el,
                             style: 'width:100%;min-height:26px' });
    azInput.addEventListener('input', function () { sweeping = false; setSweepLabel(); az = +azInput.value; });
    elInput.addEventListener('input', function () { sweeping = false; setSweepLabel(); el = +elInput.value; });

    readAz = A.h('b', { style: 'color:#ffb340;font-family:var(--mono)', text: '0°' });
    readEl = A.h('b', { style: 'color:#ffb340;font-family:var(--mono)', text: '+0°' });

    sweepBtn = A.h('button', {
      class: 'btn sm primary', type: 'button', style: 'flex:1',
      on: { click: function () { sweeping = !sweeping; setSweepLabel(); } }
    }, '自动扫一圈');

    var speedSel = A.h('select', { style: 'min-height:34px;padding:4px 8px;font-size:13px' }, [
      A.h('option', { value: 6 }, '慢 6°/秒'),
      A.h('option', { value: 12, selected: true }, '中 12°/秒'),
      A.h('option', { value: 25 }, '快 25°/秒'),
      A.h('option', { value: 45 }, '很快 45°/秒')
    ]);
    speedSel.value = String(sweepSpeed);
    speedSel.addEventListener('change', function () { sweepSpeed = +speedSel.value; });

    panel = A.h('div', {
      id: 'compass-sim',
      style: 'position:fixed;left:8px;right:8px;bottom:calc(env(safe-area-inset-bottom) + 74px);' +
             'z-index:90;background:#12121a;border:1px solid #3a2f18;border-radius:12px;' +
             'padding:11px 13px;box-shadow:0 8px 28px rgba(0,0,0,.7);max-width:420px;margin:0 auto'
    }, [
      A.h('div', { style: 'display:flex;align-items:center;gap:8px;margin-bottom:9px' }, [
        A.h('span', { style: 'font-size:11px;letter-spacing:.08em;color:#e0533d;font-weight:600',
                      text: '罗盘模拟器' }),
        A.h('span', { style: 'font-size:11px;color:#6b6459;flex:1', text: '仅 ?sim=1 时出现' }),
        A.h('button', {
          class: 'btn sm ghost', type: 'button', style: 'min-height:28px;padding:0 9px',
          on: { click: function () { running = false; panel.remove(); } }
        }, '关闭')
      ]),
      A.h('div', { style: 'display:flex;gap:12px;font-size:12px;color:#9a9184;margin-bottom:6px' }, [
        A.h('span', null, ['方位 ', readAz]),
        A.h('span', null, ['仰角 ', readEl])
      ]),
      azInput,
      elInput,
      A.h('div', { style: 'display:flex;gap:8px;margin-top:9px' }, [sweepBtn, speedSel])
    ]);
    document.body.appendChild(panel);
    setSweepLabel();
  }

  function setSweepLabel() {
    if (sweepBtn) {
      sweepBtn.textContent = sweeping ? '停止' : '自动扫一圈';
      sweepBtn.className = 'btn sm ' + (sweeping ? 'danger' : 'primary');
    }
  }

  function activate() {
    if (!enabled() || timer) { return; }

    // 桌面浏览器上 requestPermission() 要么不存在、要么会被拒，
    // 这里直接短路掉，好让「启用罗盘」按钮在电脑上也能走通正常流程。
    var C = root.BH.Compass;
    if (C) {
      var realRequest = C.request;
      C.request = function () {
        if (root.console) { root.console.warn('[sim] 罗盘权限已被模拟器短路为 granted'); }
        return Promise.resolve('granted');
      };
      C._realRequest = realRequest;
    }

    build();
    lastTick = Date.now();
    timer = setInterval(tick, Math.round(1000 / HZ));
    if (root.console) {
      root.console.warn('[sim] 罗盘模拟器已启用。去掉网址里的 ?sim=1 即可关闭。');
    }
  }

  return {
    enabled: enabled,
    activate: activate,
    set: function (a, e) { sweeping = false; az = norm360(a); el = e; syncInputs(); },
    sweep: function (on, speed) { sweeping = !!on; if (speed) { sweepSpeed = speed; } setSweepLabel(); },
    stop: function () { running = false; if (timer) { clearInterval(timer); timer = null; } }
  };
});
