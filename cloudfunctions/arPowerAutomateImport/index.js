const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const arSummaries = db.collection('ar_summaries');
const arImportLogs = db.collection('ar_import_logs');

const DEFAULT_MIN_SUMMARY_COUNT = 50;

function normalizeText(value) {
  return String(value === null || value === undefined ? '' : value).trim();
}

function normalizeCode(value) {
  return normalizeText(value).replace(/\.0$/, '');
}

function normalizeNumberOrBlank(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' && value.trim() === '') return '';
  const n = Number(value);
  return Number.isFinite(n) ? n : '';
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function getMinSummaryCount() {
  const configured = Number(process.env.AR_MIN_SUMMARY_COUNT || DEFAULT_MIN_SUMMARY_COUNT);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MIN_SUMMARY_COUNT;
}

function resolveSyncMode(payload) {
  const mode = normalizeText(payload && payload.syncMode);
  if (mode === 'fullSnapshot' || (payload && payload.fullSnapshot === true)) return 'fullSnapshot';
  return 'incremental';
}

function buildImportId() {
  return `AR_${Date.now()}_${Math.floor(Math.random() * 1000000)}`;
}

function getHeaders(event) {
  return (event && (event.headers || event.header || event.httpHeaders)) || {};
}

function getHeader(headers, name) {
  const target = String(name || '').toLowerCase();
  const key = Object.keys(headers || {}).find(item => String(item).toLowerCase() === target);
  return key ? headers[key] : '';
}

function parsePayload(event) {
  let body;

  if (event && event.body !== undefined) {
    body = event.body;
  } else if (event && event.rawBody !== undefined) {
    body = event.rawBody;
  } else {
    body = event;
  }

  if (Buffer.isBuffer(body)) body = body.toString('utf8');
  if (event && event.isBase64Encoded && typeof body === 'string') {
    body = Buffer.from(body, 'base64').toString('utf8');
  }

  if (typeof body === 'string') {
    const text = body.trim();
    return text ? JSON.parse(text) : {};
  }
  if (body && typeof body === 'object') return body;
  return {};
}

function buildSummaryKey(summary) {
  return `${normalizeCode(summary.sapOrderNo)}#${normalizeCode(summary.itemNo)}#${normalizeText(summary.employeeName)}`;
}

function cleanSummary(input, source, now, importId) {
  const row = input || {};
  const sapOrderNo = normalizeCode(row.sapOrderNo || row.sapOrderNumber || row.sapNo || row['SAP Order No.']);
  const itemNo = normalizeCode(row.itemNo) || (sapOrderNo.indexOf('7') === 0 ? '1000' : '');
  const employeeName = normalizeText(row.employeeName || row.sheetName);
  const summary = {
    source,
    sheetName: normalizeText(row.sheetName) || employeeName,
    employeeName,
    sapOrderNo,
    itemNo,
    totalArHours: normalizeNumberOrBlank(row.totalArHours),
    recordCount: normalizeNumberOrBlank(row.recordCount),
    active: true,
    inactiveAt: '',
    inactiveReason: '',
    lastImportId: importId,
    importBatchId: importId,
    lastSyncAt: now,
    importedAt: now,
    updatedAt: now
  };
  summary.summaryKey = buildSummaryKey(summary);
  return summary;
}

function isValidSummary(summary) {
  return !!(
    summary &&
    summary.sapOrderNo &&
    summary.sapOrderNo.indexOf('7') === 0 &&
    summary.itemNo &&
    summary.employeeName &&
    summary.summaryKey &&
    summary.totalArHours !== ''
  );
}

async function findExistingSummary(summary) {
  const byKey = await arSummaries.where({ summaryKey: summary.summaryKey }).limit(1).get();
  if (byKey.data && byKey.data.length) return byKey.data[0];

  const byBusinessKey = await arSummaries.where({
    sapOrderNo: summary.sapOrderNo,
    itemNo: summary.itemNo,
    employeeName: summary.employeeName
  }).limit(1).get();
  return byBusinessKey.data && byBusinessKey.data.length ? byBusinessKey.data[0] : null;
}

async function upsertSummary(summary, now) {
  const existing = await findExistingSummary(summary);
  if (existing && existing._id) {
    await arSummaries.doc(existing._id).update({ data: summary });
    return { inserted: 0, updated: 1 };
  }

  await arSummaries.add({ data: Object.assign({}, summary, { createdAt: now }) });
  return { inserted: 1, updated: 0 };
}

async function fetchAll(collection, query) {
  const pageSize = 100;
  let rows = [];
  let skip = 0;
  while (true) {
    const res = await collection.where(query || {}).skip(skip).limit(pageSize).get();
    const batch = res.data || [];
    rows = rows.concat(batch);
    if (batch.length < pageSize) break;
    skip += batch.length;
  }
  return rows;
}

async function markInactiveMissingSummaries(activeKeys, now, importId) {
  const keyMap = {};
  (activeKeys || []).forEach(key => { if (key) keyMap[key] = true; });
  const rows = await fetchAll(arSummaries, { active: true });
  let inactiveMarked = 0;
  for (const row of rows) {
    const key = normalizeText(row.summaryKey) || buildSummaryKey(row);
    if (!row || !row._id || keyMap[key]) continue;
    await arSummaries.doc(row._id).update({
      data: {
        active: false,
        inactiveAt: now,
      inactiveReason: 'not_in_latest_full_snapshot',
      lastImportId: importId,
      importBatchId: importId,
      updatedAt: now
      }
    });
    inactiveMarked += 1;
  }
  return inactiveMarked;
}

async function writeImportLog(data) {
  await arImportLogs.add({
    data: {
      importId: normalizeText(data.importId),
      importedAt: data.importedAt,
      source: normalizeText(data.source),
      runTime: normalizeText(data.runTime),
      syncMode: normalizeText(data.syncMode) || 'incremental',
      importBatchId: normalizeText(data.importId),
      fullSnapshot: !!data.fullSnapshot,
      summaryCount: toNumber(data.summaryCount),
      inserted: toNumber(data.inserted),
      updated: toNumber(data.updated),
      skipped: toNumber(data.skipped),
      failCount: toNumber(data.failCount),
      inactiveMarked: toNumber(data.inactiveMarked),
      status: normalizeText(data.status),
      errorMessage: normalizeText(data.errorMessage),
      errorDetails: Array.isArray(data.errorDetails) ? data.errorDetails.slice(0, 50) : []
    }
  });
}

function response(body, statusCode) {
  return Object.assign({ statusCode: statusCode || 200 }, body || {});
}

exports.main = async (event) => {
  const importId = buildImportId();
  const importedAt = db.serverDate();
  let payload = {};
  let source = 'power-automate-office-script';
  let syncMode = 'incremental';
  let fullSnapshot = false;
  let summaryCount = 0;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let failCount = 0;
  let inactiveMarked = 0;
  const errorDetails = [];

  try {
    const expectedToken = process.env.AR_SYNC_TOKEN || '';
    const providedToken = normalizeText(getHeader(getHeaders(event), 'x-ar-sync-token') || (event && event.xArSyncToken));
    if (!expectedToken) throw new Error('AR_SYNC_TOKEN 未配置。');
    if (providedToken !== expectedToken) {
      await writeImportLog({
        importId,
        importedAt,
        source,
        runTime: '',
        syncMode,
        fullSnapshot,
        summaryCount,
        inserted,
        updated,
        skipped,
        failCount,
        inactiveMarked,
        status: 'failed',
        errorMessage: 'AR sync token 校验失败。',
        errorDetails
      }).catch(err => console.warn('写入 AR 导入日志失败：', err));
      return response({ ok: false, message: 'AR sync token 校验失败。' }, 401);
    }

    payload = parsePayload(event);
    source = normalizeText(payload.source) || source;
    syncMode = resolveSyncMode(payload);
    fullSnapshot = syncMode === 'fullSnapshot';
    const records = Array.isArray(payload.records) ? payload.records : [];
    if (!Array.isArray(payload.summaries)) throw new Error('Invalid payload: summaries must be an array.');
    const rawSummaries = payload.summaries;
    summaryCount = rawSummaries.length;
    console.log('[AR Import] records:', records.length, 'summaries:', summaryCount, 'syncMode:', syncMode, 'fullSnapshot:', fullSnapshot);

    const minSummaryCount = getMinSummaryCount();
    if (fullSnapshot && (summaryCount === 0 || summaryCount < minSummaryCount)) {
      skipped = summaryCount;
      const message = `summaryCount ${summaryCount} is below minimum ${minSummaryCount}; skipped import.`;
      await writeImportLog({
        importId,
        importedAt,
        source,
        runTime: normalizeText(payload.runTime),
        syncMode,
        fullSnapshot,
        summaryCount,
        inserted,
        updated,
        skipped,
        failCount,
        inactiveMarked,
        status: 'skipped',
        errorMessage: message,
        errorDetails
      });
      return response({ ok: false, summaryCount, inserted, updated, skipped, inactiveMarked, message }, 400);
    }

    const seen = {};
    const activeKeys = [];
    const validSummaries = [];
    for (const raw of rawSummaries) {
      const summary = cleanSummary(raw, source, importedAt, importId);
      if (!isValidSummary(summary)) {
        skipped += 1;
        console.warn('[AR Import] skipped invalid/non-project summary:', raw);
        continue;
      }
      if (seen[summary.summaryKey]) {
        skipped += 1;
        console.warn('[AR Import] skipped duplicate summary key:', summary.summaryKey);
        continue;
      }
      seen[summary.summaryKey] = true;
      activeKeys.push(summary.summaryKey);
      validSummaries.push(summary);
    }

    if (fullSnapshot && (skipped > 0 || activeKeys.length < minSummaryCount)) {
      const message = skipped > 0
        ? `fullSnapshot contains ${skipped} invalid or duplicate summaries; skipped import.`
        : `valid summaryCount ${activeKeys.length} is below minimum ${minSummaryCount}; skipped import.`;
      await writeImportLog({
        importId,
        importedAt,
        source,
        runTime: normalizeText(payload.runTime),
        syncMode,
        fullSnapshot,
        summaryCount,
        inserted,
        updated,
        skipped,
        failCount,
        inactiveMarked,
        status: 'skipped',
        errorMessage: message,
        errorDetails
      });
      return response({ ok: false, summaryCount, inserted, updated, skipped, inactiveMarked, message }, 400);
    }

    for (const summary of validSummaries) {
      try {
        const result = await upsertSummary(summary, importedAt);
        inserted += result.inserted;
        updated += result.updated;
      } catch (err) {
        failCount += 1;
        errorDetails.push({
          summaryKey: summary.summaryKey,
          sapOrderNo: summary.sapOrderNo,
          itemNo: summary.itemNo,
          employeeName: summary.employeeName,
          message: err.message || 'upsert failed'
        });
      }
    }

    if (!failCount && fullSnapshot && activeKeys.length >= minSummaryCount) {
      inactiveMarked = await markInactiveMissingSummaries(activeKeys, importedAt, importId);
    }
    await writeImportLog({
      importId,
      importedAt,
      source,
      runTime: normalizeText(payload.runTime),
      syncMode,
      fullSnapshot,
      summaryCount,
      inserted,
      updated,
      skipped,
      failCount,
      inactiveMarked,
      status: failCount ? 'partial_failed' : 'success',
      errorMessage: failCount ? `${failCount} summaries failed; inactive marking skipped.` : '',
      errorDetails
    });

    return response({ ok: failCount === 0, importId, importBatchId: importId, syncMode, fullSnapshot, summaryCount, inserted, updated, skipped, failCount, inactiveMarked, errorDetails });
  } catch (err) {
    console.error(err);
    await writeImportLog({
      importId,
      importedAt,
      source,
      runTime: normalizeText(payload && payload.runTime),
      syncMode,
      fullSnapshot,
      summaryCount: Array.isArray(payload && payload.summaries) ? payload.summaries.length : summaryCount,
      inserted,
      updated,
      skipped,
      failCount,
      inactiveMarked,
      status: 'failed',
      errorMessage: err.message || 'AR import failed.',
      errorDetails
    }).catch(logErr => console.warn('写入 AR 导入日志失败：', logErr));
    return response({
      ok: false,
      importId,
      syncMode,
      fullSnapshot,
      summaryCount: Array.isArray(payload && payload.summaries) ? payload.summaries.length : summaryCount,
      inserted,
      updated,
      skipped,
      failCount,
      inactiveMarked,
      errorDetails,
      message: err.message || 'AR import failed.'
    }, err.message && err.message.indexOf('token') >= 0 ? 401 : 500);
  }
};
