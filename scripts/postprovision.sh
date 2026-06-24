#!/bin/sh
# Load FQDN from azd environment if not already set by the hook runner
if [ -z "${FQDN}" ]; then
  FQDN=$(azd env get-value FQDN 2>/dev/null)
fi

echo ""
echo "================================================="
echo " MCP Server ready!"
echo " Add this URL to your agent:"
echo " http://${FQDN}/sse"
echo ""
echo " Set header:  x-api-key: <your mcpApiKey>"
echo "================================================="
echo ""
