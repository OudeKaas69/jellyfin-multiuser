#!/usr/bin/env node

/**
 * Static analysis, ES5 compatibility, and package metadata verifier for Jellyfin WebOS.
 * Runs in CI (.forgejo/workflows/build.yml) and locally via `npm test`.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

let failures = 0;

function pass(msg) {
  console.log(`  [PASS] ${msg}`);
}

function fail(msg) {
  console.error(`  [FAIL] ${msg}`);
  failures++;
}

function readText(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

function readJson(relPath) {
  try {
    return JSON.parse(readText(relPath));
  } catch (err) {
    fail(`${relPath}: invalid JSON (${err.message})`);
    return null;
  }
}

console.log('=== 1. JSON & Package Metadata Validation ===');
const pkg = readJson('package.json');
const appinfo = readJson('frontend/appinfo.json');
const svcPkg = readJson('services/package.json');
const svcJson = readJson('services/services.json');

if (pkg && appinfo && svcPkg && svcJson) {
  if (pkg.version === appinfo.version) {
    pass(`Version aligned across package.json and frontend/appinfo.json (${pkg.version})`);
  } else {
    fail(`Version mismatch: package.json (${pkg.version}) !== frontend/appinfo.json (${appinfo.version})`);
  }

  if (pkg.name === appinfo.id) {
    pass(`Package ID aligned across package.json and frontend/appinfo.json (${appinfo.id})`);
  } else {
    fail(`Package ID mismatch: package.json (${pkg.name}) !== frontend/appinfo.json (${appinfo.id})`);
  }

  const expectedSvcId = `${appinfo.id}.service`;
  if (svcPkg.name === expectedSvcId && svcJson.id === expectedSvcId) {
    pass(`Service ID prefix matches app ID (${expectedSvcId})`);
  } else {
    fail(`Service ID must be "${expectedSvcId}" (got services/package.json="${svcPkg.name}", services/services.json="${svcJson.id}")`);
  }
}

console.log('\n=== 2. Line Endings (LF) Check ===');
const lfFiles = [
  'package.json',
  'frontend/appinfo.json',
  'frontend/index.html',
  'frontend/css/profiles.css',
  'frontend/js/index.js',
  'frontend/js/profiles.js',
  'tools/gen-manifest.js',
  'tools/sync-version.js',
  'tools/upstream-check.sh',
  'tools/verify-code.js',
  '.forgejo/workflows/build.yml',
  '.forgejo/workflows/upstream-check.yml',
];

for (const rel of lfFiles) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) continue;
  const content = fs.readFileSync(full, 'utf8');
  if (content.includes('\r')) {
    fail(`${rel}: contains CRLF (\\r) line endings`);
  } else {
    pass(`${rel}: clean LF line endings`);
  }
}

console.log('\n=== 3. JavaScript Syntax & Security Pattern Check ===');
const frontendJsFiles = [
  'frontend/js/ajax.js',
  'frontend/js/storage.js',
  'frontend/js/webOS.js',
  'frontend/js/index.js',
  'frontend/js/profiles.js',
];

const allJsFiles = [
  ...frontendJsFiles,
  'services/service.js',
  'tools/gen-manifest.js',
  'tools/sync-version.js',
  'tools/verify-code.js',
];

for (const rel of allJsFiles) {
  const code = readText(rel);
  try {
    new vm.Script(code, { filename: rel });
    pass(`${rel}: valid JS syntax`);
  } catch (err) {
    fail(`${rel}: syntax error (${err.message})`);
  }
}

for (const rel of frontendJsFiles) {
  const code = readText(rel);
  if (/\beval\s*\(|\bnew\s+Function\s*\(/.test(code)) {
    fail(`${rel}: forbidden eval() or new Function() detected`);
  } else {
    pass(`${rel}: no eval() or new Function()`);
  }
}

console.log('\n=== 4. Strict ES5 Compatibility Check (Frontend + Injected Scripts) ===');
const tmpDir = fs.mkdtempSync('/tmp/jf-verify-');
try {
  // Extract dynamically generated iframe scripts from frontend/js/index.js
  const indexCode = readText('frontend/js/index.js');
  const sandbox = {
    window: { addEventListener: function () {} },
    document: { addEventListener: function () {}, querySelector: function () { return null; } },
    webOS: {
      deviceInfo: function () {},
      fetchAppInfo: function () {},
      platformBack: function () {},
      service: { request: function () { return { cancel: function () {} }; } },
    },
    storage: { get: function () {}, set: function () {}, exists: function () { return false; } },
    ajax: { request: function () {} },
    profiles: {
      currentServer: {
        id: '52700477c4ac42898d10033606056ac6',
        Id: '52700477c4ac42898d10033606056ac6',
        baseurl: 'http://192.168.1.122:8096',
        Name: "Tim's Jellyfin",
      },
    },
    console: console,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval,
  };

  vm.createContext(sandbox);
  vm.runInContext(indexCode, sandbox, { filename: 'frontend/js/index.js' });

  // Simulate authenticated user state to test credential clear & injection scripts
  vm.runInContext(
    'authenticatedUser = { Id: "df3a7ea8e3e94dbbaad654fd19fd62d6", Name: "tsas\\"test" }; authToken = "tok_123456";',
    sandbox
  );

  const generatedScripts = {
    'generated:getCredentialClearScript': sandbox.getCredentialClearScript(),
    'generated:getCredentialInjectionScript': sandbox.getCredentialInjectionScript(),
    'generated:getSwitchUserInjectionScript': sandbox.getSwitchUserInjectionScript(),
  };

  const filesToCheckEs5 = frontendJsFiles.map((f) => path.join(ROOT, f));

  for (const [label, scriptText] of Object.entries(generatedScripts)) {
    if (!scriptText || typeof scriptText !== 'string') {
      fail(`${label}: did not return a non-empty script string`);
      continue;
    }
    const outPath = path.join(tmpDir, `${label.replace(/[^a-zA-Z0-9_-]/g, '_')}.js`);
    fs.writeFileSync(outPath, scriptText, 'utf8');
    filesToCheckEs5.push(outPath);
  }

  try {
    execFileSync('npx', ['--yes', 'acorn@8', '--ecma5', '--silent', ...filesToCheckEs5], {
      cwd: ROOT,
      stdio: 'pipe',
    });
    for (const rel of frontendJsFiles) {
      pass(`${rel}: strict ES5 AST verified (acorn --ecma5)`);
    }
    for (const label of Object.keys(generatedScripts)) {
      pass(`${label}: strict ES5 AST verified (acorn --ecma5)`);
    }
  } catch (err) {
    const stderr = err.stderr ? err.stderr.toString() : err.message;
    fail(`ES5 AST check failed:\n${stderr}`);
  }
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\nVerification FAILED with ${failures} error(s).`);
  process.exit(1);
} else {
  console.log('\nAll verification checks passed!');
}
