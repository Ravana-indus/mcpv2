# Testing Strategy

This document outlines a comprehensive testing strategy for the ERPNext MCP server to ensure reliability, correctness, and maintainability.

## Current Status

The current implementation lacks any automated testing, which poses several risks:

- No way to verify that changes don't break existing functionality
- Difficulty in detecting regressions
- Challenges in maintaining code quality as the codebase grows
- Decreased confidence when making changes or adding features

## Proposed Testing Structure

### Directory Structure

```
tests/
├── unit/
│   ├── client/
│   │   └── erpnext-client.test.ts
│   ├── handlers/
│   │   ├── resource-handlers.test.ts
│   │   └── tool-handlers.test.ts
│   └── utils/
│       ├── cache.test.ts
│       ├── config.test.ts
│       └── logger.test.ts
├── integration/
│   └── api-integration.test.ts
├── e2e/
│   └── full-workflow.test.ts
└── mocks/
    ├── erpnext-api.ts
    └── test-data.ts
```

## Testing Levels

### 1. Unit Tests

Unit tests should focus on testing individual components in isolation, mocking external dependencies. These tests should be fast and focused.

#### Example: Testing the Cache Utility

```typescript
// tests/unit/utils/cache.test.ts
import { Cache } from '../../../src/utils/cache';
import { jest } from '@jest/globals';

describe('Cache', () => {
  let cache: Cache;
  
  beforeEach(() => {
    cache = new Cache();
    jest.useFakeTimers();
  });
  
  afterEach(() => {
    jest.useRealTimers();
  });
  
  test('should store and retrieve values', () => {
    // Arrange
    const key = 'test-key';
    const value = { data: 'test-data' };
    
    // Act
    cache.set(key, value);
    const result = cache.get(key);
    
    // Assert
    expect(result).toEqual(value);
  });
  
  test('should expire values after TTL', () => {
    // Arrange
    const key = 'test-key';
    const value = { data: 'test-data' };
    const ttl = 1000; // 1 second
    
    // Act
    cache.set(key, value, ttl);
    
    // Move time forward
    jest.advanceTimersByTime(1001);
    
    const result = cache.get(key);
    
    // Assert
    expect(result).toBeUndefined();
  });
  
  test('should invalidate keys with prefix', () => {
    // Arrange
    cache.set('prefix:key1', 'value1');
    cache.set('prefix:key2', 'value2');
    cache.set('other:key', 'value3');
    
    // Act
    cache.invalidate('prefix:');
    
    // Assert
    expect(cache.get('prefix:key1')).toBeUndefined();
    expect(cache.get('prefix:key2')).toBeUndefined();
    expect(cache.get('other:key')).toBe('value3');
  });
});
```

#### Example: Testing the ERPNext Client

```typescript
// tests/unit/client/erpnext-client.test.ts
import { ERPNextClient } from '../../../src/client/erpnext-client';
import { Config } from '../../../src/utils/config';
import { Logger } from '../../../src/utils/logger';
import axios from 'axios';
import { jest } from '@jest/globals';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ERPNextClient', () => {
  let client: ERPNextClient;
  let mockConfig: jest.Mocked<Config>;
  let mockLogger: jest.Mocked<Logger>;
  
  beforeEach(() => {
    // Setup mock config
    mockConfig = {
      getERPNextUrl: jest.fn().mockReturnValue('https://test-erpnext.com'),
      getERPNextApiKey: jest.fn().mockReturnValue('test-key'),
      getERPNextApiSecret: jest.fn().mockReturnValue('test-secret')
    } as unknown as jest.Mocked<Config>;
    
    // Setup mock logger
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn()
    } as unknown as jest.Mocked<Logger>;
    
    // Setup axios mock
    mockedAxios.create.mockReturnValue({
      defaults: { headers: { common: {} } },
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn()
    } as any);
    
    // Create client instance
    client = new ERPNextClient(mockConfig, mockLogger);
  });
  
  test('should initialize with API key authentication', () => {
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('API key authentication')
    );
    expect(client.isAuthenticated()).toBe(true);
  });
  
  test('login should authenticate the client', async () => {
    // Setup mock response
    const axiosInstance = mockedAxios.create.mock.results[0].value;
    axiosInstance.post.mockResolvedValue({
      data: { message: 'Logged In' }
    });
    
    // Act
    await client.login('testuser', 'testpass');
    
    // Assert
    expect(axiosInstance.post).toHaveBeenCalledWith(
      '/api/method/login',
      { usr: 'testuser', pwd: 'testpass' }
    );
    expect(client.isAuthenticated()).toBe(true);
  });
  
  test('login should handle authentication failure', async () => {
    // Setup mock response for failure
    const axiosInstance = mockedAxios.create.mock.results[0].value;
    axiosInstance.post.mockRejectedValue(new Error('Authentication failed'));
    
    // Act & Assert
    await expect(client.login('testuser', 'wrongpass')).rejects.toThrow('Authentication failed');
    expect(client.isAuthenticated()).toBe(false);
  });
});
```

### 2. Integration Tests

Integration tests should verify that different components work correctly together. For the ERPNext MCP server, integration tests should focus on the interaction between the server, handlers, and the ERPNext client.

```typescript
// tests/integration/api-integration.test.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { MemoryTransport } from "@modelcontextprotocol/sdk/server/memory.js";
import { ERPNextClient } from '../../src/client/erpnext-client';
import { registerResourceHandlers } from '../../src/handlers/resource-handlers';
import { registerToolHandlers } from '../../src/handlers/tool-handlers';
import { Logger } from '../../src/utils/logger';
import { Cache } from '../../src/utils/cache';
import { jest } from '@jest/globals';

// Use mock ERPNext client
jest.mock('../../src/client/erpnext-client');

describe('MCP Server Integration', () => {
  let server: Server;
  let transport: MemoryTransport;
  let mockErpnextClient: jest.Mocked<ERPNextClient>;
  let logger: Logger;
  let cache: Cache;
  
  beforeEach(async () => {
    // Setup mocks
    mockErpnextClient = {
      isAuthenticated: jest.fn().mockReturnValue(true),
      login: jest.fn(),
      getDocument: jest.fn(),
      getDocList: jest.fn(),
      createDocument: jest.fn(),
      updateDocument: jest.fn(),
      runReport: jest.fn(),
      getAllDocTypes: jest.fn()
    } as unknown as jest.Mocked<ERPNextClient>;
    
    logger = new Logger();
    cache = new Cache();
    
    // Create server
    server = new Server(
      {
        name: "erpnext-server-test",
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
    registerResourceHandlers(server, mockErpnextClient, cache, logger);
    registerToolHandlers(server, mockErpnextClient, logger);
    
    // Setup transport
    transport = new MemoryTransport();
    await server.connect(transport);
  });
  
  afterEach(async () => {
    await server.close();
  });
  
  test('List tools should return all tools', async () => {
    // Act
    const response = await transport.sendRequestAndWaitForResponse({
      jsonrpc: "2.0",
      id: "test-id",
      method: "mcp.listTools",
      params: {}
    });
    
    // Assert
    expect(response.result).toBeDefined();
    expect(response.result.tools).toBeInstanceOf(Array);
    expect(response.result.tools.length).toBeGreaterThan(0);
    expect(response.result.tools.map(t => t.name)).toContain('authenticate_erpnext');
  });
  
  test('Get documents tool should fetch documents', async () => {
    // Arrange
    const mockDocuments = [
      { name: "CUST-001", customer_name: "Test Customer" }
    ];
    
    mockErpnextClient.getDocList.mockResolvedValue(mockDocuments);
    
    // Act
    const response = await transport.sendRequestAndWaitForResponse({
      jsonrpc: "2.0",
      id: "test-id",
      method: "mcp.callTool",
      params: {
        name: "get_documents",
        arguments: {
          doctype: "Customer"
        }
      }
    });
    
    // Assert
    expect(mockErpnextClient.getDocList).toHaveBeenCalledWith(
      "Customer", undefined, undefined, undefined
    );
    expect(response.result).toBeDefined();
    expect(JSON.parse(response.result.content[0].text)).toEqual(mockDocuments);
  });
});
```

### 3. End-to-End Tests

E2E tests should verify the entire system works correctly from the user's perspective. These tests should use a real or mock ERPNext server and execute complete workflows.

```typescript
// tests/e2e/full-workflow.test.ts
import { spawn, ChildProcess } from 'child_process';
import axios from 'axios';
import { jest } from '@jest/globals';
import path from 'path';
import { startMockErpnextServer, stopMockErpnextServer } from '../mocks/erpnext-api';

describe('E2E Tests', () => {
  let serverProcess: ChildProcess;
  let mockServerUrl: string;
  
  beforeAll(async () => {
    // Start mock ERPNext server
    mockServerUrl = await startMockErpnextServer();
    
    // Start MCP server with environment pointing to mock server
    const serverPath = path.resolve(__dirname, '../../build/index.js');
    serverProcess = spawn('node', [serverPath], {
      env: {
        ...process.env,
        ERPNEXT_URL: mockServerUrl,
        ERPNEXT_API_KEY: 'test-key',
        ERPNEXT_API_SECRET: 'test-secret',
        DEBUG: 'true'
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    
    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 1000));
  });
  
  afterAll(async () => {
    // Terminate the server process
    if (serverProcess) {
      serverProcess.kill();
    }
    
    // Stop mock server
    await stopMockErpnextServer();
  });
  
  test('Complete workflow test', async () => {
    // Setup a test client that communicates with the MCP server
    
    // This would test a complete workflow:
    // 1. Authentication
    // 2. Document retrieval
    // 3. Document creation
    // 4. Document update
    // 5. Running a report
  });
});
```

## Test Mocks

Creating proper mocks is essential for effective testing:

```typescript
// tests/mocks/erpnext-api.ts
import express from 'express';
import http from 'http';
import bodyParser from 'body-parser';

let server: http.Server;
let app: express.Express;

// Mock data storage
const mockData: Record<string, any[]> = {
  'Customer': [
    {
      name: 'CUST-001',
      customer_name: 'Test Customer 1',
      customer_type: 'Company',
      customer_group: 'Commercial',
      territory: 'United States'
    }
  ],
  'Item': [
    {
      name: 'ITEM-001',
      item_code: 'ITEM-001',
      item_name: 'Test Item 1',
      item_group: 'Products',
      stock_uom: 'Nos'
    }
  ]
};

export async function startMockErpnextServer(): Promise<string> {
  app = express();
  app.use(bodyParser.json());
  
  // Setup API endpoints that mimic ERPNext
  
  // Login endpoint
  app.post('/api/method/login', (req, res) => {
    const { usr, pwd } = req.body;
    
    if (usr === 'testuser' && pwd === 'testpass') {
      res.json({ message: 'Logged In' });
    } else {
      res.status(401).json({ message: 'Authentication failed' });
    }
  });
  
  // Document listing
  app.get('/api/resource/:doctype', (req, res) => {
    const doctype = req.params.doctype;
    res.json({ data: mockData[doctype] || [] });
  });
  
  // Document retrieval
  app.get('/api/resource/:doctype/:name', (req, res) => {
    const { doctype, name } = req.params;
    const docs = mockData[doctype] || [];
    const doc = docs.find(d => d.name === name);
    
    if (doc) {
      res.json({ data: doc });
    } else {
      res.status(404).json({ message: 'Not found' });
    }
  });
  
  // Document creation
  app.post('/api/resource/:doctype', (req, res) => {
    const { doctype } = req.params;
    const data = req.body.data;
    
    if (!mockData[doctype]) {
      mockData[doctype] = [];
    }
    
    mockData[doctype].push(data);
    res.json({ data });
  });
  
  // Document update
  app.put('/api/resource/:doctype/:name', (req, res) => {
    const { doctype, name } = req.params;
    const data = req.body.data;
    
    if (!mockData[doctype]) {
      return res.status(404).json({ message: 'DocType not found' });
    }
    
    const index = mockData[doctype].findIndex(d => d.name === name);
    if (index === -1) {
      return res.status(404).json({ message: 'Document not found' });
    }
    
    mockData[doctype][index] = { ...mockData[doctype][index], ...data };
    res.json({ data: mockData[doctype][index] });
  });
  
  // Start server on a random port
  return new Promise<string>((resolve) => {
    server = app.listen(0, () => {
      const address = server.address();
      const port = typeof address === 'object' ? address?.port : 0;
      resolve(`http://localhost:${port}`);
    });
  });
}

export async function stopMockErpnextServer(): Promise<void> {
  return new Promise<void>((resolve) => {
    if (server) {
      server.close(() => resolve());
    } else {
      resolve();
    }
  });
}
```

## Setting Up Testing Infrastructure

### 1. Dependencies

Add the following development dependencies to `package.json`:

```json
"devDependencies": {
  "@types/jest": "^29.5.0",
  "@types/express": "^4.17.17",
  "body-parser": "^1.20.2",
  "express": "^4.18.2",
  "jest": "^29.5.0",
  "ts-jest": "^29.1.0",
  "@types/node": "^20.11.24",
  "typescript": "^5.3.3"
}
```

### 2. Jest Configuration

Add Jest configuration in `package.json`:

```json
"jest": {
  "preset": "ts-jest",
  "testEnvironment": "node",
  "roots": [
    "<rootDir>/tests"
  ],
  "collectCoverage": true,
  "collectCoverageFrom": [
    "src/**/*.ts"
  ],
  "coverageThreshold": {
    "global": {
      "branches": 80,
      "functions": 80,
      "lines": 80,
      "statements": 80
    }
  }
}
```

### 3. Add Test Scripts

Add test scripts to `package.json`:

```json
"scripts": {
  "test": "jest",
  "test:watch": "jest --watch",
  "test:coverage": "jest --coverage",
  "test:unit": "jest tests/unit",
  "test:integration": "jest tests/integration",
  "test:e2e": "jest tests/e2e"
}
```

## CI/CD Integration

Implement continuous integration using GitHub Actions or similar CI platform:

```yaml
# .github/workflows/ci.yml
name: CI

on:
  push:
    branches: [ main ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest

    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        
    - name: Install dependencies
      run: npm ci
      
    - name: Run tests
      run: npm test
      
    - name: Upload coverage
      uses: codecov/codecov-action@v3
```

## Testing Best Practices

1. **Write tests before code** - Consider test-driven development (TDD) for new features
2. **Test edge cases** - Ensure error scenarios and unusual inputs are handled correctly
3. **Keep tests independent** - Each test should run in isolation
4. **Use descriptive test names** - Tests should document what functionality is being verified
5. **Mock external dependencies** - Don't rely on external services in unit tests
6. **Aim for high coverage** - But focus on meaningful coverage rather than arbitrary metrics
7. **Maintain tests** - Update tests when functionality changes
8. **Run tests regularly** - Integrate in CI/CD pipeline and run locally before commits

## Conclusion

Implementing a comprehensive testing strategy will significantly improve the reliability and maintainability of the ERPNext MCP server. By using a combination of unit, integration, and end-to-end tests, we can ensure that the server behaves correctly under different scenarios and that changes don't introduce regressions.
