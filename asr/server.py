"""ASR WebSocket 服务入口"""
from __future__ import annotations
import asyncio
import base64
import http
import json
import logging
import signal
import sys

import websockets
from websockets.server import serve

from asr.config import ASRConfig
from asr.config_db import init_defaults, get, get_all, set_many
from asr.model_manager import ModelManager, get_available_providers
from asr.protocol import (
    ASRResult,
    ConfigMessage,
    encode_message,
    ErrorMessage,
    LoadingEvent,
    ModelStatusResponse,
    ReadyEvent,
    UnloadedEvent,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger(__name__)

config = ASRConfig()
manager: ModelManager | None = None
result_queue: asyncio.Queue[ASRResult] = asyncio.Queue()
current_ws = None


def get_health_data() -> dict:
    gpu_used = 0
    try:
        import torch
        if torch.cuda.is_available():
            gpu_used = torch.cuda.memory_allocated() // (1024 * 1024)
    except ImportError:
        pass

    return {
        "status": "ok",
        "available_providers": get_available_providers(),
        "model_loaded": manager.is_loaded if manager else False,
        "provider": manager.current_provider if manager else "",
        "gpu_used_mb": gpu_used,
        "idle_seconds": round(manager.idle_seconds, 1) if manager else 0.0,
    }


async def health_handler(path, request_headers):
    if path == "/health":
        body = json.dumps(get_health_data()).encode()
        return (http.HTTPStatus.OK, [("Content-Type", "application/json")], body)
    if path == "/config":
        body = json.dumps(get_all()).encode()
        return (http.HTTPStatus.OK, [("Content-Type", "application/json")], body)
    return None


async def handle_connection(websocket):
    global current_ws
    current_ws = websocket
    logger.info(f"客户端连接: {websocket.remote_address}")

    available = get_available_providers()
    await websocket.send(json.dumps({
        "type": "ready",
        "available_providers": available,
    }))

    try:
        async for raw_message in websocket:
            try:
                msg = json.loads(raw_message)
                msg_type = msg.get("type", "")

                if msg_type == "config":
                    await handle_config(websocket, msg)
                elif msg_type == "audio":
                    await handle_audio(msg)
                elif msg_type == "model/load":
                    await handle_model_load(websocket, msg)
                elif msg_type == "model/unload":
                    await handle_model_unload(websocket)
                elif msg_type == "model/status":
                    await handle_model_status(websocket)
                else:
                    await websocket.send(encode_message(ErrorMessage(message=f"Unknown message type: {msg_type}")))
            except json.JSONDecodeError:
                await websocket.send(encode_message(ErrorMessage(message="Invalid JSON")))
            except Exception as e:
                logger.error(f"消息处理错误: {e}")
                await websocket.send(encode_message(ErrorMessage(message=str(e))))
    except websockets.ConnectionClosed:
        pass
    finally:
        current_ws = None
        # 清空 queue 中未消费的结果，防止堆积
        while not result_queue.empty():
            try:
                result_queue.get_nowait()
            except asyncio.QueueEmpty:
                break
        logger.info("客户端断开")


DYNAMIC_CONFIG_KEYS = ("overlap_sec", "memory_chunks")


async def handle_config(websocket, msg: dict):
    provider = msg.get("provider", "")
    model = msg.get("model", "")
    if not provider:
        await websocket.send(encode_message(ErrorMessage(message="Missing provider")))
        return

    # 持久化动态配置到 SQLite
    dynamic_config = {k: msg[k] for k in DYNAMIC_CONFIG_KEYS if k in msg}
    if dynamic_config:
        set_many(dynamic_config)

    if manager.is_loaded and manager.current_provider != provider:
        await manager.unload()
        await websocket.send(encode_message(UnloadedEvent()))

    await websocket.send(encode_message(LoadingEvent()))
    try:
        model_inst = await manager.ensure_loaded(provider, model)
        for key, value in dynamic_config.items():
            setattr(model_inst, key, value)
        model_inst.set_result_queue(result_queue)
        await websocket.send(encode_message(ReadyEvent()))
        logger.info(f"Provider 就绪: {provider}, 动态配置: {dynamic_config}")
    except Exception as e:
        logger.error(f"模型加载失败: {e}")
        await websocket.send(encode_message(ErrorMessage(message=f"Model load failed: {e}")))


async def handle_audio(msg: dict):
    data_b64 = msg.get("data", "")
    if not data_b64:
        return
    chunk = base64.b64decode(data_b64)

    manager.touch()
    await manager.process_audio(chunk)


async def handle_model_load(websocket, msg: dict):
    provider = msg.get("provider", "")
    await handle_config(websocket, {"provider": provider, "model": ""})


async def handle_model_unload(websocket):
    await manager.unload()
    await websocket.send(encode_message(UnloadedEvent()))


async def handle_model_status(websocket):
    import torch
    gpu_used = 0
    if torch.cuda.is_available():
        gpu_used = torch.cuda.memory_allocated() // (1024 * 1024)
    await websocket.send(encode_message(ModelStatusResponse(
        loaded=manager.is_loaded,
        provider=manager.current_provider or "",
        gpu_used_mb=gpu_used,
        idle_seconds=manager.idle_seconds,
    )))


async def result_forwarder(websocket):
    """从 result_queue 读取结果并转发给客户端"""
    try:
        while True:
            result = await result_queue.get()
            if result.type == "partial":
                msg = {"type": "partial", "text": result.text, "language": result.language}
            else:
                msg = {"type": "final", "text": result.text, "language": result.language}
            await websocket.send(json.dumps(msg))
    except websockets.ConnectionClosed:
        pass
    except asyncio.CancelledError:
        pass


async def main():
    global manager

    # 初始化 SQLite 默认配置
    default_config = {
        "overlap_sec": 0.1,
        "memory_chunks": 2,
    }
    init_defaults(default_config)
    logger.info(f"配置已从 SQLite 加载: {get_all()}")

    manager = ModelManager(idle_timeout=config.idle_timeout, config_loader=config)
    await manager.start_monitor()

    available = get_available_providers()
    logger.info(f"可用 Provider: {available}")

    async def handler(websocket):
        forward_task = asyncio.create_task(result_forwarder(websocket))
        try:
            await handle_connection(websocket)
        finally:
            forward_task.cancel()

    loop = asyncio.get_event_loop()
    stop = loop.create_future()

    def _signal_handler():
        if not stop.done():
            stop.set_result(None)

    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, _signal_handler)

    logger.info(f"ASR 服务启动: ws://{config.server_host}:{config.server_port}")
    async with serve(handler, config.server_host, config.server_port, ping_interval=None, ping_timeout=None, process_request=health_handler):
        await stop

    logger.info("正在关闭...")
    await manager.shutdown()
    logger.info("ASR 服务已停止")


if __name__ == "__main__":
    asyncio.run(main())
