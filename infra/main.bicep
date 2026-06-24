@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Name prefix for all resources (lowercase alphanumeric, max 12 chars).')
@maxLength(12)
param resourcePrefix string = 'mcpvm'

@description('Public container image, e.g. myacr.azurecr.io/azure-vm-mcp-server:latest')
param containerImage string = 'acrdefcontainer.azurecr.io/azure-vm-mcp-server:latest'

@description('Azure Subscription ID that the MCP server will manage VMs in. Defaults to the deployment subscription.')
param azureSubscriptionId string = subscription().subscriptionId

@secure()
@description('API key clients must send in the x-api-key header to call the MCP server.')
param mcpApiKey string

// ─── Azure Container Instance ─────────────────────────────────────────────────
// System-assigned managed identity is created automatically by ACI.
// No user-assigned identity or client secret needed.

var dnsLabel = '${resourcePrefix}-mcp-${uniqueString(resourceGroup().id)}'

resource aci 'Microsoft.ContainerInstance/containerGroups@2023-05-01' = {
  name: '${resourcePrefix}-mcp'
  location: location
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    sku: 'Standard'
    osType: 'Linux'
    restartPolicy: 'OnFailure'
    ipAddress: {
      type: 'Public'
      dnsNameLabel: dnsLabel
      ports: [
        { port: 80, protocol: 'TCP' }
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
              memoryInGB: json('1.5')
            }
          }
          ports: [
            { port: 80, protocol: 'TCP' }
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
  name: 'rbac-${resourcePrefix}-${uniqueString(resourceGroup().id)}'
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
output mcpSseUrl string = 'http://${aci.properties.ipAddress.fqdn}/sse'

@description('Health check URL.')
output healthUrl string = 'http://${aci.properties.ipAddress.fqdn}/health'
