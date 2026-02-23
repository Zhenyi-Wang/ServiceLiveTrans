# Data Model: Demo Interface

**Feature**: 001-demo-interface
**Date**: 2026-02-23

## Entities

### 1. Subtitle (字幕)

字幕分为两种状态：正在转录和已确认。

#### ActiveSubtitle (正在转录字幕)

```typescript
interface ActiveSubtitle {
  /** 原始转录文本 */
  rawText: string
  /** 实时翻译文本（模拟生成） */
  translatedText: string
  /** 开始时间戳 */
  startTime: number
}
```

#### ConfirmedSubtitle (已确认字幕)

```typescript
interface ConfirmedSubtitle {
  /** 唯一标识符 */
  id: string
  /** 原始转录文本 */
  rawText: string
  /** 优化后的文本（AI纠正后） */
  optimizedText: string
  /** 翻译文本 */
  translatedText: string
  /** 创建时间戳 */
  timestamp: number
}
```

### 2. SimulationState (模拟状态)

```typescript
interface SimulationState {
  /** 是否正在运行 */
  isRunning: boolean
  /** 优化翻译延迟（毫秒） */
  optimizationDelay: number  // 默认 2000
  /** 延迟随机范围（毫秒） */
  delayRandomRange: number   // 默认 1000 (±1秒)
  /** 当前正在转录的字幕 */
  activeSubtitle: ActiveSubtitle | null
  /** 已确认的字幕列表 */
  confirmedSubtitles: ConfirmedSubtitle[]
}
```

### 3. ClientConnection (客户端连接)

```typescript
interface ClientConnection {
  /** 连接 ID */
  id: string
  /** WebSocket 连接对象 */
  socket: WebSocket
  /** 连接时间 */
  connectedAt: number
  /** 最后活动时间 */
  lastActivity: number
}
```

### 4. UserPreference (用户偏好)

```typescript
interface UserPreference {
  /** 语言显示模式 */
  languageMode: 'chinese' | 'english' | 'bilingual'
  /** 字体大小 (rem) */
  fontSize: number
}
```

## State Transitions

### 字幕生命周期

```
[开始转录]
    │
    ▼
┌─────────────────┐
│  ActiveSubtitle │  ← 实时更新 rawText, translatedText
│  (正在转录)      │
└────────┬────────┘
         │
         │ 段落确认（句子结束或超时）
         ▼
┌─────────────────┐
│ 立即推送到前端   │  ← 原始文本
└────────┬────────┘
         │
         │ 延迟 (配置值 ± 1秒)
         ▼
┌─────────────────┐
│ ConfirmedSubtitle│  ← 包含优化文本
│  (已确认)        │
└─────────────────┘
         │
         │ 推送更新
         ▼
┌─────────────────┐
│   前端更新显示   │
└─────────────────┘
```

### 模拟器状态

```
┌─────────┐   start()   ┌─────────┐
│ STOPPED │────────────▶│ RUNNING │
└─────────┘              └────┬────┘
     ▲                        │
     │        stop()          │
     └────────────────────────┘
```

## Validation Rules

### ActiveSubtitle
- `rawText`: 非空字符串，最大 500 字符
- `translatedText`: 非空字符串
- `startTime`: 有效时间戳

### ConfirmedSubtitle
- `id`: UUID 格式
- `rawText`: 非空字符串
- `optimizedText`: 非空字符串
- `translatedText`: 非空字符串
- `timestamp`: 有效时间戳

### SimulationState
- `optimizationDelay`: 500 - 10000 毫秒
- `delayRandomRange`: 0 - 5000 毫秒

### UserPreference
- `languageMode`: 枚举值 'chinese' | 'english' | 'bilingual'
- `fontSize`: 0.8 - 3.0

## Data Storage

### 服务端
- `SimulationState`: 内存存储（单例）
- `ClientConnection[]`: 内存存储

### 客户端
- `UserPreference`: localStorage
- `ConfirmedSubtitle[]`: 内存（页面刷新后清空）
