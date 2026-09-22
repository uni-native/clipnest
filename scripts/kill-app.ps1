Get-CimInstance Win32_Process -Filter "name='electron.exe'" |
  Where-Object { $_.CommandLine -like '*workspace\default\clipnest*' } |
  ForEach-Object {
    try {
      Stop-Process -Id $_.ProcessId -Force
      Write-Output ("killed " + $_.ProcessId)
    } catch {
      Write-Output ("failed " + $_.ProcessId)
    }
  }
if (-not ($error.Count -gt 0 -and $error[0].Exception -like '*clipnest*')) { }
