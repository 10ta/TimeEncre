# TimeEncre

单用户的时间记录 Web App，参考 A Time Logger 2。纯静态站点，数据存在浏览器本地（IndexedDB），
可同步到你自己的**私有** GitHub 数据仓库的 `TimeEncre/` 目录。

## 当前进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| P1 | 数据结构与迁移、本地存储、计时页、类型与标签、ATL2 导入、JSON 备份 | ✅ |
| P2 | GitHub 数据仓库同步 | ✅ |
| P3 | 历史页（浏览、搜索、逐段编辑、补录、空白时段） | ✅ |
| P4 | 统计（环形图、未记录时间、按标签、每日分布、时间轴）、目标 | ✅ |
| P5 | 番茄钟（自动记录、后台精确结算）、PWA（安装、离线、更新提示）、通知 | ✅ |

## 本地运行

```bash
npm install
npm run dev      # 开发
npm test         # 单元测试
npm run build    # 产物在 dist/
```

## 部署

纯静态站点：没有后端、没有环境变量，数据在浏览器和你的私有数据仓库里。同一份代码可以同时部署到
Vercel 和 Cloudflare Pages（以及 GitHub Pages、自己的服务器），每次 push 到 `main` 都会自动重新部署。
Node 版本固定为 22（`.node-version` 和 `package.json` 的 `engines`，两个平台都会读取）。

> ⚠️ **授权影响先说在前面**：连接 GitHub 时，Vercel 和 Cloudflare 会请求安装它们的 GitHub App。
> 在授权页选择 **Only select repositories**，只勾选这个**代码仓库**。**不要**把私有数据仓库授权给它们——
> 部署用不到数据仓库，授权了就等于让第三方平台也能读取你的私密数据。

### Vercel

1. 登录 [vercel.com](https://vercel.com)，用 GitHub 账号登录即可。
2. **Add New… → Project**，在 *Import Git Repository* 里找到本仓库，点 **Import**。
   第一次会要求安装 Vercel 的 GitHub App，按上面的提示只授权这个仓库。
3. 配置页：
   - **Framework Preset**：Vite（一般会自动识别）
   - **Build Command**：`npm run build`
   - **Output Directory**：`dist`
   - **Install Command**：`npm install`
   - 环境变量：不需要
4. 点 **Deploy**，一两分钟后得到 `xxx.vercel.app` 地址。
5. 可选：**Settings → Domains** 绑定自己的域名。`*.vercel.app` 在中国大陆访问不稳定，建议绑定。

### Cloudflare Pages

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com)，进入 **Workers & Pages**。
2. **Create**（创建）→ 选 **Pages** 标签 → **Connect to Git**（导入现有 Git 仓库）。
   第一次会要求安装 Cloudflare 的 GitHub App，同样只授权这个仓库。
3. 选中本仓库 → **Begin setup**，填写：
   - **Project name**：随意，会成为 `项目名.pages.dev`
   - **Production branch**：`main`
   - **Framework preset**：选 Vite / React (Vite)，或选 None 后手动填下面两项
   - **Build command**：`npm run build`
   - **Build output directory**：`dist`
   - 环境变量：不需要（如果构建日志显示 Node 版本低于 22，加一个 `NODE_VERSION` = `22`）
4. **Save and Deploy**。
5. 可选：项目的 **Custom domains** 绑定自己的域名（域名托管在 Cloudflare 时会自动配置 DNS）。

### 部署之后

- 两个平台都会为其他分支和 Pull Request 生成预览地址，这些地址是公开的，但和正式站点一样只是空壳。
- **每个域名的浏览器存储是独立的**：在 Vercel 地址和 Cloudflare 地址上，各需要在设置里连接一次 GitHub 数据仓库，
  之后两边通过仓库同步。新设备上首次打开选“从 GitHub 数据仓库恢复”。
- 需要 HTTPS 的功能（安装为 App、离线、手机通知）在这两个平台上都直接可用。
- 用 hash 路由（`#/history` 这类地址），不需要配置任何重写规则。

### 其他方式

- **GitHub Pages**：构建后发布 `dist/`，`base: './'` 支持任意子路径。
- **自己的服务器**：只需托管 `dist/` 静态文件。Caddy 示例（子路径）：

```
example.com {
    handle_path /timeencre/* {
        root * /srv/timeencre/dist
        file_server
    }
}
```

通过 http 局域网地址访问时，计时、统计、同步照常可用，但浏览器不允许安装为 App、离线缓存和手机通知。

## 数据格式

全部是 JSON。时间为带时区的 ISO 8601，id 为 UUIDv7，颜色为 `#rrggbb`，时长不存储、由区间计算。
每个文件都有 `schemaVersion`，读取时经 `src/schema/index.ts` 的迁移链升级到当前版本；
遇到比程序新的版本会拒绝写入。结构定义见 `src/schema/v1.ts`。

数据仓库中的布局：

```
TimeEncre/
  profile.json            类型、标签、目标、设置
  records/2026-10.json    按记录开始月份分文件
```

## 连接 GitHub 数据仓库

1. 建一个**私有**仓库（公开仓库会被拒绝）。可以和其他 app 共用，TimeEncre 只读写其中的数据目录（默认 `TimeEncre/`）。
2. 生成 **fine-grained personal access token**：Repository access 只选这个仓库，Permissions 只开
   `Contents: Read and write`，设置过期时间。不要用 classic token。
3. 打开 app → 设置 → GitHub 同步，填仓库（`owner/repo` 或完整网址）和令牌，点“检查并保存”。
4. 新设备：首次打开选“从 GitHub 数据仓库恢复”，连接同一个仓库后点“立即同步”。
   **不要**先选“用一套常用类型”，否则会和仓库里的类型并存成两套。

⚠️ fine-grained token 只能限定到仓库、不能限定到目录：仓库里其他 app 的私密数据，这个 token 同样能读写。
token 保存在各设备浏览器本地（IndexedDB），不会随备份导出；“清空本地数据”会保留它。

**同步怎么工作**：拉取自上次同步以来远端变化过的文件，按每条数据的 `updatedAt` 合并（较新者胜出，删除以墓碑形式传播），
再把与远端不同的本地文件打成一个提交推送。远端在此期间被其他设备或其他 app 更新时（非快进），自动重新合并并重试。
数据文件序列化是确定性的，所以没有改动就不会产生提交，GitHub 上的 diff 也可读。

## Pomo（番茄钟）

专注 / 短休 / 长休循环，可设置时长、几个番茄后长休、提示音和系统通知；
“专注结束后自动开始休息”和“休息结束后自动开始专注”是两个独立开关。

选择“专注时记录为”某个类型（可再选标签）后，每段专注会自动生成一条该类型、带这些标签的记录
（备注“🍅 番茄钟”），所以番茄时间会进入历史、统计和目标。番茄钟与这条记录双向联动：
在底部的进行中栏暂停、继续、停止它，Pomo 会跟着变。

状态按时间戳计算并保存在本机（不同步）。页面在后台或关闭期间到点，回来时按准确的结束时间结算。
所有 Pomo 操作串行执行（支持 Web Locks 的浏览器上跨标签页也互斥），不会因为多处同时结算而重复建记录。
如果发现有“🍅 番茄钟”记录在计时却没关联到当前的 Pomo（旧版本留下的、或来自另一台设备），Pomo 页会提示，可一键接管或停止。

## 目录结构

```
src/
  schema/      数据结构（zod）与版本迁移
  db/          IndexedDB（Dexie）、写操作、查询 hooks
  io/          JSON 备份导入导出、A Time Logger 2 导入
  sync/        GitHub 同步（API 封装、文件序列化、同步引擎、界面）
  pomodoro/    番茄钟状态机、持久化、后台运行器
  lib/         时间、id 工具
  ui/          通用组件
  features/    各页面（records/ 记录编辑器，shared/ 日周月导航）
tests/         单元测试（含 ATL2 备份样本、内存版 GitHub 模拟）
```

## 界面约定

- 进行中的计时统一显示在屏幕底部的悬浮栏，不占页面布局；点一项在其上方弹出编辑面板。
- 历史、目标、类型页的条目点一下在原地展开编辑，改动即时保存，可“撤销修改”；点空白处收起。
- 新建（补录、新建目标 / 活动 / 标签）需要点“添加”。补录默认填“最近一段记录结束之后”的空白。
- 历史的日 / 周可切换为日历视图（24 小时竖向时间轴）：活动是色块，未记录的空档是斜纹块；
  点空档可“延长上一段”“提前下一段”或记录为某个活动。统计页的“未记录”可一键跳到这些空档。

## 多语言

界面支持中文和法语（设置 → 语言）。语言只保存在当前设备，切换后页面会刷新。活动名、标签、备注是你自己的数据，切换语言不会改动它们；只有新建默认活动时按当时的语言命名。

开发约定：
- 界面文字一律写成 `tr('中文原文')`，参数用 `{0}`、`{1}`：`tr('已记录 {0}', formatHm(ms))`。整句写进一个 `tr`，不要把句子拆成碎片拼接（语序在法语里会不同）。
- 同一个中文词在不同语境需要不同译法时，键写成 `原文|语境`，例如 `tr('活动|字段')`；中文界面只显示竖线前的部分。
- 法语译文放在 `src/i18n/fr.ts`；日期格式在 `src/i18n/dates.ts`。
- `tests/i18n.test.ts` 会扫描全部源码：有中文没经过 `tr()`、法语词典缺键或有多余的键、占位符数量不一致，测试都会失败。
