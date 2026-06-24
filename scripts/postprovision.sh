#!/bin/sh
# Bicep outputs are not yet stored when postprovision fires.
# Derive the resource group from AZURE_ENV_NAME (matches azure.yaml: rg-${AZURE_ENV_NAME})
# and query Azure directly for the container FQDN.
ENV_NAME=$(azd env get-value AZURE_ENV_NAME 2>/dev/null)
RESOURCE_GROUP="rg-${ENV_NAME}"
SUBSCRIPTION=$(azd env get-value AZURE_SUBSCRIPTION_ID 2>/dev/null)

FQDN=$(az container list \
  --subscription "${SUBSCRIPTION}" \
  --resource-group "${RESOURCE_GROUP}" \
  --query "[0].properties.ipAddress.fqdn" \
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
