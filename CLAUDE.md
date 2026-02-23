# CLAUDE.md

此文件为 Claude Code (claude.ai/code) 在此仓库中工作时提供指导。

## 项目概述

ServiceLiveTrans 是一个实时语音转录服务，支持直播源和麦克风输入。功能包括网页后台控制、聚会预约和转录稿存储。

## 命令

```bash
pnpm dev       # 启动开发服务器
pnpm build     # 构建生产版本
pnpm preview   # 预览生产版本
pnpm generate  # 生成静态站点
```

## 技术栈

- Nuxt 4 + Vue 3 + TypeScript
- Nuxt UI + Nuxt Icon (UI 组件库)
- pnpm (包管理器)

## 架构原则

来自 `.specify/memory/constitution.md`：

1. **API 优先架构** - 前后端通过 REST/WebSocket API 分离。前端仅处理展示，不包含业务逻辑。

2. **实时优先** - 目标延迟 <500ms（从音频到文字显示）。使用 WebSocket 进行流传输。优雅处理网络中断。

3. **模块化 ASR 后端** - 通过统一接口支持多个 ASR 提供商（Whisper、FunASR）。每个会话可配置后端选择。

4. **数据可靠性** - 所有转录会话可持久化存储。需要提供导出功能。

5. **简洁优先** - 避免过早抽象。仅实现已明确的功能。引入复杂性前需证明其必要性。

## 开发工作流

- `master` 为开发分支
- 功能分支命名：`###-feature-name`（如 `123-add-whisper-integration`）
- 合并前需检查是否符合项目宪法

### 规格驱动开发

本项目使用 speckit 进行规格驱动开发。可用命令：
- `/speckit.specify` - 创建功能规格
- `/speckit.plan` - 生成实现计划
- `/speckit.tasks` - 创建任务列表
- `/speckit.implement` - 执行实现

## Active Technologies
- TypeScript 5.x (Nuxt 4) + Nuxt 4, Vue 3, Nuxt UI, @nuxt/icon, crossws (WebSocket) (001-demo-interface)
- N/A (演示阶段无需持久化，用户偏好使用 localStorage) (001-demo-interface)

## Recent Changes
- 001-demo-interface: Added TypeScript 5.x (Nuxt 4) + Nuxt 4, Vue 3, Nuxt UI, @nuxt/icon, crossws (WebSocket)
