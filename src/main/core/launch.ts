import { app } from 'electron'

                                
export function applyLaunchAtLogin(enable: boolean): void {
  try {
    const args = app.isPackaged ? [] : [app.getAppPath()]
    app.setLoginItemSettings({
      openAtLogin: enable,
      openAsHidden: true,
      args,
      path: process.execPath,
    })
  } catch (e) {
    console.error('[clipnest] setLoginItemSettings failed', e)
  }
}
