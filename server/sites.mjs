// Which WordPress sites the user has as MCP connections, read from the Claude config.
import fs from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const DEFAULT_CONFIG = process.env.AGENT_FLOOR_CLAUDE_CONFIG || join(homedir(), '.claude.json');

const titleCase = (s) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

export function roomNameFor(serverName) {
  const base = serverName.replace(/-(elementor|mcp-adapter-default-server|mcp)$/, '');
  return titleCase(base.split('-').filter(Boolean).join(' '));
}

function serverPairs(config) {
  const blocks = [config.mcpServers, ...Object.values(config.projects ?? {}).map((p) => p?.mcpServers)];
  const pairs = [];
  for (const block of blocks) {
    for (const [name, server] of Object.entries(block ?? {})) {
      if (typeof server?.url === 'string') pairs.push({ name, url: server.url });
    }
  }
  return pairs;
}

export function readSites(configPath) {
  let pairs;
  try {
    // Only {name, url} leave this scope; headers and tokens are dropped with the parsed object.
    pairs = serverPairs(JSON.parse(fs.readFileSync(configPath, 'utf8')));
  } catch {
    return null;
  }
  const byHost = new Map();
  for (const { name, url } of pairs) {
    if (!url.includes('/wp-json/')) continue;
    let host;
    try {
      host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    } catch {
      continue;
    }
    const site = byHost.get(host) ?? { id: host, host, name: '', servers: [] };
    if (!site.servers.includes(name)) site.servers.push(name);
    const room = roomNameFor(name);
    if (!site.name || room.length < site.name.length) site.name = room;
    byHost.set(host, site);
  }
  return [...byHost.values()];
}

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hostPattern = (host) =>
  new RegExp(`(?<![a-z0-9.-])(?:www\\.)?${escape(host)}(?=[/:'"\`\\s]|$)`, 'i');

function strings(value, out = [], depth = 0) {
  if (typeof value === 'string') out.push(value);
  else if (value && typeof value === 'object' && depth < 50) for (const v of Object.values(value)) strings(v, out, depth + 1);
  return out;
}

export function siteForPayload(sites, toolName, toolInput) {
  const server = /^mcp__(.+?)__/.exec(toolName ?? '')?.[1];
  const byServer = server && sites.find((s) => s.servers.includes(server));
  if (byServer) return byServer;
  const texts = strings(toolInput);
  for (const site of sites) {
    const re = hostPattern(site.host);
    if (texts.some((t) => re.test(t))) return site;
  }
  return null;
}

export function watchSites(configPath, onChange, intervalMs = 30000) {
  let last;
  const check = () => {
    const sites = readSites(configPath);
    if (!sites) return; // keep the last list on a missing or half-written file
    const key = JSON.stringify(sites);
    if (key === last) return;
    last = key;
    onChange(sites);
  };
  check();
  const timer = setInterval(check, intervalMs);
  return () => clearInterval(timer);
}
