"""
Qwen3-ASR GGUF Engine

使用 ONNX Runtime (encoder) + llama.cpp (GGUF decoder) 进行语音识别
"""
import logging

logger = logging.getLogger('qwen_asr_gguf')