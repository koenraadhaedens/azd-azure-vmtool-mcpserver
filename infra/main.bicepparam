using './main.bicep'

param location            = 'westeurope'
param resourcePrefix      = 'mcpvm'
param containerImage      = 'acrdefcontainer.azurecr.io/azure-vm-mcp-server:latest'
param azureSubscriptionId = 'd7131524-ea61-4cb5-8fcd-e90f1ec66097'
param mcpApiKey           = readEnvironmentVariable('MCP_API_KEY', '')
