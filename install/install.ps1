param(
  [switch]$Help
)

$ErrorActionPreference = "Stop"

$RepoOwner = "SaulgoodMan-C"
$RepoName = "saul-image-gen"
$RepoSlug = "$RepoOwner/$RepoName"
$DefaultApiUrl = "https://api.tu-zi.com/v1"
$DefaultModel = "gpt-image-2"
$InstallDir = if ($env:SAUL_IMAGE_GEN_DIR) {
  $env:SAUL_IMAGE_GEN_DIR
} else {
  Join-Path $HOME ".codex\skills\saul-skills\$RepoName"
}

function Show-Usage {
  @"
Usage: install.ps1 [-Help]

Installs Saul Image Gen into the Codex skills directory and guides .env setup.

Environment overrides:
  SAUL_IMAGE_GEN_DIR   Custom install directory.
"@
}

if ($Help) {
  Show-Usage
  exit 0
}

function Read-Value {
  param(
    [string]$Label,
    [string]$DefaultValue = "",
    [switch]$Secret
  )

  if ($Secret) {
    $secureValue = Read-Host "$Label" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secureValue)
    try {
      return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    } finally {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
  }

  if ($DefaultValue) {
    $value = Read-Host "$Label [$DefaultValue]"
  } else {
    $value = Read-Host "$Label"
  }

  if ([string]::IsNullOrWhiteSpace($value)) {
    return $DefaultValue
  }
  return $value
}

function Download-File {
  param(
    [string]$Url,
    [string]$OutputPath
  )
  Invoke-WebRequest -Uri $Url -OutFile $OutputPath -UseBasicParsing
}

function Download-Archive {
  param([string]$ArchivePath)

  $releaseUrl = "https://github.com/$RepoSlug/releases/latest/download/$RepoName.zip"
  $sourceUrl = "https://github.com/$RepoSlug/archive/refs/heads/main.zip"

  try {
    Download-File -Url $releaseUrl -OutputPath $ArchivePath
    Write-Host "Downloaded latest release package."
  } catch {
    Write-Host "Latest release package was not available. Falling back to main branch source package."
    Download-File -Url $sourceUrl -OutputPath $ArchivePath
  }
}

function Test-SamePath {
  param(
    [string]$Left,
    [string]$Right
  )

  try {
    $trimChars = [char[]]@("\", "/")
    $leftPath = (Resolve-Path -LiteralPath $Left -ErrorAction Stop).Path.TrimEnd($trimChars)
    $rightPath = (Resolve-Path -LiteralPath $Right -ErrorAction Stop).Path.TrimEnd($trimChars)
    return $leftPath -ieq $rightPath
  } catch {
    return $false
  }
}

function Get-LocalRepoRoot {
  $scriptPath = $PSCommandPath
  if (-not $scriptPath) {
    $scriptPath = $MyInvocation.MyCommand.Path
  }
  if (-not $scriptPath) {
    return $null
  }

  $scriptDir = Split-Path -Parent $scriptPath
  if (-not $scriptDir) {
    return $null
  }

  $repoRoot = Split-Path -Parent $scriptDir
  if ((Test-Path (Join-Path $repoRoot "SKILL.md")) -and (Test-SamePath -Left $repoRoot -Right $InstallDir)) {
    return $repoRoot
  }
  return $null
}

function Install-Files {
  $repoRoot = Get-LocalRepoRoot
  if ($repoRoot) {
    Write-Host "Saul Image Gen is already in the target skills directory."
    return
  }

  $tempDir = Join-Path ([IO.Path]::GetTempPath()) ("saul-image-gen-" + [Guid]::NewGuid().ToString("N"))
  $archivePath = Join-Path $tempDir "$RepoName.zip"
  $extractDir = Join-Path $tempDir "extract"

  New-Item -ItemType Directory -Force $tempDir, $extractDir | Out-Null
  try {
    Download-Archive -ArchivePath $archivePath
    Expand-Archive -Path $archivePath -DestinationPath $extractDir -Force
    $extractedRoot = Get-ChildItem -Path $extractDir -Directory | Select-Object -First 1
    if (-not $extractedRoot) {
      throw "Downloaded archive did not contain a folder."
    }

    $targetParent = Split-Path -Parent $InstallDir
    $tmpInstallDir = "$InstallDir.tmp"
    New-Item -ItemType Directory -Force $targetParent | Out-Null
    if (Test-Path $tmpInstallDir) {
      Remove-Item -Recurse -Force $tmpInstallDir
    }
    New-Item -ItemType Directory -Force $tmpInstallDir | Out-Null
    Copy-Item -Path (Join-Path $extractedRoot.FullName "*") -Destination $tmpInstallDir -Recurse -Force

    $existingEnv = Join-Path $InstallDir ".env"
    if (Test-Path $existingEnv) {
      Copy-Item -Path $existingEnv -Destination (Join-Path $tmpInstallDir ".env") -Force
    }

    if (Test-Path $InstallDir) {
      Remove-Item -Recurse -Force $InstallDir
    }
    Move-Item -Path $tmpInstallDir -Destination $InstallDir
    Write-Host "Installed to $InstallDir"
  } finally {
    if (Test-Path $tempDir) {
      Remove-Item -Recurse -Force $tempDir
    }
  }
}

function Write-EnvFile {
  $envPath = Join-Path $InstallDir ".env"
  if (Test-Path $envPath) {
    $answer = Read-Host ".env already exists. Reconfigure it now? [y/N]"
    if ($answer -notmatch "^(y|yes)$") {
      Write-Host "Kept existing .env."
      return
    }
  }

  Write-Host ""
  Write-Host "Image API configuration"
  $apiUrl = Read-Value -Label "IMAGE_API_URL" -DefaultValue $DefaultApiUrl
  do {
    $apiKey = Read-Value -Label "IMAGE_API_KEY" -Secret
    if ([string]::IsNullOrWhiteSpace($apiKey)) {
      Write-Host "IMAGE_API_KEY is required."
    }
  } while ([string]::IsNullOrWhiteSpace($apiKey))
  $model = Read-Value -Label "IMAGE_MODEL" -DefaultValue $DefaultModel

  $content = @"
[defaults]
DEFAULT_QUALITY=
DEFAULT_ASPECT_RATIO=
DEFAULT_OUTPUT_DIR=~/Desktop/images

[image-api]
IMAGE_API_KEY=$apiKey
IMAGE_API_URL=$apiUrl
IMAGE_MODEL=$model
IMAGE_WIRE_API=responses
IMAGE_REF_MODE=generations-json
"@
  Set-Content -Path $envPath -Value $content -Encoding UTF8
  Write-Host "Wrote $envPath"
}

function Check-Runtime {
  $node = Get-Command node -ErrorAction SilentlyContinue
  if ($node) {
    Write-Host "Node.js found: $(& node --version)"
  } else {
    Write-Host "Node.js was not found. Install Node.js before running image generation commands."
  }

  $npx = Get-Command npx -ErrorAction SilentlyContinue
  if ($npx) {
    Write-Host "npx found."
  } else {
    Write-Host "npx was not found. It is normally installed with Node.js."
  }
}

Write-Host "Saul Image Gen installer"
Install-Files
Write-EnvFile
Check-Runtime
Write-Host ""
Write-Host "Done. Test it with:"
Write-Host "npx -y tsx `"$InstallDir\scripts\main.ts`" --prompt `"一只戴墨镜的柴犬，赛博朋克风格`""
