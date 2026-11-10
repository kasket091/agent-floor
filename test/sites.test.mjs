import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { readSites, roomNameFor, siteForPayload, watchSites } from '../server/sites.mjs';

const SECRET = 'Basic ZmFrZTpmYWtlLXRva2Vu';
const tmp = () => fs.mkdtempSync(join(os.tmpdir(), 'af-sites-'));
const writeConfig = (obj) => {
  const path = join(tmp(), 'claude.json');
  fs.writeFileSync(path, typeof obj === 'string' ? obj : JSON.stringify(obj));
  return path;
};
const fixture = {
  mcpServers: {
    figma: { type: 'http', url: 'https://mcp.figma.com/mcp' },
    'penrith-plastering-and-gyprock-elementor': {
      type: 'http',
      url: 'https://www.penrithplastering.com.au/wp-json/elementor/mcp/',
      headers: { Authorization: SECRET },
    },
  },
  projects: {
    '/x': {
      mcpServers: {
        'sydney-app-development-developers-elementor': {
          type: 'http',
          url: 'https://SydneyAppDevelopers.com.au/wp-json/elementor/mcp/',
        },
      },
    },
  },
};

test('roomNameFor strips the MCP suffix and title-cases', () => {
  assert.equal(roomNameFor('penrith-plastering-and-gyprock-elementor'), 'Penrith Plastering And Gyprock');
  assert.equal(roomNameFor('penrith-mcp'), 'Penrith');
  assert.equal(roomNameFor('penrith-mcp-adapter-default-server'), 'Penrith');
});

test('readSites keeps website servers only, with no headers', () => {
  const sites = readSites(writeConfig(fixture));
  assert.equal(sites.length, 2);
  assert.deepEqual(sites.map((s) => s.host).sort(), ['penrithplastering.com.au', 'sydneyappdevelopers.com.au']);
  const penrith = sites.find((s) => s.host === 'penrithplastering.com.au');
  assert.deepEqual(penrith, {
    id: 'penrithplastering.com.au',
    host: 'penrithplastering.com.au',
    name: 'Penrith Plastering And Gyprock',
    servers: ['penrith-plastering-and-gyprock-elementor'],
  });
  const json = JSON.stringify(sites);
  assert.ok(!json.includes('Authorization'));
  assert.ok(!json.includes(SECRET));
});

test('two servers on one host give one site named by the shortest room name', () => {
  const sites = readSites(writeConfig({
    mcpServers: {
      'penrith-plastering-and-gyprock-elementor': { url: 'https://www.penrithplastering.com.au/wp-json/elementor/mcp/' },
      'penrith-mcp-adapter-default-server': { url: 'https://penrithplastering.com.au/wp-json/mcp/mcp-adapter-default-server' },
    },
  }));
  assert.equal(sites.length, 1);
  assert.deepEqual(sites[0].servers.sort(), ['penrith-mcp-adapter-default-server', 'penrith-plastering-and-gyprock-elementor']);
  assert.equal(sites[0].name, 'Penrith');
});

test('missing or invalid config returns null', () => {
  assert.equal(readSites(join(tmp(), 'nope.json')), null);
  assert.equal(readSites(writeConfig('{"mcpServers": {')), null);
});

test('siteForPayload by MCP tool name', () => {
  const sites = readSites(writeConfig(fixture));
  assert.equal(siteForPayload(sites, 'mcp__penrith-plastering-and-gyprock-elementor__elementor-get-page-structure').host, 'penrithplastering.com.au');
  assert.equal(siteForPayload(sites, 'mcp__figma__get_metadata'), null);
});

test('siteForPayload by host in tool input, nested too', () => {
  const sites = readSites(writeConfig(fixture));
  const penrith = 'penrithplastering.com.au';
  assert.equal(siteForPayload(sites, 'Bash', { command: 'curl -s https://penrithplastering.com.au/wp-json/wp/v2/pages' }).host, penrith);
  assert.equal(siteForPayload(sites, 'X', { a: [{ b: ['see https://www.penrithplastering.com.au'] }] }).host, penrith);
  assert.equal(siteForPayload(sites, 'Bash', { command: 'ls' }), null);
  assert.equal(siteForPayload(sites, 'Read'), null);
});

test('host match does not hit a longer host that ends with it', () => {
  const sites = [
    { id: 'site.com.au', host: 'site.com.au', name: 'Site', servers: ['site-elementor'] },
    { id: 'mysite.com.au', host: 'mysite.com.au', name: 'Mysite', servers: ['mysite-elementor'] },
  ];
  assert.equal(siteForPayload(sites, 'Bash', { command: 'curl https://mysite.com.au/x' }).host, 'mysite.com.au');
  assert.equal(siteForPayload(sites, 'Bash', { command: 'curl https://site.com.au/x' }).host, 'site.com.au');
  assert.equal(siteForPayload(sites, 'Bash', { command: 'curl https://site.com.au.evil.com/x' }), null);
});

test('watchSites reports at start and on change only', async () => {
  const path = writeConfig(fixture);
  const calls = [];
  const stop = watchSites(path, (s) => calls.push(s), 20);
  try {
    assert.equal(calls.length, 1);
    assert.equal(calls[0].length, 2);
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(calls.length, 1, 'unchanged list must not re-fire');
    fs.writeFileSync(path, JSON.stringify({ mcpServers: fixture.mcpServers }));
    await new Promise((r) => setTimeout(r, 80));
    assert.equal(calls.length, 2);
    assert.equal(calls[1].length, 1);
  } finally {
    stop();
  }
});
