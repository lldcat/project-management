const fs = require('fs');
const path = require('path');
const ExcelJS = require('exceljs');
const JSZip = require('jszip');
const {
  PROJECT_EXPORT_TEMPLATE_MAPPING,
  PROJECT_EXPORT_SHEET,
  SUMMARY_COLUMNS
} = require('./templateMapping');

const TEMPLATE_PATH = path.join(__dirname, 'templates', '项目成本、进度及绩效管理追踪表.xlsx');
const MAX_PROJECT_SHEETS_PER_WORKBOOK = 30;

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
  const base = (safeFileName(name, '项目').replace(/[\\/?*\[\]:]/g, '_') || '项目').slice(0, PROJECT_EXPORT_SHEET.maxSheetNameLength);
  let candidate = base;
  let index = 2;
  while (used[candidate]) {
    const suffix = `_${index}`;
    candidate = `${base.slice(0, PROJECT_EXPORT_SHEET.maxSheetNameLength - suffix.length)}${suffix}`;
    index += 1;
  }
  used[candidate] = true;
  return candidate;
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

function cloneStyle(style) {
  return style ? JSON.parse(JSON.stringify(style)) : {};
}

function findTemplateWorksheet(workbook) {
  const sheets = workbook.worksheets || [];
  return sheets.find(sheet => {
    for (let row = 1; row <= Math.min(sheet.rowCount || 0, 40); row += 1) {
      for (let col = 1; col <= Math.min(sheet.columnCount || 0, 12); col += 1) {
        if (normalizeText(sheet.getCell(row, col).value).indexOf('组员个人分配工时') >= 0) return true;
      }
    }
    return false;
  })
    || sheets.find(sheet => normalizeText(sheet.name).indexOf('附件1') >= 0)
    || sheets.find(sheet => normalizeText(sheet.name).indexOf('项目成本、进度及绩效管理表') >= 0)
    || sheets[0];
}

function cloneWorksheet(workbook, templateSheet, name) {
  const sheet = workbook.addWorksheet(name);
  sheet.model = Object.assign({}, templateSheet.model, {
    id: sheet.id,
    name,
    state: 'visible'
  });
  return sheet;
}

function removeTemplateSheets(workbook, keepSheets) {
  const keepIds = {};
  (keepSheets || []).forEach(sheet => {
    if (sheet && sheet.id) keepIds[sheet.id] = true;
  });
  workbook.worksheets.slice().forEach(sheet => {
    if (!keepIds[sheet.id]) workbook.removeWorksheet(sheet.id);
  });
}

function ensureDynamicColumns(sheet, dynamicCount) {
  const required = Math.max(PROJECT_EXPORT_SHEET.templateDynamicColumns, dynamicCount || 0);
  const extra = required - PROJECT_EXPORT_SHEET.templateDynamicColumns;
  if (extra <= 0) return required;

  const insertAt = PROJECT_EXPORT_SHEET.remarkColumn;
  sheet.spliceColumns(insertAt, 0, ...Array.from({ length: extra }, () => []));
  for (let col = insertAt; col < insertAt + extra; col += 1) {
    const source = sheet.getColumn(col - 1);
    const target = sheet.getColumn(col);
    target.width = source.width;
    source.eachCell({ includeEmpty: true }, (cell, rowNumber) => {
      const targetCell = sheet.getCell(rowNumber, col);
      targetCell.style = cloneStyle(cell.style);
      targetCell.numFmt = cell.numFmt;
      targetCell.alignment = cloneStyle(cell.alignment);
      targetCell.border = cloneStyle(cell.border);
      targetCell.fill = cloneStyle(cell.fill);
      targetCell.font = cloneStyle(cell.font);
    });
  }
  return required;
}

function writeMergedValue(sheet, address, value) {
  sheet.getCell(address).value = value === undefined || value === null ? '' : value;
}

function writeRatio(sheet, address, value) {
  sheet.getCell(address).value = value === null || value === undefined ? '' : value;
  sheet.getCell(address).numFmt = '0.00%';
}

function writeFormula(sheet, address, formula, result, numFmt) {
  const cell = sheet.getCell(address);
  cell.value = { formula, result: result === null || result === undefined ? '' : result };
  if (numFmt) cell.numFmt = numFmt;
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
  const arMeta = {};
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
    if (!arMeta[name]) arMeta[name] = item || {};
  });

  return names.map(name => ({
    memberName: name,
    allocatedHours: round2(budgetMap[name] || 0),
    arHours: round2(arMap[name] || 0),
    arSheetName: normalizeText(arMeta[name] && arMeta[name].arSheetName)
  }));
}

function subProjectName(item, index) {
  return normalizeText(item && (item.name || item.itemDescription || item.subProjectNo || item.itemNo)) || `子项目${index + 1}`;
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
  const bac = subProjects.reduce((sum, item) => {
    return sum + toNumber(item.budgetHours) / hoursPerDay * subProjectUnitPrice(item);
  }, 0);
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
    'costPerformanceIndex',
    'schedulePerformanceIndex',
    'plannedCompletionRatio',
    'actualCompletionRatio'
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

function projectPeriod(project) {
  return [project.startDate, project.endDate].filter(Boolean).join(' - ');
}

function writeProjectSheet(sheet, project) {
  const mapping = PROJECT_EXPORT_TEMPLATE_MAPPING;
  const subProjects = Array.isArray(project.subProjects) && project.subProjects.length ? project.subProjects : [{}];
  const memberRows = buildMemberRows(project);
  const dynamicCount = ensureDynamicColumns(sheet, Math.max(subProjects.length, memberRows.length, PROJECT_EXPORT_SHEET.templateDynamicColumns));
  const lastDynamicCol = PROJECT_EXPORT_SHEET.firstDynamicColumn + dynamicCount - 1;
  const sapNos = buildSapNos(project);
  const memberNames = buildMemberNames(project);
  const metrics = computeExportMetrics(project);
  const totalAllocatedHours = memberRows.reduce((sum, item) => sum + toNumber(item.allocatedHours), 0);

  writeMergedValue(sheet, mapping.customerName, project.customerName || project.clientName || '');
  writeMergedValue(sheet, mapping.sapNos, sapNos.join(', '));
  writeMergedValue(sheet, mapping.projectPeriod, projectPeriod(project));
  writeMergedValue(sheet, mapping.pmName, project.pmName || project.projectManager || '');
  writeMergedValue(sheet, mapping.memberNames, memberNames.join('、'));
  writeMergedValue(sheet, mapping.travelCost, metrics.travelFee);
  const lastDynamicLetter = columnLetter(lastDynamicCol);
  writeFormula(sheet, mapping.bac, `SUMPRODUCT(B${mapping.subProjectBudgetHoursRow}:${lastDynamicLetter}${mapping.subProjectBudgetHoursRow},B${mapping.subProjectUnitPriceRow}:${lastDynamicLetter}${mapping.subProjectUnitPriceRow})/8`, metrics.bac);
  writeFormula(sheet, mapping.plannedCompletionRatio, `IFERROR(SUM(B${mapping.plannedCompletedHoursRow}:${lastDynamicLetter}${mapping.plannedCompletedHoursRow})/SUM(B${mapping.subProjectBudgetHoursRow}:${lastDynamicLetter}${mapping.subProjectBudgetHoursRow}),"")`, metrics.plannedCompletionRatio, '0.00%');
  writeFormula(sheet, mapping.plannedValue, `MIN(${mapping.plannedCompletionRatio},1)*${mapping.bac}`, metrics.plannedValue);
  writeFormula(sheet, mapping.actualCompletionRatio, `IFERROR(SUM(B${mapping.arHoursRow}:${lastDynamicLetter}${mapping.arHoursRow})/SUM(B${mapping.subProjectBudgetHoursRow}:${lastDynamicLetter}${mapping.subProjectBudgetHoursRow}),"")`, metrics.actualCompletionRatio, '0.00%');
  writeFormula(sheet, mapping.earnedValue, `MIN(${mapping.actualCompletionRatio},1)*${mapping.bac}`, metrics.earnedValue);
  writeFormula(sheet, mapping.actualCost, `SUM(B${mapping.arHoursRow}:${lastDynamicLetter}${mapping.arHoursRow})/8*${metrics.personDayCost || 5000}`, metrics.actualCost);
  writeFormula(sheet, mapping.costVariance, `${mapping.earnedValue}-${mapping.actualCost}`, metrics.costVariance);
  writeFormula(sheet, mapping.scheduleVariance, `${mapping.earnedValue}-${mapping.plannedValue}`, metrics.scheduleVariance);
  writeFormula(sheet, mapping.costPerformanceIndex, `IFERROR(${mapping.earnedValue}/${mapping.actualCost},"")`, metrics.costPerformanceIndex);
  writeFormula(sheet, mapping.schedulePerformanceIndex, `IFERROR(${mapping.earnedValue}/${mapping.plannedValue},"")`, metrics.schedulePerformanceIndex);

  for (let i = 0; i < dynamicCount; i += 1) {
    const col = PROJECT_EXPORT_SHEET.firstDynamicColumn + i;
    const sub = subProjects[i] || {};
    const member = memberRows[i] || {};
    sheet.getCell(mapping.subProjectNameRow, col).value = subProjectName(sub, i);
    sheet.getCell(mapping.subProjectBudgetHoursRow, col).value = toNumber(sub.budgetHours) || '';
    sheet.getCell(mapping.subProjectUnitPriceRow, col).value = subProjectUnitPrice(sub) || '';
    sheet.getCell(mapping.memberAllocatedHoursRow, col).value = member.memberName ? (toNumber(member.allocatedHours) || '') : '';
    sheet.getCell(mapping.plannedCompletedHoursRow, col).value = member.memberName && totalAllocatedHours
      ? round2(toNumber(metrics.plannedHours) * toNumber(member.allocatedHours) / totalAllocatedHours)
      : '';
    sheet.getCell(mapping.arMemberNameRow, col).value = member.memberName ? `${member.memberName}-AR已填报工时` : '';
    sheet.getCell(mapping.arHoursRow, col).value = member.memberName ? (toNumber(member.arHours) || 0) : '';
  }

  sheet.getCell(mapping.bac).note = 'BAC = Σ 子项目预算工时 / 8 × 子项目报价人天单价；不包含差旅费。';
  sheet.getCell(mapping.arHoursRow, lastDynamicCol + 1).value = project.arSummary && project.arSummary.latestUpdatedAtText
    ? `AR更新时间：${project.arSummary.latestUpdatedAtText}`
    : '';
}

function addSummarySheet(workbook, rows, snapshot) {
  const sheet = workbook.addWorksheet('汇总');
  sheet.views = [{ state: 'frozen', ySplit: 7 }];
  sheet.getCell('A1').value = '项目数据导出快照';
  sheet.getCell('A1').font = { bold: true, size: 14 };
  const snapshotRows = [
    ['导出时间', snapshot.exportedAtText],
    ['导出人', snapshot.exportedByName || snapshot.exportedByOpenid || ''],
    ['筛选条件', snapshot.filterText || '全部'],
    ['PM 分组规则', '按 pmName 分组；同名文件自动去重'],
    ['数据口径说明', 'BAC 不包含差旅费；AR Time 为导出时匹配快照']
  ];
  snapshotRows.forEach((row, index) => {
    sheet.getRow(index + 2).values = row;
  });
  const headerRow = sheet.getRow(8);
  headerRow.values = SUMMARY_COLUMNS;
  headerRow.font = { bold: true };
  rows.forEach((project, index) => {
    const metrics = computeExportMetrics(project);
    const values = [
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
    ];
    sheet.getRow(index + 9).values = values;
  });
  sheet.columns.forEach(column => {
    column.width = Math.min(28, Math.max(12, column.width || 12));
  });
  return sheet;
}

async function buildWorkbookBuffer(pmName, projects, snapshot, partIndex) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(TEMPLATE_PATH);
  const templateSheet = findTemplateWorksheet(workbook);
  if (!templateSheet) throw new Error('未找到项目导出 Excel 模板 sheet。');

  const summarySheet = addSummarySheet(workbook, projects, snapshot);
  workbook.views = [{ activeTab: 0 }];
  const usedSheetNames = { '汇总': true };
  const projectSheets = [];
  projects.forEach(project => {
    const sapNos = buildSapNos(project);
    const mainSap = sapNos[0] || project.projectNo || '';
    const rawName = [project.customerName || project.clientName || project.projectName || '项目', mainSap].filter(Boolean).join('_');
    const sheetName = safeSheetName(rawName, usedSheetNames);
    const sheet = cloneWorksheet(workbook, templateSheet, sheetName);
    writeProjectSheet(sheet, project);
    projectSheets.push(sheet);
  });
  removeTemplateSheets(workbook, [summarySheet].concat(projectSheets));
  workbook.creator = snapshot.exportedByName || 'project-management';
  workbook.created = new Date();
  workbook.modified = new Date();
  return workbook.xlsx.writeBuffer();
}

function groupProjectsByPm(projects) {
  const groups = {};
  (projects || []).forEach(project => {
    const pmName = normalizeText(project.pmName || project.projectManager) || '未指定PM';
    if (!groups[pmName]) groups[pmName] = [];
    groups[pmName].push(project);
  });
  return groups;
}

function splitProjects(projects) {
  const chunks = [];
  for (let i = 0; i < projects.length; i += MAX_PROJECT_SHEETS_PER_WORKBOOK) {
    chunks.push(projects.slice(i, i + MAX_PROJECT_SHEETS_PER_WORKBOOK));
  }
  return chunks;
}

async function buildExportPackage(projects, snapshot) {
  const groups = groupProjectsByPm(projects);
  const pmNames = Object.keys(groups).sort((a, b) => a.localeCompare(b));
  if (!pmNames.length) throw new Error('没有可导出的项目。');

  const files = [];
  for (const pmName of pmNames) {
    const chunks = splitProjects(groups[pmName]);
    for (let i = 0; i < chunks.length; i += 1) {
      const buffer = await buildWorkbookBuffer(pmName, chunks[i], snapshot, i + 1);
      const partSuffix = chunks.length > 1 ? `_${i + 1}` : '';
      const datedSuffix = pmNames.length === 1 ? `_${snapshot.exportedDate}` : '';
      files.push({
        fileName: `PM_${safeFileName(pmName, '未指定PM')}_项目追踪表${partSuffix}${datedSuffix}.xlsx`,
        buffer
      });
    }
  }

  if (files.length === 1) {
    return {
      buffer: Buffer.from(files[0].buffer),
      fileName: files[0].fileName,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileCount: 1,
      pmCount: pmNames.length
    };
  }

  const zip = new JSZip();
  files.forEach(file => zip.file(file.fileName, file.buffer));
  const summaryWorkbook = new ExcelJS.Workbook();
  addSummarySheet(summaryWorkbook, projects, snapshot);
  zip.file('导出汇总.xlsx', await summaryWorkbook.xlsx.writeBuffer());
  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return {
    buffer: zipBuffer,
    fileName: `项目导出_${snapshot.exportedDate}.zip`,
    contentType: 'application/zip',
    fileCount: files.length + 1,
    pmCount: pmNames.length
  };
}

function assertTemplateExists() {
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error('项目导出模板文件不存在，请检查云函数 templates 目录。');
  }
}

module.exports = {
  buildExportPackage,
  computeExportMetrics,
  formatDate,
  formatDateTime,
  safeFileName,
  assertTemplateExists
};
