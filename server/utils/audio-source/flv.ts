import type { ChildProcess } from 'child_process'
import { spawn } from 'child_process'
import type { AudioSource, AudioSourceStatus } from './base'

const CHUNK_SIZE = 3200 // 100ms at 16kHz mono 16bit

export class FLVSource implements AudioSource {
  private ffmpeg: ChildProcess | null = null
  private streamBuffer = Buffer.alloc(0)
  private audioCallback: ((pcm: Buffer) => void) | null = null
  private errorCallback: ((error: Error) => void) | null = null
  private stopped = false
  private retryCount = 0
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private readonly retryBase = 2000
  private readonly maxRetryDelay = 60000

  constructor(private url: string) {}

  async start(): Promise<void> {
    this.stopped = false
    this.retryCount = 0
    this._connect()
  }

  stop(): void {
    this.stopped = true
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    if (this.ffmpeg) {
      this.ffmpeg.kill('SIGTERM')
      this.ffmpeg = null
    }
    this.streamBuffer = Buffer.alloc(0)
  }

  onAudio(cb: (pcm: Buffer) => void): void {
    this.audioCallback = cb
  }

  onError(cb: (error: Error) => void): void {
    this.errorCallback = cb
  }

  getStatus(): AudioSourceStatus {
    if (this.stopped) {
      return { state: 'idle', reconnectCount: this.retryCount }
    }
    if (this.ffmpeg && !this.ffmpeg.killed) {
      return { state: 'running', reconnectCount: this.retryCount }
    }
    return { state: 'connecting', reconnectCount: this.retryCount }
  }

  private _connect(): void {
    if (this.stopped) return

    console.log(`[FLVSource] 连接 ${this.url}`)

    this.ffmpeg = spawn('ffmpeg', [
      '-i', this.url,
      '-vn',
      '-acodec', 'pcm_s16le',
      '-ar', '16000',
      '-ac', '1',
      '-f', 's16le',
      'pipe:1'
    ])

    this.ffmpeg.stdout?.on('data', (chunk: Buffer) => {
      this.streamBuffer = Buffer.concat([this.streamBuffer, chunk])
      while (this.streamBuffer.length >= CHUNK_SIZE) {
        const send = this.streamBuffer.subarray(0, CHUNK_SIZE)
        this.streamBuffer = this.streamBuffer.subarray(CHUNK_SIZE)
        this.audioCallback?.(Buffer.from(send))
      }
    })

    this.ffmpeg.stderr?.on('data', () => {
      // ffmpeg 进度信息，静默
    })

    this.ffmpeg.on('close', (code) => {
      console.log(`[FLVSource] ffmpeg 退出, code=${code}`)
      this.ffmpeg = null
      if (!this.stopped) {
        this._scheduleReconnect()
      }
    })

    this.ffmpeg.on('error', (err) => {
      console.error(`[FLVSource] ffmpeg 错误: ${err.message}`)
      this.ffmpeg = null
      if (!this.stopped) {
        this._scheduleReconnect()
      }
    })
  }

  private _scheduleReconnect(): void {
    if (this.stopped) return

    const delay = Math.min(
      this.retryBase * Math.pow(2, this.retryCount),
      this.maxRetryDelay
    )
    this.retryCount++
    console.log(`[FLVSource] ${delay / 1000}s 后重连 (第 ${this.retryCount} 次)`)

    if (this.retryCount > 10) {
      this.errorCallback?.(new Error(`重连中，第 ${this.retryCount} 次尝试`))
    }

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this._connect()
    }, delay)
  }
}
