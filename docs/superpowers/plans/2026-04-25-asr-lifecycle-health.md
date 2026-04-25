# ASR 服务生命周期管理与健康检查 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 管理面板能一键启动/停止 Python ASR 服务，实时显示服务状态。

**Architecture:** Python 端在同 WebSocket 端口 (9900) 上添加 HTTP `/health` 端点（通过 websockets 的 `process_request`）。Nuxt 后端新增进程管理模块，负责 spawn/kill Python 进程和代理 health 请求。前端每 3 秒轮询 health，显示服务状态徽章，START ASR 按钮在服务离线时自动 spawn 进程。

**Tech Stack:** Python websockets 16.0 (legacy API), Node.js child_process, Nitro server hooks, VueUse useIntervalFn

**注意：** 本项目没有 lint/test 命令。测试通过 API 请求（curl）和 Playwright 浏览器测试验证。

---

### Task 1: Python 端 — 添加 HTTP /health 端点

**Files:**
- Modify: `asr/server.py`

- [ ] **Step 1: 添加 health handler 和 get_health_data 函数**

在 `asr/server.py` 中添加 `http` import、`get_health_data()` 函数和 `health_handler()` 回调，然后修改 `serve()` 调用传入 `process_request`。

在文件顶部 imports 区域添加 `http`：

```python
import http.server
```

在 `handle_connection` 函数之前添加两个函数：

```python
def get_health_data() -> dict:
    """收集服务健康状态数据"""
    gpu_used = 0
    try:
        import torch
        if torch.cuda.is_available():
            gpu_used = torch.cuda.memory_allocated() // (1024 * 1024)
    except ImportError:
        pass

    return {
        "status": "ok",
        "available_providers": get_available_providers(),
        "model_loaded": manager.is_loaded if manager else False,
        "provider": manager.current_provider if manager else "",
        "gpu_used_mb": gpu_used,
        "idle_seconds": round(manager.idle_seconds, 1) if manager else 0.0,
    }


async def health_handler(path, request_headers):
    """拦截 /health HTTP 请求，其余放行给 WebSocket"""
    if path == "/health":
        body = json.dumps(get_health_data()).encode()
        return (http.HTTPStatus.OK, [("Content-Type", "application/json")], body)
    return None
```

修改 `main()` 函数中的 `serve()` 调用，添加 `process_request` 参数：

```python
    async with serve(handler, config.server_host, config.server_port, ping_interval=None, ping_timeout=None, process_request=health_handler):
```

- [ ] **Step 2: 手动测试 health 端点**

在另一个终端中，先启动 ASR 服务（如果 conda 环境可用），然后用 curl 测试：

```bash
# 启动 ASR 服务（需要 conda trans 环境）
cd /home/zhenyi/ownprojects/servicelivetrans && conda activate trans && python asr/server.py &

# 测试 health 端点
curl http://localhost:9900/health
```

预期返回类似：
```json
{"status":"ok","available_providers":["gguf"],"model_loaded":false,"provider":"","gpu_used_mb":0,"idle_seconds":0.0}
```

如果 conda 环境不可用，跳过此步骤，在 Task 5 集成测试中验证。

- [ ] **Step 3: Commit**

```bash
git add asr/server.py
git commit -m "feat: 为 ASR 服务添加 HTTP /health 端点（同端口）"
```

---

### Task 2: Nuxt 后端 — 进程管理模块

**Files:**
- Create: `server/utils/asr-process.ts`

- [ ] **Step 1: 创建 asr-process.ts**

```typescript
import { spawn, type ChildProcess } from 'child_process'
import { execSync } from 'child_process'
import net from 'net'
import { existsSync } from 'fs'
import { homedir } from 'os'
import path from 'path'

export interface ServiceHealth {
  status: 'ok' | 'offline'
  available_providers?: string[]
  model_loaded?: boolean
  provider?: string
  gpu_used_mb?: number
  idle_seconds?: number
}

let childProcess: ChildProcess | null = null
let selfStarted = false
let cachedPythonPath: string | null = null

const ASR_PORT = 9900

function detectPythonPath(): string {
  if (cachedPythonPath) return cachedPythonPath

  // 1. 环境变量
  if (process.env.ASR_PYTHON_PATH) {
    cachedPythonPath = process.env.ASR_PYTHON_PATH
    console.log(`[ASR Process] 使用 ASR_PYTHON_PATH: ${cachedPythonPath}`)
    return cachedPythonPath!
  }

  // 2. 常见 conda 路径
  const condaPrefixes = [
    path.join(homedir(), 'miniconda3'),
    path.join(homedir(), 'anaconda3'),
    path.join(homedir(), 'miniconda'),
  ]
  for (const prefix of condaPrefixes) {
    const candidate = path.join(prefix, 'envs', 'trans', 'bin', 'python')
    if (existsSync(candidate)) {
      cachedPythonPath = candidate
      console.log(`[ASR Process] 检测到 conda Python: ${cachedPythonPath}`)
      return cachedPythonPath!
    }
  }

  // 3. conda run 回退
  try {
    const result = execSync('conda run -n trans which python', {
      encoding: 'utf-8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe']
    }).trim()
    if (result) {
      cachedPythonPath = result
      console.log(`[ASR Process] 通过 conda run 检测到 Python: ${cachedPythonPath}`)
      return cachedPythonPath!
    }
  } catch {
    // conda run 失败
  }

  throw new Error('未找到 Python 环境。请设置 ASR_PYTHON_PATH 环境变量或安装 conda trans 环境。')
}

function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(true))
    server.once('listening', () => {
      server.close()
      resolve(false)
    })
    server.listen(port, '127.0.0.1')
  })
}

export async function startASRProcess(): Promise<{ pid: number } | null> {
  const portUsed = await isPortInUse(ASR_PORT)
  if (portUsed) {
    console.log(`[ASR Process] 端口 ${ASR_PORT} 已被占用，跳过启动`)
    selfStarted = false
    return null
  }

  const pythonPath = detectPythonPath()
  const projectRoot = path.resolve(process.cwd(), '..')

  console.log(`[ASR Process] 启动: ${pythonPath} asr/server.py`)
  childProcess = spawn(pythonPath, ['asr/server.py'], {
    cwd: projectRoot,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
    detached: false,
  })

  selfStarted = true

  // 监听进程退出
  childProcess.on('exit', (code, signal) => {
    console.log(`[ASR Process] 进程退出: code=${code}, signal=${signal}`)
    if (selfStarted && code !== 0 && code !== null) {
      console.error(`[ASR Process] ASR 服务异常退出，退出码: ${code}`)
    }
    childProcess = null
    selfStarted = false
  })

  return { pid: childProcess.pid }
}

export function stopASRProcess(): void {
  if (!selfStarted || !childProcess) {
    return
  }

  console.log(`[ASR Process] 停止进程 PID: ${childProcess.pid}`)
  childProcess.kill('SIGTERM')
  childProcess = null
  selfStarted = false
}

export async function getASRServiceHealth(): Promise<ServiceHealth> {
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)

    const response = await fetch(`http://127.0.0.1:${ASR_PORT}/health`, {
      signal: controller.signal,
    })
    clearTimeout(timeout)

    if (!response.ok) {
      return { status: 'offline' }
    }

    const data = await response.json()
    return { ...data, status: 'ok' }
  } catch {
    return { status: 'offline' }
  }
}

export function getProcessInfo(): { pid: number | null; selfStarted: boolean } {
  return {
    pid: childProcess?.pid ?? null,
    selfStarted,
  }
}
```

- [ ] **Step 2: 验证文件创建正确**

```bash
cat server/utils/asr-process.ts | head -5
```

预期：看到 `import { spawn, type ChildProcess } from 'child_process'`

- [ ] **Step 3: Commit**

```bash
git add server/utils/asr-process.ts
git commit -m "feat: 添加 ASR 进程管理模块（spawn/kill/health）"
```

---

### Task 3: Nuxt 后端 — Nitro shutdown hook

**Files:**
- Create: `server/plugins/asr-cleanup.ts`

- [ ] **Step 1: 创建 Nitro shutdown hook 插件**

```typescript
import { stopASRProcess } from '../utils/asr-process'

export default defineNitroPlugin(() => {
  useRuntimeHook('close', () => {
    console.log('[ASR Cleanup] Nuxt 关闭，清理 ASR 进程')
    stopASRProcess()
  })
})
```

- [ ] **Step 2: Commit**

```bash
git add server/plugins/asr-cleanup.ts
git commit -m "feat: 添加 Nitro shutdown hook 清理 ASR 进程"
```

---

### Task 4: Nuxt 后端 — API 端点修改

**Files:**
- Modify: `server/routes/api/asr/start.ts`
- Modify: `server/routes/api/asr/stop.ts`
- Create: `server/routes/api/asr/service-health.ts`

- [ ] **Step 1: 修改 start.ts — 异步模式 + spawn 进程 + 移除 provider 校验**

将 `server/routes/api/asr/start.ts` 完整替换为：

```typescript
import { startASR, getASRStatus } from '../../../utils/asr-bridge'
import { startASRProcess } from '../../../utils/asr-process'

export default defineEventHandler(async (event) => {
  const body = await readBody(event).catch(() => ({}))
  const { provider, model, source, streamUrl } = body

  // spawn ASR 进程（如果未运行）
  let spawned = false
  try {
    const result = await startASRProcess()
    spawned = result !== null
  } catch (error: any) {
    throw createError({
      statusCode: 500,
      statusMessage: error.message || 'ASR 进程启动失败'
    })
  }

  const asrStatus = getASRStatus()
  if (asrStatus.isActive) {
    throw createError({
      statusCode: 409,
      statusMessage: 'ASR is already running'
    })
  }

  const url = process.env.ASR_WS_URL || 'ws://localhost:9900'
  startASR(
    { url, provider: provider || 'gguf', model: model || '' },
    source || 'mic',
    streamUrl
  )

  return {
    success: true,
    spawned,
    provider,
    source: source || 'mic'
  }
})
```

- [ ] **Step 2: 修改 stop.ts — 增加 stopASRProcess**

将 `server/routes/api/asr/stop.ts` 完整替换为：

```typescript
import { stopASR } from '../../../utils/asr-bridge'
import { stopASRProcess } from '../../../utils/asr-process'

export default defineEventHandler(() => {
  stopASR()
  stopASRProcess()
  return { success: true, message: 'ASR stopped' }
})
```

- [ ] **Step 3: 创建 service-health.ts**

```typescript
import { getASRServiceHealth, getProcessInfo } from '../../../utils/asr-process'

export default defineEventHandler(async () => {
  const health = await getASRServiceHealth()
  const processInfo = getProcessInfo()

  return {
    ...health,
    process: processInfo,
  }
})
```

- [ ] **Step 4: API 测试 — 验证端点可访问**

启动 Nuxt dev server 后，在另一个终端执行：

```bash
# 测试 service-health 端点（ASR 未启动时应返回 offline）
curl http://localhost:3001/api/asr/service-health
```

预期：
```json
{"status":"offline","process":{"pid":null,"selfStarted":false}}
```

```bash
# 测试 status 端点（现有端点，确认未被破坏）
curl http://localhost:3001/api/asr/status
```

预期：
```json
{"isActive":false,"bridgeStatus":"disconnected","provider":null,"modelLoaded":false}
```

- [ ] **Step 5: Commit**

```bash
git add server/routes/api/asr/start.ts server/routes/api/asr/stop.ts server/routes/api/asr/service-health.ts
git commit -m "feat: 修改 ASR API 端点支持进程管理和健康检查"
```

---

### Task 5: 前端 — ASR 面板集成服务状态

**Files:**
- Modify: `components/admin/ASRControlPanel.vue`
- Modify: `pages/admin.vue`

- [ ] **Step 1: 修改 ASRControlPanel.vue — 添加服务状态显示**

在 `<script setup>` 中添加服务健康状态相关逻辑。在 `const showAdvanced = ref(false)` 之前添加：

```typescript
const serviceHealth = ref<{
  status: 'ok' | 'offline'
  available_providers?: string[]
  process?: { pid: number | null; selfStarted: boolean }
}>({ status: 'offline' })

const serviceStatus = computed(() => {
  if (props.isRunning) return 'ready'
  return serviceHealth.value.status === 'ok' ? 'ready' : 'offline'
})

const serviceStatusText = computed(() => {
  const s = serviceStatus.value
  if (s === 'ready') return 'READY'
  if (s === 'starting') return 'STARTING'
  return 'OFFLINE'
})

const availableProviders = computed(() => {
  return serviceHealth.value.available_providers?.length
    ? serviceHealth.value.available_providers!
    : ['gguf']
})

async function fetchServiceHealth() {
  try {
    const data = await $fetch<{
      status: string
      available_providers?: string[]
      process?: { pid: number | null; selfStarted: boolean }
    }>('/api/asr/service-health')
    serviceHealth.value = {
      status: data.status === 'ok' ? 'ok' : 'offline',
      available_providers: data.available_providers,
      process: data.process,
    }
  } catch {
    serviceHealth.value = { status: 'offline' }
  }
}

const { pause: pauseHealthPoll, resume: resumeHealthPoll } = useIntervalFn(
  fetchServiceHealth,
  3000,
  { immediate: true }
)
```

在 `onMounted` 中调用 `resumeHealthPoll()`（在 `micWaveform.drawIdle()` 之前），在 `onUnmounted` 中调用 `pauseHealthPoll()`。

修改 `handleStart()` 函数，移除 `source: 'mic'` 硬编码：

```typescript
async function handleStart() {
  statusMessage.value = ''

  // 互斥检查：检查 LiveTrans 是否在运行
  try {
    const liveStatus = await $fetch<{ state: string }>('/api/live/status')
    if (liveStatus.state !== 'idle') {
      setStatus('请先停止直播转录', 'error')
      return
    }
  } catch {
    // live status API 不可用时忽略
  }

  emit('start', {
    provider: provider.value,
    model: '',
    source: source.value
  })
}
```

在模板中，在 `<!-- Provider -->` 的 `form-row` 之前添加服务状态显示：

```html
<!-- Service Status -->
<div class="form-row">
  <label class="form-label">SERVICE</label>
  <div class="service-status" :class="serviceStatus">
    <span class="service-dot" />
    <span class="service-text">{{ serviceStatusText }}</span>
    <span v-if="serviceHealth.value.process?.selfStarted" class="service-pid">
      PID {{ serviceHealth.value.process.pid }}
    </span>
  </div>
</div>
```

将模板中 `v-for="p in availableProviders"` 的引用更新：因为 `availableProviders` 现在是 computed ref，模板引用不需要改（仍然是 `availableProviders`），但需要移除 `const availableProviders = ['whisper', 'funasr']` 这行旧代码。

在 `<style scoped>` 中添加样式：

```css
.service-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-radius: 8px;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.7rem;
  letter-spacing: 0.1em;
}

.service-status.ready {
  background: rgba(16, 185, 129, 0.1);
  border: 1px solid rgba(16, 185, 129, 0.3);
  color: #10b981;
}

.service-status.offline {
  background: rgba(100, 116, 139, 0.1);
  border: 1px solid rgba(100, 116, 139, 0.3);
  color: #64748b;
}

.service-status.starting {
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.3);
  color: #f59e0b;
  animation: pulse 1.5s ease-in-out infinite;
}

.service-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  flex-shrink: 0;
}

.service-text {
  font-weight: 600;
}

.service-pid {
  margin-left: auto;
  opacity: 0.6;
  font-size: 0.6rem;
}
```

- [ ] **Step 2: 修改 admin.vue — 适配异步 start 响应**

在 `pages/admin.vue` 的 `handleASRStart` 中，适配新的 API 响应（包含 `spawned` 字段），但逻辑不需要变化（仍然是 start → set running → handleStartSuccess）。

当前代码已经能处理新响应格式（它只用 `$fetch` 发 POST，不依赖响应字段），所以 `admin.vue` **不需要修改**。

- [ ] **Step 3: Playwright 测试 — 验证服务状态显示**

```bash
# 确保 Nuxt dev server 运行在 3001 端口
# 用 Playwright 导航到 admin 页面，检查 ASR CONTROL 面板是否显示 SERVICE OFFLINE 徽章
```

导航到 `http://localhost:3001/admin`，在 ASR CONTROL 面板中验证：
1. 显示 "SERVICE" 标签和 "OFFLINE" 状态（灰色）
2. Provider 按钮仍然显示（回退到 `['gguf']`）

- [ ] **Step 4: Commit**

```bash
git add components/admin/ASRControlPanel.vue
git commit -m "feat: ASR 面板显示服务状态和动态 provider 列表"
```

---

### Task 6: 集成测试 — Playwright 全流程

**Files:** 无新文件

- [ ] **Step 1: 启动 Nuxt dev server**

```bash
pnpm dev
```

- [ ] **Step 2: Playwright 测试 — 离线状态**

1. 导航到 `http://localhost:3001/admin`
2. 验证 ASR CONTROL 面板显示 SERVICE OFFLINE
3. 验证 START ASR 按钮可点击
4. 点击 START ASR
5. 验证按钮变为 STOP ASR（后端 spawn 了进程）
6. 等待几秒，验证 SERVICE 变为 READY（如果 conda 环境可用且模型加载成功）
7. 如果进程启动失败，验证显示错误信息

- [ ] **Step 3: Playwright 测试 — 手动启动的服务**

如果 ASR 服务已经手动启动在 9900 端口：
1. 导航到 `http://localhost:3001/admin`
2. 验证 SERVICE 显示 READY（无需点击 START）
3. 点击 START ASR → 验证正常连接（spawned=false）
4. 点击 STOP ASR → 验证 WebSocket 断开但进程不被 kill
5. 再次 health 轮询 → 验证 SERVICE 仍为 READY（进程未被杀）

- [ ] **Step 4: API 测试 — health 端点**

```bash
# 启动 ASR 服务后测试
curl http://localhost:9900/health
curl http://localhost:3001/api/asr/service-health
```

预期两个都返回 `status: "ok"` 的 JSON。

- [ ] **Step 5: Commit（如有修复）**

如果有测试中发现的 bug 修复：

```bash
git add -A
git commit -m "fix: 修复集成测试中发现的问题"
```
