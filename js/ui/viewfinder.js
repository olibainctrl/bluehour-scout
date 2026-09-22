/*!
 * 蓝调勘景仪 Blue Hour Scout — js/ui/viewfinder.js
 *
 * 采集剖面时的相机取景器。画面正中一个准星，把它压在天际线上再读数。
 *
 * 为什么准星是精确的，不是近似
 * ----------------------------
 * 采样的瞄准轴定义为设备坐标系的 −z 轴，也就是**后摄光轴**；
 * 而预览画面的正中心就是光轴方向。两者天然重合，所以中心准星指向的
 * 正是 compass.js 算出仰角的那个方向，不存在换算误差。
 *
 * 画面用 object-fit:cover 填充容器，cover 是**居中**裁切，
 * 所以无论容器比例如何，画面中心仍然是光轴。
 *
 * 后摄物理上偏离机身中心约一两厘米，但天际线在几百米到几公里外，
 * 这点视差折算成角度远小于 0.01°，可以忽略。
 *
 * iOS 注意事项
 * -----------
 * - 必须 HTTPS（和罗盘一样）
 * - <video> 必须带 playsinline，否则 iOS 会强制全屏播放
 * - 必须 muted 才能自动播放
 * - 加到主屏幕的独立窗口里 getUserMedia 需要 iOS 14.3+；更早的版本只有
 *   Safari 里能用。拿不到相机时整个功能降级，采集本身照常可用。
 */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  root.BH = root.BH || {};
  root.BH.Viewfinder = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var RING_R = 26;     // 停留进度环半径（取景器 HUD 内的固定像素）

  function supported() {
    try {
      return !!(root.navigator && root.navigator.mediaDevices &&
                root.navigator.mediaDevices.getUserMedia);
    } catch (e) { return false; }
  }

  function isSecure() {
    try { return root.isSecureContext === true; } catch (e) { return false; }
  }

  /** 人话版的状态说明，界面直接显示。 */
  function explain(state, detail) {
    switch (state) {
      case 'on': return '相机已开启';
      case 'off': return '相机未开启';
      case 'unsupported': return '这个浏览器不支持调用相机。不影响采集。';
      case 'insecure': return '相机需要 HTTPS。iOS 上 localhost 也不算安全上下文。';
      case 'denied': return '相机权限被拒绝。可在「设置 → Safari → 相机」重新允许。不影响采集。';
      case 'notfound': return '找不到可用的摄像头。';
      case 'busy': return '摄像头被别的 App 占着，关掉相机类 App 再试。';
      default: return '相机打不开' + (detail ? '：' + detail : '。') + '不影响采集。';
    }
  }

  function classify(err) {
    var n = err && err.name ? err.name : '';
    if (n === 'NotAllowedError' || n === 'SecurityError' || n === 'PermissionDeniedError') { return 'denied'; }
    if (n === 'NotFoundError' || n === 'DevicesNotFoundError' || n === 'OverconstrainedError') { return 'notfound'; }
    if (n === 'NotReadableError' || n === 'TrackStartError') { return 'busy'; }
    return 'error';
  }

  /**
   * 建一个取景器。返回 {node, start, stop, state, setReadout, setDwell, setSector}。
   * start() 必须在用户手势里调用。
   */
  function create(opts) {
    var A = root.BH.App;
    opts = opts || {};

    var state = 'off';
    var stream = null;
    var lastError = '';

    var video = document.createElement('video');
    video.className = 'vf-video';
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.setAttribute('autoplay', '');
    video.setAttribute('muted', '');
    video.muted = true;          // 属性和 property 都要设，否则 iOS 不自动播放
    video.style.display = 'none';

    // 准星：一条贯穿画面的水平参考线（用来压天际线），加中心十字
    var hLine = A.h('div', { class: 'vf-h' });
    var cross = A.h('div', { class: 'vf-cross' }, [
      A.h('i', { class: 'vf-cx' }), A.h('i', { class: 'vf-cy' })
    ]);

    // 停留进度环，尺寸固定，不受容器比例影响
    var ringSize = RING_R * 2 + 8;
    var ringTrack = A.svg('circle', {
      cx: ringSize / 2, cy: ringSize / 2, r: RING_R, fill: 'none',
      stroke: 'rgba(255,255,255,.22)', 'stroke-width': 2.5
    });
    var ringArc = A.svg('circle', {
      cx: ringSize / 2, cy: ringSize / 2, r: RING_R, fill: 'none',
      stroke: '#ffb340', 'stroke-width': 2.5, 'stroke-linecap': 'round',
      transform: 'rotate(-90 ' + (ringSize / 2) + ' ' + (ringSize / 2) + ')',
      'stroke-dasharray': '0 999'
    });
    var ring = A.svg('svg', {
      class: 'vf-ring', width: ringSize, height: ringSize,
      viewBox: '0 0 ' + ringSize + ' ' + ringSize
    }, [ringTrack, ringArc]);

    var azOut = A.h('b', { text: '—' });
    var elOut = A.h('b', { text: '—' });
    var readout = A.h('div', { class: 'vf-read' }, [
      A.h('span', null, ['方位 ', azOut]),
      A.h('span', null, ['仰角 ', elOut])
    ]);
    var footer = A.h('div', { class: 'vf-foot', text: '准星对准天际线' });

    var placeholder = A.h('div', { class: 'vf-off' });
    var node = A.h('div', { class: 'vf' }, [video, hLine, cross, ring, readout, footer, placeholder]);

    function setPlaceholder(html, btnLabel, onBtn) {
      A.clear(placeholder);
      placeholder.appendChild(A.h('div', { class: 'vf-off-txt', html: html }));
      if (btnLabel) {
        placeholder.appendChild(A.h('button', {
          class: 'btn sm primary', type: 'button', on: { click: onBtn }
        }, btnLabel));
      }
    }

    function showLive(on) {
      video.style.display = on ? '' : 'none';
      placeholder.style.display = on ? 'none' : '';
      node.classList.toggle('live', on);
    }

    /** 必须在用户手势的回调里调用。 */
    function start() {
      if (state === 'on') { return Promise.resolve('on'); }
      if (!supported()) { state = 'unsupported'; render(); return Promise.resolve(state); }
      if (!isSecure()) { state = 'insecure'; render(); return Promise.resolve(state); }

      return navigator.mediaDevices.getUserMedia({
        // 用 ideal 而不是 exact：拿不到后摄时退回任意摄像头，总比整个失败好
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 }, height: { ideal: 720 }
        },
        audio: false
      }).then(function (s) {
        stream = s;
        video.srcObject = s;
        var p = video.play();
        if (p && p.catch) { p.catch(function () { /* 自动播放被拦也不致命 */ }); }
        state = 'on';
        render();
        return state;
      }).catch(function (err) {
        lastError = (err && err.message) ? err.message : String(err);
        state = classify(err);
        render();
        return state;
      });
    }

    function stop() {
      if (stream) {
        // 不停轨道的话相机指示灯会一直亮着
        stream.getTracks().forEach(function (t) {
          try { t.stop(); } catch (e) { /* 已经停了 */ }
        });
        stream = null;
      }
      try { video.srcObject = null; } catch (e) { /* 忽略 */ }
      if (state === 'on') { state = 'off'; }
      render();
    }

    function render() {
      if (state === 'on') { showLive(true); return; }
      showLive(false);
      if (state === 'off') {
        setPlaceholder('开启相机后可以对准天际线，仰角读数更准。',
                       '开启相机', function () { start(); });
      } else if (state === 'denied' || state === 'error' || state === 'busy') {
        setPlaceholder(explain(state, lastError), '再试一次', function () { start(); });
      } else {
        setPlaceholder(explain(state, lastError), null, null);
      }
    }

    function setReadout(az, el) {
      azOut.textContent = (az === null || az === undefined) ? '—' : Math.round(az) + '°';
      elOut.textContent = (el === null || el === undefined) ? '—' : A.deg(el);
    }

    /** frac 0–1 停留进度；captured 表示该扇区已经采过。 */
    function setDwell(frac, captured) {
      var c = 2 * Math.PI * RING_R;
      var on = c * Math.max(0, Math.min(1, frac || 0));
      ringArc.setAttribute('stroke-dasharray', (Math.round(on * 100) / 100) + ' ' + (Math.round(c * 100) / 100));
      ringArc.setAttribute('stroke', captured ? '#7fb069' : '#ffb340');
    }

    function setFooter(text) { footer.textContent = text; }

    render();

    return {
      node: node,
      start: start,
      stop: stop,
      state: function () { return state; },
      setReadout: setReadout,
      setDwell: setDwell,
      setFooter: setFooter,
      _video: video
    };
  }

  return {
    supported: supported,
    isSecure: isSecure,
    explain: explain,
    classify: classify,
    create: create,
    RING_R: RING_R
  };
});
