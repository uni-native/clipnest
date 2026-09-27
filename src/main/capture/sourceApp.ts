import { getPlatform } from '@main/platform'

                    
const TITLE_MAX = 40
                                      
const KNOWN_APPS = [
  'visual studio code',
  'vs code',
  'cursor',
  'windsurf',
  'microsoft edge',
  'edge',
  'google chrome',
  'chrome',
  'firefox',
  'notepad',
  'file explorer',
  'windows explorer',
  'explorer',
  'word',
  'excel',
  'powerpoint',
  'outlook',
  'onenote',
  'wechat',
  '微信',
  'dingtalk',
  '钉钉',
  '企业微信',
  'qq',
  'obsidian',
  'notion',
  'typora',
  'sublime text',
  'windows powershell',
  'powershell',
  'command prompt',
  'terminal',
  'windows terminal',
  'slack',
  'microsoft teams',
  'teams',
  'figma',
  'photoshop',
  'illustrator',
  'intellij idea',
  'pycharm',
  'webstorm',
  'goland',
  'clion',
  'android studio',
  'github desktop',
  'postman',
  'wps office',
  'vmware',
  'docker desktop',
]

function isKnownApp(name: string): boolean {
  const lower = name.toLowerCase()
  return KNOWN_APPS.some(app => lower === app || lower.includes(app))
}

                                          
function looksLikeDocument(part: string): boolean {
  if (/^[a-z]:[\\/]/i.test(part) || part.startsWith('\\\\')) return true
  return /\.[a-z0-9]{1,8}$/i.test(part)
}

                                          
function appNameFromTitle(title: string): string {
                                   
  const cleaned = title.replace(/[\u200B-\u200D\uFEFF]/g, '').trim()
  const parts = cleaned
    .split(/\s+[-–—]\s+/)
    .map(p => p.trim())
    .filter(p => p.length > 0)
  if (parts.length === 0) return ''
  if (parts.length === 1) return truncate(parts[0], TITLE_MAX)
  const last = parts[parts.length - 1]
  const first = parts[0]
  if (isKnownApp(last)) return truncate(last, TITLE_MAX)
  if (isKnownApp(first)) return truncate(first, TITLE_MAX)
  if (looksLikeDocument(last) && !looksLikeDocument(first)) return truncate(first, TITLE_MAX)
  return truncate(last, TITLE_MAX)
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s
}

   
                    
                                         
   
export function getSourceApp(): string {
  try {
    const title = getPlatform().foregroundWindow()?.title
    return title ? appNameFromTitle(title) : ''
  } catch (e) {
    console.error('[capture] read foreground window failed', e)
    return ''
  }
}
