# 浏览器音频源设计

## 目标

在管理后台 ASR 控制面板中支持三种音频源：浏览器麦克风、本地音频文件、FLV 直播流。用户选择音频源后点击启动，音频数据通过 WebSocket 实时传输到服务端 ASR 进行转录。

## 背景

现有管道已就绪：
- `useAudioCapture` composable 已实现浏览器麦克风捕获（Web Audio API + AudioWorkletNode），输出 16kHz mono 16bit PCM，每次 100ms chunk
- WebSocket handler（`server/routes/api/ws.ts`）已支持接收 `audio` 类型消息并转发给 `sendAudioChunk()` → ASR Bridge → Python ASR
- `audio-source/mic.ts` 存在但未实现（服务端 MicSource）
- ASRControlPanel 已有 source 选择（mic/stream），但 mic 选项没有设备选择和波形 UI

本次改动集中在**前端 UI 集成**，后端零改动。

## 与现有控制面板的关系

管理后台目前有三个控制面板，各自管理不同的后端路径：

| 面板 | API 路径 | 音频数据来源 | 适用场景 |
|------|----------|-------------|---------|
| AdminControlPanel | `/api/simulate/*` | 无（模拟文本） | 开发调试 |
| AdminASRControlPanel | `/api/asr/*` | 前端 WS 推送（mic/file）或服务端 ffmpeg（stream） | 直接 ASR 转录 |
| AdminLiveTransControl | `/api/live/*` | 服务端 ffmpeg（FLV 流） | 带重连/状态广播的直播转录 |

**互斥规则**：ASRControlPanel 和 LiveTransControl 共享同一个全局 ASR Bridge 单例。同时启动两者会导致 provider 冲突（LiveTransManager 硬编码 `provider: 'gguf'`，而 ASRControlPanel 允许选择 `whisper`/`funasr`）。实施时需要确保：

1. 启动任一面板时，如果另一面板正在运行，先停止对方
2. 前端通过 `/api/asr/status` 和 `/api/live/status` 检测冲突，在 UI 上给出提示
3. ASRControlPanel 的 stream 选项与 LiveTransControl 功能重叠，**移除 ASRControlPanel 的 stream 选项**，ASRControlPanel 仅保留 mic 和 file 两种源。直播流场景统一由 LiveTransControl 管理。

## 数据流

```
                    ┌─ source=mic ──→ useAudioCapture ──→ AudioWorklet ──┐
                    │         (实时 PCM chunks)                           │
                    │                                                     ↓
ASRControlPanel ────┤         WS { type: 'audio', data: base64Pcm }      │
                    │                                                     ↓
                    └─ source=file ─→ decodeAudioData ──→ 定时切片 ───────┤
                              (模拟实时速率, 可 seek)                      │
                                                                          ↓
                                                              server WS handler
                                                                          ↓
                                                              sendAudioChunk()
                                                                          ↓
                                                              ASR Bridge → Python ASR
```

source=mic 和 source=file 的音频数据都走同一条前端→服务端 WS 通道，服务端无感知。两种源在 POST `/api/asr/start` 时统一使用 `source: 'mic'`（因为数据路径相同，都是前端 WS 推送）。

## UI 设计

### ASRControlPanel 布局

```
PROVIDER
[whisper] [funasr]

SOURCE
[Microphone] [File]                ← 移除 Stream URL，统一由 LiveTransControl 管理

───── source=mic 时显示 ─────
DEVICE
[默认麦克风 ▾]                  ← 枚举所有音频输入设备，devicechange 自动刷新

WAVEFORM                        ← 实时波形 canvas
┌────────────────────────────┐
│ ∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿∿ │
└────────────────────────────┘
                                ← 运行时显示，未运行时灰色占位

───── source=file 时显示 ─────
AUDIO FILE
[选择文件...] recording.mp3
Duration: 03:45

━━━━━━━━●━━━━━━━━━━━━━━━     ← 可拖拽进度条
01:23 / 03:45

WAVEFORM                        ← 整段文件静态波形 + 播放指针
┌────────────────────────────┐
│ ≈≈≈≈≈≈≈●≈≈≈≈≈≈≈≈≈≈≈≈≈≈ │  ← 点击/拖拽可 seek
└────────────────────────────┘

[PLAY] [PAUSE]                 ← 播放控制按钮

───── 两种源共享 ─────
[▼ ADVANCED SETTINGS]          ← 折叠区域，默认收起
┌────────────────────────────┐
│ OUTPUT SAMPLE RATE [16000] │  ← 目标输出采样率(传给 AudioWorklet)，不影响输入采样率
│ CHUNK SIZE     [100 ▾]     │  ← 选项: 50 / 100 / 200 (ms); mic 和 file 均有效
│ ECHO CANCEL    [✓]         │  ← 仅 mic 有效
│ NOISE SUPPRESS [✓]         │  ← 仅 mic 有效
└────────────────────────────┘

[START ASR] / [STOP ASR]
```

### 启动流程

1. 用户选择 source → 展示对应配置项
2. **source=mic**：选择设备，不立即请求权限
3. **source=file**：选择文件，解码后展示波形和时长
4. 点 START ASR → POST `/api/asr/start`（source=mic，无论实际是 mic 还是 file）→ 服务端连接 ASR Bridge
5. 服务端返回成功 → 前端开始捕获（mic）或播放（file）
6. 音频 chunks 通过 WS `{ type: 'audio', data: base64Pcm }` 发送
7. 点 STOP → 前端停止捕获/播放 → POST `/api/asr/stop`

### 错误处理

- **非安全上下文**：麦克风功能需要 HTTPS 或 localhost 环境，非安全上下文时在 mic 源下显示环境要求提示
- **麦克风权限被拒**：显示错误提示，不启动 ASR
- **设备断开**（耳机拔出等）：`devicechange` 事件刷新列表，当前设备丢失则暂停并提示
- **浏览器不支持 AudioWorklet**：显示兼容性错误
- **文件解码失败**：显示不支持的格式提示
- **WS 断开**：前端自动重连（现有 `useWebSocket` 已实现）
- **面板互斥冲突**：启动时检测 LiveTransControl 是否正在运行，如果是则提示用户先停止直播转录

## 技术细节

### 前置条件

- 麦克风功能需要页面在安全上下文（HTTPS 或 localhost）中运行
- `navigator.mediaDevices` API 需要安全上下文

### 麦克风源

- `navigator.mediaDevices.enumerateDevices()` 获取音频输入设备列表
- `getUserMedia({ audio: { deviceId, channelCount: 1, echoCancellation, noiseSuppression } })` 捕获
  - 注意：`sampleRate` 不是 `MediaTrackConstraints` 的标准属性，大多数浏览器会忽略它，使用硬件默认采样率（通常 48kHz）
- 音频图连接拓扑：
  ```
  MediaStream → MediaStreamSource → AnalyserNode → AudioWorkletNode
  ```
  AnalyserNode 放在 Worklet 前面，分析的是原始采样率的音频数据
- AudioWorklet 将浏览器实际采样率重采样到目标输出采样率（默认 16kHz），输出 Int16 PCM
- `useAudioCapture` 返回值扩展为 `{ isCapturing, start, stop, analyserNode: AnalyserNode }`
- 高级设置中的 echoCancellation、noiseSuppression 传入 getUserMedia 约束
- OUTPUT SAMPLE RATE 设置传给 AudioWorklet 的 `targetSampleRate`，不影响 getUserMedia 的输入采样率

### AudioWorklet 配置协议

通过 `AudioWorkletNode.port.postMessage` 双向通信传递配置：

```javascript
// 在 new AudioWorkletNode() 之后、connect 之前发送
workletNode.port.postMessage({
  type: 'config',
  targetSampleRate: 16000,
  chunkDurationMs: 100
  // _outputChunkSize = targetSampleRate * chunkDurationMs / 1000
  // 例如 16000 * 100 / 1000 = 1600
})
```

`audio-worklet-processor.js` 在 `process()` 中监听 `port.onmessage`，收到 config 消息后更新 `_targetSampleRate` 和 `_outputChunkSize`。`_buffer` 在配置变更时清空。

### 文件源

- `<input type="file" accept="audio/*">` 选择文件
- `AudioContext.decodeAudioData(arrayBuffer)` 解码为 AudioBuffer（支持 mp3/wav/flac/m4a/ogg 等）
- AudioBuffer 的采样率由浏览器解码决定（通常 44100 或 48000），始终降采样到目标输出采样率（与 mic 源保持一致，默认 16kHz）
- 按 chunkSize（ms）切片 AudioBuffer，每个切片降采样后转 Int16 PCM → base64
- `setInterval(chunkDuration)` 逐片发送，模拟实时速率
- 进度条：`<input type="range" min=0 max=duration step=0.01>`，拖拽时暂停发送、seek 后继续
- **Seek 流程**：用户拖拽进度条 → clearInterval 暂停定时器 → 发送 200ms 静音 chunk 让 ASR flush 当前缓冲区 → 计算新位置 → 从新位置恢复 setInterval 发送
- 文件波形：遍历 AudioBuffer 采样绘制静态波形图，播放指针位置实时更新
- 播放结束：自动停止发送，ASR 不自动停止
- AudioContext 生命周期：每次 start 时创建新的 AudioContext（仅用于解码，不持续占用），stop 时关闭。不与 mic 源共享 AudioContext

### 波形可视化

- **mic**：用 AnalyserNode.getByteTimeDomainData() 获取实时波形数据，requestAnimationFrame 绘制
- **file**：解码后一次性绘制静态波形（降采样后绘制柱状或线条），播放指针用垂直线标记当前位置
- Canvas 宽度填满面板，高度固定（如 60px），颜色沿用面板主题色

### 带宽与延迟

- 16kHz mono 16bit PCM = 256 Kbps 原始
- Base64 编码后 ≈ 340 Kbps（100ms chunk，约 4.2 KB/chunk，10 chunks/s）
- 浏览器端额外延迟：~100ms（AudioWorklet 缓冲）
- 不压缩传输，340 Kbps 对局域网和普通宽带无压力

## 改动文件清单

| 文件 | 改动类型 | 描述 |
|------|----------|------|
| `components/admin/ASRControlPanel.vue` | 大改 | 两种源（mic/file）的 UI、设备枚举、波形 canvas、文件选择、进度条、高级设置折叠。移除 stream 选项 |
| `composables/useAudioCapture.ts` | 修改 | 支持 deviceId 参数、可配降噪等、返回 AnalyserNode 用于波形 |
| `composables/useAudioFilePlayer.ts` | 新建 | 文件解码、降采样、定时切片发送、进度控制、seek（含静音 flush）、静态波形数据生成 |
| `composables/useWaveformRenderer.ts` | 新建 | Canvas 波形绘制逻辑（实时波形 + 静态波形 + 播放指针），从 ASRControlPanel 中抽离 |
| `public/audio-worklet-processor.js` | 修改 | targetSampleRate 和 outputChunkSize 从硬编码改为可配置（通过 port message 传入） |
| 后端 | 无改动 | WS handler 和 ASR Bridge 现有逻辑完全复用 |

## 不做的事

- 不引入音频压缩（Opus 等），当前带宽足够
- 不做服务端改动
- 不拆独立的源选择组件，但将 canvas 波形绘制抽到 composable 中避免 ASRControlPanel 膨胀
- 不实现文件上传到服务端，文件始终在浏览器端解码和切片
