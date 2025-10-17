import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { URL, fileURLToPath } from "node:url";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { server as mcpServer } from "./index.js";

const transports = new Map<string, SSEServerTransport>();

function setCorsHeaders(res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, Accept"
  );
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

function handleOptions(res: ServerResponse) {
  setCorsHeaders(res);
  res.writeHead(204).end();
}

function handleHealth(res: ServerResponse) {
  setCorsHeaders(res);
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ok", timestamp: new Date().toISOString() }));
}

async function handleSseConnection(
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  setCorsHeaders(res);

  const transport = new SSEServerTransport("/message", res);
  transports.set(transport.sessionId, transport);

  transport.onclose = () => {
    transports.delete(transport.sessionId);
  };

  transport.onerror = (error) => {
    console.error("SSE transport error:", error);
  };

  try {
    if (mcpServer.transport) {
      await mcpServer.close();
    }
    await mcpServer.connect(transport);
  } catch (error) {
    console.error("Failed to start SSE transport:", error);
    transports.delete(transport.sessionId);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to start SSE transport" }));
    } else {
      res.end();
    }
  }
}

async function handleMessage(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL
): Promise<void> {
  setCorsHeaders(res);

  const sessionId = url.searchParams.get("sessionId");
  if (!sessionId) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Missing sessionId" }));
    return;
  }

  const transport = transports.get(sessionId);
  if (!transport) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Unknown session" }));
    return;
  }

  try {
    await transport.handlePostMessage(req, res);
  } catch (error) {
    console.error("Failed to forward message to MCP server:", error);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Failed to forward message" }));
    }
  }
}

const httpServer = createServer(async (req, res) => {
  if (!req.url) {
    res.writeHead(400, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Invalid request" }));
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  switch (req.method) {
    case "OPTIONS":
      handleOptions(res);
      return;
    case "GET":
      if (url.pathname === "/health") {
        handleHealth(res);
        return;
      }
      if (url.pathname === "/sse") {
        await handleSseConnection(req, res);
        return;
      }
      break;
    case "POST":
      if (url.pathname === "/message") {
        await handleMessage(req, res, url);
        return;
      }
      break;
  }

  setCorsHeaders(res);
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "Not found" }));
});

export { httpServer };

export function startHttpServer() {
  const port = Number(process.env.PORT ?? 3000);
  httpServer.listen(port, "0.0.0.0", () => {
    console.log(`Streaming MCP HTTP server listening on port ${port}`);
    console.log(`SSE endpoint: /sse`);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startHttpServer();
}
