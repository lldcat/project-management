#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { URLSearchParams } = require('url');

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const TEST_WORKSHEET_NAME = 'Graph_Test';
const TEST_RANGE_ADDRESS = 'A1:D5';
const EMPLOYEE_RANGE_ADDRESS = 'A8:R20';

function loadDotEnv(dotEnvPath = path.join(__dirname, '.env')) {
  if (!fs.existsSync(dotEnvPath)) {
    return;
  }

  const contents = fs.readFileSync(dotEnvPath, 'utf8');
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const equalsIndex = trimmed.indexOf('=');
    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim();
    let value = trimmed.slice(equalsIndex + 1).trim();
    if (!key || Object.prototype.hasOwnProperty.call(process.env, key)) {
      continue;
    }

    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[key] = value;
  }
}

function printHelp() {
  console.log(`Microsoft Graph Excel POC\n\nUsage:\n  node graph-excel-poc.js\n\nRequired environment variables:\n  MS_TENANT_ID\n  MS_CLIENT_ID\n  MS_CLIENT_SECRET\n  MS_DRIVE_ID\n  MS_ITEM_ID\n  MS_WORKSHEET_NAME\n\nOptional:\n  Put the variables in scripts/graph-excel-poc/.env for local testing.\n`);
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function getConfig() {
  return {
    tenantId: requireEnv('MS_TENANT_ID'),
    clientId: requireEnv('MS_CLIENT_ID'),
    clientSecret: requireEnv('MS_CLIENT_SECRET'),
    driveId: requireEnv('MS_DRIVE_ID'),
    itemId: requireEnv('MS_ITEM_ID'),
    worksheetName: requireEnv('MS_WORKSHEET_NAME'),
  };
}

function rangePath(worksheetId, address) {
  return `/workbook/worksheets/${encodeURIComponent(worksheetId)}/range(address='${encodeURIComponent(address)}')`;
}

function formatValues(values) {
  return values.map((row) => row.map((cell) => (cell === null || cell === undefined ? '' : String(cell))).join(' | ')).join('\n');
}

function buildTroubleshootingAdvice(error) {
  const status = error.status;
  const code = String(error.code || '').toLowerCase();
  const message = String(error.message || '').toLowerCase();

  if (status === 401 || status === 403 || code.includes('accessdenied') || code.includes('unauthorized')) {
    return [
      '确认 Azure App Registration 已授予 Microsoft Graph Files.ReadWrite.All 或 Sites.ReadWrite.All 等应用权限。',
      '确认管理员已完成 admin consent。',
      '确认该应用可访问目标 OneDrive for Business 文件所在租户。',
    ];
  }

  if (status === 404 || code.includes('itemnotfound') || message.includes('not found')) {
    return [
      '确认 MS_DRIVE_ID 与 MS_ITEM_ID 来自同一个公司 OneDrive for Business 文件。',
      '确认 Excel 文件没有被移动、删除或改名后重新生成 item id。',
      '如果是 sheet not found，请确认 MS_WORKSHEET_NAME 与 Excel Online 中的工作表名称完全一致。',
    ];
  }

  if (status === 429 || code.includes('too many requests')) {
    return [
      'Microsoft Graph 返回限流，请查看响应中的 Retry-After，并降低请求频率后重试。',
      '避免同时打开多个 Excel workbook session。',
    ];
  }

  if (code.includes('session') || message.includes('session')) {
    return [
      '确认 workbook/createSession 可以创建 persistent session。',
      '确认后续 Excel 请求都带有 workbook-session-id header。',
      '关闭 Excel Online 中可能占用该文件的编辑会话后重试。',
    ];
  }

  return [
    '确认环境变量配置正确且未包含多余空格。',
    '确认目标文件是 Excel workbook，且可在 Excel Online 正常打开。',
    '在 Azure Portal 检查应用权限、admin consent 与 client secret 是否有效。',
  ];
}

async function parseGraphError(response) {
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch (_error) {
    payload = null;
  }

  const graphError = payload && payload.error ? payload.error : {};
  const error = new Error(graphError.message || response.statusText || `Graph API failed with HTTP ${response.status}`);
  error.name = 'GraphApiError';
  error.status = response.status;
  error.code = graphError.code;
  error.requestId = graphError.innerError && graphError.innerError['request-id'];
  error.date = graphError.innerError && graphError.innerError.date;
  error.retryAfter = response.headers.get('retry-after');
  return error;
}

async function graphFetch(pathOrUrl, { token, sessionId, method = 'GET', body } = {}) {
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${GRAPH_BASE_URL}/drives/${encodeURIComponent(globalConfig.driveId)}/items/${encodeURIComponent(globalConfig.itemId)}${pathOrUrl}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/json',
  };

  if (sessionId) {
    headers['workbook-session-id'] = sessionId;
  }

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (!response.ok) {
    throw await parseGraphError(response);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function getAccessToken(config) {
  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(config.tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    throw await parseGraphError(response);
  }

  const payload = await response.json();
  if (!payload.access_token) {
    throw new Error('Token endpoint returned no access_token.');
  }
  return payload.access_token;
}

async function createSession(token) {
  const payload = await graphFetch('/workbook/createSession', {
    token,
    method: 'POST',
    body: { persistChanges: true },
  });

  if (!payload || !payload.id) {
    const error = new Error('workbook/createSession did not return a session id.');
    error.code = 'SessionCreationFailed';
    throw error;
  }
  return payload.id;
}

async function closeSession(token, sessionId) {
  await graphFetch('/workbook/closeSession', {
    token,
    sessionId,
    method: 'POST',
  });
}

async function listWorksheets(token, sessionId) {
  const payload = await graphFetch('/workbook/worksheets', { token, sessionId });
  return payload.value || [];
}

async function getRange(token, sessionId, worksheetId, address) {
  return graphFetch(rangePath(worksheetId, address), { token, sessionId });
}

async function patchRange(token, sessionId, worksheetId, address, values) {
  return graphFetch(rangePath(worksheetId, address), {
    token,
    sessionId,
    method: 'PATCH',
    body: { values },
  });
}

async function ensureTestWorksheet(token, sessionId, worksheets) {
  const existing = worksheets.find((sheet) => sheet.name === TEST_WORKSHEET_NAME);
  if (existing) {
    console.log(`✅ 使用已存在测试 sheet: ${TEST_WORKSHEET_NAME}`);
    return existing;
  }

  const created = await graphFetch('/workbook/worksheets/add', {
    token,
    sessionId,
    method: 'POST',
    body: { name: TEST_WORKSHEET_NAME },
  });
  console.log(`✅ 已创建测试 sheet: ${TEST_WORKSHEET_NAME}`);
  return created;
}

function assertWrittenValues(expected, actual) {
  const actualValues = actual.values || [];
  const expectedText = JSON.stringify(expected);
  const actualText = JSON.stringify(actualValues);
  if (actualText !== expectedText) {
    const error = new Error(`Graph_Test write verification failed. Expected ${expectedText}, got ${actualText}`);
    error.code = 'WriteVerificationFailed';
    throw error;
  }
}

async function run() {
  loadDotEnv();

  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    return;
  }

  globalConfig = getConfig();

  console.log('Microsoft Graph Excel POC started.');
  console.log(`Target drive id: ${globalConfig.driveId}`);
  console.log(`Target item id: ${globalConfig.itemId}`);
  console.log(`Employee worksheet: ${globalConfig.worksheetName}`);

  const token = await getAccessToken(globalConfig);
  console.log('✅ 成功获取 Microsoft Graph access token。');

  let sessionId;
  try {
    sessionId = await createSession(token);
    console.log('✅ 成功创建 persistent workbook session。');

    const worksheets = await listWorksheets(token, sessionId);
    console.log('✅ 成功读取 workbook worksheets。');
    console.log('Worksheets:');
    for (const sheet of worksheets) {
      console.log(`- ${sheet.name} (${sheet.id})`);
    }

    const employeeSheet = worksheets.find((sheet) => sheet.name === globalConfig.worksheetName);
    if (!employeeSheet) {
      const error = new Error(`Worksheet not found: ${globalConfig.worksheetName}`);
      error.status = 404;
      error.code = 'WorksheetNotFound';
      throw error;
    }

    const employeeRange = await getRange(token, sessionId, employeeSheet.id, EMPLOYEE_RANGE_ADDRESS);
    const rows = employeeRange.values || [];
    console.log(`✅ 成功读取 ${globalConfig.worksheetName}!${EMPLOYEE_RANGE_ADDRESS}。`);
    console.log('第 8 行表头:');
    console.log(rows[0] ? formatValues([rows[0]]) : '(empty)');
    console.log('第 9 行以后数据:');
    console.log(rows.length > 1 ? formatValues(rows.slice(1)) : '(empty)');

    const latestWorksheets = await listWorksheets(token, sessionId);
    const testSheet = await ensureTestWorksheet(token, sessionId, latestWorksheets);
    const now = new Date().toISOString();
    const testValues = [
      ['POC', 'Graph Excel API', 'Timestamp', now],
      ['Read workbook', 'OK', 'Employee sheet', globalConfig.worksheetName],
      ['Write range', 'OK', 'Target', `${TEST_WORKSHEET_NAME}!${TEST_RANGE_ADDRESS}`],
      ['Session', 'Persistent', 'persistChanges', 'true'],
      ['Do not use', 'formal AR area', 'Result', 'Verified'],
    ];

    await patchRange(token, sessionId, testSheet.id, TEST_RANGE_ADDRESS, testValues);
    console.log(`✅ 成功写入 ${TEST_WORKSHEET_NAME}!${TEST_RANGE_ADDRESS}。`);

    const testRange = await getRange(token, sessionId, testSheet.id, TEST_RANGE_ADDRESS);
    assertWrittenValues(testValues, testRange);
    console.log(`✅ 成功读取并确认 ${TEST_WORKSHEET_NAME}!${TEST_RANGE_ADDRESS} 写入结果。`);

    console.log('\nPOC result: SUCCESS');
  } finally {
    if (sessionId) {
      try {
        await closeSession(token, sessionId);
        console.log('✅ 已关闭 workbook session。');
      } catch (closeError) {
        console.error('⚠️ 关闭 workbook session 失败，请稍后确认 Excel Online 会话状态。');
        console.error(`原因: ${closeError.message}`);
      }
    }
  }
}

let globalConfig;

run().catch((error) => {
  console.error('\nPOC result: FAILED');
  console.error(`错误类型: ${error.name || 'Error'}`);
  if (error.status) {
    console.error(`HTTP status: ${error.status}`);
  }
  if (error.code) {
    console.error(`Graph error code: ${error.code}`);
  }
  if (error.retryAfter) {
    console.error(`Retry-After: ${error.retryAfter}`);
  }
  if (error.requestId) {
    console.error(`Graph request id: ${error.requestId}`);
  }
  console.error(`错误原因: ${error.message}`);
  console.error('下一步排查建议:');
  for (const advice of buildTroubleshootingAdvice(error)) {
    console.error(`- ${advice}`);
  }
  process.exitCode = 1;
});
