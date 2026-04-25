import { stopASRProcess } from '../utils/asr-process'

export default defineNitroPlugin((nitroApp) => {
  nitroApp.hooks.hook('close', () => {
    console.log('[ASR Cleanup] Nuxt 关闭，清理 ASR 进程')
    stopASRProcess()
  })
})
