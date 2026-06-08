import axios from 'axios';
import 'dotenv/config';

const {
  AZURE_TENANT_ID,
  AZURE_CLIENT_ID,
  AZURE_CLIENT_SECRET,
  AZURE_SUBSCRIPTION_ID,
} = process.env;

const MANAGEMENT_SCOPE = 'https://management.azure.com/.default';
const BASE_URL = 'https://management.azure.com';
const COMPUTE_API_VERSION = '2024-03-01';

// In-memory token cache — tokens are valid for ~1 hour; we refresh 60 s early
let tokenCache = { token: null, expiresAt: 0 };

export async function getToken() {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt) {
    return tokenCache.token;
  }

  const url = `https://login.microsoftonline.com/${AZURE_TENANT_ID}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: AZURE_CLIENT_ID,
    client_secret: AZURE_CLIENT_SECRET,
    scope: MANAGEMENT_SCOPE,
  });

  const { data } = await axios.post(url, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  tokenCache = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };

  return tokenCache.token;
}

function vmBaseUrl(resourceGroup, vmName) {
  return (
    `${BASE_URL}/subscriptions/${AZURE_SUBSCRIPTION_ID}` +
    `/resourceGroups/${resourceGroup}` +
    `/providers/Microsoft.Compute/virtualMachines/${vmName}`
  );
}

/**
 * Returns the current power state and full status list for a VM.
 * API: GET .../virtualMachines/{vmName}/instanceView
 */
export async function getVmState(resourceGroup, vmName) {
  const token = await getToken();
  const url = `${vmBaseUrl(resourceGroup, vmName)}/instanceView?api-version=${COMPUTE_API_VERSION}`;

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

/**
 * Lists all VMs in a resource group with basic metadata.
 * API: GET .../resourceGroups/{rg}/providers/Microsoft.Compute/virtualMachines
 */
export async function listVms(resourceGroup) {
  const token = await getToken();
  const url =
    `${BASE_URL}/subscriptions/${AZURE_SUBSCRIPTION_ID}` +
    `/resourceGroups/${resourceGroup}` +
    `/providers/Microsoft.Compute/virtualMachines?api-version=${COMPUTE_API_VERSION}`;

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

/**
 * Sends a control action (start | deallocate | restart) to the Compute API.
 * All three actions are asynchronous; the response includes an operation URL.
 */
async function postVmAction(resourceGroup, vmName, action) {
  const token = await getToken();
  const url = `${vmBaseUrl(resourceGroup, vmName)}/${action}?api-version=${COMPUTE_API_VERSION}`;

  const { status, headers } = await axios.post(url, null, {
    headers: { Authorization: `Bearer ${token}` },
    validateStatus: (s) => s === 200 || s === 202,
  });

  return {
    vmName,
    resourceGroup,
    action,
    accepted: status === 202,
    operationUrl:
      headers['azure-asyncoperation'] ?? headers['location'] ?? null,
  };
}

// start   → powers on a deallocated or stopped VM
// deallocate → stops the VM and releases compute resources (no billing)
// restart → reboots a running VM

export const startVm   = (rg, vm) => postVmAction(rg, vm, 'start');
export const stopVm    = (rg, vm) => postVmAction(rg, vm, 'deallocate');
export const restartVm = (rg, vm) => postVmAction(rg, vm, 'restart');
