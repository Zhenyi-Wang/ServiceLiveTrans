# asyncio.Queue 跨线程通信：从 worker 线程安全地往 event loop 的 Queue 中放数据

## 背景

在 GGUF ASR Provider 中，推理逻辑（llama.cpp C 扩展）运行在 `ThreadPoolExecutor` 的 worker 线程中，推理过程中需要通过 `on_token` 回调逐 token 发送 partial 结果。partial 结果需要通过 `asyncio.Queue` 传递给 event loop 上的 `result_forwarder` 协程，再通过 WebSocket 发送给 Node.js。

## 错误做法

直接从 worker 线程调用 `asyncio.Queue.put_nowait()`：

```python
# worker 线程中
def _on_token(piece: str) -> None:
    partial_text.append(piece)
    result = ASRResult(type="partial", text="".join(partial_text))
    self._result_queue.put_nowait(result)  # 不安全！
```

## 症状

- `put_nowait()` 本身不报错，数据确实进入了 queue 的内部 deque
- 但 event loop 上的 `await queue.get()` 不会被唤醒
- 所有消息堆积在 queue 中，直到 `run_in_executor` 返回、event loop 重新获得控制权后，才一次性消费所有堆积的消息
- 表现为：partial 消息看起来是"一次性到达"的，失去了流式效果

## 根因

Python 官方文档明确指出：**`asyncio.Queue` 不是线程安全的。**

`put_nowait()` 内部会调用 `self._notify_getters()`，该方法会执行 `fut.set_result(None)` 来唤醒等待中的 getter。但从非 event loop 线程调用 `set_result()` 是未定义行为 — 它可能：

1. 静默失败（getter 不被唤醒）← 我们遇到的情况
2. 导致竞态条件
3. 偶然工作（CPython GIL 有时碰巧能掩盖问题）

## 正确做法

使用 `loop.call_soon_threadsafe()` 将 `put_nowait` 调度到 event loop 线程执行：

```python
# worker 线程中
def _on_token(piece: str) -> None:
    partial_text.append(piece)
    result = ASRResult(type="partial", text="".join(partial_text))
    self._loop.call_soon_threadsafe(self._result_queue.put_nowait, result)
```

`call_soon_threadsafe` 是线程安全的，它会将回调放入 event loop 的线程安全调度队列中，在 event loop 的下一次迭代中执行。这样 `put_nowait` 就在 event loop 线程中执行，能正确唤醒 `await queue.get()`。

## 效果对比

修复前（`put_nowait` 直接调用）：

- 20 条 partial 消息在 37ms 内全部到达（推理结束后一次性消费）

修复后（`call_soon_threadsafe`）：

- 20 条 partial 消息间隔 6-8ms 逐条到达（推理过程中实时消费）
- 前端 current 区域可以看到文字逐步增长

## 关键要点

1. **`asyncio.Queue` 只能在 event loop 线程中操作**，所有 `put`/`get` 都必须从 event loop 线程发起
2. **`run_in_executor` 不会阻塞 event loop**，event loop 在 worker 线程执行期间仍然可以调度其他协程（前提是回调通过正确方式触发）
3. **从 worker 线程向 event loop 传递数据的正确方式**：`loop.call_soon_threadsafe(callback, *args)`
4. **不要被 CPython GIL 误导**：GIL 提供的隐式"线程安全"是不可靠的，`asyncio` 内部机制（Future、Event）依赖于 event loop 线程的精确调度
5. 如果只是 event loop 内部协程间通信，`put_nowait` 是安全的；跨线程必须用 `call_soon_threadsafe`

## 相关文件

- `asr/providers/base.py` — ASRProvider 基类（`_emit` 方法）
- `asr/providers/gguf/provider.py` — GGUF Provider（`_on_token` 回调、`_transcribe_segment`）
- `asr/server.py` — Python WebSocket 服务（`result_forwarder` 协程）
- `server/utils/asr-bridge.ts` — Node.js ASR Bridge（接收 partial/final 消息）
