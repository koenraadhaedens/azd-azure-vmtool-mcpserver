targetScope = 'subscription'

@description('Principal ID of the managed identity to assign the role to.')
param principalId string

@description('Prefix used to generate a unique, stable role definition name.')
param resourcePrefix string

// Custom role limited to the exact actions the MCP server needs.
// Excludes VM create/delete and all other resource types.
resource vmOperatorRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' = {
  name: guid(subscription().id, resourcePrefix, 'mcp-vm-operator')
  properties: {
    roleName: '${resourcePrefix}-mcp-vm-operator'
    description: 'Read, start, stop (deallocate), and restart Azure Virtual Machines. Scoped for the MCP VM server.'
    type: 'CustomRole'
    permissions: [
      {
        actions: [
          'Microsoft.Compute/virtualMachines/read'
          'Microsoft.Compute/virtualMachines/instanceView/read'
          'Microsoft.Compute/virtualMachines/start/action'
          'Microsoft.Compute/virtualMachines/deallocate/action'
          'Microsoft.Compute/virtualMachines/restart/action'
          'Microsoft.Compute/disks/read'
          'Microsoft.Compute/disks/write'
        ]
        notActions: []
        dataActions: []
        notDataActions: []
      }
    ]
    assignableScopes: [
      subscription().id
    ]
  }
}

resource vmRoleAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(subscription().id, principalId, vmOperatorRole.id)
  properties: {
    roleDefinitionId: vmOperatorRole.id
    principalId: principalId
    principalType: 'ServicePrincipal'
  }
}

