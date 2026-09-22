/*!
 * 蓝调勘景仪 Blue Hour Scout — js/data/calibration.js
 *
 * EV 实测点的存取。一条记录是 (太阳视高度角, 实测 EV100, 地点 id, 日期)。
 * 拟合逻辑在 core/exposure.js 里，这里只管读写。
 */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  root.BH = root.BH || {};
  root.BH.Calibration = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  function DB() { return root.BH.DB; }

  /**
   * 记一个实测点。
   * @param {Object} p {recordId, dateKey, ms, alt, ev100, note}
   */
  function add(p) {
    return DB().put('calibration', {
      recordId: p.recordId || null,
      dateKey: p.dateKey || null,
      ms: p.ms || Date.now(),
      alt: p.alt,
      ev100: p.ev100,
      note: p.note || '',
      at: Date.now()
    });
  }

  function all() {
    return DB().getAll('calibration').then(function (rows) {
      rows.sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
      return rows;
    });
  }

  function forRecord(recordId) {
    return DB().getAllByIndex('calibration', 'recordId', recordId);
  }

  function remove(id) { return DB().del('calibration', id); }

  function clear() { return DB().clear('calibration'); }

  /** 取全部实测点并算出当前地点该用的校准系数。 */
  function fitFor(recordId) {
    return all().then(function (rows) {
      var fit = root.BH.Exposure.fitCalibration(rows, recordId);
      return {
        points: rows,
        calib: fit,
        rms: fit ? root.BH.Exposure.calibrationRMS(rows, recordId, fit) : null,
        localCount: rows.filter(function (r) { return r.recordId === recordId; }).length,
        totalCount: rows.length
      };
    });
  }

  return { add: add, all: all, forRecord: forRecord, remove: remove, clear: clear, fitFor: fitFor };
});
