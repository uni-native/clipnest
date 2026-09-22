                                                                   
const { execSync } = require('node:child_process')

const ps = `
Get-CimInstance Win32_Process -Filter "name='electron.exe'" |
  Where-Object { $_.CommandLine -like '*workspace\\default\\clipnest*' } |
  ForEach-Object { "$($_.ProcessId)" }
`.trim()

try {
  const out = execSync(`powershell -NoProfile -Command "${ps.replace(/\n/g, ' ')}"`, { encoding: 'latin1' })
  const pids = out.split(/\s+/).filter(s => /^\d+$/.test(s.trim())).map(s => s.trim())
  if (pids.length === 0) {
    console.log('no clipnest electron processes')
  } else {
    for (const pid of pids) {
      try {
        execSync(`taskkill /f /pid ${pid}`)
        console.log('killed pid', pid)
      } catch (e) {
        console.log('kill failed', pid, e.message.slice(0, 60))
      }
    }
  }
} catch (e) {
  console.log('query failed:', e.message.slice(0, 120))
}
