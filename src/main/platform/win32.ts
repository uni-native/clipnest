   
                                                  
                                                                      
  
                                                        
                                                        
   
import { address, alloc, array, decode, encode, load, sizeof, struct, union } from 'koffi'

                                                                              

                                                
export const GMEM_MOVEABLE = 0x0002
                           
export const CF_HDROP = 15
                      
export const INPUT_KEYBOARD = 1
                      
export const KEYEVENTF_KEYUP = 0x0002
export const VK_CONTROL = 0x11
export const VK_V = 0x56

                                                                               

   
                                                                   
                                                            
                                       
   
const KEYBDINPUT = struct('KEYBDINPUT', {
  wVk: 'uint16',
  wScan: 'uint16',
  dwFlags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'void*',
})
const MOUSEINPUT = struct('MOUSEINPUT', {
  dx: 'int32',
  dy: 'int32',
  mouseData: 'uint32',
  dwFlags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'void*',
})
const HARDWAREINPUT = struct('HARDWAREINPUT', {
  uMsg: 'uint32',
  wParamL: 'uint16',
  wParamH: 'uint16',
})
const INPUT_UNION = union('INPUT_UNION', { mi: MOUSEINPUT, ki: KEYBDINPUT, hi: HARDWAREINPUT })

export const INPUT = struct('INPUT', { type: 'uint32', u: INPUT_UNION })
export const INPUT_SIZE = sizeof(INPUT)

const DROPFILES_PT = struct('DROPFILES_PT', { x: 'int32', y: 'int32' })
export const DROPFILES = struct('DROPFILES', {
  pFiles: 'uint32',
  pt: DROPFILES_PT,
  fNC: 'int32',
  fWide: 'int32',
})
export const DROPFILES_SIZE = sizeof(DROPFILES)

                                                                              

export interface Win32Api {
  GetClipboardSequenceNumber(): number
  GetForegroundWindow(): unknown
  SetForegroundWindow(hWnd: unknown): number
  GetWindowTextLengthW(hWnd: unknown): number
  GetWindowTextW(hWnd: unknown, lpString: unknown, nMaxCount: number): number
  GetCurrentThreadId(): number
  GetWindowThreadProcessId(hWnd: unknown, lpdwProcessId: unknown): number
  AttachThreadInput(idAttach: number, idAttachTo: number, fAttach: number): number
  SendInput(nInputs: number, pInputs: unknown, cbSize: number): number
  GlobalAlloc(uFlags: number, dwBytes: number): unknown
  GlobalLock(hMem: unknown): unknown
  GlobalUnlock(hMem: unknown): number
  OpenClipboard(hWnd: unknown): number
  CloseClipboard(): number
  EmptyClipboard(): number
  GetClipboardData(uFormat: number): unknown
  SetClipboardData(uFormat: number, hMem: unknown): unknown
  IsClipboardFormatAvailable(uFormat: number): number
  DragQueryFileW(hDrop: unknown, iFile: number, lpszFile: unknown, cch: number): number
                                                        
  sendCtrlV(): number
}

let api: Win32Api | null = null

                                                       
function bindRaw(): Omit<Win32Api, 'sendCtrlV'> {
  const user32 = load('user32.dll')
  const kernel32 = load('kernel32.dll')

  return {
    GetClipboardSequenceNumber: user32.func('uint32 __stdcall GetClipboardSequenceNumber()'),
    GetForegroundWindow: user32.func('void* __stdcall GetForegroundWindow()'),
    SetForegroundWindow: user32.func('int __stdcall SetForegroundWindow(void* hWnd)'),
    GetWindowTextLengthW: user32.func('int __stdcall GetWindowTextLengthW(void* hWnd)'),
    GetWindowTextW: user32.func('int __stdcall GetWindowTextW(void* hWnd, char16_t* lpString, int nMaxCount)'),
    GetCurrentThreadId: kernel32.func('uint32 __stdcall GetCurrentThreadId()'),
    GetWindowThreadProcessId: user32.func('uint32 __stdcall GetWindowThreadProcessId(void* hWnd, uint32* lpdwProcessId)'),
    AttachThreadInput: user32.func('int __stdcall AttachThreadInput(uint32 idAttach, uint32 idAttachTo, int fAttach)'),
    SendInput: user32.func('uint32 __stdcall SendInput(uint32 nInputs, INPUT* pInputs, int cbSize)'),
    GlobalAlloc: kernel32.func('void* __stdcall GlobalAlloc(uint32 uFlags, unsigned long long dwBytes)'),
    GlobalLock: kernel32.func('void* __stdcall GlobalLock(void* hMem)'),
    GlobalUnlock: kernel32.func('int __stdcall GlobalUnlock(void* hMem)'),
    OpenClipboard: user32.func('int __stdcall OpenClipboard(void* hWnd)'),
    CloseClipboard: user32.func('int __stdcall CloseClipboard()'),
    EmptyClipboard: user32.func('int __stdcall EmptyClipboard()'),
    GetClipboardData: user32.func('void* __stdcall GetClipboardData(uint32 uFormat)'),
    SetClipboardData: user32.func('void* __stdcall SetClipboardData(uint32 uFormat, void* hMem)'),
    IsClipboardFormatAvailable: user32.func('int __stdcall IsClipboardFormatAvailable(uint32 uFormat)'),
    DragQueryFileW: load('shell32.dll').func('uint32 __stdcall DragQueryFileW(void* hDrop, uint32 iFile, char16_t* lpszFile, uint32 cch)'),
  }
}

                                       
export function getWin32(): Win32Api {
  if (api) return api
  const raw = bindRaw()
  const keyEvent = (vk: number, flags: number): unknown => ({
    type: INPUT_KEYBOARD,
    u: { ki: { wVk: vk, wScan: 0, dwFlags: flags, time: 0, dwExtraInfo: null } },
  })
  api = {
    ...raw,
    sendCtrlV: () =>
      raw.SendInput(
        4,
        [
          keyEvent(VK_CONTROL, 0),
          keyEvent(VK_V, 0),
          keyEvent(VK_V, KEYEVENTF_KEYUP),
          keyEvent(VK_CONTROL, KEYEVENTF_KEYUP),
        ],
        INPUT_SIZE,
      ),
  }
  return api
}

                                                                              

   
                                               
                                                         
   
export function handleToNumber(handle: unknown): number | null {
  if (handle === null || handle === undefined) return null
  const value = Number(address(handle))
  return value > 0 ? value : null
}

                            
export function windowTitle(hWnd: unknown): string {
  const w = getWin32()
  const len = w.GetWindowTextLengthW(hWnd)
  if (len <= 0) return ''
  const buf = alloc('char16_t', len + 1)
  const copied = w.GetWindowTextW(hWnd, buf, len + 1)
  if (copied <= 0) return ''
  return decode(buf, 'char16_t', copied) as string
}

                                    
export function windowProcessId(hWnd: unknown): number {
  const w = getWin32()
  const buf = alloc('uint32', 4)
  w.GetWindowThreadProcessId(hWnd, buf)
                                                           
  const decoded: ArrayLike<number> = decode(buf, 'uint32', 1)
  return decoded.length > 0 ? Number(decoded[0]) : 0
}

   
                       
                                                                    
                                           
                       
   
export function clipboardFilePaths(): string[] {
  const w = getWin32()
  if (!w.IsClipboardFormatAvailable(CF_HDROP)) return []
  if (!openClipboardWithRetry(w)) return []
  try {
    const hDrop = w.GetClipboardData(CF_HDROP)
    if (!hDrop) return []
    const count = w.DragQueryFileW(hDrop, 0xffffffff, null, 0)
    const paths: string[] = []
    for (let i = 0; i < count; i++) {
      const len = w.DragQueryFileW(hDrop, i, null, 0)
      if (len <= 0) continue
      const buf = alloc('char16_t', len + 1)
      const copied = w.DragQueryFileW(hDrop, i, buf, len + 1)
      if (copied > 0) paths.push(decode(buf, 'char16_t', copied) as string)
    }
    return paths
  } catch (e) {
    console.error('[clipnest] read CF_HDROP failed', e)
    return []
  } finally {
    w.CloseClipboard()
  }
}

                                       
export function openClipboardWithRetry(w: Win32Api, attempts = 3, intervalMs = 30): boolean {
  for (let i = 0; i < attempts; i++) {
    if (w.OpenClipboard(null)) return true
    const until = Date.now() + intervalMs
    while (Date.now() < until) {
                                                           
    }
  }
  return false
}

   
                              
                                   
                                            
   
export function dropFilesPayload(paths: string[]): { codes: number[]; size: number } {
  const joined = paths.join('\0') + '\0\0'
  const codes: number[] = []
  for (let i = 0; i < joined.length; i++) codes.push(joined.charCodeAt(i))
  return { codes, size: DROPFILES_SIZE + codes.length * 2 }
}

   
                                                           
                                                                     
                                   
   
export function writeDropFiles(hMem: unknown, codes: number[]): void {
  const w = getWin32()
  const locked = w.GlobalLock(hMem)
  if (!locked) throw new Error('writeDropFiles: GlobalLock failed')
  try {
    encode(locked, DROPFILES, {
      pFiles: DROPFILES_SIZE,
      pt: { x: 0, y: 0 },
      fNC: 0,
      fWide: 1,
    })
    encode(locked, DROPFILES_SIZE, array('char16_t', codes.length), codes)
  } finally {
    w.GlobalUnlock(hMem)
  }
}
