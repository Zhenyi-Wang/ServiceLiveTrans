/**
 * 示例字幕数据
 * 中英文对照句子库，用于模拟字幕生成
 */

export interface SampleSentence {
  chinese: string
  english: string
}

/**
 * 预设的中英文对照句子库
 */
export const sampleSentences: SampleSentence[] = [
  {
    chinese: '大家好，欢迎来到今天的直播节目。',
    english: 'Hello everyone, welcome to today\'s live broadcast.'
  },
  {
    chinese: '我们今天要讨论的是人工智能的最新发展。',
    english: 'Today we will discuss the latest developments in artificial intelligence.'
  },
  {
    chinese: '首先，让我们来看一下机器学习的应用场景。',
    english: 'First, let\'s look at the application scenarios of machine learning.'
  },
  {
    chinese: '自然语言处理是人工智能的重要分支。',
    english: 'Natural language processing is an important branch of artificial intelligence.'
  },
  {
    chinese: '深度学习模型在图像识别领域取得了巨大突破。',
    english: 'Deep learning models have made huge breakthroughs in image recognition.'
  },
  {
    chinese: '我们正在见证技术革命的历史性时刻。',
    english: 'We are witnessing a historic moment of technological revolution.'
  },
  {
    chinese: '数据是新时代的石油，这句话已经广为人知。',
    english: 'Data is the oil of the new era, this saying is widely known.'
  },
  {
    chinese: '云计算为人工智能的发展提供了强大的基础设施。',
    english: 'Cloud computing provides powerful infrastructure for AI development.'
  },
  {
    chinese: '边缘计算让智能处理更加接近数据源。',
    english: 'Edge computing brings intelligent processing closer to data sources.'
  },
  {
    chinese: '安全性是任何技术系统都必须优先考虑的问题。',
    english: 'Security is a priority issue that any technical system must consider.'
  },
  {
    chinese: '用户体验决定了产品的成功与否。',
    english: 'User experience determines the success or failure of a product.'
  },
  {
    chinese: '持续创新是企业保持竞争力的关键。',
    english: 'Continuous innovation is the key for enterprises to maintain competitiveness.'
  },
  {
    chinese: '团队协作能够产生超出预期的成果。',
    english: 'Team collaboration can produce results beyond expectations.'
  },
  {
    chinese: '每一次失败都是通往成功的垫脚石。',
    english: 'Every failure is a stepping stone to success.'
  },
  {
    chinese: '感谢大家的参与，我们下次节目再见。',
    english: 'Thank you all for participating, see you in the next program.'
  },
  {
    chinese: '这个问题很有意思，让我详细解释一下。',
    english: 'This is an interesting question, let me explain it in detail.'
  },
  {
    chinese: '技术的发展速度远超我们的想象。',
    english: 'The speed of technology development far exceeds our imagination.'
  },
  {
    chinese: '我们需要平衡技术进步与隐私保护。',
    english: 'We need to balance technological progress with privacy protection.'
  },
  {
    chinese: '开源软件推动了整个行业的快速发展。',
    english: 'Open source software has driven the rapid development of the entire industry.'
  },
  {
    chinese: '未来的世界将更加智能化和自动化。',
    english: 'The future world will be more intelligent and automated.'
  }
]

/**
 * 随机获取一个句子
 */
export function getRandomSentence(): SampleSentence {
  const index = Math.floor(Math.random() * sampleSentences.length)
  return sampleSentences[index]
}

/**
 * 随机获取多个不重复的句子
 */
export function getRandomSentences(count: number): SampleSentence[] {
  const shuffled = [...sampleSentences].sort(() => Math.random() - 0.5)
  return shuffled.slice(0, count)
}
