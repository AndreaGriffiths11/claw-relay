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

    // #18: Auth timeout — don't wait forever for relay to respond
    const authTimeout = setTimeout(() => {
      rejectConn(new Error("Auth timeout — relay did not respond within 30s"));
      ws.close();
    }, 30_000);

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
        clearTimeout(authTimeout);
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

server.tool("browser_navigate", "Navigate the browser to a URL. Use this to open any webpage. Returns confirmation when navigation completes.", { url: z.string() }, async ({ url }) => {
  const result = await sendAction({ type: "navigate", url });
  return { content: [{ type: "text", text: result.data || "Navigated" }] };
});

server.tool("browser_click", "Click an element on the page. Requires a ref from browser_snapshot (e.g. 'e5'). Call browser_snapshot first to find the ref.", { ref: z.string() }, async ({ ref }) => {
  const result = await sendAction({ type: "click", ref });
  return { content: [{ type: "text", text: result.data || "Clicked" }] };
});

server.tool("browser_type", "Type text into an input element (appends to existing text). Requires a ref from browser_snapshot.", { ref: z.string(), text: z.string() }, async ({ ref, text }) => {
  const result = await sendAction({ type: "type", ref, text });
  return { content: [{ type: "text", text: result.data || "Typed" }] };
});

server.tool("browser_fill", "Fill an input element, replacing any existing content. Requires a ref from browser_snapshot.", { ref: z.string(), text: z.string() }, async ({ ref, text }) => {
  const result = await sendAction({ type: "fill", ref, text });
  return { content: [{ type: "text", text: result.data || "Filled" }] };
});

server.tool("browser_press", "Press a keyboard key (e.g. 'Enter', 'Tab', 'Escape', 'ArrowDown'). Use after typing to submit forms.", { key: z.string() }, async ({ key }) => {
  const result = await sendAction({ type: "press", key });
  return { content: [{ type: "text", text: result.data || "Pressed" }] };
});

server.tool("browser_snapshot", "Get the accessibility tree of the current page. Returns element refs (e.g. e1, e5) that you use with click, type, fill, and other tools. ALWAYS call this first to understand the page structure.", {}, async () => {
  const result = await sendAction({ type: "snapshot" });
  return { content: [{ type: "text", text: result.data || "No snapshot data" }] };
});

server.tool("browser_screenshot", "Take a PNG screenshot of the current page. Returns the image. Use browser_snapshot instead if you need to interact with elements.", {}, async () => {
  const result = await sendAction({ type: "screenshot" });
  // If data looks like base64 image, return as image content
  if (result.data && result.data.length > 200 && !result.data.includes(" ")) {
    return {
      content: [{ type: "image", data: result.data, mimeType: "image/png" }],
    };
  }
  return { content: [{ type: "text", text: result.data || "No screenshot data" }] };
});

server.tool("browser_hover", "Hover over an element by ref. Triggers hover menus and tooltips.", { ref: z.string() }, async ({ ref }) => {
  const result = await sendAction({ type: "hover", ref });
  return { content: [{ type: "text", text: result.data || "Hovered" }] };
});

server.tool("browser_select", "Select options from a dropdown element by ref and values.", { ref: z.string(), values: z.array(z.string()) }, async ({ ref, values }) => {
  const result = await sendAction({ type: "select", ref, values });
  return { content: [{ type: "text", text: result.data || "Selected" }] };
});

server.tool("browser_evaluate", "Run JavaScript code in the browser page. Returns the result. Use sparingly — prefer snapshot and click for most tasks.", { js: z.string() }, async ({ js }) => {
  const result = await sendAction({ type: "evaluate", js });
  return { content: [{ type: "text", text: result.data || "Evaluated" }] };
});

server.tool("browser_close", "Close the current browser tab.", {}, async () => {
  const result = await sendAction({ type: "close" });
  return { content: [{ type: "text", text: result.data || "Closed" }] };
});

server.tool("browser_drag", "Drag an element from one location to another. Requires start and end refs from browser_snapshot.", { startRef: z.string(), endRef: z.string() }, async ({ startRef, endRef }) => {
  const result = await sendAction({ type: "drag", startRef, endRef });
  return { content: [{ type: "text", text: result.data || "Dragged" }] };
});

server.tool("browser_scroll_into_view", "Scroll an element into view. Requires a ref from browser_snapshot.", { ref: z.string() }, async ({ ref }) => {
  const result = await sendAction({ type: "scrollIntoView", ref });
  return { content: [{ type: "text", text: result.data || "Scrolled into view" }] };
});

server.tool("browser_wait", "Wait for a condition to be met. Supports: text, textGone, selector, url, loadState (networkidle|domcontentloaded|load), or a custom JS function.", { timeMs: z.number().optional(), text: z.string().optional(), textGone: z.string().optional(), selector: z.string().optional(), url: z.string().optional(), loadState: z.enum(["networkidle", "domcontentloaded", "load"]).optional(), fn: z.string().optional(), timeoutMs: z.number().optional() }, async (params) => {
  const result = await sendAction({ type: "wait", ...params });
  return { content: [{ type: "text", text: result.data || "Condition met" }] };
});

server.tool("browser_console", "Get console messages from the page. Optional level filter (log|warning|error). Set clear=true to clear the log.", { level: z.enum(["log", "warning", "error"]).optional(), clear: z.boolean().optional() }, async (params) => {
  const result = await sendAction({ type: "console", ...params });
  return { content: [{ type: "text", text: result.data || "No console messages" }] };
});

server.tool("browser_network", "Get network requests from the page. Optional filter for request type (xhr|fetch|document|image|etc). Set clear=true to clear the log.", { filter: z.string().optional(), clear: z.boolean().optional() }, async (params) => {
  const result = await sendAction({ type: "network", ...params });
  return { content: [{ type: "text", text: result.data || "No network requests" }] };
});

server.tool("browser_pdf", "Generate a PDF of the current page. Returns the PDF as base64.", {}, async () => {
  const result = await sendAction({ type: "pdf" });
  return { content: [{ type: "text", text: result.data || "PDF generated" }] };
});

server.tool("browser_resize", "Resize the browser viewport to a specific width and height in pixels.", { width: z.number(), height: z.number() }, async ({ width, height }) => {
  const result = await sendAction({ type: "resize", width, height });
  return { content: [{ type: "text", text: result.data || "Resized" }] };
});

server.tool("browser_batch", "Execute multiple actions in sequence. Stops on first error if stopOnError is true.", { actions: z.array(z.record(z.any())), stopOnError: z.boolean().optional() }, async ({ actions, stopOnError }) => {
  const result = await sendAction({ type: "batch", actions, stopOnError });
  return { content: [{ type: "text", text: result.data || "Batch executed" }] };
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
