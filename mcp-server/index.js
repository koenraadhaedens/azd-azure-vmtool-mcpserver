import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import { getVmState, listVms, startVm, stopVm, restartVm } from './azure.js';

const REQUIRED_ENV = [
  'AZURE_TENANT_ID',
  'AZURE_CLIENT_ID',
  'AZURE_CLIENT_SECRET',
  'AZURE_SUBSCRIPTION_ID',
];

const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const TOOLS = [
  {
    name: 'get_vm_state',
    description:
      'Get the current power state (running, deallocated, stopped, etc.) of an Azure Virtual Machine.',
    inputSchema: {
      type: 'object',
      properties: {
        resourceGroup: { type: 'string', description: 'Name of the Azure Resource Group' },
        vmName:        { type: 'string', description: 'Name of the Virtual Machine' },
      },
      required: ['resourceGroup', 'vmName'],
    },
  },
  {
    name: 'list_vms',
    description: 'List all Virtual Machines in an Azure Resource Group with their size and provisioning state.',
    inputSchema: {
      type: 'object',
      properties: {
        resourceGroup: { type: 'string', description: 'Name of the Azure Resource Group' },
      },
      required: ['resourceGroup'],
    },
  },
  {
    name: 'start_vm',
    description: 'Start a deallocated or stopped Azure Virtual Machine.',
    inputSchema: {
      type: 'object',
      properties: {
        resourceGroup: { type: 'string', description: 'Name of the Azure Resource Group' },
        vmName:        { type: 'string', description: 'Name of the Virtual Machine' },
      },
      required: ['resourceGroup', 'vmName'],
    },
  },
  {
    name: 'stop_vm',
    description:
      'Stop (deallocate) an Azure Virtual Machine. Deallocating releases compute resources and stops billing for the VM.',
    inputSchema: {
      type: 'object',
      properties: {
        resourceGroup: { type: 'string', description: 'Name of the Azure Resource Group' },
        vmName:        { type: 'string', description: 'Name of the Virtual Machine' },
      },
      required: ['resourceGroup', 'vmName'],
    },
  },
  {
    name: 'restart_vm',
    description: 'Restart a running Azure Virtual Machine.',
    inputSchema: {
      type: 'object',
      properties: {
        resourceGroup: { type: 'string', description: 'Name of the Azure Resource Group' },
        vmName:        { type: 'string', description: 'Name of the Virtual Machine' },
      },
      required: ['resourceGroup', 'vmName'],
    },
  },
];

function createServer() {
  const srv = new Server(
    { name: 'azure-vm-controller', version: '1.0.0' },
    { capabilities: { tools: {} } }
  );

  srv.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  srv.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    try {
      let result;

      switch (name) {
        case 'get_vm_state':
          result = await getVmState(args.resourceGroup, args.vmName);
          break;
        case 'list_vms':
          result = await listVms(args.resourceGroup);
          break;
        case 'start_vm':
          result = await startVm(args.resourceGroup, args.vmName);
          break;
        case 'stop_vm':
          result = await stopVm(args.resourceGroup, args.vmName);
          break;
        case 'restart_vm':
          result = await restartVm(args.resourceGroup, args.vmName);
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }

      return {
        content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const message = err.response
        ? `Azure API error ${err.response.status}: ${JSON.stringify(err.response.data)}`
        : err.message;

      return {
        content: [{ type: 'text', text: `Error: ${message}` }],
        isError: true,
      };
    }
  });

  return srv;
}

// TRANSPORT=stdio → local/inspector use via stdin/stdout
// default          → HTTP + SSE for container/ACI hosting
if (process.env.TRANSPORT === 'stdio') {
  const transport = new StdioServerTransport();
  await createServer().connect(transport);
} else {
  const PORT = parseInt(process.env.PORT ?? '3000', 10);
  const app = express();
  app.use(express.json());

  // Each SSE connection gets its own Server instance; keyed by sessionId
  const sessions = new Map();

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.get('/sse', async (req, res) => {
    const transport = new SSEServerTransport('/messages', res);
    sessions.set(transport.sessionId, transport);
    res.on('close', () => sessions.delete(transport.sessionId));
    await createServer().connect(transport);
  });

  app.post('/messages', async (req, res) => {
    const transport = sessions.get(req.query.sessionId);
    if (!transport) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    await transport.handlePostMessage(req, res);
  });

  app.listen(PORT, () => {
    console.log(`MCP server listening on port ${PORT}`);
    console.log(`  SSE endpoint : http://localhost:${PORT}/sse`);
    console.log(`  Health check : http://localhost:${PORT}/health`);
  });
}
