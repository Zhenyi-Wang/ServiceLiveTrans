import { isMockAI, setMockAI } from '../../../utils/ai-processor'

export default defineEventHandler(async (event) => {
  const method = getMethod(event)

  if (method === 'GET') {
    return { useMockAI: isMockAI() }
  }

  if (method === 'POST') {
    const body = await readBody(event).catch(() => ({}))
    if (typeof body.useMockAI === 'boolean') {
      setMockAI(body.useMockAI)
    }
    return { useMockAI: isMockAI() }
  }

  throw createError({ statusCode: 405, statusMessage: 'Method not allowed' })
})
