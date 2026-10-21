param(
    [Parameter(Mandatory = $false)]
    [string]$PythonExecutable = "python"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$venvDirectory = Join-Path $projectRoot ".venv"
$venvPython = Join-Path $venvDirectory "Scripts\python.exe"
$backendRequirements = Join-Path $projectRoot "backend\requirements.txt"
$demoGenerator = Join-Path $projectRoot "scripts\generate_demo.py"

function Invoke-ProjectCommand {
    param([string]$Executable, [string[]]$CommandArguments)
    & $Executable @CommandArguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $Executable $($CommandArguments -join ' ')"
    }
}

Push-Location -LiteralPath $projectRoot
try {
    $nodeCommand = (Get-Command -Name "node" -ErrorAction Stop).Source
    $npmCommand = (Get-Command -Name "npm.cmd" -ErrorAction Stop).Source
    Invoke-ProjectCommand -Executable $nodeCommand -CommandArguments @("-e", "const [major,minor]=process.versions.node.split('.').map(Number);if(major<22||(major===22&&minor<12)){console.error('Favescape setup requires Node.js 22.12 or newer.');process.exit(1)}")

    if (-not (Test-Path -LiteralPath $venvPython -PathType Leaf)) {
        $selectedPython = (Get-Command -Name $PythonExecutable -ErrorAction Stop).Source
        Invoke-ProjectCommand -Executable $selectedPython -CommandArguments @("-c", "import sys; sys.exit('Favescape requires Python 3.12 or newer.') if sys.version_info < (3, 12) else None")
        Write-Host "Creating the project Python environment..."
        Invoke-ProjectCommand -Executable $selectedPython -CommandArguments @("-m", "venv", $venvDirectory)
    }

    Invoke-ProjectCommand -Executable $venvPython -CommandArguments @("-c", "import sys; sys.exit('The existing .venv requires Python 3.12 or newer.') if sys.version_info < (3, 12) else None")
    Write-Host "Installing project Python dependencies..."
    Invoke-ProjectCommand -Executable $venvPython -CommandArguments @("-m", "pip", "install", "-r", $backendRequirements)

    Write-Host "Installing project JavaScript dependencies..."
    Invoke-ProjectCommand -Executable $npmCommand -CommandArguments @("install")

    Write-Host "Generating the original local demo audio..."
    Invoke-ProjectCommand -Executable $venvPython -CommandArguments @($demoGenerator)
    Write-Host "Ready. Run npm run dev, then open http://127.0.0.1:5173."
}
finally {
    Pop-Location
}
