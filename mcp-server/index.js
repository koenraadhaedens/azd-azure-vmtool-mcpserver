import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'crypto';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import cors from 'cors';
import { getVmState, listVms, listAllVms, startVm, stopVm, restartVm } from './azure.js';

const REQUIRED = ['AZURE_SUBSCRIPTION_ID'];
const missing = REQUIRED.filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`Missing required environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

if (process.env.TRANSPORT !== 'stdio' && !process.env.MCP_API_KEY) {
  console.error('Missing required environment variable: MCP_API_KEY');
  process.exit(1);
}

// Validates the x-api-key header against MCP_API_KEY.
function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== process.env.MCP_API_KEY) {
    res.status(401).json({ error: 'Invalid or missing API key' });
    return;
  }
  next();
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
  {
    name: 'list_all_vms',
    description: 'List all Virtual Machines across all Resource Groups in the subscription.',
    inputSchema: {
      type: 'object',
      properties: {},
      required: [],
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
    const armToken = null;

    try {
      let result;

      switch (name) {
        case 'get_vm_state':
          result = await getVmState(args.resourceGroup, args.vmName, armToken);
          break;
        case 'list_vms':
          result = await listVms(args.resourceGroup, armToken);
          break;
        case 'start_vm':
          result = await startVm(args.resourceGroup, args.vmName, armToken);
          break;
        case 'stop_vm':
          result = await stopVm(args.resourceGroup, args.vmName, armToken);
          break;
        case 'restart_vm':
          result = await restartVm(args.resourceGroup, args.vmName, armToken);
          break;
        case 'list_all_vms':
          result = await listAllVms(armToken);
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
  const PORT = parseInt(process.env.PORT ?? '80', 10);
  const app = express();
  app.use(cors());
  app.use(express.json());

  const sessions = new Map();

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  // POST /sse — Streamable HTTP transport used by Copilot Studio and modern MCP clients.
  // Handles both initialization (no mcp-session-id) and subsequent requests.
  app.post('/sse', requireApiKey, async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    let transport;

    if (sessionId && sessions.has(sessionId)) {
      transport = sessions.get(sessionId);
    } else {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => sessions.set(id, transport),
      });
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };
      await createServer().connect(transport);
    }

    await transport.handleRequest(req, res, req.body);
  });

  // GET /sse — SSE event stream for server-initiated messages.
  app.get('/sse', requireApiKey, async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    const transport = sessions.get(sessionId);
    if (!transport) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    await transport.handleRequest(req, res);
  });

  // DELETE /sse — session termination.
  app.delete('/sse', requireApiKey, async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    if (sessionId && sessions.has(sessionId)) {
      const transport = sessions.get(sessionId);
      await transport.close();
      sessions.delete(sessionId);
    }
    res.status(200).json({ message: 'Session terminated' });
  });

  app.listen(PORT, () => {
    console.log(`MCP server listening on port ${PORT}`);
    console.log(`  MCP endpoint : http://localhost:${PORT}/sse`);
    console.log(`  Health check : http://localhost:${PORT}/health`);
  });
}
