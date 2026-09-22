/*!
 * 蓝调勘景仪 Blue Hour Scout — js/ui/scout.js
 *
 * 功能一：勘景记录。
 *
 * 导航结构是**分步**的，不是一张长表单：
 *
 *   列表  →  概览（四行，每行显示完成状态）
 *              ├─ 第 1 步 地点与坐标
 *              ├─ 第 2 步 机位朝向
 *              ├─ 第 3 步 地平线剖面
 *              └─ 第 4 步 照片与备注
 *
 * 新建时直接进第 1 步，一路「下一步」走完；老记录可以从概览跳进任意一步。
 * 每一步只做一件事（相关的两件事才合并，比如名称和坐标、照片和备注）。
 * 字段改动即时存盘——现场用的东西，不该因为忘点保存而丢数据。
 */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  root.BH = root.BH || {};
  root.BH.Scout = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var A = null, R = null, H = null, C = null, Z = null, HU = null;
  function deps() {
    A = A || root.BH.App; R = R || root.BH.Records; H = H || root.BH.Horizon;
    C = C || root.BH.Compass; Z = Z || root.BH.Tz; HU = HU || root.BH.HorizonUI;
  }

  var SAVE_DEBOUNCE = 600;
  var SAVE_MAX_WAIT = 2500;   // 连续输入时也要按时存，别被防抖无限推迟

  // ---------------------------------------------------------------- 步骤表

  var STEPS = [
    {
      key: 'place', title: '地点与坐标', required: true,
      lead: '先给这个机位起个名字，再记下坐标。坐标是后面算日落时刻的基础。',
      done: function (rec) { return rec.lat !== null && rec.lon !== null; },
      summary: function (rec) {
        if (rec.lat === null || rec.lon === null) { return '还没有坐标'; }
        return (rec.name ? rec.name + ' · ' : '') +
               rec.lat.toFixed(4) + ', ' + rec.lon.toFixed(4);
      }
    },
    {
      key: 'heading', title: '机位朝向', required: false,
      lead: '机器打算朝哪个方向拍。用罗盘读一下，或者直接填方位角。',
      done: function (rec) { return rec.heading !== null; },
      summary: function (rec) {
        if (rec.heading === null) { return '还没记（可以先跳过）'; }
        return Math.round(rec.heading) + '° ' + A.compassName(rec.heading) +
               (rec.headingSource === 'compass' ? ' · 来自罗盘' : ' · 手动');
      }
    },
    {
      key: 'horizon', title: '地平线剖面', required: true,
      lead: '开相机把准星对准天际线，原地转一圈记下四周的仰角。这一步决定真正的日落时刻。',
      done: function (rec) { return H.count(rec.horizon) > 0; },
      summary: function (rec) {
        var n = H.count(rec.horizon);
        if (n === 0) { return '还没采集'; }
        if (n < H.SECTORS) { return '已采 ' + n + '/36，还有缺口'; }
        var st = H.stats(rec.horizon);
        return '36/36 已采齐 · 最高 ' + A.deg(st.max);
      }
    },
    {
      key: 'notes', title: '照片与备注', required: false,
      lead: '拍一张参考照片，写下停车、门禁、潮汐之类回头会忘的事。',
      done: function (rec) { return !!rec.hasPhoto || !!(rec.notes && rec.notes.trim()); },
      summary: function (rec) {
        var bits = [];
        if (rec.hasPhoto) { bits.push('有照片'); }
        if (rec.notes && rec.notes.trim()) { bits.push(rec.notes.trim().replace(/\s+/g, ' ')); }
        return bits.length ? bits.join(' · ') : '可选';
      }
    }
  ];

  function stepIndex(key) {
    for (var i = 0; i < STEPS.length; i++) { if (STEPS[i].key === key) { return i; } }
    return -1;
  }

  function stepHash(id, i) {
    if (i < 0 || i >= STEPS.length) { return '/rec/' + id; }
    var k = STEPS[i].key;
    return k === 'horizon' ? '/rec/' + id + '/horizon' : '/rec/' + id + '/s/' + k;
  }

  /** 第一个还没完成的必填步骤；都完成了返回 −1。 */
  function firstTodo(rec) {
    for (var i = 0; i < STEPS.length; i++) {
      if (STEPS[i].required && !STEPS[i].done(rec)) { return i; }
    }
    for (var j = 0; j < STEPS.length; j++) {
      if (!STEPS[j].done(rec)) { return j; }
    }
    return -1;
  }

  // ------------------------------------------------------------ 定位

  function getPosition() {
    return new Promise(function (resolve, reject) {
      if (!navigator.geolocation) {
        reject(new Error('这台设备不支持定位'));
        return;
      }
      if (!root.isSecureContext) {
        reject(new Error('定位需要 HTTPS。iOS 上 localhost 也不算安全上下文。'));
        return;
      }
      navigator.geolocation.getCurrentPosition(resolve, function (err) {
        var msg = '定位失败';
        if (err.code === 1) {
          msg = '定位权限被拒绝。可以在「设置 → Safari → 位置」里重新允许，或者手动填坐标。';
        } else if (err.code === 2) {
          msg = '拿不到位置。室内或地下信号差时常见，到开阔处再试，或者手动填坐标。';
        } else if (err.code === 3) {
          msg = '定位超时。再试一次，或者手动填坐标。';
        }
        reject(new Error(msg));
      }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
    });
  }

  // ------------------------------------------------------------ 时区候选

  function zoneOptions(current) {
    var list = [];
    try {
      if (Intl.supportedValuesOf) { list = Intl.supportedValuesOf('timeZone'); }
    } catch (e) { list = []; }
    if (!list.length) {
      list = ['Australia/Sydney', 'Australia/Melbourne', 'Australia/Brisbane',
              'Australia/Perth', 'Australia/Adelaide', 'Australia/Darwin',
              'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Tokyo',
              'Pacific/Auckland', 'Europe/London', 'America/Los_Angeles',
              'America/New_York', 'UTC'];
    }
    var pinned = [];
    var dev = Z.deviceZone();
    [current, dev, 'Australia/Sydney'].forEach(function (z) {
      if (z && Z.isValidZone(z) && pinned.indexOf(z) < 0) { pinned.push(z); }
    });
    var rest = list.filter(function (z) { return pinned.indexOf(z) < 0; });
    return pinned.concat(rest);
  }

  // ------------------------------------------------------------ 列表页

  function renderList(params, view) {
    deps();
    A.setTop({
      title: '勘景记录',
      actions: [
        A.h('button', {
          class: 'btn sm ghost', type: 'button',
          on: { click: function () { A.go('/settings'); } }
        }, '设置'),
        A.h('button', {
          class: 'btn sm ghost', type: 'button',
          on: { click: showDataSheet }
        }, '数据')
      ]
    });
    A.setDock([
      A.h('button', {
        class: 'btn primary block', type: 'button',
        on: { click: createNew }
      }, '＋ 新建勘景记录')
    ]);

    var listBox = A.h('div');
    view.appendChild(listBox);

    R.list().then(function (rows) {
      A.clear(listBox);
      if (!rows.length) {
        listBox.appendChild(A.h('div', { class: 'empty' }, [
          A.h('div', { class: 'big', text: '☾' }),
          A.h('p', { html: '还没有勘景记录。<br>到现场新建一条，四步走完：坐标、朝向、天际线剖面、照片备注。' })
        ]));
        return;
      }
      var ul = A.h('ul', { class: 'list' });
      rows.forEach(function (raw) {
        var rec = R.normalize(raw);
        var n = H.count(rec.horizon);
        var badge = n === H.SECTORS
          ? A.h('span', { class: 'badge ok', text: '剖面 36/36' })
          : n > 0
            ? A.h('span', { class: 'badge warn', text: '剖面 ' + n + '/36' })
            : A.h('span', { class: 'badge mute', text: '无剖面' });

        var coords = (rec.lat !== null && rec.lon !== null)
          ? rec.lat.toFixed(5) + ', ' + rec.lon.toFixed(5)
          : '未记录坐标';
        var heading = rec.heading !== null
          ? '朝向 ' + Math.round(rec.heading) + '° ' + A.compassName(rec.heading)
          : '未记朝向';

        ul.appendChild(A.h('li', null,
          A.h('button', {
            class: 'item', type: 'button',
            on: { click: function () { A.go('/rec/' + rec.id); } }
          }, [
            A.h('div', { class: 't' }, [
              A.h('span', { class: 'name', text: rec.name || '未命名地点' }),
              badge
            ]),
            A.h('div', { class: 'd', text: coords + ' · ' + heading }),
            A.h('div', { class: 'd', text: (rec.hasPhoto ? '有照片 · ' : '') + A.relTime(rec.updatedAt) })
          ])
        ));
      });
      listBox.appendChild(A.h('div', { class: 'card tight' }, ul));
    }).catch(function (e) {
      A.clear(listBox);
      listBox.appendChild(A.h('div', { class: 'note bad', text: '读取记录失败：' + e.message }));
    });

    function createNew() {
      var rec = R.create();
      R.save(rec).then(function () {
        // 新建直接进第一步，不要先扔一张空表单给人看
        A.go(stepHash(rec.id, 0));
      }).catch(function (e) { A.toast('新建失败：' + e.message, 4000); });
    }

    function showDataSheet() {
      var fileInput = A.h('input', { type: 'file', accept: '.json,application/json', style: 'display:none' });
      fileInput.addEventListener('change', function () {
        var f = fileInput.files && fileInput.files[0];
        if (!f) { return; }
        var reader = new FileReader();
        reader.onload = function () { doImport(String(reader.result)); };
        reader.onerror = function () { A.toast('读取文件失败', 3500); };
        reader.readAsText(f);
      });
      document.body.appendChild(fileInput);

      // 缓存陈旧最麻烦的地方是它不可见。把版本号摆出来，再给一个手动检查的入口。
      var verLine = A.h('div', { class: 'hint', text: '版本：读取中…' });
      var updBtn = A.h('button', {
        class: 'btn sm ghost', type: 'button', style: 'margin-top:10px',
        on: { click: checkUpdate }
      }, '检查更新');

      function showVersion() {
        if (!root.caches || !caches.keys) { verLine.textContent = '版本：无缓存信息'; return; }
        caches.keys().then(function (keys) {
          var mine = keys.filter(function (k) { return k.indexOf('bluehour-') === 0; });
          verLine.textContent = mine.length
            ? '版本：' + mine.join('、') + (navigator.serviceWorker && navigator.serviceWorker.controller
                ? '（离线缓存已就绪）' : '（离线缓存未接管）')
            : '版本：尚未建立离线缓存';
        }).catch(function () { verLine.textContent = '版本：读取失败'; });
      }

      function checkUpdate() {
        if (!navigator.serviceWorker || !navigator.serviceWorker.getRegistration) {
          A.toast('这个浏览器不支持离线缓存', 3500);
          return;
        }
        updBtn.disabled = true;
        updBtn.textContent = '检查中…';
        navigator.serviceWorker.getRegistration().then(function (reg) {
          if (!reg) { A.toast('还没注册离线缓存', 3500); return null; }
          return reg.update().then(function () {
            if (reg.waiting || reg.installing) {
              A.toast('发现新版本，页面底部会提示刷新', 4000);
            } else {
              A.toast('已是最新版本', 2600);
            }
          });
        }).catch(function () {
          A.toast('检查失败，可能是离线状态', 3500);
        }).then(function () {
          updBtn.disabled = false;
          updBtn.textContent = '检查更新';
          showVersion();
        });
      }

      showVersion();

      A.sheet({
        title: '数据',
        sub: '导出是纯 JSON，可以存到文件 App 或发给自己。照片是二进制，不在 JSON 里。',
        dismissValue: null,
        body: A.h('div', null, [verLine, updBtn]),
        actions: [
          { label: '导入 JSON', value: 'in', kind: 'ghost' },
          { label: '导出 JSON', value: 'out', kind: 'primary' }
        ]
      }).then(function (v) {
        if (v === 'out') { doExport(); }
        else if (v === 'in') { fileInput.click(); return; }
        setTimeout(function () {
          if (fileInput.parentNode && v !== 'in') { fileInput.parentNode.removeChild(fileInput); }
        }, 500);
      });
    }

    function doExport() {
      R.list().then(function (rows) {
        if (!rows.length) { A.toast('还没有记录可以导出'); return; }
        var t = new Date();
        var name = '蓝调勘景-' + t.getFullYear() + A.pad2(t.getMonth() + 1) + A.pad2(t.getDate()) +
                   '-' + A.pad2(t.getHours()) + A.pad2(t.getMinutes()) + '.json';
        A.download(name, R.exportJSON(rows));
        A.toast('已导出 ' + rows.length + ' 条记录');
      });
    }

    function doImport(text) {
      var parsed = R.parseImport(text);
      if (parsed.errors.length && !parsed.records.length) {
        A.toast(parsed.errors[0], 4500);
        return;
      }
      A.confirm('导入 ' + parsed.records.length + ' 条记录？',
        'id 相同的记录会被覆盖。照片不在 JSON 里，不会被导入。', '导入', 'primary')
        .then(function (ok) {
          if (!ok) { return; }
          R.importRecords(parsed.records).then(function (res) {
            A.toast('新增 ' + res.added + ' 条，覆盖 ' + res.replaced + ' 条', 3500);
            A.go('/', true);
            setTimeout(function () {
              window.dispatchEvent(new HashChangeEvent('hashchange'));
            }, 10);
          }).catch(function (e) { A.toast('导入失败：' + e.message, 4000); });
        });
    }
  }

  // -------------------------------------------------- 载入记录的公共骨架

  /**
   * 载入记录并交给 builder 渲染。返回统一的清理函数。
   * builder(ctx) 里的 ctx 提供 rec / scheduleSave / flushSave / onDispose。
   */
  function withRecord(id, view, builder) {
    deps();
    var rec = null, saveTimer = null, dirty = false, dirtySince = 0;
    var disposed = false;
    var extraCleanup = [];

    function scheduleSave() {
      if (!dirty) { dirtySince = Date.now(); }
      dirty = true;
      if (Date.now() - dirtySince >= SAVE_MAX_WAIT) { flushSave(); return; }
      if (saveTimer) { clearTimeout(saveTimer); }
      saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE);
    }

    function flushSave() {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      // 只看不改就不回写：否则 updatedAt 会被刷新、记录莫名跳到列表最前
      if (!rec || !dirty) { return Promise.resolve(); }
      dirty = false;
      dirtySince = 0;
      return R.save(rec).catch(function (e) {
        dirty = true;
        A.toast('保存失败：' + (e && e.message ? e.message : e), 4000);
      });
    }

    R.load(id).then(function (raw) {
      if (disposed) { return; }
      if (!raw) { A.toast('记录不存在'); A.go('/', true); return; }
      rec = R.normalize(raw);
      A.clear(view);
      builder({
        rec: rec,
        view: view,
        scheduleSave: scheduleSave,
        flushSave: flushSave,
        onDispose: function (fn) { extraCleanup.push(fn); },
        isDisposed: function () { return disposed; }
      });
    }).catch(function (e) {
      A.clear(view);
      view.appendChild(A.h('div', { class: 'note bad', text: '读取失败：' + e.message }));
    });

    return function () {
      disposed = true;
      extraCleanup.forEach(function (fn) {
        try { fn(); } catch (e) { /* 清理失败不该阻塞导航 */ }
      });
      C.stop();
      flushSave();
    };
  }

  // ------------------------------------------------------------ 概览页

  function renderOverview(params, view) {
    deps();
    A.setTop({ title: '载入中…', back: true });
    view.appendChild(A.h('div', { class: 'hint', text: '载入中…' }));

    return withRecord(params.id, view, function (ctx) {
      var rec = ctx.rec;

      A.setTop({
        title: rec.name || '未命名地点',
        back: function () { ctx.flushSave().then(function () { A.go('/'); }); }
      });

      var todo = STEPS.filter(function (s) { return s.required && !s.done(rec); });
      var next = firstTodo(rec);

      // 顶部状态：还差什么，一句话说清
      view.appendChild(A.h('div', { class: 'ready ' + (todo.length ? 'todo' : 'ok') }, [
        A.h('div', { class: 'big', text: todo.length ? String(todo.length) : '✓' }),
        A.h('div', { class: 'txt' }, todo.length
          ? [A.h('b', { text: '还差 ' + todo.length + ' 项' }),
             '缺 ' + todo.map(function (s) { return s.title; }).join('、') + '，补齐后才能算光线时间轴。']
          : [A.h('b', { text: '这条记录已经够用了' }),
             '坐标和天际线剖面都有了，可以拿来算日落和蓝调窗口。'])
      ]));

      // 四步一览
      var list = A.h('div', { class: 'nav-list' });
      STEPS.forEach(function (s, i) {
        var done = s.done(rec);
        list.appendChild(A.h('button', {
          class: 'nav-row' + (done ? ' done' : ''), type: 'button',
          on: { click: function () { ctx.flushSave().then(function () { A.go(stepHash(rec.id, i)); }); } }
        }, [
          A.h('span', { class: 'num', text: done ? '✓' : String(i + 1) }),
          A.h('span', { class: 'body' }, [
            A.h('span', { class: 't', text: s.title }),
            A.h('span', { class: 's', text: s.summary(rec) })
          ]),
          A.h('span', { class: 'chev', text: '›' })
        ]));
      });
      view.appendChild(list);

      // 危险操作放在最底下，远离误触区（原来挂在右上角，和返回箭头一样显眼）
      view.appendChild(A.h('div', { class: 'danger-zone' }, [
        A.h('button', {
          class: 'btn ghost block', type: 'button',
          on: {
            click: function () {
              A.confirm('删除「' + (rec.name || '未命名地点') + '」？',
                '记录和照片都会被删掉，撤销不了。', '删除', 'danger')
                .then(function (ok) {
                  if (!ok) { return; }
                  R.remove(rec.id).then(function () {
                    A.toast('已删除');
                    A.go('/', true);
                  }).catch(function (e) { A.toast('删除失败：' + e.message, 4000); });
                });
            }
          }
        }, '删除这条记录')
      ]));

      // 必填项齐了之后，主按钮就该是"拿去算光线"而不是"返回列表"
      var canTimeline = rec.lat !== null && rec.lon !== null;
      A.setDock([
        todo.length
          ? A.h('button', {
              class: 'btn primary block', type: 'button',
              on: { click: function () { ctx.flushSave().then(function () { A.go(stepHash(rec.id, next)); }); } }
            }, '继续：' + STEPS[next].title + ' →')
          : A.h('button', {
              class: 'btn primary block', type: 'button',
              on: { click: function () { ctx.flushSave().then(function () { A.go('/rec/' + rec.id + '/timeline'); }); } }
            }, '光线时间轴 →')
      ]);

      // 只要有坐标就能算（没剖面时只是给不出真实日落），单独给个入口
      if (canTimeline && todo.length) {
        view.insertBefore(A.h('button', {
          class: 'btn block', type: 'button', style: 'margin-bottom:14px',
          on: { click: function () { ctx.flushSave().then(function () { A.go('/rec/' + rec.id + '/timeline'); }); } }
        }, '先看光线时间轴 →'), view.querySelector('.danger-zone'));
      }
    });
  }

  // ------------------------------------------------------------ 分步页

  /** 步骤进度条 + 「第 N 步 / 共 4 步」 + 一句引导。 */
  function stepHeader(i) {
    var dots = A.h('div', { class: 'steps' });
    for (var k = 0; k < STEPS.length; k++) {
      dots.appendChild(A.h('i', { class: k === i ? 'cur' : (k < i ? 'done' : '') }));
    }
    return [
      dots,
      A.h('p', { class: 'step-cap', text: '第 ' + (i + 1) + ' 步 / 共 ' + STEPS.length + ' 步' }),
      A.h('p', { class: 'step-lead', html: STEPS[i].lead })
    ];
  }

  /** 底部导航：上一步 / 下一步（最后一步是「完成」）。 */
  function stepDock(rec, i, flushSave) {
    var btns = [];
    if (i > 0) {
      btns.push(A.h('button', {
        class: 'btn ghost', type: 'button', style: 'flex:0 0 38%',
        on: { click: function () { flushSave().then(function () { A.go(stepHash(rec.id, i - 1)); }); } }
      }, '← 上一步'));
    } else {
      btns.push(A.h('button', {
        class: 'btn ghost', type: 'button', style: 'flex:0 0 38%',
        on: { click: function () { flushSave().then(function () { A.go('/rec/' + rec.id); }); } }
      }, '概览'));
    }
    var last = i === STEPS.length - 1;
    btns.push(A.h('button', {
      class: 'btn primary', type: 'button',
      on: {
        click: function () {
          flushSave().then(function () {
            A.go(last ? '/rec/' + rec.id : stepHash(rec.id, i + 1));
          });
        }
      }
    }, last ? '完成 ✓' : '下一步 →'));
    return btns;
  }

  function renderStep(params, view) {
    deps();
    var i = stepIndex(params.step);
    if (i < 0) { A.go('/rec/' + params.id, true); return; }

    A.setTop({ title: STEPS[i].title, back: true });
    view.appendChild(A.h('div', { class: 'hint', text: '载入中…' }));

    return withRecord(params.id, view, function (ctx) {
      var rec = ctx.rec;
      A.setTop({
        title: STEPS[i].title,
        sub: rec.name || undefined,
        back: function () { ctx.flushSave().then(function () { A.go('/rec/' + rec.id); }); }
      });
      A.append(view, stepHeader(i));

      if (STEPS[i].key === 'place') { buildPlace(ctx); }
      else if (STEPS[i].key === 'heading') { buildHeading(ctx); }
      else if (STEPS[i].key === 'notes') { buildNotes(ctx); }

      A.setDock(stepDock(rec, i, ctx.flushSave));
    });
  }

  // ------------------------------------------------- 第 1 步：地点与坐标

  function buildPlace(ctx) {
    var rec = ctx.rec, view = ctx.view;

    var nameInput = A.h('input', {
      type: 'text', value: rec.name, maxlength: 120,
      placeholder: '例如：巴朗加鲁北端草坡'
    });
    nameInput.addEventListener('input', function () {
      rec.name = nameInput.value;
      ctx.scheduleSave();
    });

    var latIn = A.h('input', {
      type: 'number', step: 'any', inputmode: 'decimal', placeholder: '纬度',
      value: rec.lat === null ? '' : rec.lat
    });
    var lonIn = A.h('input', {
      type: 'number', step: 'any', inputmode: 'decimal', placeholder: '经度',
      value: rec.lon === null ? '' : rec.lon
    });
    var meta = A.h('div', { class: 'hint' });

    function syncMeta() {
      if (rec.lat === null || rec.lon === null) {
        meta.textContent = '还没有坐标。南纬填负数、西经填负数。';
        return;
      }
      meta.textContent = rec.gpsSource === 'device'
        ? '一键获取' + (rec.gpsAccuracy !== null ? '，精度 ±' + Math.round(rec.gpsAccuracy) + ' m' : '')
        : '手动输入';
    }

    function onManual() {
      var la = parseFloat(latIn.value), lo = parseFloat(lonIn.value);
      rec.lat = isFinite(la) && la >= -90 && la <= 90 ? la : null;
      rec.lon = isFinite(lo) && lo >= -180 && lo <= 180 ? lo : null;
      rec.gpsSource = (rec.lat !== null || rec.lon !== null) ? 'manual' : null;
      rec.gpsAccuracy = null;
      syncMeta();
      ctx.scheduleSave();
    }
    latIn.addEventListener('input', onManual);
    lonIn.addEventListener('input', onManual);

    // 主操作放在手动输入框**上面**：现场九成是点这个按钮，不是手打经纬度
    var grabBtn = A.h('button', { class: 'btn primary block', type: 'button' }, '📍 一键获取当前位置');
    grabBtn.addEventListener('click', function () {
      grabBtn.disabled = true;
      grabBtn.textContent = '定位中…';
      getPosition().then(function (pos) {
        rec.lat = pos.coords.latitude;
        rec.lon = pos.coords.longitude;
        rec.gpsAccuracy = pos.coords.accuracy;
        rec.gpsSource = 'device';
        latIn.value = rec.lat.toFixed(6);
        lonIn.value = rec.lon.toFixed(6);
        syncMeta();
        ctx.scheduleSave();
        A.toast('已获取位置，精度 ±' + Math.round(pos.coords.accuracy) + ' m');
      }).catch(function (e) {
        A.toast(e.message, 5000);
      }).then(function () {
        grabBtn.disabled = false;
        grabBtn.textContent = '📍 一键获取当前位置';
      });
    });

    var tzSel = A.h('select');
    zoneOptions(rec.tz).forEach(function (z) {
      tzSel.appendChild(A.h('option', { value: z }, z));
    });
    tzSel.value = rec.tz;
    var tzHint = A.h('div', { class: 'hint' });
    function tzLabel() {
      try {
        return '当前 ' + Z.offsetLabel(Date.now(), rec.tz) +
               '，该时区现在是 ' + Z.formatTime(Date.now(), rec.tz) + '。';
      } catch (e) { return ''; }
    }
    tzHint.textContent = tzLabel();
    tzSel.addEventListener('change', function () {
      rec.tz = tzSel.value;
      tzHint.textContent = tzLabel();
      ctx.scheduleSave();
    });

    syncMeta();

    view.appendChild(A.h('div', { class: 'card' }, [
      A.h('div', { class: 'field' }, [A.h('label', { text: '地点名称' }), nameInput])
    ]));

    view.appendChild(A.h('div', { class: 'card' }, [
      grabBtn,
      meta,
      A.h('div', { class: 'row', style: 'margin-top:16px' }, [
        A.h('div', { class: 'field' }, [A.h('label', { text: '纬度' }), latIn]),
        A.h('div', { class: 'field' }, [A.h('label', { text: '经度' }), lonIn])
      ])
    ]));

    // 时区默认折叠：九成九就是设备时区，不该占主流程的版面
    view.appendChild(A.h('details', { class: 'fold' }, [
      A.h('summary', null, '时区 · ' + rec.tz),
      A.h('div', { class: 'fold-body' }, [
        A.h('div', { class: 'field', style: 'margin-top:14px' }, [tzSel]),
        tzHint,
        A.h('div', { class: 'hint' },
          '默认跟设备走。人在国外规划悉尼的拍摄时，把这里改成 Australia/Sydney。')
      ])
    ]));
  }

  // --------------------------------------------------- 第 2 步：机位朝向

  function buildHeading(ctx) {
    var rec = ctx.rec, view = ctx.view;

    var bigN = A.h('span', {
      class: 'n' + (rec.heading === null ? ' dim' : ''),
      text: rec.heading === null ? '—' : String(Math.round(rec.heading))
    });
    var bigU = A.h('span', {
      class: 'u', text: rec.heading === null ? '' : '° ' + A.compassName(rec.heading)
    });

    var headIn = A.h('input', {
      type: 'number', step: 'any', inputmode: 'decimal', min: 0, max: 360,
      placeholder: '0–360，真北起算顺时针',
      value: rec.heading === null ? '' : rec.heading
    });

    // 光一个巨大的破折号看着像渲染残留，得有一句话说明它是什么
    var capEl = A.h('div', { class: 'hint', style: 'margin-top:2px' });

    function syncBig() {
      bigN.textContent = rec.heading === null ? '—' : String(Math.round(rec.heading));
      bigN.className = 'n' + (rec.heading === null ? ' dim' : '');
      bigU.textContent = rec.heading === null ? '' : '° ' + A.compassName(rec.heading);
      capEl.textContent = rec.heading === null
        ? '还没记录朝向'
        : (rec.headingSource === 'compass' ? '来自罗盘读数' : '手动填写');
    }

    headIn.addEventListener('input', function () {
      var v = parseFloat(headIn.value);
      rec.heading = isFinite(v) ? H.norm360(v) : null;
      rec.headingSource = rec.heading === null ? null : 'manual';
      syncBig();
      ctx.scheduleSave();
    });

    var offIn = A.h('input', {
      type: 'number', step: 'any', inputmode: 'decimal', value: rec.headingOffset || 0
    });
    offIn.addEventListener('input', function () {
      var v = parseFloat(offIn.value);
      rec.headingOffset = isFinite(v) ? v : 0;
      ctx.scheduleSave();
    });

    syncBig();

    view.appendChild(A.h('div', { class: 'card' }, [
      A.h('div', { class: 'readout' }, [bigN, bigU]),
      capEl,
      A.h('button', {
        class: 'btn primary block', type: 'button', style: 'margin-top:14px',
        on: { click: readCompass }
      }, '🧭 读取罗盘'),
      A.h('div', { class: 'field', style: 'margin-top:18px' }, [
        A.h('label', null, ['或手动填方位角 ', A.h('span', { class: 'unit', text: '（度，真北起算）' })]),
        headIn
      ])
    ]));

    // 排错用的选项折叠起来，别横在主流程中间
    view.appendChild(A.h('details', { class: 'fold' }, [
      A.h('summary', null, '罗盘校正' + (rec.headingOffset ? '：' + rec.headingOffset + '°' : '（通常不用动）')),
      A.h('div', { class: 'fold-body' }, [
        A.h('div', { class: 'field', style: 'margin-top:14px' }, [
          A.h('label', null, ['偏移量 ', A.h('span', { class: 'unit', text: '（度，加到罗盘读数上）' })]),
          offIn
        ]),
        A.h('div', { class: 'hint' },
          'iOS 的 webkitCompassHeading 给的是真北，通常填 0。' +
          '安卓等平台拿到的多半是磁北，悉尼磁偏角约 +12.7°E。' +
          '也可以对着已知方向的建筑物标定一下再填差值。')
      ])
    ]));

    function readCompass() {
      // requestPermission 必须在这个点击回调里同步调用
      C.request().then(function (st) {
        if (st !== 'granted') { A.toast(C.explain(st), 5000); return; }
        liveHeadingSheet();
      });
    }

    function liveHeadingSheet() {
      var n = A.h('span', { class: 'n dim', text: '—' });
      var u = A.h('span', { class: 'u', text: '' });
      var current = null;

      C.start(function (r) {
        if (r.heading === null) { return; }
        current = H.norm360(r.heading + (rec.headingOffset || 0));
        n.textContent = String(Math.round(current));
        n.className = 'n';
        u.textContent = '° ' + A.compassName(current) +
          (r.accuracy !== null && r.accuracy !== undefined ? '  ±' + Math.round(r.accuracy) + '°' : '');
      });

      A.sheet({
        title: '读取罗盘',
        sub: '把手机背面对准机位要拍的方向，读数稳定后点「用这个值」。',
        dismissValue: null,
        body: A.h('div', null, [
          A.h('div', { class: 'readout' }, [n, u]),
          A.h('p', { class: 'hint', text: '读数已经加上了「罗盘校正」里填的偏移量。' })
        ]),
        actions: [
          { label: '取消', value: null, kind: 'ghost' },
          { label: '用这个值', value: 'use', kind: 'primary' }
        ]
      }).then(function (v) {
        C.stop();
        if (v !== 'use' || current === null) { return; }
        rec.heading = current;
        rec.headingSource = 'compass';
        headIn.value = Math.round(current * 10) / 10;
        syncBig();
        ctx.scheduleSave();
        A.toast('机位朝向记为 ' + Math.round(current) + '°');
      });
    }
  }

  // ------------------------------------------------- 第 4 步：照片与备注

  function buildNotes(ctx) {
    var rec = ctx.rec, view = ctx.view;
    var photoURL = null;

    var holder = A.h('div', { class: 'photo' });
    var fileIn = A.h('input', {
      type: 'file', accept: 'image/*', capture: 'environment', class: 'file-input',
      'aria-label': '拍摄或选择参考照片'
    });
    var delBtn = A.h('button', {
      class: 'btn sm danger', type: 'button', style: 'margin-top:10px;display:none'
    }, '删除照片');

    function showEmpty() {
      A.clear(holder);
      holder.appendChild(A.h('div', { class: 'photo-empty' }, [
        A.h('div', { style: 'font-size:28px;opacity:.45', text: '📷' }),
        A.h('div', { text: '点这里拍一张参考照片' })
      ]));
      holder.appendChild(fileIn);
      delBtn.style.display = 'none';      // 没照片就别摆一个删除按钮在那儿
    }

    function showPhoto(blob) {
      if (photoURL) { URL.revokeObjectURL(photoURL); }
      photoURL = URL.createObjectURL(blob);
      A.clear(holder);
      holder.appendChild(A.h('img', { src: photoURL, alt: '参考照片' }));
      holder.appendChild(fileIn);
      delBtn.style.display = '';
    }

    fileIn.addEventListener('change', function () {
      var f = fileIn.files && fileIn.files[0];
      if (!f) { return; }
      R.setPhoto(rec.id, f).then(function () {
        rec.hasPhoto = true;
        ctx.scheduleSave();
        showPhoto(f);
        A.toast('照片已保存（' + Math.round(f.size / 1024) + ' KB）');
      }).catch(function (e) { A.toast('保存照片失败：' + e.message, 4000); });
    });

    delBtn.addEventListener('click', function () {
      A.confirm('删除照片？', '只删这张参考照片，记录本身保留。', '删除', 'danger')
        .then(function (ok) {
          if (!ok) { return; }
          R.removePhoto(rec.id).then(function () {
            rec.hasPhoto = false;
            if (photoURL) { URL.revokeObjectURL(photoURL); photoURL = null; }
            showEmpty();
            ctx.scheduleSave();
            A.toast('照片已删除');
          });
        });
    });

    showEmpty();
    if (rec.hasPhoto) {
      R.getPhoto(rec.id).then(function (b) {
        if (ctx.isDisposed()) { return; }
        if (b) { showPhoto(b); }
        else { rec.hasPhoto = false; ctx.scheduleSave(); }
      });
    }
    ctx.onDispose(function () {
      if (photoURL) { URL.revokeObjectURL(photoURL); photoURL = null; }
    });

    var notes = A.h('textarea', {
      placeholder: '机位、构图、停车、门禁、潮汐、注意事项…', maxlength: 4000
    });
    notes.value = rec.notes;
    notes.addEventListener('input', function () { rec.notes = notes.value; ctx.scheduleSave(); });

    view.appendChild(A.h('div', { class: 'card' }, [holder, delBtn]));
    view.appendChild(A.h('div', { class: 'card' }, [
      A.h('div', { class: 'field' }, [A.h('label', { text: '备注' }), notes])
    ]));
    view.appendChild(A.h('p', { class: 'hint', text: '照片存在本机，导出 JSON 时不会包含。' }));
  }

  // ------------------------------------------------- 第 3 步：地平线剖面

  function renderHorizon(params, view) {
    deps();
    var i = stepIndex('horizon');
    A.setTop({ title: '地平线剖面', back: true });
    view.appendChild(A.h('div', { class: 'hint', text: '载入中…' }));

    return withRecord(params.id, view, function (ctx) {
      var rec = ctx.rec;
      A.setTop({
        title: '地平线剖面',
        sub: rec.name || undefined,
        back: function () { ctx.flushSave().then(function () { A.go('/rec/' + rec.id); }); }
      });
      A.append(view, stepHeader(i));
      var cleanup = HU.render(rec, view, {
        dock: stepDock(rec, i, function () { return Promise.resolve(); })
      });
      ctx.onDispose(cleanup);
    });
  }

  return {
    renderList: renderList,
    renderOverview: renderOverview,
    renderStep: renderStep,
    renderHorizon: renderHorizon,
    getPosition: getPosition,
    zoneOptions: zoneOptions,
    STEPS: STEPS
  };
});
