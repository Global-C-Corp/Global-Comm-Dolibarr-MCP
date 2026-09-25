import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { once } from 'node:events';
import process from 'node:process';
import test from 'node:test';
import { URL } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

process.env.DOLIBARR_URL = 'https://example.invalid';
process.env.DOLIBARR_API_KEY = 'local-test-placeholder';

const { createServer } = await import('../build/server.js');
const { DolibarrAPI } = await import('../build/api.js');

async function connectedPair(t) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const server = createServer();
  const client = new Client({ name: 'baseline-test', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  t.after(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

test('MCP advertises a unique, read-only baseline and the package version', async t => {
  const client = await connectedPair(t);
  const { tools } = await client.listTools();
  const names = tools.map(tool => tool.name);
  const metadata = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

  assert.equal(names.length, 20);
  assert.equal(new Set(names).size, names.length);
  assert.equal(client.getServerVersion().name, metadata.name);
  assert.equal(client.getServerVersion().version, metadata.version);
  assert.ok(names.includes('list_invoices'));
  assert.ok(names.includes('get_project'));
  assert.equal(tools.find(tool => tool.name === 'list_thirdparties').inputSchema.properties.sqlfilters, undefined);
  assert.equal(tools.find(tool => tool.name === 'list_thirdparties').inputSchema.properties.sortfield, undefined);
  for (const prohibited of ['set_setup_value', 'add_bank_transaction', 'add_payment_to_invoice', 'create_project', 'generate_document_pdf']) {
    assert.ok(!names.includes(prohibited), `${prohibited} must not be advertised`);
  }
});

test('direct tools/call rejects writes without reaching the Dolibarr adapter', async t => {
  const originalPost = DolibarrAPI.prototype.post;
  let posted = false;
  DolibarrAPI.prototype.post = async () => { posted = true; throw new Error('unexpected write'); };
  t.after(() => { DolibarrAPI.prototype.post = originalPost; });

  const client = await connectedPair(t);
  const rejected = await client.callTool({
    name: 'set_setup_value',
    arguments: { constant: 'LOCAL_TEST_ONLY', value: '1' },
  });
  assert.equal(rejected.isError, true);
  assert.match(rejected.content[0].text, /unavailable in read-only baseline/);
  assert.equal(posted, false);
});

test('direct calls reject raw filters and nonnumeric URL identifiers before ERP access', async t => {
  const originalGet = DolibarrAPI.prototype.get;
  let called = false;
  DolibarrAPI.prototype.get = async () => { called = true; throw new Error('unexpected read'); };
  t.after(() => { DolibarrAPI.prototype.get = originalGet; });

  const client = await connectedPair(t);
  const cases = [
    { name: 'list_thirdparties', arguments: { sqlfilters: '(t.nom:like:anything)' } },
    { name: 'get_thirdparty', arguments: { id: '../setup/conf' } },
  ];
  for (const request of cases) {
    const result = await client.callTool(request);
    assert.equal(result.isError, true);
  }
  assert.equal(called, false);
});

test('an allowed read still uses the original Dolibarr endpoint and pagination', async t => {
  const originalGet = DolibarrAPI.prototype.get;
  const calls = [];
  DolibarrAPI.prototype.get = async (endpoint, params) => {
    calls.push({ endpoint, params });
    return [{ id: 7, name: 'Fixture client' }];
  };
  t.after(() => { DolibarrAPI.prototype.get = originalGet; });

  const client = await connectedPair(t);
  const result = await client.callTool({ name: 'list_thirdparties', arguments: { limit: 2 } });
  assert.equal(result.isError, undefined);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].endpoint, '/thirdparties');
  assert.equal(calls[0].params.limit, 2);
  assert.match(result.content[0].text, /Fixture client/);
});

test('HTTP transport exits before listening when authentication is missing', async () => {
  const child = spawn(process.execPath, ['build/http.js'], {
    env: {
      ...process.env,
      MCP_API_TOKEN: '',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', chunk => { stderr += chunk; });
  const [code] = await once(child, 'exit');
  assert.equal(code, 1);
  assert.match(stderr, /MCP_API_TOKEN is required/);
});
