# Jenkins Pipeline Batch Trigger

VSCode 扩展：批量触发 Jenkins Pipeline，实时监控构建状态，支持 Pre/Post Action 自动化引擎。

## 功能概览

| 功能 | 说明 |
|------|------|
| 批量触发 | 勾选多个 Pipeline，一键触发，支持全局参数 + 每 job 独立参数 |
| 实时状态 | Running / Success / Failed / Unstable / Aborted 状态徽标，自动刷新默认开启（间隔 1 分钟，可调） |
| 批量中止 | 一键中止所有运行中的构建 |
| 侧边栏树 | 自定义文件夹/Job 树结构，复选框批量选择，状态感知图标 |
| Pre/Post Actions | 触发前注入参数、完成后提取日志写回状态，实现跨运行闭环 |
| 构建轮询 | 单定时器 + 指数退避，自动检测构建完成并执行 Post-Actions |
| 参数模板 | 保存/复用参数组合，支持分类管理与拖拽归类，快速切换不同环境配置 |
| 日志内容提取 | 按自定义正则/JS 脚本规则从选中 Pipeline 的构建日志批量提取内容，结果可复制/导出，可选回写参数 |
| 状态栏 | 底部显示运行/队列/失败计数，点击打开 Output Channel |

## 安装

### 从 VSIX 安装

```bash
code --install-extension jenkins-batch-trigger-1.0.0.vsix
```

### 从源码构建

```bash
git clone https://github.com/Amos666/jenkins-batch-trigger.git
cd jenkins-batch-trigger
npm install
npm run compile
# F5 启动扩展开发宿主，或：
npx @vscode/vsce package --no-dependencies
```

## 快速开始

### 第一步：配置 Jenkins 连接

1. 点击侧边栏 **Jenkins Batch** 图标打开扩展
2. 点击树视图标题栏的 **齿轮图标**（Configure Jenkins Connection）
3. 按提示输入：
   - Jenkins URL：`https://jenkins.example.com`（不带末尾斜杠）
   - 用户名：你的 Jenkins 登录名
   - API Token：在 Jenkins → 用户设置 → API Token 中生成
   - 信任自签名证书：内网 Jenkins 通常选「是」

> 配置保存在 VSCode 全局设置中，API Token 安全存储在 SecretStorage。

### 第二步：组织 Pipeline 树

1. 点击树视图标题栏的 **新建文件夹** 图标，创建分组（如「支付线」「每日发版」）
2. 右键文件夹 → **Add Job Nodes**，弹出 Job 选择面板
3. 在面板中搜索、勾选需要管理的 Pipeline，确认添加
4. 树结构保存在 globalState，跨 workspace 共享

### 第三步：批量触发

1. 在侧边栏树中勾选要触发的 Job（支持文件夹级联选择）
2. 中央面板自动显示已选 Job 列表（名称默认显示为 `上级目录/job名`，双击表头可切换层级）
3. 点击 **参数** 按钮设置触发参数（JSON 编辑器 + KV 快捷编辑）
4. 点击 **触发选中**，确认预览后批量触发
5. 状态列实时更新（自动刷新默认开启，间隔 1 分钟），构建链接可直接跳转 Jenkins 页面

## 使用详解

### 侧边栏树操作

| 操作 | 方式 |
|------|------|
| 新建文件夹 | 标题栏 📁 图标 / 右键文件夹 → New Subfolder |
| 添加 Job | 标题栏 + 图标 / 右键文件夹 → Add Job Nodes |
| 重命名 | 右键节点 → Rename |
| 删除 | 右键节点 → Delete（支持多选批量删除） |
| 刷新状态 | 右键文件夹 → Refresh Status |
| 切换显示名 | 双击 Job 节点循环：`名称` → `父目录/名称` → `祖父/父/名称` |
| 过滤 | 标题栏漏斗图标，按名称/路径过滤 |
| 启用 Actions | 右键 Job → Toggle Pre/Post Actions（出现 ⚡ 标记） |
| 配置 Actions | 右键已启用的 Job → Configure Actions |

### 中央面板操作技巧

| 功能 | 说明 |
|------|------|
| Pipeline 名称显示 | 默认显示 `上级目录/job名`；双击「流水线」表头循环切换：`仅 job 名` → `上级目录/job` → `上上级/上级/job` |
| 列宽调整 | 拖动表头右边缘调整列宽（拖动后不再自动适配宽度） |
| 自动刷新 | 默认开启、间隔 1 分钟，可勾选开关或从下拉框调整（5s / 10s / 30s / 1m / 3m / 5m）；只轮询非终态的 job，减少请求 |
| 活动日志 | 拖拽分隔条调整高度，点标题折叠/展开，支持导出到编辑器与清除 |
| 超时看守 | 工具栏 ⏱ 设置分钟数，超时自动中止对应 pipeline |

### 参数系统

**全局批量参数**：点击工具栏「参数」按钮，支持两种编辑模式：
- JSON 编辑器：直接编辑 `{ "BRANCH": "main", "ENV": "prod" }`
- KV 快捷编辑：逐行添加键值对

**每 Job 独立参数**：点击表格行的「✎ 参数」链接，为该 Job 设置专属参数（优先于全局参数）。

**参数模板**：配置好参数后点「＋ 存为模板」，下次点击模板芯片一键套用；「↻ 更新当前模板」把当前参数写回所选模板。

**模板分类**：
1. 在「参数」弹框点「＋ 新建分类」创建分类（如「生产环境」「测试环境」）
2. 把模板芯片拖到目标分类块内（或拖到该分类下的其他模板上）即完成归类
3. 拖回「未分类」块可取消归类；分类之间可任意拖拽调整
4. 点分类头部的 ✕ 删除分类，其中模板自动移回「未分类」
5. 按住分类头部（名称栏）上下拖动，可调整分类之间的显示顺序
6. 未创建分类时模板平铺显示，原有拖拽排序、套用、删除行为完全不变

**模板分类小案例**：参数模板越来越多，想按环境分组——「参数」弹框 →「＋ 新建分类」创建「生产环境」「测试环境」；把 `prod-full`、`prod-hotfix` 拖进「生产环境」，`test-smoke` 拖进「测试环境」；按住「测试环境」分类头部往上拖可让它排在前面。以后发版先展开对应分类，点一下模板芯片即可套用；误删分类也不怕，模板会自动回到「未分类」。

**Pipeline 显示层级小案例**：同时管理 `pay/order` 和 `trade/order` 两个同名 job 时，列表默认显示 `上级目录/job名`（`pay/order`、`trade/order`）可避免混淆；双击「流水线」表头还能切到三层显示 `上上级/上级/job`。

### 触发预览

点击「触发选中」后会弹出确认面板，显示每个 Job 实际使用的参数（全局 or 独立），确认后才真正触发。

### 日志内容提取

从当前选中 Pipeline 的构建日志（full log）中按自定义规则批量提取内容，适用于收集构建产物 ID、部署版本号、扫描报告链接等场景。

**入口**：工具栏「🔍 日志提取」按钮（需先在列表中选中至少一个 Pipeline）。

**提取规则**：
- 点「＋ 新建规则」创建规则，支持两种类型：
  - **正则表达式**：正则 + 取值策略（首个匹配 / 最后匹配（默认）/ 全部匹配）。含捕获组时取第 1 个分组的值，否则取整条匹配；按行匹配
  - **JS 脚本**（规则芯片上带 ƒ 标记）：沙箱执行（5 秒超时），可用变量 `log`（完整日志文本）和 `lines`（按行数组）。提取结果为赋给 `result` 的值，未赋值时取最后一个表达式的值；可返回字符串或字符串数组，返回空/undefined 视为未匹配
- 两种类型都可填可选的回写参数名
- 规则以芯片形式展示，点击选中/取消，✎ 编辑（名称不可改）、✕ 删除；规则全局保存复用

**JS 脚本示例**：

```js
// 提取最后一个 CHANGE_ID
const ms = [...log.matchAll(/CHANGE_ID=(\w+)/g)];
result = ms.length ? ms[ms.length - 1][1] : '';
```

```js
// 统计 ERROR 行并拼接前 3 条
const errs = lines.filter(l => l.includes('ERROR'));
errs.length ? errs.slice(0, 3) : null;
```

**使用流程**：
1. 目标无需再次选择——与批量触发一致，只提取表格中已勾选的 Pipeline（弹框内只读展示，无构建记录的自动跳过，构建中的会提示日志可能不完整），只需勾选要提取的规则（可多选）
2. 点「开始提取」，逐个拉取日志并应用所有选中规则，结果表格实时刷新，可随时「取消」
3. 完成后显示成功/未匹配/失败统计；「复制」得到 TSV 文本，「导出」写入新编辑器（默认 TSV 表格），「导出 JSON」得到结构化结果便于程序解析（含生成时间、规则列表、每个 pipeline 按规则名索引的取值）
4. 默认只查看和导出。如需回写参数：勾选「回写到参数」，预览每个 job×规则的键值后选择模式：
   - **每 job 专属参数**：结果写入各 Pipeline 的专属参数（多 Pipeline 值不同时推荐）
   - **全局批量参数**：结果合并进全局参数（同名键冲突时该模式自动禁用）
5. 点「回写到参数」二次确认后生效，下次触发即携带提取值

#### 完整案例：发版后收集部署版本与失败摘要

**场景**：3 个服务（`pay/order`、`pay/user`、`pay/gateway`）刚完成一轮构建，你需要收集每个服务部署的镜像 tag、变更 ID，并统计 ERROR 行数，为下一轮灰度触发做准备。

**第 1 步**：假设某个服务的构建日志（Console Output）包含：

```text
[Pipeline] Start of Pipeline
Building image registry.example.com/pay/order:v2.3.1
CHANGE_ID=chg-1001
Deploying to staging ...
ERROR: slow response from db (retry 1)
Deploy done, image=registry.example.com/pay/order:v2.3.1
[Pipeline] End of Pipeline
```

**第 2 步**：打开「🔍 日志提取」→「＋ 新建规则」，创建 3 条规则：

| 规则名 | 类型 | 配置 | 回写参数名 |
|--------|------|------|-----------|
| 镜像Tag | 正则 | `image=[^:]*:(v[\d.]+)`，策略：最后匹配 | `IMAGE_TAG` |
| 变更ID | 正则 | `CHANGE_ID=(\w[\w-]*)`，策略：最后匹配 | `CHANGE_ID` |
| 错误统计 | JS 脚本 | 见下方，无 result 赋值取末表达式 | 留空（仅查看） |

错误统计脚本：

```js
const errs = lines.filter(l => l.includes('ERROR'));
errs.length ? errs.length + ' 条' : '';
```

**第 3 步**：勾选 3 条规则，点「开始提取」（目标即列表中已勾选的 3 个 Pipeline，无需再选）。结果表格：

| Pipeline | # | 镜像Tag | 变更ID | 错误统计 |
|----------|---|---------|--------|----------|
| pay/order | #58 | v2.3.1 | chg-1001 | 1 条 |
| pay/user | #61 | v2.3.1 | chg-1002 | 未匹配 |
| pay/gateway | #33 | v2.2.9 | chg-0988 | 2 条 |

**第 4 步**：点「导出」把表格存到编辑器留档（点「导出 JSON」则得到如下结构化数据，方便脚本解析）：

```json
{
  "generated_at": "2026-08-22T09:30:00.000Z",
  "rules": [
    { "name": "镜像Tag", "kind": "regex", "strategy": "last", "targetKey": "IMAGE_TAG" },
    { "name": "错误统计", "kind": "script", "strategy": "last", "targetKey": "" }
  ],
  "pipelines": [
    { "pipeline": "pay/order", "jobPath": "pay/order", "buildNumber": 58,
      "values": { "镜像Tag": ["v2.3.1"], "变更ID": ["chg-1001"], "错误统计": ["1 条"] } }
  ]
}
```

如需把版本信息带给下一轮触发，勾选「回写到参数」：
- 各服务 tag 不同 → 选「每 job 专属参数」，预览确认后回写
- 回写后 `pay/order` 的专属参数变为 `{ "IMAGE_TAG": "v2.3.1", "CHANGE_ID": "chg-1001" }`，下次触发自动携带

**小技巧**：
- 正则拿不准时先在「JS 脚本」类型里用 `log.match(...)` 试错，稳定后再改回正则规则
- 脚本返回数组时单元格用逗号连接显示，完整内容悬停可见
- 脚本里 `console.log` 无效（无控制台输出），调试靠 `result` 返回值
- 规则是全局保存的，团队内常用规则建一次即可长期复用

## Pre/Post Action 系统

### 概念

Action 系统实现跨运行的参数闭环：

```
触发前 (Pre-Actions)          触发后 (Post-Actions)
┌─────────────────────┐      ┌─────────────────────┐
│ 从状态文件读取参数    │      │ 从构建日志提取参数    │
│ 注入到触发参数中      │ ──→  │ 写回状态文件         │
└─────────────────────┘      └─────────────────────┘
         ↑                            │
         └────────────────────────────┘
              下次触发自动使用
```

### 启用

1. 右键 Job 节点 → **Toggle Pre/Post Actions**（节点出现 ⚡ 图标）
2. 右键 → **Configure Actions** 打开配置面板

### 配置面板（4 个 Tab）

- **前置动作**：配置触发前执行的 Action 列表
- **后置动作**：配置构建完成后执行的 Action 列表
- **状态**：查看/编辑/重置每个 Pipeline 的状态文件
- **试运行**：输入模拟参数， dry-run Pre-Actions 查看渲染结果（不真正触发）

### 6 种 Action 类型

| 类型 | 用途 | 关键字段 |
|------|------|----------|
| `state_read` | 从状态文件读取值注入参数 | `key`（模板）, `target`, `on_missing` |
| `regex_extract` | 从构建日志正则提取值 | `pattern`, `target`（模板）, `strategy` |
| `template_render` | 渲染模板字符串 | `template`, `target` |
| `http_request` | 调用外部 API | `url`（模板）, `method`, `target` |
| `env_read` | 读取环境变量 | `var`, `target`, `on_missing` |
| `script` | 沙箱 JS 脚本（5s 超时） | `code`, `on_error` |

### 模板变量

所有字符串字段支持 `${...}` 模板语法：

```
表达式	说明
${trigger.params.X}	触发时传入的参数
${state.a.b}	state 存储的值
${pipeline_params.X}	pre-action 注入的参数（post-action 中为空）
${env.VAR}	环境变量
${pipeline.name}	pipeline 名称
${pipeline.jobPath}	pipeline 路径
${run.prev.id}	上次构建 ID
```

### 配置示例：滚动部署

场景：每次触发时自动传入上次构建的变更 ID，构建完成后从日志提取新的变更 ID 存回。

**Pre-Action（state_read）**：
```json
{
  "type": "state_read",
  "key": "chg_id.${trigger.params.param1}",
  "target": "pipeline_params.CHANGE_ID",
  "on_missing": "skip"
}
```

**Post-Action（regex_extract）**：
```json
{
  "type": "regex_extract",
  "source": "pipeline_logs",
  "pattern": "CHANGE_ID=(\\w+)",
  "target": "state.chg_id.${trigger.params.param1}",
  "strategy": "last",
  "on_no_match": "warn"
}
```

**效果**：
- 第 1 次触发：状态为空，`on_missing: skip` 跳过注入，正常触发
- 构建完成：从日志提取 `CHANGE_ID=abc123`，写入 `states/team-a__deploy.json`
- 第 2 次触发：自动读取 `chg_id.pr1` → 注入 `CHANGE_ID=abc123` 到触发参数

### 状态文件

存储在 `globalStorageUri/states/<pipelineId>.json`，格式：

```json
{
  "version": 1,
  "updated_at": "2025-01-15T10:30:00.000Z",
  "last_run_id": "team-a/deploy#142",
  "chg_id": {
    "pr1": "abc123",
    "pr2": "def456"
  }
}
```

### 错误处理

- **Pre-Action 失败**：跳过该 Pipeline 的触发，不影响其他 Pipeline
- **Post-Action 失败**：所有变更缓冲，全部成功才写入状态文件（原子提交）
- **轮询超时**：30 分钟未完成标记为 stale，停止监控
- **Script 超时**：5 秒强制终止

## 状态栏

底部状态栏显示两个指示器：

- **连接状态**：`$(server) Jenkins: jenkins.example.com` — 点击打开设置
- **运行状态**：
  - 空闲：`$(rocket) Pipeline: 就绪`
  - 运行中：`$(sync~spin) Pipeline: 2 运行 / 1 队列`
  - 有失败：`$(error) Pipeline: 1 失败`
  - 点击打开 Output Channel 查看详细日志

## Output Channel

所有 Action 执行日志和构建轮询日志输出到 **Pipeline Actions** Output Channel：
- 状态栏点击 → 自动打开
- 或 View → Output → 选择 "Pipeline Actions"

## 配置项

| 配置 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `jenkinsBatchTrigger.jenkinsUrl` | string | `""` | Jenkins 根 URL |
| `jenkinsBatchTrigger.username` | string | `""` | Jenkins 用户名 |
| `jenkinsBatchTrigger.trustSelfSignedCert` | boolean | `false` | 信任自签名证书 |
| `jenkinsBatchTrigger.actionsEnabled` | boolean | `true` | Action 系统总开关 |
| `jenkinsBatchTrigger.language` | string | `zh` | 界面语言（`zh` / `en`） |

> 自动刷新不是配置项：由面板工具栏的「自动刷新」复选框和间隔下拉框控制，默认开启、间隔 1 分钟。

## 数据存储

| 数据 | 位置 | 说明 |
|------|------|------|
| 树结构 + 选择 | VSCode globalState | 跨 workspace 共享 |
| 参数模板 + 模板分类 | VSCode globalState | 跨 workspace 共享 |
| 日志提取规则 | VSCode globalState | 跨 workspace 共享 |
| Action 配置 | `globalStorageUri/default-config.json` | 所有 Pipeline 共用 |
| Pipeline 状态 | `globalStorageUri/states/<id>.json` | 按 Pipeline 隔离 |
| API Token | VSCode SecretStorage | 加密存储 |

## 项目结构

```
src/
├── extension.ts          # 入口：命令注册、状态栏、OutputChannel
├── state.ts              # 核心状态管理：树、选择、触发、Action 集成
├── treeProvider.ts       # 侧边栏 TreeDataProvider
├── webviewProvider.ts    # 中央面板 Webview 消息桥接
├── webviewHtml.ts        # 中央面板 HTML 模板
├── jenkinsClient.ts      # Jenkins REST API 客户端
├── jobPickerPanel.ts     # Job 选择面板
├── globalStore.ts        # globalState 读写
├── types.ts              # 共享类型定义
├── actionTypes.ts        # Action 系统类型
├── actionStore.ts        # Action 文件存储（原子写）
├── actionEngine.ts       # Action 执行引擎（6 种动作）
├── actionsConfigPanel.ts # Action 配置 Webview 面板
└── buildPoller.ts        # 构建轮询器（单定时器 + 退避）
media/
└── webview-script.js     # 中央面板前端逻辑
```

## 常见问题

**Q: 触发后状态一直显示 Running？**
A: 检查 Jenkins 连接是否正常。自动刷新默认开启（1 分钟一次），也可在工具栏调整间隔或手动点刷新按钮。

**Q: Pre-Action 读取状态为空？**
A: 首次触发时状态文件不存在，设置 `on_missing: "skip"` 或 `"fallback"` 提供默认值。

**Q: 如何查看 Action 执行详情？**
A: 点击底部状态栏的 Pipeline 状态，或 View → Output → "Pipeline Actions"。

**Q: 配置面板中试运行不触发？**
A: 试运行（Dry Run）只执行 Pre-Actions 的模板渲染，不会真正触发 Jenkins 构建。

**Q: 如何重置某个 Pipeline 的状态？**
A: Configure Actions → 状态 Tab → 选择 Pipeline → 重置。

**Q: 日志提取的 JS 脚本报错或超时怎么办？**
A: 结果表格对应单元格会显示错误信息。检查脚本语法（沙箱无 `require`/网络/文件访问），单次执行限时 5 秒。注意：返回空值/undefined 显示「未匹配」而非报错。

**Q: 日志提取和 Post-Action 的 regex_extract 有什么区别？**
A: 日志提取是手动、即时的查看/导出工具，可随时对任意已有构建执行并回写触发参数；Post-Action 在构建完成后自动执行，把结果写入 Action 状态文件供下次触发注入。两者互补：临时排查用日志提取，固定流程用 Post-Action。

## License

MIT
