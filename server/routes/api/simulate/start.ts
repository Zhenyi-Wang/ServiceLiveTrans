import { startSimulation, simulationState } from '../../../utils/simulator'

export default defineEventHandler(async (event) => {
  // 读取请求体
  const body = await readBody(event).catch(() => ({}))
  const delay = body?.delay

  // 验证延迟参数
  if (delay !== undefined) {
    if (typeof delay !== 'number' || delay < 500 || delay > 10000) {
      throw createError({
        statusCode: 400,
        statusMessage: 'Invalid parameter',
        data: {
          success: false,
          error: 'delay must be between 500 and 10000 milliseconds',
          code: 'INVALID_PARAMETER'
        }
      })
    }
  }

  // 尝试启动模拟
  const started = startSimulation(delay)

  if (!started) {
    throw createError({
      statusCode: 409,
      statusMessage: 'Conflict',
      data: {
        success: false,
        error: 'Simulation is already running',
        code: 'SIMULATION_ALREADY_RUNNING'
      }
    })
  }

  return {
    success: true,
    message: 'Simulation started',
    config: {
      optimizationDelay: simulationState.optimizationDelay,
      delayRandomRange: simulationState.delayRandomRange
    }
  }
})
