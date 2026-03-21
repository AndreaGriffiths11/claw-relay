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
  console.error("Missing CLAW_RELAY_URL or CLAW_RELAY_TOKEN env vars");
  process.exit(1);
}

// --- WebSocket connection to Claw Relay ---
let ws;
let requestId = 0;
const pending = new Map(); // id -> { resolve, reject, timer }
let authenticated = false;
let authPromise;

function connect() {
  return new Promise((resolveConn, rejectConn) => {
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
          resolveConn();
        } else {
          rejectConn(new Error("Auth failed"));
        }
        return;
      }

      // Route result/error to the single pending request
      // The relay protocol doesn't use request IDs, so we resolve the oldest pending
      if (msg.type === "result" || msg.type === "error") {
        const first = pending.entries().next().value;
        if (first) {
          const [id, { resolve, reject, timer }] = first;
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
    });
  });
}

function sendRaw(msg) {
  ws.send(JSON.stringify(msg));
}

function sendAction(action) {
  return new Promise((resolve, reject) => {
    if (!authenticated) {
      reject(new Error("Not authenticated to Claw Relay"));
      return;
    }
    const id = ++requestId;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("Timeout waiting for relay response (30s)"));
    }, 30000);
    pending.set(id, { resolve, reject, timer });
    sendRaw(action);
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

// --- Start ---
async function main() {
  await connect();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err.message);
  process.exit(1);
});
