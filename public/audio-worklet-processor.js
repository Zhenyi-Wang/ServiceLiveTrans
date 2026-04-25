class PCMProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._buffer = new Float32Array()
    this._targetSampleRate = 16000
    this._outputChunkSize = 1600

    this.port.onmessage = (event) => {
      if (event.data.type === 'config') {
        this._targetSampleRate = event.data.targetSampleRate
        this._outputChunkSize = Math.floor(this._targetSampleRate * event.data.chunkDurationMs / 1000)
        this._buffer = new Float32Array()
      }
    }
  }

  process(inputs) {
    const input = inputs[0]
    if (!input || input.length === 0) return true

    const channel = input[0]
    this._buffer = Float32Array.from([...this._buffer, ...channel])

    const ratio = sampleRate / this._targetSampleRate
    const srcNeeded = Math.ceil(ratio * this._outputChunkSize)

    if (this._buffer.length < srcNeeded) return true

    const pcm16 = new Int16Array(this._outputChunkSize)
    for (let i = 0; i < this._outputChunkSize; i++) {
      const srcIndex = Math.floor(i * ratio)
      const sample = this._buffer[srcIndex] || 0
      pcm16[i] = Math.max(-32768, Math.min(32767, Math.round(sample * 32767)))
    }

    this._buffer = this._buffer.slice(srcNeeded)

    this.port.postMessage({ pcm: pcm16.buffer }, [pcm16.buffer])
    return true
  }
}

registerProcessor('pcm-processor', PCMProcessor)
