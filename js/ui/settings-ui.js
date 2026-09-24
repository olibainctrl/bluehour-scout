/*!
 * 蓝调勘景仪 Blue Hour Scout — js/ui/settings-ui.js
 *
 * 项目设置：外观、摄影机、镜头、蓝调区间、灯具。
 *
 * 版面是"摘要行 + 点开编辑"，和记录概览页一个路数。
 * 早先是一整页展开的表单：六支镜头每支都是一组输入框加一个「删除这支」，
 * 整页 3.6 屏，而且八个删除按钮**点了直接删、没有确认**，就排在滚动路径上。
 * 现在每一项点开是一个抽屉，删除收进抽屉里并且要二次确认。
 *
 * 当前用哪支镜头、这个机位拍几个 setup 这两样是每次拍摄都会动的，
 * 直接做在时间轴页上，不用绕到这里。
 */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  root.BH = root.BH || {};
  root.BH.SettingsUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var A, St, E, Th;
  function deps() {
    A = root.BH.App; St = root.BH.Settings; E = root.BH.Exposure; Th = root.BH.Theme;
  }

  function render(params, view) {
    deps();
    var s = null, disposed = false;

    A.setTop({ title: '项目设置', back: true });
    view.appendChild(A.h('div', { class: 'hint', text: '载入中…' }));

    St.load().then(function (loaded) {
      if (disposed) { return; }
      s = loaded;
      paint();
    }).catch(function (e) {
      if (disposed) { return; }
      A.clear(view);
      view.appendChild(A.h('div', { class: 'note bad', text: '读取设置失败：' + e.message }));
    });

    function save() {
      return St.save(s).then(function (saved) {
        s = saved;
        if (!disposed) { paint(); }
      }).catch(function (e) { A.toast('保存失败：' + e.message, 4000); });
    }

    function paint() {
      A.clear(view);
      A.setTop({ title: '项目设置', back: true });
      A.setDock([
        A.h('button', {
          class: 'btn primary block', type: 'button', on: { click: function () { A.back(); } }
        }, '完成')
      ]);

      view.appendChild(buildAppearance());

      view.appendChild(A.h('p', { class: 'section-title', text: '摄影机' }));
      view.appendChild(A.h('div', { class: 'nav-list' }, [cameraRow()]));

      view.appendChild(A.h('p', { class: 'section-title', text: '镜头 · ' + s.lenses.length + ' 支' }));
      var lensList = A.h('div', { class: 'nav-list' });
      s.lenses.forEach(function (L, i) { lensList.appendChild(lensRow(L, i)); });
      lensList.appendChild(addRow('加一支镜头', function () {
        editLens(null, s.lenses.length);
      }));
      view.appendChild(lensList);

      view.appendChild(A.h('p', { class: 'section-title', text: '蓝调区间' }));
      view.appendChild(A.h('div', { class: 'nav-list' }, [blueRow()]));

      view.appendChild(A.h('p', { class: 'section-title', text: '灯具 · ' + s.lights.length + ' 支' }));
      var lightList = A.h('div', { class: 'nav-list' });
      s.lights.forEach(function (L, i) { lightList.appendChild(lightRow(L, i)); });
      lightList.appendChild(addRow('加一支灯', function () {
        editLight(null, s.lights.length);
      }));
      view.appendChild(lightList);

      view.appendChild(A.h('details', { class: 'fold' }, [
        A.h('summary', null, '灯具照度怎么填'),
        A.h('div', { class: 'fold-body' }, [
          A.h('p', { class: 'hint' },
            '厂商规格表通常会给"1 米处 XXXX lux"，直接填，距离填 1。' +
            '手上有测光表的话，把灯摆到实拍距离上测一个更准。'),
          A.h('p', { class: 'hint' },
            '换算：EV100 = log2(照度 ÷ 2.5)。距离翻倍照度降到四分之一（平方反比）。'),
          A.h('p', { class: 'hint' }, '参考：160 lux = EV100 6，640 lux = EV100 8，2560 lux = EV100 10。')
        ])
      ]));

      view.appendChild(A.h('div', { class: 'danger-zone' }, [
        A.h('button', {
          class: 'btn ghost block', type: 'button',
          on: {
            click: function () {
              A.confirm('恢复默认设置？',
                '摄影机、镜头、蓝调区间、灯具全部回到预设值，已填的照度会丢失。外观不受影响。',
                '恢复默认', 'danger').then(function (ok) {
                if (!ok) { return; }
                St.reset().then(function (d) {
                  if (disposed) { return; }
                  s = d; paint();
                  A.toast('已恢复默认设置');
                });
              });
            }
          }
        }, '恢复默认设置')
      ]));
    }

    // ---------------------------------------------------------- 外观

    function buildAppearance() {
      var cur = Th.get();
      function seg(value, label, iconName, note) {
        var on = cur === value;
        return A.h('button', {
          class: 'seg' + (on ? ' on' : ''), type: 'button', 'aria-pressed': on ? 'true' : 'false',
          on: {
            click: function () {
              if (Th.get() === value) { return; }
              Th.set(value);
              paint();
            }
          }
        }, [A.icon(iconName, 18), A.h('span', { class: 'l', text: label }),
            A.h('span', { class: 's', text: note })]);
      }
      return A.h('div', { class: 'card' }, [
        A.h('div', { class: 'card-head' }, [A.h('h2', { text: '外观' })]),
        A.h('div', { class: 'segs' }, [
          seg('dark', '夜间', 'moon', '黄昏和夜里，保护暗适应'),
          seg('light', '日间', 'sun', '白天强光下勘景')
        ]),
        A.h('p', { class: 'hint' }, '每一页右上角也有一个日/夜按钮，一下就能切。')
      ]);
    }

    // ------------------------------------------------------- 通用行

    function row(title, sub, onClick, badge) {
      return A.h('button', { class: 'nav-row', type: 'button', on: { click: onClick } }, [
        A.h('span', { class: 'body' }, [
          A.h('span', { class: 't', text: title }),
          sub ? A.h('span', { class: 's', text: sub }) : null
        ]),
        badge || null,
        A.h('span', { class: 'chev', text: '›' })
      ]);
    }

    function addRow(label, onClick) {
      return A.h('button', { class: 'nav-row add', type: 'button', on: { click: onClick } }, [
        A.h('span', { class: 'num tool' }, A.icon('plus', 16)),
        A.h('span', { class: 'body' }, [A.h('span', { class: 't', text: label })])
      ]);
    }

    function field(label, node, note) {
      return A.h('div', { class: 'field' }, [
        A.h('label', null, label), node,
        note ? A.h('div', { class: 'hint' }, note) : null
      ]);
    }

    // -------------------------------------------------------- 摄影机

    function cameraRow() {
      var c = s.camera;
      var t = E.shutterSeconds(c.shutterAngle, c.fps);
      return row(c.name,
        'ISO ' + c.isoLow + ' / ' + c.isoHigh + ' · ' + c.fps + 'fps · ' + c.shutterAngle + '°' +
        (t ? ' · 1/' + Math.round(1 / t) + 's' : ''),
        editCamera);
    }

    function editCamera() {
      var c = s.camera;
      var nameIn = A.h('input', { type: 'text', value: c.name, maxlength: 80 });
      var isoLo = A.numInput({ value: c.isoLow, integer: true, onInput: preview });
      var isoHi = A.numInput({ value: c.isoHigh, integer: true, onInput: preview });
      var fps = A.numInput({ value: c.fps, onInput: preview });
      var ang = A.numInput({ value: c.shutterAngle, onInput: preview });
      var out = A.h('div', { class: 'hint' });
      function preview() {
        if (!fps || !ang) { return; }
        var t = E.shutterSeconds(ang.value(), fps.value());
        out.textContent = t ? '快门速度 1/' + Math.round(1 / t) + ' 秒，曝光换算用的就是这个。'
                            : '帧率或快门角度无效。';
      }
      preview();

      A.sheet({
        title: '摄影机',
        dismissValue: null,
        body: A.h('div', null, [
          field('机型', nameIn),
          A.h('div', { class: 'row' }, [
            field('原生 ISO 低档', isoLo.node), field('原生 ISO 高档', isoHi.node)
          ]),
          A.h('div', { class: 'row' }, [
            field('帧率（fps）', fps.node), field('快门角度（度）', ang.node)
          ]),
          out
        ]),
        actions: [
          { label: '取消', value: null, kind: 'ghost' },
          { label: '保存', value: 'save', kind: 'primary' }
        ]
      }).then(function (v) {
        if (v !== 'save') { return; }
        c.name = nameIn.value.trim() || c.name;
        if (isoLo.value() > 0) { c.isoLow = isoLo.value(); }
        if (isoHi.value() > 0) { c.isoHigh = isoHi.value(); }
        if (fps.value() > 0) { c.fps = fps.value(); }
        if (ang.value() > 0 && ang.value() <= 360) { c.shutterAngle = ang.value(); }
        save();
      });
    }

    // ---------------------------------------------------------- 镜头

    function lensRow(L, i) {
      var cur = s.selectedLens === i;
      return row(L.name,
        (L.maxAperture ? '最大光圈 T' + L.maxAperture : '没填最大光圈') + (cur ? ' · 当前在用' : ''),
        function () { editLens(L, i); },
        cur ? A.h('span', { class: 'badge ok', text: '在用' }) : null);
    }

    function editLens(L, i) {
      var isNew = !L;
      var nameIn = A.h('input', { type: 'text', value: L ? L.name : '', maxlength: 80,
                                  placeholder: '例如 Canon nFD 85mm F1.8' });
      var ap = A.numInput({ value: L ? L.maxAperture : null, placeholder: '例如 1.8' });
      var actions = [{ label: '取消', value: null, kind: 'ghost' }];
      if (!isNew) { actions.unshift({ label: '删除', value: 'del', kind: 'danger' }); }
      actions.push({ label: isNew ? '添加' : '保存', value: 'save', kind: 'primary' });

      A.sheet({
        title: isNew ? '加一支镜头' : '镜头',
        sub: '光圈按厂标填就行。时间轴会用当前在用镜头的最大光圈判断什么时候必须切到高原生 ISO。',
        dismissValue: null,
        body: A.h('div', null, [
          field('名称', nameIn),
          field('最大光圈', ap.node),
          (!isNew && s.selectedLens !== i) ? A.h('button', {
            class: 'btn sm', type: 'button',
            on: { click: function () { s.selectedLens = i; save(); A.toast('已设为当前镜头'); } }
          }, '设为当前在用') : null
        ]),
        actions: actions
      }).then(function (v) {
        if (v === 'del') {
          return A.confirm('删除「' + L.name + '」？', '这支镜头会从列表里去掉。', '删除', 'danger')
            .then(function (ok) {
              if (!ok) { return; }
              s.lenses.splice(i, 1);
              if (s.selectedLens === i) { s.selectedLens = s.lenses.length ? 0 : null; }
              else if (s.selectedLens > i) { s.selectedLens--; }
              save();
            });
        }
        if (v !== 'save') { return; }
        var name = nameIn.value.trim();
        if (!name) { A.toast('没填名称'); return; }
        var a = ap.value();
        var entry = { name: name, maxAperture: (a > 0 && a < 64) ? a : null };
        if (isNew) { s.lenses.push(entry); } else { s.lenses[i] = entry; }
        save();
      });
    }

    // ------------------------------------------------------ 蓝调区间

    function blueRow() {
      var b = s.blueRange;
      return row(A.deg(b.upper, 0) + ' → ' + A.deg(b.lower, 0),
        '太阳视高度角从上界降到下界的这段时间', editBlue);
    }

    function editBlue() {
      var b = s.blueRange;
      // 下界默认 −9°：必须能输负号
      var up = A.numInput({ value: b.upper, signed: true });
      var lo = A.numInput({ value: b.lower, signed: true });
      A.sheet({
        title: '蓝调区间',
        sub: '0° 是太阳视位置擦过地平线的那一刻，−6° 是民用暮光结束，−12° 是航海暮光结束。',
        dismissValue: null,
        body: A.h('div', { class: 'row' }, [field('上界（度）', up.node), field('下界（度）', lo.node)]),
        actions: [
          { label: '恢复 0° / −9°', value: 'reset', kind: 'ghost' },
          { label: '取消', value: null, kind: 'ghost' },
          { label: '保存', value: 'save', kind: 'primary' }
        ]
      }).then(function (v) {
        if (v === 'reset') { s.blueRange = { upper: 0, lower: -9 }; save(); return; }
        if (v !== 'save') { return; }
        var u = up.value(), l = lo.value();
        if (u === null || l === null) { A.toast('上下界都要填'); return; }
        if (u === l) { A.toast('上下界相同，窗口会是 0 分钟'); }
        s.blueRange = { upper: Math.max(u, l), lower: Math.min(u, l) };
        save();
      });
    }

    // ---------------------------------------------------------- 灯具

    function lightRow(L, i) {
      var sub = L.lux > 0
        ? Math.round(L.lux) + ' lux @ ' + (L.distance || 1) + ' 米 · EV100 ' + E.luxToEV100(L.lux).toFixed(1)
        : '还没填照度，时间轴不会标它的交叉点';
      return row(L.name, sub, function () { editLight(L, i); });
    }

    function editLight(L, i) {
      var isNew = !L;
      var nameIn = A.h('input', { type: 'text', value: L ? L.name : '', maxlength: 80,
                                  placeholder: '例如 Aputure MC Pro' });
      var lux = A.numInput({ value: L ? L.lux : null, placeholder: '例如 1200', onInput: preview });
      var dist = A.numInput({ value: L ? (L.distance || 1) : 1, onInput: preview });
      var out = A.h('div', { class: 'hint' });
      function preview() {
        if (!lux || !dist) { return; }
        var x = lux.value(), d = dist.value() || 1;
        if (!(x > 0)) { out.textContent = '填了照度才能算 EV100。'; return; }
        var at2 = E.luxAtDistance(x, d, 2);
        out.textContent = 'EV100 ' + E.luxToEV100(x).toFixed(2) + ' · 换到 2 米处约 ' +
          Math.round(at2) + ' lux（EV100 ' + E.luxToEV100(at2).toFixed(2) + '）';
      }
      preview();

      var actions = [{ label: '取消', value: null, kind: 'ghost' }];
      if (!isNew) { actions.unshift({ label: '删除', value: 'del', kind: 'danger' }); }
      actions.push({ label: isNew ? '添加' : '保存', value: 'save', kind: 'primary' });

      A.sheet({
        title: isNew ? '加一支灯' : '灯具',
        sub: '填在某个距离上的照度，时间轴会标出环境光衰减到和它相等的那一分钟。',
        dismissValue: null,
        body: A.h('div', null, [
          field('名称', nameIn),
          A.h('div', { class: 'row' }, [field('照度（lux）', lux.node), field('测量距离（米）', dist.node)]),
          out
        ]),
        actions: actions
      }).then(function (v) {
        if (v === 'del') {
          return A.confirm('删除「' + L.name + '」？', '这支灯会从列表里去掉。', '删除', 'danger')
            .then(function (ok) {
              if (!ok) { return; }
              s.lights.splice(i, 1);
              save();
            });
        }
        if (v !== 'save') { return; }
        var name = nameIn.value.trim();
        if (!name) { A.toast('没填名称'); return; }
        var x = lux.value(), d = dist.value();
        var entry = { name: name, lux: x > 0 ? x : null, distance: d > 0 ? d : 1 };
        if (isNew) { s.lights.push(entry); } else { s.lights[i] = entry; }
        save();
      });
    }

    return function () { disposed = true; };
  }

  return { render: render };
});
