# 蓝调勘景仪 Blue Hour Scout

给短片拍摄用的蓝调时刻勘景工具。纯前端，无框架、无构建步骤、无后端。
在 iPhone 上通过「添加到主屏幕」当 App 用。

主要使用场景：Blackmagic Pyxis 6K，悉尼。

---

## 当前进度

本项目分阶段交付。**第一阶段（太阳位置算法 + 单元测试）已完成。**

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 一 | 太阳位置算法、时区工具、单元测试 | 已完成 |
| 二 | 勘景记录、地平线遮挡剖面采样、罗盘、PWA 离线外壳 | 已完成 |
| 三 | 分钟级光线时间轴、曝光/色温模型、校准、补光交叉点 | 待做 |
| 四 | 七天云量决策表、项目设置页 | 待做 |

现在已经可以装到 iPhone 主屏幕、到现场采集勘景记录和天际线剖面了。

---

## 目前的文件结构

```
.
├── index.html                应用入口
├── test.html                 算法测试页，浏览器直接打开就能跑
├── manifest.webmanifest      PWA 清单
├── sw.js                     Service Worker，断网时除天气外全部可用
├── css/
│   └── app.css               深色主题
├── icons/                    180 / 192 / 512 图标
├── js/
│   ├── core/                 纯计算，无 DOM、无依赖、可单测
│   │   ├── solar.js          NOAA 太阳位置算法（本地实现，不联网）
│   │   ├── tz.js             IANA 时区工具（只用浏览器内置 Intl）
│   │   └── horizon.js        地平线剖面：插值、遮挡判定、缺口归并
│   ├── data/
│   │   ├── db.js             IndexedDB 封装
│   │   └── records.js        勘景记录模型、读写、导出导入
│   ├── ui/
│   │   ├── app.js            DOM 工具、哈希路由、吐司、底部抽屉
│   │   ├── compass.js        方向传感器 → 方位角 + 仰角（iOS 的坑都在这里）
│   │   ├── horizon-ui.js     剖面采集界面：罗盘玫瑰、展开图、36 格手填
│   │   └── scout.js          记录列表与编辑页
│   └── test/
│       ├── harness.js        极简测试框架
│       ├── solar.test.js     太阳算法与时区
│       ├── horizon.test.js   剖面插值与遮挡判定
│       ├── compass.test.js   罗盘瞄准几何
│       └── ui-geometry.test.js  图形布局的几何约束
├── .claude/launch.json       本地静态服务配置（开发用）
└── README.md
```

测试目前共 **404 条断言**，覆盖太阳位置、时区、剖面、罗盘几何、界面几何五块。

---

## 跑测试

### 方式一：直接打开（最快）

用浏览器打开 `test.html` 即可，结果会立刻显示在页面上。

项目刻意使用**经典 `<script>` 标签 + 全局命名空间**，而不是 ES modules，
就是为了让 `file://` 直接打开也能工作（ES modules 在 `file://` 下会被 CORS 拦掉）。

注意：Safari 对 `file://` 的子资源策略比 Chrome 严格，如果页面空白就改用方式二。
另外 Geolocation 和 DeviceOrientation 无论如何都需要 HTTPS，`file://` 下拿不到，
但测试页不需要这两样。

### 方式二：本地静态服务

```bash
cd "/Users/gongzihan/Iphone Tool" && python3 -m http.server 8765 --bind 127.0.0.1
```

然后打开 <http://localhost:8765/test.html>。

### 方式三：命令行（不开浏览器）

macOS 自带 JavaScriptCore，可以直接跑，不需要装 Node：

```bash
cd "/Users/gongzihan/Iphone Tool" && cat js/core/*.js js/ui/compass.js js/ui/app.js js/ui/horizon-ui.js js/test/harness.js js/test/*.test.js > /tmp/bh-tests.js && echo 'BH.Test.textReport(BH.Test.run());' >> /tmp/bh-tests.js && osascript -l JavaScript /tmp/bh-tests.js
```

用通配符是为了以后加了新的 `*.test.js` 不用改这条命令。

---

## 在电脑上测罗盘（模拟器）

Mac 没有磁力计，罗盘的**真值**只能在手机上验。但采样**交互**——自动落点、
停留进度、扇区填充、转多快才跟得上——完全可以在电脑上先跑一遍，
所以项目里内置了一个罗盘模拟器。

**网址后面加 `?sim=1` 就出现**，平时完全不干活：

```
http://localhost:8765/index.html?sim=1
```

屏幕下方会出现一个红标的「罗盘模拟器」面板：

- 两个滑块分别是方位角和仰角，拖动就相当于转动/俯仰手机
- **「自动扫一圈」**按一条假天际线（西边一排高楼、东边开阔）自动转，
  转速可选 6 / 12 / 25 / 45 度每秒
- 读数带 ±0.8° 的抖动，顺带把平滑和中位数那条路径也跑到

它直接往 window 派发合成的 `deviceorientation` 事件，`compass.js` 一行都没改——
收到的和真机上一模一样，连权限流程都会走一遍（模拟器会把 `requestPermission()`
短路成 granted，这样电脑上点「启用罗盘」也能走通）。

这个模拟器上线后抓到了三个真问题：转速超过 18°/秒 一个扇区都采不到而且
界面不解释、连续落点会把防抖存盘无限推迟导致中途锁屏全丢、以及转太快时
缺少提示。现在这三条都修了，也都可以用模拟器复现验证。

去掉网址里的 `?sim=1` 即可关闭。

---

## 功能一：勘景记录

到现场新建一条记录，存下：GPS 坐标、机位朝向方位角、**地平线遮挡剖面**、
一张参考照片、地点名称和备注。记录可查看、编辑、删除，可导出为 JSON。

数据全部存在本机 IndexedDB，照片以 Blob 单独存放。导出的 JSON 不含照片
（体积会失控），导出文件里用 `hasPhoto` 标明原记录有照片。

### 地平线遮挡剖面怎么采

这是整个工具最关键的一步——它决定真正的日落时刻，和天文日落往往差十几分钟。

**竖着举起手机，像拍照一样用背面（后摄）对准天际线，然后原地缓慢转一圈。**

瞄准轴定义成设备的 −z 轴（后摄朝向），这么定有两个好处：手机立起来
（beta≈90°）时瞄的正好是水平方向，姿势自然；而且瞄准轴固定在机身上，
横握竖握都对，不需要做屏幕方向补偿。仰角由完整的旋转矩阵算出：

```
仰角 = asin( −cos(beta) · cos(gamma) )
```

这个式子与 alpha 无关，所以就算方位角拿不到（没有磁力计），俯仰依然准确；
`gamma` 项让手机歪一点也不影响读数。

每 10° 一个扇区，共 36 个。在一个方向停住约半秒就自动记下该方向的仰角，
罗盘图上对应的扇区会亮起来，中间的圆环显示停留进度。界面上随时显示
已采样扇区数和**还缺哪些角度区间**（跨 0° 的缺口会合并成一段，不会被切开）。

采到的值**自动存盘**，转到一半退出也不会丢。

罗盘不可用时（权限被拒、没有磁力计、非 HTTPS）会退化成 36 格手动输入，
功能不缺；也可以一键「全部设为 0°」当平地处理。任何时候都能点格子手改单个扇区。

### 罗盘校正

记录里有一个「罗盘校正」字段，默认 0，会加到罗盘读数上。

iOS 的 `webkitCompassHeading` 给的是真北，通常填 0 就行。安卓等平台通过
`deviceorientationabsolute` 拿到的多半是**磁北**，悉尼磁偏角约 +12.7°E，
差这么多会让遮挡判定整体偏掉。也可以对着已知方向的建筑物标定一下再填差值。

---

## 太阳位置算法

`js/core/solar.js` 是 NOAA Global Monitoring Laboratory Solar Calculator
所用天文公式的本地实现（底层出处是 Jean Meeus《Astronomical Algorithms》第 2 版）。
**完全本地计算，不调任何接口**，断网可用。

### 接口约定

- 所有对外的时刻都是 **UTC epoch 毫秒**，时区只在界面层出现
- `altitude` = 几何高度角（日面中心，不含大气折射）
- `apparentAltitude` = 视高度角（含折射修正）——肉眼和手机测到的是这个
- `azimuth` = 真北起算、顺时针为正，0–360

```js
BH.Solar.position(ms, lat, lon)
  // → { altitude, apparentAltitude, azimuth, declination,
  //     hourAngle, equationOfTime, julianDay, ms }

BH.Solar.events(refMs, lat, lon)
  // refMs 传该日当地正午附近的任意时刻
  // → { solarNoon, sunrise, sunset, civilDawn, civilDusk,
  //     nauticalDawn, nauticalDusk, astronomicalDawn, astronomicalDusk }
  //   极昼极夜时相应字段为 null

BH.Solar.altitudeCrossing(refMs, lat, lon, targetAlt, rising)
  // 求任意高度角的穿越时刻，蓝调区间上下界就靠它
```

日出日落用 NOAA 的 90.833° 天顶角约定（几何高度角 −0.833°）；
各级暮光用几何高度角 −6 / −12 / −18°，与各国天文台公布值口径一致。

求根方式：先用时角公式给初值，再对几何高度角做牛顿迭代（中心差分求导），
收敛到毫秒级。比 NOAA 自己只迭代一趟的做法更准。

### 精度实测

对比 [NOAA Solar Calculator](https://gml.noaa.gov/grad/solcalc/) 公布的悉尼
（−33.8688 / 151.2093，Australia/Sydney）逐日表，选取 2025–2026 跨越四季、
两个二至、两个二分、以及**夏令时起止当天**共 16 个日期：

| 量 | 最大偏差 | 要求 |
| --- | --- | --- |
| 日出 | 29 秒 | < 60 秒 |
| 日落 | 25 秒 | < 60 秒 |
| 太阳正午 | 14 秒 | < 30 秒 |

日出日落的 16 个值**四舍五入到分钟后与 NOAA 公布值逐一相同**，
不只是落在容差内——NOAA 公布值本身就是取整到分钟的，这是能做的最严比对。

太阳正午那 14 秒不是本实现的误差。NOAA 该列的时差只迭代一趟、
取值时刻比真正的正午早约半天，在时差变化最快的十二月底会差十几秒。

交叉参考 [Geoscience Australia](https://geodesyapps.ga.gov.au/sunrise)
（GA 只接受度+整分坐标，实际用 −33°52′ / +151°12′），6 个日期 ×
日出/日落/民用晨昏/航海晨昏/中天共 42 项：偏差落在 **−2 到 +56 秒**，
且几乎全为正。这正是 GA 把秒数**截断**（而非四舍五入）到分钟的特征——
扣掉截断后，两套独立算法的实际一致性在**几秒量级**。

GA 与 NOAA 之间本身就有约 1 分钟的差异（例如 2026-06-21 日落
GA 16:53 / NOAA 16:54），因为两者用的不是同一套算法。本项目以 NOAA 为主基准。

### 一个要记住的坑

NOAA 自身有一处不自洽：日出日落用的 `90.833°` 天顶角隐含地平折射 34′（0.567°），
但它的 `calcRefraction()` 在地平线只给 0.482°。两者差 0.085°。

结果是：**日落那一刻的视高度角是 −0.436°，不是 0.000°**。
折算成时间在悉尼约 25 秒。界面上一律显示视高度角，不要把日落当成 0 度。
这条已经固化成断言写在测试里了。

---

## 时区

`js/core/tz.js` 只用浏览器内置的 `Intl` API，不引入任何时区库。
每条勘景记录会存一个 IANA 时区名（默认取设备时区），
这样人在国外也能正确规划悉尼的拍摄，夏令时切换由 `Intl` 处理。

测试覆盖了悉尼夏令时的起止两天（2026-04-05 当天 25 小时、
2026-10-04 当天 23 小时）、本地时刻往返转换、以及夏令时跳变缺口内
（2026-10-04 02:30，不存在）和重复区间内（2026-04-05 02:30，出现两次）的时刻。

---

## iOS 上的几个坑（都已在代码里处理）

1. **必须 HTTPS。** Geolocation 和 DeviceOrientation 在 iOS 上都要求安全上下文，
   而且 `localhost` 不算数——这一点和桌面浏览器不同。见下一节。
2. **iOS 13+ 必须先调 `DeviceOrientationEvent.requestPermission()`**，而且
   **只能在用户手势的同步回调里**调，页面加载时调会抛 `NotAllowedError` 或者
   静默失败。所以界面上有一个明确的「启用罗盘」按钮，`js/ui/compass.js`
   只暴露 `request()`，由那个按钮触发。
3. **真北方位角在 `event.webkitCompassHeading`，不在 `alpha`。**
   iOS 的 `alpha` 是相对起始姿态的，当罗盘用会错得离谱。
   安卓路径走 `deviceorientationabsolute`，并且只认 `absolute === true` 的事件。
4. **权限被拒绝有完整降级路径**：剖面页退化成 36 格手动输入，
   机位朝向可以直接键入，功能不缺。状态提示会说清楚是哪种情况、怎么恢复。
5. **从主屏幕启动的实例和 Safari 里的实例，存储不共通**，权限也要各自授权一次。
6. **未安装到主屏幕的站点，Safari 有 7 天未访问清除本地存储的策略。**
   添加到主屏幕之后不受这条影响。重要记录建议定期导出 JSON 备份。
7. 输入框字号统一 16px，否则 iOS Safari 聚焦时会自动放大页面。

---

## 本地 HTTPS 调试

iOS 上 Geolocation 和 DeviceOrientation **必须 HTTPS**，`localhost` 不算数
（这一点和桌面浏览器不同，桌面把 localhost 当安全上下文，iOS Safari 不）。
所以要在 iPhone 上调罗盘和定位，只有两条路。

### 路线 A：直接推 GitHub Pages 测（推荐）

改完就 push，一分钟后在 iPhone 上刷新。省掉证书那一堆事，
也最接近最终运行环境。手机不用和电脑在同一个网络，用蜂窝数据也行。
日常迭代建议走这条。具体命令见下面「部署到 GitHub Pages」一节。

**在 iPhone 上要验的四件事：**

1. 打开站点 → 新建一条记录 → 点「一键获取当前位置」。
   应该弹出定位授权，允许后填入坐标并显示精度（室外通常 ±5–20 m）。
2. 进「采集地平线剖面」→ 点**「启用罗盘」**。
   应该弹出 iOS 的「允许访问运动与方向」对话框。
   这一步如果没弹窗、也没反应，八成是没走 HTTPS。
3. 竖着举手机，用**背面**对准前方，左右转一下：
   罗盘图中间的大数字应该跟着变，指针跟着转。
   把手机往上抬，仰角应该变正；往下压，变负。
   **对着一个已知方向验一下**（比如正对某条南北向的街），
   读数不对就说明要填「罗盘校正」。
4. 原地**缓慢**转一圈，每个方向停半秒左右。
   扇区会一个个亮起来，转完 36/36。转太快会提示「转慢一点」。

第 3 步是关键：如果读数比真实方向偏了十几度，多半是拿到了磁北而不是真北，
在记录页的「罗盘校正」里填差值（悉尼磁偏角约 +12.7°E）。

### 路线 B：mkcert 自签证书（离线时用）

```bash
brew install mkcert nss && mkcert -install
```

签一张把 Mac 局域网 IP 也包进去的证书。这台机器当前的 Wi-Fi 地址是
**192.168.55.172**（换网络后用 `ipconfig getifaddr en0` 重新查）：

```bash
cd "/Users/gongzihan/Iphone Tool" && mkcert localhost 127.0.0.1 ::1 192.168.55.172
```

起 HTTPS 服务（文件名按上一步实际生成的改）：

```bash
cd "/Users/gongzihan/Iphone Tool" && python3 -c "import http.server,ssl;c=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);c.load_cert_chain('localhost+3.pem','localhost+3-key.pem');s=http.server.ThreadingHTTPServer(('0.0.0.0',8443),http.server.SimpleHTTPRequestHandler);s.socket=c.wrap_socket(s.socket,server_side=True);print('https://192.168.55.172:8443');s.serve_forever()"
```

**iPhone 还要信任 mkcert 的根证书**，这一步最容易漏：

1. `mkcert -CAROOT` 查到根证书目录，把里面的 `rootCA.pem` AirDrop 到 iPhone
2. iPhone：设置 → 通用 → VPN 与设备管理 → 安装那个描述文件
3. iPhone：设置 → 通用 → 关于本机 → 证书信任设置 → 把 mkcert 那一项**打开**

第 3 步不做的话 Safari 仍然会报证书错误。

做完之后 iPhone 用 `https://192.168.55.172:8443` 访问，手机要和 Mac 连同一个 Wi-Fi。

---

## 已部署地址

**https://olibainctrl.github.io/bluehour-scout/**

仓库：https://github.com/olibainctrl/bluehour-scout （public，免费账户的 Pages
只支持 public 仓库）。勘景记录和照片都存在手机本地的 IndexedDB 里，
不会进仓库，所以公开的只有代码本身。

日常迭代：

```bash
cd "/Users/gongzihan/Iphone Tool" && git add -A && git commit -m "改了什么" && git push
```

push 之后一两分钟自动重新发布。手机上刷新时如果还是旧版，
底部会弹「有新版本 / 刷新」，点一下即可。

---

## 部署到 GitHub Pages（从零开始的话）

仓库还没初始化 git，第一次这样做：

```bash
cd "/Users/gongzihan/Iphone Tool" && git init && git add -A && git commit -m "蓝调勘景仪：太阳位置算法与单元测试"
```

在 GitHub 上建仓库并推送。**注意：免费账户的 Pages 只支持 public 仓库**，
private 仓库开 Pages 会返回
`Your current plan does not support GitHub Pages for this repository (HTTP 422)`。
用 `gh` 的话一条命令就够：

```bash
cd "/Users/gongzihan/Iphone Tool" && gh repo create <仓库名> --public --source=. --remote=origin --push
```

再开 Pages（也可以在仓库页面 **Settings → Pages → Source 选
"Deploy from a branch" → Branch 选 `main`、目录 `/ (root)`**）：

```bash
gh api -X POST repos/<用户名>/<仓库名>/pages -f 'source[branch]=main' -f 'source[path]=/'
```

一两分钟后站点在 `https://<用户名>.github.io/<仓库名>/`。
因为是子路径部署，项目里所有路径（包括 Service Worker 的缓存清单和
manifest 的 `start_url`/`scope`）都写成相对路径，不用改任何配置。

之后每次 `git push` 自动重新发布。

---

## iPhone 添加到主屏幕

1. 用 **Safari** 打开 <https://olibainctrl.github.io/bluehour-scout/>
   （必须是 Safari，Chrome 的「添加到主屏幕」不走 PWA 那一套）
2. 点底部中间的**分享**按钮（方框带向上箭头）
3. 下滑找到**「添加到主屏幕」**
4. 改个名字，点**添加**

之后从主屏幕图标启动，会以独立窗口运行，没有 Safari 的地址栏和工具栏。

几个注意事项：

- 罗盘权限要在**用户点击**里申请，所以界面上有一个明确的「启用罗盘」按钮，
  页面加载时自动申请会静默失败
- 权限是按站点记的，换域名要重新授权
- 从主屏幕启动的实例和 Safari 里的实例，存储是不共通的
- Service Worker 的缓存策略是「先给缓存、后台更新」，所以 push 新版本之后
  这一次打开拿到的还是旧的。新版本装好时页面底部会弹一条「有新版本 / 刷新」，
  点刷新即可立刻切过去
