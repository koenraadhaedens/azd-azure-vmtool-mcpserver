<#
.SYNOPSIS
    Ensures MCP_API_KEY is set in the azd environment before provisioning.
.DESCRIPTION
    If MCP_API_KEY is not already stored in the azd environment, prompts the
    user to enter a value and saves it via 'azd env set'. azd exports all
    environment values before Bicep compilation, so readEnvironmentVariable
    in main.bicepparam will resolve the value correctly.
#>

$ErrorActionPreference = 'Stop'

$ExistingKey = azd env get-value MCP_API_KEY 2>$null
if ($ExistingKey) {
    Write-Host "MCP_API_KEY is already set in the azd environment."
    exit 0
}

Write-Host ""
Write-Host "MCP_API_KEY is required to secure the MCP server endpoint."
$SecureKey = Read-Host "Enter MCP API Key" -AsSecureString
$PlainKey = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto(
    [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureKey)
)

if (-not $PlainKey) {
    Write-Error "MCP_API_KEY cannot be empty."
    exit 1
}

azd env set MCP_API_KEY $PlainKey
Write-Host "MCP_API_KEY saved to azd environment."
