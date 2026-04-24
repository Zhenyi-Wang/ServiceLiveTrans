export type AudioSourceType = 'flv' | 'mic'

export interface AudioSource {
  start(): Promise<void>
  stop(): void
  onAudio(cb: (pcm: Buffer) => void): void
  onError(cb: (error: Error) => void): void
  getStatus(): AudioSourceStatus
}

export interface AudioSourceStatus {
  state: 'idle' | 'connecting' | 'running' | 'error'
  error?: string
  reconnectCount?: number
}
