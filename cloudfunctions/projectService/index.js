const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;
const users = db.collection('users');
const projects = db.collection('projects');

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
    return sum + toNumber(item.budgetHours) / hoursPerDay * toNumber(item.budgetLaborUnitPrice);
  }, 0);
  const sumPlannedHours = subProjects.reduce((sum, item) => sum + toNumber(item.plannedCompletedHours), 0);
  const sumEmployeeBudgetHours = employeeBudgets.reduce((sum, item) => sum + toNumber(item.budgetHours), 0);
  const sumArHours = arHours.reduce((sum, item) => sum + toNumber(item.hours), 0);
  const memberBudgetComparisons = buildMemberBudgetComparisons(employeeBudgets, arHours);

  const bac = laborBudget + travelFee;
  const plannedCompletionRatio = safeDivide(sumPlannedHours, sumBudgetHours);
  const plannedValue = plannedCompletionRatio === null ? null : bac * plannedCompletionRatio;
  const actualCompletionRatio = safeDivide(sumArHours, sumBudgetHours);
  const earnedValue = actualCompletionRatio === null ? null : bac * actualCompletionRatio;
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
    map[name] = item[valueField];
  });
  return map;
}

function buildEmployeeBudgetsFromNames(names, existingBudgets) {
  const budgetMap = valueMapByMemberName(existingBudgets, 'budgetHours');
  return uniqueNames(names).map(name => ({
    id: ((existingBudgets || []).find(item => normalizeName(item.memberName, '') === name) || {}).id || '',
    memberName: name,
    budgetHours: toNumber(budgetMap[name])
  }));
}

function alignArHoursToEmployeeBudgets(employeeBudgets, existingArHours) {
  const arMap = valueMapByMemberName(existingArHours, 'hours');
  return (employeeBudgets || []).map(item => {
    const name = normalizeName(item.memberName, '');
    return {
      id: ((existingArHours || []).find(ar => normalizeName(ar.memberName, '') === name) || {}).id || '',
      memberName: name,
      hours: toNumber(arMap[name])
    };
  }).filter(item => item.memberName);
}

function cleanProjectInput(input) {
  const project = input || {};
  const projectManager = String(project.projectManager || '').trim();
  const projectMembers = Array.isArray(project.projectMembers) ? project.projectMembers.map(String).map(item => item.trim()).filter(Boolean) : [];
  const rawEmployeeBudgets = Array.isArray(project.employeeBudgets) ? project.employeeBudgets.map(item => ({
    id: item.id || '',
    memberName: String(item.memberName || '').trim(),
    budgetHours: toNumber(item.budgetHours)
  })).filter(item => item.memberName) : [];

  const employeeNames = uniqueNames([projectManager].concat(projectMembers, rawEmployeeBudgets.map(item => item.memberName)));
  const employeeBudgets = buildEmployeeBudgetsFromNames(employeeNames, rawEmployeeBudgets);
  const arHours = alignArHoursToEmployeeBudgets(employeeBudgets, Array.isArray(project.arHours) ? project.arHours : []);

  return {
    projectName: String(project.projectName || '').trim(),
    customerName: String(project.customerName || '').trim(),
    projectNo: String(project.projectNo || '').trim(),
    startDate: String(project.startDate || '').trim(),
    endDate: String(project.endDate || '').trim(),
    projectManager,
    projectMembers,
    status: project.status || 'active',
    travelFee: toNumber(project.travelFee),
    constants: {
      hoursPerDay: 8,
      personDayCost: toNumber(project.constants && project.constants.personDayCost) || 5000
    },
    subProjects: Array.isArray(project.subProjects) ? project.subProjects.map(item => ({
      id: item.id || '',
      name: String(item.name || '').trim(),
      budgetHours: toNumber(item.budgetHours),
      budgetLaborUnitPrice: toNumber(item.budgetLaborUnitPrice),
      plannedCompletedHours: toNumber(item.plannedCompletedHours)
    })) : [],
    employeeBudgets,
    arHours
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

function ownsProject(project, openid) {
  return project && (project.ownerOpenid === openid || project._openid === openid || project.createdBy === openid);
}

function normalizeRoles(user) {
  if (user && Array.isArray(user.roles) && user.roles.length) return user.roles.map(String);
  if (user && user.role) return [String(user.role)];
  return ['pm'];
}

function hasRole(user, role) {
  return normalizeRoles(user).indexOf(role) >= 0;
}

function hasAnyRole(user, roles) {
  const userRoles = normalizeRoles(user);
  return (roles || []).some(role => userRoles.indexOf(role) >= 0);
}

function canViewAll(user) {
  return hasAnyRole(user, ['leader', 'admin', 'ar']);
}

function canEditAll(user) {
  return hasRole(user, 'admin');
}

function canView(project, openid, user) {
  if (canViewAll(user)) return true;
  return ownsProject(project, openid);
}

function canEdit(project, openid, user) {
  if (canEditAll(user)) return true;
  return ownsProject(project, openid);
}

function decorateProjectAccess(project, openid, user) {
  return Object.assign({}, project, {
    _canEdit: canEdit(project, openid, user),
    _canViewAll: canViewAll(user),
    _isOwnProject: ownsProject(project, openid)
  });
}

async function listProjects(openid, user) {
  const baseQuery = canViewAll(user) ? {} : _.or([{ ownerOpenid: openid }, { _openid: openid }, { createdBy: openid }]);
  const res = await projects.where(baseQuery).orderBy('updatedAt', 'desc').limit(200).get();
  return (res.data || [])
    .filter(item => item.deleted !== true)
    .map(item => decorateProjectAccess(item, openid, user));
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
    '人工预算(不含差旅)', '差旅费', 'BAC-项目总预算(含差旅)',
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
      m.laborBudget,
      m.travelFee,
      m.bac,
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

exports.main = async (event) => {
  const wxContext = cloud.getWXContext();
  const openid = wxContext.OPENID;
  const action = event.action;
  const now = db.serverDate();

  if (!openid) return { ok: false, message: '无法获取 openid。' };

  const user = await getCurrentUser(openid);

  try {
    if (action === 'list') {
      const data = await listProjects(openid, user);
      return { ok: true, projects: data, user };
    }

    if (action === 'detail') {
      const project = await getProjectById(event.id);
      if (!project) return { ok: false, message: '项目不存在。', user };
      if (!canView(project, openid, user)) return { ok: false, message: '无权查看该项目。', user };
      return { ok: true, project: decorateProjectAccess(project, openid, user), user };
    }

    if (action === 'save') {
      const cleaned = cleanProjectInput(event.project);
      cleaned.metrics = computeMetrics(cleaned);
      cleaned.updatedAt = now;
      cleaned.updatedBy = openid;

      if (event.id) {
        const existing = await getProjectById(event.id);
        if (!existing) return { ok: false, message: '项目不存在，无法更新。', user };
        if (!canEdit(existing, openid, user)) return { ok: false, message: '无权编辑该项目。部门 Leader 默认只查看全部项目，如需修改请联系项目创建人。', user };
        await projects.doc(event.id).update({ data: Object.assign({}, cleaned, { version: _.inc(1) }) });
        return { ok: true, id: event.id, user };
      }

      cleaned._openid = openid;
      cleaned.ownerOpenid = openid;
      cleaned.createdAt = now;
      cleaned.createdBy = openid;
      cleaned.deleted = false;
      cleaned.version = 1;
      const addRes = await projects.add({ data: cleaned });
      return { ok: true, id: addRes._id, user };
    }

    if (action === 'remove') {
      const project = await getProjectById(event.id);
      if (!project) return { ok: false, message: '项目不存在。', user };
      if (!canEdit(project, openid, user)) return { ok: false, message: '无权删除该项目。部门 Leader 默认只查看全部项目，如需删除请联系项目创建人。', user };
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
      const data = await listProjects(openid, user);
      const rows = data.map(item => Object.assign({}, item, { metrics: item.metrics || computeMetrics(item) }));
      return { ok: true, csv: buildCsv(rows), user };
    }

    return { ok: false, message: `未知操作：${action}`, user };
  } catch (err) {
    console.error(err);
    return { ok: false, message: err.message || '服务异常。', user };
  }
};
