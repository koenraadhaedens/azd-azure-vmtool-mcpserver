#!/bin/sh
# AZURE_ENV_NAME, AZURE_SUBSCRIPTION_ID and AZURE_RESOURCE_GROUP are injected
# directly as shell env vars by azd — do not use 'azd env get-value' for them.
RESOURCE_GROUP="${AZURE_RESOURCE_GROUP:-rg-${AZURE_ENV_NAME}}"

# Read FQDN from the most recent deployment output in the resource group.
FQDN=$(az deployment group list \
  --subscription "${AZURE_SUBSCRIPTION_ID}" \
  --resource-group "${RESOURCE_GROUP}" \
  --query "sort_by([],&properties.timestamp)[-1].properties.outputs.fqdn.value" \
  --output tsv 2>/dev/null)

echo ""
echo "================================================="
echo " MCP Server ready!"
echo " Add this URL to your agent:"
echo " http://${FQDN}/sse"
echo ""
echo " Set header:  x-api-key: <your mcpApiKey>"
echo "================================================="
echo ""
