/*!
 * 蓝调勘景仪 Blue Hour Scout — js/ui/horizon-ui.js
 *
 * 地平线遮挡剖面的采集界面。整个工具的核心。
 *
 * 用法：竖着举手机，像拍照一样用背面对准天际线，**缓慢转一圈**。
 * 每 10° 一个扇区，在一个扇区里停住约半秒就自动记下该方向的天际线仰角。
 * 罗盘不可用时退化成 36 格手动输入，功能不缺。
 *
 * 采到的值会自动存盘（防止转到一半丢数据），不需要手动点保存。
 */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  root.BH = root.BH || {};
  root.BH.HorizonUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var A = null, H = null, C = null, R = null, VF = null;
  function deps() {
    A = A || root.BH.App; H = H || root.BH.Horizon;
    C = C || root.BH.Compass; R = R || root.BH.Records;
    VF = VF || root.BH.Viewfinder;
  }

  // 落点规则有两条，缺一不可：
  //   1) 停住不动 —— 在一个扇区里停满 HOLD_MS 就立刻落点，方便对着某个
  //      方向仔细瞄；落点后继续停留会持续用新的中位数refine，可以纠正。
  //   2) 扫过去 —— 离开一个扇区时，只要在里面攒够了样本也落点。
  //      早先只有第 1 条，结果是转速稍快一点（>18°/秒）就一个都采不到，
  //      而且界面完全不解释为什么，看着像坏了。
  var HOLD_MS = 450;          // 停住多久立刻落点
  var MIN_SAMPLES = 5;        // 一个扇区至少要攒到几个读数才算数
  var MIN_TRANSIT_MS = 120;   // 扫过去时在扇区里至少要待这么久
  var TOO_FAST_HINT = 3;      // 连续漏掉几个扇区就提示转慢点
  var SAVE_DEBOUNCE = 700;    // 停手多久后存盘
  var SAVE_MAX_WAIT = 2500;   // 但最多拖这么久必须存一次

  // 罗盘玫瑰的几何。画布必须装得下最外面那一圈东西——方位标注和机位朝向
  // 的小三角都在外环之外，早先 viewBox 开小了，标注被裁掉一半，
  // 「北」只剩下半截，看着像个别的字。GEOM 下面有断言守着这件事。
  var VIEW = 280;
  var CX = 140, CY = 140, R_OUT = 104, R_IN = 50;
  var LABEL_R = R_OUT + 22;          // 方位标注文字中心的半径
  var LABEL_HALF = 8;                // 字形半高（含少量余量）
  var NEEDLE_R = R_OUT + 6;          // 当前朝向指针的针尖
  var AIM_R0 = R_OUT + 5, AIM_R1 = R_OUT + 12;   // 机位朝向小三角（要躲开方位标注）

  function rad(a) { return (a - 90) * Math.PI / 180; }
  function px(az, r) { return [CX + r * Math.cos(rad(az)), CY + r * Math.sin(rad(az))]; }
  function f2(n) { return Math.round(n * 100) / 100; }

  function median(arr) {
    if (!arr.length) { return null; }
    var s = arr.slice().sort(function (a, b) { return a - b; });
    var m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }

  /** 仰角刻度范围。按 5° 取整，避免采样过程中刻度不停跳动。 */
  function scaleOf(profile) {
    var st = H.stats(profile);
    var lo = -3, hi = 12;
    if (st.count) {
      lo = Math.min(lo, Math.floor(st.min / 5) * 5);
      hi = Math.max(hi, Math.ceil(st.max / 5) * 5);
    }
    if (hi - lo < 10) { hi = lo + 10; }
    return { lo: lo, hi: hi };
  }

  // ------------------------------------------------------------ 罗盘玫瑰

  function createRose() {
    deps();
    var sectors = [], ghosts = [];
    var g = A.svg('g');

    // 未采样扇区的暗底
    for (var i = 0; i < H.SECTORS; i++) {
      var ghost = A.svg('path', { fill: '#131319', stroke: '#1f1f28', 'stroke-width': .5 });
      ghosts.push(ghost); g.appendChild(ghost);
    }
    for (var j = 0; j < H.SECTORS; j++) {
      var p = A.svg('path', { fill: '#c98a2f', 'fill-opacity': .85, stroke: 'none' });
      sectors.push(p); g.appendChild(p);
    }

    var ring = A.svg('circle', {
      cx: CX, cy: CY, r: R_IN - 7, fill: 'none',
      stroke: '#2a2a35', 'stroke-width': 3
    });
    var dwellArc = A.svg('circle', {
      cx: CX, cy: CY, r: R_IN - 7, fill: 'none',
      stroke: '#ffb340', 'stroke-width': 3, 'stroke-linecap': 'round',
      transform: 'rotate(-90 ' + CX + ' ' + CY + ')',
      'stroke-dasharray': '0 999'
    });
    var needle = A.svg('path', { fill: '#ffb340', stroke: 'none', 'fill-opacity': .95 });
    var aimTick = A.svg('path', { fill: '#7fb069', stroke: 'none', 'fill-opacity': .9 });

    var labels = A.svg('g');
    [['北', 0], ['东', 90], ['南', 180], ['西', 270]].forEach(function (c) {
      var pt = px(c[1], LABEL_R);
      labels.appendChild(A.svg('text', {
        x: f2(pt[0]), y: f2(pt[1] + 4), 'text-anchor': 'middle',
        fill: '#6b6459', 'font-size': 12, 'font-family': 'ui-monospace,Menlo,monospace'
      }, c[0]));
    });

    var node = A.svg('svg', {
      class: 'rose', viewBox: '0 0 ' + VIEW + ' ' + VIEW, role: 'img',
      'aria-label': '地平线剖面罗盘图'
    }, [g, ring, dwellArc, needle, aimTick, labels]);

    function wedge(az, r0, r1) {
      var a0 = az - H.SECTOR_DEG / 2 + 0.5, a1 = az + H.SECTOR_DEG / 2 - 0.5;
      var p0 = px(a0, r0), p1 = px(a0, r1), p2 = px(a1, r1), p3 = px(a1, r0);
      return 'M' + f2(p0[0]) + ' ' + f2(p0[1]) +
             'L' + f2(p1[0]) + ' ' + f2(p1[1]) +
             'A' + r1 + ' ' + r1 + ' 0 0 1 ' + f2(p2[0]) + ' ' + f2(p2[1]) +
             'L' + f2(p3[0]) + ' ' + f2(p3[1]) +
             'A' + r0 + ' ' + r0 + ' 0 0 0 ' + f2(p0[0]) + ' ' + f2(p0[1]) + 'Z';
    }

    function update(profile, heading, aimHeading, dwellFrac, dwellSector) {
      var sc = scaleOf(profile);
      for (var i = 0; i < H.SECTORS; i++) {
        var az = H.azimuthOf(i);
        var v = profile[i];
        var isDwell = dwellSector === i;
        if (typeof v === 'number' && isFinite(v)) {
          var t = (v - sc.lo) / (sc.hi - sc.lo);
          if (t < 0) { t = 0; } else if (t > 1) { t = 1; }
          var r = R_IN + t * (R_OUT - R_IN);
          if (r < R_IN + 2) { r = R_IN + 2; }
          sectors[i].setAttribute('d', wedge(az, R_IN, r));
          sectors[i].setAttribute('fill', isDwell ? '#ffb340' : '#c98a2f');
          sectors[i].setAttribute('fill-opacity', isDwell ? 1 : .85);
          ghosts[i].setAttribute('fill-opacity', .25);
        } else {
          sectors[i].setAttribute('d', '');
          ghosts[i].setAttribute('fill-opacity', 1);
        }
        ghosts[i].setAttribute('d', wedge(az, R_IN, R_OUT));
        ghosts[i].setAttribute('stroke', isDwell ? '#4d3d1d' : '#1f1f28');
      }

      if (heading === null || heading === undefined) {
        needle.setAttribute('d', '');
      } else {
        var tip = px(heading, NEEDLE_R);
        var l = px(heading - 3.2, R_IN - 14), rr = px(heading + 3.2, R_IN - 14);
        needle.setAttribute('d',
          'M' + f2(tip[0]) + ' ' + f2(tip[1]) +
          'L' + f2(l[0]) + ' ' + f2(l[1]) +
          'L' + f2(rr[0]) + ' ' + f2(rr[1]) + 'Z');
      }

      if (aimHeading === null || aimHeading === undefined) {
        aimTick.setAttribute('d', '');
      } else {
        var t0 = px(aimHeading, AIM_R0), t1 = px(aimHeading - 2.6, AIM_R1),
            t2 = px(aimHeading + 2.6, AIM_R1);
        aimTick.setAttribute('d',
          'M' + f2(t0[0]) + ' ' + f2(t0[1]) +
          'L' + f2(t1[0]) + ' ' + f2(t1[1]) +
          'L' + f2(t2[0]) + ' ' + f2(t2[1]) + 'Z');
      }

      var circ = 2 * Math.PI * (R_IN - 7);
      var on = circ * Math.max(0, Math.min(1, dwellFrac || 0));
      dwellArc.setAttribute('stroke-dasharray', f2(on) + ' ' + f2(circ));
    }

    return { node: node, update: update };
  }

  // -------------------------------------------------------------- 剖面条

  var SW = 366, SH = 116, SPAD_L = 3, STOP = 16, SBOT = 96;

  function createStrip() {
    deps();
    var area = A.svg('path', { fill: '#c98a2f', 'fill-opacity': .22, stroke: 'none' });
    var line = A.svg('path', { fill: 'none', stroke: '#c98a2f', 'stroke-width': 1.4 });
    var gaps = A.svg('g');
    var dots = A.svg('g');
    var grid = A.svg('g');
    var cursor = A.svg('line', { stroke: '#ffb340', 'stroke-width': 1.2, 'stroke-opacity': .9 });
    var axis = A.svg('g');

    var node = A.svg('svg', {
      class: 'strip', viewBox: '0 0 ' + SW + ' ' + SH, role: 'img',
      'aria-label': '地平线剖面展开图'
    }, [grid, gaps, area, line, dots, cursor, axis]);

    function x(az) { return SPAD_L + az; }
    function y(el, sc) {
      var t = (el - sc.lo) / (sc.hi - sc.lo);
      if (t < 0) { t = 0; } else if (t > 1) { t = 1; }
      return SBOT - t * (SBOT - STOP);
    }

    function update(profile, heading) {
      var sc = scaleOf(profile);
      var n = H.count(profile);

      A.clear(grid); A.clear(dots); A.clear(gaps); A.clear(axis);

      // 0° 水平线和刻度
      [0, sc.hi].forEach(function (lv) {
        if (lv < sc.lo || lv > sc.hi) { return; }
        var yy = f2(y(lv, sc));
        grid.appendChild(A.svg('line', {
          x1: SPAD_L, y1: yy, x2: SPAD_L + 360, y2: yy,
          stroke: lv === 0 ? '#2e2e3a' : '#1c1c24', 'stroke-width': 1,
          'stroke-dasharray': lv === 0 ? '' : '2 4'
        }));
        grid.appendChild(A.svg('text', {
          x: SPAD_L + 2, y: yy - 3, fill: '#4a453d', 'font-size': 8,
          'font-family': 'ui-monospace,Menlo,monospace'
        }, (lv > 0 ? '+' : '') + lv + '°'));
      });

      // 未采样的方位段压暗
      H.missingRanges(profile).forEach(function (rg) {
        var from = rg.from, to = rg.to;
        var spans = (to > from) ? [[from, to]] : [[from, 360], [0, to]];
        spans.forEach(function (s) {
          gaps.appendChild(A.svg('rect', {
            x: f2(x(s[0])), y: STOP - 4, width: f2(s[1] - s[0]), height: SBOT - STOP + 8,
            fill: '#0b0b10', 'fill-opacity': .72
          }));
        });
      });

      if (n === 0) {
        area.setAttribute('d', ''); line.setAttribute('d', '');
      } else {
        var d = '', dl = '';
        for (var az = 0; az <= 360; az += 2) {
          var v = H.elevationAt(profile, az % 360);
          var pxx = f2(x(az)), pyy = f2(y(v, sc));
          dl += (az === 0 ? 'M' : 'L') + pxx + ' ' + pyy;
        }
        d = dl + 'L' + f2(x(360)) + ' ' + (SBOT + 6) + 'L' + f2(x(0)) + ' ' + (SBOT + 6) + 'Z';
        area.setAttribute('d', d);
        line.setAttribute('d', dl);

        for (var i = 0; i < H.SECTORS; i++) {
          if (typeof profile[i] !== 'number') { continue; }
          dots.appendChild(A.svg('circle', {
            cx: f2(x(H.azimuthOf(i))), cy: f2(y(profile[i], sc)), r: 1.9,
            fill: '#ffb340'
          }));
        }
      }

      [[0, '北'], [90, '东'], [180, '南'], [270, '西'], [360, '北']].forEach(function (t) {
        axis.appendChild(A.svg('line', {
          x1: f2(x(t[0])), y1: SBOT, x2: f2(x(t[0])), y2: SBOT + 4,
          stroke: '#2e2e3a', 'stroke-width': 1
        }));
        axis.appendChild(A.svg('text', {
          x: f2(x(t[0])), y: SH - 2, 'text-anchor': t[0] === 0 ? 'start' : (t[0] === 360 ? 'end' : 'middle'),
          fill: '#4a453d', 'font-size': 9, 'font-family': 'ui-monospace,Menlo,monospace'
        }, t[1] + ' ' + t[0] + '°'));
      });

      if (heading === null || heading === undefined) {
        cursor.setAttribute('x1', -10); cursor.setAttribute('x2', -10);
      } else {
        var cx = f2(x(H.norm360(heading)));
        cursor.setAttribute('x1', cx); cursor.setAttribute('y1', STOP - 4);
        cursor.setAttribute('x2', cx); cursor.setAttribute('y2', SBOT + 4);
      }
    }

    return { node: node, update: update };
  }

  // -------------------------------------------------------------- 36 格表

  function createGrid(onEdit) {
    deps();
    var cells = [];
    var node = A.h('div', { class: 'grid36' });
    for (var i = 0; i < H.SECTORS; i++) {
      (function (idx) {
        var az = A.h('span', { class: 'az', text: H.azimuthOf(idx) + '°' });
        var el = A.h('span', { class: 'el', text: '—' });
        var b = A.h('button', {
          type: 'button',
          on: { click: function () { onEdit(idx); } }
        }, [az, el]);
        cells.push({ btn: b, el: el });
        node.appendChild(b);
      }(i));
    }
    function update(profile) {
      for (var i = 0; i < H.SECTORS; i++) {
        var v = profile[i];
        var set = typeof v === 'number' && isFinite(v);
        cells[i].el.textContent = set ? (v > 0 ? '+' : '') + (Math.round(v * 10) / 10) : '—';
        cells[i].btn.className = set ? 'set' : '';
      }
    }
    return { node: node, update: update };
  }

  // ---------------------------------------------------------------- 主视图

  /**
   * 渲染采样页。
   * @param {Object} rec 勘景记录（会就地修改 rec.horizon 并自动存盘）
   * @param {HTMLElement} view 容器
   * @param {Object} [opts] opts.dock 由调用方提供底部导航（分步流程用）
   * @returns {function} 清理函数
   */
  function render(rec, view, opts) {
    deps();

    var profile = rec.horizon;
    var live = null;
    var dwell = null;
    var missedRun = 0;          // 连续因为转太快而漏掉的扇区数
    var autoCapture = true;
    var saveTimer = null;
    var wakeLock = null;
    var disposed = false;
    var dirty = false;
    var dirtySince = 0;

    var rose = createRose();
    var strip = createStrip();
    var grid = createGrid(editSector);

    var azOut = A.h('div', { class: 'az', text: '—' });
    var elOut = A.h('div', { class: 'el', text: '—' });
    var azLab = A.h('div', { class: 'lab', text: '方位 / 仰角' });
    var statusNote = A.h('div', { class: 'note' });
    var progressBar = A.h('i', { style: 'width:0%' });
    var countOut = A.h('span', { class: 'meta' });
    var missOut = A.h('p', { class: 'hint' });
    var speedHint = A.h('div', { class: 'note bad', style: 'display:none;margin:10px 0 0' });
    var savedOut = A.h('span', { class: 'meta', text: '' });

    var vf = VF.create();

    var enableBtn = A.h('button', {
      class: 'btn primary block', type: 'button',
      on: { click: enableSensors }
    }, VF.supported() ? '启用罗盘和相机' : '启用罗盘');

    var camBtn = A.h('button', {
      class: 'btn sm ghost', type: 'button',
      on: {
        click: function () {
          if (vf.state() === 'on') { vf.stop(); }
          else { vf.start(); }
          syncCamBtn();
        }
      }
    }, '相机');

    function syncCamBtn() {
      var on = vf.state() === 'on';
      camBtn.textContent = on ? '相机：开' : '相机：关';
      camBtn.className = 'btn sm ' + (on ? 'primary' : 'ghost');
    }
    syncCamBtn();

    var autoBtn = A.h('button', {
      class: 'btn sm', type: 'button',
      on: {
        click: function () {
          autoCapture = !autoCapture;
          autoBtn.textContent = autoCapture ? '自动采样：开' : '自动采样：关';
          autoBtn.className = 'btn sm' + (autoCapture ? ' primary' : ' ghost');
        }
      }
    }, '自动采样：开');

    var markBtn = A.h('button', {
      class: 'btn sm', type: 'button',
      on: { click: manualCapture }
    }, '记录此点');

    // 第一屏就是"瞄准 + 进度"：取景器、进度、缺口提示、三个按钮
    var aimBox = A.h('div', { class: 'card' }, [
      vf.node,
      A.h('div', { class: 'progress' }, progressBar),
      A.h('div', {
        class: 'card-head',
        style: 'margin:12px 0 0'
      }, [A.h('h2', { text: '采样进度' }), countOut]),
      missOut,
      speedHint,
      A.h('div', { class: 'btn-bar', style: 'margin-top:12px' }, [autoBtn, markBtn, camBtn])
    ]);

    // 罗盘玫瑰退到第二张卡：它是用来看"哪些方向采过了"，不是用来瞄准的
    var compassBox = A.h('div', { class: 'card' }, [
      A.h('div', { class: 'card-head' }, [A.h('h2', { text: '已采覆盖' })]),
      A.h('div', { class: 'rose-wrap' }, [
        rose.node,
        A.h('div', { class: 'rose-center' }, [azOut, elOut, azLab])
      ])
    ]);

    var stripBox = A.h('div', { class: 'card' }, [
      A.h('div', { class: 'card-head' }, [
        A.h('h2', { text: '天际线展开图' }),
        savedOut
      ]),
      strip.node,
      A.h('div', { class: 'legend' }, [
        A.h('span', null, [A.h('i', { style: 'background:#c98a2f' }), '已采样']),
        A.h('span', null, [A.h('i', { style: 'background:#131319;border:1px solid #2e2e3a' }), '未采样']),
        A.h('span', null, [A.h('i', { style: 'background:#ffb340' }), '当前朝向'])
      ])
    ]);

    var gridBox = A.h('details', { class: 'card tight' }, [
      A.h('summary', {
        style: 'padding:13px 14px;cursor:pointer;font-size:14px;font-weight:500;list-style:none'
      }, '逐扇区数值 · 点任意格子手动改'),
      A.h('div', { style: 'padding:0 14px 14px' }, [
        grid.node,
        A.h('div', { class: 'btn-bar', style: 'margin-top:12px' }, [
          A.h('button', {
            class: 'btn sm ghost', type: 'button',
            on: { click: fillFlat }
          }, '全部设为 0°（平地）'),
          A.h('button', {
            class: 'btn sm danger', type: 'button',
            on: { click: clearAll }
          }, '清空剖面')
        ])
      ])
    ]);

    view.appendChild(statusNote);
    view.appendChild(A.h('div', { id: 'enable-slot' }, enableBtn));
    view.appendChild(aimBox);
    view.appendChild(compassBox);
    view.appendChild(stripBox);
    view.appendChild(gridBox);
    view.appendChild(A.h('details', { class: 'fold' }, [
      A.h('summary', null, '怎么用'),
      A.h('div', { class: 'fold-body' }, [
        A.h('p', { class: 'hint' }, [
          A.h('b', { text: '一、' }),
          '竖着举起手机，用后摄对准天际线。开了相机就把准星压在天际线上，没开相机就靠手机背面的指向。'
        ]),
        A.h('p', { class: 'hint' }, [
          A.h('b', { text: '二、' }),
          '原地转一圈。每 10° 一个扇区，在一个方向停住约半秒就记下该方向的仰角，罗盘图上对应的扇区会亮起来。' +
          '转太快会采不上，届时会提示你慢下来。'
        ]),
        A.h('p', { class: 'hint' }, [
          A.h('b', { text: '三、' }),
          '转完 36 个扇区就齐了。数值自动存盘，中途退出不会丢。' +
          '罗盘不可用时，下面的「逐扇区数值」可以逐格手填。'
        ])
      ])
    ]));

    // 顶栏由调用方（分步流程）设置；底部导航优先用传进来的
    A.setDock((opts && opts.dock) ? opts.dock : [
      A.h('button', {
        class: 'btn primary block', type: 'button',
        on: {
          click: function () {
            flushSave();
            A.go('/rec/' + rec.id);
          }
        }
      }, '完成')
    ]);

    // ------------------------------------------------------------ 行为

    function setStatus(kind, html) {
      statusNote.className = 'note' + (kind ? ' ' + kind : '');
      statusNote.innerHTML = html;
      statusNote.style.display = html ? '' : 'none';
    }

    function refreshStatus() {
      var st = C.state();
      var slot = view.querySelector('#enable-slot');
      if (st === 'granted') {
        slot.style.display = 'none';
        var acc = live && live.accuracy !== null && live.accuracy !== undefined
          ? '，磁偏差约 ±' + Math.round(live.accuracy) + '°' : '';
        var srcNote = live && live.source === 'w3c'
          ? '。<b>注意</b>：非 iOS 设备的绝对方位通常是<b>磁北</b>，悉尼磁偏角约 +12.7°E，' +
            '可在记录页的「罗盘校正」里补偿。'
          : '';
        setStatus('ok', '罗盘已启用' + acc + srcNote);
      } else if (st === 'idle') {
        slot.style.display = '';
        setStatus('', 'iOS 需要你<b>主动点一下</b>才能打开方向传感器。');
      } else {
        slot.style.display = st === 'denied' || st === 'nodata' ? '' : 'none';
        setStatus('bad', C.explain(st) + '<br>你仍然可以在下面的「逐扇区数值」里逐格手动输入。');
      }
    }

    function enableSensors() {
      // 两个权限都必须在**这一次点击**里同步发起。
      // 如果先 await 罗盘权限再去要相机，用户手势已经过期，iOS 会拒掉第二个。
      var pCompass = C.request();
      var pCamera = VF.supported() ? vf.start() : Promise.resolve('unsupported');

      pCompass.then(function (st) {
        refreshStatus();
        if (st === 'granted') {
          C.start(onReading, function () { refreshStatus(); });
          requestWakeLock();
          A.toast('罗盘已启用，慢慢转一圈');
        } else {
          A.toast(C.explain(st), 4200);
        }
      });

      pCamera.then(function (cs) {
        syncCamBtn();
        // 相机拿不到不影响采集，只是对准全靠手感，所以只提示不阻断
        if (cs !== 'on' && cs !== 'unsupported') {
          A.toast(VF.explain(cs), 4500);
        }
      });
    }

    function onReading(r) {
      if (disposed) { return; }
      live = r;

      if (r.heading === null || r.elevation === null) {
        dwell = null;
        paint();
        return;
      }
      var sec = H.sectorFor(r.heading);
      if (!dwell || dwell.sector !== sec) {
        // 离开上一个扇区：样本够就落点，不够就记一笔"扫太快"
        if (dwell && autoCapture) {
          var held = Date.now() - dwell.t0;
          if (dwell.vals.length >= MIN_SAMPLES && held >= MIN_TRANSIT_MS) {
            commit(dwell.sector, median(dwell.vals));
            missedRun = 0;
          } else if (typeof profile[dwell.sector] !== 'number') {
            missedRun++;
          }
        }
        dwell = { sector: sec, t0: Date.now(), vals: [] };
      }
      dwell.vals.push(r.elevation);
      if (dwell.vals.length > 120) { dwell.vals.shift(); }

      if (autoCapture && Date.now() - dwell.t0 >= HOLD_MS && dwell.vals.length >= MIN_SAMPLES) {
        commit(sec, median(dwell.vals));
        missedRun = 0;
      }
      paint();
    }

    function manualCapture() {
      if (!live || live.heading === null || live.elevation === null) {
        A.toast('还没有有效的罗盘读数');
        return;
      }
      var sec = H.sectorFor(live.heading);
      var v = dwell && dwell.vals.length ? median(dwell.vals) : live.elevation;
      commit(sec, v);
      A.toast(H.azimuthOf(sec) + '° 记为 ' + A.deg(v));
      paint();
    }

    function commit(sector, value) {
      if (value === null || !isFinite(value)) { return; }
      profile[sector] = Math.round(value * 100) / 100;
      rec.horizonSampledAt = Date.now();
      scheduleSave();
    }

    function editSector(idx) {
      A.numberSheet({
        title: '扇区 ' + H.azimuthOf(idx) + '°（' + A.compassName(H.azimuthOf(idx)) + '）',
        sub: '天际线在这个方向的仰角。平地填 0，有山或楼填正值，站在高处俯视填负值。',
        label: '仰角（度）',
        value: typeof profile[idx] === 'number' ? profile[idx] : null,
        min: -89, max: 89, step: 0.1,
        allowClear: typeof profile[idx] === 'number',
        placeholder: '例如 3.5'
      }).then(function (v) {
        if (v === null) { return; }
        if (v === 'clear') { profile[idx] = null; }
        else { profile[idx] = v; rec.horizonSampledAt = Date.now(); }
        scheduleSave();
        paint();
      });
    }

    function fillFlat() {
      A.confirm('全部设为 0°？', '会把 36 个扇区都填成平地，已有的值会被覆盖。', '填平', 'primary')
        .then(function (ok) {
          if (!ok) { return; }
          for (var i = 0; i < H.SECTORS; i++) { profile[i] = 0; }
          rec.horizonSampledAt = Date.now();
          scheduleSave();
          paint();
          A.toast('已全部设为 0°');
        });
    }

    function clearAll() {
      A.confirm('清空整个剖面？', '36 个扇区的值都会被删掉，这一步撤销不了。', '清空', 'danger')
        .then(function (ok) {
          if (!ok) { return; }
          for (var i = 0; i < H.SECTORS; i++) { profile[i] = null; }
          rec.horizonSampledAt = null;
          scheduleSave();
          paint();
          A.toast('剖面已清空');
        });
    }

    // 纯防抖会被连续落点无限推迟：转一圈期间每 0.4 秒就有一次 commit，
    // 定时器次次重置，结果是整圈转完之前一次都没存盘——锁屏或来电就全丢了。
    // 所以加一个最长等待时间兜底。
    function scheduleSave() {
      if (!dirty) { dirtySince = Date.now(); }
      dirty = true;
      if (Date.now() - dirtySince >= SAVE_MAX_WAIT) { flushSave(); return; }
      if (saveTimer) { clearTimeout(saveTimer); }
      saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE);
    }

    function flushSave() {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      if (!dirty) { return; }
      dirty = false;
      dirtySince = 0;
      R.save(rec).then(function () {
        savedOut.textContent = '已保存 ' + new Date().toTimeString().slice(0, 5);
      }).catch(function (e) {
        dirty = true;
        A.toast('保存失败：' + (e && e.message ? e.message : e), 4000);
      });
    }

    function paint() {
      var heading = live && live.heading !== null ? live.heading : null;
      var frac = 0;
      if (dwell) {
        frac = Math.min(1, (Date.now() - dwell.t0) / HOLD_MS);
        if (typeof profile[dwell.sector] === 'number') { frac = 1; }
      }
      rose.update(profile, heading, rec.heading, frac, dwell ? dwell.sector : -1);
      strip.update(profile, heading);
      grid.update(profile);

      azOut.textContent = heading === null ? '—' : Math.round(heading) + '°';
      elOut.textContent = (live && live.elevation !== null) ? A.deg(live.elevation) : '—';
      azLab.textContent = heading === null ? '方位 / 仰角'
        : A.compassName(heading) + ' · 扇区 ' + H.azimuthOf(H.sectorFor(heading)) + '°';

      // 取景器 HUD
      var curSec = dwell ? dwell.sector : (heading === null ? -1 : H.sectorFor(heading));
      var captured = curSec >= 0 && typeof profile[curSec] === 'number';
      vf.setReadout(heading, live ? live.elevation : null);
      vf.setDwell(frac, captured);
      if (heading === null) {
        vf.setFooter('准星对准天际线');
      } else {
        vf.setFooter('扇区 ' + H.azimuthOf(curSec) + '° ' + A.compassName(heading) +
                     (captured ? ' · 已采，停住可覆盖' : ' · 停住约半秒即记下'));
      }

      var n = H.count(profile);
      countOut.textContent = n + ' / ' + H.SECTORS;
      progressBar.style.width = (n / H.SECTORS * 100) + '%';

      var ranges = H.missingRanges(profile);
      if (!ranges.length) {
        missOut.innerHTML = '<strong>36 个扇区全部采齐。</strong>';
      } else {
        var total = ranges.reduce(function (s, r) { return s + r.count; }, 0);
        missOut.innerHTML = '还缺 <strong>' + total + '</strong> 个扇区：' +
          ranges.map(function (r) {
            return r.from + '°–' + r.to + '°';
          }).join('、');
      }

      if (missedRun >= TOO_FAST_HINT) {
        speedHint.style.display = '';
        speedHint.textContent = '转慢一点 —— 已经连续掠过 ' + missedRun +
                                ' 个扇区没采上。每个方向大约停半秒。';
      } else {
        speedHint.style.display = 'none';
      }
    }

    // 采样时别让屏幕睡过去
    function requestWakeLock() {
      if (!navigator.wakeLock || !navigator.wakeLock.request) { return; }
      navigator.wakeLock.request('screen').then(function (l) {
        wakeLock = l;
      }).catch(function () { /* 不支持就算了，不影响功能 */ });
    }

    function onVisible() {
      if (document.visibilityState === 'visible' && !wakeLock && C.state() === 'granted') {
        requestWakeLock();
      }
    }
    document.addEventListener('visibilitychange', onVisible);

    // 已经授权过的话直接开始，不用再点一次
    if (C.state() === 'granted' || (C.supported() && !C.needsPermission() && C.isSecure())) {
      C.start(onReading, function () { refreshStatus(); });
      requestWakeLock();
    }
    refreshStatus();
    paint();

    // 没有罗盘读数时也让停留圈动起来，给点"正在采"的反馈
    var tick = setInterval(function () { if (dwell) { paint(); } }, 120);

    return function cleanup() {
      disposed = true;
      clearInterval(tick);
      document.removeEventListener('visibilitychange', onVisible);
      C.stop();
      vf.stop();
      if (wakeLock && wakeLock.release) { wakeLock.release().catch(function () {}); }
      wakeLock = null;
      flushSave();
    };
  }

  return {
    render: render, createStrip: createStrip, createRose: createRose,
    GEOM: {
      VIEW: VIEW, CX: CX, CY: CY, R_OUT: R_OUT, R_IN: R_IN,
      LABEL_R: LABEL_R, LABEL_HALF: LABEL_HALF,
      NEEDLE_R: NEEDLE_R, AIM_R0: AIM_R0, AIM_R1: AIM_R1,
      STRIP: { W: SW, H: SH, PAD_L: SPAD_L, TOP: STOP, BOT: SBOT }
    }
  };
});
