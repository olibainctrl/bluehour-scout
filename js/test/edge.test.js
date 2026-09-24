/*!
 * 蓝调勘景仪 Blue Hour Scout — js/test/edge.test.js
 *
 * 边界条件专项。这一套不测"正常情况对不对"，只测"特定条件下会不会炸
 * 或者悄悄给出错误结果"：夏令时、跨年、闰日、赤道、对跖经线、退化设置、
 * 脏数据。凡是抛错的都会被 harness 记成失败。
 */
(function () {
  'use strict';

  var T = BH.Test;
  var S = BH.Solar, Z = BH.Tz, H = BH.Horizon, E = BH.Exposure;
  var TL = BH.Timeline, C = BH.Cloud, W = BH.Weather;
  var Rec = BH.Records, Set = BH.Settings;

  var SYD = 'Australia/Sydney';

  function horizonFlat(v) {
    var p = H.empty();
    for (var i = 0; i < 36; i++) { p[i] = v; }
    return p;
  }

  function rec(over) {
    var r = {
      id: 'A', name: '测试', lat: -33.8599, lon: 151.2009, tz: SYD,
      horizon: horizonFlat(1), setups: null
    };
    if (over) { Object.keys(over).forEach(function (k) { r[k] = over[k]; }); }
    return r;
  }

  function settings(over) {
    var s = {
      camera: { isoLow: 400, isoHigh: 3200 },
      lenses: [{ name: 'L', maxAperture: 1.4 }],
      selectedLens: 0,
      blueRange: { upper: 0, lower: -9 },
      lights: [], setups: null
    };
    if (over) { Object.keys(over).forEach(function (k) { s[k] = over[k]; }); }
    return s;
  }

  function build(dateKey, r, s) {
    return TL.build({ rec: r || rec(), dateKey: dateKey, settings: s || settings(), calib: null });
  }

  // ==================================================== 日期边界

  T.suite('边界：夏令时、跨年、闰日', function () {

    T.test('夏令时结束当天（悉尼 2026-04-05，当地 25 小时）', function () {
      var r = build('2026-04-05');
      T.ok(r.ok, '时间轴构建成功');
      T.ok(r.rows.length > 80, '有 ' + r.rows.length + ' 行');
      T.equal(Z.offsetMinutes(r.stats.astroSunsetMs, SYD), 600, '日落时已是 UTC+10');
      var b = Z.dayBounds(SYD, 2026, 4, 5);
      T.equal(b.end - b.start, 25 * 3600000, '当天确实是 25 小时');
      T.ok(r.stats.blueMinutes > 0, '窗口时长 ' + r.stats.blueMinutes.toFixed(1) + ' 分钟');
      T.row(['2026-04-05 日落', Z.formatTime(r.stats.astroSunsetMs, SYD), 'UTC+10']);
    });

    T.test('夏令时开始当天（悉尼 2026-10-04，当地 23 小时）', function () {
      var r = build('2026-10-04');
      T.ok(r.ok, '时间轴构建成功');
      T.equal(Z.offsetMinutes(r.stats.astroSunsetMs, SYD), 660, '日落时已是 UTC+11');
      var b = Z.dayBounds(SYD, 2026, 10, 4);
      T.equal(b.end - b.start, 23 * 3600000, '当天确实是 23 小时');
      T.ok(r.stats.blueMinutes > 0, '窗口时长 ' + r.stats.blueMinutes.toFixed(1) + ' 分钟');
      T.row(['2026-10-04 日落', Z.formatTime(r.stats.astroSunsetMs, SYD), 'UTC+11']);
    });

    T.test('夏令时切换前后一天，日落时刻连续不跳变', function () {
      // 4/4 是 UTC+11 的 18:xx，4/5 变成 UTC+10 的 17:xx，当地钟面会跳一小时，
      // 但 UTC 绝对时刻应当是连续的（每天只差几分钟）
      var a = build('2026-04-04').stats.astroSunsetMs;
      var b = build('2026-04-05').stats.astroSunsetMs;
      var gapHours = (b - a) / 3600000;
      T.ok(gapHours > 23.5 && gapHours < 24.5,
           'UTC 绝对时刻相差 ' + gapHours.toFixed(2) + ' 小时，连续');
      T.row(['4/4 日落', Z.formatTime(a, SYD), Z.offsetLabel(a, SYD)]);
      T.row(['4/5 日落', Z.formatTime(b, SYD), Z.offsetLabel(b, SYD)]);
    });

    T.test('跨年：12/31 与次年 1/1', function () {
      var a = build('2026-12-31');
      var b = build('2027-01-01');
      T.ok(a.ok && b.ok, '两天都能算');
      T.ok(b.stats.astroSunsetMs > a.stats.astroSunsetMs, '1/1 的日落晚于 12/31');
      var gap = (b.stats.astroSunsetMs - a.stats.astroSunsetMs) / 3600000;
      T.ok(gap > 23.5 && gap < 24.5, '相差 ' + gap.toFixed(2) + ' 小时');
    });

    T.test('闰日 2028-02-29', function () {
      var r = build('2028-02-29');
      T.ok(r.ok, '闰日能算');
      T.equal(Z.dateKey(r.stats.astroSunsetMs, SYD), '2028-02-29', '日落确实落在闰日当天');
      var next = build('2028-03-01');
      T.ok(next.ok, '闰日次日也能算');
    });

    T.test('非闰年的 2/29 会被日期解析接住', function () {
      // Date.UTC(2027,1,29) 会滚到 3/1，这是 JS 的行为；关键是不能抛错
      var r = build('2027-02-29');
      T.ok(r.ok, '不抛错（日期会滚到 3/1）');
      T.ok(r.rows.length > 0, '仍然产出时间轴');
    });

    T.test('日期解析拒绝各种非法格式', function () {
      ['2026/09/22', '26-09-22', '2026-9-22', '', 'abc', null, undefined, '2026-09-22T10:00']
        .forEach(function (k) {
          T.isNull(Z.parseDateKey(k), String(k) + ' 被拒');
        });
      T.ok(!build('2026/09/22').ok, '时间轴对非法日期返回失败而不是抛错');
    });
  });

  // ==================================================== 地理边界

  T.suite('边界：极端坐标', function () {

    T.test('赤道', function () {
      var r = build('2026-03-20', rec({ lat: 0, lon: 0, tz: 'UTC' }));
      T.ok(r.ok, '赤道能算');
      T.ok(r.stats.blueMinutes > 15 && r.stats.blueMinutes < 40,
           '赤道窗口 ' + r.stats.blueMinutes.toFixed(1) + ' 分钟（太阳垂直下落，窗口最短）');
    });

    T.test('对跖经线 ±180 不会让方位角或时角算错', function () {
      var a = build('2026-06-21', rec({ lat: -17, lon: 179.9, tz: 'Pacific/Fiji' }));
      var b = build('2026-06-21', rec({ lat: -17, lon: -179.9, tz: 'Pacific/Fiji' }));
      T.ok(a.ok && b.ok, '两侧都能算');
      var d = Math.abs(a.stats.astroSunsetMs - b.stats.astroSunsetMs) / 60000;
      T.ok(d < 2, '经度只差 0.2°，日落时刻相差 ' + d.toFixed(2) + ' 分钟');
      var bad = a.rows.filter(function (w) { return !(w.azimuth >= 0 && w.azimuth < 360); });
      T.equal(bad.length, 0, '方位角全部落在 0–360');
    });

    T.test('北半球（验证不是只对南半球有效）', function () {
      var r = build('2026-06-21', rec({ lat: 51.5074, lon: -0.1278, tz: 'Europe/London' }));
      T.ok(r.ok, '伦敦夏至能算');
      // 伦敦 51.5°N，夏至太阳最低约 −15°：有航海昏影终（−12°），没有天文昏影终（−18°）
      T.notNull(r.stats.nauticalDuskMs, '伦敦夏至有航海昏影终');
      T.isNull(r.events.astronomicalDusk, '但没有天文昏影终');
      T.ok(!r.tailFallback, '不需要走兜底');
      var setAz = r.rows[TL.indexForTime(r, r.stats.astroSunsetMs)].azimuth;
      T.ok(setAz > 300 && setAz < 330, '夏至日落方位角 ' + setAz.toFixed(1) + '°（西偏北）');
    });

    T.test('高纬冬季：窗口很长', function () {
      var syd = build('2026-06-21').stats.blueMinutes;
      var lon = build('2026-12-21', rec({ lat: 51.5074, lon: -0.1278, tz: 'Europe/London' })).stats.blueMinutes;
      T.ok(lon > syd, '伦敦冬至 ' + lon.toFixed(0) + ' 分钟 > 悉尼冬至 ' + syd.toFixed(0) + ' 分钟');
    });

    T.test('坐标为 0 不被当成"没有坐标"', function () {
      var r = build('2026-03-20', rec({ lat: 0, lon: 0, tz: 'UTC' }));
      T.ok(r.ok, 'lat=0, lon=0 是合法坐标，不能被 falsy 判断误伤');
    });
  });

  // ==================================================== 退化设置

  T.suite('边界：退化的项目设置', function () {

    T.test('勘景点的帧率 / 快门角度没填或无效时按 24fps / 180° 算', function () {
      [{ fps: 0 }, { shutterAngle: 0 }, { fps: null }, { shutterAngle: null }, {},
       { fps: -24 }, { fps: 5000 }, { shutterAngle: 400 }, { fps: NaN },
       { fps: '50' }, { shutterAngle: '90' }].forEach(function (o) {
        var r = build('2026-06-21', rec(o));
        var label = JSON.stringify(o, function (k, v) { return v !== v ? 'NaN' : v; });
        T.ok(r.ok, label + ' 仍能构建');
        T.near(r.shutterSec, 1 / 48, 1e-12, label + ' → 1/48 秒', 's');
        T.ok(r.rows[0].low.n > 0 && isFinite(r.rows[0].low.n), 'T 档照常算出来');
        T.ok(r.rows[0].auto, '自动选择照常给出');
      });
    });

    T.test('快门速度无效时 T 档为空而不是 NaN（曝光层兜底）', function () {
      [[0, 24], [180, 0], [null, 24], [180, null], [-90, 24]].forEach(function (p) {
        var t = E.shutterSeconds(p[0], p[1]);
        T.isNull(t, p[0] + '° / ' + p[1] + 'fps → null');
        T.isNull(E.tStop(10, 400, t), '再往下算 T 档也是 null');
        T.isNull(E.chooseISO(10, 400, 3200, t, 1.4), '自动选择也是 null');
      });
    });

    T.test('没有镜头', function () {
      var r = build('2026-06-21', rec(), settings({ lenses: [], selectedLens: 0 }));
      T.ok(r.ok, '能构建');
      T.isNull(r.lens, '选不出镜头');
      T.ok(r.rows[0].auto, '仍然给出自动选择');
      T.ok(!r.rows[0].auto.overLens, '没有镜头约束就不报超限');
      T.equal(r.rows[0].auto.iso, 400, '一律用低原生 ISO');
    });

    T.test('selectedLens 越界', function () {
      [-1, 5, 99, null, undefined, 1.5].forEach(function (i) {
        var r = build('2026-06-21', rec(), settings({ selectedLens: i }));
        T.ok(r.ok, 'selectedLens=' + i + ' 时仍能构建');
        if (i === 1.5) { return; }   // 1.5 会被 pickLens 的整数下标判断挡掉
        T.isNull(r.lens, 'selectedLens=' + i + ' 时选不出镜头');
      });
    });

    T.test('镜头没填最大光圈', function () {
      var r = build('2026-06-21', rec(), settings({ lenses: [{ name: 'X', maxAperture: null }] }));
      T.ok(r.ok, '能构建');
      T.isNull(r.lens, '没填光圈的镜头不参与判断');
    });

    T.test('蓝调区间上下界相等：窗口为 0，不除零', function () {
      var r = build('2026-06-21', rec({ setups: 4 }), settings({ blueRange: { upper: -5, lower: -5 } }));
      T.ok(r.ok, '能构建');
      T.near(r.stats.blueMinutes, 0, 0.01, '窗口 0 分钟', '分');
      T.isNull(r.stats.budget, '窗口为 0 时不做拍摄量核算，避免除零');
      var bad = r.rows.filter(function (w) { return w.inBlue; });
      T.ok(bad.length <= 1, '至多一行落在区间内（得到 ' + bad.length + '）');
    });

    T.test('蓝调区间超出太阳能到达的范围', function () {
      var r = build('2026-06-21', rec(), settings({ blueRange: { upper: 80, lower: 70 } }));
      T.ok(r.ok, '能构建');
      T.isNull(r.stats.blueMinutes, '悉尼冬至太阳到不了 70°，窗口为 null');
      T.isNull(r.stats.budget, '不做核算');
    });

    T.test('setups 取值：记录优先、设置兜底', function () {
      // 规则在 core/timeline.js 里，界面层不重复
      var fromRec = build('2026-06-21', rec({ setups: 4 }), settings({ setups: 9 }));
      T.equal(fromRec.stats.budget.setups, 4, '记录上有就用记录上的');
      var fromSettings = build('2026-06-21', rec({ setups: null }), settings({ setups: 9 }));
      T.equal(fromSettings.stats.budget.setups, 9, '记录上没有就用设置里的');
      var neither = build('2026-06-21', rec({ setups: null }), settings({ setups: null }));
      T.isNull(neither.stats.budget, '两边都没有就不做核算');
    });

    T.test('budgetFor 是纯函数，界面和核心共用同一份逻辑', function () {
      T.isNull(TL.budgetFor(45, null), 'setup 数为 null');
      T.isNull(TL.budgetFor(45, 0), 'setup 数为 0');
      T.isNull(TL.budgetFor(45, -2), 'setup 数为负');
      T.isNull(TL.budgetFor(null, 4), '窗口为 null');
      T.isNull(TL.budgetFor(0, 4), '窗口为 0，避免除零');
      T.isNull(TL.budgetFor(NaN, 4), '窗口为 NaN');
      T.isNull(TL.budgetFor(45, NaN), 'setup 数为 NaN');
      var b = TL.budgetFor(45, 4);
      T.near(b.perSetup, 11.25, 1e-9, '45 分钟 4 个 setup → 每个 11.25 分钟', '分');
      T.ok(b.ok, '够用');
      T.equal(b.maxSetups, 5, '最多 5 个');
      T.equal(b.cut, 0, '不用削减');
      var tight = TL.budgetFor(45, 9);
      T.ok(!tight.ok, '9 个不够用');
      T.equal(tight.cut, 4, '建议削减 4 个');
      T.equal(TL.budgetFor(45, 4.4).setups, 4, '小数会取整');
      // 和 build() 走的是同一条路
      var r = build('2026-06-21', rec({ setups: 4 }));
      T.equal(r.stats.budget.setups, TL.budgetFor(r.stats.blueMinutes, 4).setups,
              'build() 里的核算与直接调用一致');
      T.near(r.stats.budget.perSetup, TL.budgetFor(r.stats.blueMinutes, 4).perSetup, 1e-12,
             '每个 setup 时间一致', '分');
    });

    T.test('setups 极值', function () {
      var zero = build('2026-06-21', rec({ setups: 0 }));
      T.isNull(zero.stats.budget, 'setups=0 不做核算');
      var huge = build('2026-06-21', rec({ setups: 999 }));
      T.ok(huge.stats.budget, 'setups=999 仍给核算');
      T.ok(!huge.stats.budget.ok, '明确不够用');
      T.ok(huge.stats.budget.cut > 0, '建议削减 ' + huge.stats.budget.cut + ' 个');
      T.ok(isFinite(huge.stats.budget.perSetup), '每个 setup 时间是有限数');
      var neg = build('2026-06-21', rec({ setups: -3 }));
      T.isNull(neg.stats.budget, '负数不做核算');
    });

    T.test('灯具照度为 0 / 负数 / 极大', function () {
      var r = build('2026-06-21', rec(), settings({ lights: [
        { name: 'a', lux: 0 }, { name: 'b', lux: -5 }, { name: 'c', lux: null },
        { name: 'd', lux: 1e12 }, { name: 'e', lux: 1e-6 }
      ] }));
      T.ok(r.ok, '能构建');
      T.equal(r.stats.lights.length, 0,
              '无效照度全部跳过，极端值因为没有交叉点也不入表（得到 ' + r.stats.lights.length + '）');
    });

    T.test('ISO 高低档写反了也不崩', function () {
      var r = build('2026-06-21', rec(), settings({
        camera: { isoLow: 3200, isoHigh: 400 }
      }));
      T.ok(r.ok, '能构建');
      T.ok(isFinite(r.rows[0].low.n) && isFinite(r.rows[0].high.n), '两档都算得出');
    });
  });

  // ==================================================== 摄影机列表

  T.suite('边界：摄影机列表', function () {

    T.test('旧数据（单个 camera 对象）自动迁成列表，机器能力不丢', function () {
      var old = { camera: { name: '旧机器', isoLow: 800, isoHigh: 12800, fps: 25, shutterAngle: 172.8 } };
      var s = Set.normalize(old);
      T.equal(s.cameras.length, 1, '迁成只有一台的列表');
      T.equal(s.cameras[0].name, '旧机器', '名字保留');
      T.equal(s.cameras[0].isoLow, 800, '低原生 ISO 保留');
      T.equal(s.cameras[0].isoHigh, 12800, '高原生 ISO 保留');
      // 帧率和快门角度现在属于勘景点，机器上的旧值丢掉
      T.ok(!('fps' in s.cameras[0]) && !('shutterAngle' in s.cameras[0]),
           '机器上不再带帧率和快门角度');
      T.equal(s.selectedCamera, 0, '选中第一台');
      T.equal(s.camera.name, '旧机器', '派生的 camera 指向它');
    });

    T.test('多台摄影机时 camera 派生为当前选中的那台', function () {
      var s = Set.normalize({
        cameras: [
          { name: 'A 机', isoLow: 400, isoHigh: 3200 },
          { name: 'B 机', isoLow: 800, isoHigh: 12800 }
        ],
        selectedCamera: 1
      });
      T.equal(s.camera.name, 'B 机', '派生出 B 机');
      T.equal(s.camera.isoHigh, 12800, 'B 机的高原生 ISO');
      // cameras 和旧的 camera 同时存在时以列表为准（camera 只是派生出来的副本）
      var s2 = Set.normalize({ cameras: s.cameras, selectedCamera: 0, camera: { name: '过期的副本' } });
      T.equal(s2.camera.name, 'A 机', '忽略存盘里过期的 camera 副本');
    });

    T.test('selectedCamera 越界时回到第一台', function () {
      var cams = [{ name: 'A', isoLow: 400, isoHigh: 3200 }];
      [5, -1, 'x', null, undefined].forEach(function (v) {
        T.equal(Set.normalize({ cameras: cams, selectedCamera: v }).selectedCamera, 0,
                'selectedCamera=' + v + ' → 0');
      });
    });

    T.test('空列表或全是垃圾时回到默认的一台', function () {
      [[], [null, 3, 'x'], null].forEach(function (list, i) {
        var s = Set.normalize({ cameras: list });
        T.equal(s.cameras.length, 1, '第 ' + i + ' 种情况：至少有一台');
        T.ok(s.camera && s.camera.isoLow > 0 && s.camera.isoHigh >= s.camera.isoLow,
             '派生的 camera 可用');
      });
    });

    T.test('单原生 ISO：高档不填就等于低档；写反了就对调', function () {
      var one = Set.normalize({ cameras: [{ name: 'Alexa', isoLow: 800 }] }).camera;
      T.equal(one.isoHigh, 800, '高档没填 → 等于低档');
      var rev = Set.normalize({ cameras: [{ name: 'X', isoLow: 3200, isoHigh: 400 }] }).camera;
      T.equal(rev.isoLow, 400, '写反了：低档对调回 400');
      T.equal(rev.isoHigh, 3200, '高档对调回 3200');
    });

    T.test('单原生 ISO 的机器不报"已切到高原生 ISO"', function () {
      var t = E.shutterSeconds(180, 24);
      var r = E.chooseISO(1, 800, 800, t, 1.4);
      T.ok(!r.switched, '没得切，switched 为 false');
      T.equal(r.iso, 800, '始终用 ISO 800');
      T.ok(r.overLens, '暗到开不到时照样报超限');
      var r2 = E.chooseISO(1, 800, null, t, 1.4);
      T.ok(!r2.switched, '高档为 null 时同样不切');
    });

    T.test('时间轴按勘景点的帧率和快门角度算快门', function () {
      var a = build('2026-06-21', rec({ fps: 24, shutterAngle: 180 }));
      var b = build('2026-06-21', rec({ fps: 50, shutterAngle: 180 }));
      T.near(a.shutterSec, 1 / 48, 1e-12, '24fps / 180° → 1/48 秒', 's');
      T.near(b.shutterSec, 1 / 100, 1e-12, '50fps / 180° → 1/100 秒', 's');
      T.equal(b.shoot.fps, 50, '结果里带着用的帧率');
      T.ok(a.rows[60].low.n > b.rows[60].low.n,
           '同一分钟 50fps 快门更短，需要的光圈更大（T 值更小）：24fps ' + a.rows[60].low.n.toFixed(2) +
           ' / 50fps ' + b.rows[60].low.n.toFixed(2));
      var flick = build('2026-06-21', rec({ fps: 24, shutterAngle: 172.8 }));
      T.near(flick.shutterSec, 1 / 50, 1e-12, '24fps / 172.8° → 1/50 秒（50Hz 不闪）', 's');
    });

    T.test('换机器只换原生 ISO，不动快门', function () {
      var cams = [{ name: 'A 机', isoLow: 400, isoHigh: 3200 },
                  { name: 'B 机', isoLow: 800, isoHigh: 12800 }];
      var r = rec({ fps: 25, shutterAngle: 180 });
      var a = build('2026-06-21', r, Set.normalize({ cameras: cams, selectedCamera: 0 }));
      var b = build('2026-06-21', r, Set.normalize({ cameras: cams, selectedCamera: 1 }));
      T.equal(a.shutterSec, b.shutterSec, '两台机器快门一样：都是勘景点上的 25fps / 180°');
      T.equal(a.isoHigh, 3200, 'A 机高档 3200');
      T.equal(b.isoHigh, 12800, 'B 机高档 12800');
    });

    T.test('镜头删光之后就是空列表，不会冒出默认镜头', function () {
      // 曾经的 bug：normalize 遇到空数组会退回六支默认镜头，
      // 在设置里把镜头删光、一存盘，默认镜头又全回来了
      var s = Set.normalize({ lenses: [], selectedLens: 3 });
      T.equal(s.lenses.length, 0, '空列表照收');
      T.isNull(s.selectedLens, '没有镜头时 selectedLens 为 null');
      var junk = Set.normalize({ lenses: [{ name: '' }, null], selectedLens: 3 });
      T.equal(junk.lenses.length, 0, '全是无效条目时也是空列表');
      T.equal(Set.normalize({}).lenses.length, 6, '根本没有 lenses 字段时才用默认的六支');
      T.equal(Set.normalize({ lenses: 'garbage' }).lenses.length, 6, 'lenses 不是数组时用默认');
      var r = build('2026-06-21', rec(), s);
      T.ok(r.ok, '没有镜头时时间轴照常能算');
      T.isNull(r.lens, '只是不做光圈约束');
    });
  });

  // ==================================================== 退化记录

  T.suite('边界：退化的勘景记录', function () {

    T.test('剖面只有一个采样点', function () {
      var p = H.empty(); p[18] = 5;
      var r = build('2026-06-21', rec({ horizon: p }));
      T.ok(r.ok, '能构建');
      T.ok(r.hasHorizon, '算作有剖面');
      var bad = r.rows.filter(function (w) { return w.horizonElev !== 5; });
      T.equal(bad.length, 0, '所有方位都取到那一个值');
    });

    T.test('剖面全为负值（站在高处俯视）', function () {
      var r = build('2026-06-21', rec({ horizon: horizonFlat(-5) }));
      T.ok(r.ok, '能构建');
      T.notNull(r.stats.realSunsetMs, '仍能检测到遮挡时刻');
      T.ok(r.stats.sunsetShiftMinutes < 0,
           '真实日落比天文日落**晚** ' + Math.abs(r.stats.sunsetShiftMinutes).toFixed(1) +
           ' 分钟（站得高看得远）');
    });

    T.test('剖面里有极端值', function () {
      var p = horizonFlat(0);
      p[27] = 89; p[9] = -89;
      var r = build('2026-06-21', rec({ horizon: p }));
      T.ok(r.ok, '能构建');
      var bad = r.rows.filter(function (w) { return !isFinite(w.horizonElev); });
      T.equal(bad.length, 0, '插值结果全部有限');
    });

    T.test('没有名字 / 空字符串名字', function () {
      T.ok(build('2026-06-21', rec({ name: '' })).ok, '空名字能算');
      T.ok(build('2026-06-21', rec({ name: null })).ok, 'null 名字能算');
    });

    T.test('时区无效时明确拒绝而不是算错', function () {
      var r = build('2026-06-21', rec({ tz: 'Mars/Olympus' }));
      T.ok(!r.ok, '构建失败');
      T.ok(/时区/.test(r.error), '错误信息提到时区：' + r.error);
    });

    T.test('坐标为 null / undefined / NaN', function () {
      [null, undefined, NaN].forEach(function (v) {
        var r = build('2026-06-21', rec({ lat: v }));
        T.ok(!r.ok || !isFinite(r.stats.astroSunsetMs),
             'lat=' + v + ' 时不会给出看似有效的结果');
      });
    });
  });

  // ==================================================== 脏数据规整

  T.suite('边界：脏数据规整', function () {

    T.test('记录规整能接住任意垃圾', function () {
      var junk = [
        null, undefined, 0, '', [], 'string', 42,
        { lat: 'abc', lon: {}, horizon: 'not an array', tz: 123, notes: [] },
        { lat: 1e9, lon: -1e9, heading: 720, headingOffset: 'x', setups: 1e6 },
        { name: new Array(500).join('长'), notes: new Array(9000).join('x') }
      ];
      junk.forEach(function (j, i) {
        var r = Rec.normalize(j);
        T.ok(r && typeof r === 'object', '第 ' + i + ' 个输入产出对象');
        T.equal(r.horizon.length, 36, '剖面恒为 36 元素');
        T.ok(r.lat === null || (r.lat >= -90 && r.lat <= 90), '纬度合法或为 null');
        T.ok(r.lon === null || (r.lon >= -180 && r.lon <= 180), '经度合法或为 null');
        T.ok(r.heading === null || (r.heading >= 0 && r.heading < 360), '方位角合法或为 null');
        T.ok(r.name.length <= 120, '名字被截到 120 字以内');
        T.ok(r.notes.length <= 4000, '备注被截到 4000 字以内');
      });
    });

    T.test('设置规整能接住任意垃圾', function () {
      var junk = [
        null, undefined, 'x', 42, [],
        { camera: 'no', lenses: 'no', lights: 'no', blueRange: 'no' },
        { camera: { fps: -1, shutterAngle: 9999, isoLow: 'x', isoHigh: -5 },
          lenses: [{ name: '' }, { maxAperture: 3 }, null, 5],
          lights: [{ name: 'a', lux: 'x', distance: -1 }],
          blueRange: { upper: 'a', lower: 999 }, selectedLens: 'x', setups: 'x' }
      ];
      junk.forEach(function (j, i) {
        var s = Set.normalize(j);
        T.ok(s.camera.isoLow > 0, '第 ' + i + ' 个：原生 ISO 为正');
        T.ok(s.camera.isoHigh >= s.camera.isoLow, '高档不低于低档');
        T.ok(!('fps' in s.camera), '机器上不带帧率');
        T.ok(Array.isArray(s.lenses), '镜头是数组');
        T.ok(Array.isArray(s.lights), '灯具是数组');
        T.ok(isFinite(s.blueRange.upper) && isFinite(s.blueRange.lower), '蓝调区间是数值');
        T.ok(s.blueRange.lower <= s.blueRange.upper, '上下界有序');
      });
    });

    T.test('规整后的设置一定能喂给时间轴', function () {
      var s = Set.normalize({ camera: { fps: -1 }, lenses: [], lights: [{ name: 'x', lux: 'y' }] });
      var r = build('2026-06-21', rec(), s);
      T.ok(r.ok, '脏设置规整后仍能算出时间轴');
      T.ok(r.rows.length > 0, '有 ' + r.rows.length + ' 行');
    });

    T.test('剖面规整的边界值', function () {
      T.isNull(H.normalize([90])[0], '正好 90° 视为无效');
      T.isNull(H.normalize([-90])[0], '正好 −90° 视为无效');
      T.equal(H.normalize([89.9])[0], 89.9, '89.9° 有效');
      T.equal(H.normalize([-89.9])[0], -89.9, '−89.9° 有效');
      T.equal(H.normalize([0])[0], 0, '0° 有效（不能被 falsy 误伤）');
      T.equal(H.normalize(['0'])[0], 0, '字符串 "0" 有效');
    });

    T.test('勘景点的帧率和快门角度：合法的保留，其余记成 null', function () {
      var ok = Rec.normalize({ fps: 23.976, shutterAngle: 172.8 });
      T.equal(ok.fps, 23.976, '23.976 保留');
      T.equal(ok.shutterAngle, 172.8, '172.8° 保留');
      T.equal(Rec.normalize({ fps: '50', shutterAngle: '90' }).fps, 50, '字符串数字照收');
      [0, -1, 1001, 'x', NaN, Infinity, null, undefined, {}].forEach(function (v) {
        T.isNull(Rec.normalize({ fps: v }).fps, '帧率 ' + String(v) + ' → null');
      });
      [0, 361, -90, 'x', null].forEach(function (v) {
        T.isNull(Rec.normalize({ shutterAngle: v }).shutterAngle, '快门角度 ' + String(v) + ' → null');
      });
      var fresh = Rec.create({ name: '新点' });
      T.isNull(fresh.fps, '新记录不预设帧率（按 24fps 算）');
      T.isNull(fresh.shutterAngle, '新记录不预设快门角度（按 180° 算）');
      var p = TL.shootParams(fresh);
      T.equal(p.fps, 24, '没填 → 24fps');
      T.equal(p.shutterAngle, 180, '没填 → 180°');
    });

    T.test('方位角 360 被归到 0', function () {
      var r = Rec.normalize({ heading: 360 });
      T.equal(r.heading, 0, '360° → 0°');
      T.equal(H.norm360(360), 0, 'norm360(360) = 0');
      T.equal(H.norm360(-1e-15), 0, '极小负数不返回 360');
      T.equal(H.sectorFor(359.9999), 0, '359.9999° 落到扇区 0');
    });
  });

  // ==================================================== 云量边界

  T.suite('边界：云量与天气接口', function () {

    T.test('窗口落在预报范围之外', function () {
      var h = { time: [Date.UTC(2026, 0, 1) / 1000] };
      C.FIELDS.forEach(function (f) { h[f] = [50]; });
      var far = C.aggregate(h, Date.UTC(2027, 0, 1), Date.UTC(2027, 0, 1) + 3600000);
      T.equal(far.coverage, 0, '完全没覆盖');
      T.isNull(far.cloud_cover_low, '不给假数据');
      T.equal(C.verdict(far.cloud_cover_low, far.cloud_cover_high).label, '无数据', '结论为无数据');
    });

    T.test('逐日汇总里混有无窗口的日子', function () {
      var h = { time: [Date.UTC(2026, 0, 1) / 1000] };
      C.FIELDS.forEach(function (f) { h[f] = [10]; });
      var rows = C.buildRows(h, [
        { dateKey: '2026-01-01', startMs: Date.UTC(2026, 0, 1), endMs: Date.UTC(2026, 0, 1) + 1800000 },
        { dateKey: '2026-01-02', startMs: null, endMs: null },
        { dateKey: '2026-01-03', startMs: null, endMs: Date.UTC(2026, 0, 3) }
      ]);
      T.equal(rows.length, 3, '三行都在');
      T.equal(rows[0].verdict.label, '好', '有数据的那天正常出结论');
      T.equal(rows[1].verdict.label, '无窗口', '无窗口的那天标出来');
      T.equal(rows[2].verdict.label, '无窗口', 'start 为 null 也算无窗口');
    });

    T.test('接口 URL 对极端坐标仍然合法', function () {
      [[0, 0], [90, 180], [-90, -180], [-33.8599, 151.2009]].forEach(function (c) {
        var u = W.buildURL(c[0], c[1]);
        T.ok(u.indexOf('latitude=' + c[0].toFixed(4)) >= 0, c.join(',') + ' 纬度正确');
        T.ok(u.indexOf('undefined') < 0 && u.indexOf('NaN') < 0, c.join(',') + ' URL 里没有 NaN');
      });
    });

    T.test('缓存键对负零和极端坐标稳定', function () {
      T.equal(W.cacheKey(0, 0), W.cacheKey(-0, -0), '负零与正零同键');
      T.ok(W.cacheKey(90, 180).indexOf('NaN') < 0, '极点坐标不产生 NaN 键');
    });
  });

  // ==================================================== 数值健全性

  T.suite('边界：全年逐日跑一遍，确保没有 NaN 泄漏', function () {

    T.test('2026 全年 × 四个纬度，所有输出都是有限数', function () {
      var places = [
        { name: '悉尼', lat: -33.86, lon: 151.21, tz: SYD },
        { name: '赤道', lat: 0, lon: 0, tz: 'UTC' },
        { name: '伦敦', lat: 51.51, lon: -0.13, tz: 'Europe/London' },
        { name: '雷克雅未克', lat: 64.15, lon: -21.94, tz: 'Atlantic/Reykjavik' }
      ];
      var s = settings({ lights: [{ name: 'L', lux: 300 }] });
      var checked = 0, nanFields = [], failedDays = 0;

      places.forEach(function (P) {
        for (var m = 1; m <= 12; m++) {
          var key = '2026-' + Z.pad(m, 2) + '-15';
          var r = TL.build({
            rec: rec({ lat: P.lat, lon: P.lon, tz: P.tz, setups: 3 }),
            dateKey: key, settings: s, calib: { a: 1.05, b: -0.3 }
          });
          if (!r.ok) { failedDays++; continue; }
          for (var i = 0; i < r.rows.length; i += 7) {
            var w = r.rows[i];
            ['altitude', 'azimuth', 'ev100', 'cct'].forEach(function (f) {
              checked++;
              if (!isFinite(w[f])) { nanFields.push(P.name + ' ' + key + ' ' + f); }
            });
            if (w.low.n !== null && !isFinite(w.low.n)) { nanFields.push(P.name + ' low.n'); }
            if (w.auto && !isFinite(w.auto.n)) { nanFields.push(P.name + ' auto.n'); }
          }
          if (r.stats.blueMinutes !== null && !isFinite(r.stats.blueMinutes)) {
            nanFields.push(P.name + ' ' + key + ' blueMinutes');
          }
          if (r.stats.budget && !isFinite(r.stats.budget.perSetup)) {
            nanFields.push(P.name + ' ' + key + ' perSetup');
          }
        }
      });

      T.ok(checked > 1000, '检查了 ' + checked + ' 个数值');
      T.equal(nanFields.length, 0,
              'NaN / Infinity 泄漏：' + (nanFields.slice(0, 5).join('、') || '无'));
      T.row(['构建失败的天数', failedDays, '（极昼极夜属正常）']);
    });

    T.test('EV 与色温模型在 −40°…+40° 全程有限', function () {
      var bad = 0;
      for (var a = -40; a <= 40; a += 0.25) {
        if (!isFinite(E.baseEV100(a)) || !isFinite(E.colorTempAt(a))) { bad++; }
        if (!isFinite(E.ev100At(a, { a: 1.3, b: -2 }))) { bad++; }
      }
      T.equal(bad, 0, '321 个采样点全部有限');
    });
  });
}());
