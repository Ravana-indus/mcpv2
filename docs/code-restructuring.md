# Code Restructuring Plan

This document outlines a plan for restructuring the ERPNext MCP server codebase to improve maintainability, testability, and extensibility.

## Current Structure

Currently, the entire implementation is in a single file (`src/index.ts`), which contains:

- ERPNext API client
- MCP server setup
- Resource handlers
- Tool handlers
- Error handling
- Authentication logic

This monolithic approach makes the code difficult to maintain, test, and extend.

## Proposed Structure

### Directory Structure

```
src/
├── client/
│   └── erpnext-client.ts          # ERPNext API client
├── handlers/
│   ├── resource-handlers.ts       # Resource request handlers
│   └── tool-handlers.ts           # Tool request handlers
├── models/
│   ├── doctype.ts                 # DocType interfaces
│   └── errors.ts                  # Error types
├── utils/
│   ├── cache.ts                   # Caching utilities
│   ├── config.ts                  # Configuration management
│   ├── error-handler.ts           # Error handling utilities
│   └── logger.ts                  # Logging utilities
├── constants/
│   └── error-codes.ts             # Error code definitions
├── middleware/
│   ├── auth.ts                    # Authentication middleware
│   └── rate-limiter.ts            # Rate limiting middleware
└── index.ts                       # Server bootstrap
```

### Key Components

#### 1. ERPNext Client (`src/client/erpnext-client.ts`)

Extract the ERPNext API client into a dedicated module:

```typescript
// src/client/erpnext-client.ts
import axios, { AxiosInstance } from "axios";
import { Logger } from "../utils/logger";
import { Config } from "../utils/config";
import { ERPNextError } from "../models/errors";

export class ERPNextClient {
  private baseUrl: string;
  private axiosInstance: AxiosInstance;
  private authenticated: boolean = false;
  private logger: Logger;

  constructor(config: Config, logger: Logger) {
    this.logger = logger;
    this.baseUrl = config.getERPNextUrl();
    
    // Initialize axios instance
    this.axiosInstance = axios.create({
      baseURL: this.baseUrl,
      withCredentials: true,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    });
    
    // Configure authentication if credentials provided
    const apiKey = config.getERPNextApiKey();
    const apiSecret = config.getERPNextApiSecret();
    
    if (apiKey && apiSecret) {
      this.axiosInstance.defaults.headers.common['Authorization'] = 
        `token ${apiKey}:${apiSecret}`;
      this.authenticated = true;
      this.logger.info("Initialized with API key authentication");
    }
  }

  // Methods for API operations...
}
```

#### 2. Resource Handlers (`src/handlers/resource-handlers.ts`)

Move the resource-related request handlers to a dedicated module:

```typescript
// src/handlers/resource-handlers.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  McpError,
  ErrorCode
} from "@modelcontextprotocol/sdk/types.js";
import { ERPNextClient } from "../client/erpnext-client";
import { Logger } from "../utils/logger";
import { Cache } from "../utils/cache";

export function registerResourceHandlers(
  server: Server, 
  erpnext: ERPNextClient,
  cache: Cache,
  logger: Logger
) {
  // Handler for listing resources
  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    logger.debug("Handling ListResourcesRequest");
    
    const resources = [
      {
        uri: "erpnext://DocTypes",
        name: "All DocTypes",
        mimeType: "application/json",
        description: "List of all available DocTypes in the ERPNext instance"
      }
    ];

    return { resources };
  });

  // Other resource handlers...
}
```

#### 3. Tool Handlers (`src/handlers/tool-handlers.ts`)

Similarly, move the tool-related request handlers:

```typescript
// src/handlers/tool-handlers.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  McpError,
  ErrorCode
} from "@modelcontextprotocol/sdk/types.js";
import { ERPNextClient } from "../client/erpnext-client";
import { Logger } from "../utils/logger";
import { handleErrors } from "../utils/error-handler";

export function registerToolHandlers(
  server: Server, 
  erpnext: ERPNextClient,
  logger: Logger
) {
  // Handler for listing tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    logger.debug("Handling ListToolsRequest");
    
    return {
      tools: [
        {
          name: "get_doctypes",
          description: "Get a list of all available DocTypes",
          inputSchema: {
            type: "object",
            properties: {}
          }
        },
        // Other tools...
      ]
    };
  });

  // Handler for tool calls with proper error handling
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    logger.debug(`Handling CallToolRequest: ${request.params.name}`);
    
    try {
      switch (request.params.name) {
        case "authenticate_erpnext":
          return await handleAuthenticateErpnext(request, erpnext, logger);
        // Other tool handlers...
        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    } catch (error) {
      return handleErrors(error, logger);
    }
  });
}

// Individual tool handler functions
async function handleAuthenticateErpnext(request, erpnext, logger) {
  // Implementation...
}
```

#### 4. Cache Utility (`src/utils/cache.ts`)

Implement the previously defined but unused cache:

```typescript
// src/utils/cache.ts
export class Cache {
  private cache: Map<string, CacheEntry>;
  private defaultTTLMs: number;
  
  constructor(defaultTTLMs: number = 5 * 60 * 1000) { // 5 minutes default
    this.cache = new Map();
    this.defaultTTLMs = defaultTTLMs;
  }
  
  set(key: string, value: any, ttlMs?: number): void {
    const expiryTime = Date.now() + (ttlMs || this.defaultTTLMs);
    this.cache.set(key, { value, expiryTime });
  }
  
  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    
    if (!entry) {
      return undefined;
    }
    
    if (Date.now() > entry.expiryTime) {
      this.cache.delete(key);
      return undefined;
    }
    
    return entry.value as T;
  }
  
  invalidate(keyPrefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(keyPrefix)) {
        this.cache.delete(key);
      }
    }
  }
}

interface CacheEntry {
  value: any;
  expiryTime: number;
}
```

#### 5. Configuration Module (`src/utils/config.ts`)

Create a dedicated configuration module:

```typescript
// src/utils/config.ts
export class Config {
  private erpnextUrl: string;
  private apiKey?: string;
  private apiSecret?: string;
  
  constructor() {
    this.erpnextUrl = this.getRequiredEnv("ERPNEXT_URL");
    // Remove trailing slash if present
    this.erpnextUrl = this.erpnextUrl.replace(/\/$/, '');
    
    this.apiKey = process.env.ERPNEXT_API_KEY;
    this.apiSecret = process.env.ERPNEXT_API_SECRET;
    
    this.validate();
  }
  
  private getRequiredEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
      throw new Error(`${name} environment variable is required`);
    }
    return value;
  }
  
  private validate() {
    if (!this.erpnextUrl.startsWith("http")) {
      throw new Error("ERPNEXT_URL must include protocol (http:// or https://)");
    }
    
    // If one of API key/secret is provided, both must be provided
    if ((this.apiKey && !this.apiSecret) || (!this.apiKey && this.apiSecret)) {
      throw new Error("Both ERPNEXT_API_KEY and ERPNEXT_API_SECRET must be provided if using API key authentication");
    }
  }
  
  getERPNextUrl(): string {
    return this.erpnextUrl;
  }
  
  getERPNextApiKey(): string | undefined {
    return this.apiKey;
  }
  
  getERPNextApiSecret(): string | undefined {
    return this.apiSecret;
  }
}
```

#### 6. Logger Module (`src/utils/logger.ts`)

Implement a proper logging utility:

```typescript
// src/utils/logger.ts
export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

export class Logger {
  private level: LogLevel;
  
  constructor(level: LogLevel = LogLevel.INFO) {
    this.level = level;
  }
  
  setLevel(level: LogLevel) {
    this.level = level;
  }
  
  error(message: string, ...meta: any[]) {
    if (this.level >= LogLevel.ERROR) {
      console.error(`[ERROR] ${message}`, ...meta);
    }
  }
  
  warn(message: string, ...meta: any[]) {
    if (this.level >= LogLevel.WARN) {
      console.warn(`[WARN] ${message}`, ...meta);
    }
  }
  
  info(message: string, ...meta: any[]) {
    if (this.level >= LogLevel.INFO) {
      console.info(`[INFO] ${message}`, ...meta);
    }
  }
  
  debug(message: string, ...meta: any[]) {
    if (this.level >= LogLevel.DEBUG) {
      console.debug(`[DEBUG] ${message}`, ...meta);
    }
  }
}
```

#### 7. Main File (`src/index.ts`)

The main file becomes much simpler:

```typescript
#!/usr/bin/env node

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Config } from "./utils/config";
import { Logger, LogLevel } from "./utils/logger";
import { Cache } from "./utils/cache";
import { ERPNextClient } from "./client/erpnext-client";
import { registerResourceHandlers } from "./handlers/resource-handlers";
import { registerToolHandlers } from "./handlers/tool-handlers";

async function main() {
  // Initialize components
  const logger = new Logger(
    process.env.DEBUG ? LogLevel.DEBUG : LogLevel.INFO
  );
  
  try {
    logger.info("Initializing ERPNext MCP server");
    
    const config = new Config();
    const cache = new Cache();
    const erpnext = new ERPNextClient(config, logger);
    
    // Create server
    const server = new Server(
      {
        name: "erpnext-server",
        version: "0.1.0"
      },
      {
        capabilities: {
          resources: {},
          tools: {}
        }
      }
    );
    
    // Register handlers
    registerResourceHandlers(server, erpnext, cache, logger);
    registerToolHandlers(server, erpnext, logger);
    
    // Setup error handling
    server.onerror = (error) => {
      logger.error("Server error:", error);
    };
    
    // Start server
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info('ERPNext MCP server running on stdio');
    
    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      logger.info("Shutting down...");
      await server.close();
      process.exit(0);
    });
  } catch (error) {
    logger.error("Failed to start server:", error);
    process.exit(1);
  }
}

main();
```

## Implementation Plan

1. Create the directory structure
2. Move the ERPNext client to its own module
3. Create utility modules (config, logger, cache)
4. Split out the resource and tool handlers
5. Update the main file to use the new modules
6. Add tests for each module
7. Update documentation

This restructuring will make the code more maintainable, easier to test, and facilitate future enhancements.
