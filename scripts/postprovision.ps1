# AZURE_ENV_NAME, AZURE_SUBSCRIPTION_ID and AZURE_RESOURCE_GROUP are injected
# directly as shell env vars by azd — do not use 'azd env get-value' for them.
$resourceGroup = if ($env:AZURE_RESOURCE_GROUP) { $env:AZURE_RESOURCE_GROUP } else { "rg-$env:AZURE_ENV_NAME" }

# Read FQDN from the most recent deployment output in the resource group.
$fqdn = az deployment group list `
  --subscription $env:AZURE_SUBSCRIPTION_ID `
  --resource-group $resourceGroup `
  --query "sort_by([],&properties.timestamp)[-1].properties.outputs.fqdn.value" `
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
