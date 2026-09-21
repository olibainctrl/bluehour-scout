/*!
 * 蓝调勘景仪 Blue Hour Scout — js/test/horizon.test.js
 * 地平线遮挡剖面的单元测试。
 */
(function () {
  'use strict';

  var T = BH.Test;
  var H = BH.Horizon;

  function flat(v) {
    var p = H.empty();
    for (var i = 0; i < 36; i++) { p[i] = v; }
    return p;
  }

  function sparse(pairs) {
    var p = H.empty();
    for (var k in pairs) { p[+k] = pairs[k]; }
    return p;
  }

  T.suite('地平线剖面：扇区与方位角', function () {

    T.test('空剖面是 36 个 null', function () {
      var p = H.empty();
      T.equal(p.length, 36, '长度为 36');
      T.equal(H.count(p), 0, '已采样数为 0');
      T.equal(H.missing(p).length, 36, '全部缺失');
      T.ok(!H.isComplete(p), '未完成');
    });

    T.test('方位角就近落到扇区', function () {
      var cases = [[0, 0], [4, 0], [5, 1], [9, 1], [11, 1], [14, 1], [15, 2],
                   [180, 18], [354, 35], [355, 0], [359, 0], [360, 0], [-5, 0], [-6, 35]];
      for (var i = 0; i < cases.length; i++) {
        T.equal(H.sectorFor(cases[i][0]), cases[i][1],
                cases[i][0] + '° → 扇区 ' + cases[i][1]);
      }
    });

    T.test('扇区回到方位角', function () {
      T.equal(H.azimuthOf(0), 0, '扇区 0 → 0°');
      T.equal(H.azimuthOf(18), 180, '扇区 18 → 180°');
      T.equal(H.azimuthOf(35), 350, '扇区 35 → 350°');
      T.equal(H.azimuthOf(36), 0, '扇区 36 回绕到 0°');
      for (var i = 0; i < 36; i++) {
        T.equal(H.sectorFor(H.azimuthOf(i)), i, '扇区 ' + i + ' 往返一致');
      }
    });
  });

  T.suite('地平线剖面：插值', function () {

    T.test('平地剖面处处等值', function () {
      var p = flat(4.5);
      var bad = 0;
      for (var az = 0; az < 360; az += 3) {
        if (Math.abs(H.elevationAt(p, az) - 4.5) > 1e-9) { bad++; }
      }
      T.equal(bad, 0, '120 个采样点全部等于 4.5°');
      T.ok(H.isComplete(p), '剖面完整');
    });

    T.test('相邻扇区之间线性插值', function () {
      var p = sparse({ 0: 0, 1: 10 });
      T.near(H.elevationAt(p, 0), 0, 1e-9, '0° 处为 0°', '°');
      T.near(H.elevationAt(p, 10), 10, 1e-9, '10° 处为 10°', '°');
      T.near(H.elevationAt(p, 5), 5, 1e-9, '5° 处插值得 5°', '°');
      T.near(H.elevationAt(p, 2.5), 2.5, 1e-9, '2.5° 处插值得 2.5°', '°');
      T.near(H.elevationAt(p, 7.5), 7.5, 1e-9, '7.5° 处插值得 7.5°', '°');
    });

    T.test('跨 0° 的插值正确回绕', function () {
      var p = sparse({ 35: 0, 0: 10 });
      T.near(H.elevationAt(p, 350), 0, 1e-9, '350° 处为 0°', '°');
      T.near(H.elevationAt(p, 0), 10, 1e-9, '0° 处为 10°', '°');
      T.near(H.elevationAt(p, 355), 5, 1e-9, '355° 处插值得 5°', '°');
      T.near(H.elevationAt(p, 357.5), 7.5, 1e-9, '357.5° 处插值得 7.5°', '°');
    });

    T.test('缺口会被跨过去插值', function () {
      // 只采了 0° 和 90°，中间 8 个扇区空着
      var p = sparse({ 0: 0, 9: 9 });
      T.near(H.elevationAt(p, 45), 4.5, 1e-9, '缺口中点取两端中值', '°');
      T.near(H.elevationAt(p, 10), 1, 1e-9, '缺口内按距离加权', '°');
      T.near(H.elevationAt(p, 80), 8, 1e-9, '缺口内按距离加权（另一端）', '°');
    });

    T.test('只有一个采样点时处处返回该值', function () {
      var p = sparse({ 12: 7.25 });
      T.near(H.elevationAt(p, 120), 7.25, 1e-9, '采样点本身', '°');
      T.near(H.elevationAt(p, 300), 7.25, 1e-9, '离得最远的方位', '°');
      T.near(H.elevationAt(p, 0), 7.25, 1e-9, '0° 处', '°');
    });

    T.test('一个点都没有时返回 null', function () {
      T.isNull(H.elevationAt(H.empty(), 123), '空剖面插值为 null');
      T.isNull(H.elevationAt(H.empty(), 0), '0° 处也是 null');
    });

    T.test('负仰角（站在高处俯视）', function () {
      var p = sparse({ 0: -3, 1: -1 });
      T.near(H.elevationAt(p, 5), -2, 1e-9, '负值之间插值', '°');
      T.near(H.elevationAt(p, 0), -3, 1e-9, '端点为 −3°', '°');
    });
  });

  T.suite('地平线剖面：缺口提示', function () {

    T.test('完整剖面没有缺口', function () {
      T.equal(H.missingRanges(flat(0)).length, 0, '无缺口');
    });

    T.test('全空剖面是一整圈', function () {
      var r = H.missingRanges(H.empty());
      T.equal(r.length, 1, '一段');
      T.equal(r[0].count, 36, '36 个扇区');
      T.equal(r[0].from, 0, '从 0°');
      T.equal(r[0].to, 360, '到 360°');
    });

    T.test('中间一段缺口', function () {
      var p = flat(2);
      for (var i = 5; i <= 8; i++) { p[i] = null; }
      var r = H.missingRanges(p);
      T.equal(r.length, 1, '一段缺口');
      T.equal(r[0].count, 4, '4 个扇区');
      T.equal(r[0].from, 45, '从 45°');
      T.equal(r[0].to, 85, '到 85°');
      T.row(['缺口', r[0].from + '°–' + r[0].to + '°', r[0].count + ' 个扇区']);
    });

    T.test('跨 0° 的缺口不会被切成两段', function () {
      var p = flat(2);
      p[34] = null; p[35] = null; p[0] = null; p[1] = null;
      var r = H.missingRanges(p);
      T.equal(r.length, 1, '仍然是一段');
      T.equal(r[0].count, 4, '4 个扇区');
      T.equal(r[0].from, 335, '从 335°');
      T.equal(r[0].to, 15, '到 15°');
      T.row(['跨零缺口', r[0].from + '°–' + r[0].to + '°', r[0].count + ' 个扇区']);
    });

    T.test('多段缺口', function () {
      var p = flat(2);
      p[3] = null; p[10] = null; p[11] = null; p[25] = null;
      var r = H.missingRanges(p);
      T.equal(r.length, 3, '三段缺口');
      var total = r.reduce(function (s, x) { return s + x.count; }, 0);
      T.equal(total, 4, '缺口扇区总数为 4');
      T.equal(H.count(p), 32, '已采样 32 个');
    });
  });

  T.suite('地平线剖面：遮挡判定（日面中心）', function () {

    T.test('太阳低于天际线即为被遮挡', function () {
      var p = flat(5);
      T.ok(H.isOccluded(p, 270, 3), '高度角 3° < 天际线 5°，被挡');
      T.ok(!H.isOccluded(p, 270, 7), '高度角 7° > 天际线 5°，没挡');
      T.ok(!H.isOccluded(p, 270, 5), '正好相等时不算被挡');
      T.ok(H.isOccluded(p, 270, -0.5), '日落后更是被挡');
    });

    T.test('没有剖面数据时不判遮挡', function () {
      T.ok(!H.isOccluded(H.empty(), 270, -20), '空剖面一律返回 false');
      T.isNull(H.clearance(H.empty(), 270, 5), '余量为 null');
    });

    T.test('遮挡余量', function () {
      var p = flat(5);
      T.near(H.clearance(p, 270, 8), 3, 1e-9, '高出天际线 3°', '°');
      T.near(H.clearance(p, 270, 1), -4, 1e-9, '低于天际线 4°', '°');
    });

    T.test('起伏剖面：同一高度角在不同方位结果不同', function () {
      var p = H.empty();
      for (var i = 0; i < 36; i++) { p[i] = 1; }
      p[27] = 12; p[26] = 11; p[28] = 10;        // 正西方向一座高楼
      T.ok(H.isOccluded(p, 270, 8), '西边 8° 被楼挡住');
      T.ok(!H.isOccluded(p, 90, 8), '东边 8° 没挡');
      T.ok(!H.isOccluded(p, 270, 13), '西边 13° 高过楼顶');
      T.row(['西 270°', H.elevationAt(p, 270).toFixed(1) + '°', '高楼']);
      T.row(['东 90°', H.elevationAt(p, 90).toFixed(1) + '°', '空旷']);
    });

    T.test('区间取最高点', function () {
      var p = flat(1);
      p[27] = 12;
      T.near(H.maxBetween(p, 260, 280), 12, 1e-9, '正西 ±10° 内最高 12°', '°');
      T.near(H.maxBetween(p, 80, 100), 1, 1e-9, '正东 ±10° 内最高 1°', '°');
      T.isNull(H.maxBetween(H.empty(), 0, 90), '空剖面返回 null');
    });
  });

  T.suite('地平线剖面：导入规整', function () {

    T.test('normalize 处理各种脏输入', function () {
      T.equal(H.normalize(null).length, 36, 'null → 36 个 null');
      T.equal(H.count(H.normalize(null)), 0, '无有效值');
      T.equal(H.count(H.normalize([1, 2, 3])), 3, '短数组只取前 3 个');
      T.equal(H.normalize(['4.5'])[0], 4.5, '字符串数字被转换');
      T.isNull(H.normalize([''])[0], '空字符串视为未采样');
      T.isNull(H.normalize(['abc'])[0], '非数字视为未采样');
      T.isNull(H.normalize([NaN])[0], 'NaN 视为未采样');
      T.isNull(H.normalize([Infinity])[0], 'Infinity 视为未采样');
      T.isNull(H.normalize([95])[0], '超出 ±90° 视为无效');
      T.isNull(H.normalize([-90])[0], '−90° 视为无效');
      T.equal(H.normalize([-12.5])[0], -12.5, '合法负值保留');
    });

    T.test('normalize 后可直接用于插值', function () {
      var p = H.normalize(['0', '10']);
      T.near(H.elevationAt(p, 5), 5, 1e-9, '规整后插值正常', '°');
      T.equal(H.count(p), 2, '两个有效值');
    });

    T.test('stats 概况', function () {
      var p = sparse({ 0: -2, 9: 5, 18: 12, 27: 1 });
      var s = H.stats(p);
      T.equal(s.count, 4, '4 个采样点');
      T.equal(s.min, -2, '最低 −2°');
      T.equal(s.max, 12, '最高 12°');
      T.near(s.mean, 4, 1e-9, '平均 4°', '°');
      var e = H.stats(H.empty());
      T.equal(e.count, 0, '空剖面 count 为 0');
      T.isNull(e.max, '空剖面 max 为 null');
    });
  });
}());
