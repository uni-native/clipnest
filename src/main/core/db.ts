import Database from 'better-sqlite3'
import { dbPath, ensureDirs } from './paths'
import { migrate } from './schema'

   
                                 
                                        
   
export function openDb(file: string = dbPath): Database.Database {
  ensureDirs()
  const db = new Database(file)
                                                   
                                    
  db.pragma('auto_vacuum = INCREMENTAL')
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 3000')
  db.pragma('synchronous = NORMAL')
  migrate(db)
  return db
}
