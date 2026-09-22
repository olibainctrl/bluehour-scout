/*!
 * 蓝调勘景仪 Blue Hour Scout — js/test/viewfinder.test.js
 * 取景器的状态处理与准星几何。
 */
(function () {
  'use strict';

  var T = BH.Test;
  var V = BH.Viewfinder;
  var hasDOM = (typeof document !== 'undefined' && !!document.createElement);

  T.suite('取景器：状态与降级', function () {

    T.test('每种状态都有可读的说明', function () {
      var states = ['on', 'off', 'unsupported', 'insecure', 'denied', 'notfound', 'busy', 'error'];
      var seen = {};
      for (var i = 0; i < states.length; i++) {
        var msg = V.explain(states[i]);
        T.ok(typeof msg === 'string' && msg.length > 3,
             states[i] + ' → ' + msg.slice(0, 30) + (msg.length > 30 ? '…' : ''));
        seen[msg] = (seen[msg] || 0) + 1;
      }
      var dup = Object.keys(seen).filter(function (k) { return seen[k] > 1; });
      T.equal(dup.length, 0, '各状态的说明互不重复');
    });

    T.test('拿不到相机的三种说明都要讲清"不影响采集"', function () {
      ['denied', 'unsupported', 'error'].forEach(function (st) {
        var m = V.explain(st);
        T.ok(/手感|不影响/.test(m), st + ' 的说明点明了降级后果');
      });
    });

    T.test('错误类型归类', function () {
      var cases = [
        ['NotAllowedError', 'denied'], ['SecurityError', 'denied'],
        ['PermissionDeniedError', 'denied'],
        ['NotFoundError', 'notfound'], ['DevicesNotFoundError', 'notfound'],
        ['OverconstrainedError', 'notfound'],
        ['NotReadableError', 'busy'], ['TrackStartError', 'busy'],
        ['SomethingElse', 'error'], ['', 'error']
      ];
      for (var i = 0; i < cases.length; i++) {
        T.equal(V.classify({ name: cases[i][0] }), cases[i][1],
                (cases[i][0] || '(空)') + ' → ' + cases[i][1]);
      }
      T.equal(V.classify(null), 'error', 'null → error');
      T.equal(V.classify(undefined), 'error', 'undefined → error');
    });

    T.test('能力探测在任何宿主里都不抛错', function () {
      T.ok(typeof V.supported() === 'boolean', 'supported() 返回布尔值');
      T.ok(typeof V.isSecure() === 'boolean', 'isSecure() 返回布尔值');
      T.ok(V.RING_R > 0, '停留进度环半径为正');
    });
  });

  T.suite('取景器：准星几何', function () {

    T.test('准星中心必须等于画面中心', function () {
      if (!hasDOM) {
        T.ok(true, '当前宿主没有 DOM，此项只在浏览器里有意义');
        return;
      }
      // 瞄准轴 = 后摄光轴 = 画面正中心。准星偏一点，测出来的仰角就偏一点。
      var vf = V.create();
      var host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:-9999px;top:0;width:320px';
      host.appendChild(vf.node);
      document.body.appendChild(host);
      vf.node.classList.add('live');   // 让准星可见才量得到

      var box = vf.node.getBoundingClientRect();
      var cross = vf.node.querySelector('.vf-cross').getBoundingClientRect();
      var hLine = vf.node.querySelector('.vf-h').getBoundingClientRect();
      var ring = vf.node.querySelector('.vf-ring').getBoundingClientRect();

      var cx = box.left + box.width / 2, cy = box.top + box.height / 2;
      T.near(cross.left, cx, 1.5, '十字中心的横坐标等于画面中心', 'px');
      T.near(cross.top, cy, 1.5, '十字中心的纵坐标等于画面中心', 'px');
      T.near(hLine.top + hLine.height / 2, cy, 1.5, '水平参考线落在画面中线上', 'px');
      T.near(ring.left + ring.width / 2, cx, 1.5, '进度环横向居中', 'px');
      T.near(ring.top + ring.height / 2, cy, 1.5, '进度环纵向居中', 'px');
      T.row(['画面中心', cx.toFixed(1) + ', ' + cy.toFixed(1), '']);
      T.row(['十字中心', cross.left.toFixed(1) + ', ' + cross.top.toFixed(1), '']);

      vf.stop();
      document.body.removeChild(host);
    });

    T.test('视频用 cover 填充：cover 是居中裁切，中心仍是光轴', function () {
      if (!hasDOM) { T.ok(true, '当前宿主没有 DOM'); return; }
      var vf = V.create();
      var host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:-9999px;top:0;width:320px';
      host.appendChild(vf.node);
      document.body.appendChild(host);
      var v = vf.node.querySelector('.vf-video');
      T.equal(getComputedStyle(v).objectFit, 'cover', 'object-fit 为 cover');
      T.equal(getComputedStyle(v).objectPosition, '50% 50%', 'object-position 居中');
      vf.stop();
      document.body.removeChild(host);
    });

    T.test('相机没开时准星和读数不显示', function () {
      if (!hasDOM) { T.ok(true, '当前宿主没有 DOM'); return; }
      var vf = V.create();
      var host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:-9999px;top:0;width:320px';
      host.appendChild(vf.node);
      document.body.appendChild(host);
      T.equal(vf.state(), 'off', '初始状态为 off');
      T.ok(!vf.node.classList.contains('live'), '没有 live 标记');
      ['.vf-h', '.vf-cross', '.vf-ring', '.vf-read', '.vf-foot'].forEach(function (sel) {
        T.equal(getComputedStyle(vf.node.querySelector(sel)).display, 'none',
                sel + ' 在未开启时隐藏');
      });
      T.ok(vf.node.querySelector('.vf-off-txt'), '显示占位说明');
      vf.stop();
      document.body.removeChild(host);
    });
  });
}());
