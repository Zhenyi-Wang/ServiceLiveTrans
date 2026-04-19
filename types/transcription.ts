import type { CurrentSubtitle, ConfirmedSubtitle } from './subtitle'

export interface TranscriptionState {
  isActive: boolean
  source: 'simulator' | 'asr' | null
  currentSubtitle: CurrentSubtitle | null
  confirmedSubtitles: ConfirmedSubtitle[]
}
