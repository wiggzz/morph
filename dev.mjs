#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(process.env.MORPH_DATA || path.join(root, '.data'));
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const tokenPath = path.join(dataDir, 'pairing-token');
if (!fs.existsSync(tokenPath)) fs.writeFileSync(tokenPath, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
const env = {
  ...process.env, MORPH_DATA: dataDir,
  EXPO_PUBLIC_MORPH_TOKEN: fs.readFileSync(tokenPath, 'utf8').trim(),
  REACT_NATIVE_PACKAGER_HOSTNAME: '127.0.0.1', EXPO_NO_TELEMETRY: '1',
};
if (process.argv.includes('--reuse-pi-auth')) {
  env.MORPH_AUTH_PATH = path.join(os.homedir(), '.pi/agent/auth.json');
  console.log('Using your existing Pi credential store by explicit request. OAuth refresh can update that file.');
}
console.log('\nMorph Lab · local Android playground');
console.log('Open in Expo Go SDK 54: exp://127.0.0.1:8081');
console.log('Chat sign-in and model selection are in the app’s Control room.');
console.log('Keep this process alive while using the app. Ctrl+C stops both services.\n');
const children = [
  spawn(process.execPath, ['src/index.mjs'], { cwd: path.join(root, 'server'), env, stdio: 'inherit' }),
  spawn(process.execPath, ['node_modules/expo/bin/cli', 'start', '--localhost', '--port', '8081', ...(process.argv.includes('--clear') ? ['--clear'] : [])], { cwd: path.join(root, 'mobile'), env, stdio: 'inherit' }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 500);
}
for (const child of children) {
  child.on('error', error => { console.error(error); stop(1); });
  child.on('exit', code => { if (!stopping) stop(code || 0); });
}
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
