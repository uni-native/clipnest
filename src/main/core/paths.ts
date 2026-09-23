import { app } from 'electron'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

                                                        
export const userDataDir = join(app.getPath('userData'), 'clipnest-data')

                                
export const dbFile = 'clipnest.db'
export const dbPath = join(userDataDir, dbFile)

                 
export const blobsDir = join(userDataDir, 'blobs')
export const imagesDir = join(blobsDir, 'images')

                                  
export const modelsDir = join(userDataDir, 'models')

export const logsDir = join(userDataDir, 'logs')

export function ensureDirs(): void {
  mkdirSync(userDataDir, { recursive: true })
  mkdirSync(blobsDir, { recursive: true })
  mkdirSync(imagesDir, { recursive: true })
  mkdirSync(modelsDir, { recursive: true })
  mkdirSync(logsDir, { recursive: true })
}
