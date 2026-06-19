import axios from 'axios';
import { DefaultAzureCredential } from '@azure/identity';
import 'dotenv/config';

const BASE_URL = 'https://management.azure.com';
const COMPUTE_API_VERSION = '2024-03-01';

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

export async function listVms(resourceGroup, armToken) {
  const token = armToken ?? await getToken();
  const sub = process.env.AZURE_SUBSCRIPTION_ID;
  const url =
    `${BASE_URL}/subscriptions/${sub}` +
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

async function postVmAction(resourceGroup, vmName, action, armToken) {
  const token = armToken ?? await getToken();
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
    `/providers/Microsoft.Compute/virtualMachines?api-version=${COMPUTE_API_VERSION}`;

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
