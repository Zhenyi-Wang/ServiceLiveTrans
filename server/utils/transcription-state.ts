import type { TranscriptionState } from '../../types/transcription'

export const transcriptionState: TranscriptionState = {
  isActive: false,
  source: null,
  currentSubtitle: null,
  confirmedSubtitles: [],
}
