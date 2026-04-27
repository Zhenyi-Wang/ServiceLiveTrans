/**
 * WebSocket 消息类型
 */
export type WSMessageType =
  | 'init'
  | 'confirmed'
  | 'current'
  | 'clear'
  | 'ai-processed'
  | 'transcription-status'
  | 'transcription-progress'
  | 'connection-count'
  | 'audio-source-start'
  | 'audio-source-stop'

/**
 * 初始化消息数据
 */
export interface WSInitData {
  current: string | null
  confirmed: ConfirmedSubtitle[]
  transcriptionStatus?: TranscriptionStatusData
  connectionCount?: number
}

/**
 * 已确认字幕消息数据
 */
export interface WSConfirmedData {
  id: string
  text: string
  optimizedText: string
  enText: string
}

/**
 * 当前输入消息数据
 */
export interface WSCurrentData {
  text: string
  enText: string
  version: number
  enVersion: number
}

/**
 * AI 后处理完成通知
 */
export interface WSAIProcessedData {
  id: string
  optimizedText: string
  enText: string
}

/**
 * 已确认字幕
 */
export interface ConfirmedSubtitle {
  id: string
  text: string
  optimizedText?: string
  enText?: string
  timestamp: number
}

/**
 * 转录状态数据（统一格式）
 */
export interface TranscriptionStatusData {
  state: 'idle' | 'starting' | 'running' | 'stopping' | 'error'
  source: 'mic' | 'stream' | null
  audio: { active: boolean; label: string; detail?: string }
  recognition: { active: boolean; detail?: string }
  error?: string
  uptime: number
  asrConfig?: Record<string, unknown>
}

/**
 * 转录进度数据
 */
export interface TranscriptionProgressData {
  step: 'health-checking' | 'health-ok' | 'service-starting' | 'service-ready' | 'bridge-connecting' | 'bridge-connected' | 'model-loading' | 'model-ready' | 'source-starting' | 'source-ready' | 'stopping-source' | 'stopping-bridge' | 'stopping-service'
}

/**
 * 连接数数据
 */
export interface ConnectionCountData {
  count: number
}

/**
 * 音频源启动指令数据
 */
export interface AudioSourceCommandData {
  source: 'mic' | 'stream'
}

/**
 * 音频源停止指令数据
 */
export interface AudioSourceStopData {}

/**
 * WebSocket 消息
 */
export interface WSMessage {
  type: WSMessageType
  data?:
    | WSInitData
    | WSConfirmedData
    | WSCurrentData
    | WSAIProcessedData
    | TranscriptionStatusData
    | TranscriptionProgressData
    | ConnectionCountData
    | AudioSourceCommandData
    | AudioSourceStopData
    | null
}
