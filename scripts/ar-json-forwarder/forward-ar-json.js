#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');

const DEFAULT_INTERVAL_MS = 60 * 1000;
const DEFAULT_MIN_SUMMARY_COUNT = 50;
const DEFAULT_TIMEOUT_MS = 30 * 1000;
const args = process.argv.slice(2);
const mode = args.includes('--watch') ? 'watch' : 'once';
const filePath = process.env.AR_JSON_PATH || '';
const statePath = process.env.AR_SYNC_STATE_PATH || path.join(__dirname, 'sync-state.json');
const endpoint = process.env.AR_SYNC_ENDPOINT || '';
const token = process.env.AR_SYNC_TOKEN || '';
const intervalMs = Number(process.env.AR_SYNC_INTERVAL_MS || DEFAULT_INTERVAL_MS);
const minSummaryCount = Number(process.env.AR_MIN_SUMMARY_COUNT || DEFAULT_MIN_SUMMARY_COUNT);
const timeoutMs = Number(process.env.AR_SYNC_TIMEOUT_MS || DEFAULT_TIMEOUT_MS);

function log(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function warn(message) {
  console.warn(`[${new Date().toISOString()}] ${message}`);
}

function getMinSummaryCount() {
  return Number.isFinite(minSummaryCount) && minSummaryCount > 0 ? minSummaryCount : DEFAULT_MIN_SUMMARY_COUNT;
}

function getTimeoutMs() {
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
}

function normalizeText(value) {
  return String(value === null || value === undefined ? '' : value).trim();
}

function normalizeCode(value) {
  return normalizeText(value).replace(/\.0$/, '');
}

function normalizeTotalArHours(value) {
  if (value === null || value === undefined || String(value).trim() === '') return NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function normalizeRecordCount(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  } catch (err) {
    return {};
  }
}

function writeState(state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
}

function buildStableHashPayload(uploadPayload) {
  const syncMode = resolveSyncMode(uploadPayload);
  const summaries = (uploadPayload.summaries || []).map(s => ({
    employeeName: normalizeText(s.employeeName),
    sapOrderNo: normalizeCode(s.sapOrderNo),
    itemNo: normalizeCode(s.itemNo),
    totalArHours: Number(s.totalArHours || 0),
    recordCount: Number(s.recordCount || 0)
  })).sort((a, b) => {
    return `${a.employeeName}#${a.sapOrderNo}#${a.itemNo}`.localeCompare(
      `${b.employeeName}#${b.sapOrderNo}#${b.itemNo}`
    );
  });

  return { syncMode, summaries };
}

function hashPayload(uploadPayload) {
  return crypto.createHash('sha256').update(JSON.stringify(buildStableHashPayload(uploadPayload))).digest('hex');
}

function parseOriginalJson(buffer) {
  try {
    return JSON.parse(buffer.toString('utf8'));
  } catch (err) {
    warn(`JSON parse failed, skip this run. The OneDrive file may still be syncing. error=${err.message}`);
    return null;
  }
}

function buildUploadPayload(original) {
  if (!original || typeof original !== 'object') {
    throw new Error('Invalid AR JSON: root must be an object.');
  }
  if (!Array.isArray(original.summaries)) {
    throw new Error('Invalid AR JSON: original.summaries must be an array.');
  }

  const summaries = original.summaries.map(summary => Object.assign({}, summary, {
    sapOrderNo: normalizeCode(summary && summary.sapOrderNo),
    itemNo: normalizeCode(summary && summary.itemNo),
    employeeName: normalizeText(summary && summary.employeeName),
    totalArHours: normalizeTotalArHours(summary && summary.totalArHours),
    recordCount: normalizeRecordCount(summary && summary.recordCount)
  }));

  const payload = {
    source: original.source || 'power-automate-office-script',
    runTime: original.runTime || '',
    recordCount: 0,
    summaryCount: summaries.length,
    records: [],
    summaries
  };
  if (original.syncMode) payload.syncMode = original.syncMode;
  if (original.fullSnapshot === true) payload.fullSnapshot = true;
  return payload;
}

function validateUploadPayload(uploadPayload) {
  if (!uploadPayload || !Array.isArray(uploadPayload.summaries)) {
    throw new Error('Invalid AR JSON: summaries must be an array.');
  }

  const invalid = [];
  uploadPayload.summaries.forEach((summary, index) => {
    const errors = [];
    if (!normalizeCode(summary && summary.sapOrderNo)) errors.push('sapOrderNo is required');
    if (!normalizeText(summary && summary.employeeName)) errors.push('employeeName is required');
    if (!Number.isFinite(Number(summary && summary.totalArHours))) errors.push('totalArHours must be a finite number');
    if (errors.length) invalid.push(`summary[${index}]: ${errors.join(', ')}`);
  });

  if (invalid.length) {
    throw new Error(`Invalid AR JSON summaries, skip upload to avoid partial bad data. ${invalid.slice(0, 5).join('; ')}${invalid.length > 5 ? `; ... ${invalid.length - 5} more` : ''}`);
  }
}

function resolveSyncMode(payload) {
  if (payload && payload.syncMode === 'fullSnapshot') return 'fullSnapshot';
  if (payload && payload.fullSnapshot === true) return 'fullSnapshot';
  return 'incremental';
}

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    let target;
    try {
      target = new URL(url);
    } catch (err) {
      reject(new Error(`Invalid AR_SYNC_ENDPOINT: ${err.message}`));
      return;
    }

    const data = Buffer.from(JSON.stringify(body));
    const client = target.protocol === 'https:' ? https : http;
    const requestTimeoutMs = getTimeoutMs();
    const req = client.request({
      method: 'POST',
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      path: `${target.pathname}${target.search}`,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length,
        'x-ar-sync-token': token
      }
    }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({ statusCode: res.statusCode, body: text });
      });
    });
    req.setTimeout(requestTimeoutMs, () => {
      req.destroy(new Error(`AR sync request timed out after ${requestTimeoutMs}ms.`));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function syncOnce() {
  log(`AR_JSON_PATH=${filePath || '(missing)'}`);
  if (!filePath) throw new Error('AR_JSON_PATH 未配置。');
  if (!endpoint) throw new Error('AR_SYNC_ENDPOINT 未配置。');
  if (!token) throw new Error('AR_SYNC_TOKEN 未配置。');
  if (!fs.existsSync(filePath)) throw new Error(`AR_JSON_PATH 不存在：${filePath}`);

  const buffer = fs.readFileSync(filePath);
  const original = parseOriginalJson(buffer);
  if (!original) return;

  const uploadPayload = buildUploadPayload(original);
  validateUploadPayload(uploadPayload);
  const syncMode = resolveSyncMode(uploadPayload);
  const minCount = getMinSummaryCount();
  log(`summaries=${uploadPayload.summaryCount}, syncMode=${syncMode}, minSummaryCount=${minCount}.`);
  if (syncMode === 'fullSnapshot' && uploadPayload.summaryCount === 0) {
    warn('summaries.length is 0, skip upload to avoid wiping CloudBase with an abnormal snapshot.');
    return;
  }
  if (syncMode === 'fullSnapshot' && uploadPayload.summaryCount < minCount) {
    warn(`summaries.length ${uploadPayload.summaryCount} is below AR_MIN_SUMMARY_COUNT ${minCount}, skip upload.`);
    return;
  }

  const payloadHash = hashPayload(uploadPayload);
  const state = readState();
  if (state.lastHash === payloadHash) {
    log('summaries-only hash unchanged, skip upload=true.');
    return;
  }
  log('summaries-only hash unchanged, skip upload=false.');

  const res = await postJson(endpoint, uploadPayload);
  log(`HTTP status=${res.statusCode}.`);
  log(`CloudBase response=${res.body || '(empty)'}`);

  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new Error(`Upload failed, HTTP ${res.statusCode}. State hash not updated.`);
  }

  const nextState = {
    lastHash: payloadHash,
    lastSyncAt: new Date().toISOString(),
    lastStatusCode: res.statusCode,
    sourceFile: filePath,
    syncMode,
    summaryCount: uploadPayload.summaryCount
  };
  writeState(nextState);
  log('upload success, sync-state.json updated.');
}

async function loop() {
  try {
    await syncOnce();
  } catch (err) {
    console.error(`[${new Date().toISOString()}] AR sync failed: ${err.message}`);
  }
  if (mode === 'watch') setTimeout(loop, Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : DEFAULT_INTERVAL_MS);
}

if (require.main === module) {
  loop();
}

module.exports = {
  buildStableHashPayload,
  buildUploadPayload,
  hashPayload,
  normalizeCode,
  normalizeText,
  resolveSyncMode,
  validateUploadPayload
};
