/**
 * ASR 引擎配置参数（camelCase，前端/Node 侧使用）
 */
export interface ASRConfig {
  provider?: string
  model?: string
  overlapSec?: number
  memoryChunks?: number
  vadThreshold?: number
  vadMaxBufferSec?: number
  vadMinBufferSec?: number
  vadSilenceMs?: number
  temperature?: number
  language?: string
  sendPartial?: boolean
  sentenceMinLen?: number
  rollbackNum?: number
}

/**
 * ASR 引擎配置参数（snake_case，Python ASR 服务侧使用）
 */
export interface ASRConfigSnake {
  provider?: string
  model?: string
  overlap_sec?: number
  memory_chunks?: number
  vad_threshold?: number
  vad_max_buffer_sec?: number
  vad_min_buffer_sec?: number
  vad_silence_ms?: number
  temperature?: number
  language?: string
  send_partial?: boolean
  sentence_min_len?: number
  rollback_num?: number
}

const CAMEL_TO_SNAKE: Record<string, string> = {
  overlapSec: 'overlap_sec',
  memoryChunks: 'memory_chunks',
  vadThreshold: 'vad_threshold',
  vadMaxBufferSec: 'vad_max_buffer_sec',
  vadMinBufferSec: 'vad_min_buffer_sec',
  vadSilenceMs: 'vad_silence_ms',
  sendPartial: 'send_partial',
  sentenceMinLen: 'sentence_min_len',
  rollbackNum: 'rollback_num',
}

const SNAKE_TO_CAMEL: Record<string, string> = Object.fromEntries(
  Object.entries(CAMEL_TO_SNAKE).map(([k, v]) => [v, k]),
)

/**
 * camelCase ASR 配置 → snake_case（发给 Python）
 * 只转换有值的字段
 */
export function asrConfigToSnake(config: ASRConfig): ASRConfigSnake {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(config)) {
    if (value === undefined) continue
    const snakeKey = CAMEL_TO_SNAKE[key] || key
    result[snakeKey] = value
  }
  return result as ASRConfigSnake
}

/**
 * snake_case ASR 配置 → camelCase（从 Python 接收）
 */
export function asrConfigToCamel(config: Record<string, unknown>): ASRConfig {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(config)) {
    const camelKey = SNAKE_TO_CAMEL[key] || key
    result[camelKey] = value
  }
  return result as ASRConfig
}
