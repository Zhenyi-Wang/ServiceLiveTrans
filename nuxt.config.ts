// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  app: {
    head: {
      title: 'ServiceLiveTrans',
      meta: [
        { name: 'description', content: '实时语音转录服务' }
      ]
    }
  }
})
