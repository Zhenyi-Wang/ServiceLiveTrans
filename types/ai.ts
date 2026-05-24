export interface AIResult {
  optimizedText: string
  enText: string
}

export interface AIConfig {
  baseUrl: string
  apiKey: string
  modelName: string
  polishEnabled: boolean
  translationEnabled: boolean
}
