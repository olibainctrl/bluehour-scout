/*!
 * 蓝调勘景仪 Blue Hour Scout — js/data/records.js
 *
 * 勘景记录的数据模型与读写。照片单独存在 photos 库，
 * 记录本身只留一个 hasPhoto 标记，这样列表页不会被 Blob 拖慢。
 */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  root.BH = root.BH || {};
  root.BH.Records = api;
  if (typeof module === 'object' && module.exports) { module.exports = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var SCHEMA = 1;
  var DB = null, H = null, Z = null;
  function deps() {
    DB = DB || root.BH.DB;
    H = H || root.BH.Horizon;
    Z = Z || root.BH.Tz;
  }

  function uid() {
    if (root.crypto && root.crypto.randomUUID) { return 'r_' + root.crypto.randomUUID(); }
    return 'r_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 10);
  }

  function num(v, fallback) {
    if (v === '' || v === null || v === undefined) { return fallback; }
    var n = typeof v === 'number' ? v : parseFloat(v);
    return isFinite(n) ? n : fallback;
  }

  /** 新建一条记录（未保存）。 */
  function create(partial) {
    deps();
    var now = Date.now();
    var r = {
      schema: SCHEMA,
      id: uid(),
      name: '',
      lat: null,
      lon: null,
      tz: Z.deviceZone(),
      gpsSource: null,          // 'device' | 'manual' | null
      gpsAccuracy: null,        // 米
      heading: null,            // 机位朝向方位角，真北起算
      headingSource: null,      // 'compass' | 'manual' | null
      headingOffset: 0,         // 罗盘读数校正量（度），默认不修正
      horizon: H.empty(),
      horizonSampledAt: null,
      notes: '',
      hasPhoto: false,
      createdAt: now,
      updatedAt: now
    };
    if (partial) {
      Object.keys(partial).forEach(function (k) { r[k] = partial[k]; });
    }
    return r;
  }

  /** 把任意来源的对象规整成合法记录（导入、旧版本数据用）。 */
  function normalize(input) {
    deps();
    var r = create();
    if (!input || typeof input !== 'object') { return r; }
    r.id = typeof input.id === 'string' && input.id ? input.id : r.id;
    r.name = typeof input.name === 'string' ? input.name.slice(0, 120) : '';
    r.lat = clampNum(input.lat, -90, 90);
    r.lon = clampNum(input.lon, -180, 180);
    r.tz = Z.isValidZone(input.tz) ? input.tz : Z.deviceZone();
    r.gpsSource = input.gpsSource === 'device' || input.gpsSource === 'manual' ? input.gpsSource : null;
    r.gpsAccuracy = clampNum(input.gpsAccuracy, 0, 100000);
    r.heading = clampNum(input.heading, 0, 360);
    if (r.heading === 360) { r.heading = 0; }
    r.headingSource = input.headingSource === 'compass' || input.headingSource === 'manual'
      ? input.headingSource : (r.heading === null ? null : 'manual');
    r.headingOffset = num(input.headingOffset, 0) || 0;
    r.horizon = H.normalize(input.horizon);
    r.horizonSampledAt = clampNum(input.horizonSampledAt, 0, 1e15);
    r.notes = typeof input.notes === 'string' ? input.notes.slice(0, 4000) : '';
    r.hasPhoto = !!input.hasPhoto;
    r.createdAt = clampNum(input.createdAt, 0, 1e15) || Date.now();
    r.updatedAt = clampNum(input.updatedAt, 0, 1e15) || r.createdAt;
    return r;
  }

  function clampNum(v, lo, hi) {
    var n = num(v, null);
    if (n === null) { return null; }
    if (n < lo || n > hi) { return null; }
    return n;
  }

  function save(rec) {
    deps();
    rec.updatedAt = Date.now();
    rec.schema = SCHEMA;
    return DB.put('records', rec).then(function () { return rec; });
  }

  function load(id) {
    deps();
    return DB.get('records', id).then(function (r) { return r || null; });
  }

  /** 全部记录，最近修改的排在前面。 */
  function list() {
    deps();
    return DB.getAll('records').then(function (rows) {
      rows.sort(function (a, b) { return (b.updatedAt || 0) - (a.updatedAt || 0); });
      return rows;
    });
  }

  function remove(id) {
    deps();
    return DB.del('photos', id)
      .catch(function () { /* 没有照片也无所谓 */ })
      .then(function () { return DB.del('records', id); });
  }

  // ------------------------------------------------------------------ 照片

  function setPhoto(id, blob) {
    deps();
    return DB.put('photos', { id: id, blob: blob, type: blob.type || '', size: blob.size || 0, at: Date.now() });
  }

  function getPhoto(id) {
    deps();
    return DB.get('photos', id).then(function (row) { return row && row.blob ? row.blob : null; });
  }

  function removePhoto(id) {
    deps();
    return DB.del('photos', id);
  }

  // ------------------------------------------------------------ 导出 / 导入

  /**
   * 导出为 JSON 文本。照片是 Blob，不放进 JSON（体积会失控），
   * 导出文件里用 hasPhoto 标明原记录有照片。
   */
  function exportJSON(records) {
    return JSON.stringify({
      app: 'bluehour-scout',
      schema: SCHEMA,
      exportedAt: new Date().toISOString(),
      note: '照片未包含在本文件中',
      records: records
    }, null, 2);
  }

  /**
   * 解析导入文本。接受导出包装对象，也接受裸数组。
   * @returns {{records:Array, errors:Array<string>}}
   */
  function parseImport(text) {
    var data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return { records: [], errors: ['不是合法的 JSON：' + e.message] };
    }
    var raw = Array.isArray(data) ? data
      : (data && Array.isArray(data.records)) ? data.records : null;
    if (!raw) {
      return { records: [], errors: ['文件里找不到记录数组'] };
    }
    var out = [], errors = [];
    for (var i = 0; i < raw.length; i++) {
      try {
        var r = normalize(raw[i]);
        if (!r.name) { r.name = '导入的记录 ' + (i + 1); }
        out.push(r);
      } catch (e) {
        errors.push('第 ' + (i + 1) + ' 条解析失败：' + e.message);
      }
    }
    return { records: out, errors: errors };
  }

  /** 按 id 合并写入，返回新增与覆盖的条数。 */
  function importRecords(records) {
    deps();
    return DB.getAll('records').then(function (existing) {
      var have = {};
      existing.forEach(function (r) { have[r.id] = true; });
      var added = 0, replaced = 0;
      records.forEach(function (r) {
        if (have[r.id]) { replaced++; } else { added++; }
      });
      return DB.putMany('records', records).then(function () {
        return { added: added, replaced: replaced };
      });
    });
  }

  // ------------------------------------------------------------------ 概况

  /** 记录是否已经能拿去算时间轴。 */
  function readiness(rec) {
    deps();
    var missing = [];
    if (rec.lat === null || rec.lon === null) { missing.push('坐标'); }
    var n = H.count(rec.horizon);
    if (n === 0) { missing.push('地平线剖面'); }
    return {
      ready: missing.length === 0,
      missing: missing,
      horizonCount: n,
      horizonComplete: n === H.SECTORS
    };
  }

  return {
    SCHEMA: SCHEMA,
    create: create,
    normalize: normalize,
    save: save,
    load: load,
    list: list,
    remove: remove,
    setPhoto: setPhoto,
    getPhoto: getPhoto,
    removePhoto: removePhoto,
    exportJSON: exportJSON,
    parseImport: parseImport,
    importRecords: importRecords,
    readiness: readiness,
    uid: uid
  };
});
