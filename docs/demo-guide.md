# Demo Guide: Deploying the Azure VM Tool MCP Server

This guide walks through the deployment procedure using Azure Cloud Shell and the Azure Developer CLI (AZD).

---

## Prerequisites

- Access to Microsoft Azure
- Azure Cloud Shell (PowerShell or Bash)
- Permissions to create resources in an Azure subscription

---

## Step 1 – Clone the Repository

Run the following command in Azure Cloud Shell to download the project:

```bash
git clone https://github.com/koenraadhaedens/azd-azure-vmtool-mcpserver
```

---

## Step 2 – Navigate to the Project Folder

Change into the newly created directory:

```bash
cd ./azd-azure-vmtool-mcpserver/
```

---

## Step 3 – Start the Deployment

Initiate the deployment using AZD:

```bash
azd up
```

> The screenshot below shows all three commands (① clone, ② cd, ③ azd up) entered in Cloud Shell.

![Cloud Shell – Clone, navigate and run azd up](../media/Screenshot-cloudshell1.jpg)

---

## Step 4 – Provide Deployment Inputs

During execution, AZD prompts for several values:

- Environment name (must be unique)
- Azure subscription selection
- `mcpApiKey` (secured parameter)
- Resource group creation
- Azure region (for example: North Europe)

Example values visible in the screenshot:

- Environment: `vmmcpserver1`
- Resource group: `rg-vmmcpserver1`
- Region: `northeurope`

![Cloud Shell – Deployment Prompts](../media/Screenshot-cloudshell2.jpg)

---

## Step 5 – Deployment in Progress

AZD will:

- Download dependencies (for example Bicep)
- Provision Azure resources
- Deploy the MCP server to Azure Container Apps

No action is required during this phase.

---

## Step 6 – Deployment Complete

After successful deployment, the output confirms the MCP server is ready and displays the endpoint URL.

![Cloud Shell – Deployment Complete with MCP Server URL](../media/Screenshot-cloudshell3.jpg)

---

## Step 7 – Configure Your Agent

Use the generated details:

- **Endpoint URL**: Provided in the final output
- **Path**: `/sse`
- **Header**:
  - Key: `x-api-key`
  - Value: your configured `mcpApiKey`

---

## Summary

The deployment consists of three main commands:

```bash
git clone https://github.com/koenraadhaedens/azd-azure-vmtool-mcpserver
cd azd-azure-vmtool-mcpserver
azd up
```

Follow the prompts, wait for provisioning, and then use the generated MCP endpoint.

---

## Screenshot Index

- Step 1–3: `Screenshot-cloudshell1.jpg`
- Step 4: `Screenshot-cloudshell2.jpg`
- Step 6: `Screenshot-cloudshell3.jpg`

