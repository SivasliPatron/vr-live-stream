$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskNode = (Get-Command node.exe -ErrorAction Stop).Source
$taskChrome = @(
  (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
  (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
  (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (!$taskChrome) { throw 'Google Chrome wurde nicht gefunden.' }
$taskHost = Join-Path $taskRoot 'scripts\host.mjs'
$taskShell = New-Object -ComObject WScript.Shell
$taskEntries = @(
  @{ Name='00 Zugangscode anzeigen'; Target=$taskNode; Args=('"{0}" --code' -f $taskHost) },
  @{ Name='01 Meta-Casting'; Target=$taskChrome; Args='--new-window "https://www.meta.com/casting/"' },
  @{ Name='02 VR-Stream 720p60'; Target=$taskNode; Args=('"{0}" --60' -f $taskHost) },
  @{ Name='03 VR-Stream 720p30'; Target=$taskNode; Args=('"{0}" --30' -f $taskHost) },
  @{ Name='04 Zuschauer-Seite'; Target=$taskChrome; Args='--new-window "https://sivaslipatron.github.io/vr-live-stream/"' }
)
foreach ($taskEntry in $taskEntries) {
  $taskLinkPath = Join-Path $taskRoot ($taskEntry.Name + '.lnk')
  $taskLink = $taskShell.CreateShortcut($taskLinkPath)
  $taskLink.TargetPath = $taskEntry.Target
  $taskLink.Arguments = $taskEntry.Args
  $taskLink.WorkingDirectory = $taskRoot
  $taskLink.WindowStyle = 1
  $taskLink.Save()
  $taskCheck = $taskShell.CreateShortcut($taskLinkPath)
  if ($taskCheck.TargetPath -ne $taskEntry.Target -or $taskCheck.Arguments -ne $taskEntry.Args) { throw 'Verknüpfung konnte nicht geprüft werden.' }
}
Write-Output 'Fünf neue Startverknüpfungen erstellt und geprüft.'
