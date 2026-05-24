# Admin 页面全面重构设计

## 目标

对 admin 页面进行全量重构，统一配置体系、优化代码架构、提升用户体验。

## 一、配置架构统一

所有 admin 相关配置统一走"前端 → REST API → SQLite 持久化"链路。前台设置（主题/字号/滚动）保持 `localStorage` 不变。

```
admin 面板配置 (AI / ASR / 模拟器)
  → REST API
    → SQLite (server/data/slt.db, config 表)
      → 读取时从 DB 取最新值（支持热更新）

前台设置 (主题/字号/滚动/段落长度)
  → useLocalStorage (不变)
```

### 配置存储键

ASR 配置在 `config` 表中使用 `asr_*` 前缀，AI 配置使用 `ai_*` 前缀，共用同一张表。

## 二、API 设计

### ASR 配置

| 端点               | 方法   | 行为                                                                                                                                                                                                                                                           |
| ------------------ | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/asr/config`  | `GET`  | 从 DB 读取全部 ASR 参数                                                                                                                                                                                                                                        |
| `/api/asr/config`  | `PUT`  | 接受完整 ASR 配置 body。保存到 DB 后与 DB 旧值 diff：<br>• 仅有热更参数变动 → 自动下发到运行中引擎, 返回 `{ applied: true }`<br>• 有需重启参数变动 + 引擎运行中 → 返回 `{ needsRestart: true, restartParams: [...] }`<br>• 引擎未运行 → 返回 `{ saved: true }` |
| `/api/asr/restart` | `POST` | 停止识别 → 从 DB 读最新配置 → 重启，返回新状态                                                                                                                                                                                                                 |

### AI 配置

| 端点             | 方法   | 行为                                                                                                                                                                                                                |
| ---------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/api/ai/config` | `GET`  | 从 DB 读取 AI 配置，返回时脱敏 apiKey                                                                                                                                                                               |
| `/api/ai/config` | `PUT`  | 保存到 DB。取消 `process.env.AI_*` 回退                                                                                                                                                                             |
| `/api/ai/test`   | `POST` | 用请求体中的 baseUrl + apiKey + modelName 发起一次最小 chat completion。只测试不保存。返回 `{ ok: true }` 或 `{ ok: false, error: "..." }` 。该端点需做速率限制（60 秒内最多 3 次），服务端日志不可记录 apiKey 明文 |

### 键命名约定

前端 API 使用 camelCase（`vadThreshold`），服务端内部转换为 snake_case（`vad_threshold`）存入 DB。转换逻辑复用现有 `types/asr.ts` 中的 `asrConfigToSnake` / `asrConfigToCamel` 工具函数。

### 模拟器 / WS 测试 / 转录控制

保持现有端点不变。

## 三、数据架构

### SQLite 唯一真实来源

当前存在两个 SQLite 实例：Node.js 服务端 (`server/data/slt.db`) 和 Python ASR 后端 (`asr/data/config.db`)。本次重构后，Node.js 端 `slt.db` 为 ASR/AI 配置的**唯一写入源**：

```
前端 → PUT /api/asr/config → Node.js slt.db (写入)
                                ↓
                         Python ASR 后端通过 HTTP API 从 Node.js 端读取最新配置
                         （Python config_db.py 仅保留本地缓存 / 降级回退能力）
```

Python ASR 后端的 `config_db.py` 调整为：

- 启动时从 Node.js 端 HTTP 拉取配置作为初始值
- `PUT /api/asr/config` 保存成功后，若引擎运行中则通过现有 `handle_config` 通道推送热更参数
- Python 端不再接受独立的配置写入，`set_many` 降级为仅更新本地缓存

**默认方案**：Node.js `slt.db` 为唯一写入源，Python 端改造为通过 HTTP 拉取配置。若实施时 Python 端改造工作量过大，降级为双写方案（`PUT /api/asr/config` 同时写入两边 DB）。

### 响应类型定义

```typescript
// types/asr.ts 追加

/** PUT /api/asr/config 响应 */
type ASRConfigPutResponse =
  | { applied: true } // 纯热更参数，已即时生效
  | { needsRestart: true; restartParams: string[] } // 含需重启参数
  | { saved: true } // 引擎未运行，仅保存
```

## 四、页面布局

单页多卡片，2 列网格，开发工具不折叠。

```
┌─────────────────────────────────────────────────────┐
│  Header: Logo | 系统时间 | 返回前台                    │
│  Status Bar: ● 广播中 | 连接 3 | 字幕 42              │
├──────────────────────┬──────────────────────────────┤
│  转录控制面板          │  AI 控制面板                  │
│                      │                              │
│  - 音频源选择         │  - 状态显示                   │
│  - 设备/波形/音量     │  - Base URL                  │
│  - 流地址            │  - API Key                   │
│  - 音频/识别启停      │  - 模型名称                   │
│  - 状态 + 错误        │  - 润色/翻译开关              │
│                      │  - [测试连接]                 │
│  ┌────────────────┐  │  - [保存配置]                 │
│  │ 音频采集参数     │  │                              │
│  │ 输出采样率      │  │                              │
│  │ 分块大小        │  │                              │
│  │ 回声消除        │  │                              │
│  │ 降噪           │  │                              │
│  │ (浏览器端设置)   │  │                              │
│  └────────────────┘  │                              │
│  ┌────────────────┐  │                              │
│  │ 热更新参数      │  │                              │
│  │ VAD 阈值       │  │                              │
│  │ VAD 最大/最小缓冲│  │                              │
│  │ VAD 静音检测    │  │                              │
│  │ 温度           │  │                              │
│  │ 中间结果        │  │                              │
│  │ 最短句长        │  │                              │
│  │ 回滚 token     │  │                              │
│  │ 语言           │  │                              │
│  │ 重叠           │  │                              │
│  │ 记忆块数        │  │                              │
│  │ [保存 ✅即时生效]│  │                              │
│  └────────────────┘  │                              │
│  ┌────────────────┐  │                              │
│  │ 需重启参数      │  │                              │
│  │ 引擎选择        │  │                              │
│  │ [保存 ⚠需重启]  │  │                              │
│  └────────────────┘  │                              │
├──────────────────────┴──────────────────────────────┤
│  模拟控制面板          │  WS 事件测试面板              │
│  (始终可见)            │  (始终可见)                   │
├─────────────────────────────────────────────────────┤
│  Footer: 版本信息                                    │
└─────────────────────────────────────────────────────┘
```

## 五、文件结构

### 新增

| 文件                                      | 用途                                                                                                                                                       |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `composables/useAdminSimulator.ts`        | 模拟器状态 + API 封装 (`handleStart/Stop/Clear`)。导出 `isRunning`、`isLoading`、`currentDelay` 等响应式状态，通过 `admin.vue` 调用后以 props 下发到子组件 |
| `composables/useAdminWSTester.ts`         | WS 测试面板状态 + 表单逻辑 + 发送 + 日志                                                                                                                   |
| `composables/useASRConfig.ts`             | ASR 配置读写 + 热/冷分类判断                                                                                                                               |
| `components/admin/AdminWSTestPanel.vue`   | WS 测试面板组件                                                                                                                                            |
| `components/common/ConfirmDialog.vue`     | 通用确认弹窗 (Teleport 渲染)                                                                                                                               |
| `components/common/ToastNotification.vue` | 全局 Toast 通知组件                                                                                                                                        |
| `server/routes/api/asr/config.ts`         | GET / PUT ASR 配置                                                                                                                                         |
| `server/routes/api/asr/restart.ts`        | POST 冷重启                                                                                                                                                |
| `server/routes/api/ai/test.ts`            | POST 测试 AI 连接                                                                                                                                          |

### 修改

| 文件                                             | 变更                                                 |
| ------------------------------------------------ | ---------------------------------------------------- |
| `pages/admin.vue`                                | 精简为纯布局编排，状态逻辑迁移至 composables         |
| `components/admin/TranscriptionControlPanel.vue` | 高级设置拆为"热更区"+"冷更区"，ASR 配置通过 API 读写 |
| `components/admin/AIControlPanel.vue`            | 增加测试连接按钮，取消 env fallback                  |
| `components/admin/ControlPanel.vue`              | 使用 `useAdminSimulator` composable                  |
| `server/utils/ai-config.ts`                      | 取消 `process.env.AI_*` 回退默认值，仅从 DB 读取     |
| `server/utils/db.ts`                             | 扩展 `initDefaults` 支持 ASR 默认键                  |

### 删除

- `admin.vue` 中的 Google Fonts `@import url()`，改用系统等宽字体

### 不动

- `composables/useSettings.ts`（前台设置保持 localStorage）
- `composables/useTranscription.ts`（状态管理无需改动）
- `composables/useWebSocket.ts`（WS 连接管理无需改动）
- `composables/useAudioCapture.ts`（音频采集无需改动）
- `composables/useWaveformRenderer.ts`（波形渲染无需改动）
- `components/layout/SettingsDrawer.vue`（前台设置抽屉）

## 六、交互流程

### ASR 配置保存

```
用户修改参数 → 点保存 → PUT /api/asr/config
  ├─ 服务端 diff 新旧值
  ├─ 纯热更参数变动 → 下发运行中引擎 → 返回 { applied: true }
  │   Toast: "参数已保存，已即时生效 ✓"
  ├─ 含需重启参数变动 + 引擎运行中 → 返回 { needsRestart: true, restartParams: [...] }
  │   ConfirmDialog: "以下参数需要重启识别服务才能生效：{参数名列表}。是否立即重启？"
  │   ├─ 确认 → POST /api/asr/restart → Toast: "已重启，新参数已生效 ✓"
  │   └─ 取消 → Toast: "参数已保存，将在下次启动时生效"
  └─ 引擎未运行 → 返回 { saved: true }
      Toast: "参数已保存 ✓"
```

### AI 配置测试连接

```
用户填写 baseUrl / apiKey / modelName
  → 点 [测试连接]
  → POST /api/ai/test (body: 当前表单值, 不读不写 DB)
  → 成功 → Toast: "连接成功 ✓"
  → 失败 → Toast: "连接失败: {错误详情}"
```

### AI 配置保存

保持现有流程：`PUT /api/ai/config` → 写入 DB → 即时生效（`processAI()` 每次调用实时读 DB）。

### 统一通知体系

基于现有 `composables/useNotification.ts`（已提供 `success`、`error`、`warning`、`info` 方法和 `notifications` 响应式数组），新增 `components/common/ToastNotification.vue` 作为全局渲染组件，在 `app.vue` 中挂载，遍历 `notifications` 数组渲染 Toast。

| 场景                                                   | 方式                                                  |
| ------------------------------------------------------ | ----------------------------------------------------- |
| 操作结果反馈（保存/启动/停止/重启/测试连接）           | 全局 Toast（右上角弹出，成功绿/失败红，3 秒自动消失） |
| 面板内持久状态错误（"API Key 未配置"、"识别服务异常"） | 面板内红色卡片                                        |
| 危险操作确认（冷重启、清空字幕）                       | ConfirmDialog 弹出确认                                |

## 七、ASR 参数分类

前端按以下静态分类渲染 UI 分区。服务端在 `PUT /api/asr/config` 时以此为权威分类做 diff 判断，决定是否自动热更或提示重启。

### 热更新参数（保存即时生效）

| 参数         | 键                | 说明                 |
| ------------ | ----------------- | -------------------- |
| VAD 阈值     | `vadThreshold`    | 语音活动检测灵敏度   |
| VAD 最大缓冲 | `vadMaxBufferSec` | 最大缓冲秒数         |
| VAD 最小缓冲 | `vadMinBufferSec` | 最小缓冲秒数         |
| VAD 静音检测 | `vadSilenceMs`    | 静音判定毫秒         |
| 温度         | `temperature`     | 解码采样温度         |
| 中间结果     | `sendPartial`     | 是否发送中间识别结果 |
| 最短句长     | `sentenceMinLen`  | 断句最小长度         |
| 回滚 token   | `rollbackNum`     | 解码回溯 token 数    |
| 语言         | `language`        | 识别语言             |
| 重叠         | `overlapSec`      | 分块重叠秒数         |
| 记忆块数     | `memoryChunks`    | 上下文窗口块数       |

### 需重启生效的参数

以下参数变更后需重启 ASR 引擎才能生效：

| 参数     | 键         | 说明         |
| -------- | ---------- | ------------ |
| 引擎选择 | `provider` | ASR 引擎类型 |

### 音频采集参数（浏览器端，非 ASR 引擎参数）

以下参数属于浏览器端 `getUserMedia` 采集设置，变更后需重启麦克风采集流生效，不经过 ASR 配置 API：

| 参数       | 键                 | 说明           |
| ---------- | ------------------ | -------------- |
| 输出采样率 | `targetSampleRate` | 音频重采样目标 |
| 分块大小   | `chunkDurationMs`  | 音频分块时长   |
| 回声消除   | `echoCancellation` | 麦克风回声消除 |
| 降噪       | `noiseSuppression` | 麦克风降噪     |

## 八、错误处理

- 所有 API 调用保留 try/catch
- WebSocket `send()` 返回 false 时通过 Toast 提示"连接已断开"
- ASR 配置 API 请求失败时 Toast 提示错误详情，不静默忽略
- `fetchASRConfig()` 失败时保留现有静默降级行为（服务端不可用不影响页面交互）
- 音频发送静默失败增加计数器，超过阈值时 Toast 提示

## 九、不纳入本次重构

- 认证/鉴权（后续统一加 middleware）
- API Key 加密（保持明文存储）
- 前台设置抽屉 SettingsDrawer（独立体系，不动）
