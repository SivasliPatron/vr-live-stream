[CmdletBinding()]
param(
    [string] $ProjectRoot = (Split-Path -Parent $PSScriptRoot),
    [string] $NodePath,
    [string] $ChromePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# Installiert nur Verknuepfungen. Liest keine Senderdaten, aendert keinen Code
# und startet weder den Stream noch andere Anwendungen.
function Resolve-LauncherExecutable {
    param(
        [string] $ExplicitPath,
        [string[]] $Candidates,
        [string] $DisplayName
    )

    $pathsToCheck = if ($ExplicitPath) { @($ExplicitPath) } else { $Candidates }
    foreach ($candidate in $pathsToCheck) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return (Resolve-Path -LiteralPath $candidate).ProviderPath
        }
    }
    throw "$DisplayName wurde nicht gefunden. Die Verknuepfungen wurden nicht veraendert."
}

if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) {
    throw 'Der Projektordner wurde nicht gefunden.'
}
$resolvedProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).ProviderPath
$launcherPath = Join-Path $resolvedProjectRoot 'scripts\start-stream.mjs'
if (-not (Test-Path -LiteralPath $launcherPath -PathType Leaf)) {
    throw 'scripts\start-stream.mjs fehlt. Die Verknuepfungen wurden nicht veraendert.'
}

$nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
$nodeCandidates = @()
if ($nodeCommand) { $nodeCandidates += $nodeCommand.Source }
if ($env:ProgramFiles) { $nodeCandidates += Join-Path $env:ProgramFiles 'nodejs\node.exe' }
if ($env:LOCALAPPDATA) { $nodeCandidates += Join-Path $env:LOCALAPPDATA 'Programs\nodejs\node.exe' }
$resolvedNodePath = Resolve-LauncherExecutable -ExplicitPath $NodePath -Candidates $nodeCandidates -DisplayName 'Node.js'

$chromeCandidates = @()
if ($env:ProgramFiles) { $chromeCandidates += Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe' }
if (${env:ProgramFiles(x86)}) { $chromeCandidates += Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe' }
if ($env:LOCALAPPDATA) { $chromeCandidates += Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe' }
$resolvedChromePath = Resolve-LauncherExecutable -ExplicitPath $ChromePath -Candidates $chromeCandidates -DisplayName 'Google Chrome'

$quotedLauncherPath = '"' + $launcherPath + '"'
$shortcutDefinitions = @(
    @{
        Name = '00 AKTUELLEN ZUGANGSCODE ANZEIGEN.lnk'
        Target = $resolvedNodePath
        Arguments = "$quotedLauncherPath --show-code"
        Description = 'Den vorhandenen Zugangscode anzeigen; die Sitzung bleibt unveraendert.'
    },
    @{
        Name = '01 Meta-Casting (Chrome).lnk'
        Target = $resolvedChromePath
        Arguments = '--new-window "https://www.meta.com/casting/"'
        Description = 'Meta-Casting in Google Chrome oeffnen.'
    },
    @{
        Name = '02 VR-Stream 720p60 (Chrome).lnk'
        Target = $resolvedNodePath
        Arguments = "$quotedLauncherPath --fps 60 --new-session"
        Description = '720p60 starten und einen neuen Zugangscode erzeugen.'
    },
    @{
        Name = '03 VR-Stream 720p30 (Chrome).lnk'
        Target = $resolvedNodePath
        Arguments = "$quotedLauncherPath --fps 30"
        Description = '720p30 mit dem bestehenden Zugangscode starten.'
    },
    @{
        Name = '04 Zuschauer-Seite.lnk'
        Target = $resolvedChromePath
        Arguments = '--new-window "https://sivaslipatron.github.io/vr-live-stream/"'
        Description = 'Die oeffentliche Zuschauer-Seite in Google Chrome oeffnen.'
    }
)

# Alle Ziele sind geprueft, bevor die erste Verknuepfung geschrieben wird.
$shortcutShell = New-Object -ComObject WScript.Shell
$privateDirectory = Join-Path $resolvedProjectRoot '.private'
if (-not (Test-Path -LiteralPath $privateDirectory -PathType Container)) {
    New-Item -ItemType Directory -Path $privateDirectory | Out-Null
}
foreach ($shortcutDirectory in @($resolvedProjectRoot, $privateDirectory)) {
    foreach ($definition in $shortcutDefinitions) {
        $shortcutPath = Join-Path $shortcutDirectory $definition.Name
        $shortcut = $shortcutShell.CreateShortcut($shortcutPath)
        $shortcut.TargetPath = $definition.Target
        $shortcut.Arguments = $definition.Arguments
        $shortcut.WorkingDirectory = $resolvedProjectRoot
        $shortcut.WindowStyle = 1
        $shortcut.Description = $definition.Description
        $shortcut.IconLocation = "$resolvedChromePath,0"
        $shortcut.Save()

        $savedShortcut = $shortcutShell.CreateShortcut($shortcutPath)
        if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf) -or
            $savedShortcut.TargetPath -ne $definition.Target -or
            $savedShortcut.Arguments -ne $definition.Arguments -or
            $savedShortcut.WorkingDirectory -ne $resolvedProjectRoot -or
            $savedShortcut.WindowStyle -ne 1) {
            throw ('Die Verknuepfung konnte nicht korrekt gespeichert werden: ' + $definition.Name)
        }
    }
}

Write-Output 'Zehn Startverknuepfungen wurden installiert und geprueft. Keine Anwendung wurde gestartet; Senderdaten und Zugangscode bleiben unveraendert.'
