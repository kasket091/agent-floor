import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redact, redactDeep, MASK } from '../server/redact.mjs';

const hides = (input, secret) => {
  const out = redact(input);
  assert.ok(!out.includes(secret), `still shows ${secret}: ${out}`);
  assert.ok(out.includes(MASK), `no mask in: ${out}`);
  return out;
};

test('MASK is the bullet placeholder', () => assert.equal(MASK, '•••'));

test('Authorization header', () => {
  const out = hides('curl -H "Authorization: Bearer abc.def.ghi" https://x.com', 'abc.def');
  assert.ok(out.includes('Authorization: •••'));
  assert.ok(out.includes('https://x.com'));
});

test('Proxy-Authorization header', () => {
  hides('Proxy-Authorization: Basic dXNlcjpwYXNz', 'dXNlcjpwYXNz');
});

test('curl -u and --user', () => {
  hides('curl -u admin:s3cret https://x.com', 's3cret');
  hides('curl --user admin:s3cret https://x.com', 's3cret');
});

test('URL userinfo keeps the host', () => {
  const out = hides('https://admin:s3cret@site.com/wp-json', 's3cret');
  assert.ok(out.includes('site.com/wp-json'));
});

test('key/value pairs', () => {
  hides('password=hunter2', 'hunter2');
  hides('{"token": "abc123"}', 'abc123');
  hides('api_key: xyz', 'xyz');
  hides('apikey=xyz', 'xyz');
  hides('secret=xyz', 'xyz');
  hides('auth=xyz', 'xyz');
  hides('key=xyz', 'xyz');
});

test('env assignments', () => {
  hides('export WP_APP_PASSWORD=abcd', 'abcd');
  hides('GITHUB_TOKEN=abcd node x.js', 'abcd');
});

test('token shapes', () => {
  for (const t of [
    'ghp_' + 'a'.repeat(36),
    'gho_' + 'b'.repeat(36),
    'github_pat_' + 'c'.repeat(40),
    'sk-ant-api03-' + 'd'.repeat(40),
    'sk-' + 'e'.repeat(24),
    'xoxb-1234567890-' + 'f'.repeat(20),
    'AKIA' + 'G'.repeat(16),
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl',
  ]) hides(`using ${t} now`, t.slice(4, 20));
});

test('WordPress application password', () => {
  hides('pass is abcd EFGH 1234 ijkl MNOP 5678 ok', 'abcd EFGH 1234');
});

test('no false positives', () => {
  for (const s of [
    'npm run build',
    'python3 tools/site.py push',
    'Reading SKILL.md',
    'git commit -m "fix key handling"',
    'will need more time with this',
  ]) assert.equal(redact(s), s);
});

test('non-strings are returned unchanged', () => {
  assert.equal(redact(5), 5);
  assert.equal(redact(null), null);
});

test('long Bearer header keeps the URL', () => {
  const out = redact('curl -H "Authorization: Bearer ' + 'x'.repeat(80) + '" https://a.com');
  assert.ok(out.includes('Authorization: •••'));
  assert.ok(out.includes('https://a.com'));
  assert.ok(!out.includes('xxxx'));
});

test('redactDeep masks nested strings and keeps other values', () => {
  const out = redactDeep({ a: 'password=x', b: ['ghp_' + 'a'.repeat(36)], c: 5 });
  assert.ok(!out.a.includes('=x') && out.a.includes(MASK));
  assert.ok(!out.b[0].includes('ghp_') && out.b[0].includes(MASK));
  assert.equal(out.c, 5);
});

test('redactDeep clips after redacting', () => {
  assert.ok(redactDeep({ s: 'y'.repeat(5000) + ' password=x' }, 2000).s.length <= 2000);
  const out = redactDeep({ s: 'y'.repeat(1990) + ' ghp_' + 'a'.repeat(36) }, 2000).s;
  assert.ok(out.length <= 2000);
  assert.ok(!out.includes('ghp_') && !out.includes('a'));
});
