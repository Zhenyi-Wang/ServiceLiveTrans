# Tasks: Demo Interface

**Feature**: 001-demo-interface
**Branch**: `001-demo-interface`
**Generated**: 2026-02-23

## Overview

本文档包含演示界面的实现任务，按用户故事组织。每个用户故事可以独立实现和测试。

**Total Tasks**: 32
**User Stories**: 4 (2 P1, 2 P2)

---

## Phase 1: Setup

> 项目基础设施配置

- [x] T001 Configure WebSocket support in nuxt.config.ts
- [x] T002 [P] Create types/subtitle.ts with ActiveSubtitle, ConfirmedSubtitle interfaces
- [x] T003 [P] Create types/simulation.ts with SimulationState interface
- [x] T004 [P] Create types/websocket.ts with WSMessage types

---

## Phase 2: Foundational

> 所有用户故事的前置依赖 - WebSocket 基础设施

- [x] T005 Create server/utils/websocket.ts with broadcast function and connection management
- [x] T006 Create server/utils/sample-data.ts with Chinese-English sentence pairs
- [x] T007 Create server/utils/simulator.ts with random subtitle generation logic
- [x] T008 Create server/routes/api/ws.ts WebSocket endpoint with init message
- [x] T009 Create composables/useWebSocket.ts for client-side WebSocket connection

---

## Phase 3: User Story 1 - 听众观看实时字幕 (P1)

> **Goal**: 作为听众，打开网页就能看到实时滚动的字幕
>
> **Independent Test**: 打开前台页面，能看到模拟字幕逐字出现并滚动显示

### Backend Tasks

- [x] T010 [US1] Create composables/useSubtitles.ts for subtitle state management
- [x] T011 [US1] Update server/utils/simulator.ts to broadcast active subtitle updates

### Frontend Components

- [x] T012 [P] [US1] Create components/common/ConnectionStatus.vue
- [x] T013 [P] [US1] Create components/display/ActiveSubtitle.vue for in-progress text
- [x] T014 [P] [US1] Create components/display/ConfirmedSubtitle.vue for confirmed text
- [x] T015 [US1] Create components/display/SubtitleDisplay.vue combining active and confirmed

### Page Integration

- [x] T016 [US1] Create pages/index.vue front-end page with subtitle display and connection status

---

## Phase 4: User Story 2 - 操作员控制模拟字幕 (P1)

> **Goal**: 作为操作员，在后台页面启动/停止模拟字幕
>
> **Independent Test**: 在后台页面点击开始按钮，前台能收到字幕；点击停止，字幕停止生成

### Backend Tasks

- [x] T017 [US2] Create server/routes/api/simulate/start.ts to start simulation
- [x] T018 [US2] Create server/routes/api/simulate/stop.ts to stop simulation
- [x] T019 [US2] Create server/routes/api/clear.ts to clear all subtitles with broadcast

### Frontend Components

- [x] T020 [P] [US2] Create components/admin/ControlPanel.vue with start/stop/clear buttons

### Page Integration

- [x] T021 [US2] Create pages/admin.vue back-end page with control panel

---

## Phase 5: User Story 3 - 听众切换语言显示模式 (P2)

> **Goal**: 作为听众，可以切换显示模式（仅中文/仅英文/双语）
>
> **Independent Test**: 在前台页面切换显示模式，字幕显示相应变化

### Frontend Components

- [x] T022 [US3] Update composables/useSubtitles.ts to add languageMode state with localStorage persistence
- [x] T023 [US3] Create components/settings/LanguageToggle.vue with three options
- [x] T024 [US3] Update components/display/SubtitleDisplay.vue to respect language mode

### Page Integration

- [x] T025 [US3] Update pages/index.vue to include LanguageToggle component

---

## Phase 6: User Story 4 - 操作员查看系统状态 (P2)

> **Goal**: 作为操作员，看到连接数和模拟运行状态
>
> **Independent Test**: 后台页面显示连接数和运行状态

### Backend Tasks

- [x] T026 [US4] Create server/routes/api/status.ts to return system status

### Frontend Components

- [x] T027 [P] [US4] Create components/admin/StatusPanel.vue to display connection count and simulation status

### Page Integration

- [x] T028 [US4] Update pages/admin.vue to include StatusPanel and poll status API

---

## Phase 7: Polish

> 优化和完善

- [x] T029 Add auto-scroll behavior to SubtitleDisplay when new subtitles arrive
- [x] T030 Add reconnection logic to useWebSocket.ts with visual feedback
- [x] T031 Add styling for subtitle animations and transitions
- [x] T032 Add delay configuration UI to admin ControlPanel

---

## Dependencies

```text
Phase 1 (Setup)
    │
    ▼
Phase 2 (Foundational) ← Required for all user stories
    │
    ├──────────────┬──────────────┐
    ▼              ▼              │
Phase 3 (US1)  Phase 4 (US2)     │
    │              │              │
    │              │              │
    ▼              ▼              │
Phase 5 (US3)  Phase 6 (US4)     │
    │              │              │
    └──────────────┴──────────────┘
                   │
                   ▼
           Phase 7 (Polish)
```

**Parallel Opportunities**:
- Phase 3 and Phase 4 can be developed in parallel (both P1)
- Phase 5 and Phase 6 can be developed in parallel (both P2)
- Tasks marked [P] within each phase can run in parallel

---

## Implementation Strategy

### MVP Scope (Recommended)

最小可行产品 = Phase 1 + Phase 2 + Phase 3 + Phase 4

这实现两个 P1 用户故事：
- US1: 听众可以观看实时字幕
- US2: 操作员可以控制模拟

### Incremental Delivery

1. **Sprint 1**: Phase 1-2 (基础架构) - 1-2 天
2. **Sprint 2**: Phase 3-4 (P1 功能) - 2-3 天
3. **Sprint 3**: Phase 5-6 (P2 功能) - 1-2 天
4. **Sprint 4**: Phase 7 (优化) - 1 天

---

## Task Summary by User Story

| User Story | Priority | Tasks | Parallelizable |
|------------|----------|-------|----------------|
| Setup | - | 4 | 3 |
| Foundational | - | 5 | 0 |
| US1 - 实时字幕 | P1 | 7 | 3 |
| US2 - 控制模拟 | P1 | 5 | 1 |
| US3 - 语言切换 | P2 | 4 | 0 |
| US4 - 系统状态 | P2 | 3 | 1 |
| Polish | - | 4 | 0 |
| **Total** | | **32** | **8** |
