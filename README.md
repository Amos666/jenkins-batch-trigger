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
5. 未创建分类时模板平铺显示，原有拖拽排序、套用、删除行为完全不变

### 触发预览

点击「触发选中」后会弹出确认面板，显示每个 Job 实际使用的参数（全局 or 独立），确认后才真正触发。

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

## License

MIT
