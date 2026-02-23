import { computed } from 'vue'
import type { Ref } from 'vue'
import type { ConfirmedSubtitle } from '~/types/subtitle'

type SegmentGroup = ConfirmedSubtitle[]

export function useParagraphLogic(
  confirmedSubtitles: Ref<ConfirmedSubtitle[]>,
  maxParagraphLength: Ref<number>
) {
  const getSegmentParagraphs = computed(() => {
    const paragraphs: SegmentGroup[] = []
    let currentSegments: SegmentGroup = []
    let currentLength = 0
    const maxLength = maxParagraphLength.value

    confirmedSubtitles.value.forEach((segment) => {
      const segmentText = segment.optimizedText || segment.rawText
      if (!segmentText) return

      const segmentLength = segmentText.length
      currentSegments.push(segment)
      currentLength += segmentLength

      if (currentLength >= maxLength) {
        let splitIndex = currentSegments.length
        const sentenceEnds = ['。', '？', '！', '；', '.', '?', '!', ';']

        let accumulatedLength = 0
        for (let i = currentSegments.length - 1; i >= Math.max(0, currentSegments.length - 10); i--) {
          accumulatedLength += (currentSegments[i].optimizedText || currentSegments[i].rawText).length
          if (currentLength - accumulatedLength <= maxLength - 50) {
            break
          }

          const candidateText = currentSegments[i].optimizedText || currentSegments[i].rawText
          for (let j = candidateText.length - 1; j >= Math.max(0, candidateText.length - 50); j--) {
            if (sentenceEnds.includes(candidateText[j])) {
              splitIndex = i
              break
            }
          }
          if (splitIndex < currentSegments.length) break
        }

        if (splitIndex === currentSegments.length) {
          splitIndex = currentSegments.length - 1
        }

        const paragraphSegments = currentSegments.slice(0, splitIndex)
        paragraphs.push(paragraphSegments)

        const removedLength = paragraphSegments.reduce(
          (sum, seg) => sum + (seg.optimizedText || seg.rawText).length,
          0
        )
        currentSegments = currentSegments.slice(splitIndex)
        currentLength -= removedLength
      }
    })

    if (currentSegments.length > 0) {
      paragraphs.push(currentSegments)
    }

    return paragraphs
  })

  const getChineseParagraphs = computed(() => {
    return getSegmentParagraphs.value.map(segmentGroup => {
      return segmentGroup.map(seg => ({
        text: seg.optimizedText || seg.rawText,
        isOptimized: !!seg.optimizedText && seg.optimizedText !== seg.rawText
      }))
    })
  })

  const getEnglishParagraphs = computed(() => {
    return getSegmentParagraphs.value.map(segmentGroup => {
      return segmentGroup.map(seg => ({
        text: seg.translatedText || '',
        isTranslating: !seg.translatedText,
        id: seg.id,
        hasContent: !!seg.translatedText
      }))
    })
  })

  return {
    getSegmentParagraphs,
    getChineseParagraphs,
    getEnglishParagraphs
  }
}
