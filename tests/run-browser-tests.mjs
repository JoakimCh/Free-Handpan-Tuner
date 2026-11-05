// Dependency-free automation of the same test page a player can open manually.
// Chrome's debugging pipe stays local to this process and needs no open port.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createStaticServer } from '../tools/serve.mjs';

const server = createStaticServer();

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const profile = await mkdtemp(join(tmpdir(), 'handpan-tests-'));
const chrome = spawn(process.env.CHROME_BIN || 'google-chrome', [
  '--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  '--remote-debugging-pipe', `--user-data-dir=${profile}`, 'about:blank',
  '--autoplay-policy=no-user-gesture-required', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });

let sequence = 0;
let incoming = '';
let diagnostics = '';
const pending = new Map();
function failPending(error) {
  for (const entry of pending.values()) {
    clearTimeout(entry.timeout);
    entry.reject(error);
  }
  pending.clear();
}
chrome.on('error', error => failPending(error));
const closed = new Promise(resolve => chrome.on('close', code => {
  failPending(new Error(`Chrome exited (${code}). ${diagnostics}`));
  resolve();
}));
chrome.stderr.on('data', data => { diagnostics = (diagnostics + data).slice(-4000); });
chrome.stdio[3].on('error', error => failPending(error));
chrome.stdio[4].setEncoding('utf8');
chrome.stdio[4].on('data', data => {
  incoming += data;
  let boundary;
  while ((boundary = incoming.indexOf('\0')) !== -1) {
    const message = JSON.parse(incoming.slice(0, boundary));
    incoming = incoming.slice(boundary + 1);
    const entry = pending.get(message.id);
    if (!entry) continue;
    pending.delete(message.id);
    clearTimeout(entry.timeout);
    if (message.error) entry.reject(new Error(message.error.message));
    else entry.resolve(message.result);
  }
});

function command(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timed out. ${diagnostics}`));
    }, 60000);
    pending.set(id, { resolve, reject, timeout });
    chrome.stdio[3].write(JSON.stringify({ id, method, params, sessionId }) + '\0');
  });
}

try {
  const browser = await command('Browser.getVersion');
  console.log(`Browser ${browser.product}`);
  const { targetId } = await command('Target.createTarget', {
    url: `http://127.0.0.1:${server.address().port}/tests/index.html?autorun`,
  });
  const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
  const deadline = Date.now() + 180000;
  let report;
  while (Date.now() < deadline) {
    const { result, exceptionDetails } = await command('Runtime.evaluate', {
      expression: `({status: document.documentElement?.dataset.testStatus, text: document.body?.innerText})`,
      returnByValue: true,
    }, sessionId);
    if (exceptionDetails) throw new Error(exceptionDetails.text);
    report = result.value;
    if (report.status === 'passed' || report.status === 'failed') break;
    await delay(250);
  }
  console.log(report?.text);
  if (report?.status !== 'passed') process.exitCode = 1;
  if (report?.status === 'passed') {
    await command('Network.enable', {}, sessionId);
    await command('Network.emulateNetworkConditions', {
      offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0,
    }, sessionId);
    await command('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/index.html#library` }, sessionId);
    let offline;
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      const { result } = await command('Runtime.evaluate', {
        expression: `({ready: document.documentElement?.dataset.appReady, title: document.querySelector('h1')?.textContent, error: document.querySelector('#error')?.hidden === false})`,
        returnByValue: true,
      }, sessionId);
      offline = result.value;
      if (offline.ready === 'true' && offline.title === 'Handpans') break;
      await delay(100);
    }
    if (offline?.ready !== 'true' || offline.error) throw new Error(`Offline reopen failed ${JSON.stringify(offline)}`);
    console.log('PASS · App reopens with the network disabled');
    await command('Network.emulateNetworkConditions', {
      offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1,
    }, sessionId);
    if (process.env.HANDPAN_SCREENSHOTS === '1') {
      await command('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/index.html#listen` }, sessionId);
      await delay(500);
      for (const [label, width, height] of [['desktop', 1440, 1000], ['phone', 390, 844]]) {
        await command('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width < 640 }, sessionId);
        await delay(100);
        const screenshot = await command('Page.captureScreenshot', { format: 'png' }, sessionId);
        console.log(`SCREENSHOT_${label} ${screenshot.data}`);
      }
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  chrome.kill();
  await closed;
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
