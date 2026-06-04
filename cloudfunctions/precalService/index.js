const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

const users = db.collection('users');
const precalRecords = db.collection('precal_records');
const precalParameters = db.collection('precal_parameters');
const precalLogs = db.collection('precal_logs');
const arSummaries = db.collection('ar_summaries');
const projects = db.collection('projects');

const STATUS = {
  DRAFT: 'Draft',
  SUBMITTED: 'Submitted',
  WITHDRAWN: 'Withdrawn',
  SAP_BOUND: 'SAP Bound',
  PROJECT_CREATED: 'Project Created',
  UNLOCKED: 'Unlocked',
  CANCELLED: 'Cancelled'
};

const DEFAULT_PARAMETERS = {
  versionName: '2026 AUD Pre-cal Parameters',
  effectiveYear: 2026,
  isActive: true,
  serviceRates: [
    {
      service: 'ESG',
      serviceCode: '1350',
      hourlyRate: 681.98,
      plannedMarginPercent: 8.06211900503957,
      allocationCostTotalCostsRatio: 0.1255947752239753,
      hourlyAllocationCost: 85.65312480724668,
      allocationCostExtSalesRatio: 0.09053186682359064,
      allocationCostICSalesRatio: 0.03695998846020505,
      productivity70HourlyRate: 573.8566330727385,
      productivity80HourlyRate: 502.12455393864616
    },
    {
      service: 'CSR',
      serviceCode: '1351',
      hourlyRate: 532.25,
      plannedMarginPercent: 2.848558499490884,
      allocationCostTotalCostsRatio: 0.13773451694205027,
      hourlyAllocationCost: 73.30919664240626,
      allocationCostExtSalesRatio: 0.09596833090084642,
      allocationCostICSalesRatio: 0.14867204776308413,
      productivity70HourlyRate: 0,
      productivity80HourlyRate: 0
    }
  ],
  orderCreateCenters: ['1800', '2160', '4820', '4830', '4840', '4850']
};

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round4(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 0;
  return Math.round(Number(value) * 10000) / 10000;
}

function safeDivide(a, b) {
  const denominator = toNumber(b);
  if (!denominator) return 0;
  return toNumber(a) / denominator;
}

function deepCopy(obj) {
  return JSON.parse(JSON.stringify(obj || {}));
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

function defaultItemNoForSap(sapOrderNo, itemNo) {
  const cleanItemNo = normalizeText(itemNo);
  if (cleanItemNo) return cleanItemNo;
  return normalizeText(sapOrderNo).indexOf('7') === 0 ? '1000' : '';
}

function readSapNo(raw) {
  if (typeof raw === 'string') return normalizeText(raw);
  const item = raw || {};
  return normalizeText(item.sapOrderNo || item.sapNo || item.sapProjectNo || item.sapCode || item.projectNo || item.value);
}

function readItemNo(raw, sapOrderNo) {
  const item = raw || {};
  return defaultItemNoForSap(sapOrderNo, item.itemNo || item.subProjectNo || item.no);
}

function normalizeSapBinding(raw, index) {
  const item = raw || {};
  const sapOrderNo = readSapNo(item);
  if (!sapOrderNo) return null;
  const itemNo = readItemNo(item, sapOrderNo);
  const active = item.active === false ? false : true;
  return {
    sapId: item.sapId || item.id || `S${Date.now()}_${index}_${Math.floor(Math.random() * 100000)}`,
    sapOrderNo,
    sapNo: sapOrderNo,
    sapProjectNo: sapOrderNo,
    itemNo,
    active,
    source: normalizeText(item.source) || 'manual',
    memberName: normalizeText(item.memberName),
    remark: normalizeText(item.remark),
    createdAt: item.createdAt || '',
    createdBy: item.createdBy || '',
    createdByName: item.createdByName || '',
    updatedAt: item.updatedAt || '',
    updatedBy: item.updatedBy || '',
    updatedByName: item.updatedByName || '',
    disabledAt: item.disabledAt || null,
    disabledBy: item.disabledBy || null,
    disabledReason: item.disabledReason || null
  };
}

function mergeLegacySapBindings(record) {
  const rows = [];
  const seen = {};
  const add = raw => {
    const normalized = normalizeSapBinding(raw, rows.length);
    if (!normalized) return;
    const key = `${normalized.sapOrderNo}#${normalized.itemNo}#${normalized.active === false ? 'inactive' : 'active'}`;
    if (seen[key]) return;
    seen[key] = true;
    rows.push(normalized);
  };

  (Array.isArray(record && record.sapBindings) ? record.sapBindings : []).forEach(add);
  if (rows.length) return rows;
  ['sapOrderNo', 'sapNo', 'sapProjectNo', 'mainSapNo'].forEach(field => {
    if (record && record[field]) add({ sapOrderNo: record[field], itemNo: record.itemNo, source: 'legacy' });
  });
  ['sapNos', 'sapNumbers', 'sapNoList', 'sapProjects', 'sapItems'].forEach(field => {
    const value = record && record[field];
    if (!Array.isArray(value)) return;
    value.forEach(item => add(typeof item === 'string' ? { sapOrderNo: item, source: 'legacy' } : Object.assign({ source: 'legacy' }, item || {})));
  });

  return rows;
}

function activeSapBindings(record) {
  return mergeLegacySapBindings(record).filter(item => item.active !== false);
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < (items || []).length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function normalizeRoles(user) {
  if (!user) return [];
  if (Array.isArray(user.roles) && user.roles.length) return user.roles.map(String);
  if (user.role) return [String(user.role)];
  return ['pm'];
}

function hasRole(user, role) {
  return normalizeRoles(user).indexOf(role) >= 0;
}

function hasAnyRole(user, roles) {
  const userRoles = normalizeRoles(user);
  return (roles || []).some(role => userRoles.indexOf(role) >= 0);
}

function uniqueRoles(records) {
  const roleMap = {};
  (records || []).forEach(item => {
    normalizeRoles(item).forEach(role => {
      if (role) roleMap[role] = true;
    });
  });
  const roles = Object.keys(roleMap);
  return roles.length ? roles : ['pm'];
}

function userScore(user, openid) {
  let score = 0;
  if (user && user._id === openid) score += 1000;
  if (user && user.deleted !== true) score += 100;
  if (user && user.active !== false) score += 50;
  if (normalizeText(user && user.name)) score += 10;
  const roles = normalizeRoles(user);
  if (roles.indexOf('admin') >= 0) score += 5;
  if (roles.indexOf('leader') >= 0) score += 4;
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

function firstDefined(records, field, fallback) {
  for (const item of records || []) {
    if (item && item[field] !== undefined && item[field] !== null && item[field] !== '') return item[field];
  }
  return fallback;
}

function buildMergedUser(primary, records, openid, now) {
  const roles = uniqueRoles(records && records.length ? records : [primary]);
  const ordered = [primary].concat((records || []).filter(item => item && item._id !== primary._id));
  return {
    _openid: openid,
    openid,
    name: normalizeText(firstDefined(ordered, 'name', '')),
    role: primary && primary.role ? primary.role : roles[0],
    roles,
    active: (records || []).some(item => item && item.active === false) ? false : true,
    defaultPersonDayCost: Number(firstDefined(ordered, 'defaultPersonDayCost', 5000)) || 5000,
    deleted: false,
    version: Number(firstDefined(ordered, 'version', 1)) || 1,
    createdAt: firstDefined(ordered, 'createdAt', now),
    updatedAt: now
  };
}

async function findUserRecords(openid) {
  const res = await users.where(_.or([{ openid }, { _openid: openid }])).limit(100).get();
  return res.data || [];
}

async function removeDuplicateUsers(records, primaryId) {
  const duplicates = (records || []).filter(item => item && item._id && item._id !== primaryId);
  await Promise.all(duplicates.map(item => users.doc(item._id).remove().catch(err => {
    console.warn('删除重复用户记录失败：', item._id, err);
  })));
  return duplicates.length;
}

async function getCurrentUser(openid) {
  const now = db.serverDate();
  const records = await findUserRecords(openid);
  const primary = pickPrimaryUser(records, openid);

  if (primary) {
    const mergedUser = buildMergedUser(primary, records, openid, now);
    await users.doc(primary._id).update({ data: mergedUser });
    await removeDuplicateUsers(records, primary._id);
    return Object.assign({ _id: primary._id }, primary, mergedUser);
  }

  const newUser = buildMergedUser({ _id: openid, role: 'pm', roles: ['pm'] }, [], openid, now);
  try {
    await users.doc(openid).set({ data: newUser });
    return Object.assign({ _id: openid }, newUser);
  } catch (err) {
    const retryRecords = await findUserRecords(openid);
    const retryPrimary = pickPrimaryUser(retryRecords, openid);
    if (retryPrimary) {
      const mergedUser = buildMergedUser(retryPrimary, retryRecords, openid, now);
      await users.doc(retryPrimary._id).update({ data: mergedUser });
      await removeDuplicateUsers(retryRecords, retryPrimary._id);
      return Object.assign({ _id: retryPrimary._id }, retryPrimary, mergedUser);
    }
    throw err;
  }
}

function getUserName(user, fallback) {
  return normalizeText(user && user.name) || fallback || '未填写姓名';
}

function assertRole(user, role, message) {
  if (!hasRole(user, role)) throw new Error(message || '无权限执行该操作。');
}

function assertAnyRole(user, roles, message) {
  if (!hasAnyRole(user, roles)) throw new Error(message || '无权限执行该操作。');
}

async function getActiveParameterDoc() {
  const res = await precalParameters.where({ isActive: true }).orderBy('updatedAt', 'desc').limit(10).get();
  const active = (res.data || []).find(item => item.deleted !== true);
  if (active) return active;

  const now = db.serverDate();
  const data = Object.assign({}, DEFAULT_PARAMETERS, { deleted: false, version: 1, createdAt: now, updatedAt: now, createdBy: 'system' });
  const addRes = await precalParameters.add({ data });
  return Object.assign({ _id: addRes._id }, data);
}

function findServiceRate(service, parameterSnapshot) {
  const rates = (parameterSnapshot && parameterSnapshot.serviceRates) || [];
  const cleanService = normalizeText(service || 'ESG').toUpperCase();
  const found = rates.find(item => normalizeText(item.service).toUpperCase() === cleanService);
  if (!found) throw new Error(`当前参数版本未配置 ${service} 的费率。`);
  return found;
}

function cleanLineItem(line, index) {
  const raw = line || {};
  return {
    lineId: raw.lineId || `L${String(index + 1).padStart(3, '0')}_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    productDescription: normalizeText(raw.productDescription),
    orderCreateCenter: normalizeText(raw.orderCreateCenter),
    orderValue: toNumber(raw.orderValue),
    onsiteMD: toNumber(raw.onsiteMD),
    offsiteMD: toNumber(raw.offsiteMD),
    quotationMD: raw.quotationMD === null || raw.quotationMD === undefined || raw.quotationMD === '' ? null : toNumber(raw.quotationMD),
    quotationMDOverridden: !!raw.quotationMDOverridden,
    travelMD: raw.travelMD === null || raw.travelMD === undefined || raw.travelMD === '' ? null : toNumber(raw.travelMD),
    travelMDOverridden: !!raw.travelMDOverridden,
    subcontractingTranslation: toNumber(raw.subcontractingTranslation),
    subcontractingDesign: toNumber(raw.subcontractingDesign),
    subcontractingTravel: toNumber(raw.subcontractingTravel),
    subcontractingOther: toNumber(raw.subcontractingOther),
    subcontractingIC: toNumber(raw.subcontractingIC),
    internalSubcon: toNumber(raw.internalSubcon),
    otherProjectCosts: toNumber(raw.otherProjectCosts)
  };
}

function validatePrecalInput(input, parameterSnapshot) {
  if (!normalizeText(input.customerName)) throw new Error('请填写客户名称。');
  const service = normalizeText(input.service || '').toUpperCase();
  if (['ESG', 'CSR'].indexOf(service) < 0) throw new Error('Service 只能选择 ESG 或 CSR。');
  const lineItems = Array.isArray(input.lineItems) ? input.lineItems : [];
  if (!lineItems.length) throw new Error('至少需要填写一条服务明细。');

  const centers = (parameterSnapshot && parameterSnapshot.orderCreateCenters) || DEFAULT_PARAMETERS.orderCreateCenters;
  lineItems.forEach((line, idx) => {
    if (!normalizeText(line.orderCreateCenter)) throw new Error(`第 ${idx + 1} 条明细缺少 Order Create Center。`);
    if (centers.indexOf(normalizeText(line.orderCreateCenter)) < 0) throw new Error(`第 ${idx + 1} 条明细的 Order Create Center 不在允许范围内。`);
    const numericFields = [
      'orderValue', 'onsiteMD', 'offsiteMD', 'subcontractingTranslation', 'subcontractingDesign',
      'subcontractingTravel', 'subcontractingOther', 'subcontractingIC', 'internalSubcon', 'otherProjectCosts'
    ];
    numericFields.forEach(field => {
      if (toNumber(line[field]) < 0) throw new Error(`第 ${idx + 1} 条明细的 ${field} 不能小于 0。`);
    });
    if (line.quotationMDOverridden && toNumber(line.quotationMD) < 0) throw new Error(`第 ${idx + 1} 条明细的 Quotation MD 不能小于 0。`);
    if (line.travelMDOverridden && toNumber(line.travelMD) < 0) throw new Error(`第 ${idx + 1} 条明细的 Travel MD 不能小于 0。`);
  });
}

function sum(items, getter) {
  return (items || []).reduce((acc, item) => acc + toNumber(typeof getter === 'function' ? getter(item) : item[getter]), 0);
}

function calculateLineItem(line, context) {
  const serviceRate = context.serviceRate;
  const totalOrderValue = context.totalOrderValue;
  const orderValue = toNumber(line.orderValue);
  const onsiteMD = toNumber(line.onsiteMD);
  const offsiteMD = toNumber(line.offsiteMD);
  const quotationMDDefault = orderValue > 0 && totalOrderValue > 0 ? 0.5 * orderValue / totalOrderValue : 0;
  const quotationMD = line.quotationMDOverridden ? toNumber(line.quotationMD) : quotationMDDefault;
  const travelMDDefault = onsiteMD * 0.1;
  const travelMD = line.travelMDOverridden ? toNumber(line.travelMD) : travelMDDefault;
  const totalMD = onsiteMD + offsiteMD + quotationMD + travelMD;
  const hours = totalMD * 8;

  const subcontractingTranslation = toNumber(line.subcontractingTranslation);
  const subcontractingDesign = toNumber(line.subcontractingDesign);
  const subcontractingTravel = toNumber(line.subcontractingTravel);
  const subcontractingOther = toNumber(line.subcontractingOther);
  const subcontractingIC = toNumber(line.subcontractingIC);
  const internalSubcon = toNumber(line.internalSubcon);
  const otherProjectCosts = toNumber(line.otherProjectCosts);

  const netSales = orderValue - subcontractingTranslation - subcontractingDesign - subcontractingTravel - subcontractingOther - subcontractingIC - internalSubcon;
  const mdCosts = hours * toNumber(serviceRate.hourlyRate);
  const resultOfOrder = netSales - otherProjectCosts - mdCosts;
  const roMargin = safeDivide(resultOfOrder, orderValue);

  const icSubconRate = normalizeText(line.orderCreateCenter) === '2160' ? 0.8 : 0;
  const allocationCostByExtSales = orderValue * toNumber(serviceRate.allocationCostExtSalesRatio);
  const allocationCostByICSales = 0; // 当前 AUD Pre-cal 的 D40:H40 为空，IC sales allocation 组件按 Excel 现状为 0。
  const allocationCostsByHour = hours * toNumber(serviceRate.hourlyAllocationCost);
  const allocationCostSimulation = normalizeText(line.orderCreateCenter) === '2160'
    ? allocationCostByExtSales + allocationCostByICSales - allocationCostsByHour
    : allocationCostByExtSales - allocationCostsByHour;
  const overhead = Math.max(allocationCostSimulation, 0);
  const operatingResult = netSales - otherProjectCosts - mdCosts - overhead;
  const operatingMargin = safeDivide(operatingResult, orderValue);
  const subcontractingSalesRatio = safeDivide(
    subcontractingTranslation + subcontractingDesign + subcontractingTravel + subcontractingOther + subcontractingIC,
    orderValue
  );

  return Object.assign({}, line, {
    quotationMDDefault: round4(quotationMDDefault),
    quotationMD: round4(quotationMD),
    travelMDDefault: round4(travelMDDefault),
    travelMD: round4(travelMD),
    calculated: {
      totalMD: round4(totalMD),
      hours: round4(hours),
      icSubconRate: round4(icSubconRate),
      netSales: round4(netSales),
      mdCosts: round4(mdCosts),
      resultOfOrder: round4(resultOfOrder),
      roMargin: round4(roMargin),
      allocationCostByExtSales: round4(allocationCostByExtSales),
      allocationCostByICSales: round4(allocationCostByICSales),
      allocationCostsByHour: round4(allocationCostsByHour),
      allocationCostSimulation: round4(allocationCostSimulation),
      overhead: round4(overhead),
      operatingResult: round4(operatingResult),
      operatingMargin: round4(operatingMargin),
      subcontractingSalesRatio: round4(subcontractingSalesRatio)
    }
  });
}

function calculateSummary(lineItems, serviceRate) {
  const totalOrderValue = sum(lineItems, 'orderValue');
  const resultOfOrder = sum(lineItems, line => line.calculated.resultOfOrder);
  const operatingResult = sum(lineItems, line => line.calculated.operatingResult);
  const totalSubcontracting = sum(lineItems, line =>
    toNumber(line.subcontractingTranslation) + toNumber(line.subcontractingDesign) + toNumber(line.subcontractingTravel) +
    toNumber(line.subcontractingOther) + toNumber(line.subcontractingIC)
  );

  return {
    totalOrderValue: round4(totalOrderValue),
    totalOnsiteMD: round4(sum(lineItems, 'onsiteMD')),
    totalOffsiteMD: round4(sum(lineItems, 'offsiteMD')),
    totalQuotationMD: round4(sum(lineItems, 'quotationMD')),
    totalTravelMD: round4(sum(lineItems, 'travelMD')),
    totalMD: round4(sum(lineItems, line => line.calculated.totalMD)),
    totalHours: round4(sum(lineItems, line => line.calculated.hours)),
    totalNetSales: round4(sum(lineItems, line => line.calculated.netSales)),
    totalMDCosts: round4(sum(lineItems, line => line.calculated.mdCosts)),
    resultOfOrder: round4(resultOfOrder),
    roMargin: round4(safeDivide(resultOfOrder, totalOrderValue)),
    overhead: round4(sum(lineItems, line => line.calculated.overhead)),
    operatingResult: round4(operatingResult),
    operatingMargin: round4(safeDivide(operatingResult, totalOrderValue)),
    plannedORSales: round4(toNumber(serviceRate.plannedMarginPercent) / 100),
    subcontractingSalesRatio: round4(safeDivide(totalSubcontracting, totalOrderValue))
  };
}

function calculateProductivityScenario(lineItems, serviceRate, hourlyRate) {
  const rate = toNumber(hourlyRate);
  if (!rate) {
    return {
      available: false,
      mdCosts: 0,
      resultOfOrder: 0,
      roMargin: 0,
      overhead: 0,
      operatingResult: 0,
      operatingMargin: 0,
      plannedORSales: round4(toNumber(serviceRate.plannedMarginPercent) / 100)
    };
  }

  const totalOrderValue = sum(lineItems, 'orderValue');
  const totalNetSales = sum(lineItems, line => line.calculated.netSales);
  const totalOtherProjectCosts = sum(lineItems, 'otherProjectCosts');
  const totalHours = sum(lineItems, line => line.calculated.hours);
  const overhead = sum(lineItems, line => line.calculated.overhead);
  const mdCosts = totalHours * rate;
  const resultOfOrder = totalNetSales - totalOtherProjectCosts - mdCosts;
  const operatingResult = totalNetSales - totalOtherProjectCosts - mdCosts - overhead;

  return {
    available: true,
    hourlyRate: round4(rate),
    mdCosts: round4(mdCosts),
    resultOfOrder: round4(resultOfOrder),
    roMargin: round4(safeDivide(resultOfOrder, totalOrderValue)),
    overhead: round4(overhead),
    operatingResult: round4(operatingResult),
    operatingMargin: round4(safeDivide(operatingResult, totalOrderValue)),
    plannedORSales: round4(toNumber(serviceRate.plannedMarginPercent) / 100)
  };
}

function getFormulaExplanations() {
  return {
    quotationMD: { label: 'MD for Quotation Phase', formula: '0.5 × 当前明细 Order Value / Total Order Value', note: '默认自动分摊，Sales 可手动覆盖。' },
    travelMD: { label: 'MD for Travel', formula: 'Onsite MD × 10%', note: '按已确认逻辑计算，不采用原 Excel 行名中的 20% of Quotation MD。' },
    totalMD: { label: 'Total MD', formula: 'Onsite MD + Offsite MD + Quotation MD + Travel MD' },
    hours: { label: 'Hours', formula: 'Total MD × 8' },
    netSales: { label: 'Net Sales', formula: 'Order Value - Subcontracting ext. - Subcontracting IC - Internal subcon' },
    mdCosts: { label: 'MD Costs', formula: 'Hours × Hourly Rate' },
    resultOfOrder: { label: 'Result of Order', formula: 'Net Sales - Other Project Costs - MD Costs' },
    roMargin: { label: 'RO Margin', formula: 'Result of Order / Order Value' },
    overhead: { label: 'Overhead', formula: 'max(Allocation Cost Simulation, 0)' },
    operatingResult: { label: 'Operating Result', formula: 'Net Sales - Other Project Costs - MD Costs - Overhead' },
    operatingMargin: { label: 'Operating Margin', formula: 'Operating Result / Order Value' },
    plannedORSales: { label: 'Planned OR/Sales', formula: '从当前参数版本中按 Service 读取。' }
  };
}

function calculatePrecal(input, parameterSnapshot) {
  const serviceRate = findServiceRate(input.service, parameterSnapshot);
  const cleanLines = (input.lineItems || []).map(cleanLineItem);
  const totalOrderValue = sum(cleanLines, 'orderValue');
  const calculatedLineItems = cleanLines.map(line => calculateLineItem(line, { totalOrderValue, serviceRate }));
  const calculationResult = calculateSummary(calculatedLineItems, serviceRate);
  const productivityScenarios = {
    productivity70: calculateProductivityScenario(calculatedLineItems, serviceRate, serviceRate.productivity70HourlyRate),
    productivity80: calculateProductivityScenario(calculatedLineItems, serviceRate, serviceRate.productivity80HourlyRate)
  };
  return {
    serviceCode: serviceRate.serviceCode,
    lineItems: calculatedLineItems,
    calculationResult,
    productivityScenarios,
    formulaExplanations: getFormulaExplanations()
  };
}

function buildPrecalNo() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `PC${stamp}${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
}

async function addLog(record, log) {
  const now = db.serverDate();
  await precalLogs.add({
    data: Object.assign({
      precalRecordId: record && record._id || '',
      precalNo: record && record.precalNo || '',
      createdAt: now
    }, log || {})
  });
}

async function getRecord(id) {
  if (!id) return null;
  try {
    const res = await precalRecords.doc(id).get();
    const data = res.data || null;
    if (data && data.deleted === true) return null;
    return data;
  } catch (err) {
    return null;
  }
}

function canViewPrecal(user, openid, record) {
  if (hasAnyRole(user, ['admin'])) return true;
  if (hasRole(user, 'cs') && [STATUS.SUBMITTED, STATUS.SAP_BOUND, STATUS.PROJECT_CREATED].indexOf(record.status) >= 0) return true;
  return record.createdBy === openid || record.salesOwnerOpenid === openid;
}

function buildListItem(record) {
  const result = record.calculationResult || {};
  const bindings = mergeLegacySapBindings(record);
  const sapNos = bindings.filter(item => item.active !== false).map(item => item.sapOrderNo).filter(Boolean);
  return {
    _id: record._id,
    precalNo: record.precalNo,
    customerName: record.customerName,
    service: record.service,
    serviceCode: record.serviceCode,
    salesOwnerName: record.salesOwnerName,
    status: record.status,
    isLocked: !!record.isLocked,
    totalOrderValue: result.totalOrderValue || 0,
    operatingMargin: result.operatingMargin || 0,
    resultOfOrder: result.resultOfOrder || 0,
    sapNos,
    sapBindings: bindings,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    submittedAt: record.submittedAt,
    sapBoundAt: record.sapBoundAt
  };
}

function keywordMatch(record, keyword) {
  const key = normalizeText(keyword).toLowerCase();
  if (!key) return true;
  const sapText = mergeLegacySapBindings(record).map(item => item.sapOrderNo).join(' ');
  const text = [record.precalNo, record.customerName, record.service, record.salesOwnerName, sapText]
    .join(' ')
    .toLowerCase();
  return text.indexOf(key) >= 0;
}

async function createPrecal(payload, openid, user) {
  assertRole(user, 'sales', '只有 Sales 可以创建 Pre-cal。');
  const activeParam = await getActiveParameterDoc();
  const parameterSnapshot = deepCopy(activeParam);
  delete parameterSnapshot._id;

  const input = Object.assign({}, payload || {}, { service: normalizeText((payload || {}).service || 'ESG').toUpperCase() });
  validatePrecalInput(input, parameterSnapshot);
  const calculated = calculatePrecal(input, parameterSnapshot);
  const now = db.serverDate();
  const salesOwnerName = getUserName(user, 'Sales');

  const data = {
    _openid: openid,
    precalNo: buildPrecalNo(),
    customerName: normalizeText(input.customerName),
    service: input.service,
    serviceCode: calculated.serviceCode,
    remark: normalizeText(input.remark),
    salesOwnerOpenid: openid,
    salesOwnerName,
    status: STATUS.DRAFT,
    isLocked: false,
    lineItems: calculated.lineItems,
    calculationResult: calculated.calculationResult,
    productivityScenarios: calculated.productivityScenarios,
    formulaExplanations: calculated.formulaExplanations,
    parameterSnapshot,
    sapBindings: [],
    createdBy: openid,
    createdByName: salesOwnerName,
    deleted: false,
    version: 1,
    createdAt: now,
    updatedAt: now,
    updatedBy: openid
  };
  const addRes = await precalRecords.add({ data });
  const record = Object.assign({ _id: addRes._id }, data);
  await addLog(record, {
    logType: 'status_change', action: 'create', fromStatus: '', toStatus: STATUS.DRAFT,
    operatorOpenid: openid, operatorName: salesOwnerName, operatorRoles: normalizeRoles(user)
  });
  return { ok: true, id: addRes._id, precalNo: data.precalNo, status: data.status, user };
}

async function updatePrecal(payload, openid, user) {
  const id = payload && payload.precalRecordId;
  const record = await getRecord(id);
  if (!record) throw new Error('Pre-cal 记录不存在。');
  if (!(record.createdBy === openid || hasRole(user, 'admin'))) throw new Error('无权修改该 Pre-cal。');
  if ([STATUS.SUBMITTED, STATUS.SAP_BOUND, STATUS.CANCELLED].indexOf(record.status) >= 0) throw new Error('当前状态不可直接修改。Submitted 需要先撤销，SAP Bound 需要 admin 解锁。');
  if (record.isLocked) throw new Error('该 Pre-cal 已锁定。');

  const parameterSnapshot = record.parameterSnapshot || deepCopy(DEFAULT_PARAMETERS);
  const input = Object.assign({}, payload || {}, { service: normalizeText((payload || {}).service || record.service || 'ESG').toUpperCase() });
  validatePrecalInput(input, parameterSnapshot);
  const calculated = calculatePrecal(input, parameterSnapshot);
  const now = db.serverDate();
  const data = {
    customerName: normalizeText(input.customerName),
    service: input.service,
    serviceCode: calculated.serviceCode,
    remark: normalizeText(input.remark),
    lineItems: calculated.lineItems,
    calculationResult: calculated.calculationResult,
    productivityScenarios: calculated.productivityScenarios,
    formulaExplanations: calculated.formulaExplanations,
    updatedAt: now,
    updatedBy: openid,
    version: _.inc(1)
  };
  await precalRecords.doc(id).update({ data });
  await addLog(record, {
    logType: 'edit', action: 'update_precal', oldValue: { status: record.status }, newValue: { status: record.status },
    operatorOpenid: openid, operatorName: getUserName(user), operatorRoles: normalizeRoles(user)
  });
  return { ok: true, id, user };
}

async function submitPrecal(payload, openid, user) {
  assertRole(user, 'sales', '只有 Sales 可以提交 Pre-cal。');
  const id = payload && payload.precalRecordId;
  const record = await getRecord(id);
  if (!record) throw new Error('Pre-cal 记录不存在。');
  if (record.createdBy !== openid && !hasRole(user, 'admin')) throw new Error('只能提交自己创建的 Pre-cal。');
  if ([STATUS.DRAFT, STATUS.WITHDRAWN, STATUS.UNLOCKED].indexOf(record.status) < 0) throw new Error('只有 Draft、Withdrawn 或 Unlocked 状态可以提交。');
  const calculated = calculatePrecal(record, record.parameterSnapshot || deepCopy(DEFAULT_PARAMETERS));
  const now = db.serverDate();
  await precalRecords.doc(id).update({
    data: {
      status: STATUS.SUBMITTED,
      isLocked: false,
      serviceCode: calculated.serviceCode,
      lineItems: calculated.lineItems,
      calculationResult: calculated.calculationResult,
      productivityScenarios: calculated.productivityScenarios,
      formulaExplanations: calculated.formulaExplanations,
      submittedAt: now,
      submittedBy: openid,
      updatedAt: now,
      updatedBy: openid,
      version: _.inc(1)
    }
  });
  await addLog(record, {
    logType: 'status_change', action: record.status === STATUS.WITHDRAWN ? 'resubmit' : 'submit',
    fromStatus: record.status, toStatus: STATUS.SUBMITTED,
    operatorOpenid: openid, operatorName: getUserName(user), operatorRoles: normalizeRoles(user)
  });
  return { ok: true, id, status: STATUS.SUBMITTED, user };
}

async function withdrawPrecal(payload, openid, user) {
  assertRole(user, 'sales', '只有 Sales 可以撤销 Pre-cal。');
  const id = payload && payload.precalRecordId;
  const reason = normalizeText(payload && payload.reason);
  if (!reason) throw new Error('请填写撤销原因。');
  const record = await getRecord(id);
  if (!record) throw new Error('Pre-cal 记录不存在。');
  if (record.createdBy !== openid && !hasRole(user, 'admin')) throw new Error('只能撤销自己创建的 Pre-cal。');
  if (record.status !== STATUS.SUBMITTED) throw new Error('只有 Submitted 状态可以撤销。');
  const now = db.serverDate();
  await precalRecords.doc(id).update({
    data: {
      status: STATUS.WITHDRAWN,
      isLocked: false,
      withdrawnAt: now,
      withdrawnBy: openid,
      withdrawReason: reason,
      updatedAt: now,
      updatedBy: openid,
      version: _.inc(1)
    }
  });
  await addLog(record, {
    logType: 'status_change', action: 'withdraw', fromStatus: STATUS.SUBMITTED, toStatus: STATUS.WITHDRAWN,
    reason, operatorOpenid: openid, operatorName: getUserName(user), operatorRoles: normalizeRoles(user)
  });
  return { ok: true, id, status: STATUS.WITHDRAWN, user };
}

async function getPrecalDetail(payload, openid, user) {
  const record = await getRecord(payload && payload.precalRecordId);
  if (!record) throw new Error('Pre-cal 记录不存在。');
  if (!canViewPrecal(user, openid, record)) throw new Error('无权查看该 Pre-cal。');
  const normalizedRecord = Object.assign({}, record, { sapBindings: mergeLegacySapBindings(record) });
  const arTime = await getArTimeForPrecal(normalizedRecord);
  return { ok: true, record: Object.assign({}, normalizedRecord, { arTime }), user };
}

async function getArTimeForPrecal(record) {
  const bindings = activeSapBindings(record);
  const sapOrderNos = uniqueTexts(bindings.map(item => item.sapOrderNo));
  if (!sapOrderNos.length) {
    return { sapOrderNos: [], totalArHours: 0, details: [], hasDetails: false, noActiveSap: true, warningText: '当前项目没有有效 SAP 绑定，AR Time 将无法匹配。' };
  }
  const activePairs = {};
  bindings.forEach(item => {
    activePairs[`${item.sapOrderNo}#${item.itemNo || '1000'}`] = true;
  });

  const rows = [];
  for (const chunk of chunkArray(sapOrderNos, 20)) {
    const fetchByQuery = async (query) => {
      let skip = 0;
      while (true) {
        const res = await arSummaries
          .where(query)
          .field({
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
          })
          .skip(skip)
          .limit(100)
          .get();
        const batch = res.data || [];
        rows.push(...batch.filter(item => item.active !== false && activePairs[`${normalizeText(item.sapOrderNo)}#${normalizeText(item.itemNo) || '1000'}`]));
        if (batch.length < 100) break;
        skip += batch.length;
      }
    };
    await fetchByQuery({ active: true, sapOrderNo: _.in(chunk) });
    if (typeof _.exists === 'function') {
      await fetchByQuery({ active: _.exists(false), sapOrderNo: _.in(chunk) });
    } else {
      await fetchByQuery({ active: _.neq(false), sapOrderNo: _.in(chunk) });
    }
  }

  const detailMap = {};
  rows.forEach(row => {
    const employeeName = normalizeText(row.employeeName || row.sheetName) || '-';
    const itemNo = normalizeText(row.itemNo) || '1000';
    const sapOrderNo = normalizeText(row.sapOrderNo);
    const key = `${employeeName}#${sapOrderNo}#${itemNo}`;
    if (!detailMap[key]) {
      detailMap[key] = { employeeName, sapOrderNo, itemNo, totalArHours: 0, recordCount: 0 };
    }
    detailMap[key].totalArHours += toNumber(row.totalArHours);
    detailMap[key].recordCount += toNumber(row.recordCount);
  });

  const details = Object.keys(detailMap).map(key => Object.assign({}, detailMap[key], {
    totalArHours: round4(detailMap[key].totalArHours),
    recordCount: round4(detailMap[key].recordCount)
  })).sort((a, b) => {
    const nameDiff = a.employeeName.localeCompare(b.employeeName);
    return nameDiff || a.itemNo.localeCompare(b.itemNo);
  });

  return {
    sapOrderNos,
    totalArHours: round4(sum(details, 'totalArHours')),
    details,
    hasDetails: details.length > 0,
    noActiveSap: false,
    warningText: ''
  };
}

async function listMyPrecal(payload, openid, user) {
  assertRole(user, 'sales', '只有 Sales 可以查看我的 Pre-cal。');
  const status = normalizeText(payload && payload.status);
  const keyword = normalizeText(payload && payload.keyword);
  const pageSize = 100;
  let skip = 0;
  let rows = [];
  while (true) {
    const res = await precalRecords.where({ createdBy: openid }).orderBy('updatedAt', 'desc').skip(skip).limit(pageSize).get();
    const batch = res.data || [];
    rows = rows.concat(batch);
    if (batch.length < pageSize) break;
    skip += batch.length;
  }
  rows = rows.filter(item => item.deleted !== true);
  if (status && status !== 'all') rows = rows.filter(item => item.status === status);
  rows = rows.filter(item => keywordMatch(item, keyword));
  return { ok: true, records: rows.map(buildListItem), user };
}

async function listPrecalForCS(payload, openid, user) {
  assertAnyRole(user, ['cs', 'admin'], '只有 CS 或 admin 可以查看 SAP 绑定列表。');
  const status = normalizeText(payload && payload.status);
  const keyword = normalizeText(payload && payload.keyword);
  const allowed = [STATUS.SUBMITTED, STATUS.SAP_BOUND, STATUS.PROJECT_CREATED];
  const queryStatus = status && status !== 'all' ? [status] : allowed;
  const pageSize = 100;
  let skip = 0;
  let rows = [];
  const baseQuery = { status: _.in(queryStatus.filter(s => allowed.indexOf(s) >= 0)) };
  while (true) {
    const res = await precalRecords.where(baseQuery).orderBy('submittedAt', 'desc').skip(skip).limit(pageSize).get();
    const batch = res.data || [];
    rows = rows.concat(batch);
    if (batch.length < pageSize) break;
    skip += batch.length;
  }
  rows = rows.filter(item => item.deleted !== true).filter(item => keywordMatch(item, keyword));
  return { ok: true, records: rows.map(buildListItem), user };
}

async function listPrecalForAdmin(payload, openid, user) {
  assertRole(user, 'admin', '只有 admin 可以查看全部 Pre-cal。');
  const status = normalizeText(payload && payload.status);
  const keyword = normalizeText(payload && payload.keyword);
  const pageSize = 100;
  let skip = 0;
  let rows = [];
  while (true) {
    const res = await precalRecords.orderBy('updatedAt', 'desc').skip(skip).limit(pageSize).get();
    const batch = res.data || [];
    rows = rows.concat(batch);
    if (batch.length < pageSize) break;
    skip += batch.length;
  }
  rows = rows.filter(item => item.deleted !== true);
  if (status && status !== 'all') rows = rows.filter(item => item.status === status);
  rows = rows.filter(item => keywordMatch(item, keyword));
  return { ok: true, records: rows.map(buildListItem), user };
}

function normalizeSapBindings(rawBindings) {
  const list = Array.isArray(rawBindings) ? rawBindings : [];
  const activeSeen = {};
  const rows = [];
  list.forEach((sap, index) => {
    const normalized = normalizeSapBinding(sap, index);
    if (!normalized) return;
    const activeKey = `${normalized.sapOrderNo}#${normalized.itemNo || '1000'}`;
    if (normalized.active !== false) {
      if (activeSeen[activeKey]) throw new Error(`SAP号 ${normalized.sapOrderNo} / Item ${normalized.itemNo || '1000'} 重复。`);
      activeSeen[activeKey] = true;
    }
    rows.push(normalized);
  });
  return rows;
}
function normalizeItemList(rawItems, rawBindings) {
  const list = Array.isArray(rawItems) ? rawItems : [];
  const flattenedLegacy = [];
  (Array.isArray(rawBindings) ? rawBindings : []).forEach(sap => {
    (Array.isArray(sap.items) ? sap.items : []).forEach(item => flattenedLegacy.push(item));
  });
  const source = list.length ? list : flattenedLegacy;
  const itemSeen = {};
  const normalized = source.map((item, idx) => {
    const itemNo = normalizeText(item.itemNo) || String((idx + 1) * 1000);
    if (itemSeen[itemNo]) return null;
    itemSeen[itemNo] = true;
    return {
      itemId: item.itemId || `I${Date.now()}_${Math.floor(Math.random() * 100000)}`,
      itemNo,
      itemDescription: normalizeText(item.itemDescription),
      remark: normalizeText(item.remark)
    };
  }).filter(Boolean);
  return normalized.length ? normalized : [{ itemId: `I${Date.now()}_${Math.floor(Math.random() * 100000)}`, itemNo: '1000', itemDescription: '', remark: '' }];
}

async function syncProjectsSapBindings(record, sapBindings, openid, now) {
  const precalId = record && record._id;
  const activeSapNos = uniqueTexts((sapBindings || [])
    .filter(item => item && item.active !== false)
    .map(item => item.sapOrderNo));
  const updateData = {
    sapBindings,
    sapNumbers: activeSapNos,
    sapBindingSyncedAt: now,
    sapBindingSyncedBy: openid,
    updatedAt: now,
    updatedBy: openid,
    version: _.inc(1)
  };
  const rows = [];
  const seen = {};
  const collect = async query => {
    const res = await projects.where(query).limit(100).get();
    (res.data || []).forEach(item => {
      if (!item || !item._id || item.deleted === true || seen[item._id]) return;
      seen[item._id] = true;
      rows.push(item);
    });
  };
  if (precalId) await collect({ precalId, deleted: _.neq(true) });
  if (record && record.createdProjectId) {
    try {
      const res = await projects.doc(record.createdProjectId).get();
      const item = Object.assign({ _id: record.createdProjectId }, res.data || {});
      if (item && item._id && item.deleted !== true && !seen[item._id]) rows.push(item);
    } catch (err) {
      console.warn('按 createdProjectId 同步项目 SAP 失败：', err && err.message || err);
    }
  }
  await Promise.all(rows.map(item => projects.doc(item._id).update({ data: updateData })));
  return rows.length;
}

async function bindSap(payload, openid, user) {
  assertAnyRole(user, ['cs', 'admin'], '只有 CS 或 admin 可以绑定 SAP号。');
  const id = payload && payload.precalRecordId;
  const reason = normalizeText(payload && payload.reason) || '保存 SAP 绑定信息';
  const record = await getRecord(id);
  if (!record) throw new Error('Pre-cal 记录不存在。');
  if ([STATUS.SUBMITTED, STATUS.SAP_BOUND, STATUS.PROJECT_CREATED].indexOf(record.status) < 0) throw new Error('只有 Submitted、SAP Bound 或 Project Created 状态可以维护 SAP号。');
  const sapBindings = normalizeSapBindings(payload && payload.sapBindings);
  const itemList = normalizeItemList(payload && payload.itemList, payload && payload.sapBindings);
  const previousBindings = mergeLegacySapBindings(record);

  const now = db.serverDate();
  const operatorName = getUserName(user, 'CS');
  const incomingKeys = {};
  sapBindings.forEach(sap => {
    incomingKeys[sap.sapId] = true;
    incomingKeys[`${sap.sapOrderNo}#${sap.itemNo || '1000'}`] = true;
  });
  const disabledFromRemoval = previousBindings
    .filter(sap => sap.active !== false)
    .filter(sap => !incomingKeys[sap.sapId] && !incomingKeys[`${sap.sapOrderNo}#${sap.itemNo || '1000'}`])
    .map(sap => Object.assign({}, sap, {
      active: false,
      disabledAt: sap.disabledAt || now,
      disabledBy: sap.disabledBy || openid,
      disabledReason: sap.disabledReason || 'user_removed',
      updatedBy: openid,
      updatedByName: operatorName,
      updatedAt: now
    }));
  const enriched = sapBindings.concat(disabledFromRemoval).map(sap => {
    const disabled = sap.active === false;
    return Object.assign({}, sap, {
      active: !disabled,
      createdBy: sap.createdBy || openid,
      createdByName: sap.createdByName || operatorName,
      createdAt: sap.createdAt || now,
      updatedBy: openid,
      updatedByName: operatorName,
      updatedAt: now,
      disabledAt: disabled ? (sap.disabledAt || now) : null,
      disabledBy: disabled ? (sap.disabledBy || openid) : null,
      disabledReason: disabled ? (sap.disabledReason || 'user_removed') : null
    });
  });
  if (!enriched.length) throw new Error('至少需要录入一个 SAP号。');

  await precalRecords.doc(id).update({
    data: {
      sapBindings: enriched,
      itemList,
      status: record.status === STATUS.PROJECT_CREATED ? STATUS.PROJECT_CREATED : STATUS.SAP_BOUND,
      isLocked: false,
      sapBoundAt: record.sapBoundAt || now,
      sapBoundBy: record.sapBoundBy || openid,
      updatedAt: now,
      updatedBy: openid,
      version: _.inc(1)
    }
  });

  await addLog(record, {
    logType: 'sap_change', action: 'bind_sap', oldValue: { sapBindings: record.sapBindings || [], itemList: record.itemList || [] }, newValue: { sapBindings: enriched, itemList },
    reason, operatorOpenid: openid, operatorName, operatorRoles: normalizeRoles(user)
  });
  if (record.status === STATUS.SUBMITTED) {
    await addLog(record, {
      logType: 'status_change', action: 'sap_bound', fromStatus: record.status, toStatus: STATUS.SAP_BOUND,
      reason, operatorOpenid: openid, operatorName, operatorRoles: normalizeRoles(user)
    });
  }
  await syncProjectsSapBindings(record, enriched, openid, now);
  return { ok: true, id, status: record.status === STATUS.PROJECT_CREATED ? STATUS.PROJECT_CREATED : STATUS.SAP_BOUND, user };
}

async function unlockPrecal(payload, openid, user) {
  assertRole(user, 'admin', '只有 admin 可以解锁 Pre-cal。');
  const id = payload && payload.precalRecordId;
  const reason = normalizeText(payload && payload.reason);
  if (!reason) throw new Error('请填写解锁原因。');
  const record = await getRecord(id);
  if (!record) throw new Error('Pre-cal 记录不存在。');
  if (record.status !== STATUS.SAP_BOUND) throw new Error('只有 SAP Bound 状态可以解锁。');
  const now = db.serverDate();
  await precalRecords.doc(id).update({
    data: {
      status: STATUS.UNLOCKED,
      isLocked: false,
      unlockedAt: now,
      unlockedBy: openid,
      unlockReason: reason,
      updatedAt: now,
      updatedBy: openid,
      version: _.inc(1)
    }
  });
  await addLog(record, {
    logType: 'admin_unlock', action: 'unlock', fromStatus: STATUS.SAP_BOUND, toStatus: STATUS.UNLOCKED,
    reason, operatorOpenid: openid, operatorName: getUserName(user), operatorRoles: normalizeRoles(user)
  });
  return { ok: true, id, status: STATUS.UNLOCKED, user };
}

async function cancelPrecal(payload, openid, user) {
  const id = payload && payload.precalRecordId;
  const reason = normalizeText(payload && payload.reason) || '取消 Pre-cal';
  const record = await getRecord(id);
  if (!record) throw new Error('Pre-cal 记录不存在。');
  if (!(record.createdBy === openid || hasRole(user, 'admin'))) throw new Error('无权取消该 Pre-cal。');
  if (record.status === STATUS.SAP_BOUND) throw new Error('已绑定 SAP 的记录不能直接取消。');
  const now = db.serverDate();
  await precalRecords.doc(id).update({ data: { status: STATUS.CANCELLED, updatedAt: now, updatedBy: openid, version: _.inc(1) } });
  await addLog(record, {
    logType: 'status_change', action: 'cancel', fromStatus: record.status, toStatus: STATUS.CANCELLED,
    reason, operatorOpenid: openid, operatorName: getUserName(user), operatorRoles: normalizeRoles(user)
  });
  return { ok: true, id, status: STATUS.CANCELLED, user };
}

async function getActiveParameters(payload, openid, user) {
  const doc = await getActiveParameterDoc();
  return { ok: true, parameters: doc, user };
}

async function updateParameters(payload, openid, user) {
  assertRole(user, 'admin', '只有 admin 可以维护 Pre-cal 参数。');
  const input = payload && payload.parameters ? payload.parameters : {};
  const now = db.serverDate();
  const data = {
    versionName: normalizeText(input.versionName) || DEFAULT_PARAMETERS.versionName,
    effectiveYear: toNumber(input.effectiveYear) || DEFAULT_PARAMETERS.effectiveYear,
    isActive: true,
    serviceRates: Array.isArray(input.serviceRates) ? input.serviceRates.map(item => ({
      service: normalizeText(item.service).toUpperCase(),
      serviceCode: normalizeText(item.serviceCode),
      hourlyRate: toNumber(item.hourlyRate),
      plannedMarginPercent: toNumber(item.plannedMarginPercent),
      allocationCostTotalCostsRatio: toNumber(item.allocationCostTotalCostsRatio),
      hourlyAllocationCost: toNumber(item.hourlyAllocationCost),
      allocationCostExtSalesRatio: toNumber(item.allocationCostExtSalesRatio),
      allocationCostICSalesRatio: toNumber(item.allocationCostICSalesRatio),
      productivity70HourlyRate: toNumber(item.productivity70HourlyRate),
      productivity80HourlyRate: toNumber(item.productivity80HourlyRate)
    })) : DEFAULT_PARAMETERS.serviceRates,
    orderCreateCenters: Array.isArray(input.orderCreateCenters) && input.orderCreateCenters.length ? input.orderCreateCenters.map(normalizeText).filter(Boolean) : DEFAULT_PARAMETERS.orderCreateCenters,
    updatedAt: now,
    updatedBy: openid,
    updatedByName: getUserName(user),
    deleted: false,
    version: _.inc(1)
  };

  const active = await getActiveParameterDoc();
  await precalParameters.doc(active._id).update({ data });
  await precalLogs.add({ data: {
    precalRecordId: '', precalNo: '', logType: 'parameter_change', action: 'update_parameters', oldValue: active, newValue: data,
    operatorOpenid: openid, operatorName: getUserName(user), operatorRoles: normalizeRoles(user), createdAt: now
  } });
  return { ok: true, parameters: Object.assign({}, active, data), user };
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  if (!openid) return { ok: false, message: '无法获取 openid。' };

  const user = await getCurrentUser(openid);
  const action = event && event.action;
  const payload = event && event.payload ? event.payload : event || {};

  try {
    if (action === 'createPrecal') return await createPrecal(payload, openid, user);
    if (action === 'updatePrecal') return await updatePrecal(payload, openid, user);
    if (action === 'submitPrecal') return await submitPrecal(payload, openid, user);
    if (action === 'withdrawPrecal') return await withdrawPrecal(payload, openid, user);
    if (action === 'getPrecalDetail') return await getPrecalDetail(payload, openid, user);
    if (action === 'listMyPrecal') return await listMyPrecal(payload, openid, user);
    if (action === 'listPrecalForCS') return await listPrecalForCS(payload, openid, user);
    if (action === 'listPrecalForAdmin') return await listPrecalForAdmin(payload, openid, user);
    if (action === 'bindSap') return await bindSap(payload, openid, user);
    if (action === 'unlockPrecal') return await unlockPrecal(payload, openid, user);
    if (action === 'cancelPrecal') return await cancelPrecal(payload, openid, user);
    if (action === 'getActiveParameters') return await getActiveParameters(payload, openid, user);
    if (action === 'updateParameters') return await updateParameters(payload, openid, user);
    return { ok: false, message: `未知操作：${action}`, user };
  } catch (err) {
    console.error(err);
    return { ok: false, message: err.message || 'precalService 服务异常。', user };
  }
};
