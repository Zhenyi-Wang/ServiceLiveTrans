#!/bin/bash
# 切换到项目目录
cd "$(dirname "$0")"

# 初始化 conda
eval "$(conda shell.bash hook)"

# 激活 conda 环境
conda activate trans

# 杀掉已有的 ASR 进程
pkill -f "python asr/server.py" 2>/dev/null

echo "启动 ASR 服务..."
python asr/server.py &
ASR_PID=$!

# 等待 ASR 服务就绪
sleep 3

echo "启动 Nuxt 开发服务器..."
pnpm dev &
NUXT_PID=$!

cleanup() {
    echo ""
    echo "正在关闭..."
    kill $NUXT_PID 2>/dev/null
    kill $ASR_PID 2>/dev/null
    pkill -f "python asr/server.py" 2>/dev/null
    wait 2>/dev/null
    echo "已关闭"
}

trap cleanup SIGINT SIGTERM

wait
