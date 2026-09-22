import { load } from 'koffi'
import type { IKoffiLib } from 'koffi'

                    
const TITLE_MAX = 40
                                      
const TEXT_BUF_CHARS = 512

                                                              
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

let user32: IKoffiLib | null = null
let user32Failed = false
let fgFn: (() => unknown) | null = null
let titleFn: ((hwnd: unknown, buf: unknown, max: number) => unknown) | null = null

function win32(): IKoffiLib | null {
  if (user32Failed) return null
  if (!user32) {
    try {
      user32 = load('user32.dll')
    } catch (e) {
      user32Failed = true
      console.error('[capture] load user32.dll failed', e)
    }
  }
  return user32
}

                              
function resolveFns(): boolean {
  if (fgFn && titleFn) return true
  const lib = win32()
  if (!lib) return false
  try {
    fgFn = () => lib.func('void* __stdcall GetForegroundWindow()')()
    const getTitle = lib.func('int __stdcall GetWindowTextW(void* hWnd, void* lpString, int nMaxCount)')
    titleFn = (hwnd, buf, max) => getTitle(hwnd, buf, max)
    return true
  } catch (e) {
    console.error('[capture] resolve foreground functions failed', e)
    return false
  }
}

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
  if (!resolveFns() || !fgFn || !titleFn) return ''
  try {
    const hwnd = fgFn()
    if (!hwnd) return ''
    const buf = Buffer.alloc(TEXT_BUF_CHARS * 2)
    const len = Number(titleFn(hwnd, buf, TEXT_BUF_CHARS))
    if (!Number.isFinite(len) || len <= 0) return ''
    const title = buf.toString('ucs2', 0, len * 2)
    return appNameFromTitle(title)
  } catch (e) {
    console.error('[capture] read foreground window failed', e)
    return ''
  }
}
