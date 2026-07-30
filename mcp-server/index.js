import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { randomUUID } from 'crypto';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import express from 'express';
import cors from 'cors';
import { getVmState, listVms, listAllVms, startVm, stopVm, restartVm, listVmDisks, changeDiskSku, createVm, deleteVm } from './azure.js';

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
// OPTIONS requests are passed through to allow CORS preflight.
function requireApiKey(req, res, next) {
  if (req.method === 'OPTIONS') {
    next();
    return;
  }
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
  {
    name: 'list_vm_disks',
    description: 'List all disks (OS and data) attached to an Azure Virtual Machine, including their current SKU/performance tier.',
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
    name: 'change_disk_sku',
    description:
      'Change the performance tier (SKU) of an Azure managed disk. ' +
      'Standard HDD tiers: Standard_LRS. ' +
      'Standard SSD tiers: StandardSSD_LRS. ' +
      'Premium SSD tiers: Premium_LRS (e.g. P10, P20, P30). ' +
      'Ultra Disk: UltraSSD_LRS. ' +
      'Common shorthand values like S10, P20 map to Standard_LRS / Premium_LRS with the appropriate size tier. ' +
      'The disk must exist as a managed disk; the VM does not need to be deallocated for a SKU-only change.',
    inputSchema: {
      type: 'object',
      properties: {
        resourceGroup: { type: 'string', description: 'Resource Group that contains the disk (or the VM)' },
        diskName:      { type: 'string', description: 'Name of the managed disk to update' },
        newSku:        {
          type: 'string',
          description:
            'Target SKU. Accepts ARM names (Standard_LRS, StandardSSD_LRS, Premium_LRS, UltraSSD_LRS, Premium_ZRS, StandardSSD_ZRS) ' +
            'or shorthand tier codes: S4/S10/S20/… → Standard_LRS (HDD), E4/E10/E20/… → StandardSSD_LRS, P4/P10/P20/P30/… → Premium_LRS, U → UltraSSD_LRS.',
        },
      },
      required: ['resourceGroup', 'diskName', 'newSku'],
    },
  },
  {
    name: 'create_vm',
    description:
      'Create a new Azure Virtual Machine. ' +
      'A VNet, subnet, and NIC are created automatically if no subnetId is provided. ' +
      'Supported image shorthands: Ubuntu2204 (default), Ubuntu2004, Win2022, Win2019. ' +
      'If resourceGroup is omitted the VM is created in the deployment resource group.',
    inputSchema: {
      type: 'object',
      properties: {
        resourceGroup: { type: 'string',  description: 'Name of an existing Azure Resource Group. Defaults to the resource group this MCP server was deployed into.' },
        vmName:        { type: 'string',  description: 'Name for the new Virtual Machine (also used to name auto-created network resources)' },
        location:      { type: 'string',  description: 'Azure region, e.g. eastus, westeurope' },
        vmSize:        { type: 'string',  description: 'VM size, e.g. Standard_B2s, Standard_D2s_v3. Defaults to Standard_B2s.' },
        adminUsername: { type: 'string',  description: 'Administrator username for the VM' },
        adminPassword: { type: 'string',  description: 'Administrator password. Must be 12-123 characters and meet Azure complexity requirements.' },
        image:         { type: 'string',  description: 'OS image shorthand: Ubuntu2204 (default), Ubuntu2004, Win2022, Win2019.' },
        subnetId:      { type: 'string',  description: 'Full ARM resource ID of an existing subnet. If omitted, a new VNet and subnet are created automatically.' },
      },
      required: ['vmName', 'location', 'adminUsername', 'adminPassword'],
    },
  },
  {
    name: 'delete_vm',
    description:
      'Delete an Azure Virtual Machine. ' +
      'Only the VM itself is removed; associated NIC, OS disk, and VNet are NOT deleted automatically.',
    inputSchema: {
      type: 'object',
      properties: {
        resourceGroup: { type: 'string', description: 'Name of the Azure Resource Group' },
        vmName:        { type: 'string', description: 'Name of the Virtual Machine to delete' },
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
        case 'list_vm_disks':
          result = await listVmDisks(args.resourceGroup, args.vmName, armToken);
          break;
        case 'change_disk_sku':
          result = await changeDiskSku(args.resourceGroup, args.diskName, args.newSku, armToken);
          break;
        case 'create_vm':
          result = await createVm(
            args.resourceGroup ?? process.env.AZURE_RESOURCE_GROUP,
            args.vmName, args.location,
            args.vmSize ?? 'Standard_B2s', args.adminUsername, args.adminPassword,
            args.image, args.subnetId, armToken,
          );
          break;
        case 'delete_vm':
          result = await deleteVm(args.resourceGroup, args.vmName, armToken);
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

  // Sessions for legacy SSE transport (Copilot Studio)
  const sseSessions = new Map();
  // Sessions for Streamable HTTP transport (newer MCP clients)
  const streamSessions = new Map();

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  // GET /sse — Legacy SSE transport required by Copilot Studio.
  // Opens a persistent SSE stream; the client posts messages to POST /messages.
  app.get('/sse', requireApiKey, async (req, res) => {
    const transport = new SSEServerTransport('/messages', res);
    sseSessions.set(transport.sessionId, transport);
    transport.onclose = () => sseSessions.delete(transport.sessionId);
    await createServer().connect(transport);
  });

  // POST /messages — Receives JSON-RPC messages for legacy SSE sessions.
  app.post('/messages', requireApiKey, async (req, res) => {
    const sessionId = req.query.sessionId;
    const transport = sseSessions.get(sessionId);
    if (!transport) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    await transport.handlePostMessage(req, res, req.body);
  });

  // POST /sse — Streamable HTTP transport for newer MCP clients.
  // Ensure the Accept header satisfies the Streamable HTTP transport requirement.
  app.post('/sse', requireApiKey, async (req, res) => {
    req.headers['accept'] = 'application/json, text/event-stream';
    const sessionId = req.headers['mcp-session-id'];
    let transport;

    if (sessionId && streamSessions.has(sessionId)) {
      transport = streamSessions.get(sessionId);
    } else {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => streamSessions.set(id, transport),
      });
      transport.onclose = () => {
        if (transport.sessionId) streamSessions.delete(transport.sessionId);
      };
      await createServer().connect(transport);
    }

    await transport.handleRequest(req, res, req.body);
  });

  // GET /mcp — SSE event stream for Streamable HTTP server-initiated messages.
  app.get('/mcp', requireApiKey, async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    const transport = streamSessions.get(sessionId);
    if (!transport) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    await transport.handleRequest(req, res);
  });

  // DELETE /sse — Streamable HTTP session termination.
  app.delete('/sse', requireApiKey, async (req, res) => {
    const sessionId = req.headers['mcp-session-id'];
    if (sessionId && streamSessions.has(sessionId)) {
      const transport = streamSessions.get(sessionId);
      await transport.close();
      streamSessions.delete(sessionId);
    }
    res.status(200).json({ message: 'Session terminated' });
  });

  app.listen(PORT, () => {
    console.log(`MCP server listening on port ${PORT}`);
    console.log(`  MCP endpoint : http://localhost:${PORT}/sse`);
    console.log(`  Health check : http://localhost:${PORT}/health`);
  });
}
