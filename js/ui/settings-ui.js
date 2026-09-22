/*!
 * 蓝调勘景仪 Blue Hour Scout — js/ui/settings-ui.js
 *
 * 项目设置：摄影机、镜头、蓝调区间、灯具。
 *
 * 这一页放的是**定义**，不是每次拍摄都要改的东西。
 * 真正常改的两样——当前用哪支镜头、这个机位打算拍几个 setup——
 * 直接做在时间轴页上，不用绕到这里来。
 */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  root.BH = root.BH || {};
  root.BH.SettingsUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var A = null, St = null, E = null;
  function deps() {
    A = A || root.BH.App; St = St || root.BH.Settings; E = E || root.BH.Exposure;
  }

  var SAVE_DEBOUNCE = 500;

  function render(params, view) {
    deps();
    var s = null, saveTimer = null, dirty = false;

    A.setTop({ title: '项目设置', back: true });
    view.appendChild(A.h('div', { class: 'hint', text: '载入中…' }));

    St.load().then(function (loaded) {
      s = loaded;
      A.clear(view);
      build();
    }).catch(function (e) {
      A.clear(view);
      view.appendChild(A.h('div', { class: 'note bad', text: '读取设置失败：' + e.message }));
    });

    function scheduleSave() {
      dirty = true;
      if (saveTimer) { clearTimeout(saveTimer); }
      saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE);
    }
    function flushSave() {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      if (!s || !dirty) { return Promise.resolve(); }
      dirty = false;
      return St.save(s).catch(function (e) {
        dirty = true;
        A.toast('保存失败：' + e.message, 4000);
      });
    }

    function numField(label, unit, value, onChange, attrs) {
      var inp = A.h('input', Object.assign({
        type: 'number', step: 'any', inputmode: 'decimal',
        value: (value === null || value === undefined) ? '' : value
      }, attrs || {}));
      inp.addEventListener('input', function () {
        onChange(inp.value === '' ? null : parseFloat(inp.value));
        scheduleSave();
      });
      return A.h('div', { class: 'field' }, [
        A.h('label', null, [label, unit ? A.h('span', { class: 'unit', text: '（' + unit + '）' }) : null]),
        inp
      ]);
    }

    function build() {
      A.setTop({ title: '项目设置', back: function () { flushSave().then(function () { A.back(); }); } });
      A.setDock([
        A.h('button', {
          class: 'btn primary block', type: 'button',
          on: { click: function () { flushSave().then(function () { A.back(); }); } }
        }, '完成')
      ]);

      view.appendChild(buildCamera());
      view.appendChild(buildLenses());
      view.appendChild(buildBlue());
      view.appendChild(buildLights());
      view.appendChild(A.h('div', { class: 'danger-zone' }, [
        A.h('button', {
          class: 'btn ghost block', type: 'button',
          on: {
            click: function () {
              A.confirm('恢复默认设置？', '摄影机、镜头、蓝调区间、灯具全部回到预设值，已填的照度会丢失。',
                        '恢复默认', 'danger').then(function (ok) {
                if (!ok) { return; }
                St.reset().then(function (d) {
                  s = d; dirty = false;
                  A.clear(view); build();
                  A.toast('已恢复默认设置');
                });
              });
            }
          }
        }, '恢复默认设置')
      ]));
      view.appendChild(A.h('p', { class: 'hint', text: '改动自动保存。' }));
    }

    // -------------------------------------------------------- 摄影机

    function buildCamera() {
      var c = s.camera;
      var shutterOut = A.h('div', { class: 'hint' });
      function syncShutter() {
        var t = E.shutterSeconds(c.shutterAngle, c.fps);
        shutterOut.textContent = t
          ? '快门速度 1/' + Math.round(1 / t) + ' 秒（曝光换算用的就是这个值）'
          : '帧率或快门角度无效';
      }
      syncShutter();

      var nameIn = A.h('input', { type: 'text', value: c.name, maxlength: 80 });
      nameIn.addEventListener('input', function () { c.name = nameIn.value; scheduleSave(); });

      return A.h('div', { class: 'card' }, [
        A.h('div', { class: 'card-head' }, [A.h('h2', { text: '摄影机' })]),
        A.h('div', { class: 'field' }, [A.h('label', { text: '机型' }), nameIn]),
        A.h('div', { class: 'row' }, [
          numField('原生 ISO 低档', null, c.isoLow, function (v) { c.isoLow = v; }, { min: 1 }),
          numField('原生 ISO 高档', null, c.isoHigh, function (v) { c.isoHigh = v; }, { min: 1 })
        ]),
        A.h('div', { class: 'row' }, [
          numField('帧率', 'fps', c.fps, function (v) { c.fps = v; syncShutter(); }, { min: 1 }),
          numField('快门角度', '度', c.shutterAngle, function (v) { c.shutterAngle = v; syncShutter(); },
                   { min: 1, max: 360 })
        ]),
        shutterOut
      ]);
    }

    // ---------------------------------------------------------- 镜头

    function buildLenses() {
      var listBox = A.h('div');

      function paint() {
        A.clear(listBox);
        s.lenses.forEach(function (L, i) {
          var nameIn = A.h('input', { type: 'text', value: L.name, maxlength: 80 });
          nameIn.addEventListener('input', function () { L.name = nameIn.value; scheduleSave(); });
          var apIn = A.h('input', {
            type: 'number', step: 'any', inputmode: 'decimal',
            value: L.maxAperture === null ? '' : L.maxAperture, min: 0.5, max: 64
          });
          apIn.addEventListener('input', function () {
            var v = parseFloat(apIn.value);
            L.maxAperture = isFinite(v) ? v : null;
            scheduleSave();
          });
          listBox.appendChild(A.h('div', {
            style: 'padding:12px 0;border-bottom:1px solid var(--line-soft)'
          }, [
            A.h('div', { class: 'row tight', style: 'align-items:flex-end' }, [
              A.h('div', { class: 'field', style: 'flex:2;margin:0' }, [
                A.h('label', { text: '第 ' + (i + 1) + ' 支' }), nameIn
              ]),
              A.h('div', { class: 'field', style: 'flex:1;margin:0' }, [
                A.h('label', { text: '最大光圈' }), apIn
              ])
            ]),
            A.h('button', {
              class: 'btn sm ghost', type: 'button', style: 'margin-top:9px',
              on: {
                click: function () {
                  s.lenses.splice(i, 1);
                  if (s.selectedLens >= s.lenses.length) { s.selectedLens = s.lenses.length - 1; }
                  scheduleSave(); paint();
                }
              }
            }, '删除这支')
          ]));
        });
        if (!s.lenses.length) {
          listBox.appendChild(A.h('p', { class: 'hint', text: '还没有镜头。' }));
        }
      }
      paint();

      return A.h('div', { class: 'card' }, [
        A.h('div', { class: 'card-head' }, [
          A.h('h2', { text: '镜头' }),
          A.h('span', { class: 'meta', text: s.lenses.length + ' 支' })
        ]),
        A.h('p', { class: 'hint', style: 'margin-top:0' },
          '光圈值按厂标预填，和实际 T 档可能有出入，随时可改。' +
          '时间轴会用当前选中镜头的最大光圈判断什么时候必须切到高原生 ISO。'),
        listBox,
        A.h('button', {
          class: 'btn sm', type: 'button', style: 'margin-top:12px',
          on: {
            click: function () {
              s.lenses.push({ name: '新镜头', maxAperture: 2.8 });
              scheduleSave(); paint();
            }
          }
        }, '＋ 加一支镜头')
      ]);
    }

    // ------------------------------------------------------ 蓝调区间

    function buildBlue() {
      var out = A.h('div', { class: 'hint' });
      function sync() {
        out.textContent = '窗口 = 太阳视高度角从 ' + A.deg(s.blueRange.upper) +
                          ' 降到 ' + A.deg(s.blueRange.lower) + ' 的那段时间。';
      }
      sync();
      return A.h('div', { class: 'card' }, [
        A.h('div', { class: 'card-head' }, [A.h('h2', { text: '蓝调区间' })]),
        A.h('div', { class: 'row' }, [
          numField('上界', '度', s.blueRange.upper, function (v) {
            s.blueRange.upper = v; sync();
          }, { min: -90, max: 90 }),
          numField('下界', '度', s.blueRange.lower, function (v) {
            s.blueRange.lower = v; sync();
          }, { min: -90, max: 90 })
        ]),
        out,
        A.h('p', { class: 'hint' },
          '默认 0° 到 −9°。0° 是太阳视位置擦过地平线的那一刻，' +
          '−6° 是民用暮光结束，−12° 是航海暮光结束。')
      ]);
    }

    // ---------------------------------------------------------- 灯具

    function buildLights() {
      var listBox = A.h('div');

      function paint() {
        A.clear(listBox);
        s.lights.forEach(function (L, i) {
          var evOut = A.h('div', { class: 'hint' });
          function syncEV() {
            if (!(L.lux > 0)) {
              evOut.textContent = '填了照度才能算交叉点。';
              return;
            }
            var ev = E.luxToEV100(L.lux);
            var at2 = E.luxAtDistance(L.lux, L.distance || 1, 2);
            evOut.textContent = 'EV100 ' + ev.toFixed(2) +
              ' · 换到 2 米处约 ' + Math.round(at2) + ' lux（EV100 ' +
              E.luxToEV100(at2).toFixed(2) + '）';
          }

          var nameIn = A.h('input', { type: 'text', value: L.name, maxlength: 80 });
          nameIn.addEventListener('input', function () { L.name = nameIn.value; scheduleSave(); });

          var luxIn = A.h('input', {
            type: 'number', step: 'any', inputmode: 'decimal', min: 0,
            value: L.lux === null ? '' : L.lux, placeholder: '例如 1200'
          });
          luxIn.addEventListener('input', function () {
            var v = parseFloat(luxIn.value);
            L.lux = isFinite(v) && v > 0 ? v : null;
            syncEV(); scheduleSave();
          });

          var distIn = A.h('input', {
            type: 'number', step: 'any', inputmode: 'decimal', min: 0.01,
            value: L.distance === null ? '' : L.distance
          });
          distIn.addEventListener('input', function () {
            var v = parseFloat(distIn.value);
            L.distance = isFinite(v) && v > 0 ? v : 1;
            syncEV(); scheduleSave();
          });

          syncEV();
          listBox.appendChild(A.h('div', {
            style: 'padding:12px 0;border-bottom:1px solid var(--line-soft)'
          }, [
            A.h('div', { class: 'field', style: 'margin-bottom:10px' }, [
              A.h('label', { text: '第 ' + (i + 1) + ' 支' }), nameIn
            ]),
            A.h('div', { class: 'row tight' }, [
              A.h('div', { class: 'field', style: 'margin:0' }, [
                A.h('label', { text: '照度' }), luxIn
              ]),
              A.h('div', { class: 'field', style: 'margin:0' }, [
                A.h('label', { text: '测量距离（米）' }), distIn
              ])
            ]),
            evOut,
            A.h('button', {
              class: 'btn sm ghost', type: 'button', style: 'margin-top:9px',
              on: { click: function () { s.lights.splice(i, 1); scheduleSave(); paint(); } }
            }, '删除这支')
          ]));
        });
        if (!s.lights.length) {
          listBox.appendChild(A.h('p', { class: 'hint', text: '还没有灯具。' }));
        }
      }
      paint();

      return A.h('div', { class: 'card' }, [
        A.h('div', { class: 'card-head' }, [
          A.h('h2', { text: '灯具' }),
          A.h('span', { class: 'meta', text: s.lights.length + ' 支' })
        ]),
        A.h('p', { class: 'hint', style: 'margin-top:0' },
          '填在某个距离上的照度（lux），时间轴会标出环境光衰减到和这支灯相等的那一分钟。'),
        listBox,
        A.h('button', {
          class: 'btn sm', type: 'button', style: 'margin-top:12px',
          on: {
            click: function () {
              s.lights.push({ name: '新灯具', lux: null, distance: 1 });
              scheduleSave(); paint();
            }
          }
        }, '＋ 加一支灯'),
        A.h('details', { class: 'fold' }, [
          A.h('summary', null, '照度怎么填'),
          A.h('div', { class: 'fold-body' }, [
            A.h('p', { class: 'hint' },
              '厂商规格表通常会给"1 米处 XXXX lux"这样的数，直接填进去，距离填 1。' +
              '手上有测光表的话，把灯摆到实拍距离上直接测一个更准。'),
            A.h('p', { class: 'hint' },
              '换算关系：EV100 = log2(照度 ÷ 2.5)。' +
              '距离变化按平方反比：距离翻倍，照度降到四分之一。'),
            A.h('p', { class: 'hint' },
              '几个参考值：160 lux = EV100 6，640 lux = EV100 8，2560 lux = EV100 10。')
          ])
        ])
      ]);
    }

    return function () { flushSave(); };
  }

  return { render: render };
});
