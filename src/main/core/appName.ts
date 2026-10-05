import { app } from 'electron'
import { existsSync, renameSync } from 'node:fs'
import { join } from 'node:path'

   
                                           
                                                         
                             
   
// 更名迁移（一次性，可在确认所有用户完成迁移后整段删除）：
// 剪巢(clipnest) → PasteMan(pasteman)，三级链路依次移交：
// userData 目录 → 数据子目录 → 库文件。旧在且新不在才搬，绝不覆盖新数据。
const appDataDir = app.getPath('appData')
const userDataTarget = join(appDataDir, 'pasteman')
const legacyUserData = join(appDataDir, 'clipnest')
if (existsSync(legacyUserData) && !existsSync(userDataTarget)) {
  renameSync(legacyUserData, userDataTarget)
}
const legacyDataDir = join(userDataTarget, 'clipnest-data')
const dataDir = join(userDataTarget, 'pasteman-data')
if (existsSync(legacyDataDir) && !existsSync(dataDir)) {
  renameSync(legacyDataDir, dataDir)
}
const legacyDbFile = join(dataDir, 'clipnest.db')
const dbTargetFile = join(dataDir, 'pasteman.db')
if (existsSync(legacyDbFile) && !existsSync(dbTargetFile)) {
  renameSync(legacyDbFile, dbTargetFile)
}

app.setName('pasteman')
app.setAppUserModelId('com.pasteman.app')
app.setPath('userData', userDataTarget)
