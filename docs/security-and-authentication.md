# Security and Authentication Improvements

This document outlines recommendations for enhancing security and authentication in the ERPNext MCP server.

## Current Status

The current implementation has several limitations in its security and authentication approach:

1. Simple username/password authentication without token refresh mechanisms
2. Basic API key/secret handling without proper validation
3. Passwords transmitted and handled in plain text
4. No input validation or sanitization
5. No token/session management
6. Limited security headers
7. No protection against common security vulnerabilities

## Proposed Improvements

### 1. Enhanced Authentication System

#### Robust Authentication Mechanisms

```typescript
// src/auth/authenticator.ts
import { Logger } from "../utils/logger";
import { Config } from "../utils/config";
import { ERPNextClient } from "../client/erpnext-client";
import { ERPNextError, ERPNextErrorType } from "../utils/error-handler";

export interface AuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

export class AuthManager {
  private tokens: AuthTokens | null = null;
  private authenticated: boolean = false;
  private refreshTimer: NodeJS.Timeout | null = null;
  private client: ERPNextClient;
  private logger: Logger;
  
  constructor(
    client: ERPNextClient, 
    logger: Logger,
    private readonly config: Config
  ) {
    this.client = client;
    this.logger = logger;
    
    // Initialize with API key/secret if available
    const apiKey = this.config.getERPNextApiKey();
    const apiSecret = this.config.getERPNextApiSecret();
    
    if (apiKey && apiSecret) {
      this.authenticated = true;
      this.logger.info("Initialized with API key authentication");
    }
  }
  
  /**
   * Check if the client is authenticated
   */
  isAuthenticated(): boolean {
    return this.authenticated;
  }
  
  /**
   * Authenticate using username and password
   */
  async authenticate(username: string, password: string): Promise<void> {
    try {
      if (!username || !password) {
        throw new ERPNextError(
          ERPNextErrorType.Authentication, 
          "Username and password are required"
        );
      }
      
      // Mask password in logs
      this.logger.info(`Attempting to authenticate user: ${username}`);
      
      // Authenticate with ERPNext
      await this.client.login(username, password);
      
      this.authenticated = true;
      this.logger.info(`Authentication successful for user: ${username}`);
      
      // In a real implementation, we would store tokens and set up refresh
      // ERPNext doesn't have a standard token-based auth, but we're 
      // setting up the structure for future enhancement
    } catch (error) {
      this.authenticated = false;
      this.logger.error(`Authentication failed for user: ${username}`);
      throw error;
    }
  }
  
  /**
   * Set up token refresh mechanism
   * This is a placeholder for future enhancement as ERPNext's
   * standard API doesn't use refresh tokens, but the structure
   * is here for custom implementations or future changes
   */
  private setupTokenRefresh(tokens: AuthTokens): void {
    // Clear any existing refresh timer
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    
    // If no expiry, don't set up refresh
    if (!tokens.expiresAt || !tokens.refreshToken) {
      return;
    }
    
    // Calculate time until refresh (5 minutes before expiry)
    const now = Date.now();
    const expiryTime = tokens.expiresAt;
    const timeUntilRefresh = Math.max(0, expiryTime - now - 5 * 60 * 1000);
    
    this.logger.debug(`Setting up token refresh in ${timeUntilRefresh / 1000} seconds`);
    
    this.refreshTimer = setTimeout(async () => {
      try {
        // Here we would implement the token refresh logic
        this.logger.debug("Refreshing authentication token");
        
        // For future implementation:
        // const newTokens = await this.client.refreshToken(tokens.refreshToken);
        // this.setTokens(newTokens);
      } catch (error) {
        this.logger.error("Failed to refresh token", { error });
        this.authenticated = false;
      }
    }, timeUntilRefresh);
  }
  
  /**
   * Store authentication tokens
   */
  private setTokens(tokens: AuthTokens): void {
    this.tokens = tokens;
    this.authenticated = true;
    
    // Set up token refresh if applicable
    this.setupTokenRefresh(tokens);
  }
  
  /**
   * Get current auth token for API requests
   */
  getAuthToken(): string | null {
    return this.tokens?.accessToken || null;
  }
  
  /**
   * Log out and clear authentication
   */
  logout(): void {
    this.authenticated = false;
    this.tokens = null;
    
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
    
    this.logger.info("User logged out");
  }
}
```

### 2. Input Validation and Sanitization

Create a dedicated validation module to ensure inputs are properly validated before being used:

```typescript
// src/utils/validation.ts
import { z } from "zod"; // Using Zod for schema validation

// Schema for authentication credentials
export const AuthCredentialsSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required")
});

// Schema for doctype
export const DoctypeSchema = z.string().min(1, "DocType is required");

// Schema for document name
export const DocumentNameSchema = z.string().min(1, "Document name is required");

// Schema for document data
export const DocumentDataSchema = z.record(z.unknown());

// Schema for document filters
export const FiltersSchema = z.record(z.unknown()).optional();

// Schema for field list
export const FieldsSchema = z.array(z.string()).optional();

// Schema for pagination
export const PaginationSchema = z.object({
  limit: z.number().positive().optional(),
  page: z.number().positive().optional()
});

// Schema for report
export const ReportSchema = z.object({
  report_name: z.string().min(1, "Report name is required"),
  filters: z.record(z.unknown()).optional()
});

/**
 * Validates input against a schema and returns the validated data
 * or throws an error if validation fails
 */
export function validateInput<T>(schema: z.Schema<T>, data: unknown): T {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      // Convert zod error to a more user-friendly format
      const issues = error.errors.map(err => `${err.path.join('.')}: ${err.message}`).join(", ");
      throw new Error(`Validation error: ${issues}`);
    }
    throw error;
  }
}

/**
 * Sanitizes string input to prevent injection attacks
 */
export function sanitizeString(input: string): string {
  // Basic sanitization to prevent script injection
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Sanitizes an object by applying string sanitization to all string properties
 */
export function sanitizeObject(obj: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  
  Object.entries(obj).forEach(([key, value]) => {
    if (typeof value === 'string') {
      result[key] = sanitizeString(value);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = sanitizeObject(value);
    } else {
      result[key] = value;
    }
  });
  
  return result;
}
```

### 3. Secure Configuration Management

Enhance the configuration module with better security practices:

```typescript
// src/utils/config.ts
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

export class Config {
  private config: Record<string, string> = {};
  
  constructor(configPath?: string) {
    // Load environment variables from .env file if it exists
    if (configPath && fs.existsSync(configPath)) {
      const envConfig = dotenv.parse(fs.readFileSync(configPath));
      this.config = { ...this.config, ...envConfig };
    }
    
    // Override with actual environment variables
    Object.assign(this.config, process.env);
    
    // Validate required configuration
    this.validateConfig();
  }
  
  private validateConfig() {
    // Validate required configuration
    const requiredVars = ['ERPNEXT_URL'];
    const missing = requiredVars.filter(key => !this.get(key));
    
    if (missing.length > 0) {
      throw new Error(`Missing required configuration: ${missing.join(', ')}`);
    }
    
    // Validate URL format
    try {
      new URL(this.getERPNextUrl());
    } catch (error) {
      throw new Error(`Invalid ERPNEXT_URL: ${this.getERPNextUrl()}`);
    }
    
    // Validate API key and secret (both or neither)
    const hasApiKey = !!this.get('ERPNEXT_API_KEY');
    const hasApiSecret = !!this.get('ERPNEXT_API_SECRET');
    
    if ((hasApiKey && !hasApiSecret) || (!hasApiKey && hasApiSecret)) {
      throw new Error('Both ERPNEXT_API_KEY and ERPNEXT_API_SECRET must be provided if using API key authentication');
    }
  }
  
  /**
   * Get a configuration value
   */
  get(key: string): string | undefined {
    return this.config[key];
  }
  
  /**
   * Get a configuration value or throw if not found
   */
  getRequired(key: string): string {
    const value = this.get(key);
    if (value === undefined) {
      throw new Error(`Required configuration "${key}" not found`);
    }
    return value;
  }
  
  /**
   * Get ERPNext URL, ensuring it doesn't end with a trailing slash
   */
  getERPNextUrl(): string {
    return this.getRequired('ERPNEXT_URL').replace(/\/$/, '');
  }
  
  /**
   * Get ERPNext API key
   */
  getERPNextApiKey(): string | undefined {
    return this.get('ERPNEXT_API_KEY');
  }
  
  /**
   * Get ERPNext API secret
   */
  getERPNextApiSecret(): string | undefined {
    return this.get('ERPNEXT_API_SECRET');
  }
  
  /**
   * Get log level (defaults to "info")
   */
  getLogLevel(): string {
    return this.get('LOG_LEVEL') || 'info';
  }
}
```

### 4. Security Middleware

Add security middleware to protect against common vulnerabilities:

```typescript
// src/middleware/security.ts
import { Logger } from "../utils/logger";

export interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
}

/**
 * Simple rate limiting implementation for tools
 */
export class RateLimiter {
  private windowMs: number;
  private maxRequests: number;
  private requests: Map<string, number[]> = new Map();
  private logger: Logger;
  
  constructor(config: RateLimitConfig, logger: Logger) {
    this.windowMs = config.windowMs;
    this.maxRequests = config.maxRequests;
    this.logger = logger;
  }
  
  /**
   * Check if a request should be rate limited
   * @param key Identifier for the rate limit bucket (e.g. tool name, user ID)
   * @returns Whether the request should be allowed
   */
  allowRequest(key: string): boolean {
    const now = Date.now();
    
    // Get existing timestamps for this key
    let timestamps = this.requests.get(key) || [];
    
    // Filter out timestamps outside the current window
    timestamps = timestamps.filter(time => now - time < this.windowMs);
    
    // Check if we've exceeded the limit
    if (timestamps.length >= this.maxRequests) {
      this.logger.warn(`Rate limit exceeded for ${key}`);
      return false;
    }
    
    // Add the new timestamp and update the map
    timestamps.push(now);
    this.requests.set(key, timestamps);
    
    return true;
  }
  
  /**
   * Reset rate limit for a specific key
   */
  reset(key: string): void {
    this.requests.delete(key);
  }
}

/**
 * Security headers to add to responses
 */
export const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'",
  'X-XSS-Protection': '1; mode=block',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains'
};
```

### 5. Secure Resource and Tool Handlers

Update the tool handlers to include validation, rate limiting, and better credential handling:

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
import { AuthManager } from "../auth/authenticator";
import { Logger } from "../utils/logger";
import { handleToolError } from "../utils/error-handler";
import { RateLimiter } from "../middleware/security";
import * as validation from "../utils/validation";
import { RequestContextManager } from "../middleware/context";

export function registerToolHandlers(
  server: Server, 
  erpnext: ERPNextClient,
  auth: AuthManager,
  logger: Logger
) {
  // Create rate limiter for authentication attempts
  const authRateLimiter = new RateLimiter({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 5 // 5 attempts per minute
  }, logger);
  
  // Create rate limiter for other operations
  const toolRateLimiter = new RateLimiter({
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 30 // 30 requests per minute
  }, logger);

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
        {
          name: "authenticate_erpnext",
          description: "Authenticate with ERPNext using username and password",
          inputSchema: {
            type: "object",
            properties: {
              username: {
                type: "string",
                description: "ERPNext username"
              },
              password: {
                type: "string",
                description: "ERPNext password"
              }
            },
            required: ["username", "password"]
          }
        },
        // Other tools...
      ]
    };
  });

  // Handler for tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const requestId = request.id;
    const context = RequestContextManager.getContext(requestId);
    const correlationId = context?.correlationId;
    
    logger.debug(`Handling CallToolRequest: ${request.params.name}`, { 
      correlationId,
      tool: request.params.name
    });
    
    try {
      // Apply rate limiting based on tool
      const toolName = request.params.name;
      
      if (toolName === 'authenticate_erpnext') {
        // Use stricter rate limiting for authentication
        if (!authRateLimiter.allowRequest(toolName)) {
          throw new McpError(
            ErrorCode.TooManyRequests,
            "Too many authentication attempts. Please try again later."
          );
        }
      } else {
        // Use standard rate limiting for other tools
        if (!toolRateLimiter.allowRequest(toolName)) {
          throw new McpError(
            ErrorCode.TooManyRequests,
            "Too many requests. Please try again later."
          );
        }
      }
      
      // Handle specific tool requests with proper validation
      switch (toolName) {
        case "authenticate_erpnext": {
          const credentials = validation.validateInput(
            validation.AuthCredentialsSchema, 
            request.params.arguments
          );
          
          try {
            await auth.authenticate(credentials.username, credentials.password);
            
            return {
              content: [{
                type: "text",
                text: `Successfully authenticated with ERPNext as ${credentials.username}`
              }]
            };
          } catch (error) {
            // Don't expose details of authentication failures
            return {
              content: [{
                type: "text",
                text: "Authentication failed. Please check your credentials and try again."
              }],
              isError: true
            };
          }
        }
        
        case "get_documents": {
          // First check authentication
          if (!auth.isAuthenticated()) {
            throw new McpError(
              ErrorCode.Unauthorized,
              "Not authenticated with ERPNext. Use the authenticate_erpnext tool first."
            );
          }
          
          // Validate doctype
          const doctype = validation.validateInput(
            validation.DoctypeSchema,
            request.params.arguments?.doctype
          );
          
          // Validate optional parameters
          const fields = request.params.arguments?.fields ? 
            validation.validateInput(validation.FieldsSchema, request.params.arguments.fields) : 
            undefined;
          
          const filters = request.params.arguments?.filters ?
            validation.validateInput(validation.FiltersSchema, request.params.arguments.filters) :
            undefined;
          
          const limit = request.params.arguments?.limit as number | undefined;
          
          // Get documents
          const documents = await erpnext.getDocList(doctype, filters, fields, limit);
          
          return {
            content: [{
              type: "text",
              text: JSON.stringify(documents, null, 2)
            }]
          };
        }
        
        // Other tool handlers...
        
        default:
          throw new McpError(
            ErrorCode.MethodNotFound,
            `Unknown tool: ${request.params.name}`
          );
      }
    } catch (error) {
      return handleToolError(error, logger);
    }
  });
}
```

## Security Best Practices

### 1. Credential Handling

- Never log passwords or sensitive information
- Use secure environment variables for storing secrets
- Implement token refresh mechanisms where possible
- Consider using a secrets manager for production deployments

### 2. Input Validation

- Validate all inputs with proper schemas
- Sanitize inputs where necessary to prevent injection attacks
- Apply validation early in the request flow

### 3. Rate Limiting

- Apply rate limits to prevent abuse
- Use stricter limits for sensitive operations like authentication
- Provide informative feedback when limits are exceeded

### 4. Secure Configuration

- Validate configuration at startup
- Support multiple configuration sources (env vars, config files)
- Use a secure method for loading credentials

### 5. Authentication Best Practices

- Implement proper token handling
- Support multiple authentication methods
- Add contextual information for authentication events
- Log authentication events (success, failure) without exposing sensitive details

## Implementation Plan

1. Add the validation utility module
2. Implement the secure configuration module
3. Create the authentication manager
4. Add security middleware (rate limiting)
5. Update tool handlers to use validation and rate limiting
6. Add security headers to responses

These security improvements will help protect the ERPNext MCP server against common security vulnerabilities and provide better protection for user credentials and data.
