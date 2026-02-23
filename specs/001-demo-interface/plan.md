# Implementation Plan: Demo Interface

**Branch**: `001-demo-interface` | **Date**: 2026-02-23 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-demo-interface/spec.md`

## Summary

创建演示界面，包含前台（实时字幕展示）和后台（控制中心）两个页面。使用 WebSocket 实现实时通信，后台模拟随机生成中英文字幕并推送到前台。支持三种语言显示模式（仅中文/仅英文/双语），字幕包含原始文本、优化文本和翻译文本三个字段，采用两阶段更新策略。

## Technical Context

**Language/Version**: TypeScript 5.x (Nuxt 4)
**Primary Dependencies**: Nuxt 4, Vue 3, Nuxt UI, @nuxt/icon, crossws (WebSocket)
**Storage**: N/A (演示阶段无需持久化，用户偏好使用 localStorage)
**Testing**: Vitest (Nuxt 内置)
**Target Platform**: Web (现代浏览器)
**Project Type**: web-application (Nuxt 全栈)
**Performance Goals**: 原始字幕延迟 <500ms，优化翻译延迟 1-3秒
**Constraints**: 支持 10 并发连接
**Scale/Scope**: 演示项目，2个页面，核心实时通信功能

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. API-First Architecture | ✅ PASS | 前后端通过 WebSocket API 通信，API 契约在 contracts/ 中定义 |
| II. Real-Time Priority | ✅ PASS | 使用 WebSocket 实时推送，延迟目标 <500ms 符合要求 |
| III. Modular ASR Backend | ⏸️ DEFER | 演示阶段不需要真正 ASR，使用模拟器替代 |
| IV. Data Reliability | ⏸️ DEFER | 演示阶段不需要持久化，后续功能迭代时实现 |
| V. Simplicity First | ✅ PASS | 最简实现：2页面 + WebSocket + 模拟器，无多余抽象 |

**Gate Result**: PASS - 核心原则符合，ASR 和持久化按计划延后

## Project Structure

### Documentation (this feature)

```text
specs/001-demo-interface/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── websocket-api.md
└── tasks.md             # Phase 2 output (via /speckit.tasks)
```

### Source Code (repository root)

```text
/
├── pages/
│   ├── index.vue           # 前台：实时字幕展示页面
│   └── admin.vue           # 后台：控制中心页面
├── components/
│   ├── common/
│   │   └── ConnectionStatus.vue  # 连接状态指示器
│   ├── display/
│   │   ├── SubtitleDisplay.vue   # 字幕显示区域
│   │   ├── ActiveSubtitle.vue    # 正在转录的字幕
│   │   └── ConfirmedSubtitle.vue # 已确认的字幕
│   ├── admin/
│   │   ├── ControlPanel.vue      # 控制面板
│   │   └── StatusPanel.vue       # 状态面板
│   └── settings/
│       └── LanguageToggle.vue    # 语言模式切换
├── composables/
│   ├── useWebSocket.ts     # WebSocket 连接管理
│   └── useSubtitles.ts     # 字幕状态管理
├── server/
│   ├── routes/
│   │   └── api/
│   │       ├── ws.ts       # WebSocket 端点
│   │       ├── clear.ts    # 清空字幕 API
│   │       ├── simulate/
│   │       │   ├── start.ts # 开始模拟
│   │       │   └── stop.ts  # 停止模拟
│   │       └── status.ts   # 状态查询
│   └── utils/
│       ├── websocket.ts    # WebSocket 广播工具
│       ├── simulator.ts    # 模拟字幕生成器
│       └── sample-data.ts  # 示例字幕数据
├── types/
│   └── subtitle.ts         # 字幕类型定义
├── nuxt.config.ts          # Nuxt 配置
└── app.vue                 # 根组件
```

**Structure Decision**: 采用 Nuxt 全栈结构，前后端代码在同一项目中。server/ 目录存放后端 API 和工具，pages/ 和 components/ 存放前端页面和组件。

## Complexity Tracking

> 无违规需要说明，设计符合 Simplicity First 原则。
