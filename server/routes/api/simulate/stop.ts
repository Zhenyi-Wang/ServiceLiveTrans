import { stopSimulation, simulationState } from '../../../utils/simulator'

export default defineEventHandler(() => {
  const wasRunning = simulationState.isRunning

  stopSimulation()

  return {
    success: true,
    message: wasRunning ? 'Simulation stopped' : 'Simulation was not running',
    wasRunning
  }
})
