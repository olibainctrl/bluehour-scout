/*!
 * 蓝调勘景仪 Blue Hour Scout — js/ui/guide-ui.js
 *
 * 两页说明：
 *   /guide      使用方法，按现场的先后顺序一步一步写
 *   /statement  声明：全部计算方式和精度
 *
 * 顶栏的灯泡按钮每一页都有，点了会带上当前所在的页面（/guide/timeline 这样），
 * 使用方法直接滚到对应的那一步，不用从头找。
 *
 * 声明页里的锚点、阈值、区间一律从代码里的常量读，不在这里抄一份——
 * 改了模型忘改说明，比没有说明更糟。
 */
(function (root, factory) {
  'use strict';
  var api = factory(root);
  root.BH = root.BH || {};
  root.BH.Guide = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (root) {
  'use strict';

  var A = null, E = null, S = null, TL = null, CL = null, G = null, St = null;
  function deps() {
    A = A || root.BH.App; E = E || root.BH.Exposure; S = S || root.BH.Solar;
    TL = TL || root.BH.Timeline; CL = CL || root.BH.Cloud; G = G || root.BH.Geomag;
    St = St || root.BH.Settings;
  }

  /**
   * 声明页引用的「测得 / 算得」数字，集中在这里。
   * js/test/guide.test.js 和各算法测试会检查代码的实际表现没有超出这里写的——
   * 算法一改、误差一变，测试就红，提醒回来改说明。
   */
  var CLAIMS = {
    noaaDates: 16, noaaEvents: 32, noaaNoonMaxSec: 14,
    gaDates: 6, gaEvents: 42, gaMaxSec: 56,
    wmmPoints: 100, wmmMaxNT: 0.001,
    blueMinutes: [41, 48],        // 悉尼全年、默认蓝调区间下的窗口时长（分钟）
    // 太阳落到天际线高度（+0.5° 到 +10°，常见的楼和山）时每分钟降多少度（视高度角）。
    // 注意不是在 0° 处量：NOAA 的折射模型在地平线以下变化很快，那里的速度偏大，和遮挡无关
    sunsetRate: [0.16, 0.21],
    minutesPerDegree: [5, 6],     // 天际线差 1° → 真实日落差几分钟
    limbMinutes: 1.5,             // 日面中心被挡之后，上缘还要多久才没入（半径 0.267°）
    minutesPerEV: [3, 7],         // 环境 EV 差 1 档 → 补光交叉时刻差几分钟
    evPerMinute: [0.15, 0.3],     // 蓝调窗口里环境光每分钟暗多少档
    refractionEV: 0.36            // 日落时视高度角 −0.44° 对应的 EV 口径差
  };

  function rng(r, unit) { return r[0] + '–' + r[1] + (unit || ''); }

  // ------------------------------------------------------------ 页面 → 步骤

  /**
   * 当前页面对应使用方法里的哪一节。没有对应的返回 null（从头看）。
   * 顶栏的灯泡按钮用它决定跳到哪。
   */
  function sectionFor(path) {
    var p = String(path || '/');
    var m = /^\/rec\/[^/]+(?:\/(.*))?$/.exec(p);
    if (m) {
      var rest = m[1] || '';
      if (rest === '') { return 'record'; }
      if (rest === 'horizon') { return 'horizon'; }
      if (rest === 'timeline') { return 'timeline'; }
      if (rest === 'weather') { return 'weather'; }
      var s = /^s\/(place|heading|notes)$/.exec(rest);
      return s ? s[1] : 'record';
    }
    if (p === '/settings') { return 'settings'; }
    return null;
  }

  // ------------------------------------------------------------ 使用方法

  /*
   * 每一步：id 用于跳转；t 标题；p 若干段（静态文案，允许 <b>）。
   * 文案规矩：说清楚做什么、点哪个按钮，不解释为什么好。
   */
  var GUIDE = [
    {
      title: '第一次用',
      steps: [
        {
          id: 'install', t: '装到主屏幕',
          p: [
            '用 Safari 打开，点底部的分享按钮，选<b>「添加到主屏幕」</b>。之后从主屏幕的图标进来：' +
            '全屏显示，断网也能用（七天云量除外）。',
            '在 Safari 里和从主屏幕打开是两份独立的数据，定一个入口一直用。'
          ]
        },
        {
          id: 'settings', t: '填项目设置',
          p: [
            '右上角的滑块图标。<b>摄影机</b>填原生 ISO（双原生两档都填），<b>镜头</b>填最大光圈，' +
            '<b>灯具</b>填照度和测量时的距离。<b>蓝调区间</b>默认太阳 <span data-k="blueRange"></span>，一般不用改。',
            '这些填一次就行。帧率和快门角度不在这里，在每个机位的时间轴页选。'
          ]
        }
      ]
    },
    {
      title: '在机位上勘景',
      lead: '一条记录四步。站在机器要架的位置上做——挪几米，近处的树和楼的仰角就变了。',
      steps: [
        {
          id: 'record', t: '新建记录',
          p: [
            '首页底部<b>「＋ 新建勘景记录」</b>，直接进第 1 步。之后点列表里的记录可以回到概览，' +
            '从概览跳进任意一步补。'
          ]
        },
        {
          id: 'place', t: '第 1 步：地点与坐标',
          p: [
            '起个名字，点<b>「一键获取当前位置」</b>。按钮下面会显示精度，室外一般 ±5–20 米。',
            '时区默认跟手机走。人在国外规划悉尼的拍摄时，在「时区」里改成 Australia/Sydney。',
            '后面的罗盘要用坐标算磁偏角，所以这一步要先做。'
          ]
        },
        {
          id: 'heading', t: '第 2 步：机位朝向（可以跳过）',
          p: [
            '点<b>「读取罗盘」</b>，手机背面对准要拍的方向，数字稳定后点<b>「用这个值」</b>。' +
            '读数已经按当地磁偏角换成真北。也可以直接填方位角。',
            '罗盘不准时见下面的小贴士。'
          ]
        },
        {
          id: 'horizon', t: '第 3 步：地平线剖面',
          p: [
            '点<b>「启用罗盘和相机」</b>。竖着举手机，把准星压在天际线上，原地慢慢转一圈：' +
            '每个方向停半秒左右就记下这个方向的仰角，36 格全亮就齐了。转太快会提示慢一点。',
            '罗盘用不了时，在<b>「逐扇区数值」</b>里逐格手填；四周都是平地可以一键全部设为 0°。',
            '这一步决定真实日落：天际线差 1°，日落时刻差 <span data-k="minPerDeg"></span> 分钟。'
          ]
        },
        {
          id: 'notes', t: '第 4 步：照片与备注',
          p: [
            '拍一张参考照片，写下停车、门禁、潮汐这类回头会忘的事。照片只存在这台手机上。'
          ]
        }
      ]
    },
    {
      title: '规划拍摄',
      steps: [
        {
          id: 'timeline', t: '光线时间轴',
          p: [
            '在记录概览点<b>「光线时间轴」</b>，选日期。最上面是蓝调窗口几点到几点、一共多少分钟；' +
            '下面是<b>真实日落</b>（被你采的天际线挡住的那一刻）、天文日落和民用、航海昏影。',
            '<b>拍摄参数</b>里选机身、镜头、帧率、快门角度和 setup 数。每个 setup 分不到 ' +
            '<span data-k="minPerSetup"></span> 分钟会提示，并给出建议砍几个。',
            '<b>逐分钟表</b>：T@低 ISO、T@高 ISO 两列是两档原生 ISO 下要开的 T 档，<b>加粗</b>的是该用的那档；' +
            '▸ 开头的行标出要切到高原生 ISO、或者镜头开到头的那一分钟。蓝调窗口内的行亮、窗口外的行暗。'
          ]
        },
        {
          id: 'weather', t: '七天云量',
          p: [
            '在记录概览点<b>「七天云量」</b>，看这一周哪天值得去。顶部一排是七天的结论和低云百分比，点某天跳到详情。',
            '结论只看<b>低云</b>：低云才真正挡光、把天空压成一片灰。中云、高云和降水概率分开列在详情里；' +
            '高云多时会提示「可能增加天空层次」。',
            '要联网。半小时内重复打开用上次的数据；没网时显示上次拉到的数据和拉取时间。'
          ]
        }
      ]
    },
    {
      title: '拍摄当天',
      steps: [
        {
          id: 'now', t: '看「现在」',
          p: [
            '到了现场打开时间轴。在时间轴范围内时，最上面的<b>「现在」</b>面板显示这一分钟该用的 ISO 和 T 档，' +
            '每 20 秒刷新；表格也会自动滚到这一分钟。'
          ]
        },
        {
          id: 'calib', t: '记录实测，让曲线变准',
          p: [
            '用测光表测一下，点表格里对应的那一行，填 EV100，或者填光圈、快门、ISO 自动换算。',
            '攒够 <span data-k="minForSlope"></span> 个点，整条曲线按实测拟合；同一个机位的点优先用，' +
            '不够再用别处的。表格上方会写<b>「已用 N 个实测点校准」</b>和拟合残差。'
          ]
        }
      ]
    },
    {
      title: '数据',
      steps: [
        {
          id: 'backup', t: '备份和换手机',
          p: [
            '首页右上角<b>「数据」</b>→ 导出 JSON，存到「文件」App 或者发给自己。照片不在 JSON 里。' +
            '换手机时在同一个地方导入。',
            '所有数据只存在这台手机上。清除 Safari 的网站数据会把记录一起清掉，重要的记录记得导出。'
          ]
        }
      ]
    }
  ];

  var TIPS = [
    '<b>罗盘不准时</b>：远离车和铁栏杆，拿掉带磁铁的手机壳，手里画几个 8 字让它重新校准。' +
    '再对着一个方向已知的东西检查（地图上量得出方向的街道或楼的立面），' +
    '还差几度就把差值填进第 2 步的「罗盘校正」，剖面和朝向都会用它。',
    '<b>黄昏用夜间模式</b>：右上角的太阳 / 月亮按钮切换，夜间整个界面压暗，不影响暗适应。',
    '<b>右上角的灯泡</b>随时回到这一页，会直接跳到你当前所在的那一步。'
  ];

  function renderGuide(params, view) {
    deps();
    A.setTop({ title: '使用方法', back: true });

    var focus = params && params.section ? params.section : null;
    var focusEl = null;
    var blue = St.defaults().blueRange;
    var k = {
      blueRange: sgn(blue.upper) + '° 到 ' + sgn(blue.lower) + '°',
      minPerSetup: String(TL.MIN_PER_SETUP),
      minForSlope: String(E.MIN_FOR_SLOPE),
      minPerDeg: rng(CLAIMS.minutesPerDegree)
    };

    view.appendChild(A.h('p', { class: 'hint', style: 'margin-top:0' },
      '按现场的先后顺序写。每一页右上角的灯泡都能回到这里。'));

    var n = 0;
    GUIDE.forEach(function (sec) {
      view.appendChild(A.h('p', { class: 'section-title', text: sec.title }));
      if (sec.lead) { view.appendChild(A.h('p', { class: 'hint', style: 'margin:-4px 0 10px' }, sec.lead)); }
      var card = A.h('div', { class: 'card guide' });
      sec.steps.forEach(function (st) {
        n++;
        var here = focus === st.id;
        var body = A.h('div', { class: 'g-body' }, [
          A.h('div', { class: 'g-t' }, [
            st.t,
            here ? A.h('span', { class: 'badge warn', text: '当前页面' }) : null
          ])
        ]);
        st.p.forEach(function (html) {
          var para = A.h('p', { html: html });
          fillKeys(para, k);
          body.appendChild(para);
        });
        var row = A.h('div', { class: 'g-step' + (here ? ' here' : ''), id: 'g-' + st.id }, [
          A.h('span', { class: 'g-n', text: String(n) }),
          body
        ]);
        if (here) { focusEl = row; }
        card.appendChild(row);
      });
      view.appendChild(card);
    });

    view.appendChild(A.h('p', { class: 'section-title', text: '小贴士' }));
    view.appendChild(A.h('div', { class: 'card guide tips' },
      TIPS.map(function (html) { return A.h('p', { html: html }); })));

    view.appendChild(A.h('div', { class: 'nav-list', style: 'margin-top:18px' }, [
      A.h('button', {
        class: 'nav-row', type: 'button',
        on: { click: function () { A.go('/statement'); } }
      }, [
        A.h('span', { class: 'body' }, [
          A.h('span', { class: 't', text: '声明：计算方式与精度' }),
          A.h('span', { class: 's', text: '每个数怎么算、测过多准、误差从哪来' })
        ]),
        A.h('span', { class: 'chev', text: '›' })
      ])
    ]));

    // 从别的页面点灯泡进来：滚到那一步。view 已经在文档里，读位置会同步算布局；
    // 不用 requestAnimationFrame——页面在后台时它不触发，就不滚了
    if (focusEl) {
      var dy = focusEl.getBoundingClientRect().top - view.getBoundingClientRect().top;
      view.scrollTop = Math.max(0, view.scrollTop + dy - 12);
    }
  }

  /** 把 <span data-k="..."> 换成代码里的常量值。 */
  function fillKeys(node, k) {
    var spans = node.querySelectorAll('[data-k]');
    for (var i = 0; i < spans.length; i++) {
      var key = spans[i].getAttribute('data-k');
      spans[i].textContent = k[key] !== undefined ? k[key] : '?';
    }
  }

  // ------------------------------------------------------------ 声明

  // 负号一律用 U+2212，和界面其它地方一致
  function fx(v, d) {
    var s = Math.abs(Number(v)).toFixed(d === undefined ? 1 : d);
    return (v < 0 ? '−' : '') + s;
  }
  function sgn(v) { return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v); }

  function table(head, rows, cls) {
    return A.h('div', { class: 'tbl-wrap' }, A.h('table', { class: cls || 'doc-tbl' }, [
      A.h('thead', null, A.h('tr', null, head.map(function (h) { return A.h('th', { text: h }); }))),
      A.h('tbody', null, rows.map(function (r) {
        return A.h('tr', null, r.map(function (c) { return A.h('td', { html: String(c) }); }));
      }))
    ]));
  }

  function formula(lines) {
    return A.h('div', { class: 'formula' }, lines.map(function (l) { return A.h('div', { html: l }); }));
  }

  function para(html) { return A.h('p', { html: html }); }
  function list(items) {
    return A.h('ul', null, items.map(function (html) { return A.h('li', { html: html }); }));
  }
  function sub(text) { return A.h('h3', { text: text }); }

  function fold(title, tag, children) {
    return A.h('details', { class: 'fold doc' }, [
      A.h('summary', null, [
        A.h('span', { class: 'doc-title', text: title }),
        tag ? A.h('span', { class: 'doc-tag', text: tag }) : null
      ]),
      A.h('div', { class: 'fold-body doc-body' }, children)
    ]);
  }

  function renderStatement(params, view) {
    deps();
    A.setTop({ title: '声明', sub: '计算方式与精度', back: true });

    var blue = St.defaults().blueRange;
    var stops = E.STOPS;

    // ---------------------------------------------------------- 总声明
    view.appendChild(A.h('div', { class: 'card doc-lead' }, [
      para('这个工具算出来的时刻、曝光和色温都是<b>估算</b>，用来提前规划、减少现场试错，' +
           '不能代替现场的测光表和监视器。'),
      para('下面列出每个数是怎么算的、拿什么验证过、测到的误差有多大，以及算法管不到的误差从哪来。' +
           '标「测得」的是自动测试里实际比对出来的；标「估计」的是按量级推断，没有实测对比。')
    ]));

    // ---------------------------------------------------------- 一览
    view.appendChild(A.h('p', { class: 'section-title', text: '精度一览' }));
    view.appendChild(A.h('div', { class: 'card tight' }, table(
      ['项目', '精度', '主要误差来源'],
      [
        ['日出日落、暮光时刻', '算法与 NOAA 一致到分钟（测得）<br>现实中约 ±1 分钟（估计）', '大气折射的日常变化'],
        ['蓝调窗口起止', '同上', '同上'],
        ['真实日落（有遮挡）', '天际线差 1° ≈ ' + rng(CLAIMS.minutesPerDegree, ' 分钟'), '剖面仰角、罗盘方位'],
        ['罗盘方位', '手机自报常见 ±5–20°', '手机罗盘、周围的铁和磁铁'],
        ['磁偏角', '与 NOAA 官方值一致（测得）<br>模型本身约 0.3–0.4°', '局部地磁异常'],
        ['EV100 / T 档（通用模型）', '±1–2 档（估计）', '天气、拍摄方向、城市灯光'],
        ['EV100 / T 档（校准后）', '看界面显示的残差', '实测点的数量和高度角跨度'],
        ['色温', '只能看趋势', '方向、云、城市灯光'],
        ['补光交叉时刻', '环境 EV 差 1 档 ≈ ' + rng(CLAIMS.minutesPerEV, ' 分钟'), '环境 EV、灯的实际输出'],
        ['七天云量', '1–2 天较可信，3 天后看趋势', '数值预报本身']
      ]
    )));

    view.appendChild(A.h('p', { class: 'section-title', text: '计算方式' }));

    // ---------------------------------------------------------- 太阳
    view.appendChild(fold('太阳位置与日落时刻', '与 NOAA 一致到分钟', [
      para('算法是美国国家海洋和大气管理局（NOAA）太阳计算器所用的公式，出自 Jean Meeus《Astronomical Algorithms》。' +
           '全部在手机上算，不联网。'),
      list([
        '先求当地的太阳正午，再用牛顿迭代求太阳高度角等于某个值的时刻，精确到秒。',
        '日出日落：太阳中心的几何高度角 <b>' + S.ALT_SUNRISE + '°</b>（大气折射 34′ + 日面半径 16′）。',
        '民用、航海、天文昏影：几何高度角 <b>' + S.ALT_CIVIL + '°、' + S.ALT_NAUTICAL + '°、' +
          S.ALT_ASTRONOMICAL + '°</b>。和各国天文台公布的口径一致。',
        '界面上的「高度」一列和所有模型用的都是<b>视高度角</b>（加上大气折射）。地平线处折射约 0.48°，' +
          '所以天文日落那一刻太阳中心的视高度角是 −0.44°，不是 0°。'
      ]),
      sub('验证（测得）'),
      list([
        '对 NOAA 太阳计算器：悉尼 ' + CLAIMS.noaaDates + ' 个日期（2025–2026 年，含夏令时切换那两天），' +
          CLAIMS.noaaEvents + ' 个日出日落时刻按分钟取整后<b>全部一致</b>（NOAA 只给到分钟）；' +
          '太阳正午给到秒，最大差 ' + CLAIMS.noaaNoonMaxSec + ' 秒。',
        '对澳大利亚地球科学局（Geoscience Australia）：' + CLAIMS.gaDates + ' 个日期 × 日出、日落、' +
          '民用和航海晨昏、中天，共 ' + CLAIMS.gaEvents + ' 个时刻，最大差 ' + CLAIMS.gaMaxSec + ' 秒。' +
          'GA 用的是另一套更细的算法，两者本来就差几十秒，只作旁证。',
        '2026 年每一天，算出的各个时刻上太阳高度角与定义值相差不到 10⁻⁹ 度。'
      ]),
      sub('算法管不到的'),
      list([
        '<b>大气折射</b>随气温、气压变化。地平线附近折射量偏离标准值 0.2° 以上很常见，有逆温时更多，' +
          '相当于日落早晚 1 分钟左右。这比算法误差大得多。',
        '<b>站在高处</b>看海平线时，真实地平线低于 0°，日落会晚一点。这种情况在剖面里填负的仰角。',
        '时区和夏令时交给手机系统的时区库（每条记录单独存一个 IANA 时区名）。'
      ])
    ]));

    // ---------------------------------------------------------- 蓝调窗口
    view.appendChild(fold('蓝调窗口', '±1 分钟', [
      para('太阳视高度角从 <b>' + sgn(blue.upper) + '°</b> 降到 <b>' + sgn(blue.lower) + '°</b> 的这段时间' +
           '（默认值，项目设置里可以改）。两个端点用视高度角求根，精确到秒。'),
      para('按默认区间，悉尼全年大约 ' + rng(CLAIMS.blueMinutes, ' 分钟') + '：春分、秋分前后最短，冬至、夏至前后最长。'),
      para('这是一个约定的区间，不是物理边界。天空什么时候最好看取决于天气、拍摄方向和想要的画面。' +
           '精度和日落时刻同级。'),
      para('时间轴从日落前 ' + TL.LEAD_MINUTES + ' 分钟开始，到航海昏影（−12°）结束；' +
           '高纬度夏天太阳降不到 −12° 时，延长到日落后 120 分钟。')
    ]));

    // ---------------------------------------------------------- 剖面
    view.appendChild(fold('地平线剖面与真实日落', '天际线差 1° ≈ ' + rng(CLAIMS.minutesPerDegree, ' 分钟'), [
      sub('采样'),
      list([
        '一圈分 36 个扇区，每 10° 一个，第 i 格覆盖 i×10° 前后各 5°。',
        '手机竖着、后摄对准天际线。在一个扇区停住至少 0.45 秒、攒够 5 个读数，取<b>中位数</b>记下。',
        '仰角 = arcsin(−cos β · cos γ)，β、γ 是手机的俯仰和横滚角。只和手机姿态有关，和罗盘无关；手机歪一点也自动补偿。',
        '方位来自罗盘，换算方法见下一节。'
      ]),
      sub('判定'),
      list([
        '太阳方位上的天际线仰角，按相邻两个采样点线性插值。',
        '太阳<b>日面中心</b>的视高度角低于它，就算被挡。这是项目约定；日面上缘还要再过约 ' +
          CLAIMS.limbMinutes + ' 分钟才完全没入。',
        '真实日落 = 第一个被挡住的分钟和前一分钟之间，按余量线性插值到秒。',
        '没采剖面时不判遮挡，只给天文日落。'
      ]),
      sub('精度'),
      list([
        '太阳落到常见天际线的高度（0.5°–10°）时，每分钟降 ' + rng(CLAIMS.sunsetRate, '°') +
          '，所以<b>天际线仰角差 1°，真实日落差 ' + rng(CLAIMS.minutesPerDegree, ' 分钟') +
          '</b>（按悉尼全年的太阳轨迹算）。',
        '手持采样的仰角误差估计在 ±0.5° 量级（传感器加准星对准），对应 ±3 分钟左右（估计）。',
        '方位偏了多少度，就相当于拿旁边那么多度的天际线来判。天际线在日落方向上起伏越大，影响越大。',
        '10° 一格：两次采样之间的窄东西（电线杆、单棵树）可能漏掉，或者被插值抹平。'
      ])
    ]));

    // ---------------------------------------------------------- 罗盘
    var sydD = G.declination(-33.8599, 151.2009, Date.now());
    view.appendChild(fold('罗盘与磁偏角', '手机自报 ±5–20°', [
      para('手机罗盘给的是<b>磁北</b>，iOS 也一样：WebKit 源码（WebCoreMotionManager.mm）里 ' +
           'webkitCompassHeading 取的是 CLHeading 的 magneticHeading；安卓的绝对方向同样参考磁北。' +
           '太阳方位角是真北起算的，所以要换算：'),
      formula(['真北方位 = 磁北方位 + 磁偏角 + 罗盘校正']),
      list([
        '<b>磁偏角</b>用世界地磁模型 ' + G.MODEL.replace('-', '') + '（NOAA 与英国地质调查局发布），12 阶球谐展开，' +
          '按记录的坐标和当天日期在本地算。悉尼现在是 <b>' + (sydD >= 0 ? '+' : '−') + fx(Math.abs(sydD)) + '°</b>（东偏）。',
        '验证（测得）：系数照抄 NOAA 发布的 WMM.COF；对 NOAA 随系数发布的 ' + CLAIMS.wmmPoints + ' 组官方测试值，' +
          '磁场分量的差都不到 ' + CLAIMS.wmmMaxNT + ' nT，磁偏角全部一致到官方给出的 0.01°。',
        '有效期到 ' + (G.VALID_TO - 1) + ' 年底，之后要换新一版的系数。',
        '罗盘读数取最近 0.26 秒的圆周平均（避免把 359° 和 1° 平均成 180°）。',
        '<b>罗盘校正</b>默认 0，只用来补手机自己的固定偏差，剖面和机位朝向用同一个值。'
      ]),
      sub('误差'),
      list([
        '最大的是<b>手机罗盘本身</b>：iOS 会自报一个误差（采样页显示），常见 ±5–20°。' +
          '车、铁栏杆、钢筋、带磁铁的手机壳会让它偏得更多。',
        '磁偏角模型本身的不确定度在悉尼约 0.3–0.4°（WMM 官方误差模型）；附近有铁矿、地下管线等局部地磁异常时会更大。',
        '检查方法：对着一个方向已知的东西（地图上量得出方向的街道、楼的立面）读一下，差值固定就填进罗盘校正。',
        'v16 之前的版本把 iOS 罗盘读数当成了真北。那时采的记录打开时会提示「方位没扣磁偏角」，可以一键转回真北。'
      ])
    ]));

    // ---------------------------------------------------------- 曝光
    view.appendChild(fold('曝光：EV100 与 T 档', '通用模型 ±1–2 档', [
      para('EV100 以太阳视高度角为自变量，在下面几个锚点之间线性插值，两端沿最外侧那一段的斜率外推：'),
      A.h('div', { class: 'card tight doc-inner' }, table(['太阳视高度角', 'EV100'],
        E.EV_ANCHORS.map(function (a) { return [sgn(a[0]) + '°', fx(a[1])]; }), 'data')),
      para('这些锚点是晴天傍晚天光的<b>初始估计</b>，不是在你的机位测出来的。' +
           '口径上还有一个小差：模型里的 0° 是视高度角，天文日落那一刻视高度角是 −0.44°，折算约 ' +
           CLAIMS.refractionEV + ' EV。' +
           '这些都由实测校准吃掉。'),
      sub('换算'),
      formula([
        '快门 t = 快门角度 ÷ (360 × 帧率)',
        'EV<sub>ISO</sub> = EV100 + log₂(ISO ÷ 100)',
        'T 档 N = √(t × 2<sup>EV<sub>ISO</sub></sup>)'
      ]),
      list([
        '算出的 N 对到最近的 1/3 档（T' + stops[0].toFixed(1) + ' 到 T' + stops[stops.length - 1] + '）。' +
          '超出范围显示 ＞T' + stops[stops.length - 1] + ' 或 ＜T' + stops[0] + '，不会悄悄夹到端点。',
        '双原生 ISO：低档需要的光圈镜头开得到就用低档；开不到就切高档，并在表里标出切换的那一分钟；' +
          '高档也开不到时标「超出 T 几」。单原生 ISO 的机器只有一列。',
        '帧率和快门角度按每个机位存，没选过的按 ' + TL.DEFAULT_FPS + 'fps / ' + TL.DEFAULT_SHUTTER + '° 算。',
        '镜头最大光圈按标称的 F 值当 T 值用。镜片透光有损失，真实 T 值通常比 F 值慢 0.1–0.3 档，老镜头可能更多。'
      ]),
      sub('精度'),
      list([
        '通用模型估计 ±1–2 档：朝西（余晖方向）和朝东、晴天和薄云、市区和郊外都能差出一两档以上。' +
          '太阳降到 −9° 以下之后，城市里的天空亮度越来越多来自人造光，模型不管这部分。',
        'EV 差 1 档，T 档就差 1 档。所以要用实测校准。'
      ])
    ]));

    // ---------------------------------------------------------- 校准
    view.appendChild(fold('实测校准', '看界面上的残差', [
      para('每个实测点记下：太阳视高度角、实测 EV100、哪个机位、哪天。可以直接填 EV100，也可以填光圈、快门、ISO 换算：'),
      formula(['EV100 = log₂(N² ÷ t) − log₂(ISO ÷ 100)']),
      para('拟合 <b>实测 ≈ a × 模型 + b</b>（最小二乘）。斜率 a 夹在 0.5 到 2.0 之间，免得点少时跑飞。取哪些点：'),
      A.h('ol', null, [
        '这个机位 ≥ ' + E.MIN_FOR_SLOPE + ' 个点 → 用本机位的点拟合斜率和偏移',
        '否则全部机位 ≥ ' + E.MIN_FOR_SLOPE + ' 个点 → 用全部的点拟合',
        '否则这个机位有点 → 只修正偏移（a = 1）',
        '否则别的机位有点 → 只修正偏移',
        '都没有 → 通用模型'
      ].map(function (t) { return A.h('li', { text: t }); })),
      para('时间轴上方会写「通用模型」或「已用 N 个实测点校准」，以及拟合残差的均方根——' +
           '这就是校准后在这些点上的平均误差。'),
      para('点少、或者所有点都挤在同一个高度角附近时，拿去推别的高度角不可靠。最好在窗口开头、中间、结尾各测一次。')
    ]));

    // ---------------------------------------------------------- 色温
    view.appendChild(fold('色温', '只能看趋势', [
      para('以太阳视高度角为自变量，在下面几个锚点之间线性插值：'),
      A.h('div', { class: 'card tight doc-inner' }, table(['太阳视高度角', '色温'],
        E.CCT_ANCHORS.map(function (a) { return [sgn(a[0]) + '°', a[1] + ' K']; }), 'data')),
      list([
        '只在 0° 及以下有效。0° 以上显示为 ' + E.CCT_ANCHORS[0][1] + ' K 并调暗，表示超出模型范围——' +
          '不能沿日落后的斜率往上推，太阳升高时的趋势是反的。',
        '精度很粗。天空不同方向的色温差很多（西边的余晖和东边的天顶能差几千 K），云和城市灯光也会拉低。' +
          '只能当趋势看，白平衡以现场为准。'
      ])
    ]));

    // ---------------------------------------------------------- 补光
    view.appendChild(fold('补光交叉点', '环境 EV 差 1 档 ≈ ' + rng(CLAIMS.minutesPerEV, ' 分钟'), [
      para('灯在某个距离上的照度换成 EV100（入射式测光常数 C = 250），再按距离的平方反比换算：'),
      formula([
        'EV100 = log₂(lux ÷ 2.5)',
        'E₂ = E₁ × (d₁ ÷ d₂)²'
      ]),
      para('环境 EV100 降到和灯一样的那一刻就是交叉点（相邻两分钟之间线性插值），表里标在那一分钟上。'),
      sub('精度'),
      list([
        '灯的照度按你填的数。厂商数据通常是某个色温、某个配件下的值，和实际用法不一定一样。',
        '平方反比只在距离远大于灯体尺寸时成立；管灯、柔光箱近距离用会偏。',
        '环境 EV 的误差会传过来：窗口里环境光每分钟暗 ' + rng(CLAIMS.evPerMinute, ' 档') + '，' +
          '环境 EV 差 1 档，交叉时刻就差 ' + rng(CLAIMS.minutesPerEV, ' 分钟') + '。'
      ])
    ]));

    // ---------------------------------------------------------- 拍摄量
    view.appendChild(fold('拍摄量核算', '经验值', [
      formula(['每个 setup 分钟数 = 窗口分钟数 ÷ setup 数']),
      para('少于 <b>' + TL.MIN_PER_SETUP + '</b> 分钟就提示，并给出最多排几个、建议砍几个。' +
           TL.MIN_PER_SETUP + ' 分钟是经验值（换机位、构图、对焦、拍一两条），不是算出来的。')
    ]));

    // ---------------------------------------------------------- 云量
    view.appendChild(fold('七天云量', '1–2 天较可信', [
      para('数据来自 Open-Meteo 天气预报接口（由它自动选预报模型）：逐小时的低云、中云、高云覆盖率，降水概率，2 米气温。'),
      list([
        '每个整点的值代表从这个整点开始的一小时，按它和蓝调窗口<b>重叠的时长</b>加权平均。' +
          '窗口只有四十来分钟，常常横跨两个整点，直接取整点值会偏。',
        '结论只看低云：低于 <b>' + CL.LOW_GOOD + '%</b> 为「好」，' + CL.LOW_GOOD + '–' + CL.LOW_MAYBE +
          '% 为「可能」，高于 ' + CL.LOW_MAYBE + '% 为「不建议」。高云 ≥ ' + CL.HIGH_TEXTURE +
          '% 时提示「高云可能增加天空层次」。三层云分开列，不合成一个分数。',
        '半小时内重复打开用缓存；没网时显示上次的数据和拉取时间。'
      ]),
      sub('精度'),
      list([
        '云量是数值预报里最难报准的量之一。一两天内比较可信，三天以后只能看趋势。',
        '预报格点从几公里到十几公里不等，海边的低云、雾和局地的阵雨常常报不准。'
      ])
    ]));

    // ---------------------------------------------------------- 数据
    view.appendChild(fold('数据与隐私', '只存在这台手机上', [
      list([
        '记录、照片、设置、实测点、天气缓存都存在这台手机的浏览器存储里（IndexedDB）。没有账号，没有服务器，不做统计。',
        '唯一的联网是七天云量：向 Open-Meteo 发一次请求，带上记录的经纬度（保留 4 位小数，约 10 米）。' +
          '其他功能断网可用。',
        '相机画面只在屏幕上预览，不录制、不保存、不上传。参考照片只存在本机，导出的 JSON 里没有照片。',
        '定位、罗盘、相机的权限都只在你点对应按钮时才申请。',
        '清除 Safari 的网站数据、或者删掉主屏幕上的图标，数据会一起没掉。重要的记录定期导出 JSON。'
      ])
    ]));

    // ---------------------------------------------------------- 测试页
    view.appendChild(A.h('div', { class: 'nav-list', style: 'margin-top:18px' }, [
      A.h('a', {
        class: 'nav-row', href: 'test.html', target: '_blank', rel: 'noopener'
      }, [
        A.h('span', { class: 'body' }, [
          A.h('span', { class: 't', text: '测试页' }),
          A.h('span', { class: 's', text: '上面「测得」的数都来自这里，可以看逐条比对' })
        ]),
        A.h('span', { class: 'chev', text: '›' })
      ])
    ]));
  }

  return {
    sectionFor: sectionFor,
    renderGuide: renderGuide,
    renderStatement: renderStatement,
    GUIDE: GUIDE,
    CLAIMS: CLAIMS
  };
});
