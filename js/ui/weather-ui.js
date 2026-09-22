/*!
 * 蓝调勘景仪 Blue Hour Scout — js/ui/weather-ui.js
 *
 * 功能三：七天云量决策表。
 *
 * 每天一张卡，三层云各占一列分开显示（不合并成一个"总云量"——
 * 低云挡光、高云出层次，混在一起就没法判断了）。
 * 结论主要看低云。
 *
 * 这是整个工具唯一联网的地方。断网时显示缓存并标明获取时间。
 */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  root.BH = root.BH || {};
  root.BH.WeatherUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var A, R, Z, S, C, W, St;
  function deps() {
    A = root.BH.App; R = root.BH.Records; Z = root.BH.Tz; S = root.BH.Solar;
    C = root.BH.Cloud; W = root.BH.Weather; St = root.BH.Settings;
  }

  var DAYS = 7;
  var WEEKDAY = ['日', '一', '二', '三', '四', '五', '六'];

  function render(params, view) {
    deps();
    var rec = null, settings = null, data = null, rows = [], windows = [];
    var disposed = false, loading = false;

    A.setTop({ title: '七天云量', back: true });
    view.appendChild(A.h('div', { class: 'hint', text: '载入中…' }));

    Promise.all([R.load(params.id), St.load()]).then(function (res) {
      if (disposed) { return; }
      if (!res[0]) { A.toast('记录不存在'); A.go('/', true); return; }
      rec = R.normalize(res[0]);
      settings = res[1];
      if (rec.lat === null || rec.lon === null) {
        A.clear(view);
        A.setTop({ title: '七天云量', sub: rec.name || undefined, back: true });
        view.appendChild(A.h('div', { class: 'note bad' },
          '这条记录还没有坐标，拉不了天气预报。先回第 1 步补上。'));
        return;
      }
      return refresh(false);
    }).catch(function (e) {
      A.clear(view);
      view.appendChild(A.h('div', { class: 'note bad',
        text: '载入失败：' + (e && e.message ? e.message : e) }));
    });

    /** 算出未来 DAYS 天各自的蓝调窗口（epoch 毫秒）。 */
    function computeWindows() {
      var blue = settings.blueRange || { upper: 0, lower: -9 };
      var upper = blue.upper, lower = blue.lower;
      if (lower > upper) { var t = lower; lower = upper; upper = t; }

      var todayKey = Z.dateKey(Date.now(), rec.tz);
      var d0 = Z.parseDateKey(todayKey);
      var out = [];
      for (var i = 0; i < DAYS; i++) {
        var dt = new Date(Date.UTC(d0.year, d0.month - 1, d0.day + i));
        var y = dt.getUTCFullYear(), m = dt.getUTCMonth() + 1, dd = dt.getUTCDate();
        var key = Z.pad(y, 4) + '-' + Z.pad(m, 2) + '-' + Z.pad(dd, 2);
        var noonRef = Z.localNoonMs(rec.tz, y, m, dd);
        var a = S.apparentAltitudeCrossing(noonRef, rec.lat, rec.lon, upper, false);
        var b = S.apparentAltitudeCrossing(noonRef, rec.lat, rec.lon, lower, false);
        out.push({
          dateKey: key, startMs: a, endMs: b,
          isToday: i === 0,
          weekday: WEEKDAY[dt.getUTCDay()]
        });
      }
      return out;
    }

    function refresh(force) {
      if (loading) { return Promise.resolve(); }
      loading = true;
      paintLoading(force);
      return W.load(rec.lat, rec.lon, { force: force }).then(function (res) {
        if (disposed) { return; }
        data = res;
        windows = computeWindows();
        rows = C.buildRows(res.hourly, windows);
        loading = false;
        paint();
      }).catch(function (e) {
        if (disposed) { return; }
        loading = false;
        data = { hourly: null, fetchedAt: null, cached: false, stale: false,
                 error: e && e.message ? e.message : String(e) };
        windows = computeWindows();
        rows = [];
        paint();
      });
    }

    function paintLoading(force) {
      A.clear(view);
      A.setTop({ title: '七天云量', sub: rec.name || undefined, back: true });
      view.appendChild(A.h('div', { class: 'src' }, [
        A.h('div', { class: 'txt', text: force ? '正在重新拉取…' : '正在读取预报…' })
      ]));
    }

    function paint() {
      A.clear(view);
      A.setTop({
        title: '七天云量',
        sub: rec.name || undefined,
        back: function () { A.go('/rec/' + rec.id); }
      });
      A.setDock([
        A.h('button', {
          class: 'btn ghost', type: 'button', style: 'flex:0 0 40%',
          on: { click: function () { A.go('/rec/' + rec.id + '/timeline'); } }
        }, '时间轴'),
        A.h('button', {
          class: 'btn primary', type: 'button',
          on: { click: function () { A.go('/rec/' + rec.id); } }
        }, '返回记录')
      ]);

      view.appendChild(buildSource());

      if (!data.hourly) {
        view.appendChild(A.h('div', { class: 'note bad' }, [
          A.h('b', { text: '拿不到预报数据。' }),
          data.error ? ' ' + data.error : '',
          A.h('br'),
          '这是整个工具唯一需要联网的功能，其它部分断网照常可用。'
        ]));
        return;
      }

      rows.forEach(function (r, i) { view.appendChild(buildDay(r, windows[i])); });
      view.appendChild(buildLegend());
    }

    function buildSource() {
      var cls = 'src';
      var txt;
      if (!data.hourly) {
        cls += ' err';
        txt = [A.h('b', { text: '没有数据。' }), ' 连不上 Open-Meteo，本机也没有缓存。'];
      } else if (data.stale) {
        cls += ' stale';
        txt = [A.h('b', { text: '缓存数据。' }),
               ' 获取于 ' + stamp(data.fetchedAt) + '（' + A.relTime(data.fetchedAt) + '）。' +
               '这次没连上：' + (data.error || '网络不可用')];
      } else {
        txt = ['数据来自 Open-Meteo，获取于 ',
               A.h('b', { text: stamp(data.fetchedAt) }),
               '（' + A.relTime(data.fetchedAt) + '）'];
      }
      return A.h('div', { class: cls }, [
        A.h('div', { class: 'txt' }, txt),
        A.h('button', {
          class: 'btn sm ghost', type: 'button', style: 'flex:none',
          on: { click: function () { refresh(true); } }
        }, '刷新')
      ]);
    }

    function stamp(ms) {
      if (!ms) { return '—'; }
      var p = Z.zonedParts(ms, rec.tz);
      return Z.pad(p.month, 2) + '/' + Z.pad(p.day, 2) + ' ' +
             Z.pad(p.hour, 2) + ':' + Z.pad(p.minute, 2);
    }

    function pct(v) { return v === null ? '—' : Math.round(v) + '%'; }

    function buildDay(r, w) {
      var lvl = r.verdict.level;
      var badgeCls = lvl === 'good' ? 'ok' : lvl === 'maybe' ? 'warn'
                   : lvl === 'bad' ? 'bad' : 'mute';
      var d = Z.parseDateKey(r.dateKey);

      var children = [
        A.h('div', { class: 'head' }, [
          A.h('span', { class: 'd', text: d.month + '/' + d.day + ' 周' + w.weekday }),
          A.h('span', { class: 'w', text: w.isToday ? '今天' : '' }),
          A.h('span', { class: 'badge ' + badgeCls, text: r.verdict.label })
        ]),
        A.h('div', { class: 'win', text: r.startMs === null
          ? '这一天没有蓝调窗口'
          : '蓝调 ' + Z.formatTime(r.startMs, rec.tz) + '–' + Z.formatTime(r.endMs, rec.tz) +
            ' · ' + Math.round((r.endMs - r.startMs) / 60000) + ' 分钟' })
      ];

      if (r.startMs !== null) {
        children.push(A.h('div', { class: 'cloud-cols' }, [
          A.h('div', { class: 'low' }, [
            A.h('div', { class: 'k', text: '低云' }),
            A.h('div', { class: 'v', text: pct(r.low) })
          ]),
          A.h('div', null, [
            A.h('div', { class: 'k', text: '中云' }),
            A.h('div', { class: 'v', text: pct(r.mid) })
          ]),
          A.h('div', null, [
            A.h('div', { class: 'k', text: '高云' }),
            A.h('div', { class: 'v', text: pct(r.high) })
          ])
        ]));
        children.push(A.h('div', { class: 'meta2' }, [
          A.h('span', null, ['降水概率 ', A.h('b', { text: pct(r.precip) })]),
          A.h('span', null, ['气温 ', A.h('b', {
            text: r.temp === null ? '—' : r.temp.toFixed(1) + '°C'
          })])
        ]));
        if (r.verdict.note) {
          children.push(A.h('div', { class: 'note', text: '◆ ' + r.verdict.note }));
        }
        if (r.coverage < 0.99 && r.coverage > 0) {
          children.push(A.h('div', { class: 'partial',
            text: '预报只覆盖了这个窗口的 ' + Math.round(r.coverage * 100) + '%。' }));
        } else if (r.coverage === 0) {
          children.push(A.h('div', { class: 'partial',
            text: '预报没有覆盖到这个窗口。' }));
        }
      }

      return A.h('div', {
        class: 'day-card ' + lvl + (w.isToday ? ' today' : '')
      }, children);
    }

    function buildLegend() {
      return A.h('div', { class: 'card' }, [
        A.h('div', { class: 'card-head' }, [A.h('h2', { text: '怎么读' })]),
        A.h('p', { class: 'hint', style: 'margin-top:0' },
          '结论只看低云：低于 ' + C.LOW_GOOD + '% 是「好」，' +
          C.LOW_GOOD + '–' + C.LOW_MAYBE + '% 是「可能」，高于 ' +
          C.LOW_MAYBE + '% 是「不建议」。低云是真正挡光、把天空压成一片灰的那一层。'),
        A.h('p', { class: 'hint' },
          '高云不挡光，反而是出颜色的那一层。超过 ' + C.HIGH_TEXTURE +
          '% 会额外标一句「高云可能增加天空层次」，这时候往往值得去。'),
        A.h('p', { class: 'hint' },
          '数值是该日蓝调窗口覆盖的那几个小时按**重叠时长**加权平均出来的，' +
          '不是整点值——窗口通常只有四十来分钟，还常常横跨两个整点。'
            .replace(/\*\*/g, '')),
        A.h('p', { class: 'hint' },
          '预报来自 Open-Meteo（免费、无需 key）。这是整个工具唯一联网的功能，' +
          '结果会缓存，断网时显示缓存并标明获取时间。')
      ]);
    }

    return function () { disposed = true; };
  }

  return { render: render };
});
