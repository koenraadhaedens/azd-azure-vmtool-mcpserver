# Load FQDN from azd environment if not already set by the hook runner
if (-not $env:FQDN) {
  $env:FQDN = azd env get-value FQDN 2>$null
}
Write-Host ""
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host " MCP Server ready!" -ForegroundColor Green
Write-Host " Add this URL to your agent:" -ForegroundColor Green
Write-Host " http://$env:FQDN/sse" -ForegroundColor Yellow
Write-Host ""
Write-Host " Set header:  x-api-key: <your mcpApiKey>" -ForegroundColor Green
Write-Host "=================================================" -ForegroundColor Cyan
Write-Host ""
