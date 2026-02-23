# Quickstart: Demo Interface

**Feature**: 001-demo-interface
**Date**: 2026-02-23

## Prerequisites

- Node.js 18.x 或更高版本
- pnpm 8.x 或更高版本

## Installation

```bash
# 安装依赖
pnpm install
```

## Development

### 启动开发服务器

```bash
pnpm dev
```

服务器启动后访问：
- 前台页面: http://localhost:3000
- 后台页面: http://localhost:3000/admin

### 开发模式功能

1. **前台页面测试**
   - 打开 http://localhost:3000
   - 页面应显示"等待连接"状态
   - 显示连接状态指示器

2. **后台控制测试**
   - 打开 http://localhost:3000/admin
   - 点击"开始模拟"按钮
   - 前台页面应开始显示模拟字幕

3. **多客户端测试**
   - 打开多个前台页面标签
   - 所有页面应同步显示相同内容

## Project Structure

```
/
├── pages/
│   ├── index.vue        # 前台字幕展示
│   └── admin.vue        # 后台控制中心
├── components/          # Vue 组件
├── composables/         # 组合式函数
│   ├── useWebSocket.ts  # WebSocket 连接
│   └── useSubtitles.ts  # 字幕状态
├── server/
│   ├── routes/api/      # API 端点
│   └── utils/           # 服务端工具
└── types/               # TypeScript 类型定义
```

## Key Commands

| Command | Description |
|---------|-------------|
| `pnpm dev` | 启动开发服务器 |
| `pnpm build` | 构建生产版本 |
| `pnpm preview` | 预览生产版本 |

## Testing Checklist

### P1 功能测试

- [ ] 前台页面加载正常
- [ ] 后台页面加载正常
- [ ] 后台点击"开始模拟"，前台显示字幕
- [ ] 后台点击"停止模拟"，字幕停止生成
- [ ] 后台点击"清空字幕"，前台字幕清空
- [ ] 连接状态指示器正确显示

### P2 功能测试

- [ ] 前台切换语言模式（中文/英文/双语）
- [ ] 语言模式偏好刷新后保持
- [ ] 后台显示连接数
- [ ] 后台显示模拟状态

### 边界情况测试

- [ ] 断开网络后显示断开提示
- [ ] 网络恢复后自动重连
- [ ] 多个前台页面同步显示

## Troubleshooting

### WebSocket 连接失败

检查 `nuxt.config.ts` 是否启用了 WebSocket：

```typescript
nitro: {
  experimental: {
    websocket: true
  }
}
```

### 热更新不生效

重启开发服务器：

```bash
# 停止服务器 (Ctrl+C)
pnpm dev
```

### 类型错误

重新生成 Nuxt 类型：

```bash
pnpm postinstall
```
