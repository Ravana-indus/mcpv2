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
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

app.use(express.json());

// Add health check endpoint
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Use the correct Node.js path
const nodePath = '/home/frappeuser/.nvm/versions/node/v18.20.8/bin/node';

// Spawn your MCP CLI with correct environment
const mcp = spawn(nodePath, ['build/index.js'], {
  env: {
    ...process.env,
    ERPNEXT_URL: process.env.ERPNEXT_URL || 'http://127.0.0.1:8000',
    ERPNEXT_API_KEY: process.env.ERPNEXT_API_KEY || 'a6f82e11cf4a760',
    ERPNEXT_API_SECRET: process.env.ERPNEXT_API_SECRET || 'ef0b02ee4d3b056',
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

// Helper: send one JSON-RPC request and wait for one response
function sendMCPRequest(request: JSONRPCRequest): Promise<JSONRPCResponse> {
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

app.post('/mcp', async (req: Request, res: Response) => {
  const { id, method, params } = req.body as {
    id: string | number;
    method: string;
    params?: any;
  };

  const jsonrpcReq: JSONRPCRequest = {
    jsonrpc: '2.0',
    id,
    method,
    params,
  };

  try {
    const response = await sendMCPRequest(jsonrpcReq);
    res.json(response);
  } catch (e: any) {
    res
      .status(500)
      .json({ jsonrpc: '2.0', id, error: { code: -32000, message: e.message } });
  }
});

// Get the port from environment or default to 3000
const port = parseInt(process.env.PORT || '3000', 10);

// Bind to all interfaces (0.0.0.0) for external access
app.listen(port, '0.0.0.0', () => {
  console.log(`MCP→HTTP gateway running on port ${port}`);
  console.log(`Access via: http://map.ravanos.com/mcp`);
  console.log(`Health check: http://map.ravanos.com/health`);
});
