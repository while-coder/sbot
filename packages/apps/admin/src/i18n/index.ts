import { createI18n } from 'vue-i18n'
import zh from './zh'
import en from './en'

const STORAGE_KEY = 'sbot_locale'
const supported = ['zh', 'en']

function detectLocale(): string {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved && supported.includes(saved)) return saved
  const sys = navigator.language || ''
  return sys.startsWith('zh') ? 'zh' : 'en'
}

export function saveLocale(locale: string) {
  localStorage.setItem(STORAGE_KEY, locale)
}

export const i18n = createI18n({
  legacy: false,
  locale: detectLocale(),
  fallbackLocale: 'en',
  messages: { zh, en },
})
