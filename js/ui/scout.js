/*!
 * 蓝调勘景仪 Blue Hour Scout — js/ui/scout.js
 *
 * 功能一：勘景记录。列表、编辑、删除、导出/导入 JSON。
 * 字段改动即时存盘（现场用的东西，不该因为忘点保存而丢数据）。
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
          A.h('p', { html: '还没有勘景记录。<br>到现场新建一条，记下坐标、机位朝向和天际线剖面。' })
        ]));
        return;
      }
      var ul = A.h('ul', { class: 'list' });
      rows.forEach(function (rec) {
        var rd = R.readiness(rec);
        var badge = rd.horizonComplete
          ? A.h('span', { class: 'badge ok', text: '剖面 36/36' })
          : rd.horizonCount > 0
            ? A.h('span', { class: 'badge warn', text: '剖面 ' + rd.horizonCount + '/36' })
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
      var rec = R.create({ name: '' });
      R.save(rec).then(function () { A.go('/rec/' + rec.id); })
        .catch(function (e) { A.toast('新建失败：' + e.message, 4000); });
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

      A.sheet({
        title: '数据',
        sub: '导出是纯 JSON，可以直接存到文件 App 或发给自己。照片是二进制，不在 JSON 里。',
        dismissValue: null,
        body: A.h('div'),
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
        var stamp = new Date();
        var name = '蓝调勘景-' + stamp.getFullYear() + A.pad2(stamp.getMonth() + 1) +
                   A.pad2(stamp.getDate()) + '-' + A.pad2(stamp.getHours()) + A.pad2(stamp.getMinutes()) + '.json';
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
            dispatchReload();
          }).catch(function (e) { A.toast('导入失败：' + e.message, 4000); });
        });
    }

    function dispatchReload() {
      A.go('/', true);
      setTimeout(function () { window.dispatchEvent(new HashChangeEvent('hashchange')); }, 10);
    }
  }

  // ------------------------------------------------------------ 编辑页

  function renderDetail(params, view) {
    deps();
    var rec = null;
    var saveTimer = null;
    var photoURL = null;
    var disposed = false;
    var dirty = false;      // 只看不改就不该回写：否则 updatedAt 会被刷新、记录跳到列表最前
    var dirtySince = 0;

    var box = A.h('div');
    view.appendChild(box);

    A.setTop({ title: '载入中…', back: true });

    R.load(params.id).then(function (r) {
      if (disposed) { return; }
      if (!r) { A.toast('记录不存在'); A.go('/', true); return; }
      rec = R.normalize(r);
      build();
    }).catch(function (e) {
      box.appendChild(A.h('div', { class: 'note bad', text: '读取失败：' + e.message }));
    });

    function scheduleSave() {
      if (!dirty) { dirtySince = Date.now(); }
      dirty = true;
      if (Date.now() - dirtySince >= SAVE_MAX_WAIT) { flushSave(); return; }
      if (saveTimer) { clearTimeout(saveTimer); }
      saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE);
    }

    function flushSave() {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      if (!rec || !dirty) { return Promise.resolve(); }
      dirty = false;
      dirtySince = 0;
      return R.save(rec).catch(function (e) {
        dirty = true;
        A.toast('保存失败：' + (e && e.message ? e.message : e), 4000);
      });
    }

    function build() {
      A.clear(box);
      A.setTop({
        title: rec.name || '未命名地点',
        back: true,
        actions: [
          A.h('button', {
            class: 'btn sm ghost', type: 'button',
            on: { click: remove }
          }, '删除')
        ]
      });
      A.setDock([
        A.h('button', {
          class: 'btn ghost', type: 'button',
          on: { click: function () { flushSave().then(function () { A.go('/'); }); } }
        }, '返回列表'),
        A.h('button', {
          class: 'btn primary', type: 'button',
          on: { click: function () { flushSave().then(function () { A.go('/rec/' + rec.id + '/horizon'); }); } }
        }, '采集地平线剖面')
      ]);

      // --- 地点
      var nameInput = A.h('input', {
        type: 'text', value: rec.name, placeholder: '例如：巴朗加鲁北端草坡',
        maxlength: 120
      });
      nameInput.addEventListener('input', function () {
        rec.name = nameInput.value;
        A.setTop({
          title: rec.name || '未命名地点', back: true,
          actions: [A.h('button', { class: 'btn sm ghost', type: 'button', on: { click: remove } }, '删除')]
        });
        scheduleSave();
      });

      box.appendChild(A.h('div', { class: 'card' }, [
        A.h('div', { class: 'field' }, [A.h('label', { text: '地点名称' }), nameInput])
      ]));

      // 某一块出错不应该让整页空掉——现场排查不了，至少让其余部分还能用
      function section(label, fn) {
        try {
          box.appendChild(fn());
        } catch (e) {
          box.appendChild(A.h('div', { class: 'note bad' }, [
            A.h('b', { text: label + ' 渲染失败：' }),
            (e && e.message) ? e.message : String(e)
          ]));
          if (root.console) { root.console.error(label, e); }
        }
      }

      section('GPS 坐标', buildGeoCard);
      section('机位朝向', buildHeadingCard);
      section('地平线剖面', buildHorizonCard);
      section('参考照片', buildPhotoCard);

      // --- 备注
      var notes = A.h('textarea', {
        placeholder: '机位、构图、停车、门禁、潮汐、注意事项…', maxlength: 4000
      });
      notes.value = rec.notes;
      notes.addEventListener('input', function () { rec.notes = notes.value; scheduleSave(); });
      box.appendChild(A.h('div', { class: 'card' }, [
        A.h('div', { class: 'field' }, [A.h('label', { text: '备注' }), notes])
      ]));

      box.appendChild(A.h('p', { class: 'hint' },
        '所有改动都会自动保存，不用手动点保存。'));
    }

    // ---------------------------------------------------------- 坐标卡片

    function buildGeoCard() {
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
        var bits = [];
        if (rec.gpsSource === 'device') {
          bits.push('一键获取' + (rec.gpsAccuracy !== null ? '，精度 ±' + Math.round(rec.gpsAccuracy) + ' m' : ''));
        } else if (rec.gpsSource === 'manual') {
          bits.push('手动输入');
        }
        if (rec.lat !== null && rec.lon !== null) {
          bits.push('南纬为负、西经为负');
        }
        meta.textContent = bits.join(' · ');
      }

      function onManual() {
        var la = parseFloat(latIn.value), lo = parseFloat(lonIn.value);
        rec.lat = isFinite(la) && la >= -90 && la <= 90 ? la : null;
        rec.lon = isFinite(lo) && lo >= -180 && lo <= 180 ? lo : null;
        rec.gpsSource = (rec.lat !== null || rec.lon !== null) ? 'manual' : null;
        rec.gpsAccuracy = null;
        syncMeta();
        scheduleSave();
      }
      latIn.addEventListener('input', onManual);
      lonIn.addEventListener('input', onManual);

      var grabBtn = A.h('button', { class: 'btn sm primary', type: 'button' }, '一键获取当前位置');
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
          scheduleSave();
          A.toast('已获取位置，精度 ±' + Math.round(pos.coords.accuracy) + ' m');
        }).catch(function (e) {
          A.toast(e.message, 5000);
        }).then(function () {
          grabBtn.disabled = false;
          grabBtn.textContent = '一键获取当前位置';
        });
      });

      var tzSel = A.h('select');
      zoneOptions(rec.tz).forEach(function (z) {
        tzSel.appendChild(A.h('option', { value: z, selected: z === rec.tz }, z));
      });
      tzSel.value = rec.tz;
      tzSel.addEventListener('change', function () {
        rec.tz = tzSel.value;
        tzHint.textContent = tzLabel();
        scheduleSave();
      });
      var tzHint = A.h('div', { class: 'hint' });
      function tzLabel() {
        try {
          return '当前 ' + Z.offsetLabel(Date.now(), rec.tz) +
                 '，本地时间 ' + Z.formatTime(Date.now(), rec.tz);
        } catch (e) { return ''; }
      }
      tzHint.textContent = tzLabel();

      syncMeta();

      return A.h('div', { class: 'card' }, [
        A.h('div', { class: 'card-head' }, [A.h('h2', { text: 'GPS 坐标' })]),
        A.h('div', { class: 'row' }, [
          A.h('div', { class: 'field' }, [A.h('label', { text: '纬度' }), latIn]),
          A.h('div', { class: 'field' }, [A.h('label', { text: '经度' }), lonIn])
        ]),
        grabBtn,
        meta,
        A.h('div', { class: 'field', style: 'margin-top:16px' }, [
          A.h('label', { text: '时区' }), tzSel, tzHint
        ])
      ]);
    }

    // ------------------------------------------------------ 机位朝向卡片

    function buildHeadingCard() {
      var readout = A.h('div', { class: 'readout' }, [
        A.h('span', { class: 'n' + (rec.heading === null ? ' dim' : ''),
                      text: rec.heading === null ? '—' : String(Math.round(rec.heading)) }),
        A.h('span', { class: 'u', text: rec.heading === null ? '' : '° ' + A.compassName(rec.heading) })
      ]);

      var headIn = A.h('input', {
        type: 'number', step: 'any', inputmode: 'decimal', min: 0, max: 360,
        placeholder: '0–360，真北起算顺时针',
        value: rec.heading === null ? '' : rec.heading
      });
      headIn.addEventListener('input', function () {
        var v = parseFloat(headIn.value);
        rec.heading = isFinite(v) ? H.norm360(v) : null;
        rec.headingSource = rec.heading === null ? null : 'manual';
        syncReadout();
        scheduleSave();
      });

      function syncReadout() {
        var n = readout.firstChild, u = readout.lastChild;
        n.textContent = rec.heading === null ? '—' : String(Math.round(rec.heading));
        n.className = 'n' + (rec.heading === null ? ' dim' : '');
        u.textContent = rec.heading === null ? '' : '° ' + A.compassName(rec.heading);
      }

      var offIn = A.h('input', {
        type: 'number', step: 'any', inputmode: 'decimal',
        value: rec.headingOffset || 0
      });
      offIn.addEventListener('input', function () {
        var v = parseFloat(offIn.value);
        rec.headingOffset = isFinite(v) ? v : 0;
        scheduleSave();
      });

      return A.h('div', { class: 'card' }, [
        A.h('div', { class: 'card-head' }, [
          A.h('h2', { text: '机位朝向' }),
          A.h('span', { class: 'meta', text: rec.headingSource === 'compass' ? '来自罗盘' : (rec.headingSource ? '手动' : '') })
        ]),
        readout,
        A.h('button', {
          class: 'btn sm primary', type: 'button', style: 'margin-top:12px',
          on: { click: readCompass }
        }, '读取罗盘'),
        A.h('div', { class: 'field', style: 'margin-top:16px' }, [
          A.h('label', null, ['方位角 ', A.h('span', { class: 'unit', text: '（度，真北起算）' })]),
          headIn
        ]),
        A.h('div', { class: 'field' }, [
          A.h('label', null, ['罗盘校正 ', A.h('span', { class: 'unit', text: '（度，加到罗盘读数上）' })]),
          offIn,
          A.h('div', { class: 'hint' },
            'iOS 的 webkitCompassHeading 给的是真北，通常填 0。' +
            '安卓等平台拿到的多半是磁北，悉尼磁偏角约 +12.7°E。' +
            '也可以对着已知方向的建筑物标定一下再填差值。')
        ])
      ]);

      function readCompass() {
        // requestPermission 必须在这个点击回调里同步调用
        C.request().then(function (st) {
          if (st !== 'granted') { A.toast(C.explain(st), 5000); return; }
          liveHeadingSheet();
        });
      }

      function liveHeadingSheet() {
        var big = A.h('div', { class: 'readout' }, [
          A.h('span', { class: 'n dim', text: '—' }),
          A.h('span', { class: 'u', text: '' })
        ]);
        var note = A.h('p', { class: 'hint', text: '把手机背面对准机位要拍的方向，读数稳定后点「用这个值」。' });
        var current = null;

        C.start(function (r) {
          if (r.heading === null) { return; }
          current = H.norm360(r.heading + (rec.headingOffset || 0));
          big.firstChild.textContent = String(Math.round(current));
          big.firstChild.className = 'n';
          big.lastChild.textContent = '° ' + A.compassName(current) +
            (r.accuracy !== null && r.accuracy !== undefined ? '  ±' + Math.round(r.accuracy) + '°' : '');
        });

        A.sheet({
          title: '读取罗盘',
          sub: '读数已经加上了「罗盘校正」里填的偏移量。',
          dismissValue: null,
          body: A.h('div', null, [big, note]),
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
          syncReadout();
          scheduleSave();
          A.toast('机位朝向记为 ' + Math.round(current) + '°');
        });
      }
    }

    // -------------------------------------------------------- 剖面卡片

    function buildHorizonCard() {
      var st = H.stats(rec.horizon);
      var n = st.count;
      var strip = HU.createStrip();
      strip.update(rec.horizon, rec.heading);

      var statusBits;
      if (n === 0) {
        statusBits = '还没有采集。这是整个工具最关键的一步——它决定真正的日落时刻。';
      } else if (n < H.SECTORS) {
        var miss = H.missingRanges(rec.horizon)
          .map(function (r) { return r.from + '°–' + r.to + '°'; }).join('、');
        statusBits = '已采 ' + n + '/36，还缺 ' + miss + '。缺口会按两侧插值，但采齐更准。';
      } else {
        statusBits = '36 个扇区已采齐，天际线最高 ' + A.deg(st.max) + '，最低 ' + A.deg(st.min) + '。';
      }

      return A.h('div', { class: 'card' }, [
        A.h('div', { class: 'card-head' }, [
          A.h('h2', { text: '地平线遮挡剖面' }),
          A.h('span', { class: 'meta', text: n + ' / 36' })
        ]),
        n ? strip.node : null,
        A.h('div', { class: 'stat-row', style: 'margin-top:14px' }, [
          A.h('div', { class: 'stat' }, [
            A.h('div', { class: 'k', text: '已采扇区' }),
            A.h('div', { class: 'v' + (n === H.SECTORS ? ' amber' : ''), html: n + '<small>/36</small>' })
          ]),
          A.h('div', { class: 'stat' }, [
            A.h('div', { class: 'k', text: '最高天际线' }),
            A.h('div', { class: 'v', text: n ? A.deg(st.max) : '—' })
          ]),
          A.h('div', { class: 'stat' }, [
            A.h('div', { class: 'k', text: '采集时间' }),
            A.h('div', { class: 'v', style: 'font-size:14px',
                         text: rec.horizonSampledAt ? A.relTime(rec.horizonSampledAt) : '—' })
          ])
        ]),
        A.h('p', { class: 'hint', text: statusBits }),
        A.h('button', {
          class: 'btn primary block', type: 'button', style: 'margin-top:12px',
          on: { click: function () { flushSave().then(function () { A.go('/rec/' + rec.id + '/horizon'); }); } }
        }, n ? '继续采集 / 修改剖面' : '开始采集剖面')
      ]);
    }

    // -------------------------------------------------------- 照片卡片

    function buildPhotoCard() {
      var holder = A.h('div', { class: 'photo' });
      var fileIn = A.h('input', {
        type: 'file', accept: 'image/*', capture: 'environment', class: 'file-input',
        'aria-label': '拍摄或选择参考照片'
      });

      function showEmpty() {
        A.clear(holder);
        holder.appendChild(A.h('div', { class: 'photo-empty' }, [
          A.h('div', { style: 'font-size:26px;opacity:.4', text: '⬚' }),
          A.h('div', { text: '拍一张参考照片' })
        ]));
        holder.appendChild(fileIn);
      }

      function showPhoto(blob) {
        if (photoURL) { URL.revokeObjectURL(photoURL); }
        photoURL = URL.createObjectURL(blob);
        A.clear(holder);
        holder.appendChild(A.h('img', { src: photoURL, alt: '参考照片' }));
        holder.appendChild(fileIn);
      }

      fileIn.addEventListener('change', function () {
        var f = fileIn.files && fileIn.files[0];
        if (!f) { return; }
        R.setPhoto(rec.id, f).then(function () {
          rec.hasPhoto = true;
          scheduleSave();
          showPhoto(f);
          A.toast('照片已保存（' + Math.round(f.size / 1024) + ' KB）');
        }).catch(function (e) { A.toast('保存照片失败：' + e.message, 4000); });
      });

      showEmpty();
      if (rec.hasPhoto) {
        R.getPhoto(rec.id).then(function (b) {
          if (b && !disposed) { showPhoto(b); }
          else if (!b) { rec.hasPhoto = false; scheduleSave(); }
        });
      }

      var delBtn = A.h('button', {
        class: 'btn sm danger', type: 'button', style: 'margin-top:10px',
        on: {
          click: function () {
            if (!rec.hasPhoto) { A.toast('还没有照片'); return; }
            A.confirm('删除照片？', '只删这张参考照片，记录本身保留。', '删除', 'danger')
              .then(function (ok) {
                if (!ok) { return; }
                R.removePhoto(rec.id).then(function () {
                  rec.hasPhoto = false;
                  if (photoURL) { URL.revokeObjectURL(photoURL); photoURL = null; }
                  showEmpty();
                  scheduleSave();
                  A.toast('照片已删除');
                });
              });
          }
        }
      }, '删除照片');

      return A.h('div', { class: 'card' }, [
        A.h('div', { class: 'card-head' }, [A.h('h2', { text: '参考照片' })]),
        holder,
        delBtn,
        A.h('p', { class: 'hint', text: '点图片区域即可调用相机。照片存在本机，导出 JSON 时不会包含。' })
      ]);
    }

    function remove() {
      A.confirm('删除「' + (rec.name || '未命名地点') + '」？',
        '记录和照片都会被删掉，撤销不了。', '删除', 'danger')
        .then(function (ok) {
          if (!ok) { return; }
          if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
          R.remove(rec.id).then(function () {
            A.toast('已删除');
            A.go('/', true);
          }).catch(function (e) { A.toast('删除失败：' + e.message, 4000); });
        });
    }

    return function cleanup() {
      disposed = true;
      C.stop();
      if (photoURL) { URL.revokeObjectURL(photoURL); photoURL = null; }
      flushSave();
    };
  }

  // ------------------------------------------------------------ 剖面页

  function renderHorizon(params, view) {
    deps();
    var cleanup = null;
    var disposed = false;

    A.setTop({ title: '地平线剖面', back: true });
    view.appendChild(A.h('div', { class: 'hint', text: '载入中…' }));

    R.load(params.id).then(function (r) {
      if (disposed) { return; }
      if (!r) { A.toast('记录不存在'); A.go('/', true); return; }
      var rec = R.normalize(r);
      A.clear(view);
      cleanup = HU.render(rec, view);
    }).catch(function (e) {
      A.clear(view);
      view.appendChild(A.h('div', { class: 'note bad', text: '读取失败：' + e.message }));
    });

    return function () {
      disposed = true;
      if (cleanup) { cleanup(); }
    };
  }

  return {
    renderList: renderList,
    renderDetail: renderDetail,
    renderHorizon: renderHorizon,
    getPosition: getPosition,
    zoneOptions: zoneOptions
  };
});
