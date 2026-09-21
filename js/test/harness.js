/*!
 * 蓝调勘景仪 Blue Hour Scout — js/test/harness.js
 * 极简测试框架。无依赖，浏览器里直接 <script> 引入即可。
 */
(function (root, factory) {
  'use strict';
  var api = factory();
  root.BH = root.BH || {};
  root.BH.Test = api;
  if (typeof module === 'object' && module.exports) { module.exports = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var suites = [];
  var current = null;
  var currentTest = null;

  function suite(name, fn) {
    current = { name: name, tests: [] };
    suites.push(current);
    fn();
    current = null;
  }

  function test(name, fn) {
    if (!current) { throw new Error('test() 必须写在 suite() 里面'); }
    currentTest = { name: name, assertions: [], rows: [], error: null };
    current.tests.push(currentTest);
    try {
      fn();
    } catch (e) {
      currentTest.error = (e && e.stack) || String(e);
    }
    currentTest = null;
  }

  function record(pass, message, detail) {
    if (!currentTest) { throw new Error('断言必须写在 test() 里面'); }
    currentTest.assertions.push({ pass: !!pass, message: message, detail: detail || '' });
    return pass;
  }

  /** 附一行明细表（用来把逐条比对的数值显示出来，通过与否都显示）。 */
  function row(cells) {
    if (!currentTest) { throw new Error('row() 必须写在 test() 里面'); }
    currentTest.rows.push(cells);
  }

  function ok(value, message) {
    return record(!!value, message, value ? '' : '得到 ' + fmt(value));
  }

  function equal(actual, expected, message) {
    return record(actual === expected, message,
      actual === expected ? '' : '期望 ' + fmt(expected) + '，得到 ' + fmt(actual));
  }

  /** 数值近似断言。tol 为闭区间容差。 */
  function near(actual, expected, tol, message, unit) {
    var d = Math.abs(actual - expected);
    var pass = isFinite(d) && d <= tol;
    return record(pass, message,
      'Δ=' + round(actual - expected, 4) + (unit || '') +
      ' (容差 ±' + tol + (unit || '') + '，得到 ' + round(actual, 4) + '，期望 ' + round(expected, 4) + ')');
  }

  function isNull(actual, message) {
    return record(actual === null, message, actual === null ? '' : '期望 null，得到 ' + fmt(actual));
  }

  function notNull(actual, message) {
    return record(actual !== null && actual !== undefined, message,
      (actual !== null && actual !== undefined) ? '' : '期望非空');
  }

  function round(v, n) {
    if (typeof v !== 'number' || !isFinite(v)) { return String(v); }
    var p = Math.pow(10, n);
    return Math.round(v * p) / p;
  }

  function fmt(v) {
    if (typeof v === 'number') { return String(round(v, 6)); }
    if (v === null) { return 'null'; }
    if (v === undefined) { return 'undefined'; }
    return String(v);
  }

  /** 运行全部 suite，返回汇总结果。 */
  function run() {
    var total = 0, failed = 0, suiteOut = [];
    for (var i = 0; i < suites.length; i++) {
      var s = suites[i];
      var sPass = 0, sFail = 0;
      for (var j = 0; j < s.tests.length; j++) {
        var t = s.tests[j];
        var tFail = t.error ? 1 : 0;
        for (var k = 0; k < t.assertions.length; k++) {
          total++;
          if (t.assertions[k].pass) { sPass++; } else { sFail++; tFail++; }
        }
        t.failed = tFail;
      }
      failed += sFail;
      suiteOut.push({ name: s.name, tests: s.tests, passed: sPass, failed: sFail });
    }
    return { total: total, failed: failed, passed: total - failed, suites: suiteOut };
  }

  /** 纯文本报告，命令行/控制台用。 */
  function textReport(result) {
    var out = [];
    for (var i = 0; i < result.suites.length; i++) {
      var s = result.suites[i];
      out.push((s.failed ? 'FAIL' : ' OK ') + '  ' + s.name +
               '  (' + s.passed + '/' + (s.passed + s.failed) + ')');
      for (var j = 0; j < s.tests.length; j++) {
        var t = s.tests[j];
        if (t.failed || t.error) {
          out.push('        ✗ ' + t.name);
          if (t.error) { out.push('            ' + t.error.split('\n')[0]); }
          for (var k = 0; k < t.assertions.length; k++) {
            if (!t.assertions[k].pass) {
              out.push('            ' + t.assertions[k].message + ' — ' + t.assertions[k].detail);
            }
          }
        }
      }
    }
    out.push('');
    out.push(result.failed === 0
      ? '全部通过：' + result.passed + ' 条断言'
      : '失败 ' + result.failed + ' / ' + result.total + ' 条断言');
    return out.join('\n');
  }

  return {
    suite: suite, test: test, row: row,
    ok: ok, equal: equal, near: near, isNull: isNull, notNull: notNull,
    run: run, textReport: textReport,
    _suites: suites
  };
});
