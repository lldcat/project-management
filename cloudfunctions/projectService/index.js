const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const users = db.collection('users');
const projects = db.collection('projects');
const precalRecords = db.collection('precal_records');
const arSummaries = db.collection('ar_summaries');
const CREATE_FROM_SAP_LOCK_TIMEOUT_MS = 20 * 60 * 1000;
const DEFAULT_ROLES = ['pm', 'sales'];
const ALLOWED_ROLE_MAP = { admin: true, pm: true, sales: true, cs: true, ar: true };
const PROJECT_EXPORT_SERVICE_VERSION = 'project-export-20260623-template-v1.1-member-split-v5';

let excelBuilderCache = null;
let fastXlsxBuilderCache = null;

function getExcelBuilder() {
  if (!excelBuilderCache) excelBuilderCache = require('./excelBuilder');
  return excelBuilderCache;
}

function getFastXlsxBuilder() {
  if (!fastXlsxBuilderCache) fastXlsxBuilderCache = require('./fastXlsxBuilder');
  return fastXlsxBuilderCache;
}



function normalizeSapNo(value) {
  return String(value || '').trim();
}

function defaultItemNoForSap(sapOrderNo, itemNo) {
  const cleanItemNo = normalizeText(itemNo);
  if (cleanItemNo) return cleanItemNo;
  return normalizeSapNo(sapOrderNo).indexOf('7') === 0 ? '1000' : '';
}

function splitSapText(value) {
  return String(value || '')
    .split(/[\s,，;；、\n\t]+/)
    .map(normalizeSapNo)
    .filter(Boolean);
}

function normalizeMembers(input) {
  const result = [];
  const seen = {};
  const add = (value) => {
    const raw = value && typeof value === 'object' ? value.memberName : value;
    const name = String(raw || '').trim();
    if (!name || seen[name]) return;
    seen[name] = true;
    result.push(name);
  };

  if (Array.isArray(input)) {
    input.forEach(add);
    return result;
  }
  if (typeof input === 'string') {
    input.split(/[、,，;；\n\r]+/).forEach(add);
    return result;
  }
  if (input && typeof input === 'object') {
    Object.keys(input).forEach(add);
  }
  return result;
}

function collectSapNos(precal) {
  const sapSet = {};
  const pushSap = (value) => {
    const normalized = normalizeSapNo(value);
    if (normalized) sapSet[normalized] = true;
  };

  normalizeSapBindingList(precal).filter(item => item.active !== false).forEach(item => {
    if (!item) return;
    splitSapText(item.sapOrderNo).forEach(pushSap);
  });

  return Object.keys(sapSet);
}


function hasMeaningfulValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function firstMeaningfulValue(values) {
  for (const value of values || []) {
    if (hasMeaningfulValue(value)) return value;
  }
  return '';
}

function toOptionalNumber(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' && value.trim() === '') return '';
  const n = Number(value);
  return Number.isFinite(n) ? n : '';
}

function toAllocationNumber(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string' && value.trim() === '') return '';
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : '';
}

function normalizeSapBindingList(precal) {
  const rows = [];
  const seen = {};
  const add = (raw, index) => {
    const item = raw || {};
    const sapOrderNo = typeof item === 'string' ? normalizeSapNo(item) : normalizeSapNo(item.sapOrderNo);
    if (!sapOrderNo) return;
    const itemNo = defaultItemNoForSap(sapOrderNo, typeof item === 'string' ? '' : item.itemNo);
    const active = typeof item === 'object' && item.active === false ? false : true;
    const key = `${sapOrderNo}#${itemNo}#${active ? 'active' : 'inactive'}`;
    if (seen[key]) return;
    seen[key] = true;
    rows.push({
      sapId: typeof item === 'object' && (item.sapId || item.id) || `S${Date.now()}_${index}_${Math.floor(Math.random() * 100000)}`,
      sapOrderNo,
      itemNo,
      active,
      source: typeof item === 'object' && item.source || 'manual',
      memberName: String(typeof item === 'object' && item.memberName || '').trim(),
      remark: String(typeof item === 'object' && item.remark || '').trim(),
      createdAt: typeof item === 'object' && item.createdAt || '',
      createdBy: typeof item === 'object' && item.createdBy || '',
      createdByName: typeof item === 'object' && item.createdByName || '',
      updatedAt: typeof item === 'object' && item.updatedAt || '',
      updatedBy: typeof item === 'object' && item.updatedBy || '',
      updatedByName: typeof item === 'object' && item.updatedByName || '',
      disabledAt: typeof item === 'object' && item.disabledAt || null,
      disabledBy: typeof item === 'object' && item.disabledBy || null,
      disabledReason: typeof item === 'object' && item.disabledReason || null
    });
  };
  (precal && precal.sapBindings || []).forEach(add);
  return rows;
}

function normalizeItemList(precal) {
  const merged = [];
  const seen = {};
  const add = (raw, index) => {
    const item = raw || {};
    const itemNo = String(item.itemNo || ((index + 1) * 1000)).trim();
    if (!itemNo || seen[itemNo]) return;
    seen[itemNo] = true;
    merged.push({
      itemId: item.itemId || item.id || `item_${Date.now()}_${merged.length}`,
      itemNo,
      itemDescription: String(item.itemDescription || '').trim(),
      name: String(item.name || item.itemDescription || '').trim(),
      travelFee: toOptionalNumber(item.travelFee),
      workingMd: toOptionalNumber(item.workingMd),
      budgetHours: toOptionalNumber(item.budgetHours),
      budgetAmount: toOptionalNumber(item.budgetAmount),
      remark: String(item.remark || '').trim()
    });
  };
  (precal && precal.itemList || []).forEach(add);
  return merged;
}

function readDetailName(detail, index) {
  const item = detail || {};
  return String(
    item.itemDescription ||
    item.name ||
    item.productDescription ||
    ''
  ).trim();
}

function readDetailTravelFee(detail) {
  const item = detail || {};
  const value = toOptionalNumber(firstMeaningfulValue([
    item.travelFee,
    item.subcontractingTravel,
  ]));
  return value > 0 ? value : '';
}

function readDetailTravelMD(detail) {
  const item = detail || {};
  const value = toOptionalNumber(firstMeaningfulValue([
    item.travelMd,
    item.travelMD,
    item.calculated && item.calculated.travelMD
  ]));
  return value > 0 ? value : '';
}

function readDetailQuotationMD(detail) {
  const item = detail || {};
  const value = toOptionalNumber(firstMeaningfulValue([
    item.quotationMd,
    item.quotationMD,
    item.calculated && item.calculated.quotationMD
  ]));
  return value > 0 ? value : '';
}

function readDetailTotalMD(detail) {
  const item = detail || {};
  const value = toOptionalNumber(firstMeaningfulValue([
    item.totalMd,
    item.totalMD,
    item.calculated && item.calculated.totalMD
  ]));
  return value > 0 ? value : '';
}

function readDetailWorkingMD(detail) {
  const item = detail || {};
  const onsiteMD = toOptionalNumber(firstMeaningfulValue([
    item.onsiteMD,
    item.onsiteMd
  ]));
  const offsiteMD = toOptionalNumber(firstMeaningfulValue([
    item.offsiteMD,
    item.offsiteMd
  ]));

  if (onsiteMD !== '' || offsiteMD !== '') {
    const workingMd = toNumber(onsiteMD) + toNumber(offsiteMD);
    return workingMd > 0 ? round2(workingMd) : '';
  }

  const totalMD = readDetailTotalMD(item);
  if (totalMD === '') return '';
  const workingMd = toNumber(totalMD) - toNumber(readDetailTravelMD(item)) - toNumber(readDetailQuotationMD(item));
  return workingMd > 0 ? round2(workingMd) : '';
}

function readDetailAllocatableHours(detail) {
  const workingMd = readDetailWorkingMD(detail);
  return workingMd === '' ? '' : round2(toNumber(workingMd) * 8);
}

function readDetailOtherMiscFee(detail) {
  const item = detail || {};
  const value = toOptionalNumber(firstMeaningfulValue([
    item.otherMiscFee,
    item.otherProjectCosts,
    item.subcontractingOther
  ]));
  return value > 0 ? value : '';
}

function readDetailBudgetHours(detail) {
  return readDetailAllocatableHours(detail);
}

function readDetailBudgetAmount(detail) {
  const item = detail || {};
  const value = toOptionalNumber(firstMeaningfulValue([
    item.budgetAmount,
    item.orderValue,
    item.amount,
    item.totalAmount
  ]));
  return value > 0 ? value : '';
}

function readDetailLaborUnitPriceRaw(detail) {
  const item = detail || {};
  const explicit = toOptionalNumber(firstMeaningfulValue([
    item.budgetLaborUnitPriceRaw,
    item.budgetLaborUnitPrice,
    item.laborUnitPrice,
    item.personDayUnitPrice,
    item.quotePersonDayUnitPrice,
    item['报价人天单价']
  ]));
  if (explicit > 0) return explicit;

  const workingMd = readDetailWorkingMD(item);
  const orderValue = toOptionalNumber(firstMeaningfulValue([
    item.orderValue,
    item.budgetAmount,
    item.amount,
    item.totalAmount
  ]));
  if (workingMd === '' || !toNumber(workingMd) || orderValue === '') return '';
  const laborQuoteAmount = toNumber(orderValue) - toNumber(readDetailTravelFee(item)) - toNumber(readDetailOtherMiscFee(item));
  if (!Number.isFinite(laborQuoteAmount)) return '';
  return laborQuoteAmount / toNumber(workingMd);
}

function readDetailLaborUnitPrice(detail) {
  const raw = readDetailLaborUnitPriceRaw(detail);
  return raw === '' ? '' : round2(raw);
}

function hasPrecalDetailValue(detail) {
  const item = detail || {};
  if (readDetailName(item)) return true;
  if (readDetailTravelFee(item) !== '') return true;
  return [
    'orderValue', 'onsiteMD', 'offsiteMD', 'quotationMD', 'travelMD',
    'subcontractingTranslation', 'subcontractingDesign', 'subcontractingTravel',
    'subcontractingOther', 'subcontractingIC', 'internalSubcon', 'otherProjectCosts',
    'budgetHours', 'hours', 'totalHours', 'budgetAmount'
  ].some(field => toOptionalNumber(item[field]) !== '');
}

function normalizePrecalDetails(precal) {
  const record = precal || {};
  const arrayFields = ['lineItems'];
  for (const field of arrayFields) {
    if (Array.isArray(record[field]) && record[field].length) {
      const normalized = record[field]
        .filter(hasPrecalDetailValue)
        .map((item, index) => ({
          source: item || {},
          name: readDetailName(item, index) || `项目 ${index + 1}`,
          explicitName: readDetailName(item, index),
          travelFee: readDetailTravelFee(item),
          travelMd: readDetailTravelMD(item),
          quotationMd: readDetailQuotationMD(item),
          workingMd: readDetailWorkingMD(item),
          allocatableHours: readDetailAllocatableHours(item),
          budgetHours: readDetailBudgetHours(item),
          budgetAmount: readDetailBudgetAmount(item),
          budgetLaborUnitPriceRaw: readDetailLaborUnitPriceRaw(item),
          budgetLaborUnitPrice: readDetailLaborUnitPrice(item)
        }));
      if (normalized.length) return normalized;
    }
  }
  return [];
}

function buildItemListFromPrecal(precal) {
  const details = normalizePrecalDetails(precal);
  if (!details.length) {
    const items = normalizeItemList(precal);
    return items.length ? items : [{
      itemId: `item_${Date.now()}_0`,
      itemNo: '1000',
      itemDescription: '',
      name: '',
      travelFee: '',
      workingMd: '',
      budgetHours: '',
      budgetAmount: '',
      remark: ''
    }];
  }
  return details.map((detail, index) => ({
    itemId: `item_${Date.now()}_${index}`,
    itemNo: String((index + 1) * 1000),
    itemDescription: detail.name || `项目 ${index + 1}`,
    name: detail.name || `项目 ${index + 1}`,
    travelFee: detail.travelFee,
    workingMd: detail.workingMd,
    allocatableHours: detail.allocatableHours,
    budgetHours: detail.allocatableHours,
    budgetAmount: detail.budgetAmount,
    budgetLaborUnitPriceRaw: detail.budgetLaborUnitPriceRaw,
    budgetLaborUnitPrice: detail.budgetLaborUnitPrice,
    remark: ''
  }));
}

function sumPrecalDetailTravelFee(precal) {
  const details = normalizePrecalDetails(precal);
  const sum = details.reduce((acc, detail) => acc + toNumber(detail.travelFee), 0);
  return sum > 0 ? sum : '';
}

function sumPrecalDetailField(precal, field) {
  const details = normalizePrecalDetails(precal);
  const sum = details.reduce((acc, detail) => acc + toNumber(detail[field]), 0);
  return sum > 0 ? round2(sum) : '';
}

function getProjectWorkingMD(precal) {
  const detailWorkingMd = sumPrecalDetailField(precal, 'workingMd');
  if (detailWorkingMd !== '') return detailWorkingMd;

  const result = precal && precal.calculationResult || {};
  const onsiteMD = toOptionalNumber(firstMeaningfulValue([result.totalOnsiteMD, precal && precal.totalOnsiteMD, precal && precal.onsiteMD]));
  const offsiteMD = toOptionalNumber(firstMeaningfulValue([result.totalOffsiteMD, precal && precal.totalOffsiteMD, precal && precal.offsiteMD]));
  if (onsiteMD !== '' || offsiteMD !== '') {
    const workingMd = toNumber(onsiteMD) + toNumber(offsiteMD);
    return workingMd > 0 ? round2(workingMd) : '';
  }

  const totalMD = toOptionalNumber(firstMeaningfulValue([result.totalMD, precal && precal.totalMD, precal && precal.mdTotal]));
  if (totalMD === '') return '';
  const travelMD = toOptionalNumber(firstMeaningfulValue([result.totalTravelMD, precal && precal.totalTravelMD, precal && precal.travelMD]));
  const quotationMD = toOptionalNumber(firstMeaningfulValue([result.totalQuotationMD, precal && precal.totalQuotationMD, precal && precal.quotationMD]));
  const workingMd = toNumber(totalMD) - toNumber(travelMD) - toNumber(quotationMD);
  return workingMd > 0 ? round2(workingMd) : '';
}

function getProjectTravelMD(precal) {
  const detailTravelMd = sumPrecalDetailField(precal, 'travelMd');
  if (detailTravelMd !== '') return detailTravelMd;
  const result = precal && precal.calculationResult || {};
  const value = toOptionalNumber(firstMeaningfulValue([result.totalTravelMD, precal && precal.totalTravelMD, precal && precal.travelMD]));
  return value > 0 ? value : '';
}

function getProjectQuotationMD(precal) {
  const detailQuotationMd = sumPrecalDetailField(precal, 'quotationMd');
  if (detailQuotationMd !== '') return detailQuotationMd;
  const result = precal && precal.calculationResult || {};
  const value = toOptionalNumber(firstMeaningfulValue([result.totalQuotationMD, precal && precal.totalQuotationMD, precal && precal.quotationMD]));
  return value > 0 ? value : '';
}

function buildSubProjectsFromPrecal(precal, sapNumbers) {
  const detailItems = buildItemListFromPrecal(precal);
  const details = normalizePrecalDetails(precal);
  if (details.length) {
    return details.map((detail, index) => {
      const item = detailItems[index] || {};
      const itemNo = item.itemNo || String((index + 1) * 1000);
      const travelFee = detail.travelFee;
      return {
        id: `sub_${Date.now()}_${index}`,
        subProjectNo: itemNo,
        itemNo,
        itemDescription: item.itemDescription || detail.name || `项目 ${index + 1}`,
        name: detail.name || `项目 ${index + 1}`,
        workingMd: detail.workingMd,
        allocatableHours: detail.allocatableHours,
        budgetHours: detail.allocatableHours,
        budgetAmount: detail.budgetAmount,
        travelFee,
        budgetLaborUnitPriceRaw: detail.budgetLaborUnitPriceRaw,
        budgetLaborUnitPrice: detail.budgetLaborUnitPrice,
        plannedCompletedHours: '',
        actualHours: ''
      };
    });
  }

  const items = normalizeItemList(precal);
  const source = items.length ? items : sapNumbers;
  if (!source.length) {
    return [{ id: `sub_${Date.now()}_0`, name: '', itemNo: '1000', subProjectNo: '1000', budgetHours: '', budgetLaborUnitPrice: 5000, plannedCompletedHours: '' }];
  }
  return source.map((sourceItem, index) => {
    const item = items[index] || {};
    const itemNo = item.itemNo || String((index + 1) * 1000);
    const itemDescription = item.itemDescription || '';
    return {
      id: `sub_${Date.now()}_${index}`,
      subProjectNo: itemNo,
      itemNo,
      itemDescription,
      name: itemDescription,
      budgetHours: '',
      budgetAmount: '',
      budgetLaborUnitPrice: 5000,
      plannedCompletedHours: '',
      actualHours: ''
    };
  });
}

function buildProjectFromPrecal(precal, inputSapNo) {
  const sapBindings = normalizeSapBindingList(precal);
  const sapNumbers = collectSapNos(precal);
  const primarySapNo = normalizeSapNo(inputSapNo) || sapNumbers[0] || '';
  const result = precal.calculationResult || {};
  const orderValue = toOptionalNumber(firstMeaningfulValue([result.totalOrderValue, precal.totalOrderValue, precal.orderValue]));
  const totalMD = toOptionalNumber(firstMeaningfulValue([result.totalMD, precal.totalMD, precal.mdTotal]));
  const workingMd = getProjectWorkingMD(precal);
  const travelMd = getProjectTravelMD(precal);
  const quotationMd = getProjectQuotationMD(precal);
  const detailTravelFee = sumPrecalDetailTravelFee(precal);
  const travelFee = detailTravelFee !== ''
    ? detailTravelFee
    : toOptionalNumber(firstMeaningfulValue([precal.travelFee, result.subcontractingTravel, result.travelFee]));
  const allocatableHours = workingMd === '' ? '' : round2(toNumber(workingMd) * 8);
  const budgetTotalHours = allocatableHours;
  const projectTotalBudget = orderValue;
  const laborQuoteBudget = orderValue === '' ? '' : orderValue - toNumber(travelFee);
  const operatingMargin = toOptionalNumber(firstMeaningfulValue([result.operatingMargin, precal.operatingMargin]));
  const itemList = buildItemListFromPrecal(precal);
  const customerName = String(precal.customerName || precal.clientName || '').trim();

  return {
    projectName: customerName && primarySapNo ? `${customerName}-${primarySapNo}` : (customerName || primarySapNo || ''),
    customerName,
    clientName: customerName,
    projectNo: '',
    sapNumbers,
    sapBindings,
    precalId: precal._id,
    precalNo: precal.precalNo || '',
    service: precal.service || '',
    salesOwnerName: precal.salesOwnerName || '',
    orderValue,
    orderValueWithoutTravel: laborQuoteBudget,
    totalMd: totalMD,
    workingMd,
    travelMd,
    quotationMd,
    allocatableHours,
    budgetTotalHours,
    budgetHours: budgetTotalHours,
    precalProjectBudget: projectTotalBudget,
    projectTotalBudget,
    totalBudget: projectTotalBudget,
    bac: '',
    travelFee,
    operatingMargin,
    itemList,
    startDate: '',
    endDate: '',
    projectManager: '',
    status: 'active',
    constants: { hoursPerDay: 8, personDayCost: 5000 },
    subProjects: buildSubProjectsFromPrecal(precal, sapNumbers),
    employeeBudgets: [],
    arHours: []
  };
}

async function safeGetPrecalCandidates(query, label) {
  try {
    const rows = [];
    let skip = 0;
    const pageSize = 100;
    while (true) {
      const res = await precalRecords.where(query).skip(skip).limit(pageSize).get();
      const batch = res.data || [];
      rows.push.apply(rows, batch);
      if (batch.length < pageSize) break;
      skip += batch.length;
    }
    return { data: rows };
  } catch (err) {
    console.warn(`按 ${label} 查询 Pre-cal 失败，改用候选记录过滤：`, err && err.message || err);
    return { data: [] };
  }
}

async function getPrecalBySapNo(sapNo) {
  const no = normalizeSapNo(sapNo);
  if (!no) return null;
  const fetches = await Promise.all([
    safeGetPrecalCandidates({ 'sapBindings.sapOrderNo': no, deleted: _.neq(true) }, 'sapBindings.sapOrderNo'),
    safeGetPrecalCandidates({ sapNumbers: no, deleted: _.neq(true) }, 'sapNumbers')
  ]);
  const merged = [];
  const seen = {};
  fetches.forEach(res => {
    (res.data || []).forEach(item => {
      if (!item || !item._id || seen[item._id]) return;
      seen[item._id] = true;
      merged.push(item);
    });
  });

  const rows = merged.filter(item => collectSapNos(item).indexOf(no) >= 0);
  const activeRows = rows.filter(item => normalizeSapBindingList(item).some(binding => binding.active !== false && binding.sapOrderNo === no));
  if (!activeRows.length) return null;
  if (activeRows.length > 1) {
    const err = new Error('该 SAP 同时匹配到多个 Pre-cal，请先检查 SAP 绑定关系。');
    err.code = 'SAP_PRECAL_CONFLICT';
    throw err;
  }
  activeRows.sort((a, b) => {
    const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
    const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
    return tb - ta;
  });
  return activeRows[0] || null;
}

function validatePrecalForProject(precal) {
  const sapNumbers = collectSapNos(precal);
  if (!sapNumbers.length) return { ok: false, message: '该 Pre-cal 尚未绑定 SAP 项目号' };
  const customerName = String(precal.customerName || '').trim();
  const orderValue = toOptionalNumber((precal.calculationResult || {}).totalOrderValue || precal.totalOrderValue || precal.orderValue);
  const totalMD = toOptionalNumber((precal.calculationResult || {}).totalMD || precal.totalMD);
  if (!customerName || orderValue === '' || totalMD === '') {
    return { ok: false, message: 'Pre-cal 数据不完整，请联系 CS 补充' };
  }
  return { ok: true, sapNumbers };
}
function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function safeDivide(numerator, denominator) {
  const d = toNumber(denominator);
  if (!d) return null;
  return toNumber(numerator) / d;
}

function round2(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  return Math.round(Number(value) * 100) / 100;
}

function hasNumericValue(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  return Number.isFinite(Number(value));
}

function normalizeName(name, fallback) {
  const text = String(name || '').trim();
  return text || fallback || '未填写姓名';
}

function addToMap(map, key, value) {
  map[key] = (map[key] || 0) + toNumber(value);
}

function buildMemberBudgetComparisons(employeeBudgets, arHours) {
  const budgetMap = {};
  const arMap = {};
  const nameSet = {};

  (employeeBudgets || []).forEach((item, index) => {
    const name = normalizeName(item.memberName, `人员${index + 1}`);
    nameSet[name] = true;
    addToMap(budgetMap, name, item.budgetHours);
  });

  (arHours || []).forEach((item, index) => {
    const name = normalizeName(item.memberName, `AR成员${index + 1}`);
    nameSet[name] = true;
    addToMap(arMap, name, item.hours);
  });

  return Object.keys(nameSet).map(name => {
    const budgetHoursRaw = budgetMap[name] || 0;
    const actualHoursRaw = arMap[name] || 0;
    return {
      memberName: name,
      budgetHours: round2(budgetHoursRaw),
      actualHours: round2(actualHoursRaw),
      varianceHours: round2(budgetHoursRaw - actualHoursRaw),
      usageRatio: round2(safeDivide(actualHoursRaw, budgetHoursRaw)),
      isOverBudget: budgetHoursRaw > 0 && actualHoursRaw > budgetHoursRaw,
      hasArButNoBudget: !budgetHoursRaw && actualHoursRaw > 0
    };
  });
}

function computeMetrics(project) {
  const constants = project.constants || {};
  const hoursPerDay = toNumber(constants.hoursPerDay) || 8;
  const personDayCost = toNumber(constants.personDayCost) || 5000;
  const travelFee = toNumber(project.travelFee);
  const subProjects = Array.isArray(project.subProjects) ? project.subProjects : [];
  const employeeBudgets = Array.isArray(project.employeeBudgets) ? project.employeeBudgets : [];
  const arHours = Array.isArray(project.arHours) ? project.arHours : [];

  const sumBudgetHours = subProjects.reduce((sum, item) => sum + toNumber(item.budgetHours), 0);
  const laborBudget = subProjects.reduce((sum, item) => {
    const unitPrice = hasNumericValue(item.budgetLaborUnitPriceRaw) ? item.budgetLaborUnitPriceRaw : item.budgetLaborUnitPrice;
    return sum + toNumber(item.budgetHours) / hoursPerDay * toNumber(unitPrice);
  }, 0);
  const sumPlannedHours = subProjects.reduce((sum, item) => sum + toNumber(item.plannedCompletedHours), 0);
  const sumEmployeeBudgetHours = employeeBudgets.reduce((sum, item) => sum + toNumber(item.budgetHours), 0);
  const sumArHours = arHours.reduce((sum, item) => sum + toNumber(item.hours), 0);
  const memberBudgetComparisons = buildMemberBudgetComparisons(employeeBudgets, arHours);

  const bac = laborBudget;
  const projectBudgetWithTravel = laborBudget + travelFee;
  const plannedCompletionRatio = safeDivide(sumPlannedHours, sumBudgetHours);
  const cappedPlannedCompletionRatio = plannedCompletionRatio === null ? null : Math.min(plannedCompletionRatio, 1);
  const plannedValue = cappedPlannedCompletionRatio === null ? null : bac * cappedPlannedCompletionRatio;
  const actualCompletionRatio = safeDivide(sumArHours, sumBudgetHours);
  const cappedActualCompletionRatio = actualCompletionRatio === null ? null : Math.min(actualCompletionRatio, 1);
  const earnedValue = cappedActualCompletionRatio === null ? null : bac * cappedActualCompletionRatio;
  const actualCost = sumArHours / hoursPerDay * personDayCost;
  const costVariance = earnedValue === null ? null : earnedValue - actualCost;
  const scheduleVariance = earnedValue === null || plannedValue === null ? null : earnedValue - plannedValue;
  const costPerformanceIndex = safeDivide(earnedValue, actualCost);
  const schedulePerformanceIndex = safeDivide(earnedValue, plannedValue);
  const budgetAllocationDiff = sumEmployeeBudgetHours - sumBudgetHours;
  const budgetAllocationRatio = safeDivide(sumEmployeeBudgetHours, sumBudgetHours);

  const alerts = buildAlerts({
    sumBudgetHours,
    sumPlannedHours,
    sumArHours,
    sumEmployeeBudgetHours,
    budgetAllocationDiff,
    employeeBudgetCount: employeeBudgets.length,
    memberBudgetComparisons,
    actualCompletionRatio,
    costVariance,
    scheduleVariance,
    costPerformanceIndex,
    schedulePerformanceIndex
  });

  return {
    hoursPerDay,
    personDayCost,
    sumBudgetHours: round2(sumBudgetHours),
    laborBudget: round2(laborBudget),
    travelFee: round2(travelFee),
    projectBudgetWithTravel: round2(projectBudgetWithTravel),
    bac: round2(bac),
    sumPlannedHours: round2(sumPlannedHours),
    sumEmployeeBudgetHours: round2(sumEmployeeBudgetHours),
    budgetAllocationDiff: round2(budgetAllocationDiff),
    budgetAllocationRatio: round2(budgetAllocationRatio),
    memberBudgetComparisons,
    plannedCompletionRatio: round2(plannedCompletionRatio),
    plannedValue: round2(plannedValue),
    sumArHours: round2(sumArHours),
    actualCompletionRatio: round2(actualCompletionRatio),
    earnedValue: round2(earnedValue),
    actualCost: round2(actualCost),
    costVariance: round2(costVariance),
    scheduleVariance: round2(scheduleVariance),
    costPerformanceIndex: round2(costPerformanceIndex),
    schedulePerformanceIndex: round2(schedulePerformanceIndex),
    alerts,
    hasRisk: alerts.some(item => item.level === 'risk')
  };
}

function attachComputedMetrics(project) {
  const metrics = computeMetrics(project);
  project.metrics = metrics;
  project.bac = metrics.bac;
  project.projectBudgetWithTravel = metrics.projectBudgetWithTravel;
  return project;
}

function buildAlerts(metrics) {
  const alerts = [];

  if (!metrics.sumBudgetHours) {
    alerts.push({ level: 'warning', code: 'MISSING_BUDGET', text: '缺少子项目预算工时，无法判断进度与绩效。' });
  }
  if (!metrics.employeeBudgetCount) {
    alerts.push({ level: 'warning', code: 'MISSING_EMPLOYEE_BUDGET', text: '尚未填写人员预算工时分配，无法按员工核对预算与 AR。' });
  }
  if (metrics.employeeBudgetCount && metrics.sumBudgetHours > 0 && Math.abs(metrics.budgetAllocationDiff) > 0.01) {
    const direction = metrics.budgetAllocationDiff > 0 ? '高于' : '低于';
    alerts.push({ level: 'warning', code: 'EMPLOYEE_BUDGET_MISMATCH', text: `人员预算工时合计${direction}子项目预算工时，差异 ${Math.abs(metrics.budgetAllocationDiff).toFixed(2)} 小时。` });
  }

  const overBudgetMembers = (metrics.memberBudgetComparisons || []).filter(item => item.isOverBudget).map(item => item.memberName);
  if (overBudgetMembers.length) {
    alerts.push({ level: 'risk', code: 'MEMBER_AR_OVER_BUDGET', text: `${overBudgetMembers.join('、')} 的 AR 工时已超过个人预算工时。` });
  }

  const noBudgetMembers = (metrics.memberBudgetComparisons || []).filter(item => item.hasArButNoBudget).map(item => item.memberName);
  if (noBudgetMembers.length) {
    alerts.push({ level: 'warning', code: 'MEMBER_AR_NO_BUDGET', text: `${noBudgetMembers.join('、')} 有 AR 工时但未分配个人预算工时。` });
  }

  if (metrics.sumArHours > metrics.sumBudgetHours && metrics.sumBudgetHours > 0) {
    alerts.push({ level: 'risk', code: 'AR_OVER_BUDGET', text: 'AR 工时合计已超过子项目预算工时合计。' });
  }
  if (metrics.costVariance !== null && metrics.costVariance < 0) {
    alerts.push({ level: 'risk', code: 'CV_NEGATIVE', text: 'CV（成本偏差）为负，存在超支/亏损风险。' });
  }
  if (metrics.scheduleVariance !== null && metrics.scheduleVariance < 0) {
    alerts.push({ level: 'warning', code: 'SV_NEGATIVE', text: 'SV（进度偏差）为负，实际进度落后于计划。' });
  }
  if (metrics.costPerformanceIndex !== null && metrics.costPerformanceIndex < 1) {
    alerts.push({ level: 'risk', code: 'CPI_LOW', text: 'CPI（成本绩效）小于 1，成本效率低于预期。' });
  }
  if (metrics.schedulePerformanceIndex !== null && metrics.schedulePerformanceIndex < 1) {
    alerts.push({ level: 'warning', code: 'SPI_LOW', text: 'SPI（进度绩效）小于 1，实际进度低于计划。' });
  }
  if (metrics.actualCompletionRatio !== null && metrics.actualCompletionRatio > 1) {
    alerts.push({ level: 'warning', code: 'ACTUAL_OVER_100', text: '实际完成率超过 100%，请确认 AR 工时或预算工时是否准确。' });
  }
  if (!alerts.length) {
    alerts.push({ level: 'normal', code: 'NORMAL', text: '暂无明显异常。' });
  }
  return alerts;
}

function uniqueNames(names) {
  const result = [];
  const seen = {};
  (names || []).forEach(name => {
    const cleanName = normalizeName(name, '');
    if (!cleanName || seen[cleanName]) return;
    seen[cleanName] = true;
    result.push(cleanName);
  });
  return result;
}

function valueMapByMemberName(rows, valueField) {
  const map = {};
  (rows || []).forEach(item => {
    const name = normalizeName(item.memberName, '');
    if (!name) return;
    const value = item[valueField];
    if (map[name] === undefined || !hasMeaningfulValue(map[name])) {
      map[name] = value;
    }
  });
  return map;
}

function openidMapByMemberName(rows) {
  const map = {};
  (rows || []).forEach(item => {
    const name = normalizeName(item.memberName, '');
    if (!name) return;
    const openid = item.memberOpenid || '';
    if (!map[name] && openid) map[name] = openid;
  });
  return map;
}

function normalizeWorkloadAllocations(project) {
  const data = project || {};
  const source = hasMeaningfulValue(data.employeeBudgets) ? data.employeeBudgets : [];
  const rows = [];

  const addRow = (name, budgetHours, id, memberOpenid) => {
    const memberName = normalizeName(name, '');
    if (!memberName) return;
    rows.push({
      id: id || '',
      memberOpenid: memberOpenid || '',
      memberName,
      budgetHours: toAllocationNumber(budgetHours)
    });
  };

  if (Array.isArray(source)) {
    source.forEach(item => {
      if (typeof item === 'string') {
        addRow(item, '');
        return;
      }
      if (!item || typeof item !== 'object') return;
      addRow(
        item.memberName,
        item.budgetHours,
        item.id,
        item.memberOpenid
      );
    });
  }

  const budgetMap = valueMapByMemberName(rows, 'budgetHours');
  const openidMap = openidMapByMemberName(rows);
  return uniqueNames(rows.map(item => item.memberName)).map(name => ({
    id: ((rows || []).find(item => normalizeName(item.memberName, '') === name) || {}).id || '',
    memberOpenid: openidMap[name] || '',
    memberName: name,
    budgetHours: budgetMap[name] === undefined ? '' : budgetMap[name]
  }));
}

function normalizeArHourRows(input) {
  const source = input || [];
  const rows = [];
  const addRow = (name, hours, id) => {
    const memberName = normalizeName(name, '');
    if (!memberName) return;
    rows.push({
      id: id || '',
      memberName,
      hours: toAllocationNumber(hours)
    });
  };

  if (Array.isArray(source)) {
    source.forEach(item => {
      if (typeof item === 'string') {
        addRow(item, '');
        return;
      }
      if (!item || typeof item !== 'object') return;
      addRow(
        item.memberName,
        item.hours,
        item.id
      );
    });
  } else if (typeof source === 'string') {
    normalizeMembers(source).forEach(name => addRow(name, ''));
  } else if (source && typeof source === 'object') {
    Object.keys(source).forEach(name => addRow(name, source[name]));
  }
  return rows;
}

function buildEmployeeBudgetsFromNames(names, existingBudgets) {
  const budgetMap = valueMapByMemberName(existingBudgets, 'budgetHours');
  const openidMap = openidMapByMemberName(existingBudgets);
  return uniqueNames(names).map(name => ({
    id: ((existingBudgets || []).find(item => normalizeName(item.memberName, '') === name) || {}).id || '',
    memberOpenid: openidMap[name] || '',
    memberName: name,
    budgetHours: toAllocationNumber(budgetMap[name])
  }));
}

function ensurePmBudgetRow(rows, projectManager, pmOpenid) {
  const pmName = normalizeName(projectManager, '');
  if (!pmName) return rows || [];
  let hasPm = false;
  const next = (rows || []).map(item => {
    if (normalizeName(item && item.memberName, '') !== pmName) return item;
    hasPm = true;
    return Object.assign({}, item, {
      memberOpenid: item.memberOpenid || pmOpenid || ''
    });
  });
  if (hasPm) return next;
  return next.concat({
    id: '',
    memberOpenid: pmOpenid || '',
    memberName: pmName,
    budgetHours: ''
  });
}

function alignArHoursToEmployeeBudgets(employeeBudgets, existingArHours) {
  const arMap = valueMapByMemberName(existingArHours, 'hours');
  return (employeeBudgets || []).map(item => {
    const name = normalizeName(item.memberName, '');
    const existing = (existingArHours || []).find(ar => normalizeName(ar.memberName, '') === name) || {};
    return {
      id: existing.id || '',
      memberName: name,
      memberOpenid: item.memberOpenid || existing.memberOpenid || '',
      arSheetName: existing.arSheetName || '',
      source: existing.source || '',
      matchedSummaryCount: existing.matchedSummaryCount || 0,
      hours: toAllocationNumber(arMap[name])
    };
  }).filter(item => item.memberName);
}

function memberOpenidsFromBudgets(employeeBudgets) {
  const map = {};
  (employeeBudgets || []).forEach(item => {
    const openid = normalizeText(item && item.memberOpenid);
    if (openid) map[openid] = true;
  });
  return Object.keys(map);
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < (items || []).length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function uniqueTexts(values) {
  const map = {};
  (values || []).forEach(value => {
    const text = normalizeText(value);
    if (text) map[text] = true;
  });
  return Object.keys(map);
}

function sapQueryValues(sapNumbers) {
  const values = [];
  const seen = {};
  uniqueTexts(sapNumbers).forEach(value => {
    const text = normalizeSapNo(value);
    if (!text) return;
    if (!seen[text]) {
      seen[text] = true;
      values.push(text);
    }
    if (/^\d+$/.test(text)) {
      const numeric = Number(text);
      if (Number.isSafeInteger(numeric) && !seen[String(numeric) + '#number']) {
        seen[String(numeric) + '#number'] = true;
        values.push(numeric);
      }
    }
  });
  return values;
}

function resolveArUpdatedAt(row) {
  const values = [row && row.updatedAt, row && row.importedAt, row && row.lastImportAt, row && row.createdAt];
  let bestValue = '';
  let bestTime = 0;
  values.forEach(value => {
    if (!value) return;
    let time = 0;
    if (value instanceof Date) time = value.getTime();
    else if (typeof value === 'number') time = value;
    else if (typeof value === 'string') time = Date.parse(value) || 0;
    else if (typeof value === 'object') time = value.$date || (typeof value.getTime === 'function' ? value.getTime() : 0);
    if (time >= bestTime) {
      bestTime = time;
      bestValue = value;
    }
  });
  return { value: bestValue, time: bestTime };
}

function formatArTimeValue(value, time) {
  const resolved = time || resolveArUpdatedAt({ updatedAt: value }).time;
  if (!resolved) return '';
  const date = new Date(resolved);
  if (Number.isNaN(date.getTime())) return '';
  const shanghaiTime = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const pad2 = n => String(n).padStart(2, '0');
  return [
    shanghaiTime.getUTCFullYear(),
    pad2(shanghaiTime.getUTCMonth() + 1),
    pad2(shanghaiTime.getUTCDate())
  ].join('-') + ' ' + [
    pad2(shanghaiTime.getUTCHours()),
    pad2(shanghaiTime.getUTCMinutes())
  ].join(':');
}

function currentShanghaiDateText() {
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const pad2 = n => String(n).padStart(2, '0');
  return [
    now.getUTCFullYear(),
    pad2(now.getUTCMonth() + 1),
    pad2(now.getUTCDate())
  ].join('-');
}

async function fetchUsersByField(field, values) {
  const texts = uniqueTexts(values);
  if (!texts.length) return [];
  const rows = [];
  for (const chunk of chunkArray(texts, 20)) {
    let skip = 0;
    const pageSize = 100;
    while (true) {
      const res = await users.where({ [field]: _.in(chunk) }).skip(skip).limit(pageSize).get();
      const batch = res.data || [];
      rows.push(...batch);
      if (batch.length < pageSize) break;
      skip += batch.length;
    }
  }
  return rows;
}

function userArSheetName(user) {
  return normalizeText(user && (user.arSheetName || user.name));
}

function collectProjectMembers(project) {
  const rows = [];
  (project.employeeBudgets || []).forEach(item => rows.push({
    memberName: normalizeText(item.memberName),
    memberOpenid: normalizeText(item.memberOpenid)
  }));
  (project.arHours || []).forEach(item => rows.push({
    memberName: normalizeText(item.memberName),
    memberOpenid: normalizeText(item.memberOpenid)
  }));
  return uniqueNames(rows.map(item => item.memberName)).map(name => {
    const source = rows.find(item => normalizeText(item.memberName) === name) || {};
    return { memberName: name, memberOpenid: source.memberOpenid || '' };
  });
}

function collectProjectSapItemPairs(project) {
  const pairs = [];
  const addPair = (sapValue, itemValue) => {
    const sapOrderNo = normalizeSapNo(sapValue);
    if (!sapOrderNo) return;
    pairs.push({
      sapOrderNo,
      itemNo: normalizeText(itemValue) || '1000'
    });
  };

  const activeBindings = normalizeSapBindingList(project).filter(item => item.active !== false);
  activeBindings.forEach(item => addPair(item.sapOrderNo, item.itemNo));

  const seen = {};
  return pairs.filter(item => {
    const key = `${item.sapOrderNo}#${item.itemNo}`;
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

async function buildMemberSheetResolver(projectsInput) {
  const projectsList = projectsInput || [];
  const members = [];
  projectsList.forEach(project => members.push(...collectProjectMembers(project)));
  const openids = uniqueTexts(members.map(item => item.memberOpenid));
  const names = uniqueTexts(members.map(item => item.memberName));
  const userRows = []
    .concat(await fetchUsersByField('openid', openids))
    .concat(await fetchUsersByField('name', names))
    .concat(await fetchUsersByField('arSheetName', names));
  const byOpenid = {};
  const byName = {};
  userRows.forEach(user => {
    if (!user || user.deleted === true) return;
    const sheetName = userArSheetName(user);
    if (!sheetName) return;
    [user.openid].forEach(id => {
      const key = normalizeText(id);
      if (key && !byOpenid[key]) byOpenid[key] = sheetName;
    });
    [user.name, user.arSheetName].forEach(name => {
      const key = normalizeText(name);
      if (key && !byName[key]) byName[key] = sheetName;
    });
  });
  return member => byOpenid[normalizeText(member.memberOpenid)] || byName[normalizeText(member.memberName)] || normalizeText(member.memberName);
}

async function enrichEmployeeBudgetOpenids(project) {
  const data = Object.assign({}, project || {});
  const employeeBudgets = Array.isArray(data.employeeBudgets) ? data.employeeBudgets : [];
  const missingNames = uniqueTexts(employeeBudgets
    .filter(item => !normalizeText(item && item.memberOpenid))
    .map(item => item && item.memberName));

  if (!missingNames.length) {
    data.memberOpenids = memberOpenidsFromBudgets(employeeBudgets);
    return data;
  }

  const usersByName = await resolveUsersByNames(missingNames);

  data.employeeBudgets = employeeBudgets.map(item => {
    const name = normalizeText(item && item.memberName);
    const matches = usersByName[name] || [];
    const matchedOpenid = matches.length === 1 ? matches[0].openid : '';
    const memberOpenid = normalizeText(item && item.memberOpenid) || matchedOpenid || '';
    return Object.assign({}, item, { memberOpenid });
  });
  data.memberOpenids = memberOpenidsFromBudgets(data.employeeBudgets);
  return data;
}

async function resolveUsersByNames(names) {
  const cleanNames = uniqueTexts(names);
  if (!cleanNames.length) return {};
  const rows = []
    .concat(await fetchUsersByField('name', cleanNames))
    .concat(await fetchUsersByField('arSheetName', cleanNames));
  const matches = {};
  rows.forEach(user => {
    if (!user || user.deleted === true || user.active === false) return;
    const openid = normalizeText(user.openid);
    if (!openid) return;
    [user.name, user.arSheetName].forEach(name => {
      const key = normalizeText(name);
      if (!key) return;
      if (!matches[key]) matches[key] = {};
      matches[key][openid] = {
        openid,
        name: normalizeText(user.name),
        arSheetName: normalizeText(user.arSheetName)
      };
    });
  });
  const resolved = {};
  Object.keys(matches).forEach(name => {
    const usersForName = Object.keys(matches[name]).map(openid => matches[name][openid]);
    resolved[name] = usersForName;
  });
  return resolved;
}

async function attachArMemberCandidates(project) {
  const data = Object.assign({}, project || {});
  const arHours = Array.isArray(data.arHours) ? data.arHours : [];
  if (!arHours.length) {
    data.arMemberCandidates = [];
    return data;
  }

  const memberOpenids = uniqueTexts(data.memberOpenids || []);
  const budgetRows = data.employeeBudgets || [];
  const resolvedUsers = await resolveUsersByNames(arHours.map(item => item && (item.arSheetName || item.memberName)));
  const sapNumbersByMember = {};
  (Array.isArray(data.arDetails) ? data.arDetails : []).forEach(detail => {
    const memberName = normalizeText(detail && detail.employeeName);
    const sapOrderNo = normalizeSapNo(detail && detail.sapOrderNo);
    if (!memberName || !sapOrderNo) return;
    if (!sapNumbersByMember[memberName]) sapNumbersByMember[memberName] = [];
    sapNumbersByMember[memberName].push(sapOrderNo);
  });

  data.arMemberCandidates = arHours
    .map(item => {
      const memberName = normalizeText(item && item.memberName);
      const arSheetName = normalizeText(item && item.arSheetName) || memberName;
      if (!memberName) return null;
      const matches = uniqueTexts([memberName, arSheetName])
        .reduce((acc, name) => acc.concat(resolvedUsers[name] || []), []);
      const seen = {};
      const uniqueMatches = matches.filter(user => {
        if (!user || !user.openid || seen[user.openid]) return false;
        seen[user.openid] = true;
        return true;
      });
      const matchedOpenid = uniqueMatches.length === 1 ? uniqueMatches[0].openid : '';
      const alreadyMember = !!matchedOpenid && (
        memberOpenids.indexOf(matchedOpenid) >= 0 ||
        budgetRows.some(row => normalizeText(row && row.memberOpenid) === matchedOpenid)
      );
      const matchStatus = alreadyMember
        ? 'alreadyMember'
        : (matchedOpenid ? 'matched' : (uniqueMatches.length > 1 ? 'ambiguous' : 'unmatched'));
      return {
        memberName,
        arSheetName,
        sapNumbers: uniqueTexts(sapNumbersByMember[memberName] || sapNumbersByMember[arSheetName] || []),
        hours: item.hours,
        matchedSummaryCount: item.matchedSummaryCount || 0,
        memberOpenid: matchedOpenid,
        matchStatus,
        matchStatusText: matchStatus === 'alreadyMember'
          ? '已在项目组'
          : (matchStatus === 'matched' ? '可添加' : (matchStatus === 'ambiguous' ? '存在重名，请手动确认' : '未匹配账号')),
        canAdd: matchStatus === 'matched'
      };
    })
    .filter(Boolean);
  return data;
}

async function prepareProjectForSave(input, user, openid, existingProject) {
  const cleaned = cleanProjectInput(input, user, openid, existingProject);
  const enriched = await enrichEmployeeBudgetOpenids(cleaned);
  return attachComputedMetrics(enriched);
}

async function fetchArSummariesForProjects(projectsInput) {
  const projectsList = projectsInput || [];
  const sapNumbers = [];
  projectsList.forEach(project => {
    const sapBindings = normalizeSapBindingList(project).filter(item => item.active !== false);
    const projectSapList = uniqueTexts(collectSapNos(project)
      .concat(collectProjectSapItemPairs(project).map(pair => pair.sapOrderNo)))
      .map(normalizeSapNo)
      .filter(Boolean);
    sapNumbers.push(...projectSapList);
  });
  const uniqueSapNos = uniqueTexts(sapNumbers).map(normalizeSapNo).filter(Boolean);
  const querySapValues = sapQueryValues(uniqueSapNos);
  if (!querySapValues.length) return [];
  const rows = [];
  const fieldSpec = {
    sapOrderNo: true,
    itemNo: true,
    employeeName: true,
    totalArHours: true,
    recordCount: true,
    updatedAt: true,
    importedAt: true,
    lastImportAt: true,
    createdAt: true,
    sheetName: true,
    active: true
  };
  const fetchByQuery = async (query, label, chunkValues) => {
    let skip = 0;
    while (true) {
      const res = await arSummaries
        .where(query)
        .field(fieldSpec)
        .skip(skip)
        .limit(100)
        .get();
      const batch = res.data || [];
      rows.push(...batch);
      if (batch.length < 100) break;
      skip += batch.length;
    }
  };
  for (const chunk of chunkArray(querySapValues, 20)) {
    await fetchByQuery({ active: _.neq(false), sapOrderNo: _.in(chunk) }, 'active-not-false', chunk);
  }
  const seen = {};
  return rows.filter(row => {
    if (!row || row.active === false) return false;
    const key = row._id || `${normalizeSapNo(row.sapOrderNo)}#${normalizeText(row.itemNo)}#${normalizeText(row.employeeName || row.sheetName)}#${Number(row.totalArHours || 0)}`;
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

function emptyArEnrichedProject(project, warningText) {
  return attachComputedMetrics(Object.assign({}, project, {
    arHours: [],
    arDetails: [],
    arSummary: { totalArHours: 0, matchedSummaryCount: 0, latestUpdatedAt: '', latestUpdatedAtText: '' },
    arTimeWarning: warningText || ''
  }));
}

function mergeArHoursForProject(project, summaryRows) {
  const pairs = collectProjectSapItemPairs(project);
  const activeBindings = normalizeSapBindingList(project).filter(item => item.active !== false);
  if (!activeBindings.length) {
    return emptyArEnrichedProject(project, '当前项目没有有效 SAP 绑定，AR Time 将无法匹配。');
  }
  const sapSet = {};
  pairs.forEach(pair => {
    sapSet[pair.sapOrderNo] = true;
  });
  collectSapNos(project).forEach(sapNo => {
    sapSet[sapNo] = true;
  });
  const detailMap = {};
  const memberMap = {};
  let latest = { value: '', time: 0 };
  let matchedSummaryCount = 0;
  (summaryRows || []).forEach(row => {
    const sapOrderNo = normalizeSapNo(row.sapOrderNo);
    const itemNo = normalizeText(row.itemNo) || '1000';
    if (!sapSet[sapOrderNo]) return;
    matchedSummaryCount += 1;
    const rowUpdatedAt = resolveArUpdatedAt(row);
    if (rowUpdatedAt.time >= latest.time) latest = rowUpdatedAt;
    const employeeName = normalizeText(row.employeeName || row.sheetName) || '-';
    const detailKey = `${employeeName}#${sapOrderNo}#${itemNo}`;
    if (!detailMap[detailKey]) {
      detailMap[detailKey] = { employeeName, sapOrderNo, itemNo, totalArHours: 0, recordCount: 0 };
    }
    detailMap[detailKey].totalArHours += Number(row.totalArHours || 0);
    detailMap[detailKey].recordCount += toNumber(row.recordCount);
    if (!memberMap[employeeName]) {
      memberMap[employeeName] = { memberName: employeeName, arSheetName: normalizeText(row.sheetName) || employeeName, source: 'ar_summaries', matchedSummaryCount: 0, hours: 0 };
    }
    memberMap[employeeName].hours += Number(row.totalArHours || 0);
    memberMap[employeeName].matchedSummaryCount += 1;
  });
  const arDetails = Object.keys(detailMap).map(key => Object.assign({}, detailMap[key], {
    totalArHours: round2(detailMap[key].totalArHours),
    recordCount: round2(detailMap[key].recordCount)
  })).sort((a, b) => {
    const nameDiff = a.employeeName.localeCompare(b.employeeName);
    if (nameDiff) return nameDiff;
    const sapDiff = a.sapOrderNo.localeCompare(b.sapOrderNo);
    return sapDiff || a.itemNo.localeCompare(b.itemNo);
  });
  const arHours = Object.keys(memberMap).map(name => Object.assign({}, memberMap[name], {
    id: '',
    memberOpenid: '',
    hours: round2(memberMap[name].hours)
  })).sort((a, b) => a.memberName.localeCompare(b.memberName));
  const arSummary = {
    totalArHours: round2(arHours.reduce((sum, item) => sum + toNumber(item.hours), 0)),
    matchedSummaryCount,
    latestUpdatedAt: latest.value || '',
    latestUpdatedAtText: formatArTimeValue(latest.value, latest.time)
  };
  return attachComputedMetrics(Object.assign({}, project, { arHours, arDetails, arSummary, arTimeWarning: '' }));
}

async function enrichProjectsWithArSummaries(projectsInput, options) {
  const projectsList = projectsInput || [];
  const opts = options || {};
  if (!projectsList.length) return projectsList;
  try {
    const summaryRows = await fetchArSummariesForProjects(projectsList);
    const enriched = projectsList.map(project => mergeArHoursForProject(project, summaryRows));
    return opts.includeArMemberCandidates ? await Promise.all(enriched.map(attachArMemberCandidates)) : enriched;
  } catch (err) {
    console.error('[projectService] 查询 ar_summaries 失败：', err);
    return projectsList.map(project => emptyArEnrichedProject(project, 'AR Time 暂时无法加载。'));
  }
}

function getUserName(user) {
  return normalizeText(user && (user.name || user.displayName || user.userName));
}

function assertUserName(user) {
  if (!getUserName(user)) throw new Error('请先在“我的”页填写姓名。');
}

function cleanProjectInput(input, user, openid, existingProject) {
  const project = input || {};
  const existing = existingProject || {};
  const currentUserName = getUserName(user);
  const hasExisting = !!(existingProject && (existingProject._id || existingProject.createdBy || existingProject.pmName || existingProject.projectManager));
  const projectManager = String(hasExisting
    ? (existing.pmName || existing.projectManager || project.pmName || project.projectManager || currentUserName || '')
    : (currentUserName || project.pmName || project.projectManager || '')).trim();
  const pmOpenid = String(hasExisting
    ? (existing.pmOpenid || existing.createdBy || project.pmOpenid || openid || '')
    : (openid || project.pmOpenid || '')).trim();
  const rawEmployeeBudgets = normalizeWorkloadAllocations(project);
  const pmBudgetRows = ensurePmBudgetRow(rawEmployeeBudgets, projectManager, pmOpenid);
  const status = normalizeText(project.status || existing.status || 'active') || 'active';
  const wasCompleted = normalizeText(existing.status) === 'completed';
  const closedAt = status === 'completed'
    ? (wasCompleted ? normalizeText(existing.closedAt || project.closedAt) : (normalizeText(project.closedAt) || currentShanghaiDateText()))
    : '';

  const submittedEmployeeNames = rawEmployeeBudgets.map(item => item.memberName);
  const employeeNames = uniqueNames([projectManager].concat(submittedEmployeeNames));
  const employeeBudgets = buildEmployeeBudgetsFromNames(employeeNames, pmBudgetRows);
  const sapBindings = normalizeSapBindingList(project);
  const sapNumbers = uniqueTexts(sapBindings.filter(item => item.active !== false).map(item => item.sapOrderNo));

  return {
    clientRequestId: String(project.clientRequestId || existing.clientRequestId || '').trim(),
    projectName: String(project.projectName || '').trim(),
    customerName: String(project.customerName || '').trim(),
    projectNo: String(project.projectNo || '').trim(),
    startDate: String(project.startDate || '').trim(),
    endDate: String(project.endDate || '').trim(),
    projectManager,
    pmOpenid,
    pmName: projectManager,
    status,
    closedAt,
    travelFee: toNumber(project.travelFee),
    clientName: String(project.clientName || project.customerName || '').trim(),
    sapNumbers,
    sapBindings,
    precalId: String(project.precalId || '').trim(),
    precalNo: String(project.precalNo || '').trim(),
    service: String(project.service || '').trim(),
    salesOwnerName: String(project.salesOwnerName || '').trim(),
    orderValue: toOptionalNumber(project.orderValue),
    totalMd: toOptionalNumber(project.totalMd),
    workingMd: toOptionalNumber(project.workingMd),
    travelMd: toOptionalNumber(project.travelMd),
    quotationMd: toOptionalNumber(project.quotationMd),
    allocatableHours: toOptionalNumber(project.allocatableHours),
    budgetTotalHours: toOptionalNumber(project.budgetTotalHours || project.budgetHours || project.allocatableHours),
    budgetHours: toOptionalNumber(project.budgetHours || project.budgetTotalHours || project.allocatableHours),
    precalProjectBudget: toOptionalNumber(firstMeaningfulValue([project.precalProjectBudget, existing.precalProjectBudget, project.projectTotalBudget, project.totalBudget, project.orderValue])),
    projectTotalBudget: toOptionalNumber(firstMeaningfulValue([project.projectTotalBudget, project.totalBudget, project.precalProjectBudget, project.orderValue])),
    totalBudget: toOptionalNumber(firstMeaningfulValue([project.totalBudget, project.projectTotalBudget, project.precalProjectBudget, project.orderValue])),
    bac: '',
    operatingMargin: toOptionalNumber(project.operatingMargin),
    itemList: normalizeItemList(project),
    constants: {
      hoursPerDay: 8,
      personDayCost: toNumber(project.constants && project.constants.personDayCost) || 5000
    },
    subProjects: Array.isArray(project.subProjects) ? project.subProjects.map(item => ({
      id: item.id || '',
      name: String(item.name || '').trim(),
      subProjectNo: String(item.subProjectNo || item.itemNo || '').trim(),
      itemNo: String(item.itemNo || '').trim(),
      itemDescription: String(item.itemDescription || '').trim(),
      workingMd: toOptionalNumber(item.workingMd),
      allocatableHours: toOptionalNumber(item.allocatableHours),
      budgetHours: toOptionalNumber(item.budgetHours),
      travelFee: toOptionalNumber(item.travelFee),
      budgetLaborUnitPriceRaw: toOptionalNumber(item.budgetLaborUnitPriceRaw),
      budgetLaborUnitPrice: toOptionalNumber(item.budgetLaborUnitPrice),
      plannedCompletedHours: toOptionalNumber(item.plannedCompletedHours)
    })) : [],
    employeeBudgets,
    memberOpenids: memberOpenidsFromBudgets(employeeBudgets)
  };
}
function normalizeText(value) {
  return String(value || '').trim();
}

function uniqueRoles(records) {
  const roleMap = {};
  (records || []).forEach(item => {
    normalizeRoles(item).forEach(role => {
      if (role) roleMap[role] = true;
    });
  });
  const roles = Object.keys(roleMap);
  return roles.length ? roles : DEFAULT_ROLES.slice();
}

function userScore(user, openid) {
  let score = 0;
  if (user && user._id === openid) score += 1000;
  if (user && user.deleted !== true) score += 100;
  if (user && user.active !== false) score += 50;
  if (normalizeText(user && user.name)) score += 10;
  const roles = normalizeRoles(user);
  if (roles.indexOf('admin') >= 0) score += 5;
  if (roles.indexOf('sales') >= 0) score += 3;
  if (roles.indexOf('cs') >= 0) score += 2;
  return score;
}

function pickPrimaryUser(records, openid) {
  return (records || []).slice().sort((a, b) => {
    const diff = userScore(b, openid) - userScore(a, openid);
    if (diff) return diff;
    return String(a._id || '').localeCompare(String(b._id || ''));
  })[0] || null;
}

function buildMergedUser(primary, openid, now) {
  const roles = uniqueRoles([primary]);
  return {
    openid,
    name: normalizeText(primary && primary.name),
    arSheetName: normalizeText(primary && primary.arSheetName),
    roles,
    active: primary && primary.active === false ? false : true,
    deleted: false,
    version: Number(primary && primary.version || 1) || 1,
    createdAt: primary && primary.createdAt || now,
    updatedAt: now
  };
}

async function findUserRecords(openid) {
  const fetchByQuery = async query => {
    const rows = [];
    let skip = 0;
    const pageSize = 100;
    while (true) {
      const res = await users.where(query).skip(skip).limit(pageSize).get();
      const batch = res.data || [];
      rows.push(...batch);
      if (batch.length < pageSize) break;
      skip += batch.length;
    }
    return rows;
  };
  const byOpenid = await fetchByQuery({ openid });
  const bySystemOpenid = await fetchByQuery({ _openid: openid });
  let byDocId = null;
  try {
    const doc = await users.doc(openid).get();
    byDocId = doc && doc.data;
  } catch (err) {}
  const seen = {};
  return []
    .concat(byDocId ? [byDocId] : [])
    .concat(byOpenid)
    .concat(bySystemOpenid)
    .filter(item => {
      const key = item && item._id;
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
    });
}

async function removeDuplicateUsers(records, primaryId) {
  const duplicates = (records || []).filter(item => item && item._id && item._id !== primaryId);
  const now = db.serverDate();
  await Promise.all(duplicates.map(item => users.doc(item._id).update({
    data: {
      deleted: true,
      active: false,
      duplicateOf: primaryId,
      duplicateArchivedAt: now,
      updatedAt: now,
      version: _.inc(1)
    }
  }).catch(err => {
    console.warn('标记重复用户记录失败：', item._id, err);
  })));
  return duplicates.length;
}

async function getCurrentUser(openid) {
  const now = db.serverDate();
  const records = await findUserRecords(openid);
  const primary = pickPrimaryUser(records, openid);

  if (primary) {
    const mergedUser = buildMergedUser(primary, openid, now);
    await users.doc(primary._id).update({ data: mergedUser });
    await removeDuplicateUsers(records, primary._id);
    return Object.assign({ _id: primary._id }, primary, mergedUser);
  }

  const newUser = buildMergedUser({ _id: openid, roles: DEFAULT_ROLES }, openid, now);
  try {
    await users.doc(openid).set({ data: newUser });
    return Object.assign({ _id: openid }, newUser);
  } catch (err) {
    const retryRecords = await findUserRecords(openid);
    const retryPrimary = pickPrimaryUser(retryRecords, openid);
    if (retryPrimary) {
      const mergedUser = buildMergedUser(retryPrimary, openid, now);
      await users.doc(retryPrimary._id).update({ data: mergedUser });
      await removeDuplicateUsers(retryRecords, retryPrimary._id);
      return Object.assign({ _id: retryPrimary._id }, retryPrimary, mergedUser);
    }
    throw err;
  }
}

function normalizeRoles(user) {
  const seen = {};
  const result = [];
  const add = role => {
    const clean = normalizeText(role);
    if (ALLOWED_ROLE_MAP[clean] && !seen[clean]) {
      seen[clean] = true;
      result.push(clean);
    }
  };
  if (user && Array.isArray(user.roles) && user.roles.length) user.roles.forEach(add);
  if (!result.length) DEFAULT_ROLES.forEach(add);
  return result;
}

function hasRole(user, role) {
  return normalizeRoles(user).indexOf(role) >= 0;
}

function hasAnyRole(user, roles) {
  const userRoles = normalizeRoles(user);
  return (roles || []).some(role => userRoles.indexOf(role) >= 0);
}

function assertActive(user, message) {
  if (!user || user.active === false) throw new Error(message || '账号未激活，无法执行该操作。');
}

function assertRole(user, role, message) {
  if (!hasRole(user, role)) throw new Error(message || '无权限执行该操作。');
}

function assertAnyRole(user, roles, message) {
  if (!hasAnyRole(user, roles)) throw new Error(message || '无权限执行该操作。');
}

function resolveServerDateMs(value) {
  if (!value) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : null;
  }
  if (typeof value === 'object') {
    if (typeof value.getTime === 'function') return value.getTime();
    if (value.$date && typeof value.$date === 'number') return value.$date;
  }
  return null;
}

function isCreatingLockFresh(record, nowMs) {
  if (!record || !record.creatingProject) return false;
  const lockAt = resolveServerDateMs(record.creatingProjectAt);
  if (!lockAt) return true;
  return nowMs - lockAt <= CREATE_FROM_SAP_LOCK_TIMEOUT_MS;
}

function canViewAll(user) {
  return hasAnyRole(user, ['admin', 'ar']);
}

function canEditAll(user) {
  return hasRole(user, 'admin');
}

function currentUserOpenids(openid, user) {
  return uniqueTexts([openid, user && user.openid]);
}

function ownsProject(project, openid, user) {
  if (!project) return false;
  const openids = currentUserOpenids(openid, user);
  const ownerIds = uniqueTexts([project.ownerOpenid, project.createdBy, project.pmOpenid]);
  return openids.some(id => ownerIds.indexOf(id) >= 0);
}

function memberMatchesUserByOpenid(member, openids) {
  const memberIds = uniqueTexts([member && member.memberOpenid]);
  return memberIds.length && openids.some(id => memberIds.indexOf(id) >= 0);
}

function isProjectMember(project, openid, user) {
  if (!project) return false;
  const openids = currentUserOpenids(openid, user);
  const memberOpenids = uniqueTexts(project.memberOpenids || []);
  if (memberOpenids.length && openids.some(id => memberOpenids.indexOf(id) >= 0)) return true;
  const employeeBudgets = project.employeeBudgets || [];
  if (employeeBudgets.some(item => memberMatchesUserByOpenid(item, openids))) return true;
  return false;
}

function getMyAllocation(project, openid, user) {
  const openids = currentUserOpenids(openid, user);
  const budgets = project && project.employeeBudgets || [];
  const arRows = project && project.arHours || [];
  const budgetByOpenid = budgets.find(item => memberMatchesUserByOpenid(item, openids)) || null;
  const budget = budgetByOpenid || null;
  const ar = budget ? arRows.find(item => normalizeName(item && item.memberName, '') === normalizeName(budget.memberName, '')) : null;
  const budgetHours = budget ? toAllocationNumber(budget.budgetHours) : '';
  const actualHours = ar ? toAllocationNumber(ar.hours) : '';
  const hasBudgetHours = budgetHours !== '';
  const hasActualHours = actualHours !== '';
  return {
    memberName: normalizeText(budget && budget.memberName) || normalizeText(ar && ar.memberName) || '',
    budgetHours,
    actualHours,
    remainingHours: hasBudgetHours ? round2(toNumber(budgetHours) - toNumber(actualHours)) : '',
    hasBudgetHours,
    hasActualHours
  };
}

function canView(project, openid, user) {
  if (canViewAll(user)) return true;
  return ownsProject(project, openid, user) || isProjectMember(project, openid, user);
}

function canEdit(project, openid, user) {
  if (canEditAll(user)) return true;
  return ownsProject(project, openid, user);
}

function decorateProjectAccess(project, openid, user) {
  const editable = canEdit(project, openid, user);
  const viewAll = canViewAll(user);
  const member = isProjectMember(project, openid, user);
  return Object.assign({}, project, {
    _canEdit: editable,
    _canViewAll: viewAll,
    _canViewFullProject: editable || viewAll,
    _canViewAllAllocations: editable || viewAll,
    _isOwnProject: ownsProject(project, openid, user),
    _isProjectMember: member,
    _myAllocation: getMyAllocation(project, openid, user)
  });
}

function isActiveProjectStatus(status) {
  const value = normalizeText(status || 'active').toLowerCase();
  return ['closed', 'archived', 'completed', 'done', 'cancelled', 'canceled'].indexOf(value) < 0;
}

function normalizePageOptions(payload, defaultPageSize, maxPageSize) {
  const page = Math.max(1, parseInt(payload && payload.page, 10) || 1);
  const rawPageSize = parseInt(payload && payload.pageSize, 10) || defaultPageSize || 20;
  const pageSize = Math.min(maxPageSize || 50, Math.max(1, rawPageSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function projectKeywordMatch(project, keyword) {
  const key = normalizeText(keyword).toLowerCase();
  if (!key) return true;
  const sapText = normalizeSapBindingList(project).map(item => item.sapOrderNo).join(' ');
  const text = [
    project && project.projectName,
    project && project.projectNo,
    project && project.customerName,
    project && project.projectManager,
    project && project.pmName,
    project && project.precalNo,
    sapText
  ].join(' ').toLowerCase();
  return text.indexOf(key) >= 0;
}

async function countProjectsByQuery(query) {
  const res = await projects.where(query || {}).count();
  return Number(res && res.total || 0);
}

async function countInactiveProjects(baseQuery) {
  const inactiveStatuses = ['closed', 'archived', 'completed', 'done', 'cancelled', 'canceled'];
  const counts = await Promise.all(inactiveStatuses.map(status => countProjectsByQuery(Object.assign({}, baseQuery, { status }))));
  return counts.reduce((sum, count) => sum + count, 0);
}

async function listVisibleProjectRows(openid, user, options) {
  const opts = options || {};
  const pageSize = 100;
  const rows = [];
  const seen = {};
  const collect = async query => {
    let skip = 0;
    while (true) {
      let res;
      try {
        let request = projects.where(query);
        if (opts.orderByUpdatedAt !== false) request = request.orderBy('updatedAt', 'desc');
        if (opts.fieldProjection) request = request.field(opts.fieldProjection);
        res = await request.skip(skip).limit(pageSize).get();
      } catch (err) {
        console.warn('[projectService] 项目列表查询失败，已跳过条件：', query, err && err.message || err);
        break;
      }
      const batch = res.data || [];
      batch.forEach(item => {
        if (!item || !item._id || seen[item._id]) return;
        seen[item._id] = true;
        rows.push(item);
      });
      if (batch.length < pageSize) break;
      skip += batch.length;
    }
  };

  if (canViewAll(user) && !opts.forcePersonalScope) {
    await collect({ deleted: _.neq(true) });
  } else {
    const openids = currentUserOpenids(openid, user);
    for (const chunk of chunkArray(openids, 20)) {
      await collect({ deleted: _.neq(true), ownerOpenid: _.in(chunk) });
      await collect({ deleted: _.neq(true), createdBy: _.in(chunk) });
      await collect({ deleted: _.neq(true), pmOpenid: _.in(chunk) });
      await collect({ deleted: _.neq(true), memberOpenids: _.in(chunk) });
      if (opts.includeEmployeeBudgetMemberQuery !== false) {
        await collect({ deleted: _.neq(true), 'employeeBudgets.memberOpenid': _.in(chunk) });
      }
    }
  }

  const visibleRows = rows
    .filter(item => item.deleted !== true)
    .filter(item => opts.skipCanViewFilter ? true : canView(item, openid, user))
    .sort((a, b) => resolveServerDateMs(b.updatedAt) - resolveServerDateMs(a.updatedAt));
  return visibleRows;
}

function summarizeMetricsForList(metrics) {
  const source = metrics || {};
  const result = Object.assign({}, source);
  delete result.memberBudgetComparisons;
  return result;
}

function summarizeProjectForList(project, openid, user) {
  const decorated = decorateProjectAccess(project, openid, user);
  const metrics = decorated._canViewFullProject
    ? summarizeMetricsForList(decorated.metrics || computeMetrics(decorated))
    : { hasRisk: false, alerts: [] };
  return {
    _id: decorated._id,
    projectName: decorated.projectName || '',
    projectNo: decorated.projectNo || '',
    customerName: decorated.customerName || '',
    projectManager: decorated.projectManager || '',
    pmName: decorated.pmName || '',
    status: decorated.status || '',
    closedAt: decorated.closedAt || '',
    startDate: decorated.startDate || '',
    endDate: decorated.endDate || '',
    updatedAt: decorated.updatedAt || '',
    metrics,
    arSummary: decorated.arSummary || {
      totalArHours: decorated._canViewFullProject ? (metrics.sumArHours || 0) : 0,
      matchedSummaryCount: 0,
      latestUpdatedAt: '',
      latestUpdatedAtText: ''
    },
    _canEdit: decorated._canEdit,
    _canViewAll: decorated._canViewAll,
    _canViewFullProject: decorated._canViewFullProject,
    _canViewAllAllocations: decorated._canViewAllAllocations,
    _isOwnProject: decorated._isOwnProject,
    _isProjectMember: decorated._isProjectMember,
    _myAllocation: decorated._myAllocation
  };
}

async function listProjects(openid, user) {
  const visibleRows = await listVisibleProjectRows(openid, user);
  const enrichedRows = await enrichProjectsWithArSummaries(visibleRows);
  return enrichedRows.map(item => summarizeProjectForList(item, openid, user));
}

async function listProjectsPage(openid, user, payload) {
  const pageOptions = normalizePageOptions(payload, 20, 50);
  const keyword = normalizeText(payload && payload.keyword);
  const filter = normalizeText(payload && payload.filter) || 'all';
  const canUseAdminDirectPage = canViewAll(user) && !keyword && filter === 'all';

  if (canUseAdminDirectPage) {
    const query = { deleted: _.neq(true) };
    const total = await countProjectsByQuery(query);
    const res = await projects
      .where(query)
      .orderBy('updatedAt', 'desc')
      .skip(pageOptions.offset)
      .limit(pageOptions.pageSize)
      .get();
    const enrichedRows = await enrichProjectsWithArSummaries(res.data || []);
    return {
      projects: enrichedRows.map(item => summarizeProjectForList(item, openid, user)),
      page: pageOptions.page,
      pageSize: pageOptions.pageSize,
      total,
      hasMore: pageOptions.offset + pageOptions.pageSize < total
    };
  }

  let rows = await listVisibleProjectRows(openid, user);
  rows = rows.filter(item => projectKeywordMatch(item, keyword));

  if (filter === 'risk' || filter === 'normal') {
    const enrichedRows = await enrichProjectsWithArSummaries(rows);
    const filteredRows = enrichedRows.filter(item => {
      const hasRisk = !!(item.metrics && item.metrics.hasRisk);
      return filter === 'risk' ? hasRisk : !hasRisk;
    });
    const pageRows = filteredRows.slice(pageOptions.offset, pageOptions.offset + pageOptions.pageSize);
    return {
      projects: pageRows.map(item => summarizeProjectForList(item, openid, user)),
      page: pageOptions.page,
      pageSize: pageOptions.pageSize,
      total: filteredRows.length,
      hasMore: pageOptions.offset + pageOptions.pageSize < filteredRows.length
    };
  }

  const total = rows.length;
  const pageRows = rows.slice(pageOptions.offset, pageOptions.offset + pageOptions.pageSize);
  const enrichedRows = await enrichProjectsWithArSummaries(pageRows);
  return {
    projects: enrichedRows.map(item => summarizeProjectForList(item, openid, user)),
    page: pageOptions.page,
    pageSize: pageOptions.pageSize,
    total,
    hasMore: pageOptions.offset + pageOptions.pageSize < total
  };
}

async function listProjectsForExport(openid, user) {
  const visibleRows = await listVisibleProjectRows(openid, user);
  const enrichedRows = await enrichProjectsWithArSummaries(visibleRows);
  return enrichedRows.map(item => decorateProjectAccess(item, openid, user));
}

async function getDashboardOverview(openid, user) {
  const projection = {
    _id: true,
    status: true,
    ownerOpenid: true,
    createdBy: true,
    pmOpenid: true,
    memberOpenids: true,
    deleted: true,
    updatedAt: true
  };
  const baseQuery = { deleted: _.neq(true) };

  if (canViewAll(user)) {
    const total = await countProjectsByQuery(baseQuery);
    const inactive = await countInactiveProjects(baseQuery);
    const personalRows = await listVisibleProjectRows(openid, user, {
      fieldProjection: projection,
      includeEmployeeBudgetMemberQuery: false,
      skipCanViewFilter: true,
      forcePersonalScope: true,
      orderByUpdatedAt: false
    });
    const personalStats = personalRows.reduce((acc, project) => {
      if (ownsProject(project, openid, user)) acc.owned += 1;
      if (isProjectMember(project, openid, user) && !ownsProject(project, openid, user)) acc.participated += 1;
      return acc;
    }, { owned: 0, participated: 0 });
    return {
      projectStats: {
        total,
        active: Math.max(0, total - inactive),
        owned: personalStats.owned,
        participated: personalStats.participated
      },
      scopeText: '当前为管理视角，统计所有可见项目概览。'
    };
  }

  const visibleRows = await listVisibleProjectRows(openid, user, {
    fieldProjection: projection,
    includeEmployeeBudgetMemberQuery: false,
    skipCanViewFilter: true,
    orderByUpdatedAt: false
  });
  const stats = visibleRows.reduce((acc, project) => {
    acc.total += 1;
    if (isActiveProjectStatus(project.status)) acc.active += 1;
    if (ownsProject(project, openid, user)) acc.owned += 1;
    if (isProjectMember(project, openid, user) && !ownsProject(project, openid, user)) acc.participated += 1;
    return acc;
  }, { total: 0, active: 0, owned: 0, participated: 0 });
  return {
    projectStats: stats,
    scopeText: '当前为个人视角，统计我负责或参与的项目概览。'
  };
}

async function getProjectById(id) {
  if (!id) return null;
  try {
    const res = await projects.doc(id).get();
    const data = res.data || null;
    if (data && data.deleted === true) return null;
    return data;
  } catch (err) {
    return null;
  }
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = String(value).replace(/"/g, '""');
  return /[",\n\r]/.test(text) ? `"${text}"` : text;
}

function buildMemberBudgetText(metrics) {
  return (metrics.memberBudgetComparisons || []).map(item => {
    const usage = item.usageRatio === null || item.usageRatio === undefined ? '' : `${(Number(item.usageRatio) * 100).toFixed(2)}%`;
    return `${item.memberName}:预算${item.budgetHours || 0}h/AR${item.actualHours || 0}h/差异${item.varianceHours || 0}h/使用率${usage}`;
  }).join('；');
}

function buildCsv(rows) {
  const header = [
    '项目名称', '项目号', '客户名称', 'PM', '状态', '开始日期', '结束日期',
    '子项目预算工时合计', '人员预算工时合计', '人员预算分配差异', '计划完成工时', 'AR工时',
    '项目总预算(Order Value)', 'BAC(不含差旅)', '杂费/差旅费', '项目总预算(含差旅)',
    'PV-计划价值', 'EV-挣值', 'AC-实际成本', 'CV-成本偏差', 'SV-进度偏差', 'CPI-成本绩效', 'SPI-进度绩效',
    '实际完成率', '计划完成率', '人员预算/AR明细', '异常提醒'
  ];
  const lines = [header.map(csvEscape).join(',')];
  rows.forEach(project => {
    const m = project.metrics || computeMetrics(project);
    const alerts = (m.alerts || []).map(item => item.text).join('；');
    const line = [
      project.projectName,
      project.projectNo,
      project.customerName,
      project.projectManager,
      project.status,
      project.startDate,
      project.endDate,
      m.sumBudgetHours,
      m.sumEmployeeBudgetHours,
      m.budgetAllocationDiff,
      m.sumPlannedHours,
      m.sumArHours,
      project.projectTotalBudget || project.totalBudget || project.precalProjectBudget || project.orderValue,
      m.bac,
      m.travelFee,
      m.projectBudgetWithTravel,
      m.plannedValue,
      m.earnedValue,
      m.actualCost,
      m.costVariance,
      m.scheduleVariance,
      m.costPerformanceIndex,
      m.schedulePerformanceIndex,
      m.actualCompletionRatio,
      m.plannedCompletionRatio,
      buildMemberBudgetText(m),
      alerts
    ];
    lines.push(line.map(csvEscape).join(','));
  });
  return `\ufeff${lines.join('\n')}`;
}

function parseDateBoundary(value, endOfDay) {
  const text = normalizeText(value);
  if (!text) return null;
  const date = new Date(`${text}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+08:00`);
  const time = date.getTime();
  return Number.isFinite(time) ? time : null;
}

function dateTextToTime(value, endOfDay) {
  const text = normalizeText(value);
  if (!text) return null;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(text) ? `${text}T${endOfDay ? '23:59:59.999' : '00:00:00.000'}+08:00` : text;
  const time = Date.parse(normalized);
  return Number.isFinite(time) ? time : null;
}

function textContains(value, keyword) {
  const key = normalizeText(keyword).toLowerCase();
  if (!key) return true;
  return normalizeText(value).toLowerCase().indexOf(key) >= 0;
}

function normalizePmFilter(input) {
  if (Array.isArray(input)) return uniqueTexts(input);
  return String(input || '')
    .split(/[、,，;；\n\r]+/)
    .map(normalizeText)
    .filter(Boolean);
}

function projectMatchesExportFilters(project, filters) {
  const opts = filters || {};
  const status = normalizeText(opts.status || opts.projectStatus || 'all');
  if (status === 'completed' && normalizeText(project.status) !== 'completed') return false;
  if ((status === 'active' || status === 'inProgress') && normalizeText(project.status) === 'completed') return false;

  const pmNames = normalizePmFilter(opts.pmNames || opts.pmName);
  if (pmNames.length) {
    const pmName = normalizeText(project.pmName || project.projectManager);
    if (pmNames.indexOf(pmName) < 0) return false;
  }

  if (!textContains(project.customerName || project.clientName, opts.customerName)) return false;
  if (!textContains(project.projectName, opts.projectName)) return false;

  const sapNo = normalizeSapNo(opts.sapNo || opts.sapOrderNo);
  if (sapNo) {
    const sapText = uniqueTexts((project.sapNumbers || [])
      .concat(collectSapNos(project))
      .concat(normalizeSapBindingList(project).map(item => item.sapOrderNo))).join(' ');
    if (sapText.indexOf(sapNo) < 0) return false;
  }

  const createdStart = parseDateBoundary(opts.createdStart || opts.createdAtStart, false);
  const createdEnd = parseDateBoundary(opts.createdEnd || opts.createdAtEnd, true);
  if (createdStart || createdEnd) {
    const createdAt = resolveServerDateMs(project.createdAt);
    if (createdStart && (!createdAt || createdAt < createdStart)) return false;
    if (createdEnd && (!createdAt || createdAt > createdEnd)) return false;
  }

  const closedStart = parseDateBoundary(opts.closedStart || opts.closedAtStart, false);
  const closedEnd = parseDateBoundary(opts.closedEnd || opts.closedAtEnd, true);
  if (closedStart || closedEnd) {
    const closedAt = dateTextToTime(project.closedAt, false);
    if (closedStart && (!closedAt || closedAt < closedStart)) return false;
    if (closedEnd && (!closedAt || closedAt > closedEnd)) return false;
  }

  return true;
}

function buildExportFilterText(filters) {
  const opts = filters || {};
  const parts = [];
  const statusMap = { all: '全部项目', completed: '已完结项目', active: '进行中项目', inProgress: '进行中项目' };
  const status = normalizeText(opts.status || opts.projectStatus || 'all');
  parts.push(`项目状态=${statusMap[status] || status || '全部项目'}`);
  const pmNames = normalizePmFilter(opts.pmNames || opts.pmName);
  parts.push(`PM=${pmNames.length ? pmNames.join('、') : '全部 PM'}`);
  if (normalizeText(opts.customerName)) parts.push(`客户名称包含 ${normalizeText(opts.customerName)}`);
  if (normalizeText(opts.projectName)) parts.push(`项目名称包含 ${normalizeText(opts.projectName)}`);
  if (normalizeText(opts.sapNo || opts.sapOrderNo)) parts.push(`SAP 包含 ${normalizeText(opts.sapNo || opts.sapOrderNo)}`);
  if (normalizeText(opts.createdStart || opts.createdAtStart) || normalizeText(opts.createdEnd || opts.createdAtEnd)) {
    parts.push(`创建时间=${normalizeText(opts.createdStart || opts.createdAtStart) || '不限'} 至 ${normalizeText(opts.createdEnd || opts.createdAtEnd) || '不限'}`);
  }
  if (normalizeText(opts.closedStart || opts.closedAtStart) || normalizeText(opts.closedEnd || opts.closedAtEnd)) {
    parts.push(`完结时间=${normalizeText(opts.closedStart || opts.closedAtStart) || '不限'} 至 ${normalizeText(opts.closedEnd || opts.closedAtEnd) || '不限'}`);
  }
  return parts.join('；');
}

async function listProjectExportOptions(openid, user) {
  assertAnyRole(user, ['admin', 'pm', 'sales', 'cs', 'ar'], '当前角色不能导出项目数据。');
  const rows = await listVisibleProjectRows(openid, user);
  const pmNames = uniqueTexts(rows.map(item => item.pmName || item.projectManager)).sort((a, b) => a.localeCompare(b));
  return {
    pmNames,
    exportServiceVersion: PROJECT_EXPORT_SERVICE_VERSION,
    exportRuntimeHint: 'projectService timeout should be >= 60s'
  };
}

async function exportProjectTemplate(openid, user, payload) {
  const startedAt = Date.now();
  const logStep = (step, extra) => console.log('[projectService.exportTemplate]', step, Date.now() - startedAt, extra || '');
  assertActive(user);
  assertAnyRole(user, ['admin', 'pm', 'sales', 'cs', 'ar'], '当前角色不能导出项目数据。');
  const filters = payload && payload.filters || payload || {};
  const delivery = normalizeText(payload && payload.delivery || filters.delivery);
  const skipArTime = !!(payload && payload.skipArTime || filters.skipArTime || delivery === 'base64Lite');

  const visibleRows = await listVisibleProjectRows(openid, user);
  logStep('visibleRows', visibleRows.length);
  const matchedRows = visibleRows.filter(item => projectMatchesExportFilters(item, filters));
  logStep('matchedRows', matchedRows.length);
  if (!matchedRows.length) return { ok: false, code: 'EMPTY_EXPORT', message: '没有符合筛选条件且当前账号有权限导出的项目。', user };

  const enrichedRows = skipArTime ? matchedRows : await enrichProjectsWithArSummaries(matchedRows);
  logStep('enrichedRows', enrichedRows.length);
  const rows = enrichedRows
    .map(item => decorateProjectAccess(item, openid, user))
    .map(item => {
      const metrics = item.metrics || computeMetrics(item);
      return Object.assign({}, item, { metrics });
    });

  const exportedAt = new Date();
  const builder = delivery === 'base64Lite'
    ? getFastXlsxBuilder()
    : getExcelBuilder();
  const {
    formatDate,
    formatDateTime,
    safeFileName
  } = builder;
  if (builder.assertTemplateExists) builder.assertTemplateExists();
  const snapshot = {
    exportedAtText: formatDateTime(exportedAt),
    exportedDate: formatDate(exportedAt),
    exportedByName: getUserName(user),
    exportedByOpenid: openid,
    filterText: skipArTime
      ? `${buildExportFilterText(filters)}；快速导出：未匹配 AR Time`
      : buildExportFilterText(filters)
  };
  const output = builder.buildFastExportPackage
    ? await builder.buildFastExportPackage(rows, snapshot)
    : await builder.buildExportPackage(rows, snapshot);
  logStep('builtPackage', `${output.fileName} ${output.buffer.length}`);

  if (delivery === 'base64' || delivery === 'base64Lite') {
    return {
      ok: true,
      fileBase64: Buffer.from(output.buffer).toString('base64'),
      fileName: output.fileName,
      contentType: output.contentType,
      projectCount: rows.length,
      pmCount: output.pmCount,
      fileCount: output.fileCount,
      exportedAt: snapshot.exportedAtText,
      filterText: snapshot.filterText,
      exportServiceVersion: PROJECT_EXPORT_SERVICE_VERSION,
      delivery,
      skippedArTime: skipArTime,
      user
    };
  }

  const cloudPath = `project-exports/${snapshot.exportedDate}/${Date.now()}_${safeFileName(output.fileName, '项目导出')}`;
  const uploadRes = await cloud.uploadFile({
    cloudPath,
    fileContent: output.buffer
  });
  logStep('uploaded', uploadRes.fileID);
  const fileID = uploadRes.fileID;
  const tempRes = await cloud.getTempFileURL({ fileList: [fileID] });
  logStep('tempUrl');
  const tempFile = tempRes.fileList && tempRes.fileList[0] || {};
  return {
    ok: true,
    fileID,
    downloadUrl: tempFile.tempFileURL || '',
    fileName: output.fileName,
    contentType: output.contentType,
    projectCount: rows.length,
    pmCount: output.pmCount,
    fileCount: output.fileCount,
    exportedAt: snapshot.exportedAtText,
    filterText: snapshot.filterText,
    exportServiceVersion: PROJECT_EXPORT_SERVICE_VERSION,
    user
  };
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const action = event.action;
  const now = db.serverDate();

  if (!openid) return { ok: false, message: '无法获取 openid。' };

  const user = await getCurrentUser(openid);

  try {
    if (action === 'list') {
      const data = await listProjectsPage(openid, user, event || {});
      return Object.assign({ ok: true, user }, data);
    }

    if (action === 'dashboardOverview') {
      const overview = await getDashboardOverview(openid, user);
      return Object.assign({ ok: true, user }, overview);
    }

    if (action === 'exportOptions') {
      const options = await listProjectExportOptions(openid, user);
      return Object.assign({ ok: true, user }, options);
    }

    if (action === 'detail') {
      const project = await getProjectById(event.id);
      if (!project) return { ok: false, message: '项目不存在。', user };
      if (!canView(project, openid, user)) return { ok: false, message: '无权查看该项目。', user };
      const enriched = (await enrichProjectsWithArSummaries([project], { includeArMemberCandidates: true }))[0] || project;
      return { ok: true, project: decorateProjectAccess(enriched, openid, user), user };
    }


    if (action === 'loadPrecalBySap') {
      assertActive(user);
      assertAnyRole(user, ['pm', 'admin'], '只有 PM 或 admin 可以按 SAP 查询 Pre-cal。');
      const sapNo = normalizeSapNo(event.sapNo || event.sapOrderNo);
      if (!sapNo) return { ok: false, message: 'SAP 项目号不能为空。', user };
      const precal = await getPrecalBySapNo(sapNo);
      if (!precal) return { ok: false, message: '未找到该 SAP 项目号对应的 Pre-cal。', user };
      const mappedPrecalData = buildProjectFromPrecal(precal, sapNo);
      const enrichedPrecalData = (await enrichProjectsWithArSummaries([mappedPrecalData], { includeArMemberCandidates: true }))[0] || mappedPrecalData;
      return { ok: true, project: enrichedPrecalData, precal: enrichedPrecalData, user };
    }

       if (action === 'createFromSap') {
      assertActive(user);
      assertUserName(user);
      assertAnyRole(user, ['pm', 'admin'], '只有 PM 或 admin 可以从 SAP 创建项目。');
      const sapNo = normalizeSapNo(event.sapNo || event.sapOrderNo);
      if (!sapNo) return { ok: false, message: 'SAP 项目号不能为空。', user };
      const nowMs = Date.now();

      const txRes = await db.runTransaction(async transaction => {
        const precal = await getPrecalBySapNo(sapNo);
        if (!precal) return { ok: false, message: '未找到该 SAP 项目号对应的 Pre-cal。' };

        const validation = validatePrecalForProject(precal);
        if (!validation.ok) return { ok: false, message: validation.message };

        const precalDoc = await transaction.collection('precal_records').doc(precal._id).get();
        const latestPrecal = precalDoc.data || {};

        if (latestPrecal.createdProjectId) {
          return { ok: false, message: '该 Pre-cal 对应项目已存在', projectId: latestPrecal.createdProjectId };
        }

        if (isCreatingLockFresh(latestPrecal, nowMs)) {
          return { ok: false, message: '该 Pre-cal 正在创建项目，请稍后重试' };
        }

        await transaction.collection('precal_records').doc(precal._id).update({
          data: {
            creatingProject: true,
            creatingProjectBy: openid,
            creatingProjectAt: now,
            updatedAt: now,
            updatedBy: openid,
            version: _.inc(1)
          }
        });

        const projectData = await prepareProjectForSave(buildProjectFromPrecal(precal, sapNo), user, openid);
        projectData.ownerOpenid = openid;
        projectData.createdAt = now;
        projectData.createdBy = openid;
        projectData.updatedAt = now;
        projectData.updatedBy = openid;
        projectData.deleted = false;
        projectData.version = 1;

        const addRes = await transaction.collection('projects').add({ data: projectData });

        await transaction.collection('precal_records').doc(precal._id).update({
          data: {
            createdProjectId: addRes._id,
            status: 'Project Created',
            creatingProject: _.remove(),
            creatingProjectBy: _.remove(),
            creatingProjectAt: _.remove(),
            updatedAt: now,
            updatedBy: openid,
            version: _.inc(1)
          }
        });

        return { ok: true, id: addRes._id };
      });

      return Object.assign({ user }, txRes);
    }

    if (action === 'save') { 
      if (event.id) {
        const existing = await getProjectById(event.id);
        if (!existing) return { ok: false, message: '项目不存在，无法更新。', user };
        if (!canEdit(existing, openid, user)) return { ok: false, message: '无权编辑该项目。如需修改请联系项目创建人。', user };
        const incomingVersion = Number(event.project && event.project.version);
        const currentVersion = Number(existing.version || 1);
        if (Number.isFinite(incomingVersion) && incomingVersion > 0 && incomingVersion !== currentVersion) {
          return { ok: false, code: 'VERSION_CONFLICT', message: '项目已被其他人更新，请刷新后再保存。', user };
        }
        const cleaned = await prepareProjectForSave(event.project, user, openid, existing);
        cleaned.updatedAt = now;
        cleaned.updatedBy = openid;
        await projects.doc(event.id).update({ data: Object.assign({}, cleaned, { version: _.inc(1) }) });
        return { ok: true, id: event.id, user };
      }

      assertActive(user);
      assertUserName(user);
      assertAnyRole(user, ['pm', 'admin'], '只有 PM 或 admin 可以创建项目。');
      const cleaned = await prepareProjectForSave(event.project, user, openid);
      cleaned.updatedAt = now;
      cleaned.updatedBy = openid;
      if (cleaned.precalId) {
        const txRes = await db.runTransaction(async transaction => {
          const precalDoc = await transaction.collection('precal_records').doc(cleaned.precalId).get();
          const precal = precalDoc.data || null;
          if (!precal || precal.deleted === true) {
            return { ok: false, message: 'Pre-cal 不存在，无法创建项目。' };
          }

          if (precal.createdProjectId) {
            return { ok: false, message: '该 Pre-cal 对应项目已存在', id: precal.createdProjectId };
          }

          const projectData = Object.assign({}, cleaned, {
            ownerOpenid: openid,
            createdAt: now,
            createdBy: openid,
            deleted: false,
            version: 1
          });

          const addRes = await transaction.collection('projects').add({ data: projectData });

          await transaction.collection('precal_records').doc(cleaned.precalId).update({
            data: {
              createdProjectId: addRes._id,
              status: 'Project Created',
              updatedAt: now,
              updatedBy: openid,
              version: _.inc(1)
            }
          });

          return { ok: true, id: addRes._id };
        });

        return Object.assign({ user }, txRes);
      }

      cleaned.ownerOpenid = openid;
      cleaned.createdAt = now;
      cleaned.createdBy = openid;
      cleaned.deleted = false;
      cleaned.version = 1;
      if (cleaned.clientRequestId) {
        const existing = await projects
          .where({ createdBy: openid, clientRequestId: cleaned.clientRequestId, deleted: _.neq(true) })
          .limit(1)
          .get();
        const existingProject = existing.data && existing.data[0];
        if (existingProject && existingProject._id) {
          return { ok: true, id: existingProject._id, user, deduped: true };
        }
      }
      const addRes = await projects.add({ data: cleaned });

      return { ok: true, id: addRes._id, user };
    }

    if (action === 'remove') {
      const project = await getProjectById(event.id);
      if (!project) return { ok: false, message: '项目不存在。', user };
      if (!canEdit(project, openid, user)) return { ok: false, message: '无权删除该项目。如需删除请联系项目创建人。', user };
      await projects.doc(event.id).update({
        data: {
          deleted: true,
          deletedAt: now,
          deletedBy: openid,
          updatedAt: now,
          updatedBy: openid,
          version: _.inc(1)
        }
      });
      return { ok: true, user };
    }

    if (action === 'exportCsv') {
      assertAnyRole(user, ['admin', 'pm', 'sales', 'cs', 'ar'], '当前角色不能导出项目数据。');
      const data = await listProjectsForExport(openid, user);
      const rows = data.map(item => {
        const metrics = item.metrics || computeMetrics(item);
        return Object.assign({}, item, { bac: metrics.bac, projectBudgetWithTravel: metrics.projectBudgetWithTravel, metrics });
      });
      return { ok: true, csv: buildCsv(rows), user };
    }

    if (action === 'exportTemplate') {
      return await exportProjectTemplate(openid, user, event || {});
    }

    return { ok: false, message: `未知操作：${action}`, user };
  } catch (err) {
    console.error(err);
    return { ok: false, message: err.message || '服务异常。', user };
  }
};
