# Research: Demo Interface

**Feature**: 001-demo-interface
**Date**: 2026-02-23

## Research Topics

### 1. Nuxt 4 WebSocket 实现

**Decision**: 使用 Nuxt Nitro 内置的 WebSocket 支持 (crossws)

**Rationale**:
- Nuxt 4 通过 `nitro.experimental.websocket` 配置原生支持 WebSocket
- crossws 是跨平台的 WebSocket 实现，与 Nuxt 深度集成
- 无需额外依赖，符合 Simplicity First 原则

**Alternatives Considered**:
- Socket.IO: 功能更丰富但过于复杂，演示项目不需要
- 自定义 WebSocket 服务器: 需要额外部署，增加复杂度

**Implementation**:
```typescript
// nuxt.config.ts
export default defineNuxtConfig({
  nitro: {
    experimental: {
      websocket: true
    }
  }
})
```

### 2. 前端状态管理策略

**Decision**: 使用 Vue Composables (组合式函数)

**Rationale**:
- 符合 Nuxt/Vue 3 最佳实践
- 对于演示项目的规模，composables 足够简洁
- 避免引入 Pinia 的额外复杂度
- 响应式状态自动同步

**Alternatives Considered**:
- Pinia: 对于 2 个页面的演示项目过于重量级
- Vuex: 已被 Pinia 取代，不推荐使用

**Implementation**:
- `useWebSocket.ts`: 管理 WebSocket 连接状态
- `useSubtitles.ts`: 管理字幕数据和显示逻辑

### 3. 模拟字幕生成策略

**Decision**: 预设句子库 + 随机选择 + 逐字输出

**Rationale**:
- 可以控制演示内容的质量和可读性
- 逐字输出模拟真实转录体验
- 随机选择保证每次演示内容不同

**Implementation Details**:
- 准备 20-30 条中英文对照句子
- 随机选择句子后，按字逐个输出
- 输出速度可配置（默认每 100-200ms 一个字）
- 句子完成后等待 1-2 秒再开始下一句

### 4. 两阶段更新机制

**Decision**: 原始文本立即推送，优化翻译延迟推送

**Rationale**:
- 模拟真实 ASR 的工作流程
- 用户体验：先看到原始内容，再看到优化版本
- 延迟可配置（默认 2 秒 ± 1 秒随机值）

**Implementation**:
```typescript
// 1. 立即推送原始文本
broadcast({ type: 'active', data: { rawText, translatedText } })

// 2. 延迟后推送优化版本
setTimeout(() => {
  broadcast({ type: 'confirmed', data: { id, rawText, optimizedText, translatedText } })
}, delayMs)
```

### 5. 语言显示模式

**Decision**: 使用 localStorage 保存用户偏好

**Rationale**:
- 简单有效，无需后端支持
- 刷新页面后保持设置
- 符合 Simplicity First 原则

**Implementation**:
- 使用 `useLocalStorage` composable (VueUse)
- 三种模式: 'chinese' | 'english' | 'bilingual'

## Resolved Clarifications

| Item | Resolution |
|------|------------|
| WebSocket 实现 | Nuxt Nitro + crossws |
| 状态管理 | Vue Composables |
| 模拟数据 | 预设句子库，随机选择 |
| 延迟机制 | setTimeout + 随机偏移 |
| 偏好存储 | localStorage |

## Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| nuxt | ^4.3.1 | 核心框架 |
| @nuxt/ui | ^4.4.0 | UI 组件库 |
| @nuxt/icon | ^2.2.1 | 图标库 |
| crossws | (内置) | WebSocket 支持 |

## Next Steps

Phase 1 将基于以上研究结果生成：
1. `data-model.md` - 字幕实体和状态定义
2. `contracts/websocket-api.md` - WebSocket 消息格式
3. `quickstart.md` - 开发环境启动指南
