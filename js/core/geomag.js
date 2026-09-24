/*!
 * 蓝调勘景仪 Blue Hour Scout — js/core/geomag.js
 *
 * 磁偏角：World Magnetic Model 2025（WMM2025），本地计算，不联网。
 *
 * 为什么需要它
 * ------------
 * 手机罗盘给的都是**磁北**方位角，太阳方位角是**真北**起算的，两者差一个磁偏角。
 * 悉尼的磁偏角约 +12.8°（东偏），不扣掉的话，地平线剖面和机位朝向整体转了 12.8°，
 * 真实日落会拿错方向上的遮挡物来判。
 *
 * iOS 的 webkitCompassHeading 也是磁北：WebKit 源码
 * Source/WebCore/platform/ios/WebCoreMotionManager.mm 里取的是
 * `newHeading.magneticHeading`。安卓的 deviceorientationabsolute 基于
 * 旋转矢量传感器，参考的同样是磁北。
 *
 * 模型
 * ----
 * 12 阶球谐展开，系数来自 NOAA NCEI 发布的 WMM.COF（WMM-2025，2024-11-13），
 * 有效期 2025.0–2030.0。算法按 WMM2025 技术报告：
 *   1. 大地坐标（WGS84）→ 地心球坐标
 *   2. 施密特半归一化缔合勒让德函数及其对余纬的导数
 *   3. 求地心坐标系下的 X′ Y′ Z′，再转回大地坐标系
 *   4. D = atan2(Y, X)
 * 用 NOAA 随系数一起发布的 100 组官方测试值校验（js/test/geomag.test.js）。
 */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  root.BH = root.BH || {};
  root.BH.Geomag = api;
  if (typeof module === 'object' && module.exports) { module.exports = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var MODEL = 'WMM-2025';
  var EPOCH = 2025.0;
  var VALID_FROM = 2025.0;
  var VALID_TO = 2030.0;
  var N_MAX = 12;
  var A_REF = 6371.2;                 // 地磁参考球半径（km）
  var WGS_A = 6378.137;               // WGS84 长半轴（km）
  var WGS_F = 1 / 298.257223563;
  var WGS_E2 = WGS_F * (2 - WGS_F);
  var RAD = Math.PI / 180;
  var DEG = 180 / Math.PI;

  // NOAA 发布的 WMM.COF 原样照抄：n  m  g  h  ġ  ḣ（nT、nT/年）
  var COF = [
    '  1  0  -29351.8       0.0       12.0        0.0',
    '  1  1   -1410.8    4545.4        9.7      -21.5',
    '  2  0   -2556.6       0.0      -11.6        0.0',
    '  2  1    2951.1   -3133.6       -5.2      -27.7',
    '  2  2    1649.3    -815.1       -8.0      -12.1',
    '  3  0    1361.0       0.0       -1.3        0.0',
    '  3  1   -2404.1     -56.6       -4.2        4.0',
    '  3  2    1243.8     237.5        0.4       -0.3',
    '  3  3     453.6    -549.5      -15.6       -4.1',
    '  4  0     895.0       0.0       -1.6        0.0',
    '  4  1     799.5     278.6       -2.4       -1.1',
    '  4  2      55.7    -133.9       -6.0        4.1',
    '  4  3    -281.1     212.0        5.6        1.6',
    '  4  4      12.1    -375.6       -7.0       -4.4',
    '  5  0    -233.2       0.0        0.6        0.0',
    '  5  1     368.9      45.4        1.4       -0.5',
    '  5  2     187.2     220.2        0.0        2.2',
    '  5  3    -138.7    -122.9        0.6        0.4',
    '  5  4    -142.0      43.0        2.2        1.7',
    '  5  5      20.9     106.1        0.9        1.9',
    '  6  0      64.4       0.0       -0.2        0.0',
    '  6  1      63.8     -18.4       -0.4        0.3',
    '  6  2      76.9      16.8        0.9       -1.6',
    '  6  3    -115.7      48.8        1.2       -0.4',
    '  6  4     -40.9     -59.8       -0.9        0.9',
    '  6  5      14.9      10.9        0.3        0.7',
    '  6  6     -60.7      72.7        0.9        0.9',
    '  7  0      79.5       0.0       -0.0        0.0',
    '  7  1     -77.0     -48.9       -0.1        0.6',
    '  7  2      -8.8     -14.4       -0.1        0.5',
    '  7  3      59.3      -1.0        0.5       -0.8',
    '  7  4      15.8      23.4       -0.1        0.0',
    '  7  5       2.5      -7.4       -0.8       -1.0',
    '  7  6     -11.1     -25.1       -0.8        0.6',
    '  7  7      14.2      -2.3        0.8       -0.2',
    '  8  0      23.2       0.0       -0.1        0.0',
    '  8  1      10.8       7.1        0.2       -0.2',
    '  8  2     -17.5     -12.6        0.0        0.5',
    '  8  3       2.0      11.4        0.5       -0.4',
    '  8  4     -21.7      -9.7       -0.1        0.4',
    '  8  5      16.9      12.7        0.3       -0.5',
    '  8  6      15.0       0.7        0.2       -0.6',
    '  8  7     -16.8      -5.2       -0.0        0.3',
    '  8  8       0.9       3.9        0.2        0.2',
    '  9  0       4.6       0.0       -0.0        0.0',
    '  9  1       7.8     -24.8       -0.1       -0.3',
    '  9  2       3.0      12.2        0.1        0.3',
    '  9  3      -0.2       8.3        0.3       -0.3',
    '  9  4      -2.5      -3.3       -0.3        0.3',
    '  9  5     -13.1      -5.2        0.0        0.2',
    '  9  6       2.4       7.2        0.3       -0.1',
    '  9  7       8.6      -0.6       -0.1       -0.2',
    '  9  8      -8.7       0.8        0.1        0.4',
    '  9  9     -12.9      10.0       -0.1        0.1',
    ' 10  0      -1.3       0.0        0.1        0.0',
    ' 10  1      -6.4       3.3        0.0        0.0',
    ' 10  2       0.2       0.0        0.1       -0.0',
    ' 10  3       2.0       2.4        0.1       -0.2',
    ' 10  4      -1.0       5.3       -0.0        0.1',
    ' 10  5      -0.6      -9.1       -0.3       -0.1',
    ' 10  6      -0.9       0.4        0.0        0.1',
    ' 10  7       1.5      -4.2       -0.1        0.0',
    ' 10  8       0.9      -3.8       -0.1       -0.1',
    ' 10  9      -2.7       0.9       -0.0        0.2',
    ' 10 10      -3.9      -9.1       -0.0       -0.0',
    ' 11  0       2.9       0.0        0.0        0.0',
    ' 11  1      -1.5       0.0       -0.0       -0.0',
    ' 11  2      -2.5       2.9        0.0        0.1',
    ' 11  3       2.4      -0.6        0.0       -0.0',
    ' 11  4      -0.6       0.2        0.0        0.1',
    ' 11  5      -0.1       0.5       -0.1       -0.0',
    ' 11  6      -0.6      -0.3        0.0       -0.0',
    ' 11  7      -0.1      -1.2       -0.0        0.1',
    ' 11  8       1.1      -1.7       -0.1       -0.0',
    ' 11  9      -1.0      -2.9       -0.1        0.0',
    ' 11 10      -0.2      -1.8       -0.1        0.0',
    ' 11 11       2.6      -2.3       -0.1        0.0',
    ' 12  0      -2.0       0.0        0.0        0.0',
    ' 12  1      -0.2      -1.3        0.0       -0.0',
    ' 12  2       0.3       0.7       -0.0        0.0',
    ' 12  3       1.2       1.0       -0.0       -0.1',
    ' 12  4      -1.3      -1.4       -0.0        0.1',
    ' 12  5       0.6      -0.0       -0.0       -0.0',
    ' 12  6       0.6       0.6        0.1       -0.0',
    ' 12  7       0.5      -0.1       -0.0       -0.0',
    ' 12  8      -0.1       0.8        0.0        0.0',
    ' 12  9      -0.4       0.1        0.0       -0.0',
    ' 12 10      -0.2      -1.0       -0.1       -0.0',
    ' 12 11      -1.3       0.1       -0.0        0.0',
    ' 12 12      -0.7       0.2       -0.1       -0.1'
  ];

  // g[n][m] 等，下标直接用 n、m
  var G = [], H = [], GD = [], HD = [];
  (function parse() {
    for (var n = 0; n <= N_MAX; n++) {
      G.push(zeros(n + 1)); H.push(zeros(n + 1)); GD.push(zeros(n + 1)); HD.push(zeros(n + 1));
    }
    COF.forEach(function (line) {
      var f = line.trim().split(/\s+/).map(Number);
      G[f[0]][f[1]] = f[2]; H[f[0]][f[1]] = f[3];
      GD[f[0]][f[1]] = f[4]; HD[f[0]][f[1]] = f[5];
    });
  })();

  function zeros(k) { var a = []; for (var i = 0; i < k; i++) { a.push(0); } return a; }

  /** 毫秒时间戳 → 小数年（按 UTC，闰年按 366 天折算）。 */
  function decimalYear(ms) {
    var y = new Date(ms).getUTCFullYear();
    var start = Date.UTC(y, 0, 1), end = Date.UTC(y + 1, 0, 1);
    return y + (ms - start) / (end - start);
  }

  /**
   * 地磁场分量（大地坐标系，nT）。
   * @param {number} lat 大地纬度（度）
   * @param {number} lon 经度（度）
   * @param {number} hKm 椭球高（km）
   * @param {number} year 小数年
   * @returns {{X:number,Y:number,Z:number,H:number,F:number,D:number,I:number}}
   */
  function field(lat, lon, hKm, year) {
    var dt = year - EPOCH;

    // 大地坐标 → 地心球坐标
    var phi = lat * RAD, lam = lon * RAD;
    var sinPhi = Math.sin(phi), cosPhi = Math.cos(phi);
    var rc = WGS_A / Math.sqrt(1 - WGS_E2 * sinPhi * sinPhi);
    var p = (rc + hKm) * cosPhi;
    var z = (rc * (1 - WGS_E2) + hKm) * sinPhi;
    var r = Math.sqrt(p * p + z * z);
    var phic = Math.asin(z / r);                  // 地心纬度

    // 余纬 θ：cosθ = sin φ′，sinθ = cos φ′。两极处 sinθ = 0，Y′ 会除零，
    // 夹一个极小值——这个工具不会在极点用
    var ct = Math.sin(phic);
    var st = Math.max(Math.cos(phic), 1e-12);

    // 施密特半归一化 P̆(n,m)(cosθ) 与 dP̆/dθ
    var P = [[1]], dP = [[0]];
    for (var n = 1; n <= N_MAX; n++) {
      P.push(zeros(n + 1)); dP.push(zeros(n + 1));
      for (var m = 0; m <= n; m++) {
        if (m === n) {
          if (n === 1) {
            P[1][1] = st; dP[1][1] = ct;
          } else {
            var k = Math.sqrt((2 * n - 1) / (2 * n));
            P[n][n] = k * st * P[n - 1][n - 1];
            dP[n][n] = k * (st * dP[n - 1][n - 1] + ct * P[n - 1][n - 1]);
          }
        } else {
          var den = Math.sqrt(n * n - m * m);
          var a1 = (2 * n - 1) / den;
          var b1 = Math.sqrt((n - 1) * (n - 1) - m * m) / den;
          var p2 = n - 2 >= m ? P[n - 2][m] : 0;
          var dp2 = n - 2 >= m ? dP[n - 2][m] : 0;
          P[n][m] = a1 * ct * P[n - 1][m] - b1 * p2;
          dP[n][m] = a1 * (ct * dP[n - 1][m] - st * P[n - 1][m]) - b1 * dp2;
        }
      }
    }

    // 地心坐标系下的北、东、下分量
    var ratio = A_REF / r;
    var rn = ratio * ratio;                       // 循环里先乘一次，n=1 时是 (a/r)^3
    var Xp = 0, Yp = 0, Zp = 0;
    for (n = 1; n <= N_MAX; n++) {
      rn *= ratio;
      for (m = 0; m <= n; m++) {
        var g = G[n][m] + dt * GD[n][m];
        var h = H[n][m] + dt * HD[n][m];
        var cm = Math.cos(m * lam), sm = Math.sin(m * lam);
        var t = g * cm + h * sm;
        Xp += rn * t * dP[n][m];
        Yp += rn * m * (g * sm - h * cm) * P[n][m];
        Zp -= rn * (n + 1) * t * P[n][m];
      }
    }
    Yp /= st;

    // 转回大地坐标系
    var psi = phic - phi;
    var X = Xp * Math.cos(psi) - Zp * Math.sin(psi);
    var Y = Yp;
    var Z = Xp * Math.sin(psi) + Zp * Math.cos(psi);
    var Hh = Math.sqrt(X * X + Y * Y);
    return {
      X: X, Y: Y, Z: Z, H: Hh,
      F: Math.sqrt(Hh * Hh + Z * Z),
      D: Math.atan2(Y, X) * DEG,
      I: Math.atan2(Z, Hh) * DEG
    };
  }

  /**
   * 磁偏角（度，东偏为正）。真北方位 = 磁北方位 + 磁偏角。
   * 坐标无效时返回 null。模型有效期之外照样算（误差会慢慢变大），
   * 用 inRange() 判断要不要提示换系数。
   */
  function declination(lat, lon, ms, hKm) {
    if (typeof lat !== 'number' || typeof lon !== 'number' || !isFinite(lat) || !isFinite(lon) ||
        lat < -90 || lat > 90) { return null; }
    var t = typeof ms === 'number' && isFinite(ms) ? ms : Date.now();
    return field(lat, lon, typeof hKm === 'number' && isFinite(hKm) ? hKm : 0, decimalYear(t)).D;
  }

  function inRange(ms) {
    var y = decimalYear(typeof ms === 'number' ? ms : Date.now());
    return y >= VALID_FROM && y < VALID_TO;
  }

  return {
    MODEL: MODEL,
    VALID_FROM: VALID_FROM,
    VALID_TO: VALID_TO,
    field: field,
    declination: declination,
    decimalYear: decimalYear,
    inRange: inRange
  };
});
