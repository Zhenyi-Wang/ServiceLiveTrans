// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },

  modules: [
    '@nuxt/ui',
    '@nuxt/icon',
    '@vueuse/nuxt'
  ],

  app: {
    head: {
      title: 'ServiceLiveTrans',
      meta: [
        { name: 'description', content: '实时语音转录服务' }
      ]
    }
  },

  colorMode: {
    preference: 'light'
  },

  nitro: {
    experimental: {
      websocket: true
    }
  }
})
