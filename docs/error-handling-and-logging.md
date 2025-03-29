# Error Handling and Logging Improvements

This document outlines recommendations for improving error handling and logging in the ERPNext MCP server.

## Current Status

The current implementation has several limitations in its error handling and logging approach:

1. Basic error handling with inconsistent patterns
2. Console logging without structured format
3. No distinct log levels for different environments
4. No dedicated error mapping between ERPNext and MCP error codes
5. Limited contextual information in error messages

## Proposed Improvements

### 1. Structured Error Handling

#### Create a dedicated Error Handling Module

```typescript
// src/utils/error-handler.ts
import { McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { AxiosError } from "axios";
import { Logger } from "./logger";

export enum ERPNextErrorType {
  Authentication = "authentication",
  Permission = "permission",
  NotFound = "not_found",
  Validation = "validation",
  Server = "server",
  Network = "network",
  Unknown = "unknown"
}

export class ERPNextError extends Error {
  constructor(
    public readonly type: ERPNextErrorType,
    message: string,
    public readonly originalError?: Error
  ) {
    super(message);
    this.name = "ERPNextError";
  }
}

/**
 * Maps ERPNext errors to MCP error codes
 */
export function mapToMcpError(error: ERPNextError): McpError {
  switch (error.type) {
    case ERPNextErrorType.Authentication:
      return new McpError(ErrorCode.Unauthorized, error.message);
    case ERPNextErrorType.Permission:
      return new McpError(ErrorCode.Forbidden, error.message);
    case ERPNextErrorType.NotFound:
      return new McpError(ErrorCode.NotFound, error.message);
    case ERPNextErrorType.Validation:
      return new McpError(ErrorCode.InvalidParams, error.message);
    case ERPNextErrorType.Server:
      return new McpError(ErrorCode.InternalError, error.message);
    case ERPNextErrorType.Network:
      return new McpError(ErrorCode.InternalError, `Network error: ${error.message}`);
    default:
      return new McpError(ErrorCode.InternalError, `Unknown error: ${error.message}`);
  }
}

/**
 * Categorizes an error based on its properties and returns an ERPNextError
 */
export function categorizeError(error: any): ERPNextError {
  if (error instanceof ERPNextError) {
    return error;
  }
  
  // Handle Axios errors
  if (error?.isAxiosError) {
    const axiosError = error as AxiosError;
    const statusCode = axiosError.response?.status;
    const responseData = axiosError.response?.data as any;
    const message = responseData?.message || responseData?.error || axiosError.message;
    
    if (!statusCode) {
      return new ERPNextError(ERPNextErrorType.Network, 
        `Network error connecting to ERPNext: ${message}`, 
        error);
    }
    
    switch (statusCode) {
      case 401:
        return new ERPNextError(ERPNextErrorType.Authentication, 
          `Authentication failed: ${message}`, 
          error);
      case 403:
        return new ERPNextError(ERPNextErrorType.Permission, 
          `Permission denied: ${message}`, 
          error);
      case 404:
        return new ERPNextError(ERPNextErrorType.NotFound, 
          `Resource not found: ${message}`, 
          error);
      case 400:
        return new ERPNextError(ERPNextErrorType.Validation, 
          `Validation error: ${message}`, 
          error);
      case 500:
      case 502:
      case 503:
      case 504:
        return new ERPNextError(ERPNextErrorType.Server, 
          `ERPNext server error: ${message}`, 
          error);
      default:
        return new ERPNextError(ERPNextErrorType.Unknown, 
          `Unknown error: ${message}`, 
          error);
    }
  }
  
  // Handle generic errors
  return new ERPNextError(
    ERPNextErrorType.Unknown, 
    error?.message || 'An unknown error occurred',
    error instanceof Error ? error : undefined
  );
}

/**
 * Handles errors in tool handlers, returning appropriate response format
 */
export function handleToolError(error: any, logger: Logger) {
  const erpError = categorizeError(error);
  
  // Log the error with appropriate context
  if (erpError.originalError) {
    logger.error(`${erpError.message}`, {
      errorType: erpError.type,
      originalError: erpError.originalError.message,
      stack: erpError.originalError.stack
    });
  } else {
    logger.error(`${erpError.message}`, { 
      errorType: erpError.type,
      stack: erpError.stack
    });
  }
  
  // Return a formatted error response
  return {
    content: [{
      type: "text",
      text: erpError.message
    }],
    isError: true
  };
}

/**
 * Creates a correlation ID for tracking requests through the system
 */
export function createCorrelationId(): string {
  return `mcp-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
}
```

### 2. Enhanced Logging System

#### Structured Logger Implementation

```typescript
// src/utils/logger.ts
export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3
}

export interface LogMetadata {
  [key: string]: any;
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  correlationId?: string;
  metadata?: LogMetadata;
}

export class Logger {
  private level: LogLevel;
  private serviceName: string;
  
  constructor(level: LogLevel = LogLevel.INFO, serviceName: string = "erpnext-mcp") {
    this.level = level;
    this.serviceName = serviceName;
  }
  
  setLevel(level: LogLevel) {
    this.level = level;
  }
  
  private formatLog(level: string, message: string, metadata?: LogMetadata): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      message,
      correlationId: metadata?.correlationId,
      metadata: metadata ? { ...metadata, service: this.serviceName } : { service: this.serviceName }
    };
  }
  
  private outputLog(logEntry: LogEntry) {
    // In production, you might want to use a more sophisticated logging system
    // For now, we'll use console with JSON formatting
    const logJson = JSON.stringify(logEntry);
    
    switch (logEntry.level) {
      case 'ERROR':
        console.error(logJson);
        break;
      case 'WARN':
        console.warn(logJson);
        break;
      case 'INFO':
        console.info(logJson);
        break;
      case 'DEBUG':
        console.debug(logJson);
        break;
      default:
        console.log(logJson);
    }
  }
  
  error(message: string, metadata?: LogMetadata) {
    if (this.level >= LogLevel.ERROR) {
      this.outputLog(this.formatLog('ERROR', message, metadata));
    }
  }
  
  warn(message: string, metadata?: LogMetadata) {
    if (this.level >= LogLevel.WARN) {
      this.outputLog(this.formatLog('WARN', message, metadata));
    }
  }
  
  info(message: string, metadata?: LogMetadata) {
    if (this.level >= LogLevel.INFO) {
      this.outputLog(this.formatLog('INFO', message, metadata));
    }
  }
  
  debug(message: string, metadata?: LogMetadata) {
    if (this.level >= LogLevel.DEBUG) {
      this.outputLog(this.formatLog('DEBUG', message, metadata));
    }
  }
}
```

### 3. Request Context and Correlation

To track requests through the system:

```typescript
// src/middleware/context.ts
import { createCorrelationId } from "../utils/error-handler";

export interface RequestContext {
  correlationId: string;
  startTime: number;
  [key: string]: any;
}

export class RequestContextManager {
  private static contextMap = new Map<string, RequestContext>();
  
  static createContext(requestId: string): RequestContext {
    const context: RequestContext = {
      correlationId: createCorrelationId(),
      startTime: Date.now()
    };
    
    this.contextMap.set(requestId, context);
    return context;
  }
  
  static getContext(requestId: string): RequestContext | undefined {
    return this.contextMap.get(requestId);
  }
  
  static removeContext(requestId: string): void {
    this.contextMap.delete(requestId);
  }
}
```

### 4. Integration with MCP Server

Use the error handling and logging systems with the MCP server:

```typescript
// src/index.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Config } from "./utils/config";
import { Logger, LogLevel } from "./utils/logger";
import { RequestContextManager } from "./middleware/context";

async function main() {
  // Initialize logger
  const logger = new Logger(
    process.env.DEBUG ? LogLevel.DEBUG : LogLevel.INFO
  );
  
  try {
    logger.info("Initializing ERPNext MCP server");
    
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
    
    // Set up request interceptors for correlation and context
    server.onRequest = (request) => {
      const context = RequestContextManager.createContext(request.id);
      logger.debug(`Received request: ${request.method}`, {
        correlationId: context.correlationId,
        request: {
          id: request.id,
          method: request.method,
          params: JSON.stringify(request.params)
        }
      });
    };
    
    // Set up response interceptors for timing and cleanup
    server.onResponse = (response) => {
      const context = RequestContextManager.getContext(response.id);
      if (context) {
        const duration = Date.now() - context.startTime;
        logger.debug(`Sending response`, {
          correlationId: context.correlationId,
          response: {
            id: response.id,
            duration: `${duration}ms`,
            hasError: !!response.error
          }
        });
        
        // Clean up context
        RequestContextManager.removeContext(response.id);
      }
    };
    
    // Set up error handler for server errors
    server.onerror = (error) => {
      logger.error("Server error", { error: error?.message, stack: error?.stack });
    };
    
    // Connect server with stdio transport
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info('ERPNext MCP server running on stdio');
    
  } catch (error) {
    logger.error("Failed to start server", { error: error?.message, stack: error?.stack });
    process.exit(1);
  }
}

main();
```

### 5. Integrating with Client

Update the ERPNext client to use the enhanced error handling:

```typescript
// src/client/erpnext-client.ts
import axios, { AxiosInstance } from "axios";
import { Logger } from "../utils/logger";
import { Config } from "../utils/config";
import { categorizeError, ERPNextError, ERPNextErrorType } from "../utils/error-handler";

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
    
    // Add request interceptor for logging
    this.axiosInstance.interceptors.request.use(
      (config) => {
        this.logger.debug(`Sending ${config.method?.toUpperCase()} request to ${config.url}`, {
          api: {
            method: config.method,
            url: config.url,
            hasData: !!config.data,
            hasParams: !!config.params
          }
        });
        return config;
      },
      (error) => {
        this.logger.error(`Request error: ${error.message}`);
        return Promise.reject(error);
      }
    );
    
    // Add response interceptor for error handling
    this.axiosInstance.interceptors.response.use(
      (response) => {
        return response;
      },
      (error) => {
        const erpError = categorizeError(error);
        this.logger.error(`API error: ${erpError.message}`, {
          errorType: erpError.type,
          statusCode: error.response?.status,
          data: error.response?.data
        });
        return Promise.reject(erpError);
      }
    );
    
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

  // Client methods would use the same error handling pattern...
  async login(username: string, password: string): Promise<void> {
    try {
      this.logger.info(`Attempting login for user ${username}`);
      const response = await this.axiosInstance.post('/api/method/login', {
        usr: username,
        pwd: password
      });
      
      if (response.data.message === 'Logged In') {
        this.authenticated = true;
        this.logger.info(`Successfully authenticated user ${username}`);
      } else {
        throw new ERPNextError(
          ERPNextErrorType.Authentication,
          "Login response did not confirm successful authentication"
        );
      }
    } catch (error) {
      // Let the interceptor handle the error categorization
      this.authenticated = false;
      throw error;
    }
  }

  // Other methods would follow the same pattern...
}
```

## Benefits of Improved Error Handling and Logging

1. **Better Diagnostics**: Structured logging with correlation IDs makes it easier to track requests through the system and diagnose issues.

2. **Consistent Error Responses**: Standardized error handling ensures that clients receive consistent and informative error messages.

3. **Categorized Errors**: Errors are properly categorized, making it easier to handle different types of failures appropriately.

4. **Contextual Information**: Additional metadata is included with logs, providing more context for troubleshooting.

5. **Performance Tracking**: Request timing information helps identify performance bottlenecks.

6. **Environment-specific Logging**: Different log levels can be used in development vs. production environments.

## Implementation Plan

1. Create the error handling utility module
2. Implement the structured logger
3. Update the client to use the enhanced error handling
4. Update resource and tool handlers to leverage the new error system
5. Add request context management
6. Update the main server to integrate all components

These changes will significantly improve the reliability and maintainability of the ERPNext MCP server by making errors more traceable and logs more informative.
