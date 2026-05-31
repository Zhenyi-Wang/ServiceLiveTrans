import { createError } from 'h3'

/**
 * 开发环境守卫 — 非开发环境返回 404
 * 放在 server/routes/devapi/ 下作为 middleware 自动生效
 */
export default defineEventHandler((_event) => {
  if (import.meta.dev) return
  throw createError({ statusCode: 404, statusMessage: 'Not Found' })
})
