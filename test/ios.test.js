'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ios = require('../src/ios');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'forge-ios-'));
}

test('a GitHub remote is recognised in both URL forms', () => {
  const cases = [
    ['https://github.com/evanevoo/tare-mobile.git', 'evanevoo', 'tare-mobile'],
    ['https://github.com/evanevoo/tare-mobile', 'evanevoo', 'tare-mobile'],
    ['git@github.com:evanevoo/tare-mobile.git', 'evanevoo', 'tare-mobile'],
    ['ssh://git@github.com/Evan-Korial/Scanified.git', 'Evan-Korial', 'Scanified'],
  ];
  for (const [url, owner, repo] of cases) {
    assert.deepEqual(ios.parseRemoteUrl(url), { owner, repo }, url);
  }
  assert.equal(ios.parseRemoteUrl('https://gitlab.com/a/b.git'), null, 'only GitHub can run the workflow');
  assert.equal(ios.parseRemoteUrl(null), null);
});

test('origin wins over other remotes, and a non-GitHub origin falls through', () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.git', 'config'), [
    '[core]', '\tbare = false',
    '[remote "upstream"]', '\turl = https://github.com/someone/else.git',
    '[remote "origin"]', '\turl = git@github.com:evanevoo/tare-mobile.git',
  ].join('\n'));
  assert.deepEqual(ios.repoFromDir(dir), {
    owner: 'evanevoo', repo: 'tare-mobile', remote: 'origin', url: 'git@github.com:evanevoo/tare-mobile.git',
  });

  fs.writeFileSync(path.join(dir, '.git', 'config'), [
    '[remote "origin"]', '\turl = https://gitlab.com/evan/thing.git',
    '[remote "gh"]', '\turl = https://github.com/evanevoo/mirror.git',
  ].join('\n'));
  assert.equal(ios.repoFromDir(dir).owner, 'evanevoo', 'falls back to any GitHub remote');
  assert.equal(ios.repoFromDir(tmp()), null, 'a folder with no git config is not an error');
});

test('the bundle identifier is read from and written to app.json', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'app.json'),
    JSON.stringify({ expo: { name: 'Scanified', android: { package: 'com.evanevoo.scanifiedandroid' } } }, null, 2));

  assert.equal(ios.bundleId(dir), null, 'missing is missing — no guessing from the Android id');

  ios.setBundleId(dir, 'com.evanevoo.scanified');
  assert.equal(ios.bundleId(dir), 'com.evanevoo.scanified');

  const after = JSON.parse(fs.readFileSync(path.join(dir, 'app.json'), 'utf8'));
  assert.equal(after.expo.name, 'Scanified', 'the rest of app.json survives');
  assert.equal(after.expo.android.package, 'com.evanevoo.scanifiedandroid');

  for (const bad of ['noDots', 'com.evan/app', '', 'com evan app']) {
    assert.throws(() => ios.setBundleId(dir, bad), /bundle identifier/i, bad);
  }
});

test('GitHub failures are explained in terms of what to do next', () => {
  assert.match(ios.explainGithub(401, {}, '/x'), /expired|revoked|new fine-grained token/i);
  assert.match(ios.explainGithub(403, { message: 'Resource not accessible' }, '/x'), /Actions: read and write/);
  assert.match(ios.explainGithub(404, {}, '/repos/a/b/actions/workflows/ios-build.yml/dispatches'), /pushed|repository name/i);
  assert.match(ios.explainGithub(422, { message: 'No ref found' }, '/x'), /branch/i);
  assert.match(ios.explainGithub(500, { message: 'boom' }, '/x'), /500.*boom/);
});

test('the secret bundle names exactly what the workflow reads', () => {
  const rows = ios.secretBundle({ teamId: 'FA8UQ322NZ', certPassword: 'hunter22' });
  const names = rows.map((r) => r.name);
  assert.ok(names.includes('IOS_TEAM_ID'));
  assert.ok(names.includes('IOS_CERT_PASSWORD'));
  assert.ok(names.includes('KEYCHAIN_PASSWORD'), 'generated when not supplied');
  assert.equal(rows.find((r) => r.name === 'IOS_TEAM_ID').value, 'FA8UQ322NZ');

  // Cross-check against the workflow itself, so the two cannot drift apart.
  const wf = fs.readFileSync(path.join(__dirname, '..', 'templates', 'ios-build.yml'), 'utf8');
  for (const name of names) {
    assert.ok(wf.includes('secrets.' + name), name + ' is offered but the workflow never reads it');
  }
});

test('a generated keychain password is long and unpredictable', () => {
  const a = ios.randomPassword();
  const b = ios.randomPassword();
  assert.notEqual(a, b);
  assert.ok(a.length >= 30, 'got ' + a.length);
});

/* --------------------------------------------------------------------------
 * End-to-end certificate flow, with a stand-in for Apple's certificate
 * authority. This is the part that cannot be checked by reading the code: the
 * exact keytool incantation either produces a .p12 containing a private key
 * and a full chain, or it does not.
 * ------------------------------------------------------------------------ */
const { execFileSync } = require('child_process');

function have(cmd) {
  try { execFileSync('which', [cmd], { stdio: 'ignore' }); return true; } catch (_) { return false; }
}

test('CSR → Apple\'s reply → .p12, using a stand-in certificate authority',
  { skip: (have('keytool') && have('openssl')) ? false : 'needs keytool and openssl' },
  async () => {
    const home = tmp();
    const realHome = os.homedir;
    os.homedir = () => home;                       // credentialsDir() reads this
    try {
      const keytool = 'keytool';
      const PW = 'forge-test-pw';

      const csr = await ios.createCsr({ keytool, name: 'Evan Korial', email: 'e@example.com', country: 'CA', password: PW });
      assert.ok(fs.existsSync(csr.csr));
      assert.match(fs.readFileSync(csr.csr, 'utf8'), /BEGIN NEW CERTIFICATE REQUEST/);

      assert.rejects(() => ios.createCsr({ keytool, name: 'x', password: PW }),
        /already exists/, 'refuses to silently destroy an issued certificate');
      assert.rejects(() => ios.createCsr({ keytool, name: 'x', password: 'shrt', force: true }),
        /6 characters/);

      // Stand in for Apple: a root, an intermediate, and a leaf over our CSR.
      const d = ios.paths().dir;
      const sh = (c) => execFileSync('bash', ['-c', c], { cwd: d, stdio: 'pipe' });
      sh('openssl req -x509 -newkey rsa:2048 -nodes -keyout root.key -out root.crt -days 3650 -subj "/CN=Test Root"');
      sh('openssl req -newkey rsa:2048 -nodes -keyout int.key -out int.csr -subj "/CN=Test WWDR"');
      sh('openssl x509 -req -in int.csr -CA root.crt -CAkey root.key -set_serial 2 -days 3000 '
        + '-extfile <(echo "basicConstraints=critical,CA:TRUE") -out int.crt');
      sh('openssl x509 -req -in "' + csr.csr + '" -CA int.crt -CAkey int.key -set_serial 3 -days 365 -out leaf.pem');
      sh('openssl x509 -in leaf.pem -outform DER -out apple-reply.cer');
      // Pre-place them under the names installCertificate expects, so no
      // network call happens during the test.
      sh('openssl x509 -in root.crt -outform DER -out apple-root-g3.cer');
      sh('openssl x509 -in int.crt  -outform DER -out apple-wwdr-g3.cer');

      const lines = [];
      const res = await ios.installCertificate({
        keytool, cerPath: path.join(d, 'apple-reply.cer'), password: PW, onLine: (l) => lines.push(l),
      });
      assert.ok(fs.existsSync(res.p12), '.p12 was written');
      assert.ok(lines.some((l) => /using the copy already in/.test(l)), 'reused the local CA copies');

      // The whole point: a private key AND the chain, in one file.
      const dump = execFileSync('bash', ['-c',
        'openssl pkcs12 -in "' + res.p12 + '" -passin pass:' + PW + ' -nodes 2>/dev/null'], { encoding: 'utf8' });
      assert.match(dump, /BEGIN PRIVATE KEY/, 'the runner needs the private key');
      assert.equal((dump.match(/BEGIN CERTIFICATE/g) || []).length, 3, 'leaf + intermediate + root');

      const desc = await ios.describeCertificate({ keytool, password: PW });
      assert.equal(desc.ok, true);
      assert.match(desc.owner, /Evan Korial/);
      assert.equal(desc.issuedByApple, false, 'honest about a non-Apple issuer');

      // A certificate for somebody else's key must not be installable.
      sh('openssl req -newkey rsa:2048 -nodes -keyout other.key -out other.csr -subj "/CN=Someone Else"');
      sh('openssl x509 -req -in other.csr -CA int.crt -CAkey int.key -set_serial 4 -days 365 -outform DER -out other.cer');
      await assert.rejects(
        () => ios.installCertificate({ keytool, cerPath: path.join(d, 'other.cer'), password: PW }),
        /different key pair|refused/i);
    } finally {
      os.homedir = realHome;
    }
  });
