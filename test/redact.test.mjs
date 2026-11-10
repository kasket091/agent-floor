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
  ]) assert.equal(redact(s), s);
});

test('six 4-letter words count as an app password (hiding too much is the safer side)', () => {
  assert.equal(redact('will need more time with this'), MASK);
});

test('letters-only WordPress application password', () => {
  hides('abcd EFGH ijkl MNOP qrst UVWX', 'abcd EFGH');
});

test('Authorization in JSON and JS object form', () => {
  const tok = 'x'.repeat(40);
  for (const s of [
    `{"Authorization": "Bearer ${tok}"}`,
    `{headers: {Authorization: 'Bearer ${tok}'}}`,
    `{"Authorization": "Basic dXNlcjpwYXNz"}`,
  ]) {
    const out = hides(s, s.includes('Basic') ? 'dXNlcjpwYXNz' : tok);
    assert.ok(!out.includes('Bearer') && !out.includes('Basic'), out);
  }
});

test('quoted values with spaces are masked to the closing quote', () => {
  assert.equal(redact('password: "hunter two" next'), `password: "${MASK}" next`);
  assert.equal(redact('export TOKEN="abc def ghi" && go'), `export TOKEN="${MASK}" && go`);
  assert.equal(redact("secret='a b c'"), `secret='${MASK}'`);
});

test('no quadratic backtracking on long dash runs', () => {
  const t = performance.now();
  redact('a-'.repeat(25000));
  assert.ok(performance.now() - t < 100, `took ${performance.now() - t} ms`);
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

test('curl -u with a quoted WordPress application password hides every group', () => {
  const app = 'abcd efgh ijkl mnop qrst uvwx';
  for (const s of [
    `curl -u "admin:${app}" https://x.com`,
    `curl --user 'admin:${app}' https://x.com`,
    `curl -u admin:"${app}" https://x.com`,
    `curl --user="admin:${app}" https://x.com`,
  ]) {
    const out = redact(s);
    for (const g of app.split(' ')) assert.ok(!out.includes(g), `still shows ${g}: ${out}`);
    assert.ok(out.includes('https://x.com'), out);
  }
});

test('curl -u quoted and glued forms', () => {
  assert.equal(redact('curl -u "admin:s3cret pass" https://x.com'), `curl -u "admin:${MASK}" https://x.com`);
  assert.equal(redact("curl --user 'admin:s3cret' https://x.com"), `curl --user 'admin:${MASK}' https://x.com`);
  hides('curl -uadmin:s3cret https://x.com', 's3cret');
});

test('pass keys: user_pass, dbpass, WP_PASS', () => {
  hides('wp user update 1 --user_pass=hunter2secret', 'hunter2secret');
  hides('wp config create --dbname=wp --dbuser=root --dbpass=hunter2secret', 'hunter2secret');
  hides('WP_PASS=hunter2secret wp core install', 'hunter2secret');
  hides('passwd: hunter2secret', 'hunter2secret');
});

test('pass key: no false positives on ordinary words', () => {
  for (const s of ['npm run build', 'all tests pass', 'passing the ball', 'bypass the cache', 'compass rose']) {
    assert.equal(redact(s), s);
  }
});
