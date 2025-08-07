// src/http-server.ts
import express, { Request, Response } from 'express';
import { spawn } from 'child_process';
import {
  JSONRPCRequest,
  JSONRPCResponse,
  JSONRPCSuccessResponse,
  JSONRPCErrorResponse,
} from 'json-rpc-2.0';

const app = express();

// Add CORS middleware for external access
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization, ERPNEXT_URL, ERPNEXT_API_KEY, ERPNEXT_API_SECRET');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.use(express.json());

// Add health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'ERPNext MCP HTTP Server',
    version: '1.0.0'
  });
});

// Helper function to get ERPNext configuration from headers or environment
function getERPNextConfig(req: Request) {
  return {
    ERPNEXT_URL: req.headers['erpnext_url'] as string || process.env.ERPNEXT_URL || 'http://127.0.0.1:8000',
    ERPNEXT_API_KEY: req.headers['erpnext_api_key'] as string || process.env.ERPNEXT_API_KEY || 'a6f82e11cf4a760',
    ERPNEXT_API_SECRET: req.headers['erpnext_api_secret'] as string || process.env.ERPNEXT_API_SECRET || 'ef0b02ee4d3b056',
  };
}

// Helper function to create MCP process with configuration
function createMCPProcess(config: any) {
  const nodePath = process.execPath; // Use current Node.js executable
  
  const mcp = spawn(nodePath, ['build/index.js'], {
    env: {
      ...process.env,
      ERPNEXT_URL: config.ERPNEXT_URL,
      ERPNEXT_API_KEY: config.ERPNEXT_API_KEY,
      ERPNEXT_API_SECRET: config.ERPNEXT_API_SECRET,
      PORT: process.env.PORT || '3000'
    },
    stdio: ['pipe', 'pipe', 'inherit'],
  });

  // Handle MCP process errors
  mcp.on('error', (error) => {
    console.error('MCP process error:', error);
  });

  mcp.on('exit', (code) => {
    console.log('MCP process exited with code:', code);
  });

  return mcp;
}

// Helper: send one JSON-RPC request and wait for one response
function sendMCPRequest(mcp: any, request: JSONRPCRequest): Promise<JSONRPCResponse> {
  return new Promise((resolve, reject) => {
    // write the request
    mcp.stdin.write(JSON.stringify(request) + '\n');

    // once-only listener
    const onData = (chunk: Buffer) => {
      let parsed: JSONRPCResponse;
      try {
        parsed = JSON.parse(chunk.toString());
      } catch (e) {
        mcp.stdout.off('data', onData);
        return reject(new Error('Invalid JSON from MCP: ' + e));
      }
      // detach listener immediately
      mcp.stdout.off('data', onData);

      // error or success?
      if ((parsed as JSONRPCErrorResponse).error) {
        const err = (parsed as JSONRPCErrorResponse).error!;
        return reject(new Error(err.message));
      } else {
        return resolve(parsed as JSONRPCSuccessResponse);
      }
    };

    mcp.stdout.on('data', onData);
  });
}

// Helper: send streaming JSON-RPC request
function sendStreamingMCPRequest(mcp: any, request: JSONRPCRequest, res: Response) {
  // Set headers for streaming
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');

  // Send initial connection message
  res.write('data: {"type": "connection", "status": "connected"}\n\n');

  // Write the request to MCP
  mcp.stdin.write(JSON.stringify(request) + '\n');

  // Handle MCP responses
  const onData = (chunk: Buffer) => {
    try {
      const data = chunk.toString().trim();
      if (data) {
        // Send each response as a server-sent event
        res.write(`data: ${data}\n\n`);
      }
    } catch (e) {
      console.error('Error processing streaming response:', e);
    }
  };

  mcp.stdout.on('data', onData);

  // Handle client disconnect
  req.on('close', () => {
    mcp.stdout.off('data', onData);
    mcp.kill();
  });
}

// Regular MCP endpoint (non-streaming)
app.post('/mcp', async (req: Request, res: Response) => {
  const { id, method, params } = req.body as {
    id: string | number;
    method: string;
    params?: any;
  };

  const config = getERPNextConfig(req);
  const mcp = createMCPProcess(config);

  const jsonrpcReq: JSONRPCRequest = {
    jsonrpc: '2.0',
    id,
    method,
    params,
  };

  try {
    const response = await sendMCPRequest(mcp, jsonrpcReq);
    res.json(response);
  } catch (e: any) {
    res
      .status(500)
      .json({ jsonrpc: '2.0', id, error: { code: -32000, message: e.message } });
  } finally {
    mcp.kill();
  }
});

// Streaming MCP endpoint
app.post('/mcp/stream', (req: Request, res: Response) => {
  const { id, method, params } = req.body as {
    id: string | number;
    method: string;
    params?: any;
  };

  const config = getERPNextConfig(req);
  const mcp = createMCPProcess(config);

  const jsonrpcReq: JSONRPCRequest = {
    jsonrpc: '2.0',
    id,
    method,
    params,
  };

  sendStreamingMCPRequest(mcp, jsonrpcReq, res);
});

// Tools endpoint for Langflow/Lobechat compatibility
app.post('/tools', async (req: Request, res: Response) => {
  const config = getERPNextConfig(req);
  const mcp = createMCPProcess(config);

  const jsonrpcReq: JSONRPCRequest = {
    jsonrpc: '2.0',
    id: 'tools',
    method: 'tools/list',
    params: {},
  };

  try {
    const response = await sendMCPRequest(mcp, jsonrpcReq);
    res.json(response.result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  } finally {
    mcp.kill();
  }
});

// Call tool endpoint for Langflow/Lobechat compatibility
app.post('/tools/call', async (req: Request, res: Response) => {
  const { name, arguments: args } = req.body as {
    name: string;
    arguments: any;
  };

  const config = getERPNextConfig(req);
  const mcp = createMCPProcess(config);

  const jsonrpcReq: JSONRPCRequest = {
    jsonrpc: '2.0',
    id: 'call',
    method: 'tools/call',
    params: {
      name,
      arguments: args,
    },
  };

  try {
    const response = await sendMCPRequest(mcp, jsonrpcReq);
    res.json(response.result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  } finally {
    mcp.kill();
  }
});

// Resources endpoint for Langflow/Lobechat compatibility
app.post('/resources', async (req: Request, res: Response) => {
  const config = getERPNextConfig(req);
  const mcp = createMCPProcess(config);

  const jsonrpcReq: JSONRPCRequest = {
    jsonrpc: '2.0',
    id: 'resources',
    method: 'resources/list',
    params: {},
  };

  try {
    const response = await sendMCPRequest(mcp, jsonrpcReq);
    res.json(response.result);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  } finally {
    mcp.kill();
  }
});

// Get the port from environment or default to 3000
const port = parseInt(process.env.PORT || '3000', 10);

// Bind to all interfaces (0.0.0.0) for external access
app.listen(port, '0.0.0.0', () => {
  console.log(`ERPNext MCP HTTP Server running on port ${port}`);
  console.log(`Endpoints:`);
  console.log(`  POST /mcp - Standard MCP requests`);
  console.log(`  POST /mcp/stream - Streaming MCP requests`);
  console.log(`  GET  /health - Health check`);
  console.log(`  POST /tools - List available tools (Langflow/Lobechat compatible)`);
  console.log(`  POST /tools/call - Call a tool (Langflow/Lobechat compatible)`);
  console.log(`  POST /resources - List available resources (Langflow/Lobechat compatible)`);
  console.log(`\nConfiguration via headers:`);
  console.log(`  ERPNEXT_URL - Your ERPNext instance URL`);
  console.log(`  ERPNEXT_API_KEY - Your ERPNext API key`);
  console.log(`  ERPNEXT_API_SECRET - Your ERPNext API secret`);
});
