import axios from 'axios';
import { DefaultAzureCredential } from '@azure/identity';
import 'dotenv/config';

const BASE_URL = 'https://management.azure.com';
const VM_API_VERSION   = '2024-03-01';
const DISK_API_VERSION = '2024-03-02';

const credential = new DefaultAzureCredential();
let tokenCache = { token: null, expiresAt: 0 };

// Returns a cached ARM bearer token, refreshing it 60 s before expiry.
// Uses managed identity when running in ACI, or SP env vars locally.
export async function getToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }
  const { token, expiresOnTimestamp } = await credential.getToken(
    'https://management.azure.com/.default'
  );
  tokenCache = { token, expiresAt: expiresOnTimestamp - 60_000 };
  return token;
}

function vmBaseUrl(resourceGroup, vmName) {
  const sub = process.env.AZURE_SUBSCRIPTION_ID;
  return (
    `${BASE_URL}/subscriptions/${sub}` +
    `/resourceGroups/${resourceGroup}` +
    `/providers/Microsoft.Compute/virtualMachines/${vmName}`
  );
}

// armToken: delegated user token from OBO flow (production)
//           falls back to service principal token in local dev

export async function getVmState(resourceGroup, vmName, armToken) {
  const token = armToken ?? await getToken();
  const url = `${vmBaseUrl(resourceGroup, vmName)}/instanceView?api-version=${VM_API_VERSION}`;

  const { data } = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const powerStatus = data.statuses?.find((s) => s.code.startsWith('PowerState/'));

  return {
    vmName,
    resourceGroup,
    powerState: powerStatus?.displayStatus ?? 'Unknown',
    statuses: data.statuses ?? [],
  };
}

export async function listVms(resourceGroup, armToken) {
  const token = armToken ?? await getToken();
  const sub = process.env.AZURE_SUBSCRIPTION_ID;
  const url =
    `${BASE_URL}/subscriptions/${sub}` +
    `/resourceGroups/${resourceGroup}` +
    `/providers/Microsoft.Compute/virtualMachines?api-version=${VM_API_VERSION}`;

  const { data } = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  return (data.value ?? []).map((vm) => ({
    name: vm.name,
    location: vm.location,
    vmSize: vm.properties?.hardwareProfile?.vmSize,
    provisioningState: vm.properties?.provisioningState,
  }));
}

async function postVmAction(resourceGroup, vmName, action, armToken) {
  const token = armToken ?? await getToken();
  const url = `${vmBaseUrl(resourceGroup, vmName)}/${action}?api-version=${VM_API_VERSION}`;

  const { status, headers } = await axios.post(url, null, {
    headers: { Authorization: `Bearer ${token}` },
    validateStatus: (s) => s === 200 || s === 202,
  });

  return {
    vmName,
    resourceGroup,
    action,
    accepted: status === 202,
    operationUrl: headers['azure-asyncoperation'] ?? headers['location'] ?? null,
  };
}

export const startVm   = (rg, vm, token) => postVmAction(rg, vm, 'start', token);
export const stopVm    = (rg, vm, token) => postVmAction(rg, vm, 'deallocate', token);
export const restartVm = (rg, vm, token) => postVmAction(rg, vm, 'restart', token);

export async function listAllVms(armToken) {
  const token = armToken ?? await getToken();
  const sub = process.env.AZURE_SUBSCRIPTION_ID;
  const url =
    `${BASE_URL}/subscriptions/${sub}` +
    `/providers/Microsoft.Compute/virtualMachines?api-version=${VM_API_VERSION}`;

  const { data } = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  return (data.value ?? []).map((vm) => ({
    name: vm.name,
    resourceGroup: vm.id.split('/')[4],
    location: vm.location,
    vmSize: vm.properties?.hardwareProfile?.vmSize,
    provisioningState: vm.properties?.provisioningState,
  }));
}

export async function listVmDisks(resourceGroup, vmName, armToken) {
  const token = armToken ?? await getToken();
  const url = `${vmBaseUrl(resourceGroup, vmName)}?api-version=${VM_API_VERSION}`;

  const { data } = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const osDisk = data.properties?.storageProfile?.osDisk;
  const dataDisks = data.properties?.storageProfile?.dataDisks ?? [];

  return {
    vmName,
    resourceGroup,
    osDisk: osDisk
      ? {
          name: osDisk.name,
          diskId: osDisk.managedDisk?.id,
          sku: osDisk.managedDisk?.storageAccountType ?? 'unknown',
        }
      : null,
    dataDisks: dataDisks.map((d) => ({
      name: d.name,
      lun: d.lun,
      diskId: d.managedDisk?.id,
      sku: d.managedDisk?.storageAccountType ?? 'unknown',
    })),
  };
}

// Resolves a disk name to its resource group (which may differ from the VM's resource group).
async function resolveDiskResourceGroup(diskName, preferredResourceGroup, token) {
  const sub = process.env.AZURE_SUBSCRIPTION_ID;

  // Try the VM's resource group first (most common case).
  const directUrl =
    `${BASE_URL}/subscriptions/${sub}` +
    `/resourceGroups/${preferredResourceGroup}` +
    `/providers/Microsoft.Compute/disks/${diskName}?api-version=${DISK_API_VERSION}`;

  try {
    const { data } = await axios.get(directUrl, {
      headers: { Authorization: `Bearer ${token}` },
      validateStatus: (s) => s === 200 || s === 404,
    });
    if (data?.id) return preferredResourceGroup;
  } catch {
    // fall through to subscription-wide search
  }

  // Fall back to subscription-wide lookup.
  const listUrl =
    `${BASE_URL}/subscriptions/${sub}` +
    `/providers/Microsoft.Compute/disks?api-version=${DISK_API_VERSION}`;

  const { data } = await axios.get(listUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const match = (data.value ?? []).find((d) => d.name === diskName);
  if (!match) throw new Error(`Disk "${diskName}" not found in subscription`);

  return match.id.split('/')[4];
}

// Maps human-friendly shorthand tier names to ARM SKU identifiers.
// S* = Standard HDD, E* = Standard SSD, P* = Premium SSD, U* = Ultra.
function normalizeDiskSku(sku) {
  const upper = sku.trim().toUpperCase();
  if (/^S\d+$/.test(upper)) return 'Standard_LRS';
  if (/^E\d+$/.test(upper)) return 'StandardSSD_LRS';
  if (/^P\d+$/.test(upper)) return 'Premium_LRS';
  if (/^U\d*$/.test(upper)) return 'UltraSSD_LRS';
  return sku;
}

export async function changeDiskSku(resourceGroup, diskName, newSku, armToken) {
  newSku = normalizeDiskSku(newSku);
  const token = armToken ?? await getToken();
  const sub = process.env.AZURE_SUBSCRIPTION_ID;

  const diskResourceGroup = await resolveDiskResourceGroup(diskName, resourceGroup, token);

  const url =
    `${BASE_URL}/subscriptions/${sub}` +
    `/resourceGroups/${diskResourceGroup}` +
    `/providers/Microsoft.Compute/disks/${diskName}?api-version=${DISK_API_VERSION}`;

  const { data: current } = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const previousSku = current.sku?.name ?? 'unknown';

  const { status, headers } = await axios.patch(
    url,
    { sku: { name: newSku } },
    {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      validateStatus: (s) => s === 200 || s === 202,
    }
  );

  return {
    diskName,
    resourceGroup: diskResourceGroup,
    previousSku,
    newSku,
    accepted: status === 202,
    operationUrl: headers['azure-asyncoperation'] ?? headers['location'] ?? null,
  };
}
