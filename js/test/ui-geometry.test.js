/*!
 * 蓝调勘景仪 Blue Hour Scout — js/test/ui-geometry.test.js
 *
 * 图形布局的几何约束。曾经踩过：罗盘玫瑰的 viewBox 开小了，
 * 方位标注和机位朝向的小三角被裁掉一半，「北」只剩下半截看着像个别的字。
 * 这类问题跑单元测试发现不了，但几何约束本身是可以断言的。
 */
(function () {
  'use strict';

  var T = BH.Test;
  var G = BH.HorizonUI.GEOM;
  var H = BH.Horizon;

  T.suite('界面几何：罗盘玫瑰', function () {

    T.test('画布装得下最外圈的所有元素', function () {
      var half = G.VIEW / 2;
      T.equal(G.CX, half, '圆心在画布正中（横向）');
      T.equal(G.CY, half, '圆心在画布正中（纵向）');

      var items = [
        ['外环', G.R_OUT],
        ['朝向指针针尖', G.NEEDLE_R],
        ['机位朝向三角外沿', G.AIM_R1],
        ['方位标注（含字高）', G.LABEL_R + G.LABEL_HALF]
      ];
      for (var i = 0; i < items.length; i++) {
        var r = items[i][1];
        T.ok(r <= half, items[i][0] + ' 半径 ' + r + ' ≤ 画布半宽 ' + half);
        T.row([items[i][0], r, half, r <= half ? '通过' : '失败']);
      }
    });

    T.test('各层半径的先后次序正确', function () {
      T.ok(G.R_IN < G.R_OUT, '内径小于外径');
      T.ok(G.R_OUT < G.NEEDLE_R, '指针伸到外环之外');
      T.ok(G.R_OUT < G.AIM_R0 && G.AIM_R0 < G.AIM_R1, '朝向三角在外环之外且朝外张开');
      T.ok(G.AIM_R1 <= G.LABEL_R - G.LABEL_HALF,
           '方位标注不会和朝向三角叠在一起（标注内沿 ' +
           (G.LABEL_R - G.LABEL_HALF) + ' ≥ 三角外沿 ' + G.AIM_R1 + '）');
      T.ok(G.R_OUT - G.R_IN >= 40, '扇区有足够的径向长度表现仰角差异');
    });

    T.test('扇区能铺满整圈', function () {
      T.equal(H.SECTORS * H.SECTOR_DEG, 360, '36 个扇区 × 10° = 360°');
    });
  });

  T.suite('界面几何：天际线展开图', function () {

    T.test('横轴刚好覆盖 0–360°', function () {
      var S = G.STRIP;
      T.ok(S.PAD_L + 360 <= S.W, '0–360° 加左边距 ' + (S.PAD_L + 360) + ' ≤ 画布宽 ' + S.W);
      T.ok(S.W - (S.PAD_L + 360) <= 6, '右侧没有多余的空白（余 ' + (S.W - S.PAD_L - 360) + '）');
    });

    T.test('纵轴留够了刻度文字的位置', function () {
      var S = G.STRIP;
      T.ok(S.TOP >= 12, '顶部留白 ' + S.TOP + ' ≥ 12，够放最高一条刻度的文字');
      T.ok(S.BOT < S.H, '基线在画布之内');
      T.ok(S.H - S.BOT >= 16, '底部留白 ' + (S.H - S.BOT) + ' ≥ 16，够放方位刻度文字');
      T.ok(S.BOT - S.TOP >= 60, '绘图区高度 ' + (S.BOT - S.TOP) + ' ≥ 60');
    });
  });
}());
