# Azure VM MCP Server — Demo Guide

This guide covers three topics:

1. [Deploy with `azd up`](#1-deploy-with-azd-up)
2. [Connect to Copilot Studio](#2-connect-to-copilot-studio)
3. [Build and host your own container image](#3-build-and-host-your-own-container-image)

---

## 1. Deploy with `azd up`

### Prerequisites

| Tool | Minimum version | Install |
| ---- | --------------- | ------- |
| Azure Developer CLI (`azd`) | 1.9+ | `winget install Microsoft.Azd` |
| Azure CLI (`az`) | any recent | `winget install Microsoft.AzureCLI` |
| Git | any | `winget install Git.Git` |

Your Azure account needs **Owner** or **User Access Administrator** on the target subscription
because the deployment creates a custom RBAC role at subscription scope.

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/koenraadhaedens/azd-azure-vmtool-mcpserver
cd azd-azure-vmtool-mcpserver

# 2. Log in
azd auth login

# 3. Deploy — azd will prompt for environment name, subscription, region, and API key
azd up
```

#### What `azd up` prompts for

| Prompt | Description | Default |
| ------ | ----------- | ------- |
| Environment name | Logical name for this deployment (e.g. `prod`, `test`) | — |
| Subscription | Azure subscription to deploy into | — |
| Location | Azure region | `West Europe` |
| `mcpApiKey` | Secret key clients must send in `x-api-key` header | — |

> `resourcePrefix`, `containerImage`, and `azureSubscriptionId` all have sensible defaults
> and do not require input unless you want to override them.

#### What gets deployed

- **Azure Container Instance** running the MCP server on port 80
- **System-assigned managed identity** on the ACI
- **Custom RBAC role** (`<prefix>-mcp-vm-operator`) assigned to that identity at subscription scope,
  granting only the minimum permissions needed: read, start, stop, restart VMs

#### Outputs

After a successful deployment `azd up` prints:

```
Outputs:

fqdn       = mcpvm-mcp-<hash>.westeurope.azurecontainer.io
mcpSseUrl  = http://mcpvm-mcp-<hash>.westeurope.azurecontainer.io/sse
healthUrl  = http://mcpvm-mcp-<hash>.westeurope.azurecontainer.io/health
```

Verify the server is running:

```bash
curl http://<fqdn>/health
# → {"status":"ok"}
```

#### Deploying from Azure Cloud Shell

Cloud Shell has `azd`, `az`, and `git` pre-installed and you are already authenticated.
No additional login steps are needed.

```bash
git clone https://github.com/koenraadhaedens/azd-azure-vmtool-mcpserver
cd azd-azure-vmtool-mcpserver
azd up
```

#### Deploying to multiple subscriptions

Run `azd up` once per subscription, using a different environment name each time.
Each deployment gets its own ACI instance scoped to that subscription.

```bash
azd env new prod-sub1
azd up --environment prod-sub1

azd env new prod-sub2
azd up --environment prod-sub2
```

#### Teardown

```bash
azd down
```

---

## 2. Connect to Copilot Studio

### What you need

- The `mcpSseUrl` output from the deployment (e.g. `http://<fqdn>/sse`)
- The `MCP_API_KEY` value you entered during `azd up`

### Steps

1. Open [Copilot Studio](https://copilotstudio.microsoft.com) and open or create an agent.
2. Go to **Settings → AI capabilities** and enable **Generative AI** if not already on.
3. In the left menu select **Tools** (or **Actions** depending on your version) → **Add a tool**.
4. Choose **Model Context Protocol (MCP)**.
5. Fill in the connection details:

   | Field | Value |
   | ----- | ----- |
   | Server URL | `http://<fqdn>/sse` |
   | Authentication | API Key |
   | Header name | `x-api-key` |
   | API Key value | the value you set for `MCP_API_KEY` |

6. Click **Connect** — Copilot Studio will discover all 8 tools automatically.
7. Select the tools you want to enable and click **Save**.

### Available tools

| Tool | Description |
| ---- | ----------- |
| `get_vm_state` | Get the current power state of a VM |
| `list_vms` | List all VMs in a resource group |
| `list_all_vms` | List all VMs across the subscription |
| `start_vm` | Start a deallocated VM |
| `stop_vm` | Stop (deallocate) a VM |
| `restart_vm` | Restart a running VM |
| `list_vm_disks` | List disks attached to a VM |
| `change_disk_sku` | Change the performance tier of a managed disk |

### Example agent prompt

> "List all virtual machines in my subscription and show me which ones are currently stopped."

> "Start the VM named `web-server-01` in resource group `rg-production`."

---

## 3. Build and host your own container image

Follow this section if you want to customise the MCP server or use your own Azure Container Registry
instead of the default public image.

### Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed and running
- An Azure Container Registry (ACR) — create one with:

  ```bash
  az acr create --resource-group <your-rg> --name <your-acr-name> --sku Basic
  ```

### Build the image

```bash
cd mcp-server

docker build -t azure-vm-mcp-server:latest .
```

The `Dockerfile` uses `node:20-alpine` and exposes port 80.

### Push to Azure Container Registry

```bash
# Log in to your ACR
az acr login --name <your-acr-name>

# Tag the image
docker tag azure-vm-mcp-server:latest <your-acr-name>.azurecr.io/azure-vm-mcp-server:latest

# Push
docker push <your-acr-name>.azurecr.io/azure-vm-mcp-server:latest
```

### Deploy using your own image

Before running `azd up`, set the `CONTAINER_IMAGE` environment variable in your azd environment:

```bash
azd env set CONTAINER_IMAGE <your-acr-name>.azurecr.io/azure-vm-mcp-server:latest
azd up
```

> If your ACR is private, the ACI needs pull access. Grant the ACI's managed identity
> the **AcrPull** role on the registry:
>
> ```bash
> # Get the ACI principal ID after first deployment
> PRINCIPAL_ID=$(az container show \
>   --resource-group rg-<env-name> \
>   --name mcpvm-mcp \
>   --query identity.principalId -o tsv)
>
> az role assignment create \
>   --assignee $PRINCIPAL_ID \
>   --role AcrPull \
>   --scope $(az acr show --name <your-acr-name> --query id -o tsv)
> ```
>
> Then re-run `azd provision` to restart the container with the updated identity.

### Build with GitHub Actions (optional)

Add a workflow to automatically build and push on every push to `main`:

```yaml
name: Build and push MCP server image

on:
  push:
    branches: [main]
    paths: [mcp-server/**]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Log in to ACR
        uses: azure/docker-login@v1
        with:
          login-server: ${{ secrets.ACR_LOGIN_SERVER }}
          username: ${{ secrets.ACR_USERNAME }}
          password: ${{ secrets.ACR_PASSWORD }}

      - name: Build and push
        run: |
          docker build -t ${{ secrets.ACR_LOGIN_SERVER }}/azure-vm-mcp-server:latest ./mcp-server
          docker push ${{ secrets.ACR_LOGIN_SERVER }}/azure-vm-mcp-server:latest
```
