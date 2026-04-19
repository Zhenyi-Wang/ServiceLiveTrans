import { type ChildProcess, spawn } from 'child_process'
import { sendAudioChunk } from './asr-bridge'

let ffmpegProcess: ChildProcess | null = null

export function startStream(url: string): boolean {
  if (ffmpegProcess) return false

  ffmpegProcess = spawn('ffmpeg', [
    '-i', url,
    '-vn',
    '-acodec', 'pcm_s16le',
    '-ar', '16000',
    '-ac', '1',
    '-f', 's16le',
    'pipe:1'
  ])

  const CHUNK_SIZE = 3200 // 100ms at 16kHz mono 16bit
  let streamBuffer = Buffer.alloc(0)

  ffmpegProcess.stdout?.on('data', (chunk: Buffer) => {
    streamBuffer = Buffer.concat([streamBuffer, chunk])
    while (streamBuffer.length >= CHUNK_SIZE) {
      const send = streamBuffer.subarray(0, CHUNK_SIZE)
      streamBuffer = streamBuffer.subarray(CHUNK_SIZE)
      sendAudioChunk(send.toString('base64'))
    }
  })

  ffmpegProcess.stderr?.on('data', () => {
    // ffmpeg 进度信息，静默
  })

  ffmpegProcess.on('close', (code) => {
    console.log(`[Stream] ffmpeg 退出, code=${code}`)
    ffmpegProcess = null
  })

  ffmpegProcess.on('error', (err) => {
    console.error(`[Stream] ffmpeg 错误: ${err.message}`)
    ffmpegProcess = null
  })

  return true
}

export function stopStream(): boolean {
  if (!ffmpegProcess) return false
  ffmpegProcess.kill('SIGTERM')
  ffmpegProcess = null
  return true
}

export function isStreamRunning(): boolean {
  return ffmpegProcess !== null
}
