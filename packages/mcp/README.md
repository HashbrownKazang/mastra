# @mastra/mcp

Model Context Protocol (MCP) client implementation for Mastra, providing seamless integration with MCP-compatible AI models and tools.

## Installation

```bash
npm install @mastra/mcp@latest
```

## Overview

The `@mastra/mcp` package provides a client implementation for the Model Context Protocol (MCP), enabling Mastra to communicate with MCP-compatible AI models and tools. It wraps the official `@modelcontextprotocol/sdk` and provides Mastra-specific functionality.

The client automatically detects the transport type based on your server configuration:

- If you provide a `command`, it uses the Stdio transport.
- If you provide a `url`, it first attempts to use the Streamable HTTP transport (protocol version 2025-03-26) and falls back to the legacy SSE transport (protocol version 2024-11-05) if the initial connection fails.

## Usage

```typescript
import { MastraMCPClient } from '@mastra/mcp';

// Create a client with a Stdio server
const stdioClient = new MastraMCPClient({
  name: 'my-stdio-client',
  version: '1.0.0', // optional
  server: {
    command: 'your-mcp-server-command',
    args: ['--your', 'args'],
    env: { API_KEY: 'your-api-key' }, // optional environment variables
  },
  capabilities: {}, // optional ClientCapabilities
  timeout: 60000, // optional timeout for tool calls in milliseconds
});

// Create a client with an HTTP server (tries Streamable HTTP, falls back to SSE)
const httpClient = new MastraMCPClient({
  name: 'my-http-client',
  version: '1.0.0',
  server: {
    url: new URL('https://your-mcp-server.com/mcp'), // Use the base URL for Streamable HTTP
    requestInit: {
      // Optional fetch request configuration
      headers: { Authorization: 'Bearer your-token' },
    },
    // eventSourceInit is only needed for custom headers with the legacy SSE fallback
    eventSourceInit: {
      /* ... */
    },
  },
  timeout: 60000, // optional timeout for tool calls in milliseconds
});

// Connect to the MCP server (using one of the clients above)
await httpClient.connect();

// List available resources
const resources = await httpClient.resources();

// Get available tools
const tools = await httpClient.tools();

// Disconnect when done
await httpClient.disconnect();
```

## Managing Multiple MCP Servers

For applications that need to interact with multiple MCP servers, the `MCPConfiguration` class provides a convenient way to manage multiple server connections and their tools. It also uses the automatic transport detection based on the `server` configuration:

```typescript
import { MCPConfiguration } from '@mastra/mcp';

const mcp = new MCPConfiguration({
  servers: {
    // Stdio-based server
    stockPrice: {
      command: 'npx',
      args: ['tsx', 'stock-price.ts'],
      env: {
        API_KEY: 'your-api-key',
      },
    },
    // HTTP-based server (tries Streamable HTTP, falls back to SSE)
    weather: {
      url: new URL('http://localhost:8080/mcp'), // Use the base URL for Streamable HTTP
      requestInit: {
        // Optional fetch request configuration
        headers: { 'X-Api-Key': 'weather-key' },
      },
    },
  },
});

// Get all tools from all configured servers namespaced with the server name
const tools = await mcp.getTools();

// Get tools grouped into a toolset object per-server
const toolsets = await mcp.getToolsets();
```

## Logging

The MCP client provides per-server logging capabilities, allowing you to monitor interactions with each MCP server separately:

```typescript
import { MCPConfiguration, LogMessage, LoggingLevel } from '@mastra/mcp';

// Define a custom log handler
const weatherLogger = (logMessage: LogMessage) => {
  console.log(`[${logMessage.level}] ${logMessage.serverName}: ${logMessage.message}`);

  // Log data contains valuable information
  console.log('Details:', logMessage.details);
  console.log('Timestamp:', logMessage.timestamp);
};

// Initialize MCP configuration with server-specific loggers
const mcp = new MCPConfiguration({
  servers: {
    weatherService: {
      command: 'npx',
      args: ['tsx', 'weather-mcp.ts'],
      // Attach the logger to this specific server
      logger: weatherLogger, // Use 'logger' key
    },

    stockPriceService: {
      command: 'npx',
      args: ['tsx', 'stock-mcp.ts'],
      // Different logger for this service
      logger: logMessage => {
        // Use 'logger' key
        // Just log errors and critical events for this service
        if (['error', 'critical', 'alert', 'emergency'].includes(logMessage.level)) {
          console.error(`Stock service ${logMessage.level}: ${logMessage.message}`);
        }
      },
    },
  },
});
```

### Log Message Structure

Each log message contains the following information:

```typescript
interface LogMessage {
  level: LoggingLevel; // MCP SDK standard log levels
  message: string;
  timestamp: Date;
  serverName: string;
  details?: Record<string, any>;
}
```

The `LoggingLevel` type is directly imported from the MCP SDK, ensuring compatibility with all standard MCP log levels: `'debug' | 'info' | 'notice' | 'warning' | 'error' | 'critical' | 'alert' | 'emergency'`.

### Creating Reusable Loggers

You can create reusable logger factories for common patterns:

```typescript
import fs from 'node:fs';

// File logger factory with color coded output for different severity levels
const createFileLogger = (filePath: string) => {
  return (logMessage: LogMessage) => {
    // Format the message based on level
    const prefix =
      logMessage.level === 'emergency' ? '!!! EMERGENCY !!! ' : logMessage.level === 'alert' ? '! ALERT ! ' : '';

    // Write to file with timestamp, level, etc.
    fs.appendFileSync(
      filePath,
      `[${logMessage.timestamp.toISOString()}] [${logMessage.level.toUpperCase()}] ${prefix}${logMessage.message}\n`,
    );
  };
};

// Use the factory in configuration
const mcp = new MCPConfiguration({
  servers: {
    weatherService: {
      command: 'npx',
      args: ['tsx', 'weather-mcp.ts'],
      logger: createFileLogger('./logs/weather.log'), // Use 'logger' key
    },
  },
});
```

See the `examples/server-logging.ts` file for comprehensive examples of various logging strategies.

### Tools vs Toolsets

The MCPConfiguration class provides two ways to access MCP tools:

#### Tools (`getTools()`)

Use this when:

- You have a single MCP connection
- The tools are used by a single user/context (CLI tools, automation scripts, etc)
- Tool configuration (API keys, credentials) remains constant
- You want to initialize an Agent with a fixed set of tools

```typescript
import { Agent } from '@mastra/core/agent';
import { openai } from '@ai-sdk/openai';

const agent = new Agent({
  name: 'CLI Assistant',
  instructions: 'You help users with CLI tasks',
  model: openai('gpt-4'),
  tools: await mcp.getTools(), // Tools are fixed at agent creation
});
```

#### Toolsets (`getToolsets()`)

Use this when:

- You need per-request tool configuration
- Tools need different credentials per user
- Running in a multi-user environment (web app, API, etc)
- Tool configuration needs to change dynamically

```typescript
import { MCPConfiguration } from '@mastra/mcp';
import { Agent } from '@mastra/core/agent';
import { openai } from '@ai-sdk/openai';

// Configure MCP servers with user-specific settings before getting toolsets
const mcp = new MCPConfiguration({
  servers: {
    stockPrice: {
      command: 'npx',
      args: ['tsx', 'weather-mcp.ts'],
      env: {
        // These would be different per user
        API_KEY: 'user-1-api-key',
      },
    },
    weather: {
      url: new URL('http://localhost:8080/mcp'), // Use the base URL for Streamable HTTP
      requestInit: {
        headers: {
          // These would be different per user
          Authorization: 'Bearer user-1-token',
        },
      },
      // eventSourceInit is only needed for custom headers with the legacy SSE fallback
      eventSourceInit: {
        /* ... */
      },
    },
  },
});

// Get the current toolsets configured for this user
const toolsets = await mcp.getToolsets();

// Use the agent with user-specific tool configurations
const response = await agent.generate('What is the weather in London?', {
  toolsets,
});

console.log(response.text);
```

The `MCPConfiguration` class automatically:

- Manages connections to multiple MCP servers
- Namespaces tools to prevent naming conflicts
- Handles connection lifecycle and cleanup
- Provides both flat and grouped access to tools

## SSE Authentication and Headers (Legacy Fallback)

When the client falls back to using the legacy SSE (Server-Sent Events) transport and you need to include authentication or custom headers, you need to configure headers in a specific way. The standard `requestInit` headers won't work alone because SSE connections using the browser's `EventSource` API don't support custom headers directly.

The `eventSourceInit` configuration allows you to customize the underlying fetch request used for the SSE connection, ensuring your authentication headers are properly included.

To properly include authentication headers or other custom headers in SSE connections when using the legacy fallback, you need to use both `requestInit` and `eventSourceInit`:

```typescript
const sseClient = new MastraMCPClient({
  name: 'authenticated-sse-client',
  server: {
    url: new URL('https://your-mcp-server.com/sse'), // Note the typical /sse path for legacy servers
    // requestInit alone isn't enough for SSE connections
    requestInit: {
      headers: { Authorization: 'Bearer your-token' },
    },
    // eventSourceInit is required to include headers in the SSE connection
    eventSourceInit: {
      fetch(input: Request | URL | string, init?: RequestInit) {
        const headers = new Headers(init?.headers || {});
        headers.set('Authorization', 'Bearer your-token');
        return fetch(input, {
          ...init,
          headers,
        });
      },
    },
  },
});
```

This configuration ensures that:

1. The authentication headers are properly included in the SSE connection request
2. The connection can be established with the required credentials
3. Subsequent messages can be received through the authenticated connection

```typescript
const sseClient = new MastraMCPClient({
  name: 'authenticated-sse-client',
  server: {
    url: new URL('https://your-mcp-server.com/sse'), // Note the typical /sse path for legacy servers
    // requestInit alone isn't enough for SSE connections
    requestInit: {
      headers: { Authorization: 'Bearer your-token' },
    },
    // eventSourceInit is required to include headers in the SSE connection
    eventSourceInit: {
      fetch(input: Request | URL | string, init?: RequestInit) {
        const headers = new Headers(init?.headers || {});
        headers.set('Authorization', 'Bearer your-token');
        return fetch(input, {
          ...init,
          headers,
        });
      },
    },
  },
});
```

## Configuration (`MastraMCPServerDefinition`)

The `server` parameter for both `MastraMCPClient` and `MCPConfiguration` uses the `MastraMCPServerDefinition` type. The client automatically detects the transport type based on the provided parameters:

- If `command` is provided, it uses the Stdio transport.
- If `url` is provided, it first attempts to use the Streamable HTTP transport and falls back to the legacy SSE transport if the initial connection fails.

Here are the available options within `MastraMCPServerDefinition`:

- **`command`**: (Optional, string) For Stdio servers: The command to execute.
- **`args`**: (Optional, string[]) For Stdio servers: Arguments to pass to the command.
- **`env`**: (Optional, Record<string, string>) For Stdio servers: Environment variables to set for the command.
- **`url`**: (Optional, URL) For HTTP servers (Streamable HTTP or SSE): The URL of the server.
- **`requestInit`**: (Optional, RequestInit) For HTTP servers: Request configuration for the fetch API. Used for the initial Streamable HTTP connection attempt and subsequent POST requests. Also used for the initial SSE connection attempt.
- **`eventSourceInit`**: (Optional, EventSourceInit) **Only** for the legacy SSE fallback: Custom fetch configuration for SSE connections. Required when using custom headers with SSE.
- **`logger`**: (Optional, LogHandler) Optional additional handler for logging.
- **`timeout`**: (Optional, number) Server-specific timeout in milliseconds, overriding the global client/configuration timeout.
- **`capabilities`**: (Optional, ClientCapabilities) Server-specific capabilities configuration.
- **`enableServerLogs`**: (Optional, boolean, default: `true`) Whether to enable logging for this server.

## Features

- Standard MCP client implementation
- Automatic tool conversion to Mastra format
- Resource discovery and management
- Multiple transport layers with automatic detection:
  - Stdio-based for local servers (`command`)
  - HTTP-based for remote servers (`url`): Tries Streamable HTTP first, falls back to legacy SSE.
- Per-server logging capability using all standard MCP log levels
- Automatic error handling and logging
- Tool execution with context

## Methods

### `connect()`

Establishes connection with the MCP server.

### `disconnect()`

Closes the connection with the MCP server.

### `resources()`

Lists available resources from the MCP server.

### `tools()`

Retrieves and converts MCP tools to Mastra-compatible format.

## Tool Conversion

The package automatically converts MCP tools to Mastra's format:

```typescript
const tools = await client.tools();
// Returns: { [toolName: string]: MastraTool }

// Each tool includes:
// - Converted JSON schema
// - Mastra-compatible execution wrapper
// - Error handling
// - Automatic context passing
```

## Error Handling

The client includes comprehensive error handling:

- Connection errors
- Tool execution errors
- Resource listing errors
- Schema conversion errors

## Related Links

- [Model Context Protocol Specification](https://modelcontextprotocol.io/specification)
- [@modelcontextprotocol/sdk Documentation](https://github.com/modelcontextprotocol/typescript-sdk)
- [Mastra Docs: Using MCP With Mastra](/docs/agents/mcp-guide)
- [Mastra Docs: MCPConfiguration Reference](/reference/tools/mcp-configuration)
- [Mastra Docs: MastraMCPClient Reference](/reference/tools/client)
