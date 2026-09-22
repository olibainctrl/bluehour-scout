/*!
 * 蓝调勘景仪 Blue Hour Scout — js/ui/timeline-ui.js
 *
 * 功能二：分钟级光线时间轴。
 *
 * 版面按"站在机器旁边扫一眼要读什么"排：
 *   窗口时长（大字）→ 现在该开多大（大字）→ 关键时刻 → 拍摄参数 → 逐分钟表
 * 表格自己滚，表头和时间列都吸住，当前分钟自动滚到视野中央。
 */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  root.BH = root.BH || {};
  root.BH.TimelineUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var A, R, Z, TL, E, St, Cal, H;
  function deps() {
    A = root.BH.App; R = root.BH.Records; Z = root.BH.Tz; TL = root.BH.Timeline;
    E = root.BH.Exposure; St = root.BH.Settings; Cal = root.BH.Calibration; H = root.BH.Horizon;
  }

  var NOW_TICK = 20000;    // 「现在」面板多久刷新一次

  function render(params, view) {
    deps();
    var rec = null, settings = null, calibInfo = null, result = null;
    var dateKey = null, disposed = false, tick = null;
    var tableWrap = null, rowEls = [], nowIndex = -1;

    A.setTop({ title: '光线时间轴', back: true });
    view.appendChild(A.h('div', { class: 'hint', text: '载入中…' }));

    Promise.all([R.load(params.id), St.load()]).then(function (res) {
      if (disposed) { return; }
      if (!res[0]) { A.toast('记录不存在'); A.go('/', true); return; }
      rec = R.normalize(res[0]);
      settings = res[1];
      dateKey = Z.dateKey(Date.now(), rec.tz);
      return Cal.fitFor(rec.id).then(function (c) { calibInfo = c; });
    }).then(function () {
      if (disposed || !rec) { return; }
      A.clear(view);
      rebuild();
    }).catch(function (e) {
      A.clear(view);
      view.appendChild(A.h('div', { class: 'note bad', text: '载入失败：' + (e && e.message ? e.message : e) }));
    });

    // ------------------------------------------------------------ 重建

    function rebuild() {
      var effective = Object.assign({}, settings, {
        setups: (rec.setups !== null && rec.setups !== undefined) ? rec.setups : settings.setups
      });
      result = TL.build({
        rec: rec, dateKey: dateKey, settings: effective,
        calib: calibInfo ? calibInfo.calib : null
      });
      paint();
    }

    function paint() {
      A.clear(view);
      rowEls = [];

      A.setTop({
        title: '光线时间轴',
        sub: rec.name || undefined,
        back: function () { A.go('/rec/' + rec.id); }
      });
      A.setDock([
        A.h('button', {
          class: 'btn ghost', type: 'button', style: 'flex:0 0 40%',
          on: { click: function () { A.go('/rec/' + rec.id + '/weather'); } }
        }, '七天云量'),
        A.h('button', {
          class: 'btn primary', type: 'button',
          on: { click: function () { A.go('/rec/' + rec.id); } }
        }, '返回记录')
      ]);

      view.appendChild(buildDateBar());

      if (!result.ok) {
        view.appendChild(A.h('div', { class: 'note bad', text: result.error }));
        return;
      }

      view.appendChild(buildWindow());
      var nowBox = buildNow();
      if (nowBox) { view.appendChild(nowBox); }
      view.appendChild(buildMoments());
      view.appendChild(buildShootParams());
      view.appendChild(buildCalibBar());
      view.appendChild(buildTable());

      scrollToNow();
      if (tick) { clearInterval(tick); }
      tick = setInterval(paintNowOnly, NOW_TICK);
    }

    // -------------------------------------------------------- 日期选择

    function buildDateBar() {
      var input = A.h('input', { type: 'date', value: dateKey });
      input.addEventListener('change', function () {
        if (Z.parseDateKey(input.value)) { dateKey = input.value; rebuild(); }
      });
      function shift(days) {
        var d = Z.parseDateKey(dateKey);
        var t = new Date(Date.UTC(d.year, d.month - 1, d.day + days));
        dateKey = Z.pad(t.getUTCFullYear(), 4) + '-' + Z.pad(t.getUTCMonth() + 1, 2) +
                  '-' + Z.pad(t.getUTCDate(), 2);
        rebuild();
      }
      return A.h('div', { class: 'datebar' }, [
        A.h('button', { class: 'step', type: 'button', on: { click: function () { shift(-1); } } }, '‹'),
        input,
        A.h('button', { class: 'step', type: 'button', on: { click: function () { shift(1); } } }, '›'),
        A.h('button', {
          class: 'btn sm ghost', type: 'button',
          on: {
            click: function () { dateKey = Z.dateKey(Date.now(), rec.tz); rebuild(); }
          }
        }, '今天')
      ]);
    }

    // ------------------------------------------------------ 窗口大字

    function buildWindow() {
      var s = result.stats;
      if (s.blueMinutes === null) {
        return A.h('div', { class: 'window-big bad' }, [
          A.h('div', null, [A.h('span', { class: 'n', text: '—' })]),
          A.h('div', { class: 'sub', text: '这一天太阳降不到设定的蓝调下界，算不出窗口。' })
        ]);
      }
      var mins = Math.round(s.blueMinutes);
      return A.h('div', { class: 'window-big' + (mins < 20 ? ' bad' : '') }, [
        A.h('div', null, [
          A.h('span', { class: 'n', text: String(mins) }),
          A.h('span', { class: 'u', text: '分钟' })
        ]),
        A.h('div', { class: 'sub' }, [
          '蓝调窗口 ',
          A.h('b', { text: Z.formatTime(s.blueStart, rec.tz) + '–' + Z.formatTime(s.blueEnd, rec.tz) }),
          '，太阳视高度角 ' + A.deg(s.blueUpper) + ' → ' + A.deg(s.blueLower) + '。'
        ])
      ]);
    }

    // ------------------------------------------------------ 现在面板

    function buildNow() {
      var i = TL.indexForTime(result, Date.now());
      nowIndex = i;
      if (i < 0) { return null; }
      var w = result.rows[i];
      var auto = w.auto;
      var box = A.h('div', { class: 'now-panel', id: 'now-panel' });
      fillNow(box, w, auto);
      return box;
    }

    function fillNow(box, w, auto) {
      A.clear(box);
      box.appendChild(A.h('div', { class: 'lab', text: '现在 ' + Z.formatTime(w.ms, rec.tz) }));
      box.appendChild(A.h('div', { class: 'big' }, [
        A.h('span', { class: 't', text: auto ? 'T' + auto.nearest : '—' }),
        A.h('span', { class: 'iso', text: auto ? 'ISO ' + auto.iso : '' })
      ]));
      box.appendChild(A.h('div', { class: 'row2' }, [
        A.h('span', null, ['精确 ', A.h('b', { text: auto ? 'T' + auto.n.toFixed(2) : '—' })]),
        A.h('span', null, ['EV100 ', A.h('b', { text: w.ev100.toFixed(2) })]),
        A.h('span', null, ['高度 ', A.h('b', { text: A.deg(w.altitude) })]),
        A.h('span', null, ['色温 ', A.h('b', { text: Math.round(w.cct) + 'K' })])
      ]));
      var warn = [];
      if (auto && auto.overLens) {
        warn.push('需要 T' + auto.n.toFixed(2) + '，超出当前镜头最大光圈' +
                  (result.lens ? ' T' + result.lens.maxAperture : '') + '，这一刻已经拍不了。');
      } else if (auto && auto.switched) {
        warn.push('已切到高原生 ISO ' + auto.iso + '。');
      }
      if (w.occluded) { warn.push('太阳已被地平线挡住，没有直射光。'); }
      if (warn.length) {
        box.appendChild(A.h('div', { class: 'warn', text: warn.join(' ') }));
      }
    }

    function paintNowOnly() {
      if (disposed || !result || !result.ok) { return; }
      var box = document.getElementById('now-panel');
      var i = TL.indexForTime(result, Date.now());
      if (i < 0) { if (box) { box.remove(); } return; }
      if (!box) { paint(); return; }          // 刚进入范围，整页重排一次
      if (i === nowIndex) { return; }
      if (rowEls[nowIndex]) { rowEls[nowIndex].classList.remove('now'); }
      nowIndex = i;
      if (rowEls[i]) { rowEls[i].classList.add('now'); }
      fillNow(box, result.rows[i], result.rows[i].auto);
    }

    // ------------------------------------------------------ 关键时刻

    function buildMoments() {
      var s = result.stats;
      var items = [];

      if (s.realSunsetMs !== null) {
        items.push({
          k: '真实日落（被地平线挡住）',
          v: Z.formatTime(s.realSunsetMs, rec.tz),
          x: '比天文日落早 ' + s.sunsetShiftMinutes.toFixed(0) + ' 分',
          hi: true
        });
      } else if (s.occludedFromStart) {
        items.push({ k: '真实日落', v: '更早', x: '时间轴起点前就已被挡住', hi: true });
      } else if (!result.hasHorizon) {
        items.push({ k: '真实日落', v: '—', x: '还没采地平线剖面' });
      }

      items.push({ k: '天文日落', v: Z.formatTime(s.astroSunsetMs, rec.tz) });
      if (s.civilDuskMs) { items.push({ k: '民用昏影终（−6°）', v: Z.formatTime(s.civilDuskMs, rec.tz) }); }
      if (s.nauticalDuskMs) { items.push({ k: '航海昏影终（−12°）', v: Z.formatTime(s.nauticalDuskMs, rec.tz) }); }

      s.lights.forEach(function (L) {
        items.push({
          k: L.name + ' 追平环境光',
          v: Z.formatTime(L.ms, rec.tz),
          x: 'EV100 ' + L.ev100.toFixed(1)
        });
      });

      var ul = A.h('ul', { class: 'moments' });
      items.forEach(function (it) {
        ul.appendChild(A.h('li', { class: it.hi ? 'hi' : null }, [
          A.h('span', { class: 'k', text: it.k }),
          A.h('span', { class: 'v', text: it.v }),
          it.x ? A.h('span', { class: 'x', text: it.x }) : null
        ]));
      });

      return A.h('div', { class: 'card' }, [
        A.h('div', { class: 'card-head' }, [
          A.h('h2', { text: '关键时刻' }),
          A.h('span', { class: 'meta', text: Z.offsetLabel(s.astroSunsetMs, rec.tz) })
        ]),
        ul,
        !result.hasHorizon ? A.h('p', { class: 'hint' },
          '这条记录还没有地平线剖面，所以只能给天文日落。真实日落往往比它早十几分钟——' +
          '回第 3 步采一圈就能算出来。') : null
      ]);
    }

    // ------------------------------------------------------ 拍摄参数

    function buildShootParams() {
      var lensSel = A.h('select');
      settings.lenses.forEach(function (L, i) {
        lensSel.appendChild(A.h('option', { value: i },
          L.name + (L.maxAperture ? '  T' + L.maxAperture : '')));
      });
      lensSel.value = String(settings.selectedLens);
      lensSel.addEventListener('change', function () {
        settings.selectedLens = parseInt(lensSel.value, 10);
        St.save(settings).then(rebuild);
      });

      var setupsIn = A.h('input', {
        type: 'number', inputmode: 'numeric', min: 1, max: 99, step: 1,
        value: rec.setups === null ? '' : rec.setups, placeholder: '几个'
      });
      var budgetOut = A.h('div', { class: 'hint' });
      function syncBudget() {
        var b = result.stats.budget;
        if (!b) { budgetOut.textContent = '填了 setup 数才做核算。'; return; }
        if (b.ok) {
          budgetOut.innerHTML = '每个 setup 平均 <strong>' + b.perSetup.toFixed(1) +
            ' 分钟</strong>，够用（门槛 ' + b.minPerSetup + ' 分钟）。';
        } else {
          budgetOut.innerHTML = '<strong style="color:var(--bad)">每个 setup 只有 ' +
            b.perSetup.toFixed(1) + ' 分钟</strong>，低于 ' + b.minPerSetup +
            ' 分钟门槛。这个窗口最多排 <strong>' + b.maxSetups +
            '</strong> 个，建议砍掉 <strong>' + b.cut + '</strong> 个。';
        }
      }
      setupsIn.addEventListener('input', function () {
        var v = parseInt(setupsIn.value, 10);
        rec.setups = (isFinite(v) && v >= 1 && v <= 99) ? v : null;
        R.save(rec).then(function () { rebuild(); });
      });
      syncBudget();

      var t = result.shutterSec;
      return A.h('div', { class: 'card' }, [
        A.h('div', { class: 'card-head' }, [
          A.h('h2', { text: '拍摄参数' }),
          A.h('span', { class: 'meta', text: t ? '1/' + Math.round(1 / t) + 's · ' +
            settings.camera.shutterAngle + '° · ' + settings.camera.fps + 'fps' : '' })
        ]),
        A.h('div', { class: 'field' }, [A.h('label', { text: '当前镜头' }), lensSel]),
        A.h('div', { class: 'field' }, [
          A.h('label', null, ['这个机位计划拍几个 setup ',
            A.h('span', { class: 'unit', text: '（拍摄量核算）' })]),
          setupsIn
        ]),
        budgetOut
      ]);
    }

    // ------------------------------------------------------ 校准状态

    function buildCalibBar() {
      var c = calibInfo;
      var on = !!(c && c.calib);
      var txt;
      if (!on) {
        txt = [A.h('b', { text: '通用模型。' }),
               '还没有实测点。在下面的表格里点任意一行可以记一个现场读数，' +
               '攒够 ' + E.MIN_FOR_SLOPE + ' 个就会自动拟合。'];
      } else {
        var src = c.calib.source === 'location' ? '本地点' : '全局';
        txt = [
          A.h('b', { text: '已用 ' + c.calib.n + ' 个实测点校准（' + src + '）。' }),
          c.calib.slopeFitted
            ? '拟合了偏移和斜率：EV = ' + c.calib.a.toFixed(3) + ' × 模型 ' +
              (c.calib.b >= 0 ? '+ ' : '− ') + Math.abs(c.calib.b).toFixed(2) + '。'
            : '点数不足 ' + E.MIN_FOR_SLOPE + ' 个，只修正了偏移量 ' +
              (c.calib.b >= 0 ? '+' : '') + c.calib.b.toFixed(2) + '。',
          c.rms !== null ? ' 残差 ' + c.rms.toFixed(2) + ' EV。' : ''
        ];
      }
      return A.h('div', { class: 'calib' + (on ? ' on' : '') }, [
        A.h('div', { style: 'flex:1' }, txt),
        A.h('button', {
          class: 'btn sm ghost', type: 'button', style: 'flex:none',
          on: { click: showCalibPoints }
        }, '实测点')
      ]);
    }

    // -------------------------------------------------------- 表格

    function buildTable() {
      var thead = A.h('tr', null, [
        A.h('th', { class: 't', text: '时间' }),
        A.h('th', { text: '高度' }),
        A.h('th', { text: '方位' }),
        A.h('th', { text: 'EV100' }),
        A.h('th', { text: 'T@' + result.isoLow }),
        A.h('th', { text: 'T@' + result.isoHigh }),
        A.h('th', { text: '色温' })
      ]);
      var tbody = A.h('tbody');
      var table = A.h('table', { class: 'tl' }, [A.h('thead', null, thead), tbody]);

      result.rows.forEach(function (w, i) {
        var cls = [];
        if (w.inBlue) { cls.push('blue'); }
        if (w.occluded) { cls.push('occ'); }
        if (w.isRealSunset) { cls.push('rs'); }
        if (w.lights.length) { cls.push('lit'); }
        if (i === nowIndex) { cls.push('now'); }

        function stopCell(x) {
          var txt = x.n === null ? '—'
            : (x.under ? '＜T' : x.over ? '＞T' : 'T') + x.nearest;
          return A.h('td', { class: (x.under || x.over) ? 'over' : null, text: txt });
        }

        var tr = A.h('tr', {
          class: cls.length ? cls.join(' ') : null,
          on: { click: function () { recordSheet(w); } }
        }, [
          A.h('td', { class: 't' }, [
            Z.formatTime(w.ms, rec.tz),
            w.occluded ? A.h('span', { style: 'color:var(--ink-faint);margin-left:4px', text: '●' }) : null,
            w.lights.length ? A.h('span', { style: 'color:var(--ok);margin-left:4px', text: '◆' }) : null
          ]),
          A.h('td', { class: 'alt', text: A.deg(w.altitude) }),
          A.h('td', { text: Math.round(w.azimuth) + '°' }),
          A.h('td', { text: w.ev100.toFixed(2) }),
          stopCell(w.low),
          stopCell(w.high),
          A.h('td', { class: w.cctInRange ? null : 'dim', text: Math.round(w.cct) + 'K' })
        ]);
        rowEls.push(tr);
        tbody.appendChild(tr);
      });

      tableWrap = A.h('div', { class: 'tl-wrap' }, table);

      return A.h('div', { class: 'card' }, [
        A.h('div', { class: 'card-head' }, [
          A.h('h2', { text: '逐分钟' }),
          A.h('span', { class: 'meta', text: result.rows.length + ' 分钟' })
        ]),
        A.h('p', { class: 'hint', style: 'margin-top:0' }, '点任意一行可以记一个现场实测读数。'),
        tableWrap,
        A.h('div', { class: 'tl-legend' }, [
          A.h('span', null, [A.h('i', { style: 'background:#2a2110;border:1px solid #4d3d1d' }), '现在']),
          A.h('span', null, [A.h('i', { style: 'background:#241b0c' }), '真实日落']),
          A.h('span', null, [A.h('i', { style: 'background:#0d1017' }), '蓝调窗口']),
          A.h('span', null, ['● 被地平线挡住']),
          result.stats.lights.length ? A.h('span', null, ['◆ 补光追平']) : null,
          A.h('span', null, ['＞T / ＜T 超出常用档位表'])
        ])
      ]);
    }

    /**
     * 表格默认滚到哪一行。按有用程度排：
     *   当前分钟 → 真实日落 → 蓝调窗口开始 → 天文日落 → 第一行
     * 规划未来某天时"现在"不在范围内，这时停在第一行（日落前 40 分钟）没意义。
     */
    function scrollToNow() {
      if (!tableWrap) { return; }
      var s = result.stats;
      var target = -1;
      if (nowIndex >= 0) { target = nowIndex; }
      else if (s.realSunsetIndex >= 0) { target = s.realSunsetIndex; }
      else if (s.blueStart !== null) { target = TL.indexForTime(result, s.blueStart); }
      if (target < 0) { target = TL.indexForTime(result, s.astroSunsetMs); }
      if (target < 0 || !rowEls[target]) { return; }
      tableWrap.scrollTop = Math.max(0, rowEls[target].offsetTop - tableWrap.clientHeight / 2);
    }

    // ---------------------------------------------------- 记录实测

    function recordSheet(w) {
      var predicted = w.ev100;
      var evIn = A.h('input', {
        type: 'number', step: 'any', inputmode: 'decimal',
        placeholder: '例如 ' + predicted.toFixed(1)
      });

      // 测光表给的是光圈+快门+ISO，提供一个换算入口
      var nIn = A.h('input', { type: 'number', step: 'any', inputmode: 'decimal', placeholder: 'T 档' });
      var isoIn = A.h('input', { type: 'number', step: 'any', inputmode: 'numeric',
                                 value: w.auto ? w.auto.iso : result.isoLow });
      var shIn = A.h('input', { type: 'number', step: 'any', inputmode: 'numeric',
                                value: result.shutterSec ? Math.round(1 / result.shutterSec) : 48 });
      var convOut = A.h('div', { class: 'hint' });
      function conv() {
        var n = parseFloat(nIn.value), iso = parseFloat(isoIn.value), inv = parseFloat(shIn.value);
        var t = (inv > 0) ? 1 / inv : null;
        var v = E.ev100From(n, t, iso);
        if (v === null) { convOut.textContent = '三个都填了才能换算。'; return null; }
        convOut.innerHTML = '换算得 EV100 <strong>' + v.toFixed(2) + '</strong>';
        return v;
      }
      [nIn, isoIn, shIn].forEach(function (el) { el.addEventListener('input', conv); });
      conv();

      var useBtn = A.h('button', {
        class: 'btn sm', type: 'button', style: 'margin-top:10px',
        on: {
          click: function () {
            var v = conv();
            if (v === null) { A.toast('三个都填了才能换算'); return; }
            evIn.value = Math.round(v * 100) / 100;
          }
        }
      }, '填进上面的 EV100');

      A.sheet({
        title: '记录实测 · ' + Z.formatTime(w.ms, rec.tz),
        sub: '太阳视高度角 ' + A.deg(w.altitude, 2) + '，模型预测 EV100 ' + predicted.toFixed(2) +
             '。填入现场实际读数，累积后会自动校准整条曲线。',
        dismissValue: null,
        body: A.h('div', null, [
          A.h('div', { class: 'field' }, [
            A.h('label', { text: '实测 EV100' }), evIn
          ]),
          A.h('details', { class: 'fold' }, [
            A.h('summary', null, '从光圈 / 快门 / ISO 换算'),
            A.h('div', { class: 'fold-body' }, [
              A.h('div', { class: 'row tight', style: 'margin-top:14px' }, [
                A.h('div', { class: 'field', style: 'margin:0' }, [A.h('label', { text: 'T 档' }), nIn]),
                A.h('div', { class: 'field', style: 'margin:0' }, [A.h('label', { text: '1/x 秒' }), shIn]),
                A.h('div', { class: 'field', style: 'margin:0' }, [A.h('label', { text: 'ISO' }), isoIn])
              ]),
              convOut, useBtn
            ])
          ])
        ]),
        actions: [
          { label: '取消', value: null, kind: 'ghost' },
          { label: '记下', value: 'save', kind: 'primary' }
        ],
        onOpen: function () { evIn.focus(); }
      }).then(function (v) {
        if (v !== 'save') { return; }
        var ev = parseFloat(evIn.value);
        if (!isFinite(ev)) { A.toast('没填实测 EV100'); return; }
        Cal.add({
          recordId: rec.id, dateKey: dateKey, ms: w.ms,
          alt: w.altitude, ev100: ev
        }).then(function () {
          return Cal.fitFor(rec.id);
        }).then(function (c) {
          calibInfo = c;
          rebuild();
          A.toast('已记下。当前共 ' + c.totalCount + ' 个实测点（本地点 ' + c.localCount + ' 个）', 3500);
        }).catch(function (e) { A.toast('保存失败：' + e.message, 4000); });
      });
    }

    function showCalibPoints() {
      Cal.all().then(function (rows) {
        var body;
        if (!rows.length) {
          body = A.h('p', { class: 'hint', text: '还没有实测点。' });
        } else {
          var ul = A.h('ul', { class: 'moments' });
          rows.slice(0, 40).forEach(function (p) {
            var here = p.recordId === rec.id;
            ul.appendChild(A.h('li', null, [
              A.h('span', { class: 'k', text: (p.dateKey || '') + (here ? ' · 本地点' : ' · 其它地点') }),
              A.h('span', { class: 'v', text: p.ev100.toFixed(2) }),
              A.h('span', { class: 'x', text: A.deg(p.alt, 1) })
            ]));
          });
          body = A.h('div', null, [
            A.h('p', { class: 'hint', style: 'margin-top:0' },
              '共 ' + rows.length + ' 个点，本地点 ' +
              rows.filter(function (p) { return p.recordId === rec.id; }).length + ' 个。' +
              '取数顺序是：本地点够 ' + E.MIN_FOR_SLOPE + ' 个就用本地点，不够才退回全局。'),
            ul
          ]);
        }
        A.sheet({
          title: '实测点',
          dismissValue: null,
          body: body,
          actions: rows.length
            ? [{ label: '关闭', value: null, kind: 'ghost' },
               { label: '全部清空', value: 'clear', kind: 'danger' }]
            : [{ label: '关闭', value: null, kind: 'ghost' }]
        }).then(function (v) {
          if (v !== 'clear') { return; }
          A.confirm('清空全部实测点？', '所有地点的校准数据都会删掉，之后回到通用模型。',
                    '清空', 'danger').then(function (ok) {
            if (!ok) { return; }
            Cal.clear().then(function () { return Cal.fitFor(rec.id); })
              .then(function (c) { calibInfo = c; rebuild(); A.toast('已清空'); });
          });
        });
      });
    }

    return function () {
      disposed = true;
      if (tick) { clearInterval(tick); tick = null; }
    };
  }

  return { render: render };
});
