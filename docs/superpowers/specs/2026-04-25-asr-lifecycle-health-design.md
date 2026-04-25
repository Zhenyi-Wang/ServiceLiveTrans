# ASR 服务生命周期管理与健康检查 设计文档

## 目标

管理面板能启动/停止 Python ASR 服务，实时显示服务状态，实现一键式 ASR 体验。

## 背景

当前 ASR 服务（`asr/server.py`，Qwen3-ASR + GGUF，端口 9900）需要手动通过 `start.sh` 启动（`conda activate trans && python asr/server.py`）。管理面板只能连接已运行的服务，无法启动或感知服务状态。

## 设计

### 一、Python 端：同端口 HTTP health 端点

在 `asr/server.py` 的 `serve()` 调用中添加 `process_request` 回调，拦截非 WebSocket 的 HTTP 请求。

**端点**：`GET /health`（端口 9900，与 WebSocket 同端口）

**响应**：
```json
{
  "status": "ok",
  "available_providers": ["gguf"],
  "model_loaded": true,
  "provider": "gguf",
  "gpu_used_mb": 256,
  "idle_seconds": 12.5
}
```

`model_loaded` 为 false 时 `status` 仍为 `"ok"`（服务进程正常，只是模型未加载）。

**实现方式**：`websockets` 库的 `process_request` 参数。WebSocket 连接以 HTTP GET + Upgrade 头发起，`process_request` 在升级前拦截，检查路径是否为 `/health`，是则返回 HTTP 200 JSON，否则返回 `None` 让 websockets 继续处理 WebSocket 升级。

```python
async def health_handler(path, request_headers):
    if path == "/health":
        body = json.dumps(get_health_data()).encode()
        return (http.HTTPStatus.OK, [("Content-Type", "application/json")], body)
    return None  # 继续走 WebSocket
```

### 二、Nuxt 后端：进程管理

**新增 `server/utils/asr-process.ts`**：

职责：
- 检测 ASR 服务是否已运行（端口 9900 探测）
- spawn / kill Python ASR 进程
- 查询 ASR 服务健康状态

**Conda 环境 Python 路径检测**（按优先级）：
1. 环境变量 `ASR_PYTHON_PATH`（显式配置）
2. 常见 conda 路径探测：`~/miniconda3/envs/trans/bin/python`、`~/anaconda3/envs/trans/bin/python`、`~/miniconda/envs/trans/bin/python`
3. 执行 `conda run -n trans which python` 回退

**核心函数**：

```
startASRProcess(): Promise<{ pid: number } | null>
  1. 检测 9900 端口是否已被占用
  2. 已占用 → 返回 null（用户手动启动的）
  3. 未占用 → spawn: { pythonPath } asr/server.py
     - cwd: 项目根目录
     - stdio: 'pipe'（捕获日志）
     - env: 继承 process.env + 设置 PYTHONUNBUFFERED=1
  4. 设置 selfStarted = true
  5. 返回 { pid }

stopASRProcess(): void
  1. 如果 selfStarted → tree-kill 进程（含子进程）
  2. 如果非 selfStarted → 不操作（只断 WebSocket）
  3. 重置 selfStarted

getASRServiceHealth(): Promise<ServiceHealth>
  1. HTTP GET http://localhost:9900/health，超时 3s
  2. 返回解析后的 JSON
  3. 连接失败 → 返回 { status: "offline" }
```

**修改现有 API**：

`POST /api/asr/start`：
1. 调用 `startASRProcess()`（可能 spawn 进程）
2. 轮询 `getASRServiceHealth()` 直到 `status === "ok"`（最多等 60s）
3. health 就绪后调用 `startASR()` 建 WebSocket 连接
4. 返回 `{ success, spawned: boolean }`

`POST /api/asr/stop`：
1. 调用 `stopASR()` 断 WebSocket
2. 调用 `stopASRProcess()` kill 进程（如果是自启的）
3. 返回 `{ success }`

`GET /api/asr/service-health`（新增）：
- 代理 `getASRServiceHealth()` 的结果
- 前端轮询用

### 三、前端：实时状态显示

**状态枚举**：
| 状态 | 显示 | 颜色 |
|------|------|------|
| `offline` | OFFLINE | 灰 |
| `starting` | STARTING | 黄（脉冲动画） |
| `ready` | READY | 绿 |
| `error` | ERROR | 红 |

**轮询机制**：
- 使用 VueUse 的 `useIntervalFn` 每 3 秒调用 `GET /api/asr/service-health`
- ASR 面板挂载时开始轮询，卸载时停止

**UI 变化**：
- ASR CONTROL 面板头部：在 PROVIDER 按钮上方或旁边显示服务状态徽章
- START ASR 按钮：点击后进入 loading 状态（显示 "STARTING..."），等待后端 spawn + health 就绪
- 如果启动失败（超时或异常），显示错误信息

### 四、边界情况

- **用户手动启动了 ASR 服务**：`startASRProcess()` 检测到 9900 端口已占用，返回 null，`selfStarted = false`。STOP ASR 时只断 WebSocket，不杀进程。
- **Nuxt 重启**：`selfStarted` 标志丢失。下次 start 时检测到端口已占用，不会重复 spawn。stop 时不会误杀。
- **ASR 进程崩溃**：前端轮询 health 发现 offline，状态自动变回 OFFLINE。
- **端口冲突**：spawn 前检测端口，避免重复启动。
- **conda 环境不存在**：`startASRProcess()` 返回错误信息，前端显示 "Python 环境未找到"。

## 文件变更清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `asr/server.py` | 修改 | 添加 `process_request` health handler |
| `server/utils/asr-process.ts` | 新增 | 进程管理（spawn/kill/health） |
| `server/routes/api/asr/start.ts` | 修改 | 启动前 spawn 进程，轮询 health |
| `server/routes/api/asr/stop.ts` | 修改 | 停止时 kill 进程 |
| `server/routes/api/asr/service-health.ts` | 新增 | 健康状态代理端点 |
| `components/admin/ASRControlPanel.vue` | 修改 | 服务状态显示、按钮 loading 状态 |
