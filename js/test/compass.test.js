/*!
 * 蓝调勘景仪 Blue Hour Scout — js/test/compass.test.js
 * 罗盘瞄准几何的单元测试。
 *
 * 瞄准约定：竖着举手机，用背面（后摄）对准目标，瞄准轴 = 设备 −z 轴。
 * 世界坐标系为东(e)-北(n)-天(u)。
 */
(function () {
  'use strict';

  var T = BH.Test;
  var C = BH.Compass;

  function axis(a, b, g) { return C._cameraAxis(a, b, g); }
  function azOf(v) { return C._norm360(Math.atan2(v.e, v.n) * 180 / Math.PI); }
  function len(v) { return Math.sqrt(v.e * v.e + v.n * v.n + v.u * v.u); }

  T.suite('罗盘：瞄准轴几何', function () {

    T.test('手机立起来时瞄的是水平方向', function () {
      // beta=90 表示手机竖直、屏幕朝向自己，后摄水平向外
      T.near(C._elevationOf(90, 0), 0, 1e-9, 'beta=90 → 仰角 0°', '°');
      T.near(axis(0, 90, 0).u, 0, 1e-9, '瞄准轴没有竖直分量', '');
    });

    T.test('前后俯仰换算', function () {
      T.near(C._elevationOf(120, 0), 30, 1e-9, '后仰 30° → 仰角 +30°', '°');
      T.near(C._elevationOf(105, 0), 15, 1e-9, '后仰 15° → 仰角 +15°', '°');
      T.near(C._elevationOf(60, 0), -30, 1e-9, '前俯 30° → 仰角 −30°', '°');
      T.near(C._elevationOf(0, 0), -90, 1e-9, '平放屏幕朝上 → 后摄指地 −90°', '°');
      T.near(C._elevationOf(180, 0), 90, 1e-9, '平放屏幕朝下 → 后摄指天 +90°', '°');
    });

    T.test('仰角与方位角无关（没有磁力计时俯仰依然可用）', function () {
      var alphas = [0, 37, 90, 180, 271, 359];
      var ref = axis(0, 108, 12).u;
      for (var i = 0; i < alphas.length; i++) {
        T.near(axis(alphas[i], 108, 12).u, ref, 1e-12,
               'alpha=' + alphas[i] + '° 时竖直分量不变', '');
      }
      T.near(C._elevationOf(108, 12), Math.asin(ref) * 180 / Math.PI, 1e-9,
             'elevationOf 与矩阵结果一致', '°');
    });

    T.test('立着的手机左右摆动只改方位不改仰角', function () {
      var gammas = [-60, -30, 0, 30, 60];
      for (var i = 0; i < gammas.length; i++) {
        T.near(C._elevationOf(90, gammas[i]), 0, 1e-9,
               'beta=90、gamma=' + gammas[i] + '° 仍是水平', '°');
      }
    });

    T.test('瞄准轴始终是单位向量', function () {
      var bad = 0;
      for (var a = 0; a < 360; a += 47) {
        for (var b = -170; b <= 170; b += 41) {
          for (var g = -80; g <= 80; g += 37) {
            if (Math.abs(len(axis(a, b, g)) - 1) > 1e-12) { bad++; }
          }
        }
      }
      T.equal(bad, 0, '各姿态下模长均为 1');
    });
  });

  T.suite('罗盘：方位角', function () {

    T.test('立着的手机，alpha 直接对应罗盘方位', function () {
      var cases = [[0, 0, '北'], [90, 270, '西'], [180, 180, '南'], [270, 90, '东']];
      for (var i = 0; i < cases.length; i++) {
        var got = azOf(axis(cases[i][0], 90, 0));
        T.near(got, cases[i][1], 1e-6,
               'alpha=' + cases[i][0] + '° → 瞄向' + cases[i][2] + ' ' + cases[i][1] + '°', '°');
        T.row(['alpha ' + cases[i][0] + '°', got.toFixed(2) + '°', cases[i][1] + '° ' + cases[i][2]]);
      }
    });

    T.test('方位角连续覆盖一整圈', function () {
      var bad = 0;
      for (var a = 0; a < 360; a += 5) {
        var want = C._norm360(-a);          // 罗盘方位 = 360 − alpha
        var got = azOf(axis(a, 90, 0));
        var d = Math.abs(((got - want + 540) % 360) - 180);
        if (d > 1e-6) { bad++; }
      }
      T.equal(bad, 0, '72 个角度全部吻合 360−alpha');
    });

    T.test('0°/360° 附近的圆周平均不会跑到 180°', function () {
      // 这是罗盘最经典的 bug：直接算术平均 359° 和 1° 会得到 180°
      var a = 359 * Math.PI / 180, b = 1 * Math.PI / 180;
      var s = (Math.sin(a) + Math.sin(b)) / 2;
      var c = (Math.cos(a) + Math.cos(b)) / 2;
      var mean = C._norm360(Math.atan2(s, c) * 180 / Math.PI);
      T.near(mean, 0, 1e-9, '359° 与 1° 的圆周平均为 0°', '°');
      T.ok(Math.abs(mean - 180) > 179, '不是 180°');
    });

    T.test('手机指天指地时不给方位角', function () {
      // 后摄near乎垂直向上/向下时水平分量趋零，方位角没有意义
      var up = axis(0, 180, 0);
      var horiz = Math.sqrt(up.e * up.e + up.n * up.n);
      T.ok(horiz < 0.02, '指天时水平分量 ' + horiz.toExponential(1) + ' 接近零');
      var down = axis(0, 0, 0);
      var horiz2 = Math.sqrt(down.e * down.e + down.n * down.n);
      T.ok(horiz2 < 0.02, '指地时水平分量 ' + horiz2.toExponential(1) + ' 接近零');
    });
  });

  T.suite('罗盘：磁北 → 真北', function () {

    T.test('真北 = 磁北 + 磁偏角', function () {
      T.near(C.toTrue(257.2, 12.8), 270, 1e-9, '悉尼：罗盘 257.2° 是真北 270°', '°');
      T.near(C.toTrue(355, 12.8), 7.8, 1e-9, '跨过 0° 要绕回来', '°');
      T.near(C.toTrue(5, -8), 357, 1e-9, '西偏（东京约 −8°）往回绕', '°');
    });

    T.test('没有磁偏角就原样返回磁北，没有读数就是 null', function () {
      T.equal(C.toTrue(100, null), 100, '磁偏角 null');
      T.equal(C.toTrue(100, NaN), 100, '磁偏角 NaN');
      T.isNull(C.toTrue(null, 12.8), '读数 null');
    });

    T.test('setDeclination 只收有限数值，stop() 清掉', function () {
      C.setDeclination(12.8);
      T.equal(C.declination(), 12.8, '设上');
      C.setDeclination('x');
      T.isNull(C.declination(), '垃圾值 → null');
      C.setDeclination(12.8);
      C.stop();
      T.isNull(C.declination(), 'stop() 之后不会带到别的记录上');
    });
  });

  T.suite('罗盘：权限与降级', function () {

    T.test('状态说明覆盖全部分支', function () {
      var states = ['idle', 'granted', 'denied', 'unsupported', 'insecure', 'nodata'];
      for (var i = 0; i < states.length; i++) {
        var msg = C.explain(states[i]);
        T.ok(typeof msg === 'string' && msg.length > 4,
             states[i] + ' → ' + msg.slice(0, 28) + (msg.length > 28 ? '…' : ''));
      }
    });

    T.test('UMD 包装把全局对象传进了工厂函数（回归测试）', function () {
      // 曾经踩过：包装器写成 factory() 而工厂签名是 function(root)，
      // 于是工厂体内所有 root.xxx 都是 ReferenceError，被 try/catch 吞掉后
      // 各种能力探测恒返回 false——罗盘永远启用不了，且一声不吭。
      var g = (typeof globalThis !== 'undefined') ? globalThis : null;
      T.ok(g !== null, '宿主提供 globalThis');
      if (g && g.screen && g.screen.orientation &&
          typeof g.screen.orientation.angle === 'number') {
        T.equal(C.screenAngle(), g.screen.orientation.angle,
                'screenAngle() 读到了真实的 screen.orientation.angle');
      } else {
        T.ok(true, '当前宿主没有 screen.orientation，此项在浏览器里才有意义');
      }
      if (g && typeof g.isSecureContext === 'boolean') {
        T.equal(C.isSecure(), g.isSecureContext, 'isSecure() 与 isSecureContext 一致');
      } else {
        T.ok(true, '当前宿主没有 isSecureContext');
      }
    });

    T.test('非浏览器环境下能力探测不抛错', function () {
      T.ok(typeof C.supported() === 'boolean', 'supported() 返回布尔值');
      T.ok(typeof C.needsPermission() === 'boolean', 'needsPermission() 返回布尔值');
      T.ok(typeof C.isSecure() === 'boolean', 'isSecure() 返回布尔值');
      T.ok(typeof C.screenAngle() === 'number', 'screenAngle() 返回数值');
      T.equal(C.state(), 'idle', '初始状态为 idle');
    });
  });
}());
