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
      // setups 的记录优先规则在 core/timeline.js 里，这里不重复一遍
      result = TL.build({
        rec: rec, dateKey: dateKey, settings: settings,
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

      // 「现在」面板在范围内时放最上面：站在机器旁边第一眼要看的就是它
      var nowBox = buildNow();
      if (nowBox) { view.appendChild(nowBox); }
      view.appendChild(buildSummary());
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

    // ------------------------------------------------ 窗口 + 关键时刻
    //
    // 原来是两张卡（窗口大字一张、关键时刻五行列表一张），加起来半屏多，
    // 把真正要看的逐分钟表压到了一屏半以下。合成一张，时刻改成两列网格。

    function buildSummary() {
      var s = result.stats;
      var tz = rec.tz;
      var kids = [];

      if (s.blueMinutes === null) {
        kids.push(A.h('div', { class: 'sum-top' }, [
          A.h('span', { class: 'n bad', text: '—' }),
          A.h('span', { class: 'u', text: '这一天太阳降不到设定的蓝调下界，算不出窗口。' })
        ]));
      } else {
        var mins = Math.round(s.blueMinutes);
        kids.push(A.h('div', { class: 'sum-top' }, [
          A.h('span', { class: 'n' + (mins < 20 ? ' bad' : ''), text: String(mins) }),
          A.h('span', { class: 'u', text: '分钟蓝调' }),
          A.h('span', { class: 'range', text: A.deg(s.blueUpper, 0) + ' → ' + A.deg(s.blueLower, 0) })
        ]));
        kids.push(A.h('div', { class: 'sum-win' },
          Z.formatTime(s.blueStart, tz) + ' – ' + Z.formatTime(s.blueEnd, tz)));
      }

      var cells = [];
      if (s.realSunsetMs !== null) {
        var sh = Math.round(s.sunsetShiftMinutes);
        cells.push(cell('真实日落', Z.formatTime(s.realSunsetMs, tz),
          sh > 0 ? '早 ' + sh + ' 分' : (sh < 0 ? '晚 ' + (-sh) + ' 分' : '与天文日落同时'), true));
      } else if (s.occludedFromStart) {
        cells.push(cell('真实日落', '更早', '起点前已被挡住', true));
      } else if (!result.hasHorizon) {
        cells.push(cell('真实日落', '—', '还没采剖面'));
      }
      cells.push(cell('天文日落', Z.formatTime(s.astroSunsetMs, tz)));
      if (s.civilDuskMs) { cells.push(cell('民用昏影 −6°', Z.formatTime(s.civilDuskMs, tz))); }
      if (s.nauticalDuskMs) { cells.push(cell('航海昏影 −12°', Z.formatTime(s.nauticalDuskMs, tz))); }
      s.lights.forEach(function (L) {
        cells.push(cell(L.name, Z.formatTime(L.ms, tz), '追平 EV100 ' + L.ev100.toFixed(1)));
      });
      kids.push(A.h('div', { class: 'sum-grid' }, cells));

      return A.h('div', { class: 'summary-card' }, kids);
    }

    function cell(k, v, x, hi) {
      return A.h('div', { class: 'sc' + (hi ? ' hi' : '') }, [
        A.h('div', { class: 'k', text: k }),
        A.h('div', { class: 'v', text: v }),
        x ? A.h('div', { class: 'x', text: x }) : null
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

    // ------------------------------------------------------ 拍摄参数
    //
    // setup 数改成步进器 − n +：1–30 的小整数不该弹键盘；而且改动只重算
    // 核算那一行，不整页重建（整页重建会把控件自己销毁、抢走焦点）。

    function buildShootParams() {
      var lensSel = A.h('select', { 'aria-label': '当前镜头' });
      settings.lenses.forEach(function (L, i) {
        lensSel.appendChild(A.h('option', { value: i },
          L.name + (L.maxAperture ? '  T' + L.maxAperture : '')));
      });
      if (!settings.lenses.length) {
        lensSel.appendChild(A.h('option', { value: '' }, '还没有镜头，去项目设置里加'));
        lensSel.disabled = true;
      }
      lensSel.value = String(settings.selectedLens);
      lensSel.addEventListener('change', function () {
        settings.selectedLens = parseInt(lensSel.value, 10);
        St.save(settings).then(function () {
          if (disposed) { return; }
          rebuild();
        });
      });

      var budgetOut = A.h('div', { class: 'budget' });
      function syncBudget() {
        var b = result.stats.budget;
        budgetOut.className = 'budget' + (b && !b.ok ? ' bad' : '');
        if (!b) {
          budgetOut.textContent = rec.setups === null ? '不做核算' : '窗口为空，无从核算';
          return;
        }
        budgetOut.innerHTML = b.ok
          ? '每个 <b>' + b.perSetup.toFixed(1) + '</b> 分钟'
          : '每个只有 <b>' + b.perSetup.toFixed(1) + '</b> 分钟，最多排 ' + b.maxSetups +
            ' 个，建议砍 <b>' + b.cut + '</b> 个';
      }

      var saveTimer = null;
      var setupsSt = A.stepper({
        value: rec.setups, min: 1, max: 30, start: 3, nullable: true, emptyText: '—',
        onChange: function (v) {
          rec.setups = v;
          result.stats.budget = TL.budgetFor(result.stats.blueMinutes, v);
          syncBudget();
          if (saveTimer) { clearTimeout(saveTimer); }
          saveTimer = setTimeout(function () { if (!disposed) { R.save(rec); } }, 500);
        }
      });
      syncBudget();

      var t = result.shutterSec;
      return A.h('div', { class: 'card shoot' }, [
        A.h('div', { class: 'shoot-row' }, [
          A.h('span', { class: 'k', text: '镜头' }),
          lensSel
        ]),
        A.h('div', { class: 'shoot-row' }, [
          A.h('span', { class: 'k', text: 'setup' }),
          setupsSt.node,
          budgetOut
        ]),
        A.h('div', { class: 'hint', style: 'margin-top:4px' },
          t ? '快门 1/' + Math.round(1 / t) + ' 秒 · 每个 setup 至少 ' + TL.MIN_PER_SETUP + ' 分钟'
            : '帧率或快门角度无效，算不出 T 档')
      ]);
    }

    // ------------------------------------------------------ 校准状态

    function buildCalibBar() {
      var c = calibInfo;
      var on = !!(c && c.calib);
      var main, sub;
      if (!on) {
        main = '通用模型';
        sub = '点表格任一行记一个现场读数，攒够 ' + E.MIN_FOR_SLOPE + ' 个自动拟合';
      } else {
        main = '已用 ' + c.calib.n + ' 个实测点校准（' +
               (c.calib.source === 'location' ? '本地点' : '全局') + '）';
        sub = c.calib.slopeFitted
          ? 'EV = ' + c.calib.a.toFixed(3) + ' × 模型 ' + (c.calib.b >= 0 ? '+ ' : '− ') +
            Math.abs(c.calib.b).toFixed(2) + (c.rms !== null ? '，残差 ' + c.rms.toFixed(2) + ' EV' : '')
          : '点数不足 ' + E.MIN_FOR_SLOPE + ' 个，只修正了偏移 ' +
            (c.calib.b >= 0 ? '+' : '') + c.calib.b.toFixed(2);
      }
      return A.h('button', {
        class: 'calib' + (on ? ' on' : ''), type: 'button',
        on: { click: showCalibPoints }
      }, [
        A.h('span', { class: 'body' }, [
          A.h('b', { text: main }),
          A.h('span', { class: 's', text: sub })
        ]),
        A.h('span', { class: 'chev', text: '›' })
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
          A.h('span', null, [A.h('i', { class: 'sw-now' }), '现在']),
          A.h('span', null, [A.h('i', { class: 'sw-rs' }), '真实日落']),
          A.h('span', null, [A.h('i', { class: 'sw-blue' }), '蓝调窗口']),
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
      // 航海暮光时的 EV100 是负的；iOS 的 decimal 键盘上没有负号，带 ± 键
      var evNI = A.numInput({ placeholder: '例如 ' + predicted.toFixed(1), signed: true,
                              ariaLabel: '实测 EV100' });
      var evIn = evNI.input;

      // 测光表给的是光圈+快门+ISO，提供一个换算入口
      var nNI = A.numInput({ placeholder: 'T 档', ariaLabel: 'T 档', onInput: function () { conv(); } });
      var isoNI = A.numInput({ value: w.auto ? w.auto.iso : result.isoLow, integer: true,
                               ariaLabel: 'ISO', onInput: function () { conv(); } });
      var shNI = A.numInput({ value: result.shutterSec ? Math.round(1 / result.shutterSec) : 48,
                              integer: true, ariaLabel: '快门 1/x 秒', onInput: function () { conv(); } });
      var convOut = A.h('div', { class: 'hint' });
      function conv() {
        var n = nNI.value(), iso = isoNI.value(), inv = shNI.value();
        var t = (inv > 0) ? 1 / inv : null;
        var v = E.ev100From(n, t, iso);
        if (v === null) { convOut.textContent = '三个都填了才能换算。'; return null; }
        convOut.innerHTML = '换算得 EV100 <strong>' + v.toFixed(2) + '</strong>';
        return v;
      }
      conv();

      var useBtn = A.h('button', {
        class: 'btn sm', type: 'button', style: 'margin-top:10px',
        on: {
          click: function () {
            var v = conv();
            if (v === null) { A.toast('三个都填了才能换算'); return; }
            evNI.set(Math.round(v * 100) / 100);
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
                A.h('div', { class: 'field', style: 'margin:0' }, [A.h('label', { text: 'T 档' }), nNI.node]),
                A.h('div', { class: 'field', style: 'margin:0' }, [A.h('label', { text: '1/x 秒' }), shNI.node]),
                A.h('div', { class: 'field', style: 'margin:0' }, [A.h('label', { text: 'ISO' }), isoNI.node])
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
        var ev = evNI.value();
        if (ev === null) { A.toast('没填实测 EV100'); return; }
        Cal.add({
          recordId: rec.id, dateKey: dateKey, ms: w.ms,
          alt: w.altitude, ev100: ev
        }).then(function () {
          return Cal.fitFor(rec.id);
        }).then(function (c) {
          if (disposed) { return; }
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
              .then(function (c) {
                if (disposed) { return; }
                calibInfo = c; rebuild(); A.toast('已清空');
              });
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
