# Admin 页面全面重构实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 对 admin 页面进行全量重构：统一配置体系（前端→REST API→SQLite）、拆分 composable、优化布局。

**Architecture:** 分为三层改造 — 服务端 API（ASR/AI 配置端点）、前端 composables（提取业务逻辑）、前端组件（UI 重构）。按自底向上顺序执行。

**Tech Stack:** Nuxt 4 + Vue 3 + TypeScript, Nitro WebSocket, better-sqlite3, Python ASR backend

---

## 任务概览

| 组  | 任务 | 文件                                             | 类型 |
| --- | ---- | ------------------------------------------------ | ---- |
| A   | 1    | `types/asr.ts`                                   | 修改 |
| A   | 2    | `server/utils/db.ts`                             | 修改 |
| B   | 3    | `server/routes/api/asr/config.ts`                | 重写 |
| B   | 4    | `server/routes/api/asr/restart.ts`               | 新建 |
| B   | 5    | `server/routes/api/ai/test.ts`                   | 新建 |
| B   | 6    | `server/utils/ai-config.ts`                      | 修改 |
| B   | 7    | `server/routes/api/ai/config.ts`                 | 修改 |
| C   | 8    | `composables/useAdminSimulator.ts`               | 新建 |
| C   | 9    | `composables/useAdminWSTester.ts`                | 新建 |
| C   | 10   | `composables/useASRConfig.ts`                    | 新建 |
| D   | 11   | `components/common/ToastNotification.vue`        | 新建 |
| D   | 12   | `components/common/ConfirmDialog.vue`            | 新建 |
| D   | 13   | `app.vue`                                        | 修改 |
| E   | 14   | `components/admin/AdminWSTestPanel.vue`          | 新建 |
| E   | 15   | `components/admin/ControlPanel.vue`              | 修改 |
| E   | 16   | `components/admin/AIControlPanel.vue`            | 修改 |
| E   | 17   | `components/admin/TranscriptionControlPanel.vue` | 修改 |
| F   | 18   | `pages/admin.vue`                                | 修改 |

### 关于 Python 端改造

根据 Spec 第三节降级方案，本次重构采用**双写策略**：

- `PUT /api/asr/config` 保存时写入 Node.js `slt.db`，同时通过 HTTP 推送热更参数到 Python ASR 后端
- Python `config_db.py` 本次不改造，保持现有逻辑
- 后续独立 PR 中将 Python 端调整为从 Node.js 拉取配置（唯一写入源）

---

### Task 1: 添加 ASRConfigPutResponse 可辨识联合类型

**Files:**

- Modify: `types/asr.ts` (末尾追加)

- [ ] **Step 1: 追加类型定义并导出 CAMEL_TO_SNAKE**

在 `types/asr.ts` 末尾追加类型定义。同时将 `CAMEL_TO_SNAKE` 从 `const` 改为 `export const`（Task 3 服务端路由需要引用）：

```typescript
// 将第 39 行的 const CAMEL_TO_SNAKE 改为 export const CAMEL_TO_SNAKE
export const CAMEL_TO_SNAKE: Record<string, string> = {
  overlapSec: 'overlap_sec',
  memoryChunks: 'memory_chunks',
  vadThreshold: 'vad_threshold',
  vadMaxBufferSec: 'vad_max_buffer_sec',
  vadMinBufferSec: 'vad_min_buffer_sec',
  vadSilenceMs: 'vad_silence_ms',
  sendPartial: 'send_partial',
  sentenceMinLen: 'sentence_min_len',
  rollbackNum: 'rollback_num',
}

/**
 * PUT /api/asr/config 响应类型
 */
export type ASRConfigPutResponse =
  | { status: 'applied' } // 纯热更参数，已即时生效
  | { status: 'needs_restart'; restartParams: string[] } // 含需重启参数
  | { status: 'saved' } // 引擎未运行，仅保存
```

- [ ] **Step 2: 验证类型**

运行: `pnpm typecheck`
预期: 通过（新增类型不影响现有代码）

---

### Task 2: 扩展 DB initDefaults 支持 ASR 默认键

**Files:**

- Modify: `server/utils/db.ts`

- [ ] **Step 1: 阅读现有 `initDefaults` 调用**

现有调用在 `server/utils/ai-config.ts` 中的 `initDefaults(DEFAULTS)`，其中 `DEFAULTS` 来自环境变量。

- [ ] **Step 2: 修改 `server/utils/db.ts`**

在文件末尾，`initDefaults` 函数之后新建模块级初始化块。当前 `initDefaults` 实现（第 47-53 行）：

```typescript
export function initDefaults(defaults: Record<string, unknown>): void {
  const db = getDb()
  const insert = db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)')
  for (const [key, value] of Object.entries(defaults)) {
    insert.run(key, JSON.stringify(value))
  }
}
```

追加 ASR 默认值初始化（在文件末尾）：

```typescript
// ASR 默认配置（仅当 DB 中不存在时初始化）
const ASR_DEFAULTS: Record<string, unknown> = {
  asr_provider: 'gguf',
  asr_overlap_sec: 1.0,
  asr_memory_chunks: 2,
  asr_vad_threshold: 0.5,
  asr_vad_max_buffer_sec: 2.0,
  asr_vad_min_buffer_sec: 0.5,
  asr_vad_silence_ms: 500,
  asr_temperature: 0.0,
  asr_language: 'zh',
  asr_send_partial: true,
  asr_sentence_min_len: 2,
  asr_rollback_num: 3,
}

// 在模块加载时初始化 ASR 默认值
initDefaults(ASR_DEFAULTS)
```

- [ ] **Step 3: 运行 typecheck**

运行: `pnpm typecheck`
预期: 通过

---

### Task 3: 重写 ASR 配置 API 端点

**Files:**

- Modify: `server/routes/api/asr/config.ts`（替换现有 5 行代理实现为完整读写端点）
- Read reference: `server/routes/api/ai/config.ts`（模式参考）
- Read reference: `server/utils/transcription-manager.ts`（引擎状态判断）

- [ ] **Step 1: 创建路由文件**

```typescript
import { getConfig, setConfig, getAllConfig } from '~/server/utils/db'
import { transcriptionManager } from '~/server/utils/transcription-manager'
import type { ASRConfigPutResponse } from '~/types/asr'
import { asrConfigToCamel, asrConfigToSnake, CAMEL_TO_SNAKE } from '~/types/asr'
import type { ASRConfig } from '~/types/asr'

// 热更新参数键列表 — API 层使用 camelCase（与前端一致，与 Python DYNAMIC_CONFIG_KEYS 对齐）
const HOT_KEYS = new Set([
  'overlapSec',
  'memoryChunks',
  'vadThreshold',
  'vadMaxBufferSec',
  'vadMinBufferSec',
  'vadSilenceMs',
  'temperature',
  'language',
  'sendPartial',
  'sentenceMinLen',
  'rollbackNum',
])

const ASR_PORT = parseInt(process.env.ASR_PORT || '9900', 10)

// ASR 配置在 DB 中的前缀
const PREFIX = 'asr_'

/** 从 DB 读取全部 ASR 配置，返回 camelCase（API 层格式）。使用 getAllConfig() + 前缀过滤，自动覆盖所有 asr_* 键 */
function readFromDB(): ASRConfig {
  const allConfig = getAllConfig()
  const snakeResult: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(allConfig)) {
    if (key.startsWith(PREFIX)) {
      const snakeKey = key.slice(PREFIX.length) // 去掉 'asr_' 前缀 → snake_case
      snakeResult[snakeKey] = value
    }
  }
  return asrConfigToCamel(snakeResult)
}

export default defineEventHandler(async (event) => {
  try {
    // GET: 读取全部 ASR 配置（返回 camelCase）
    if (event.method === 'GET') {
      return readFromDB()
    }

    // PUT: 保存 ASR 配置
    if (event.method === 'PUT') {
      const body = await readBody<Record<string, unknown>>()
      if (!body || typeof body !== 'object') {
        throw createError({ statusCode: 400, statusMessage: '请求体无效' })
      }

      // 前端传入 camelCase，转换为 snake_case 后写入 DB
      const oldConfig = readFromDB()
      const snakeBody = asrConfigToSnake(body as ASRConfig)

      for (const [snakeKey, value] of Object.entries(snakeBody)) {
        if (value === undefined) continue
        setConfig(PREFIX + snakeKey, value)
      }

      // diff：检查哪些 camelCase 键变更了
      const changedKeys: string[] = []
      for (const camelKey of Object.keys(body)) {
        if (body[camelKey] === undefined) continue
        const oldVal = (oldConfig as Record<string, unknown>)[camelKey]
        const newVal = body[camelKey]
        if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
          changedKeys.push(camelKey)
        }
      }

      // 无变更，返回 saved
      if (changedKeys.length === 0) {
        return { status: 'saved' } satisfies ASRConfigPutResponse
      }

      const engineRunning = transcriptionManager.isActive()

      // 若引擎未运行，直接返回 saved
      if (!engineRunning) {
        return { status: 'saved' } satisfies ASRConfigPutResponse
      }

      // 区分热更参数和需重启参数（camelCase）
      const coldChanged = changedKeys.filter((k) => !HOT_KEYS.has(k))

      if (coldChanged.length > 0) {
        // 有需重启参数变更
        return {
          status: 'needs_restart',
          restartParams: coldChanged,
        } satisfies ASRConfigPutResponse
      }

      // 纯热更参数：转换为 snake_case 后通过 HTTP 推送到 Python ASR 后端
      const hotConfig: Record<string, unknown> = {}
      for (const camelKey of changedKeys) {
        if (HOT_KEYS.has(camelKey)) {
          const snakeKey = CAMEL_TO_SNAKE[camelKey] || camelKey
          hotConfig[snakeKey] = body[camelKey]
        }
      }

      try {
        await fetch(`http://127.0.0.1:${ASR_PORT}/config`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(hotConfig),
        })
      } catch {
        // Python 后端不可用时静默忽略（配置已入库，下次启动生效）
      }

      return { status: 'applied' } satisfies ASRConfigPutResponse
    }

    throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed' })
  } catch (e: unknown) {
    if (e && typeof e === 'object' && 'statusCode' in e) throw e // re-throw H3 errors
    const msg = e instanceof Error ? e.message : '内部错误'
    throw createError({ statusCode: 500, statusMessage: msg })
  }
})
```

- [ ] **Step 2: 验证语法**

运行: `pnpm typecheck`
预期: 通过

---

### Task 4: 创建 ASR 重启端点

**Files:**

- Create: `server/routes/api/asr/restart.ts`

- [ ] **Step 1: 创建路由文件**

```typescript
import { orchestrator } from '~/server/utils/transcription-orchestrator'
import { transcriptionManager } from '~/server/utils/transcription-manager'
import { getAllConfig } from '~/server/utils/db'

export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed' })
  }

  try {
    const wasActive = orchestrator.isActive()

    if (!wasActive) {
      return { success: true, message: '引擎未运行，无需重启' }
    }

    // 保存当前 source 类型和 streamUrl
    const currentSource = transcriptionManager.getSource()
    const currentConfig: Record<string, unknown> = {
      source: currentSource,
    }
    // 从 DB 读取最新 ASR 配置（getAllConfig + asr_ 前缀过滤，与 Task 3 readFromDB 模式一致）
    const allConfig = getAllConfig()
    for (const [key, value] of Object.entries(allConfig)) {
      if (key.startsWith('asr_')) {
        const configKey = key.slice(4) // 去掉 'asr_' 前缀，DB 中存 snake_case（如 overlap_sec）
        currentConfig[configKey] = value
      }
    }

    // 停止
    await orchestrator.stop()

    // 用最新配置重启
    const result = await orchestrator.start(currentConfig as any)

    if (result.success) {
      return { success: true, restarted: true }
    }
    return { success: false, error: result.error }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '重启失败'
    throw createError({ statusCode: 500, statusMessage: msg })
  }
})
```

- [ ] **Step 2: 验证语法**

运行: `pnpm typecheck`
预期: 通过

---

### Task 5: 创建 AI 测试连接端点

**Files:**

- Create: `server/routes/api/ai/test.ts`

- [ ] **Step 1: 创建路由文件**

```typescript
// 简易内存限流：60 秒内最多 3 次
const rateLimitMap = new Map<string, number[]>()

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const window = 60_000
  const maxRequests = 3
  let timestamps = rateLimitMap.get(ip) || []
  timestamps = timestamps.filter((t) => now - t < window)
  if (timestamps.length >= maxRequests) return false
  timestamps.push(now)
  rateLimitMap.set(ip, timestamps)
  return true
}

export default defineEventHandler(async (event) => {
  if (event.method !== 'POST') {
    throw createError({ statusCode: 405, statusMessage: 'Method Not Allowed' })
  }

  const clientIp =
    getHeader(event, 'x-forwarded-for')?.split(',')[0]?.trim() ||
    getHeader(event, 'x-real-ip') ||
    event.node.req.socket.remoteAddress ||
    'unknown'

  if (!checkRateLimit(clientIp)) {
    throw createError({ statusCode: 429, statusMessage: '请求过于频繁，请 60 秒后再试' })
  }

  const body = await readBody(event)
  const { baseUrl, apiKey, modelName } = body || {}

  if (!baseUrl || !apiKey || !modelName) {
    throw createError({ statusCode: 400, statusMessage: 'baseUrl, apiKey, modelName 均不能为空' })
  }

  const url = baseUrl.replace(/\/+$/, '') + '/chat/completions'

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 10000)

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        messages: [{ role: 'user', content: 'Hi' }],
        max_tokens: 5,
        temperature: 0,
        stream: false,
      }),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!response.ok) {
      const errText = await response.text().catch(() => '')
      return { ok: false, error: `HTTP ${response.status}: ${errText.slice(0, 200)}` }
    }

    return { ok: true }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Unknown error'
    if (msg.includes('abort')) {
      return { ok: false, error: '连接超时（10 秒）' }
    }
    return { ok: false, error: msg }
  }
})
```

- [ ] **Step 2: 验证语法**

运行: `pnpm typecheck`
预期: 通过

---

### Task 6: 取消 AI 配置环境变量回退

**Files:**

- Modify: `server/utils/ai-config.ts`

- [ ] **Step 1: 修改 `ai-config.ts`**

当前 `DEFAULTS` 从 `process.env` 读取。修改为仅从 DB 读取（取消 env 回退）。

```typescript
import type { AIConfig } from '~/types/ai'
import { getConfig, initDefaults, setConfig } from './db'

const KEYS: Record<keyof AIConfig, string> = {
  baseUrl: 'ai_base_url',
  apiKey: 'ai_api_key',
  modelName: 'ai_model_name',
  polishEnabled: 'ai_polish_enabled',
  translationEnabled: 'ai_translation_enabled',
}

// 空默认值（取消 process.env 回退）
const DEFAULTS: Record<string, unknown> = {
  [KEYS.baseUrl]: '',
  [KEYS.apiKey]: '',
  [KEYS.modelName]: '',
  [KEYS.polishEnabled]: false,
  [KEYS.translationEnabled]: false,
}

initDefaults(DEFAULTS)

export function getAIConfig(): AIConfig {
  return {
    baseUrl: getConfig<string>(KEYS.baseUrl, ''),
    apiKey: getConfig<string>(KEYS.apiKey, ''),
    modelName: getConfig<string>(KEYS.modelName, ''),
    polishEnabled: getConfig<boolean>(KEYS.polishEnabled, false),
    translationEnabled: getConfig<boolean>(KEYS.translationEnabled, false),
  }
}

export function saveAIConfig(partial: Partial<AIConfig>): AIConfig {
  const keyMap: Record<string, string> = KEYS
  for (const [field, dbKey] of Object.entries(keyMap)) {
    if (partial[field as keyof AIConfig] !== undefined) {
      setConfig(dbKey, partial[field as keyof AIConfig])
    }
  }
  return getAIConfig()
}
```

- [ ] **Step 2: 验证语法 + 类型**

运行: `pnpm typecheck`
预期: 通过

---

### Task 7: AI 配置端点 POST → PUT

**Files:**

- Modify: `server/routes/api/ai/config.ts`

- [ ] **Step 1: 将 POST 改为 PUT**

在 `server/routes/api/ai/config.ts` 第 15 行，将 `if (event.method === 'POST')` 改为 `if (event.method === 'PUT')`。

- [ ] **Step 2: 验证语法**

运行: `pnpm typecheck`
预期: 通过

---

### Task 8: 创建 useAdminSimulator composable

**Files:**

- Create: `composables/useAdminSimulator.ts`
- Read reference: `pages/admin.vue`（提取模拟器逻辑）

- [ ] **Step 1: 创建 composable**

从 `pages/admin.vue` 中提取模拟器状态 + API 逻辑。使用模块级状态确保多个调用者共享同一份 `isRunning`。

```typescript
// 模块级共享状态（确保 ControlPanel 和其他组件共享同一份数据）
const isRunning = ref(false)
const isLoading = ref(false)
const currentDelay = ref(2000)
let statusTimer: ReturnType<typeof setInterval> | null = null

export function useAdminSimulator() {
  function startPolling() {
    statusTimer = setInterval(async () => {
      try {
        const data = await $fetch<{ isRunning: boolean }>('/api/status')
        isRunning.value = data.isRunning
      } catch {
        // 静默降级
      }
    }, 2000)
  }

  function stopPolling() {
    if (statusTimer) {
      clearInterval(statusTimer)
      statusTimer = null
    }
  }

  async function handleStart(delay?: number) {
    isLoading.value = true
    try {
      await $fetch('/api/simulate/start', {
        method: 'POST',
        body: delay ? { delay } : undefined,
      })
      isRunning.value = true
      startPolling()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '启动失败'
      useNotification().error(`模拟启动失败: ${msg}`)
    } finally {
      isLoading.value = false
    }
  }

  async function handleStop() {
    isLoading.value = true
    try {
      await $fetch('/api/simulate/stop', { method: 'POST' })
      isRunning.value = false
      stopPolling()
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '停止失败'
      useNotification().error(`模拟停止失败: ${msg}`)
    } finally {
      isLoading.value = false
    }
  }

  async function handleClear() {
    isLoading.value = true
    try {
      await $fetch('/api/clear', { method: 'POST' })
      useNotification().success('字幕已清空')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '清空失败'
      useNotification().error(`清空失败: ${msg}`)
    } finally {
      isLoading.value = false
    }
  }

  function cleanup() {
    stopPolling()
  }

  return {
    isRunning: readonly(isRunning), // 模块级 ref，所有调用者共享
    isLoading: readonly(isLoading),
    currentDelay: readonly(currentDelay),
    handleStart,
    handleStop,
    handleClear,
    startPolling,
    stopPolling,
    cleanup,
  }
}
```

- [ ] **Step 2: 验证语法**

运行: `pnpm typecheck`
预期: 通过

---

### Task 9: 创建 useAdminWSTester composable

**Files:**

- Create: `composables/useAdminWSTester.ts`

- [ ] **Step 1: 创建 composable**

```typescript
export interface WSTestLogEntry {
  id: string
  time: string
  type: string
  data: unknown
}

export function useAdminWSTester() {
  const wsMessageType = ref('current')
  const wsSendLoading = ref(false)
  const wsSendLog = ref<WSTestLogEntry[]>([])

  const formFields = ref({
    text: '',
    subtitleId: '',
    optimizedText: '',
    enText: '',
    version: 1,
    enVersion: 1,
  })

  function now(): string {
    const d = new Date()
    return d.toLocaleTimeString('zh-CN', { hour12: false })
  }

  async function handleSendWsMessage() {
    wsSendLoading.value = true
    try {
      const type = wsMessageType.value
      let data: unknown

      if (type === 'current') {
        data = {
          text: formFields.value.text,
          enText: formFields.value.enText,
          version: formFields.value.version,
          enVersion: formFields.value.enVersion,
        }
      } else if (type === 'confirmed') {
        data = {
          id: formFields.value.subtitleId || `manual-${Date.now()}`,
          text: formFields.value.text,
          optimizedText: formFields.value.optimizedText || undefined,
          enText: formFields.value.enText || undefined,
        }
      } else if (type === 'clear') {
        data = {}
      } else if (type === 'init') {
        const initData: Record<string, unknown> = {
          current: { text: formFields.value.text || '', enText: '', version: 0, enVersion: 0 },
          confirmed: [],
          connectionCount: 0,
        }
        if (formFields.value.text) {
          initData.confirmed = [
            {
              id: `init-${Date.now()}`,
              text: formFields.value.text,
              optimizedText: formFields.value.optimizedText || undefined,
              enText: formFields.value.enText || undefined,
              timestamp: Date.now(),
            },
          ]
        }
        data = initData
      }

      const resp = await $fetch<{ success: boolean }>('/api/ws/send', {
        method: 'POST',
        body: { type, data },
      })
      if (!resp.success) {
        useNotification().error('WebSocket 连接已断开，消息未送达')
        return
      }

      const logId = `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
      wsSendLog.value.unshift({ id: logId, time: now(), type, data })
      if (wsSendLog.value.length > 50) {
        wsSendLog.value = wsSendLog.value.slice(0, 50)
      }
      useNotification().success('消息已发送')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '发送失败'
      useNotification().error(`WS 发送失败: ${msg}`)
    } finally {
      wsSendLoading.value = false
    }
  }

  return {
    wsMessageType,
    wsSendLoading,
    wsSendLog,
    formFields,
    handleSendWsMessage,
  }
}
```

- [ ] **Step 2: 验证语法**

运行: `pnpm typecheck`
预期: 通过

---

### Task 10: 创建 useASRConfig composable

**Files:**

- Create: `composables/useASRConfig.ts`

- [ ] **Step 1: 创建 composable**

```typescript
import type { ASRConfig, ASRConfigPutResponse } from '~/types/asr'

// 热更新参数键（与 spec 第七节对齐）
const HOT_RELOAD_KEYS = new Set([
  'vadThreshold',
  'vadMaxBufferSec',
  'vadMinBufferSec',
  'vadSilenceMs',
  'temperature',
  'sendPartial',
  'sentenceMinLen',
  'rollbackNum',
  'language',
  'overlapSec',
  'memoryChunks',
])

/** 判断 config 中是否有非热更参数的变更 */
function hasColdChanges(oldCfg: ASRConfig, newCfg: ASRConfig): string[] {
  const cold: string[] = []
  const allKeys = new Set([...Object.keys(oldCfg), ...Object.keys(newCfg)])
  for (const key of allKeys) {
    // model 为预留字段，当前不纳入分类判断
    if (key === 'model') continue
    // provider 单独处理
    if (key === 'provider') continue
    const oldVal = (oldCfg as Record<string, unknown>)[key]
    const newVal = (newCfg as Record<string, unknown>)[key]
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal) && !HOT_RELOAD_KEYS.has(key)) {
      cold.push(key)
    }
  }
  // provider 变更总是需要重启
  if (oldCfg.provider !== newCfg.provider) {
    cold.push('provider')
  }
  return cold
}

export function useASRConfig() {
  const config = ref<ASRConfig>({})
  const loading = ref(false)
  const saving = ref(false)
  const error = ref('')

  async function fetchConfig() {
    loading.value = true
    try {
      const data = await $fetch<Record<string, unknown>>('/api/asr/config')
      config.value = data
      error.value = ''
    } catch {
      // 静默降级
    } finally {
      loading.value = false
    }
  }

  async function saveConfig(newConfig: ASRConfig): Promise<ASRConfigPutResponse> {
    saving.value = true
    try {
      const response = await $fetch<ASRConfigPutResponse>('/api/asr/config', {
        method: 'PUT',
        body: newConfig,
      })
      config.value = { ...newConfig }
      error.value = ''
      return response
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : '保存失败'
      error.value = msg
      throw e
    } finally {
      saving.value = false
    }
  }

  async function restartRecognition(): Promise<void> {
    await $fetch('/api/asr/restart', { method: 'POST' })
  }

  return {
    config, // 可写（v-model 需要），写操作通过 saveConfig 调用
    loading: readonly(loading),
    saving: readonly(saving),
    error: readonly(error),
    fetchConfig,
    saveConfig,
    restartRecognition,
    hasColdChanges,
    HOT_RELOAD_KEYS,
  }
}
```

- [ ] **Step 2: 验证语法**

运行: `pnpm typecheck`
预期: 通过

---

### Task 11: 创建 ToastNotification 全局组件

**Files:**

- Create: `components/common/ToastNotification.vue`
- Read reference: `composables/useNotification.ts`（接口）

- [ ] **Step 1: 创建组件**

```vue
<template>
  <Teleport to="body">
    <div class="toast-container">
      <TransitionGroup name="toast">
        <div
          v-for="item in notifications"
          :key="item.id"
          :class="['toast-item', `toast-${item.type}`]"
        >
          <UIcon :name="iconMap[item.type]" class="toast-icon" />
          <span class="toast-message">{{ item.message }}</span>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
const { notifications } = useNotification()

const iconMap: Record<string, string> = {
  success: 'i-heroicons-check-circle',
  error: 'i-heroicons-x-circle',
  warning: 'i-heroicons-exclamation-triangle',
  info: 'i-heroicons-information-circle',
}
</script>

<style scoped>
.toast-container {
  position: fixed;
  top: 1rem;
  right: 1rem;
  z-index: 9999;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  pointer-events: none;
}

.toast-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  border-radius: 0.5rem;
  font-size: 0.875rem;
  pointer-events: auto;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  max-width: 360px;
}

.toast-success {
  background: #065f46;
  color: #d1fae5;
}
.toast-error {
  background: #991b1b;
  color: #fee2e2;
}
.toast-warning {
  background: #92400e;
  color: #fef3c7;
}
.toast-info {
  background: #1e40af;
  color: #dbeafe;
}

.toast-icon {
  flex-shrink: 0;
  width: 1.25rem;
  height: 1.25rem;
}

.toast-enter-active {
  transition: all 0.3s ease-out;
}
.toast-leave-active {
  transition: all 0.2s ease-in;
}
.toast-enter-from {
  opacity: 0;
  transform: translateX(2rem);
}
.toast-leave-to {
  opacity: 0;
  transform: translateX(2rem);
}
</style>
```

- [ ] **Step 2: 验证语法**

运行: `pnpm typecheck`
预期: 通过

---

### Task 12: 创建 ConfirmDialog 通用确认弹窗

**Files:**

- Create: `components/common/ConfirmDialog.vue`

- [ ] **Step 1: 创建组件**

```vue
<template>
  <Teleport to="body">
    <Transition name="dialog">
      <div v-if="visible" class="dialog-overlay" @click.self="onCancel">
        <div class="dialog-panel">
          <h3 class="dialog-title">{{ title }}</h3>
          <p class="dialog-message">{{ message }}</p>
          <div class="dialog-actions">
            <UButton color="gray" variant="ghost" @click="onCancel">{{ cancelText }}</UButton>
            <UButton :color="confirmColor" @click="onConfirm">{{ confirmText }}</UButton>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
interface Props {
  visible?: boolean
  title?: string
  message?: string
  confirmText?: string
  cancelText?: string
  confirmColor?: string
}

withDefaults(defineProps<Props>(), {
  visible: false,
  title: '确认操作',
  message: '',
  confirmText: '确认',
  cancelText: '取消',
  confirmColor: 'red',
})

const emit = defineEmits<{
  confirm: []
  cancel: []
}>()

function onConfirm() {
  emit('confirm')
}
function onCancel() {
  emit('cancel')
}
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
}

.dialog-panel {
  background: var(--color-gray-900, #1f2937);
  border: 1px solid var(--color-gray-700, #374151);
  border-radius: 0.75rem;
  padding: 1.5rem;
  max-width: 400px;
  width: 90%;
}

.dialog-title {
  font-size: 1.125rem;
  font-weight: 600;
  margin: 0 0 0.5rem;
  color: var(--color-gray-100, #f3f4f6);
}
.dialog-message {
  font-size: 0.875rem;
  color: var(--color-gray-400, #9ca3af);
  margin: 0 0 1.5rem;
}
.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}

.dialog-enter-active {
  transition: opacity 0.2s ease-out;
}
.dialog-leave-active {
  transition: opacity 0.15s ease-in;
}
.dialog-enter-from,
.dialog-leave-to {
  opacity: 0;
}
</style>
```

- [ ] **Step 2: 验证语法**

运行: `pnpm typecheck`
预期: 通过（Nuxt auto-imports `UButton`）

---

### Task 13: 在 app.vue 挂载 ToastNotification

**Files:**

- Modify: `app.vue`

- [ ] **Step 1: 修改 app.vue**

```vue
<template>
  <div>
    <NuxtRouteAnnouncer />
    <NuxtPage />
    <ToastNotification />
  </div>
</template>

<style>
@import '~/assets/css/main.css';
</style>
```

`ToastNotification` 由 Nuxt auto-import 自动解析，无需手动导入。

- [ ] **Step 2: 验证构建**

运行: `pnpm typecheck`
预期: 通过

---

### Task 14: 创建 AdminWSTestPanel 组件

**Files:**

- Create: `components/admin/AdminWSTestPanel.vue`
- Read reference: `pages/admin.vue`（提取 WS 测试 UI）

- [ ] **Step 1: 创建组件**

```vue
<template>
  <UCard>
    <template #header>
      <h3 class="panel-title">WS 事件测试面板</h3>
    </template>

    <div class="ws-tester">
      <div class="form-group">
        <label class="form-label">消息类型</label>
        <USelect
          v-model="tester.wsMessageType.value"
          :options="messageTypeOptions"
          class="form-select"
        />
      </div>

      <div class="form-group">
        <label class="form-label">文本</label>
        <UTextarea v-model="tester.formFields.value.text" rows="2" />
      </div>

      <div v-if="tester.wsMessageType.value === 'confirmed'" class="form-group">
        <label class="form-label">Subtitle ID</label>
        <UInput v-model="tester.formFields.value.subtitleId" placeholder="留空自动生成" />
      </div>

      <div class="form-group">
        <label class="form-label">优化文本</label>
        <UTextarea v-model="tester.formFields.value.optimizedText" rows="1" />
      </div>

      <div class="form-group">
        <label class="form-label">英文文本</label>
        <UTextarea v-model="tester.formFields.value.enText" rows="1" />
      </div>

      <UButton
        color="blue"
        block
        :loading="tester.wsSendLoading.value"
        @click="tester.handleSendWsMessage"
      >
        发送
      </UButton>

      <!-- 发送日志 -->
      <div v-if="tester.wsSendLog.value.length" class="ws-log">
        <div class="log-header">发送记录（最近 50 条）</div>
        <div v-for="entry in tester.wsSendLog.value" :key="entry.id" class="log-entry">
          <span class="log-time">{{ entry.time }}</span>
          <span class="log-type">{{ entry.type }}</span>
          <code class="log-data">{{ JSON.stringify(entry.data) }}</code>
        </div>
      </div>
    </div>
  </UCard>
</template>

<script setup lang="ts">
const tester = useAdminWSTester()

const messageTypeOptions = [
  { label: 'current (实时字幕)', value: 'current' },
  { label: 'confirmed (确认字幕)', value: 'confirmed' },
  { label: 'init (初始化)', value: 'init' },
  { label: 'clear (清空)', value: 'clear' },
]
</script>

<style scoped>
.panel-title {
  font-size: 1rem;
  font-weight: 600;
}
.form-group {
  margin-bottom: 0.75rem;
}
.form-label {
  display: block;
  font-size: 0.8125rem;
  color: var(--color-gray-400, #9ca3af);
  margin-bottom: 0.25rem;
}
.ws-log {
  margin-top: 1rem;
}
.log-header {
  font-size: 0.75rem;
  color: var(--color-gray-500, #6b7280);
  margin-bottom: 0.25rem;
}
.log-entry {
  font-size: 0.75rem;
  padding: 0.25rem 0;
  border-bottom: 1px solid var(--color-gray-800, #1f2937);
  display: flex;
  gap: 0.5rem;
  align-items: baseline;
}
.log-time {
  color: var(--color-gray-500, #6b7280);
  flex-shrink: 0;
}
.log-type {
  color: var(--color-blue-400, #60a5fa);
  flex-shrink: 0;
}
.log-data {
  color: var(--color-gray-300, #d1d5db);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
```

- [ ] **Step 2: 验证语法**

运行: `pnpm typecheck`
预期: 通过

---

### Task 15: 更新 ControlPanel 使用 useAdminSimulator

**Files:**

- Modify: `components/admin/ControlPanel.vue`

- [ ] **Step 1: 重构组件使用 composable**

用 `useAdminSimulator` composable 替代 props + emits 模式。**注意**：当前 ControlPanel 使用 Cyberpunk/Scifi 风格（Orbitron 字体、扫描线、发光效果）。本次重构将视觉风格统一为 Nuxt UI 组件风格，与其他面板（AIControlPanel、AdminWSTestPanel）保持一致：

```vue
<template>
  <UCard>
    <template #header>
      <div class="panel-header">
        <h3 class="panel-title">模拟控制面板</h3>
        <UBadge :color="simulator.isRunning.value ? 'green' : 'gray'" variant="subtle">
          {{ simulator.isRunning.value ? '运行中' : '已停止' }}
        </UBadge>
      </div>
    </template>

    <div class="control-body">
      <!-- 延迟调节 -->
      <div class="form-group">
        <label class="form-label">延迟: {{ simulator.currentDelay.value }}ms</label>
        <URange v-model="delayValue" :min="500" :max="10000" :step="100" />
        <div class="delay-presets">
          <UBadge
            v-for="d in [500, 1000, 2000, 5000, 10000]"
            :key="d"
            :color="delayValue === d ? 'blue' : 'gray'"
            variant="subtle"
            class="delay-badge"
            @click="delayValue = d"
          >
            {{ d }}ms
          </UBadge>
        </div>
      </div>

      <!-- 控制按钮 -->
      <div class="control-actions">
        <UButton
          v-if="!simulator.isRunning.value"
          color="green"
          block
          :loading="simulator.isLoading.value"
          @click="simulator.handleStart(delayValue)"
        >
          启动模拟
        </UButton>
        <template v-else>
          <UButton color="red" :loading="simulator.isLoading.value" @click="simulator.handleStop()">
            停止模拟
          </UButton>
          <UButton
            color="orange"
            variant="ghost"
            :loading="simulator.isLoading.value"
            @click="simulator.handleClear()"
          >
            清空字幕
          </UButton>
        </template>
      </div>
    </div>
  </UCard>
</template>

<script setup lang="ts">
const simulator = useAdminSimulator()

const delayValue = ref(simulator.currentDelay.value)
watch(simulator.currentDelay, (val) => {
  delayValue.value = val
})

// 自动开始轮询
onMounted(() => {
  simulator.startPolling()
})
onUnmounted(() => {
  simulator.cleanup()
})
</script>

<style scoped>
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.panel-title {
  font-size: 1rem;
  font-weight: 600;
}
.form-group {
  margin-bottom: 1rem;
}
.form-label {
  display: block;
  font-size: 0.8125rem;
  color: var(--color-gray-400, #9ca3af);
  margin-bottom: 0.25rem;
}
.delay-presets {
  display: flex;
  gap: 0.375rem;
  margin-top: 0.5rem;
  flex-wrap: wrap;
}
.delay-badge {
  cursor: pointer;
}
.control-actions {
  display: flex;
  gap: 0.5rem;
}
.control-body {
  padding-top: 0.5rem;
}
</style>
```

- [ ] **Step 2: 验证语法**

运行: `pnpm typecheck`
预期: 通过

---

### Task 16: 更新 AIControlPanel

**Files:**

- Modify: `components/admin/AIControlPanel.vue`

- [ ] **Step 1: 增加测试连接按钮 + 取消 env fallback + 改用 PUT**

在现有 AIControlPanel 中添加测试连接功能：

```vue
<template>
  <UCard>
    <template #header>
      <div class="panel-header">
        <h3 class="panel-title">AI 控制面板</h3>
        <UBadge :color="isAIActive ? 'green' : 'gray'" variant="subtle">
          {{ statusText }}
        </UBadge>
      </div>
    </template>

    <div v-if="loading" class="flex-center py-4">
      <UIcon name="i-heroicons-arrow-path" class="animate-spin" />
    </div>

    <div v-else-if="error" class="error-card">
      <UIcon name="i-heroicons-exclamation-triangle" />
      <span>{{ error }}</span>
      <UButton size="xs" color="gray" variant="ghost" @click="fetchConfig">重试</UButton>
    </div>

    <div v-else class="ai-form">
      <div class="form-group">
        <label class="form-label">Base URL</label>
        <UInput v-model="baseUrl" placeholder="https://api.openai.com/v1" />
      </div>

      <div class="form-group">
        <label class="form-label">API Key</label>
        <UInput v-model="apiKey" type="password" :placeholder="apiKeyHint || 'sk-...'" />
      </div>

      <div class="form-group">
        <label class="form-label">模型名称</label>
        <UInput v-model="modelName" placeholder="gpt-4o-mini" />
      </div>

      <div class="form-group">
        <label class="form-label">功能开关</label>
        <div class="toggle-row">
          <UToggle v-model="polishEnabled" />
          <span>润色</span>
          <UToggle v-model="translationEnabled" />
          <span>翻译</span>
        </div>
      </div>

      <div class="action-row">
        <UButton color="gray" variant="ghost" :loading="testing" @click="handleTest">
          测试连接
        </UButton>
        <UButton color="blue" :loading="saving" @click="saveConfig"> 保存配置 </UButton>
      </div>

      <p v-if="testResult" :class="['test-result', testResult.ok ? 'test-ok' : 'test-fail']">
        {{ testResult.ok ? '连接成功' : `连接失败: ${testResult.error}` }}
      </p>
    </div>
  </UCard>
</template>

<script setup lang="ts">
const baseUrl = ref('')
const apiKey = ref('')
const modelName = ref('')
const polishEnabled = ref(false)
const translationEnabled = ref(false)

const loading = ref(false)
const saving = ref(false)
const testing = ref(false)
const error = ref('')
const apiKeyHint = ref('')
const testResult = ref<{ ok: boolean; error?: string } | null>(null)

const isAIActive = computed(() => polishEnabled.value || translationEnabled.value)
const statusText = computed(() => (isAIActive.value ? 'AI 已启用' : 'AI 未启用'))

async function fetchConfig() {
  loading.value = true
  error.value = ''
  try {
    const data = await $fetch<{
      baseUrl: string
      apiKeyConfigured: boolean
      apiKeyHint: string
      modelName: string
      polishEnabled: boolean
      translationEnabled: boolean
    }>('/api/ai/config')
    baseUrl.value = data.baseUrl
    apiKey.value = ''
    modelName.value = data.modelName
    polishEnabled.value = data.polishEnabled
    translationEnabled.value = data.translationEnabled
    apiKeyHint.value = data.apiKeyHint
  } catch (e: unknown) {
    error.value = e instanceof Error ? e.message : '加载配置失败'
  } finally {
    loading.value = false
  }
}

async function saveConfig() {
  saving.value = true
  error.value = ''
  try {
    const body: Record<string, unknown> = {
      baseUrl: baseUrl.value,
      modelName: modelName.value,
      polishEnabled: polishEnabled.value,
      translationEnabled: translationEnabled.value,
    }
    if (apiKey.value) {
      body.apiKey = apiKey.value
    }
    await $fetch('/api/ai/config', { method: 'PUT', body })
    apiKey.value = ''
    testResult.value = null
    useNotification().success('AI 配置已保存')
    await fetchConfig()
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '保存失败'
    useNotification().error(`保存失败: ${msg}`)
  } finally {
    saving.value = false
  }
}

async function handleTest() {
  testing.value = true
  testResult.value = null
  try {
    const result = await $fetch<{ ok: boolean; error?: string }>('/api/ai/test', {
      method: 'POST',
      body: {
        baseUrl: baseUrl.value,
        apiKey: apiKey.value,
        modelName: modelName.value,
      },
    })
    testResult.value = result
    if (result.ok) {
      useNotification().success('连接成功')
    } else {
      useNotification().error(`连接失败: ${result.error}`)
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : '测试失败'
    testResult.value = { ok: false, error: msg }
    useNotification().error(`测试失败: ${msg}`)
  } finally {
    testing.value = false
  }
}

onMounted(fetchConfig)
</script>

<style scoped>
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.panel-title {
  font-size: 1rem;
  font-weight: 600;
}
.ai-form {
  max-width: 100%;
}
.form-group {
  margin-bottom: 0.75rem;
}
.form-label {
  display: block;
  font-size: 0.8125rem;
  color: var(--color-gray-400, #9ca3af);
  margin-bottom: 0.25rem;
}
.toggle-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.action-row {
  display: flex;
  justify-content: space-between;
  margin-top: 1rem;
}
.test-result {
  font-size: 0.8125rem;
  margin-top: 0.5rem;
}
.test-ok {
  color: #4ade80;
}
.test-fail {
  color: #f87171;
}
.error-card {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem;
  background: rgba(153, 27, 27, 0.2);
  border-radius: 0.5rem;
  color: #fca5a5;
}
.flex-center {
  display: flex;
  justify-content: center;
  align-items: center;
}
</style>
```

- [ ] **Step 2: 验证语法**

运行: `pnpm typecheck`
预期: 通过

---

### Task 17: 更新 TranscriptionControlPanel

**Files:**

- Modify: `components/admin/TranscriptionControlPanel.vue`
- Read reference: `composables/useASRConfig.ts`（接口）
- Read reference: Spec 第七节（参数分类）

- [ ] **Step 1: 拆分高级设置为三区（音频采集 + 热更新 + 需重启）**

在现有 TranscriptionControlPanel 中，将 `showAdvanced` 区域重构为三个独立分区。关键改动：

1. 引入 `useASRConfig` composable
2. 将 `advancedSettings` 拆分为三个分区
3. 音频采集参数（`targetSampleRate`、`chunkDurationMs`、`echoCancellation`、`noiseSuppression`）独立展示，标注为浏览器端设置
4. 热更新参数保存后调用 `PUT /api/asr/config` + Toast
5. 需重启参数（`provider`）保存后提示重启

由于该组件代码量较大（原 ~500 行），此处给出模板部分的修改方案。现有 `<template>` 中的 `showAdvanced` 区域替换为：

```vue
<!-- 高级设置（替换原有 showAdvanced 区域） -->
<div v-if="showAdvanced" class="advanced-section">
  <!-- 音频采集参数（浏览器端） -->
  <div class="config-zone">
    <h4 class="zone-title">音频采集参数（浏览器端设置）</h4>
    <div class="config-grid">
      <div class="form-group">
        <label class="form-label">输出采样率</label>
        <USelect
          v-model="audioCaptureSettings.targetSampleRate"
          :options="[8000, 16000, 22050, 44100, 48000].map(v => ({ label: `${v} Hz`, value: v }))"
        />
      </div>
      <div class="form-group">
        <label class="form-label">分块大小 (ms)</label>
        <UInput v-model.number="audioCaptureSettings.chunkDurationMs" type="number" />
      </div>
      <div class="form-group">
        <label class="form-label">回声消除</label>
        <UToggle v-model="audioCaptureSettings.echoCancellation" />
      </div>
      <div class="form-group">
        <label class="form-label">降噪</label>
        <UToggle v-model="audioCaptureSettings.noiseSuppression" />
      </div>
    </div>
    <p class="zone-hint">变更后需重启麦克风采集流生效</p>
  </div>

  <!-- 热更新参数（即时生效） -->
  <div class="config-zone">
    <h4 class="zone-title">热更新参数（保存即时生效）</h4>
    <div class="config-grid">
      <div class="form-group">
        <label class="form-label">VAD 阈值</label>
        <UInput v-model.number="asrConfig.config.value.vadThreshold" type="number" step="0.1" min="0" max="1" />
      </div>
      <div class="form-group">
        <label class="form-label">VAD 最大缓冲 (秒)</label>
        <UInput v-model.number="asrConfig.config.value.vadMaxBufferSec" type="number" step="0.1" />
      </div>
      <div class="form-group">
        <label class="form-label">VAD 最小缓冲 (秒)</label>
        <UInput v-model.number="asrConfig.config.value.vadMinBufferSec" type="number" step="0.1" />
      </div>
      <div class="form-group">
        <label class="form-label">VAD 静音检测 (ms)</label>
        <UInput v-model.number="asrConfig.config.value.vadSilenceMs" type="number" />
      </div>
      <div class="form-group">
        <label class="form-label">温度</label>
        <UInput v-model.number="asrConfig.config.value.temperature" type="number" step="0.1" min="0" max="2" />
      </div>
      <div class="form-group">
        <label class="form-label">中间结果</label>
        <UToggle v-model="asrConfig.config.value.sendPartial" />
      </div>
      <div class="form-group">
        <label class="form-label">最短句长</label>
        <UInput v-model.number="asrConfig.config.value.sentenceMinLen" type="number" min="1" />
      </div>
      <div class="form-group">
        <label class="form-label">回滚 token</label>
        <UInput v-model.number="asrConfig.config.value.rollbackNum" type="number" min="0" />
      </div>
      <div class="form-group">
        <label class="form-label">语言</label>
        <USelect
          v-model="asrConfig.config.value.language"
          :options="[{ label: '中文', value: 'zh' }, { label: '英文', value: 'en' }]"
        />
      </div>
      <div class="form-group">
        <label class="form-label">重叠 (秒)</label>
        <UInput v-model.number="asrConfig.config.value.overlapSec" type="number" step="0.1" />
      </div>
      <div class="form-group">
        <label class="form-label">记忆块数</label>
        <UInput v-model.number="asrConfig.config.value.memoryChunks" type="number" min="0" />
      </div>
    </div>
    <UButton color="green" :loading="asrConfig.saving.value" @click="saveHotConfig">
      保存（即时生效）
    </UButton>
  </div>

  <!-- 需重启参数 -->
  <div class="config-zone">
    <h4 class="zone-title">需重启参数</h4>
    <div class="config-grid">
      <div class="form-group">
        <label class="form-label">引擎选择</label>
        <USelect
          v-model="asrConfig.config.value.provider"
          :options="availableProviders.map(p => ({ label: p, value: p }))"
        />
      </div>
    </div>
    <UButton color="orange" :loading="asrConfig.saving.value" @click="saveColdConfig">
      保存（需重启）
    </UButton>
  </div>
</div>
```

`<script setup>` 追加：

```typescript
import { useASRConfig } from '~/composables/useASRConfig'

const asrConfig = useASRConfig()
const confirmRestart = ref(false)

// 音频采集参数（独立于 ASR 引擎参数）
const audioCaptureSettings = reactive({
  targetSampleRate: 16000,
  chunkDurationMs: 200,
  echoCancellation: true,
  noiseSuppression: true,
})

async function saveHotConfig() {
  try {
    const resp = await asrConfig.saveConfig(asrConfig.config.value)
    if (resp.status === 'applied') {
      useNotification().success('参数已保存，已即时生效')
    }
  } catch {
    useNotification().error(`保存失败: ${asrConfig.error.value}`)
  }
}

async function saveColdConfig() {
  try {
    const resp = await asrConfig.saveConfig(asrConfig.config.value)
    if (resp.status === 'needs_restart') {
      confirmRestart.value = true
    } else if (resp.status === 'saved') {
      useNotification().success('参数已保存')
    }
  } catch {
    useNotification().error(`保存失败: ${asrConfig.error.value}`)
  }
}

async function handleRestart() {
  await asrConfig.restartRecognition()
  confirmRestart.value = false
  useNotification().success('已重启，新参数已生效')
}
```

模板中追加 ConfirmDialog：

```vue
<ConfirmDialog
  :visible="confirmRestart"
  title="需要重启识别服务"
  :message="`以下参数需要重启才能生效：引擎。是否立即重启？`"
  @confirm="handleRestart"
  @cancel="
    confirmRestart = false
    useNotification().info('参数已保存，将在下次启动时生效')
  "
/>
```

注意：此文件改动量较大，以下为关键函数的完整改版：

```typescript
// 替换原有 buildASRConfig() —— 直接使用 asrConfig.config，不再手动构建
// 原 buildASRConfig() 调用全部替换为 asrConfig.config.value

// 替换原有 syncASRConfig() —— 直接赋值
// 原 syncASRConfig(data) 替换为: asrConfig.config.value = asrConfigToCamel(data)

// 替换原有 fetchASRConfig() —— 使用 composable
// 原 fetchASRConfig() 替换为: await asrConfig.fetchConfig()

// 新增：音频发送静默失败计数器（Spec 第八节要求）
const audioSendFailCount = ref(0)
const AUDIO_SEND_FAIL_THRESHOLD = 30

function trackAudioSendResult(success: boolean) {
  if (success) {
    audioSendFailCount.value = 0
  } else {
    audioSendFailCount.value++
    if (audioSendFailCount.value >= AUDIO_SEND_FAIL_THRESHOLD) {
      useNotification().error(`音频发送连续失败 ${audioSendFailCount.value} 次，请检查网络连接`)
      audioSendFailCount.value = 0 // 重置，避免重复提示
    }
  }
}

// hasColdChanges 可用于保存前预判断（来自 useASRConfig），前端可据此高亮需重启的参数
```

原有的 `onMounted` 中 `fetchASRConfig()` → 改为 `asrConfig.fetchConfig()`。

原有的音频/识别启停逻辑（`toggleAudio`、`toggleRecognition`）保持不变，仅需在 `sendAudioChunk` 调用后追加 `trackAudioSendResult(result)` 调用。

- [ ] **Step 2: 验证语法**

运行: `pnpm typecheck`
预期: 通过（可能需要根据实际 UI 库 API 微调）

---

### Task 18: 重构 admin.vue 为纯布局编排

**Files:**

- Modify: `pages/admin.vue`

- [ ] **Step 1: 简化为布局编排**

admin.vue 移除所有内联状态逻辑，改为使用 composables + 子组件：

```vue
<template>
  <div class="admin-layout">
    <!-- Header -->
    <header class="admin-header">
      <div class="header-left">
        <UIcon name="i-heroicons-cog-6-tooth" class="header-icon" />
        <span class="header-title">ServiceLiveTrans Admin</span>
      </div>
      <div class="header-right">
        <span class="header-time">{{
          currentTime.toLocaleTimeString('zh-CN', { hour12: false })
        }}</span>
        <UButton size="xs" color="gray" variant="ghost" to="/">
          <UIcon name="i-heroicons-arrow-left" />
          返回前台
        </UButton>
      </div>
    </header>

    <!-- 状态栏 -->
    <div class="status-bar">
      <UBadge :color="transcriptionState === 'running' ? 'green' : 'gray'" variant="subtle">
        {{ transcriptionState === 'running' ? '● 广播中' : '○ 待机' }}
      </UBadge>
      <span class="status-text">连接 {{ connectionCount }}</span>
      <span class="status-text">字幕 {{ subtitleCount }}</span>
    </div>

    <!-- 主体：2 列网格 -->
    <div class="admin-grid">
      <TranscriptionControlPanel
        :connection-count="connectionCount"
        :subtitle-count="subtitleCount"
        @status-change="transcriptionState = $event"
        @counts-update="
          ($conn, $sub) => {
            connectionCount = $conn
            subtitleCount = $sub
          }
        "
      />
      <AIControlPanel />
      <ControlPanel />
      <AdminWSTestPanel />
    </div>

    <!-- Footer -->
    <footer class="admin-footer">
      <span>ServiceLiveTrans v1.0</span>
    </footer>
  </div>
</template>

<script setup lang="ts">
definePageMeta({ layout: false })

/** 识别状态: idle | starting | running | stopping | error */
const transcriptionState = ref<string>('idle')
const connectionCount = ref(0)
const subtitleCount = ref(0)
const currentTime = ref(new Date())

let timeTimer: ReturnType<typeof setInterval> | null = null

onMounted(() => {
  timeTimer = setInterval(() => {
    currentTime.value = new Date()
  }, 1000)
})

onUnmounted(() => {
  if (timeTimer) {
    clearInterval(timeTimer)
    timeTimer = null
  }
})
</script>

<style>
/* 移除 Google Fonts @import url()，使用系统等宽字体 */
.admin-layout {
  min-height: 100vh;
  background: var(--color-gray-950, #030712);
  color: var(--color-gray-100, #f3f4f6);
  font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Consolas, monospace;
}

.admin-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem 1.5rem;
  border-bottom: 1px solid var(--color-gray-800, #1f2937);
  background: var(--color-gray-900, #111827);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.header-title {
  font-size: 1.125rem;
  font-weight: 700;
}
.header-right {
  display: flex;
  align-items: center;
  gap: 1rem;
}
.header-time {
  font-size: 0.875rem;
  color: var(--color-gray-400, #9ca3af);
}

.status-bar {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.5rem 1.5rem;
  border-bottom: 1px solid var(--color-gray-800, #1f2937);
  background: var(--color-gray-900, #111827);
}

.status-text {
  font-size: 0.8125rem;
  color: var(--color-gray-400, #9ca3af);
}

.admin-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
  padding: 1rem 1.5rem;
}

@media (max-width: 1024px) {
  .admin-grid {
    grid-template-columns: 1fr;
  }
}

.admin-footer {
  padding: 0.75rem 1.5rem;
  border-top: 1px solid var(--color-gray-800, #1f2937);
  font-size: 0.75rem;
  color: var(--color-gray-600, #4b5563);
}
</style>
```

- [ ] **Step 2: 验证语法**

运行: `pnpm typecheck`
预期: 通过

- [ ] **Step 3: 验证构建**

运行: `pnpm build`
预期: 构建成功

---

## 验证检查清单

全部任务完成后，依次运行：

```bash
pnpm typecheck       # TypeScript 类型检查
pnpm lint            # ESLint 检查
pnpm format:check    # Prettier 格式检查
pnpm build           # 生产构建
```

所有检查通过后进入 review 阶段。

---

### Task 19: 更新 CLAUDE.md

**Files:**

- Modify: `CLAUDE.md`

- [ ] **Step 1: 更新项目文档**

在 `CLAUDE.md` 中更新以下章节：

**前端结构 — Composables** 中新增：

```
- `useAdminSimulator` — 模拟器状态管理（isRunning / isLoading / handleStart / handleStop / handleClear）
- `useAdminWSTester` — WS 测试面板状态 + 表单逻辑
- `useASRConfig` — ASR 配置读写 + 热/冷分类判断 + 重启
```

**前端结构 — 组件** 中新增：

```
- `components/admin/AdminWSTestPanel.vue` — WS 事件测试面板
- `components/common/ToastNotification.vue` — 全局 Toast（基于 useNotification）
- `components/common/ConfirmDialog.vue` — 通用确认弹窗（Teleport 渲染）
```

**后端结构** 中新增：

```
- `server/routes/api/asr/config.ts` — ASR 配置 GET/PUT
- `server/routes/api/asr/restart.ts` — 冷重启 POST
- `server/routes/api/ai/test.ts` — AI 连接测试 POST
```

- [ ] **Step 2: 提交**

```bash
git add CLAUDE.md
git commit -m "docs: 更新 CLAUDE.md — admin 重构后文件结构"
```
