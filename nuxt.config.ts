// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ['@nuxt/ui', '@nuxt/icon', '@vueuse/nuxt', '@nuxt/eslint'],
  devtools: { enabled: true },

  app: {
    head: {
      title: 'ServiceLiveTrans',
      meta: [{ name: 'description', content: '实时语音转录服务' }],
    },
  },

  colorMode: {
    preference: 'light',
  },
  compatibilityDate: '2025-07-15',

  nitro: {
    experimental: {
      websocket: true,
    },
  },

  eslint: {
    config: {
      stylistic: {
        indent: 2,
        quotes: 'single',
        semi: false,
      },
    },
  },
})
