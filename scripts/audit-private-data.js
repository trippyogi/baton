#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const args = new Set(process.argv.slice(2));
const json = args.has('--json');

const blockedPathPatterns = [
  /^\.env$/,
  /^\.npmrc$/,
  /^data\/.+\.(db|sqlite)(-.+)?$/,
  /^local\//,
  /^baton-private\//,
  /^exports\/redacted-.*\.(json|md)$/,
  /(^|\/).*\.log$/,
];

const highSignalSecretPatterns = [
  { name: 'openai-style secret key', regex: /sk-[A-Za-z0-9_-]{20,}/ },
  { name: 'npm token', regex: /(?:^|\s|=)_authToken\s*=\s*npm_[A-Za-z0-9]{20,}/ },
  { name: 'GitHub classic token', regex: /ghp_[A-Za-z0-9_]{20,}/ },
  { name: 'GitHub fine-grained token', regex: /github_pat_[A-Za-z0-9_]{20,}/ },
  { name: 'Slack token', regex: /xox[baprs]-[A-Za-z0-9-]{20,}/ },
  { name: 'private key block', regex: /-----BEGIN (RSA |OPENSSH |EC |DSA )?PRIVATE KEY-----/ },
  { name: 'AWS access key', regex: /AKIA[0-9A-Z]{16}/ },
  { name: 'bearer token literal', regex: /Bearer [A-Za-z0-9._-]{20,}/ },
  { name: 'assigned secret-looking value', regex: /(?:api[_-]?key|token|secret|password|private[_-]?key|webhook[_-]?url)\s*[:=]\s*["'](?![A-Z0-9_]+(?:_ENV|_URL|_TOKEN|_SECRET)?["'])[A-Za-z0-9._:\/+=-]{16,}["']/i },
];

const privateTermPatterns = [
  { name: 'Jeremy-specific name', regex: /\bJeremy\b/i },
  { name: 'private username/repo marker', regex: /\btrippyogi\b/i },
  { name: 'private project marker', regex: /\bmetatravelers\b/i },
];

const privateTermAllowlist = [
  /^LICENSE$/,
  /^package(-lock)?\.json$/,
  /^README\.md$/,
  /^CONTRIBUTING\.md$/,
  /^docs\/specs\/private-local-use-boundary\.md$/,
  /^scripts\/audit-private-data\.js$/,
];

const fixtureSpecificityPatterns = [
  ...privateTermPatterns,
  { name: 'Windows absolute path', regex: /[A-Za-z]:\\Users\\/ },
  { name: 'Unix private absolute path', regex: /\/srv\/agentlab\/|\/home\/[^\s/]+\// },
  { name: 'raw external webhook URL', regex: /https?:\/\/(?!127\.0\.0\.1|localhost)[^\s"']+/i },
];

function runGit(args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  }
  return result.stdout.split('\n').filter(Boolean);
}

function rel(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function isBlockedTrackedPath(file) {
  return blockedPathPatterns.some(pattern => pattern.test(file));
}

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

function isProbablyText(file) {
  return /\.(js|json|md|yml|yaml|txt|env|example|gitignore|sql|css|html)$/i.test(file) || !path.extname(file);
}

function scanSecrets(files) {
  const findings = [];
  for (const file of files) {
    if (!isProbablyText(file)) continue;
    if (file.startsWith('node_modules/')) continue;
    let content;
    try { content = read(file); }
    catch (_) { continue; }
    for (const { name, regex } of highSignalSecretPatterns) {
      if (regex.test(content)) findings.push({ file, reason: name });
    }
  }
  return findings;
}

function scanPrivateTerms(files) {
  const findings = [];
  for (const file of files) {
    if (!isProbablyText(file)) continue;
    if (file.startsWith('node_modules/')) continue;
    if (privateTermAllowlist.some(pattern => pattern.test(file))) continue;
    let content;
    try { content = read(file); }
    catch (_) { continue; }
    for (const { name, regex } of privateTermPatterns) {
      if (regex.test(content)) findings.push({ file, reason: name });
    }
  }
  return findings;
}

function scanFixtures() {
  const findings = [];
  const fixtureDir = path.join(ROOT, 'scripts', 'fixtures');
  if (!fs.existsSync(fixtureDir)) return findings;
  const files = walk(fixtureDir).filter(file => file.endsWith('.json') || file.endsWith('.md'));
  for (const abs of files) {
    const file = rel(abs);
    const content = fs.readFileSync(abs, 'utf8');
    for (const { name, regex } of fixtureSpecificityPatterns) {
      if (regex.test(content)) findings.push({ file, reason: name });
    }
  }
  return findings;
}

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function checkRequiredDocs() {
  const required = ['SECURITY.md', 'CONTRIBUTING.md', 'docs/guides/private-local-use.md', 'package-lock.json'];
  return required.filter(file => !fs.existsSync(path.join(ROOT, file))).map(file => ({ file, reason: 'required file missing' }));
}

function main() {
  const tracked = runGit(['ls-files']);
  const staged = runGit(['diff', '--cached', '--name-only']);
  const blockedTracked = tracked.filter(isBlockedTrackedPath).map(file => ({ file, reason: 'blocked private path is tracked' }));
  const blockedStaged = staged.filter(isBlockedTrackedPath).map(file => ({ file, reason: 'blocked private path is staged' }));
  const secretFindings = scanSecrets(tracked);
  const privateTermFindings = scanPrivateTerms(tracked);
  const fixtureFindings = scanFixtures();
  const missingDocs = checkRequiredDocs();

  const checks = {
    tracked_blocked_paths: blockedTracked,
    staged_private_paths: blockedStaged,
    secret_patterns: secretFindings,
    private_terms: privateTermFindings,
    public_fixture_specificity: fixtureFindings,
    required_docs: missingDocs,
  };
  const failed = Object.values(checks).some(list => list.length > 0);

  if (json) {
    console.log(JSON.stringify({ ok: !failed, checks }, null, 2));
  } else {
    console.log('BATON private data audit');
    for (const [name, findings] of Object.entries(checks)) {
      console.log(`${name.replaceAll('_', ' ')}: ${findings.length ? 'fail' : 'ok'}`);
      for (const finding of findings) console.log(`- ${finding.file}: ${finding.reason}`);
    }
    console.log(`\nresult: ${failed ? 'fail' : 'pass'}`);
  }
  if (failed) process.exit(1);
}

main();
