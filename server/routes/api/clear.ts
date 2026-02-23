import { clearSubtitles } from '../../utils/simulator'

export default defineEventHandler(() => {
  clearSubtitles()

  return {
    success: true,
    message: 'Subtitles cleared'
  }
})
