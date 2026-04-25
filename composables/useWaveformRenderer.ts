export interface WaveformRendererOptions {
  color?: string
  backgroundColor?: string
  height?: number
}

export function useWaveformRenderer(
  canvasRef: Ref<HTMLCanvasElement | null>,
  options: WaveformRendererOptions = {}
) {
  const color = options.color ?? '#38bdf8'
  const bgColor = options.backgroundColor ?? 'rgba(0, 0, 0, 0.2)'
  const height = options.height ?? 60

  let animFrameId: number | null = null

  function drawRealtimeWaveform(analyserNode: AnalyserNode | null) {
    const canvas = canvasRef.value
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.height = height
    const width = canvas.clientWidth
    canvas.width = width

    function draw() {
      if (!analyserNode || !canvas || !ctx) return

      const bufferLength = analyserNode.frequencyBinCount
      const dataArray = new Uint8Array(bufferLength)
      analyserNode.getByteTimeDomainData(dataArray)

      ctx.fillStyle = bgColor
      ctx.fillRect(0, 0, width, height)

      ctx.lineWidth = 1.5
      ctx.strokeStyle = color
      ctx.beginPath()

      const sliceWidth = width / bufferLength
      let x = 0

      for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0
        const y = (v * height) / 2

        if (i === 0) {
          ctx.moveTo(x, y)
        } else {
          ctx.lineTo(x, y)
        }
        x += sliceWidth
      }

      ctx.lineTo(width, height / 2)
      ctx.stroke()

      animFrameId = requestAnimationFrame(draw)
    }

    draw()
  }

  function drawStaticWaveform(peaks: Float32Array, progress?: number) {
    const canvas = canvasRef.value
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.height = height
    const width = canvas.clientWidth
    canvas.width = width

    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, width, height)

    const barWidth = width / peaks.length
    const halfHeight = height / 2

    for (let i = 0; i < peaks.length; i++) {
      const barHeight = peaks[i] * halfHeight
      const x = i * barWidth

      ctx.fillStyle = color
      ctx.globalAlpha = 0.7
      ctx.fillRect(x, halfHeight - barHeight, Math.max(barWidth - 1, 1), barHeight * 2)
    }

    ctx.globalAlpha = 1.0

    if (progress !== undefined && progress > 0) {
      const progressX = Math.min(progress * width, width)
      ctx.strokeStyle = '#ffffff'
      ctx.lineWidth = 2
      ctx.beginPath()
      ctx.moveTo(progressX, 0)
      ctx.lineTo(progressX, height)
      ctx.stroke()
    }
  }

  function drawIdle() {
    const canvas = canvasRef.value
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.height = height
    const width = canvas.clientWidth
    canvas.width = width

    ctx.fillStyle = bgColor
    ctx.fillRect(0, 0, width, height)

    ctx.strokeStyle = 'rgba(56, 189, 248, 0.2)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(0, height / 2)
    ctx.lineTo(width, height / 2)
    ctx.stroke()
  }

  function stopAnimation() {
    if (animFrameId !== null) {
      cancelAnimationFrame(animFrameId)
      animFrameId = null
    }
  }

  onUnmounted(() => {
    stopAnimation()
  })

  return {
    drawRealtimeWaveform,
    drawStaticWaveform,
    drawIdle,
    stopAnimation
  }
}
