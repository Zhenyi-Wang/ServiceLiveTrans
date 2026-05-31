import { transcriptionState } from '../../utils/transcription-state'

/**
 * GET /devapi/subtitles
 * 已确认字幕列表（纯文本，方便快速查看转录效果）
 *
 * Query params:
 *   format=text — 纯文本格式（每行一条），默认 JSON
 */
export default defineEventHandler((event) => {
  const query = getQuery<{ format?: string }>(event)
  const subtitles = transcriptionState.confirmedSubtitles

  if (query.format === 'text') {
    const lines = subtitles.map((s) => {
      const display = s.optimizedText || s.text
      const ts = new Date(s.timestamp).toLocaleTimeString('zh-CN')
      return `[${ts}] ${display}${s.enText ? `\n         ${s.enText}` : ''}`
    })
    setResponseHeader(event, 'content-type', 'text/plain; charset=utf-8')
    return lines.join('\n')
  }

  return subtitles
})
