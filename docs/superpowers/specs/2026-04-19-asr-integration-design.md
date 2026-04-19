# ASR 集成设计

## 概述

为 ServiceLiveTrans 接入真实 ASR（语音识别）后端，支持 faster-whisper 和 FunASR 两个 provider，替代现有模拟器。Python ASR 进程独立运行，Nuxt 服务通过 WebSocket 与之通信。

## 需求

- 支持两个 ASR provider：faster-whisper（本地 large-v3 微调模型）、FunASR（paraformer-zh-streaming）
- 本地 GPU 推理，复用 `trans` conda 环境
- 音频源：浏览器麦克风、直播流 URL
- 中英双语，不做多语言自动检测
- 模型空闲自动卸载，避免长期占用 GPU
- Nuxt 端对模型加载/卸载无感，Python 端自治管理
- 保留手动管理接口供调试/管理用

## 整体架构

```
┌─────────────┐     WS(PCM)      ┌──────────────┐    WS(PCM)    ┌──────────────────┐
│  浏览器       │ ──────────────→ │  Nuxt 服务     │ ───────────→ │  Python ASR 进程  │
│  (麦克风采集)  │                 │  (Node.js)    │              │                  │
│             │ ←── WS(字幕) ── │              │ ←─ WS(结果) ─ │  ┌─────────────┐ │
└─────────────┘                 └──────────────┘              │  │ Whisper     │ │
                                       ↑                       │  │ Provider    │ │
                                       │                       │  ├─────────────┤ │
                                ┌──────┴───────┐              │  │ FunASR      │ │
                                │  直播流拉取    │ ── PCM ───→ │  │ Provider    │ │
                                │  (服务端)      │              │  └─────────────┘ │
                                └──────────────┘              └──────────────────┘
```

三个角色，职责清晰：

1. **Python ASR 进程** — 纯转录引擎，暴露 WebSocket 服务（端口 9900）
2. **Nuxt 服务** — 中间层 + 业务逻辑，管理与 Python 的 WS 长连接，负责 AI 优化、翻译、广播
3. **浏览器** — 音频采集 + 字幕展示

Python ASR 进程对前端完全透明。Nuxt 的 WS 消息格式（`current`/`confirmed`）保持不变，前端零改动。

## Python ASR 进程设计

### ASRProvider 统一接口

```python
class ASRProvider(ABC):
    @abstractmethod
    async def start(self) -> None: ...

    @abstractmethod
    async def send_audio(self, chunk: bytes) -> None:
        """接收 16kHz 单声道 PCM 音频块"""

    @abstractmethod
    async def stop(self) -> None: ...

    def on_result(self, callback: Callable[[ASRResult], None]) -> None:
        """注册结果回调"""
```

### 转录结果类型

```python
class ResultType(Enum):
    PARTIAL = "partial"    # 中间结果，正在说话
    FINAL = "final"        # 一句话说完的最终结果

@dataclass
class ASRResult:
    type: ResultType
    text: str              # 转录文本
    language: str          # "zh" | "en"
```

只返回纯文本，不做翻译。翻译和优化是 Nuxt 层的职责。

### Provider 差异处理

| | faster-whisper | FunASR |
|---|---|---|
| 分块策略 | 自行实现：累积 ~3s 音频 + VAD 检测断句 | 原生流式：直接推送 chunk |
| VAD | 内置 Silero VAD | 内置 fsmn-vad |
| partial 输出 | 对累积的音频做推理，返回部分结果 | 原生支持 |
| final 触发 | VAD 检测到静音 → 对完整段落做最终推理 | 服务端检测句尾 |

### 模型生命周期管理

参考 `../transcribe-service/server.py` 的 ModelManager 模式。

**Nuxt 端无需感知模型状态。** Nuxt 只管发音频，Python 端自动处理加载/卸载。

```python
class ModelManager:
    idle_timeout: int = 300          # 空闲 5 分钟后卸载
    current_provider: str | None
    current_model: ASRProvider | None
    last_activity: float
    lock: threading.Lock

    async def ensure_loaded(self, provider: str, model_name: str) -> ASRProvider:
        """按需加载，如果切换 provider 则先卸载旧的"""
        if self.current_provider == provider:
            self.last_activity = time.time()
            return self.current_model
        await self.unload()
        self.current_model = create_provider(provider, model_name)
        await self.current_model.start()
        self.current_provider = provider
        self.last_activity = time.time()
        return self.current_model

    async def unload(self) -> None:
        """卸载模型，释放 GPU 显存"""
        if self.current_model:
            await self.current_model.stop()
            del self.current_model
            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
            self.current_model = None
            self.current_provider = None

    async def idle_monitor(self) -> None:
        """后台定时检查，空闲超时自动卸载"""
        while True:
            if (self.current_model
                and time.time() - self.last_activity > self.idle_timeout):
                logger.info(f"空闲超时，卸载 {self.current_provider}")
                await self.unload()
            await asyncio.sleep(60)
```

自动管理逻辑：

1. 收到 audio chunk → 模型未加载则自动加载 → 更新 last_activity → 转发给 Provider
2. 最后一次 audio 后 → idle_timeout 到期 → 自动卸载释放 GPU
3. 再次收到 audio chunk → 自动重新加载
4. OOM 时自动切回 CPU 重试（参考 transcribe-service）

### Python WS 服务协议

**Nuxt → Python（主流程，极简）：**

```
{ "type": "config", "provider": "whisper", "model": "large-v3" }  // 可选，切换 provider 时发
{ "type": "audio", "data": "<base64 PCM>" }                       // 直接发音频
```

**Python → Nuxt（转录结果）：**

```
{ "type": "partial", "text": "正在说", "language": "zh" }
{ "type": "final", "text": "完整句子。", "language": "zh" }
{ "type": "error", "message": "..." }
```

**状态事件（Nuxt 不必须处理，供日志/调试用）：**

```
Python → Nuxt:
{ "type": "loading" }        // 模型开始加载
{ "type": "ready" }          // 模型加载完毕
{ "type": "unloaded" }       // 模型已卸载（空闲超时）
```

**手动管理接口（可选，调试/管理用）：**

```
Nuxt → Python:
{ "type": "model/load",    "provider": "whisper" }   // 预加载
{ "type": "model/unload" }                            // 手动卸载
{ "type": "model/status" }                            // 查询状态

Python → Nuxt:
{ "type": "model/status", "loaded": true, "provider": "whisper",
  "gpu_used_mb": 3200, "idle_seconds": 120 }
```

## Nuxt 端集成

### 与模拟器的关系

Python ASR 和模拟器是两个并列的数据源，共享相同的输出格式，互斥运行。

```
模拟器 (simulator.ts) ──→ broadcast(current/confirmed) ──→ 前端
Python ASR (asr-bridge.ts) ──→ broadcast(current/confirmed) ──→ 前端
```

### asr-bridge.ts

`asr-bridge.ts` 内部完成协议转换，Python 返回的 `partial`/`final` 映射到现有的 `current`/`confirmed`：

- `partial` → `broadcast({ type: 'current', data: { text, ... } })`
- `final` → `broadcast({ type: 'confirmed', data: { id, text, ... } })`

```typescript
interface ASRBridgeConfig {
  url: string             // ws://localhost:9900
  provider: 'whisper' | 'funasr'
  model: string
}

function startASR(config: ASRBridgeConfig): boolean
function stopASR(): void
```

### 音频流：浏览器麦克风

需要扩展前端→服务端的 WS 协议（目前是单向的）：

```typescript
// 新增：前端 → 服务端
type WSClientMessage =
  | { type: 'audio', data: string }   // base64 PCM chunk

// 服务端 → 前端：保持不变，沿用现有 current/confirmed/clear
```

流程：浏览器 `MediaRecorder` → 16kHz PCM → WS 发给 Nuxt → base64 编码 → WS 转发给 Python → 推理 → 结果广播给前端。

### 音频流：直播流 URL

Nuxt 服务端启动 ffmpeg 进程拉取直播流，提取音频降采样为 16kHz PCM，逐 chunk 发给 Python ASR。浏览器不参与音频传输。

```
POST /api/stream/start  { url: "rtmp://..." }  → 启动 ffmpeg → 逐 chunk 转发
POST /api/stream/stop                             → 停止 ffmpeg
```

### 新增 REST API

```
POST /api/asr/start   { provider, model, source: "mic"|"stream", streamUrl? }
POST /api/asr/stop
GET  /api/asr/status  → { active, provider, source, modelLoaded }
```

### 会话状态

```typescript
interface ASRState {
  isActive: boolean
  provider: 'whisper' | 'funasr'
  source: 'mic' | 'stream' | null
  streamUrl?: string
  modelLoaded: boolean
}
```

## 错误处理

| 场景 | Python 行为 | Nuxt 行为 |
|------|------------|-----------|
| Python 进程未启动 | Nuxt 连接失败 | 显示"ASR 服务未连接" |
| 模型加载失败 | `{ type: "error" }` | 日志 + 前端提示 |
| 推理 OOM | 自动切 CPU 重试 | 日志警告 |
| Python 进程崩溃 | 连接断开 | 自动重连 + 恢复模拟器模式 |
| Provider 依赖未安装 | 该 provider 禁用 | UI 隐藏该选项 |

## 项目结构

### Python ASR 进程（新目录）

```
asr/                          # Python ASR 服务，独立于 Nuxt
├── server.py                 # WS 服务入口，连接管理
├── providers/
│   ├── base.py               # ASRProvider 抽象基类
│   ├── whisper.py            # faster-whisper 实现
│   └── funasr.py             # FunASR 实现
├── model_manager.py          # 模型自动加载/卸载
├── protocol.py               # WS 消息类型定义
└── config.yaml               # 默认配置
```

### Nuxt 端新增/修改

```
server/utils/
├── asr-bridge.ts             # [新增] Python ASR WS 桥接
├── simulator.ts              # [不变] 模拟器
└── websocket.ts              # [不变] 广播
server/routes/api/
├── asr/
│   ├── start.ts              # [新增] 启动 ASR 会话
│   ├── stop.ts               # [新增] 停止 ASR 会话
│   └── status.ts             # [新增] ASR 状态查询
├── stream/
│   └── start.ts              # [新增] 启动直播流拉取（ffmpeg）
composables/
├── useWebSocket.ts           # [修改] 支持双向通信，增加音频发送
components/admin/
├── ASRControlPanel.vue       # [新增] ASR 控制面板
├── ModelStatusPanel.vue      # [新增] 模型状态显示
pages/
├── admin.vue                 # [修改] 集成 ASR 控制面板
```

## 配置

### config.yaml

```yaml
server:
  host: "0.0.0.0"
  port: 9900
  idle_timeout: 300        # 秒
  check_interval: 60       # 秒

whisper:
  model: "../livetrans/whisperlive/models/faster-whisper-large-v3"
  device: "cuda"
  compute_type: "int8"
  local_files_only: true
  vad_filter: true
  vad_parameters:
    threshold: 0.5

funasr:
  model: "paraformer-zh-streaming"
  vad_model: "fsmn-vad"
  device: "cuda"
```

whisper 配置复用 livetrans 的参数：本地 large-v3 微调模型、int8 量化、Silero VAD。

### conda 环境

复用 `trans` conda 环境（Python 3.10.15, torch 2.8.0+cu128）。

已有：faster-whisper 1.0.1, websockets 13.1, torch 2.8.0
需安装：funasr（`pip install funasr`，无冲突）

Provider 可用性运行时检测，未安装的自动禁用：

```python
def get_available_providers() -> list[str]:
    providers = []
    try:
        import faster_whisper
        providers.append("whisper")
    except ImportError:
        pass
    try:
        from funasr import AutoModel
        providers.append("funasr")
    except ImportError:
        pass
    return providers
```

### 启动方式

```bash
conda activate trans
python asr/server.py           # Python ASR 服务，端口 9900
pnpm dev                       # Nuxt 开发服务器，端口 3000
```

## 范围边界

本次设计仅覆盖 ASR 集成本身。以下不在范围内：

- AI 优化和翻译（Nuxt 层未来功能）
- 转录稿持久化和导出
- 聚会预约功能
- 云端 API 支持（OpenAI Whisper API、阿里云 Paraformer API）
