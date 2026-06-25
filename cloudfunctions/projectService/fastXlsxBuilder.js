const JSZip = require('jszip');
const { SUMMARY_COLUMNS } = require('./templateMapping');

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round2(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  return Math.round(Number(value) * 100) / 100;
}

function safeDivide(numerator, denominator) {
  const d = toNumber(denominator);
  if (!d) return null;
  return toNumber(numerator) / d;
}

function normalizeText(value) {
  return String(value || '').trim();
}

function uniqueTexts(values) {
  const seen = {};
  const result = [];
  (values || []).forEach(value => {
    const text = normalizeText(value);
    if (!text || seen[text]) return;
    seen[text] = true;
    result.push(text);
  });
  return result;
}

function xmlEscape(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function columnLetter(col) {
  let n = col;
  let letters = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    letters = String.fromCharCode(65 + rem) + letters;
    n = Math.floor((n - 1) / 26);
  }
  return letters;
}

function formatDate(date) {
  const d = date || new Date();
  const pad2 = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function formatDateTime(date) {
  const d = date || new Date();
  const pad2 = n => String(n).padStart(2, '0');
  return `${formatDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function safeFileName(name, fallback) {
  const clean = normalizeText(name || fallback || '未命名')
    .replace(/[\\/:*?"<>|\[\]\r\n]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return clean || fallback || '未命名';
}

function safeSheetName(name, usedNames) {
  const used = usedNames || {};
  const base = (safeFileName(name, '项目').replace(/[\\/?*\[\]:]/g, '_') || '项目').slice(0, 31);
  let candidate = base;
  let index = 2;
  while (used[candidate]) {
    const suffix = `_${index}`;
    candidate = `${base.slice(0, 31 - suffix.length)}${suffix}`;
    index += 1;
  }
  used[candidate] = true;
  return candidate;
}

function buildSapNos(project) {
  const bindingNos = (project.sapBindings || [])
    .filter(item => item && item.active !== false)
    .map(item => item.sapOrderNo);
  return uniqueTexts((project.sapNumbers || []).concat(bindingNos));
}

function buildMemberNames(project) {
  return uniqueTexts((project.employeeBudgets || []).map(item => item.memberName)
    .concat((project.arHours || []).map(item => item.memberName)));
}

function buildMemberRows(project) {
  const budgetMap = {};
  const arMap = {};
  const names = [];
  const addName = name => {
    const clean = normalizeText(name);
    if (!clean || names.indexOf(clean) >= 0) return;
    names.push(clean);
  };
  (project.employeeBudgets || []).forEach(item => {
    const name = normalizeText(item && item.memberName);
    if (!name) return;
    addName(name);
    budgetMap[name] = (budgetMap[name] || 0) + toNumber(item.budgetHours);
  });
  (project.arHours || []).forEach(item => {
    const name = normalizeText(item && item.memberName);
    if (!name) return;
    addName(name);
    arMap[name] = (arMap[name] || 0) + toNumber(item.hours);
  });
  return names.map(name => ({
    memberName: name,
    allocatedHours: round2(budgetMap[name] || 0),
    arHours: round2(arMap[name] || 0)
  }));
}

function subProjectUnitPrice(item) {
  const value = item && (item.budgetLaborUnitPriceRaw !== undefined && item.budgetLaborUnitPriceRaw !== ''
    ? item.budgetLaborUnitPriceRaw
    : item.budgetLaborUnitPrice);
  return toNumber(value);
}

function computeExportMetrics(project) {
  const hoursPerDay = toNumber(project && project.constants && project.constants.hoursPerDay) || 8;
  const personDayCost = toNumber(project && project.constants && project.constants.personDayCost) || 5000;
  const subProjects = Array.isArray(project && project.subProjects) ? project.subProjects : [];
  const arHours = Array.isArray(project && project.arHours) ? project.arHours : [];
  const totalBudgetHours = subProjects.reduce((sum, item) => sum + toNumber(item.budgetHours), 0);
  const bac = subProjects.reduce((sum, item) => sum + toNumber(item.budgetHours) / hoursPerDay * subProjectUnitPrice(item), 0);
  const plannedHours = subProjects.reduce((sum, item) => sum + toNumber(item.plannedCompletedHours), 0);
  const arTotalHours = arHours.reduce((sum, item) => sum + toNumber(item.hours), 0);
  const plannedCompletionRatio = safeDivide(plannedHours, totalBudgetHours);
  const actualCompletionRatio = safeDivide(arTotalHours, totalBudgetHours);
  const cappedPlannedCompletionRatio = plannedCompletionRatio === null ? null : Math.min(plannedCompletionRatio, 1);
  const cappedActualCompletionRatio = actualCompletionRatio === null ? null : Math.min(actualCompletionRatio, 1);
  const plannedValue = cappedPlannedCompletionRatio === null ? null : bac * cappedPlannedCompletionRatio;
  const earnedValue = cappedActualCompletionRatio === null ? null : bac * cappedActualCompletionRatio;
  const actualCost = arTotalHours / hoursPerDay * personDayCost;
  const costVariance = earnedValue === null ? null : earnedValue - actualCost;
  const scheduleVariance = earnedValue === null || plannedValue === null ? null : earnedValue - plannedValue;
  const travelFee = toNumber(project && project.travelFee);
  const fallback = {
    hoursPerDay,
    personDayCost,
    totalBudgetHours: round2(totalBudgetHours),
    budgetManDays: round2(totalBudgetHours / hoursPerDay),
    bac: round2(bac),
    travelFee: round2(travelFee),
    projectBudgetWithTravel: round2(bac + travelFee),
    plannedHours: round2(plannedHours),
    arTotalHours: round2(arTotalHours),
    plannedCompletionRatio: round2(plannedCompletionRatio),
    actualCompletionRatio: round2(actualCompletionRatio),
    plannedValue: round2(plannedValue),
    earnedValue: round2(earnedValue),
    actualCost: round2(actualCost),
    costVariance: round2(costVariance),
    scheduleVariance: round2(scheduleVariance),
    costPerformanceIndex: round2(safeDivide(earnedValue, actualCost)),
    schedulePerformanceIndex: round2(safeDivide(earnedValue, plannedValue))
  };
  const source = project && project.metrics;
  if (!source) return fallback;
  const merged = Object.assign({}, fallback);
  [
    'bac',
    'travelFee',
    'projectBudgetWithTravel',
    'plannedValue',
    'earnedValue',
    'actualCost',
    'costVariance',
    'scheduleVariance',
    'plannedCompletionRatio',
    'actualCompletionRatio',
    'costPerformanceIndex',
    'schedulePerformanceIndex'
  ].forEach(key => {
    if (source[key] !== null && source[key] !== undefined) merged[key] = source[key];
  });
  if (source.sumBudgetHours !== null && source.sumBudgetHours !== undefined) merged.totalBudgetHours = source.sumBudgetHours;
  if (source.sumPlannedHours !== null && source.sumPlannedHours !== undefined) merged.plannedHours = source.sumPlannedHours;
  if (source.sumArHours !== null && source.sumArHours !== undefined) merged.arTotalHours = source.sumArHours;
  if (source.projectBudgetWithTravel === null || source.projectBudgetWithTravel === undefined) {
    merged.projectBudgetWithTravel = round2(toNumber(merged.bac) + toNumber(merged.travelFee));
  }
  return merged;
}

function statusLabel(status) {
  const value = normalizeText(status || 'active');
  const map = {
    active: '进行中',
    completed: '已完结',
    paused: '暂停',
    risk: '风险关注',
    done: '已完成'
  };
  return map[value] || value || '进行中';
}

function cellXml(value, rowIndex, colIndex) {
  const address = `${columnLetter(colIndex)}${rowIndex}`;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `<c r="${address}"><v>${value}</v></c>`;
  }
  return `<c r="${address}" t="inlineStr"><is><t>${xmlEscape(value)}</t></is></c>`;
}

function sheetXml(rows) {
  const body = rows.map((row, rowIndex) => {
    const r = rowIndex + 1;
    const cells = (row || []).map((value, colIndex) => cellXml(value, r, colIndex + 1)).join('');
    return `<row r="${r}">${cells}</row>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetData>${body}</sheetData>
</worksheet>`;
}

function summaryRows(projects, snapshot) {
  const rows = [
    ['项目数据导出快照'],
    ['导出时间', snapshot.exportedAtText],
    ['导出人', snapshot.exportedByName || snapshot.exportedByOpenid || ''],
    ['筛选条件', snapshot.filterText || '全部'],
    ['PM 分组规则', '按 pmName 分组'],
    ['数据口径说明', 'BAC 不包含差旅费；快速导出使用轻量 XLSX 结构'],
    [],
    SUMMARY_COLUMNS
  ];
  (projects || []).forEach(project => {
    const metrics = computeExportMetrics(project);
    rows.push([
      project.projectName || '',
      project.customerName || project.clientName || '',
      buildSapNos(project).join(', '),
      statusLabel(project.status),
      project.pmName || project.projectManager || '',
      buildMemberNames(project).join('、'),
      project.startDate || '',
      project.endDate || '',
      project.closedAt || '',
      metrics.bac,
      metrics.travelFee,
      metrics.projectBudgetWithTravel,
      metrics.budgetManDays,
      metrics.totalBudgetHours,
      metrics.arTotalHours,
      metrics.plannedValue,
      metrics.earnedValue,
      metrics.actualCost,
      metrics.costVariance,
      metrics.scheduleVariance,
      metrics.costPerformanceIndex,
      metrics.schedulePerformanceIndex,
      snapshot.exportedAtText,
      project.arSummary && project.arSummary.latestUpdatedAtText || ''
    ]);
  });
  return rows;
}

function projectRows(project) {
  const subProjects = Array.isArray(project.subProjects) && project.subProjects.length ? project.subProjects : [{}];
  const memberRows = buildMemberRows(project);
  const metrics = computeExportMetrics(project);
  const dynamicCount = Math.max(3, subProjects.length, memberRows.length);
  const totalAllocatedHours = memberRows.reduce((sum, item) => sum + toNumber(item.allocatedHours), 0);
  const row = label => [label].concat(Array.from({ length: dynamicCount }, () => ''));
  const rows = [
    ['重要提醒：快速导出版；完整模板样式版需将云函数超时配置调至 60 秒后使用。'],
    ['项目成本、进度及绩效管理表'],
    ['客户名称', project.customerName || project.clientName || ''],
    ['项目号', buildSapNos(project).join(', ')],
    ['项目起止时间', [project.startDate, project.endDate].filter(Boolean).join(' - ')],
    ['项目经理', project.pmName || project.projectManager || ''],
    ['项目组员', buildMemberNames(project).join('、')],
    row('子项目名称'),
    row('预算工时'),
    row('报价人天单价'),
    ['差旅费', metrics.travelFee],
    ['BAC（不含差旅）', metrics.bac],
    ['项目总预算（含差旅）', metrics.projectBudgetWithTravel],
    row('组员个人分配工时（小时）'),
    row('应完成工时数'),
    ['计划完成率'],
    ['PV', metrics.plannedValue],
    row('AR人员'),
    row('AR已填报工时'),
    ['实际完成率'],
    ['EV', metrics.earnedValue],
    ['AC', metrics.actualCost],
    ['CV', metrics.costVariance],
    ['SV', metrics.scheduleVariance],
    ['CPI', metrics.costPerformanceIndex],
    ['SPI', metrics.schedulePerformanceIndex]
  ];

  for (let i = 0; i < dynamicCount; i += 1) {
    const sub = subProjects[i] || {};
    const member = memberRows[i] || {};
    rows[7][i + 1] = sub.name || sub.itemDescription || sub.itemNo || sub.subProjectNo || `子项目${i + 1}`;
    rows[8][i + 1] = toNumber(sub.budgetHours) || '';
    rows[9][i + 1] = subProjectUnitPrice(sub) || '';
    rows[13][i + 1] = member.memberName ? (toNumber(member.allocatedHours) || '') : '';
    rows[14][i + 1] = member.memberName && totalAllocatedHours
      ? round2(toNumber(metrics.plannedHours) * toNumber(member.allocatedHours) / totalAllocatedHours)
      : '';
    rows[17][i + 1] = member.memberName ? `${member.memberName}-AR已填报工时` : '';
    rows[18][i + 1] = member.memberName ? (toNumber(member.arHours) || 0) : '';
  }
  return rows;
}

async function buildFastWorkbookBuffer(projects, snapshot) {
  const zip = new JSZip();
  const sheets = [{ name: '汇总', rows: summaryRows(projects, snapshot) }];
  const usedNames = { '汇总': true };
  (projects || []).forEach(project => {
    const sapNos = buildSapNos(project);
    const name = safeSheetName([project.customerName || project.projectName || '项目', sapNos[0] || ''].filter(Boolean).join('_'), usedNames);
    sheets.push({ name, rows: projectRows(project) });
  });

  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  ${sheets.map((_, index) => `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
</Types>`);
  zip.folder('_rels').file('.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`);
  zip.folder('xl').file('workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheets.map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets>
</workbook>`);
  zip.folder('xl').folder('_rels').file('workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheets.map((_, index) => `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}
  <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`);
  zip.folder('xl').file('styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border/></borders>
  <cellStyleXfs count="1"><xf/></cellStyleXfs>
  <cellXfs count="1"><xf xfId="0"/></cellXfs>
</styleSheet>`);
  const worksheets = zip.folder('xl').folder('worksheets');
  sheets.forEach((sheet, index) => worksheets.file(`sheet${index + 1}.xml`, sheetXml(sheet.rows)));
  return zip.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
}

async function buildFastExportPackage(projects, snapshot) {
  const buffer = await buildFastWorkbookBuffer(projects, snapshot);
  return {
    buffer,
    fileName: `项目导出快速版_${snapshot.exportedDate}.xlsx`,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileCount: 1,
    pmCount: uniqueTexts((projects || []).map(project => project.pmName || project.projectManager)).length || 1
  };
}

module.exports = {
  buildFastExportPackage,
  formatDate,
  formatDateTime,
  safeFileName
};
