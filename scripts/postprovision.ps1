# Bicep outputs are not yet stored when postprovision fires.
# Derive the resource group from AZURE_ENV_NAME and query Azure directly.
$envName       = azd env get-value AZURE_ENV_NAME 2>$null
$resourceGroup = "rg-$envName"
$subscription  = azd env get-value AZURE_SUBSCRIPTION_ID 2>$null

$fqdn = az container list `
  --subscription $subscription `
  --resource-group $resourceGroup `
  --query "[0].properties.ipAddress.fqdn" `
  --output tsv 2>$null

Write-Host ""
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host " MCP Server ready!" -ForegroundColor Green
Write-Host " Add this URL to your agent:" -ForegroundColor Green
Write-Host " http://$fqdn/sse" -ForegroundColor Yellow
Write-Host ""
Write-Host " Set header:  x-api-key: <your mcpApiKey>" -ForegroundColor Green
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""
