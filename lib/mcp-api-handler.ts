import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { IncomingHttpHeaders, IncomingMessage, ServerResponse } from "http";
import { Socket } from "net";
import { Readable } from "stream";
import { ServerOptions } from "@modelcontextprotocol/sdk/server/index.js";
import { maxDuration } from "@/app/sse/route";

interface SerializedRequest {
  requestId: string;
  url: string;
  method: string;
  body: string;
  headers: IncomingHttpHeaders;
}

// Simple in-memory store for requests and responses
const requestStore = new Map<string, SerializedRequest>();
const responseStore = new Map<string, { status: number; body: string }>();
const activeTransports = new Map<string, SSEServerTransport>();

export function initializeMcpApiHandler(
  initializeServer: (server: McpServer) => void,
  serverOptions: ServerOptions = {}
) {
  let servers: McpServer[] = [];

  const handleMessage = async (message: string, transport: SSEServerTransport) => {
    console.log("Received message", message);
    const request = JSON.parse(message) as SerializedRequest;

    const req = createFakeIncomingMessage({
      method: request.method,
      url: request.url,
      headers: request.headers,
      body: request.body,
    });
    const syntheticRes = new ServerResponse(req);
    let status = 100;
    let body = "";
    syntheticRes.writeHead = (statusCode: number) => {
      status = statusCode;
      return syntheticRes;
    };
    syntheticRes.end = (b: unknown) => {
      body = b as string;
      return syntheticRes;
    };
    await transport.handlePostMessage(req, syntheticRes);

    responseStore.set(`${transport.sessionId}:${request.requestId}`, {
      status,
      body,
    });
  };

  return async function mcpApiHandler(req: Request, res: ServerResponse) {
    const url = new URL(req.url || "", "https://example.com");
    if (url.pathname === "/sse") {
      console.log("Got new SSE connection");

      const transport = new SSEServerTransport("/message", res);
      const sessionId = transport.sessionId;
      activeTransports.set(sessionId, transport);

      const server = new McpServer(
        {
          name: "mcp-typescript server",
          version: "0.1.0",
        },
        serverOptions
      );
      initializeServer(server);

      servers.push(server);

      server.server.onclose = () => {
        console.log("SSE connection closed");
        servers = servers.filter((s) => s !== server);
        activeTransports.delete(sessionId);
      };

      let logs: {
        type: "log" | "error";
        messages: string[];
      }[] = [];

      function logInContext(severity: "log" | "error", ...messages: string[]) {
        logs.push({
          type: severity,
          messages,
        });
      }

      const interval = setInterval(() => {
        for (const log of logs) {
          console[log.type].call(console, ...log.messages);
        }
        logs = [];
      }, 100);

      let timeout: NodeJS.Timeout;
      let resolveTimeout: (value: unknown) => void;
      const waitPromise = new Promise((resolve) => {
        resolveTimeout = resolve;
        timeout = setTimeout(() => {
          resolve("max duration reached");
        }, (maxDuration - 5) * 1000);
      });

      async function cleanup() {
        clearTimeout(timeout);
        clearInterval(interval);
        activeTransports.delete(sessionId);
        console.log("Done");
        res.statusCode = 200;
        res.end();
      }
      req.signal.addEventListener("abort", () =>
        resolveTimeout("client hang up")
      );

      await server.connect(transport);
      const closeReason = await waitPromise;
      console.log(closeReason);
      await cleanup();
    } else if (url.pathname === "/message") {
      console.log("Received message");

      const body = await req.text();

      const sessionId = url.searchParams.get("sessionId") || "";
      if (!sessionId) {
        res.statusCode = 400;
        res.end("No sessionId provided");
        return;
      }
      const requestId = crypto.randomUUID();
      const serializedRequest: SerializedRequest = {
        requestId,
        url: req.url || "",
        method: req.method || "",
        body: body,
        headers: Object.fromEntries(req.headers.entries()),
      };

      requestStore.set(`${sessionId}:${requestId}`, serializedRequest);

      // Process the request
      const transport = activeTransports.get(sessionId);
      if (!transport) {
        res.statusCode = 400;
        res.end("No active SSE connection");
        return;
      }
      await handleMessage(JSON.stringify(serializedRequest), transport);

      // Wait for response
      const response = responseStore.get(`${sessionId}:${requestId}`);
      if (response) {
        res.statusCode = response.status;
        res.end(response.body);
        responseStore.delete(`${sessionId}:${requestId}`);
      } else {
        res.statusCode = 408;
        res.end("Request timed out");
      }
    } else {
      res.statusCode = 404;
      res.end("Not found");
    }
  };
}

// Define the options interface
interface FakeIncomingMessageOptions {
  method?: string;
  url?: string;
  headers?: IncomingHttpHeaders;
  body?: string | Buffer | Record<string, any> | null;
  socket?: Socket;
}

// Create a fake IncomingMessage
function createFakeIncomingMessage(
  options: FakeIncomingMessageOptions = {}
): IncomingMessage {
  const {
    method = "GET",
    url = "/",
    headers = {},
    body = null,
    socket = new Socket(),
  } = options;

  // Create a readable stream that will be used as the base for IncomingMessage
  const readable = new Readable();
  readable._read = (): void => {}; // Required implementation

  // Add the body content if provided
  if (body) {
    if (typeof body === "string") {
      readable.push(body);
    } else if (Buffer.isBuffer(body)) {
      readable.push(body);
    } else {
      readable.push(JSON.stringify(body));
    }
    readable.push(null); // Signal the end of the stream
  }

  // Create the IncomingMessage instance
  const req = new IncomingMessage(socket);

  // Set the properties
  req.method = method;
  req.url = url;
  req.headers = headers;

  // Copy over the stream methods
  req.push = readable.push.bind(readable);
  req.read = readable.read.bind(readable);
  // @ts-expect-error
  req.on = readable.on.bind(readable);
  req.pipe = readable.pipe.bind(readable);

  return req;
}
