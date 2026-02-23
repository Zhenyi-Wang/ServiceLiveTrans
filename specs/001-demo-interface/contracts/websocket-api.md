# WebSocket API Contract

**Feature**: 001-demo-interface
**Date**: 2026-02-23
**Version**: 1.0.0

## Endpoint

```
ws://localhost:3000/api/ws
```

## Connection Lifecycle

### 1. 建立连接

客户端连接后，服务端立即发送初始化消息。

### 2. 心跳（可选）

暂不实现心跳机制，依赖 TCP 层检测断开。

### 3. 断开连接

客户端断开时，服务端自动清理连接状态。

---

## Message Format

所有消息使用 JSON 格式。

### 服务端 → 客户端

#### 初始化消息

连接建立后立即发送，包含当前状态。

```typescript
{
  "type": "init",
  "data": {
    "active": ActiveSubtitle | null,
    "confirmed": ConfirmedSubtitle[]
  }
}
```

#### 正在转录更新

当正在转录的字幕内容更新时发送。

```typescript
{
  "type": "active",
  "data": {
    "rawText": string,
    "translatedText": string
  }
}
```

#### 字幕确认

当字幕段落完成确认时发送。

```typescript
{
  "type": "confirmed",
  "data": {
    "id": string,
    "rawText": string,
    "optimizedText": string,
    "translatedText": string,
    "timestamp": number
  }
}
```

#### 字幕优化更新

当已确认字幕的优化版本准备好时发送。

```typescript
{
  "type": "optimized",
  "data": {
    "id": string,
    "optimizedText": string,
    "translatedText": string
  }
}
```

#### 清空字幕

当后台触发清空时发送。

```typescript
{
  "type": "clear"
}
```

---

## REST API Endpoints

### POST /api/simulate/start

开始模拟字幕生成。

**Request**:
```typescript
{
  "delay"?: number  // 可选，优化延迟（毫秒），默认 2000
}
```

**Response**:
```typescript
{
  "success": true,
  "message": "Simulation started"
}
```

**Errors**:
- `409 Conflict`: 模拟已在运行中

### POST /api/simulate/stop

停止模拟字幕生成。

**Response**:
```typescript
{
  "success": true,
  "message": "Simulation stopped"
}
```

### POST /api/clear

清空所有字幕。

**Response**:
```typescript
{
  "success": true,
  "message": "Subtitles cleared"
}
```

### GET /api/status

获取系统状态。

**Response**:
```typescript
{
  "isRunning": boolean,
  "connectionCount": number,
  "subtitleCount": number,
  "config": {
    "optimizationDelay": number,
    "delayRandomRange": number
  }
}
```

---

## Error Handling

### WebSocket 错误

服务端不主动发送错误消息。连接异常时直接断开。

### REST API 错误

```typescript
{
  "success": false,
  "error": string,
  "code": string
}
```

常见错误码：
- `SIMULATION_ALREADY_RUNNING`: 模拟已在运行
- `SIMULATION_NOT_RUNNING`: 模拟未运行
- `INVALID_PARAMETER`: 参数无效

---

## Examples

### 完整流程示例

```
Client                          Server
  │                               │
  │──── CONNECT /api/ws ─────────▶│
  │                               │
  │◀─── { type: "init" } ─────────│
  │                               │
  │    [操作员点击开始模拟]         │
  │                               │
  │◀─── { type: "active" } ───────│ (原始文本开始)
  │                               │
  │◀─── { type: "active" } ───────│ (原始文本更新)
  │                               │
  │◀─── { type: "confirmed" } ────│ (段落确认，含原始+优化+翻译)
  │                               │
  │◀─── { type: "active" } ───────│ (新段落开始)
  │                               │
  │    [操作员点击清空]             │
  │                               │
  │◀─── { type: "clear" } ────────│
  │                               │
```
