# 卡片管理与插件包规范

2026-11-06。总览负责摆放卡片，`/cards` 管理类型，`/plugins` 导入、导出和配置插件。资源在独立的 `/resources` 页面按“类型 → 分类”管理，所有页面共用控制台导航与主题。

## 这次调整

| Before | After | Why |
| --- | --- | --- |
| 添加卡片调用安全上下文限定的 randomUUID，HTTP IP 下可能失败 | 使用 getRandomValues 生成 UUID，不依赖 HTTPS 专属 API | 兼容当前内网 HTTP 入口 |
| 打开卡片库立即进入总览编辑 | 浏览、选择、关闭均不改变布局；确认后才写入 | 不制造无修改的草稿 |
| 卡片添加后还需要寻找布局保存按钮 | 普通模式确认即保存；已有布局草稿时加入草稿 | 添加操作有明确结果，并保留原布局编辑流程 |
| 资源状态由用户手工填写 | 状态来自最新 Agent 采样与新鲜度 | 手填“在线”不能代表实时状态 |
| 资源只有弹窗和类型过滤 | 独立资源页面，类型和既有 category 共同筛选 | 保留已有分类及资源 ID |
| 卡片只有固定六类 | 系统卡片加声明式增强卡片，专属字段、图标及持久内容 | 支持持续扩展 |

## 日常使用

- 左侧“卡片管理”浏览系统卡片和增强卡片。系统资源/指标/趋势/收藏/文本/事件保留专属配置；每张实例可独立设置标题、图标、尺寸、资源、指标等对应字段。
- 内置增强类型：时钟、倒数日、备忘录、待办、自定义信息。增强类型可修改名称、图标、默认尺寸、字段名称/类型/必填/默认值；实例保存各自的值。修改默认值不会覆盖实例已填写内容，新增字段使用新默认值。
- “新建类型”生成独立标识，选择呈现类型时填入其所需字段。新增自定义信息字段后，卡片按字段顺序展示；字段内容为纯文本。
- 从管理页“添加到总览”进入配置，也可在总览“添加卡片”选择类型。浏览或取消不改变总览 revision；确认普通添加会保存，编辑布局期间确认则只修改草稿。
- 备忘录在卡片内编辑后点“保存内容”；待办可添加、勾选、删除。内容单独保存，不改变布局 revision。多标签页同时写入时返回冲突，保留当前输入并提示重新载入；不会静默覆盖其他页面。
- 从资源页“加入总览”预填资源绑定。资源新增/编辑提供已有分类建议，也可填写新分类。状态不再提供手动选择：已配置服务器按上报显示正常/部分异常/连接失败/过期/等待首次上报；其他未接入连接器的资源显示“未接入状态上报”，不伪造在线探测。

## 单文件插件包

扩展名建议 `.sma-card.json`，内容为 UTF-8 JSON，格式 `sma-card-package-v1`。不是 ZIP，也不是可执行脚本包。导入前展示名称、版本、呈现类型、字段和同标识覆盖提示，确认后安装。相同 ID 更新定义，使用 revision 拒绝旧页面覆盖；不会自动升级远程插件。

```json
{
  "format": "sma-card-package-v1",
  "id": "example.release-day",
  "name": "发版倒计时",
  "version": "1.0.0",
  "description": "距离下一次发布",
  "icon": "calendar",
  "renderer": "countdown",
  "size": "medium",
  "fields": [
    {"key":"target","label":"发布时间","type":"date","required":true,"default":"2030-01-01T00:00:00+08:00"},
    {"key":"caption","label":"说明","type":"text","required":false,"default":"距离发布"}
  ]
}
```

可直接导入的示例在 [examples/cards](../examples/cards/)。`id` 为小写字母起始的 3–80 位字母/数字/点/短横线；`sma.` 为内置类型保留。版本为 `主.次.补丁` 三段数字。名称最长 40 字，说明最长 180 字。尺寸可选 `small/medium/wide/full`。

图标枚举：`layout/server/activity/link/note/bell/clock/calendar/check/database/globe/star`。图标来自项目内置图标库，不加载远程 SVG 或脚本。

每包最多 20 个字段，每个字段必须有 `key/label/type/required/default`。key 以小写字母起始，后接小写字母、数字和下划线，最长 40 位且不能重复或使用原型属性名；label 最长 40 字。支持类型：

| type | default/值类型 | 限制 |
| --- | --- | --- |
| text | string | 最长 240 字 |
| textarea | string | 最长 4000 字 |
| number | number | 有限数，绝对值不超过 1e12 |
| date | string | 含秒可选、必须含 Z 或 UTC 偏移的 ISO 时间；空默认值用于实例填写 |
| timezone | string | 有效 IANA 时区，如 Asia/Shanghai |
| boolean | boolean | 使用 JSON true/false |

呈现类型的约定字段：

| renderer | 必要字段及类型 | 行为 |
| --- | --- | --- |
| clock | timezone: timezone，seconds: boolean | 按所选时区显示日期和时间，每秒刷新 |
| countdown | target: date | 距目标时间的天/小时/分钟/秒；caption 可选 |
| memo | text: textarea | 实例初始文字，后续内容单独持久保存 |
| todo | items: textarea | 每行一条初始事项，最多 100 项；后续勾选与增删单独保存 |
| fields | 无固定字段 | 按自定义字段顺序显示内容 |

单包最大 64 KB，每个用户最多保存 100 份类型配置，每个面板最多 60 张卡片。备忘正文最多 4000 字；待办最多 100 项，每项最长 240 字。导入拒绝未知字段、脚本、远程地址、任意 HTML/JS/CSS、iframe 及权限声明；卡片不获得 Token、会话、文件系统、后台命令或网络权限。需要新执行能力时应升级受版本管理的渲染器，不通过导入代码绕过平台边界。这一版不支持任意第三方可执行插件。

已被面板使用的自定义插件不能卸载，须先移除引用；内置类型可以恢复默认配置，保留实例值。删除字段或变更类型可能使旧实例需要重新配置，界面会提示，不会删除实例内容。导出只包含类型定义和默认值，不包含某张备忘录或待办的私有内容。

## 数据、API 与备份

迁移 `0008_abandoned_terrax.sql` 新增 `card_definitions` 和 `card_states`。旧六类 widget 的数据保持可读；增强实例使用 `type=plugin`、`pluginId`、`values`，卡片 `icon` 为可选字段。删除卡片时清理其独立内容，删除面板时级联清理；仅删除资源不删除面板。

所有 API 均要求既有所有者会话和写入来源校验：

- `GET /api/card-definitions`：内置类型与用户覆盖/插件的有效列表。
- `POST /api/card-definitions`：`{manifest,revision}` 安装或更新；首次为 revision 0，冲突 409。
- `DELETE /api/card-definitions/:id`：`{revision}`；被引用时 409，内置配置删除后恢复默认。
- `GET/PUT /api/dashboards/:id/widgets/:widgetId/state`：只允许拥有的已保存备忘录/待办；PUT 为 `{state,revision}`，不存在返回 404、冲突 409。state 为 `{text}` 或 `{items:[{id,text,done}]}`，不允许其他字段。

页面 JSON 备份继续使用 `sma-center-backup-v1`，增加可选 `cardDefinitions/cardStates`，包含类型定义与备忘/待办内容，可能含用户填写的私密文本，请自行保护。旧备份合并保留未包含的定义；替换清除现有定义与内容，再恢复，内置默认类型由程序提供。仍不含 TOTP、Token、监控历史；完整卷备份包含全部表与密钥。

页面 JSON 恢复沿用 5 MB 限制；大量卡片和内容的完整恢复应使用受保护的整卷备份，不通过拆分替换导入绕过限制。

本次新增表本身不要求回滚时删除，但旧版本不能解析 type=plugin。使用增强卡片后，不可把切换旧镜像视为兼容回退；需要支持该格式的修复版本，或另行授权恢复升级前完整备份（会丢失后续修改）。禁止直接删表、删卡片或恢复旧数据冒充无损回退。

验证使用隔离临时认证和模拟 Agent，覆盖 HTTP 缺少 randomUUID、浏览不写布局、包校验/导入、字段配置、交互持久化、冲突、备份与响应式布局。上线结果与生产未验证项见[部署核对记录](deployment-status.md)。
