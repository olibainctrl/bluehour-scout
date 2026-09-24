/*!
 * 蓝调勘景仪 Blue Hour Scout — js/test/ui.test.js
 *
 * 界面组件的行为：数字输入框（尤其是负号）、步进器。
 *
 * 曾经踩过：所有数字框用的都是 type="number" + inputmode="decimal"，
 * 而 iOS 的 decimal 小键盘上没有负号——悉尼的纬度 −33.86、剖面的负仰角、
 * 蓝调区间下界 −9°、航海暮光的负 EV100，全都输不进去。
 */
(function () {
  'use strict';

  var T = BH.Test;
  var hasDOM = (typeof document !== 'undefined' && !!document.createElement &&
                typeof Event === 'function');

  function type(ni, text) {
    ni.input.value = text;
    ni.input.dispatchEvent(new Event('input', { bubbles: true }));
  }

  T.suite('界面组件：数字输入框', function () {

    T.test('有正负号的框：± 键在各种状态下都能切', function () {
      if (!hasDOM) { T.ok(true, '当前宿主没有 DOM'); return; }
      var ni = BH.App.numInput({ signed: true });
      var pm = ni.node.querySelector('.pm');
      T.ok(pm, '带 ± 键');
      T.equal(ni.input.getAttribute('inputmode'), 'decimal', '仍然弹大号数字键盘');
      T.equal(ni.input.type, 'text', '用 text 而不是 number，这样单独一个负号才留得住');

      type(ni, '33.86');
      pm.click();
      T.equal(ni.input.value, '-33.86', '按 ± 变成 −33.86');
      T.equal(ni.value(), -33.86, '解析为 −33.86');
      pm.click();
      T.equal(ni.value(), 33.86, '再按一次变回正数');

      type(ni, '');
      pm.click();
      T.equal(ni.input.value, '-', '空框先按 ±，留下一个负号等着输数字');
      T.isNull(ni.value(), '单独一个负号解析为空，不是 0 也不是 NaN');
      type(ni, '-9');
      T.equal(ni.value(), -9, '接着输 9 得到 −9');
    });

    T.test('输入清洗', function () {
      if (!hasDOM) { T.ok(true, '当前宿主没有 DOM'); return; }
      var ni = BH.App.numInput({ signed: true });
      type(ni, '1,5');
      T.equal(ni.value(), 1.5, '逗号小数点（某些地区的键盘）换成点');
      type(ni, '−5');
      T.equal(ni.value(), -5, 'Unicode 减号 − 当作负号');
      type(ni, '12.3.4');
      T.equal(ni.input.value, '12.34', '只保留第一个小数点');
      type(ni, '1a2b3');
      T.equal(ni.input.value, '123', '字母被滤掉');
      type(ni, '5-');
      T.equal(ni.input.value, '5', '负号只认开头的');

      var pos = BH.App.numInput({});
      T.ok(!pos.node.querySelector('.pm'), '不需要负号的框没有 ± 键');
      type(pos, '-5');
      T.equal(pos.value(), 5, '不需要负号的框里负号被滤掉');

      var intg = BH.App.numInput({ integer: true });
      T.equal(intg.input.getAttribute('inputmode'), 'numeric', '整数框用 numeric 键盘');
      type(intg, '24');
      T.equal(intg.value(), 24, '整数解析');
    });

    T.test('onInput 回调拿到的是解析后的数', function () {
      if (!hasDOM) { T.ok(true, '当前宿主没有 DOM'); return; }
      var got = [];
      var ni = BH.App.numInput({ signed: true, onInput: function (v) { got.push(v); } });
      type(ni, '-');
      type(ni, '-1');
      type(ni, '-12.5');
      type(ni, '');
      T.equal(JSON.stringify(got), JSON.stringify([null, -1, -12.5, null]),
              '依次得到 null, −1, −12.5, null');
    });

    T.test('set() 写回显示值', function () {
      if (!hasDOM) { T.ok(true, '当前宿主没有 DOM'); return; }
      var ni = BH.App.numInput({ signed: true });
      ni.set(-33.8599);
      T.equal(ni.value(), -33.8599, '写入负数后读回一致');
      ni.set(null);
      T.equal(ni.input.value, '', '写入 null 清空');
    });
  });

  T.suite('界面组件：步进器', function () {

    T.test('上下限与"未填"', function () {
      if (!hasDOM) { T.ok(true, '当前宿主没有 DOM'); return; }
      var seen = [];
      var st = BH.App.stepper({ value: 2, min: 1, max: 3, start: 2, nullable: true,
                                onChange: function (v) { seen.push(v); } });
      var b = st.node.querySelectorAll('button');
      var dec = b[0], inc = b[1];
      inc.click(); T.equal(st.value(), 3, '+ 到 3');
      inc.click(); T.equal(st.value(), 3, '到上限不再加');
      T.ok(inc.disabled, '到上限时 + 键置灰');
      dec.click(); dec.click(); T.equal(st.value(), 1, '− 到 1');
      dec.click(); T.isNull(st.value(), '在最小值上再按 − 回到"未填"');
      T.ok(dec.disabled, '未填时 − 键置灰');
      inc.click(); T.equal(st.value(), 2, '从未填按 + 回到起始值');
      // 到上限后 + 键是 disabled，再点不会触发事件，所以不会多出一次无意义的回调
      T.equal(JSON.stringify(seen), JSON.stringify([3, 2, 1, null, 2]),
              '每次真实变化都回调，按灰掉的键不回调');
    });

    T.test('不允许为空时停在最小值', function () {
      if (!hasDOM) { T.ok(true, '当前宿主没有 DOM'); return; }
      var st = BH.App.stepper({ value: 1, min: 1, max: 9 });
      st.node.querySelectorAll('button')[0].click();
      T.equal(st.value(), 1, '停在 1');
      T.ok(st.node.querySelectorAll('button')[0].disabled, '− 键置灰');
    });
  });
}());
