targetScope = 'subscription'

@description('Principal ID of the managed identity to assign the role to.')
param principalId string

@description('Prefix used to generate a unique, stable role definition name.')
param resourcePrefix string

// Custom role limited to the exact actions the MCP server needs.
resource vmOperatorRole 'Microsoft.Authorization/roleDefinitions@2022-04-01' = {
  name: guid(subscription().id, resourcePrefix, 'mcp-vm-operator')
  properties: {
    roleName: '${resourcePrefix}-mcp-vm-operator'
    description: 'Read, create, delete, start, stop (deallocate), and restart Azure Virtual Machines, and manage associated Network resources. Scoped for the MCP VM server.'
    type: 'CustomRole'
    permissions: [
      {
        actions: [
          // Virtual Machine lifecycle
          'Microsoft.Compute/virtualMachines/read'
          'Microsoft.Compute/virtualMachines/instanceView/read'
          'Microsoft.Compute/virtualMachines/write'
          'Microsoft.Compute/virtualMachines/delete'
          'Microsoft.Compute/virtualMachines/start/action'
          'Microsoft.Compute/virtualMachines/deallocate/action'
          'Microsoft.Compute/virtualMachines/restart/action'
          // Disk management
          'Microsoft.Compute/disks/read'
          'Microsoft.Compute/disks/write'
          'Microsoft.Compute/disks/delete'
          // Network resources needed for VM creation
          'Microsoft.Network/virtualNetworks/read'
          'Microsoft.Network/virtualNetworks/write'
          'Microsoft.Network/virtualNetworks/subnets/read'
          'Microsoft.Network/virtualNetworks/subnets/write'
          'Microsoft.Network/virtualNetworks/subnets/join/action'
          'Microsoft.Network/networkInterfaces/read'
          'Microsoft.Network/networkInterfaces/write'
          'Microsoft.Network/networkInterfaces/delete'
          'Microsoft.Network/networkInterfaces/join/action'
          // Resource Group read (list VMs, resolve resources)
          'Microsoft.Resources/subscriptions/resourceGroups/read'
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

