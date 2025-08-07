# ERPNext MCP HTTP Server

A streamable HTTP server that exposes the ERPNext MCP (Model Context Protocol) server via HTTP endpoints, making it compatible with Langflow, Lobechat, and other HTTP-based AI platforms.

## Features

- **Streaming Support**: Real-time streaming responses via Server-Sent Events (SSE)
- **Header-based Configuration**: Pass ERPNext credentials via HTTP headers
- **Langflow/Lobechat Compatible**: Standard endpoints for tool calling and resource listing
- **CORS Enabled**: Cross-origin requests supported
- **Health Monitoring**: Built-in health check endpoint
- **Process Management**: Automatic MCP process lifecycle management

## Quick Start

### 1. Build the Project

```bash
npm run build
```

### 2. Start the HTTP Server

```bash
npm run start:http
```

Or run directly:

```bash
node build/http-server.js
```

The server will start on port 3000 (configurable via `PORT` environment variable).

## Configuration

### Environment Variables

Set these environment variables for default configuration:

```bash
export ERPNEXT_URL="http://your-erpnext-instance.com"
export ERPNEXT_API_KEY="your-api-key"
export ERPNEXT_API_SECRET="your-api-secret"
export PORT="3000"
```

### HTTP Headers

For dynamic configuration per request, use these headers:

- `ERPNEXT_URL`: Your ERPNext instance URL
- `ERPNEXT_API_KEY`: Your ERPNext API key
- `ERPNEXT_API_SECRET`: Your ERPNext API secret

## API Endpoints

### Health Check

```bash
GET /health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "service": "ERPNext MCP HTTP Server",
  "version": "1.0.0"
}
```

### Standard MCP Requests

```bash
POST /mcp
Content-Type: application/json
ERPNEXT_URL: http://your-erpnext-instance.com
ERPNEXT_API_KEY: your-api-key
ERPNEXT_API_SECRET: your-api-secret

{
  "id": "1",
  "method": "tools/list",
  "params": {}
}
```

### Streaming MCP Requests

```bash
POST /mcp/stream
Content-Type: application/json
ERPNEXT_URL: http://your-erpnext-instance.com
ERPNEXT_API_KEY: your-api-key
ERPNEXT_API_SECRET: your-api-secret

{
  "id": "1",
  "method": "tools/call",
  "params": {
    "name": "get_document",
    "arguments": {
      "doctype": "Customer",
      "name": "CUSTOMER-001"
    }
  }
}
```

### Langflow/Lobechat Compatible Endpoints

#### List Available Tools

```bash
POST /tools
Content-Type: application/json
ERPNEXT_URL: http://your-erpnext-instance.com
ERPNEXT_API_KEY: your-api-key
ERPNEXT_API_SECRET: your-api-secret
```

#### Call a Tool

```bash
POST /tools/call
Content-Type: application/json
ERPNEXT_URL: http://your-erpnext-instance.com
ERPNEXT_API_KEY: your-api-key
ERPNEXT_API_SECRET: your-api-secret

{
  "name": "get_document",
  "arguments": {
    "doctype": "Customer",
    "name": "CUSTOMER-001"
  }
}
```

#### List Available Resources

```bash
POST /resources
Content-Type: application/json
ERPNEXT_URL: http://your-erpnext-instance.com
ERPNEXT_API_KEY: your-api-key
ERPNEXT_API_SECRET: your-api-secret
```

## Langflow Integration

### 1. Add Custom Tool in Langflow

Create a new custom tool with the following configuration:

**URL**: `http://your-server:3000/tools/call`
**Method**: `POST`
**Headers**:
```
Content-Type: application/json
ERPNEXT_URL: http://your-erpnext-instance.com
ERPNEXT_API_KEY: your-api-key
ERPNEXT_API_SECRET: your-api-secret
```

**Body Template**:
```json
{
  "name": "{{tool_name}}",
  "arguments": {{arguments}}
}
```

### 2. Example Langflow Tool Configuration

```python
# Python example for Langflow integration
import requests

def call_erpnext_tool(tool_name, arguments):
    url = "http://your-server:3000/tools/call"
    headers = {
        "Content-Type": "application/json",
        "ERPNEXT_URL": "http://your-erpnext-instance.com",
        "ERPNEXT_API_KEY": "your-api-key",
        "ERPNEXT_API_SECRET": "your-api-secret"
    }
    
    data = {
        "name": tool_name,
        "arguments": arguments
    }
    
    response = requests.post(url, headers=headers, json=data)
    return response.json()
```

## Lobechat Integration

### 1. Configure Lobechat

Add the ERPNext MCP server to your Lobechat configuration:

```yaml
# lobechat.yaml
tools:
  - name: erpnext_mcp
    type: http
    url: http://your-server:3000/tools/call
    headers:
      Content-Type: application/json
      ERPNEXT_URL: http://your-erpnext-instance.com
      ERPNEXT_API_KEY: your-api-key
      ERPNEXT_API_SECRET: your-api-secret
    method: POST
    body_template: |
      {
        "name": "{{tool_name}}",
        "arguments": {{arguments}}
      }
```

### 2. Example Lobechat Usage

```python
# Python example for Lobechat integration
import requests

class ERPNextMCPClient:
    def __init__(self, server_url, erpnext_url, api_key, api_secret):
        self.server_url = server_url
        self.headers = {
            "Content-Type": "application/json",
            "ERPNEXT_URL": erpnext_url,
            "ERPNEXT_API_KEY": api_key,
            "ERPNEXT_API_SECRET": api_secret
        }
    
    def call_tool(self, tool_name, arguments):
        url = f"{self.server_url}/tools/call"
        data = {
            "name": tool_name,
            "arguments": arguments
        }
        
        response = requests.post(url, headers=self.headers, json=data)
        return response.json()
    
    def list_tools(self):
        url = f"{self.server_url}/tools"
        response = requests.post(url, headers=self.headers)
        return response.json()

# Usage
client = ERPNextMCPClient(
    "http://your-server:3000",
    "http://your-erpnext-instance.com",
    "your-api-key",
    "your-api-secret"
)

# Get a customer document
result = client.call_tool("get_document", {
    "doctype": "Customer",
    "name": "CUSTOMER-001"
})
```

## Streaming Support

The server supports streaming responses for real-time updates. Use the `/mcp/stream` endpoint for streaming requests:

```javascript
// JavaScript example for streaming
const eventSource = new EventSource('/mcp/stream');

eventSource.onmessage = function(event) {
    const data = JSON.parse(event.data);
    console.log('Received:', data);
    
    if (data.type === 'connection') {
        // Send the actual request
        fetch('/mcp/stream', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'ERPNEXT_URL': 'http://your-erpnext-instance.com',
                'ERPNEXT_API_KEY': 'your-api-key',
                'ERPNEXT_API_SECRET': 'your-api-secret'
            },
            body: JSON.stringify({
                id: '1',
                method: 'tools/call',
                params: {
                    name: 'get_document',
                    arguments: {
                        doctype: 'Customer',
                        name: 'CUSTOMER-001'
                    }
                }
            })
        });
    }
};
```

## Error Handling

The server returns appropriate HTTP status codes and error messages:

- `200`: Success
- `400`: Bad Request (invalid JSON-RPC request)
- `500`: Internal Server Error (MCP process error)

Error response format:
```json
{
  "jsonrpc": "2.0",
  "id": "request-id",
  "error": {
    "code": -32000,
    "message": "Error description"
  }
}
```

## Security Considerations

1. **HTTPS**: Use HTTPS in production for secure communication
2. **API Keys**: Store API keys securely and rotate them regularly
3. **CORS**: Configure CORS appropriately for your domain
4. **Rate Limiting**: Consider implementing rate limiting for production use
5. **Authentication**: Add authentication layer if needed

## Development

### Running in Development Mode

```bash
npm run dev
```

This will build the project and start the HTTP server.

### Building

```bash
npm run build
```

### Watching for Changes

```bash
npm run watch
```

## Troubleshooting

### Common Issues

1. **MCP Process Not Starting**: Ensure the build is successful and the MCP server binary exists
2. **Authentication Errors**: Verify your ERPNext API credentials
3. **CORS Issues**: Check that the server is accessible from your client domain
4. **Streaming Not Working**: Ensure your client supports Server-Sent Events

### Debug Mode

Set the `DEBUG` environment variable for verbose logging:

```bash
DEBUG=* npm run start:http
```

## License

This project is licensed under the MIT License.