/*!
 * 蓝调勘景仪 Blue Hour Scout — js/test/exposure.test.js
 * EV / 色温模型、曝光换算、实测校准。
 */
(function () {
  'use strict';

  var T = BH.Test;
  var E = BH.Exposure;

  T.suite('曝光：EV100 分段曲线', function () {

    T.test('锚点上取到的就是锚点值', function () {
      for (var i = 0; i < E.EV_ANCHORS.length; i++) {
        var a = E.EV_ANCHORS[i];
        T.near(E.baseEV100(a[0]), a[1], 1e-9, a[0] + '° → EV100 ' + a[1], '');
        T.row([a[0] + '°', E.baseEV100(a[0]).toFixed(2), a[1]]);
      }
    });

    T.test('锚点之间线性插值', function () {
      T.near(E.baseEV100(-1.5), 8.25, 1e-9, '0° 与 −3° 的中点', '');
      T.near(E.baseEV100(-4.5), 5.75, 1e-9, '−3° 与 −6° 的中点', '');
      T.near(E.baseEV100(-7.5), 3, 1e-9, '−6° 与 −9° 的中点', '');
      T.near(E.baseEV100(-10.5), 0.25, 1e-9, '−9° 与 −12° 的中点', '');
      T.near(E.baseEV100(5), 10.75, 1e-9, '0° 与 +10° 的中点', '');
    });

    T.test('全程单调递减', function () {
      var prev = Infinity, bad = 0;
      for (var a = 15; a >= -15; a -= 0.1) {
        var v = E.baseEV100(a);
        if (v >= prev) { bad++; }
        prev = v;
      }
      T.equal(bad, 0, '从 +15° 到 −15° 共 300 个采样点全部单调');
    });

    T.test('超出锚点范围时沿最外段斜率外推，不变常数', function () {
      var hi1 = E.baseEV100(10), hi2 = E.baseEV100(20);
      T.ok(hi2 > hi1, '+20° 比 +10° 更亮（得到 ' + hi2.toFixed(2) + '）');
      var lo1 = E.baseEV100(-12), lo2 = E.baseEV100(-15);
      T.ok(lo2 < lo1, '−15° 比 −12° 更暗（得到 ' + lo2.toFixed(2) + '）');
      // 最外段斜率：(−1 − 1.5)/(−12 − (−9)) = 0.8333 EV/度
      T.near(lo2, -1 - 3 * 0.8333333, 1e-4, '−15° 按 −9→−12 段的斜率外推', '');
    });

    T.test('校准系数会整体改写曲线', function () {
      var c = { a: 1, b: 0.5 };
      T.near(E.ev100At(-6, c), 5.0, 1e-9, '纯偏移 +0.5', '');
      var c2 = { a: 1.1, b: 0 };
      T.near(E.ev100At(-6, c2), 4.5 * 1.1, 1e-9, '纯斜率 ×1.1', '');
      T.near(E.ev100At(-6, null), 4.5, 1e-9, '不传校准时等于通用模型', '');
      T.near(E.ev100At(-6, {}), 4.5, 1e-9, '空对象也当作不校准', '');
    });
  });

  T.suite('曝光：色温', function () {

    T.test('锚点上取到的就是锚点值', function () {
      for (var i = 0; i < E.CCT_ANCHORS.length; i++) {
        var a = E.CCT_ANCHORS[i];
        T.near(E.colorTempAt(a[0]), a[1], 1e-9, a[0] + '° → ' + a[1] + 'K', 'K');
        T.row([a[0] + '°', Math.round(E.colorTempAt(a[0])) + 'K', a[1] + 'K']);
      }
    });

    T.test('锚点之间线性插值', function () {
      T.near(E.colorTempAt(-2), 4850, 1e-9, '0° 与 −4° 的中点', 'K');
      T.near(E.colorTempAt(-6), 7750, 1e-9, '−4° 与 −8° 的中点', 'K');
      T.near(E.colorTempAt(-10), 10500, 1e-9, '−8° 与 −12° 的中点', 'K');
    });

    T.test('太阳越低天光越蓝，且有上下夹制', function () {
      var bad = 0, prev = Infinity;      // 沿高度角升高方向走，色温应当递减
      for (var a = -12; a <= 2; a += 0.2) {
        var v = E.colorTempAt(a);
        if (v > prev) { bad++; }
        prev = v;
      }
      T.equal(bad, 0, '从 −12° 升到 +2° 色温单调下降');
      T.ok(E.colorTempAt(-40) <= 20000, '极端低角不会给出荒谬的高色温');
      T.ok(E.colorTempAt(40) >= 1800, '极端高角不会给出荒谬的低色温');
    });
  });

  T.suite('曝光：换算公式', function () {

    T.test('快门速度 = 快门角度 / (360 × 帧率)', function () {
      T.near(E.shutterSeconds(180, 24), 1 / 48, 1e-12, '180° / 24fps = 1/48 秒', 's');
      T.near(E.shutterSeconds(180, 25), 1 / 50, 1e-12, '180° / 25fps = 1/50 秒', 's');
      T.near(E.shutterSeconds(90, 24), 1 / 96, 1e-12, '90° / 24fps = 1/96 秒', 's');
      T.near(E.shutterSeconds(360, 24), 1 / 24, 1e-12, '360° / 24fps = 1/24 秒', 's');
      T.isNull(E.shutterSeconds(0, 24), '快门角度为 0 时无效');
      T.isNull(E.shutterSeconds(180, 0), '帧率为 0 时无效');
    });

    T.test('ISO 折算', function () {
      T.near(E.evAtISO(10, 100), 10, 1e-12, 'ISO100 不变', 'EV');
      T.near(E.evAtISO(10, 200), 11, 1e-12, 'ISO200 = +1 档', 'EV');
      T.near(E.evAtISO(10, 400), 12, 1e-12, 'ISO400 = +2 档', 'EV');
      T.near(E.evAtISO(10, 3200), 15, 1e-12, 'ISO3200 = +5 档', 'EV');
      T.near(E.evAtISO(10, 50), 9, 1e-12, 'ISO50 = −1 档', 'EV');
    });

    T.test('T 档与 EV 的关系可逆：EV = log2(N² / t)', function () {
      var cases = [[12, 400], [9.5, 400], [4.5, 3200], [1.5, 3200], [7, 800]];
      var t = E.shutterSeconds(180, 24);
      for (var i = 0; i < cases.length; i++) {
        var ev100 = cases[i][0], iso = cases[i][1];
        var n = E.tStop(ev100, iso, t);
        var back = Math.log(n * n / t) / Math.LN2;
        T.near(back, E.evAtISO(ev100, iso), 1e-9,
               'EV100 ' + ev100 + ' @ISO' + iso + ' → T' + n.toFixed(2) + ' 反算一致', 'EV');
        T.row(['EV100 ' + ev100 + ' @ISO' + iso, 'T' + n.toFixed(2), 'EV ' + back.toFixed(3)]);
      }
    });

    T.test('几个手算对得上的点', function () {
      var t = E.shutterSeconds(180, 24);
      T.near(E.tStop(12, 400, t), 18.475, 0.01, '白天 EV100=12 @ISO400 → 约 T18.5', '');
      T.near(E.tStop(4.5, 3200, t), 3.88, 0.01, '民用昏影终 @ISO3200 → 约 T3.9', '');
      T.near(E.tStop(1.5, 3200, t), 1.373, 0.01, '−9° @ISO3200 → 约 T1.4', '');
      T.ok(E.tStop(-1, 3200, t) < 0.6, '航海昏影终连 ISO3200 也开不到（T' +
           E.tStop(-1, 3200, t).toFixed(2) + '），任何镜头都拍不了');
    });

    T.test('由实拍参数反算 EV100，与正算互为逆运算', function () {
      var t = E.shutterSeconds(180, 24);
      [[12, 400], [9.5, 400], [4.5, 3200], [1.5, 3200], [7, 800]].forEach(function (c) {
        var n = E.tStop(c[0], c[1], t);
        T.near(E.ev100From(n, t, c[1]), c[0], 1e-9,
               'T' + n.toFixed(2) + ' / ' + (1 / t).toFixed(0) + '分之一秒 / ISO' + c[1] +
               ' → EV100 ' + c[0], '');
      });
      T.isNull(E.ev100From(0, t, 400), '光圈为 0 无效');
      T.isNull(E.ev100From(2.8, 0, 400), '快门为 0 无效');
      T.isNull(E.ev100From(2.8, t, 0), 'ISO 为 0 无效');
    });

    T.test('对到最近的常用档位', function () {
      T.equal(E.nearestStop(2.74), 2.8, '2.74 → T2.8');
      T.equal(E.nearestStop(1.41), 1.4, '1.41 → T1.4');
      T.equal(E.nearestStop(2.0), 2.0, '2.0 → T2.0');
      // |log2(2.8/3.0)| = 0.0995，|log2(3.2/3.0)| = 0.0931，所以 3.2 更近
      T.equal(E.nearestStop(3.0), 3.2, '3.0 → T3.2（log2 空间里 3.2 更近，不是 2.8）');
      T.equal(E.nearestStop(0.8), 1.0, '低于最小档位时取最小档');
      T.equal(E.nearestStop(30), 22, '高于最大档位时取最大档');
      T.isNull(E.nearestStop(0), '0 无效');
      T.isNull(E.nearestStop(-1), '负数无效');
    });

    T.test('精确值与档位相差多少级', function () {
      T.near(E.stopsFromNearest(2.8), 0, 1e-9, '正好在档位上差 0 级', '级');
      // 2.9 的最近档位是 2.8（在它下方），所以差值为正 = 比该档位暗
      var dark = E.stopsFromNearest(2.9);
      T.ok(dark > 0 && dark < 0.5, '2.9 比 T2.8 暗 ' + dark.toFixed(3) + ' 级，在半级以内');
      // 3.1 的最近档位是 3.2（在它上方），所以差值为负 = 比该档位亮
      var bright = E.stopsFromNearest(3.1);
      T.ok(bright < 0 && bright > -0.5, '3.1 比 T3.2 亮 ' + Math.abs(bright).toFixed(3) + ' 级');
      T.equal(E.nearestStop(2.9), 2.8, '2.9 的最近档位是 T2.8');
      T.equal(E.nearestStop(3.1), 3.2, '3.1 的最近档位是 T3.2');
    });
  });

  T.suite('曝光：双原生 ISO 的取舍', function () {
    var t = E.shutterSeconds(180, 24);

    T.test('低原生 ISO 够用时就用低的', function () {
      var r = E.chooseISO(9.5, 400, 3200, t, 1.4);
      T.equal(r.iso, 400, '日落时分用 ISO400');
      T.ok(!r.switched, '不需要切高原生');
      T.ok(!r.overLens, '镜头开得到');
      T.row(['EV100 9.5', 'ISO' + r.iso, 'T' + r.n.toFixed(2), '档位 T' + r.nearest]);
    });

    T.test('低原生 ISO 开不到时切高原生', function () {
      var r = E.chooseISO(3, 400, 3200, t, 1.4);
      T.equal(r.iso, 3200, '暗下来后切到 ISO3200');
      T.ok(r.switched, '标记为已切换');
      T.ok(!r.overLens, 'ISO3200 下 nFD 50/1.4 还开得到（T' + r.n.toFixed(2) + '）');
    });

    T.test('连高原生 ISO 也开不到时明确标记', function () {
      var r = E.chooseISO(-1, 400, 3200, t, 1.4);
      T.ok(r.overLens, '航海昏影终已经超出镜头能力');
      T.ok(r.n < 1.4, '需要的 T' + r.n.toFixed(2) + ' 比最大光圈 1.4 还大');
    });

    T.test('没选镜头时一律用低原生 ISO 并且不报超限', function () {
      var r = E.chooseISO(1, 400, 3200, t, null);
      T.equal(r.iso, 400, '没有镜头约束就不切档');
      T.ok(!r.overLens, '无从判断超限');
    });

    T.test('同一 EV 下换更大光圈的镜头会推迟切档', function () {
      var slow = E.chooseISO(5, 400, 3200, t, 2.8);
      var fast = E.chooseISO(5, 400, 3200, t, 1.4);
      T.ok(slow.switched, 'F2.8 镜头此时已需切到 ISO' + slow.iso);
      T.ok(!fast.switched, 'F1.4 镜头还能留在 ISO' + fast.iso);
    });
  });

  T.suite('曝光：灯具照度', function () {

    T.test('lux → EV100 = log2(lux / 2.5)', function () {
      T.near(E.luxToEV100(2.5), 0, 1e-12, '2.5 lux → EV100 0', '');
      T.near(E.luxToEV100(10), 2, 1e-12, '10 lux → EV100 2', '');
      T.near(E.luxToEV100(160), 6, 1e-12, '160 lux → EV100 6', '');
      T.near(E.luxToEV100(2560), 10, 1e-12, '2560 lux → EV100 10', '');
      T.isNull(E.luxToEV100(0), '0 lux 无效');
      T.isNull(E.luxToEV100(-5), '负值无效');
    });

    T.test('EV100 → lux 往返一致', function () {
      [1, 100, 1000, 5000].forEach(function (lux) {
        T.near(E.ev100ToLux(E.luxToEV100(lux)), lux, 1e-6, lux + ' lux 往返', 'lux');
      });
    });

    T.test('平方反比换算距离', function () {
      T.near(E.luxAtDistance(1000, 1, 2), 250, 1e-9, '1m 处 1000lux → 2m 处 250lux', 'lux');
      T.near(E.luxAtDistance(1000, 2, 1), 4000, 1e-9, '2m 处 1000lux → 1m 处 4000lux', 'lux');
      T.near(E.luxAtDistance(1000, 1, 1), 1000, 1e-9, '同距离不变', 'lux');
      T.isNull(E.luxAtDistance(1000, 0, 2), '距离为 0 无效');
    });
  });

  T.suite('曝光：实测校准', function () {

    T.test('完美线性数据能被精确拟合', function () {
      // 构造 实测 = 1.2 × 模型 − 0.4
      var pts = [-1, -3, -5, -7, -9].map(function (a) {
        return { alt: a, ev100: 1.2 * E.baseEV100(a) - 0.4, recordId: 'A' };
      });
      var f = E.fitCalibration(pts, 'A');
      T.near(f.a, 1.2, 1e-6, '斜率还原为 1.2', '');
      T.near(f.b, -0.4, 1e-6, '偏移还原为 −0.4', '');
      T.equal(f.n, 5, '用了 5 个点');
      T.ok(f.slopeFitted, '拟合了斜率');
      T.equal(f.source, 'location', '用的是本地点数据');
    });

    T.test('点不够时只求偏移，斜率固定为 1', function () {
      var pts = [
        { alt: -3, ev100: E.baseEV100(-3) + 0.8, recordId: 'A' },
        { alt: -6, ev100: E.baseEV100(-6) + 0.8, recordId: 'A' }
      ];
      var f = E.fitCalibration(pts, 'A');
      T.equal(f.a, 1, '斜率保持 1');
      T.near(f.b, 0.8, 1e-9, '偏移为 +0.8', '');
      T.ok(!f.slopeFitted, '标记为未拟合斜率');
    });

    T.test('所有点挤在同一高度角时不解斜率', function () {
      var pts = [-5, -5, -5, -5].map(function (a) {
        return { alt: a, ev100: E.baseEV100(a) + 1.1, recordId: 'A' };
      });
      var f = E.fitCalibration(pts, 'A');
      T.equal(f.a, 1, '自变量没有跨度，斜率不动');
      T.near(f.b, 1.1, 1e-9, '仍能求出偏移', '');
      T.ok(!f.slopeFitted, '标记为未拟合斜率');
    });

    T.test('斜率被夹在合理范围内', function () {
      // 造一组会解出极端斜率的数据
      var pts = [
        { alt: -1, ev100: 30, recordId: 'A' },
        { alt: -6, ev100: -20, recordId: 'A' },
        { alt: -11, ev100: -70, recordId: 'A' }
      ];
      var f = E.fitCalibration(pts, 'A');
      T.ok(f.a >= 0.5 && f.a <= 2.0, '斜率被夹到 ' + f.a.toFixed(2) + '，落在 0.5–2.0');
    });

    T.test('优先用同一地点，不足时退回全局', function () {
      var mk = function (id, off, alts) {
        return alts.map(function (a) {
          return { alt: a, ev100: E.baseEV100(a) + off, recordId: id };
        });
      };
      // 本地点 3 个点 → 用本地点
      var f1 = E.fitCalibration(mk('A', 1, [-2, -5, -8]).concat(mk('B', -1, [-2, -5, -8, -10])), 'A');
      T.equal(f1.source, 'location', '本地点够 3 个就用本地点');
      T.near(f1.b, 1, 1e-6, '拿到的是本地点的 +1 偏移', '');

      // 本地点 0 个、全局够 → 退回全局
      var f2 = E.fitCalibration(mk('B', -1, [-2, -5, -8]), 'A');
      T.equal(f2.source, 'global', '本地点没有数据时退回全局');
      T.near(f2.b, -1, 1e-6, '拿到的是全局的 −1 偏移', '');

      // 本地点 1 个、全局也不够 3 个 → 用本地点只求偏移
      var f3 = E.fitCalibration(mk('A', 2, [-4]).concat(mk('B', -3, [-4])), 'A');
      T.equal(f3.source, 'location', '本地点哪怕只有 1 个也优先');
      T.near(f3.b, 2, 1e-6, '用本地点那一个点的偏移', '');
      T.equal(f3.n, 1, '只用了 1 个点');

      T.isNull(E.fitCalibration([], 'A'), '一个点都没有时不校准');
      T.isNull(E.fitCalibration(null, 'A'), 'null 输入不校准');
    });

    T.test('脏数据被跳过', function () {
      var pts = [
        { alt: -3, ev100: E.baseEV100(-3) + 1, recordId: 'A' },
        { alt: NaN, ev100: 5, recordId: 'A' },
        { alt: -6, ev100: Infinity, recordId: 'A' },
        { alt: -9, ev100: E.baseEV100(-9) + 1, recordId: 'A' }
      ];
      var f = E.fitCalibration(pts, 'A');
      T.equal(f.n, 2, '4 条里只有 2 条可用');
      T.near(f.b, 1, 1e-9, '结果不受脏数据影响', '');
    });

    T.test('残差均方根', function () {
      var pts = [-2, -5, -8].map(function (a) {
        return { alt: a, ev100: E.baseEV100(a) + 0.5, recordId: 'A' };
      });
      var f = E.fitCalibration(pts, 'A');
      var rms = E.calibrationRMS(pts, 'A', f);
      T.ok(rms < 1e-6, '完美数据的残差接近 0（得到 ' + rms.toExponential(1) + '）');
    });
  });
}());
