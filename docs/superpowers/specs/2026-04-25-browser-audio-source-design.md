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

## 数据流

```
                    ┌─ source=mic ──→ useAudioCapture ──→ AudioWorklet ──┐
                    │         (实时 PCM chunks)                           │
                    │                                                     ↓
ASRControlPanel ────┤         WS { type: 'audio', data: base64Pcm }      │
                    │                                                     ↓
                    ├─ source=file ─→ decodeAudioData ──→ 定时切片 ───────┤
                    │         (模拟实时速率, 可 seek)                      │
                    │                                                     ↓
                    └─ source=stream → 服务端 ffmpeg 拉流 (现有逻辑)       │
                                                                          ↓
                                                              server WS handler
                                                                          ↓
                                                              sendAudioChunk()
                                                                          ↓
                                                              ASR Bridge → Python ASR
```

source=mic 和 source=file 的音频数据都走同一条前端→服务端 WS 通道，服务端无感知。

## UI 设计

### ASRControlPanel 布局

```
PROVIDER
[whisper] [funasr]

SOURCE
[Microphone] [Stream URL] [File]

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

───── source=stream 时显示 ─────
STREAM URL
[rtmp://...]                   ← 现有逻辑不变

───── 三种源共享 ─────
[▼ ADVANCED SETTINGS]          ← 折叠区域，默认收起
┌────────────────────────────┐
│ SAMPLE RATE    [16000 ▾]   │  ← 选项: 8000 / 16000 / 48000; mic 有效, file 忽略
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
4. 点 START ASR → POST `/api/asr/start`（source=mic 或 source=stream）→ 服务端连接 ASR Bridge
5. 服务端返回成功 → 前端开始捕获或播放
7. 音频 chunks 通过 WS `{ type: 'audio', data: base64Pcm }` 发送
8. 点 STOP → 前端停止捕获/播放 → POST `/api/asr/stop`

### 错误处理

- **麦克风权限被拒**：显示错误提示，不启动 ASR
- **设备断开**（耳机拔出等）：`devicechange` 事件刷新列表，当前设备丢失则暂停并提示
- **浏览器不支持 AudioWorklet**：显示兼容性错误
- **文件解码失败**：显示不支持的格式提示
- **WS 断开**：前端自动重连（现有 `useWebSocket` 已实现）

## 技术细节

### 麦克风源

- `navigator.mediaDevices.enumerateDevices()` 获取音频输入设备列表
- `getUserMedia({ audio: { deviceId, sampleRate, channelCount, echoCancellation, noiseSuppression } })` 捕获
- AudioWorklet 将浏览器采样率重采样到目标采样率（默认 16kHz），输出 Int16 PCM
- AnalyserNode 接入音频图，用于波形可视化
- 高级设置中的 sampleRate、echoCancellation、noiseSuppression 传入 getUserMedia 约束

### 文件源

- `<input type="file" accept="audio/*">` 选择文件
- `AudioContext.decodeAudioData(arrayBuffer)` 解码为 AudioBuffer（支持 mp3/wav/flac/m4a/ogg 等）
- 按 chunkSize（ms）切片 AudioBuffer，每个切片转 Int16 PCM → base64
- `setInterval(chunkDuration)` 逐片发送，模拟实时速率
- 进度条：`<input type="range" min=0 max=duration step=0.01>`，拖拽时暂停发送、seek 后继续
- 文件波形：遍历 AudioBuffer 采样绘制静态波形图，播放指针位置实时更新
- 播放结束：自动停止发送，ASR 不自动停止

### 波形可视化

- **mic**：用 AnalyserNode.getByteTimeDomainData() 获取实时波形数据，requestAnimationFrame 绘制
- **file**：解码后一次性绘制静态波形（降采样后绘制柱状或线条），播放指针用垂直线标记当前位置
- Canvas 宽度填满面板，高度固定（如 60px），颜色沿用面板主题（#38bdf8 青蓝色）

### 带宽与延迟

- 16kHz mono 16bit PCM = 256 Kbps 原始
- Base64 编码后 ≈ 340 Kbps（100ms chunk，约 4.2 KB/chunk，10 chunks/s）
- 浏览器端额外延迟：~100ms（AudioWorklet 缓冲）
- 不压缩传输，340 Kbps 对局域网和普通宽带无压力

## 改动文件清单

| 文件 | 改动类型 | 描述 |
|------|----------|------|
| `components/admin/ASRControlPanel.vue` | 大改 | 三种源的 UI、设备枚举、波形 canvas、文件选择、进度条、高级设置折叠 |
| `composables/useAudioCapture.ts` | 修改 | 支持 deviceId 参数、可配采样率/降噪等、返回 AnalyserNode 用于波形 |
| `composables/useAudioFilePlayer.ts` | 新建 | 文件解码、定时切片发送、进度控制、seek、静态波形数据生成 |
| `public/audio-worklet-processor.js` | 修改 | targetSampleRate 从硬编码改为可配置（通过 AudioWorkletNode message 传入） |
| 后端 | 无改动 | WS handler 和 ASR Bridge 现有逻辑完全复用 |

## 不做的事

- 不引入音频压缩（Opus 等），当前带宽足够
- 不做服务端改动
- 不拆独立组件，三种源逻辑内聚在 ASRControlPanel 中
- 不实现文件上传到服务端，文件始终在浏览器端解码和切片
