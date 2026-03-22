#!/usr/bin/env node
// claw-relay-mcp.js — MCP server that bridges any MCP client to Claw Relay
// Stdio transport, connects to Claw Relay WebSocket on startup.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import WebSocket from "ws";

// --- Config from env ---
const RELAY_URL = process.env.CLAW_RELAY_URL;
const RELAY_TOKEN = process.env.CLAW_RELAY_TOKEN;
const RELAY_AGENT = process.env.CLAW_RELAY_AGENT || "copilot";

if (!RELAY_URL || !RELAY_TOKEN) {
  const msg = "Error: Missing required environment variables.\n" +
    "Please set CLAW_RELAY_URL and CLAW_RELAY_TOKEN before running.\n" +
    "Example:\n" +
    '  CLAW_RELAY_URL=ws://localhost:9333 CLAW_RELAY_TOKEN=your-token node mcp/claw-relay-mcp.js\n';
  console.log(msg);
  console.error("Missing CLAW_RELAY_URL or CLAW_RELAY_TOKEN env vars");
  process.exit(1);
}

// --- WebSocket connection to Claw Relay ---
let ws;
let requestId = 0;
const pending = new Map(); // id -> { resolve, reject, timer }
let authenticated = false;
let authPromise;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30000;

let connectPromise;

function connect() {
  connectPromise = new Promise((resolveConn, rejectConn) => {
    ws = new WebSocket(RELAY_URL);

    ws.on("open", () => {
      // Authenticate immediately
      authPromise = sendRaw({
        type: "auth",
        token: RELAY_TOKEN,
        agent_id: RELAY_AGENT,
      });
    });

    ws.on("message", (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }

      // Handle ping from server
      if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
        return;
      }

      // Auth response
      if (msg.type === "result" && msg.action === "auth") {
        if (msg.ok) {
          authenticated = true;
          reconnectDelay = 1000;
          resolveConn();
        } else {
          rejectConn(new Error("Auth failed"));
        }
        return;
      }

      // Route result/error to the matching request by ID
      if (msg.type === "result" || msg.type === "error") {
        const reqId = msg.request_id;
        const entry = reqId ? pending.get(reqId) : undefined;
        // Fallback to FIFO if no request_id (backwards compat)
        const fallback = !entry ? pending.entries().next().value : undefined;
        const matched = entry ? [reqId, entry] : fallback;
        if (matched) {
          const [id, { resolve, reject, timer }] = matched;
          clearTimeout(timer);
          pending.delete(id);
          if (msg.type === "error") {
            reject(new Error(`${msg.code}: ${msg.message}`));
          } else {
            resolve(msg);
          }
        }
      }
    });

    ws.on("error", (err) => {
      console.error("WebSocket error:", err.message);
    });

    ws.on("close", (code, reason) => {
      authenticated = false;
      // Reject all pending
      for (const [id, { reject, timer }] of pending) {
        clearTimeout(timer);
        reject(new Error(`WebSocket closed (${code})`));
      }
      pending.clear();
      // Auto-reconnect with exponential backoff (unless auth failed)
      if (code !== 4001) {
        console.error(`Relay connection lost (code ${code}). Reconnecting in ${reconnectDelay / 1000}s...`);
        setTimeout(() => connect(), reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
      }
    });
  });
}

function sendRaw(msg) {
  ws.send(JSON.stringify(msg));
}

function sendAction(action) {
  return new Promise(async (resolve, reject) => {
    // Wait for connection if still pending
    if (!authenticated && connectPromise) {
      try {
        await connectPromise;
      } catch (err) {
        reject(new Error("Not connected to Claw Relay"));
        return;
      }
    }
    if (!authenticated) {
      reject(new Error("Not authenticated to Claw Relay"));
      return;
    }
    const id = ++requestId;
    const reqIdStr = `mcp-${id}`;
    const timer = setTimeout(() => {
      pending.delete(reqIdStr);
      reject(new Error("Timeout waiting for relay response (30s)"));
    }, 30000);
    pending.set(reqIdStr, { resolve, reject, timer });
    sendRaw({ ...action, request_id: reqIdStr });
  });
}

// --- MCP Server ---
const server = new McpServer({
  name: "claw-relay",
  version: "1.0.0",
});

server.tool("browser_navigate", "Navigate browser to a URL", { url: z.string() }, async ({ url }) => {
  const result = await sendAction({ type: "navigate", url });
  return { content: [{ type: "text", text: result.data || "Navigated" }] };
});

server.tool("browser_click", "Click an element by ref", { ref: z.string() }, async ({ ref }) => {
  const result = await sendAction({ type: "click", ref });
  return { content: [{ type: "text", text: result.data || "Clicked" }] };
});

server.tool("browser_type", "Type text into an element (appends)", { ref: z.string(), text: z.string() }, async ({ ref, text }) => {
  const result = await sendAction({ type: "type", ref, text });
  return { content: [{ type: "text", text: result.data || "Typed" }] };
});

server.tool("browser_fill", "Fill an input element (replaces content)", { ref: z.string(), text: z.string() }, async ({ ref, text }) => {
  const result = await sendAction({ type: "fill", ref, text });
  return { content: [{ type: "text", text: result.data || "Filled" }] };
});

server.tool("browser_press", "Press a key (Enter, Tab, etc.)", { key: z.string() }, async ({ key }) => {
  const result = await sendAction({ type: "press", key });
  return { content: [{ type: "text", text: result.data || "Pressed" }] };
});

server.tool("browser_snapshot", "Get accessibility tree of current page", {}, async () => {
  const result = await sendAction({ type: "snapshot" });
  return { content: [{ type: "text", text: result.data || "No snapshot data" }] };
});

server.tool("browser_screenshot", "Take a screenshot of the current page", {}, async () => {
  const result = await sendAction({ type: "screenshot" });
  // If data looks like base64 image, return as image content
  if (result.data && result.data.length > 200 && !result.data.includes(" ")) {
    return {
      content: [{ type: "image", data: result.data, mimeType: "image/png" }],
    };
  }
  return { content: [{ type: "text", text: result.data || "No screenshot data" }] };
});

server.tool("browser_hover", "Hover over an element by ref", { ref: z.string() }, async ({ ref }) => {
  const result = await sendAction({ type: "hover", ref });
  return { content: [{ type: "text", text: result.data || "Hovered" }] };
});

server.tool("browser_select", "Select an option from a dropdown by ref and values", { ref: z.string(), values: z.array(z.string()) }, async ({ ref, values }) => {
  const result = await sendAction({ type: "select", ref, values });
  return { content: [{ type: "text", text: result.data || "Selected" }] };
});

server.tool("browser_evaluate", "Run JavaScript in the browser page", { js: z.string() }, async ({ js }) => {
  const result = await sendAction({ type: "evaluate", js });
  return { content: [{ type: "text", text: result.data || "Evaluated" }] };
});

server.tool("browser_close", "Close the current browser tab", {}, async () => {
  const result = await sendAction({ type: "close" });
  return { content: [{ type: "text", text: result.data || "Closed" }] };
});

// --- Start ---
async function main() {
  // Start stdio transport FIRST so Copilot CLI sees the MCP server immediately
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Then connect to the relay in the background
  connect();
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
