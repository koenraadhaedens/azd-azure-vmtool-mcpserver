@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Name prefix for all resources (lowercase alphanumeric, max 12 chars).')
@maxLength(12)
param resourcePrefix string

@description('Public container image, e.g. myacr.azurecr.io/azure-vm-mcp-server:latest')
param containerImage string

@description('Azure Subscription ID that the MCP server will manage VMs in.')
param azureSubscriptionId string

@secure()
@minLength(1)
@description('API key clients must send in the x-api-key header to call the MCP server.')
param mcpApiKey string

// ─── Azure Container Instance ─────────────────────────────────────────────────
// System-assigned managed identity is created automatically by ACI.
// No user-assigned identity or client secret needed.

resource aci 'Microsoft.ContainerInstance/containerGroups@2023-05-01' = {
  name: '${resourcePrefix}-mcp'
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    osType: 'Linux'
    restartPolicy: 'Always'
    ipAddress: {
      type: 'Public'
      dnsNameLabel: '${resourcePrefix}-mcp'
      ports: [
        { port: 3000, protocol: 'TCP' }
      ]
    }
    containers: [
      {
        name: 'mcp-vm-server'
        properties: {
          image: containerImage
          resources: {
            requests: {
              cpu: 1
              memoryInGB: 1
            }
          }
          ports: [
            { port: 3000, protocol: 'TCP' }
          ]
          environmentVariables: [
            { name: 'AZURE_SUBSCRIPTION_ID', value: azureSubscriptionId }
            { name: 'MCP_API_KEY',           secureValue: mcpApiKey }
          ]
        }
      }
    ]
  }
}

// Assign the custom VM operator role to the system-assigned identity.
// Deployed after ACI so the principalId is available.
module rbac 'modules/rbac.bicep' = {
  name: 'rbac-${resourcePrefix}'
  scope: subscription()
  params: {
    principalId: aci.identity.principalId
    resourcePrefix: resourcePrefix
  }
}

// ─── Outputs ──────────────────────────────────────────────────────────────────

@description('Public FQDN of the container instance.')
output fqdn string = aci.properties.ipAddress.fqdn

@description('MCP server SSE endpoint for Copilot Studio.')
output mcpSseUrl string = 'http://${aci.properties.ipAddress.fqdn}:3000/sse'

@description('Health check URL.')
output healthUrl string = 'http://${aci.properties.ipAddress.fqdn}:3000/health'
