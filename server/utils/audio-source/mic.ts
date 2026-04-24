import type { AudioSource, AudioSourceStatus } from './base'

export class MicSource implements AudioSource {
  async start(): Promise<void> {
    throw new Error('MicSource 暂未实现')
  }

  stop(): void {}

  onAudio(): void {}

  onError(): void {}

  getStatus(): AudioSourceStatus {
    return { state: 'idle' }
  }
}
