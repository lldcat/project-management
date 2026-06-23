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

function formatMoney(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return Number(value).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '-';
  return `${(Number(value) * 100).toFixed(2)}%`;
}

function normalizeName(name, fallback) {
  const text = String(name || '').trim();
  return text || fallback || '未填写姓名';
}

function addToMap(map, key, value) {
  const current = map[key] || 0;
  map[key] = current + toNumber(value);
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
    const budgetHours = round2(budgetMap[name] || 0);
    const actualHours = round2(arMap[name] || 0);
    const varianceHours = round2((budgetMap[name] || 0) - (arMap[name] || 0));
    const usageRatio = safeDivide(arMap[name] || 0, budgetMap[name] || 0);
    return {
      memberName: name,
      budgetHours,
      actualHours,
      varianceHours,
      usageRatio: round2(usageRatio),
      isOverBudget: (budgetMap[name] || 0) > 0 && (arMap[name] || 0) > (budgetMap[name] || 0),
      hasArButNoBudget: !(budgetMap[name] || 0) && (arMap[name] || 0) > 0
    };
  });
}

function computeMetrics(project) {
  const constants = project.constants || {};
  const hoursPerDay = toNumber(constants.hoursPerDay) || 8;
  const personDayCost = toNumber(constants.personDayCost) || 5000;
  const travelFee = toNumber(project.travelFee);
  const subProjects = Array.isArray(project.subProjects) ? project.subProjects : [];
  const arHours = Array.isArray(project.arHours) ? project.arHours : [];
  const employeeBudgets = Array.isArray(project.employeeBudgets) ? project.employeeBudgets : [];

  const sumBudgetHours = subProjects.reduce((sum, item) => sum + toNumber(item.budgetHours), 0);
  const laborBudget = subProjects.reduce((sum, item) => {
    const unitPrice = hasNumericValue(item.budgetLaborUnitPriceRaw) ? item.budgetLaborUnitPriceRaw : item.budgetLaborUnitPrice;
    return sum + toNumber(item.budgetHours) / hoursPerDay * toNumber(unitPrice);
  }, 0);
  const sumPlannedHours = subProjects.reduce((sum, item) => sum + toNumber(item.plannedCompletedHours), 0);
  const sumArHours = arHours.reduce((sum, item) => sum + toNumber(item.hours), 0);
  const sumEmployeeBudgetHours = employeeBudgets.reduce((sum, item) => sum + toNumber(item.budgetHours), 0);
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
    plannedCompletionRatio: round2(plannedCompletionRatio),
    plannedValue: round2(plannedValue),
    sumArHours: round2(sumArHours),
    sumEmployeeBudgetHours: round2(sumEmployeeBudgetHours),
    budgetAllocationDiff: round2(budgetAllocationDiff),
    budgetAllocationRatio: round2(budgetAllocationRatio),
    memberBudgetComparisons,
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
    alerts.push({
      level: 'warning',
      code: 'EMPLOYEE_BUDGET_MISMATCH',
      text: `人员预算工时合计${direction}子项目预算工时，差异 ${Math.abs(metrics.budgetAllocationDiff).toFixed(2)} 小时。`
    });
  }

  const overBudgetMembers = (metrics.memberBudgetComparisons || [])
    .filter(item => item.isOverBudget)
    .map(item => item.memberName);
  if (overBudgetMembers.length) {
    alerts.push({ level: 'risk', code: 'MEMBER_AR_OVER_BUDGET', text: `${overBudgetMembers.join('、')} 的 AR 工时已超过个人预算工时。` });
  }

  const noBudgetMembers = (metrics.memberBudgetComparisons || [])
    .filter(item => item.hasArButNoBudget)
    .map(item => item.memberName);
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

  return alerts.map(item => Object.assign({}, item, {
    statusClass: item.level === 'risk' ? 'tag-risk' : (item.level === 'warning' ? 'tag-warning' : 'tag-normal')
  }));
}

function enrichProject(project) {
  const metrics = computeMetrics(project || {});
  const projectBudgetWithTravel = metrics.projectBudgetWithTravel === null || metrics.projectBudgetWithTravel === undefined
    ? (toNumber(metrics.bac) + toNumber(metrics.travelFee))
    : metrics.projectBudgetWithTravel;
  return Object.assign({}, project, {
    metrics,
    display: {
      laborBudget: formatMoney(metrics.laborBudget),
      travelFee: formatMoney(metrics.travelFee),
      projectBudgetWithTravel: formatMoney(projectBudgetWithTravel),
      bac: formatMoney(metrics.bac),
      plannedValue: formatMoney(metrics.plannedValue),
      earnedValue: formatMoney(metrics.earnedValue),
      actualCost: formatMoney(metrics.actualCost),
      costVariance: formatMoney(metrics.costVariance),
      scheduleVariance: formatMoney(metrics.scheduleVariance),
      cpi: formatNumber(metrics.costPerformanceIndex),
      spi: formatNumber(metrics.schedulePerformanceIndex),
      plannedCompletionRatio: formatPercent(metrics.plannedCompletionRatio),
      actualCompletionRatio: formatPercent(metrics.actualCompletionRatio),
      sumBudgetHours: formatNumber(metrics.sumBudgetHours),
      sumPlannedHours: formatNumber(metrics.sumPlannedHours),
      sumArHours: formatNumber(metrics.sumArHours),
      sumEmployeeBudgetHours: formatNumber(metrics.sumEmployeeBudgetHours),
      budgetAllocationDiff: formatNumber(metrics.budgetAllocationDiff),
      budgetAllocationRatio: formatPercent(metrics.budgetAllocationRatio),
      memberBudgetComparisons: (metrics.memberBudgetComparisons || []).map(item => ({
        memberName: item.memberName,
        budgetHours: formatNumber(item.budgetHours),
        actualHours: formatNumber(item.actualHours),
        varianceHours: formatNumber(item.varianceHours),
        usageRatio: formatPercent(item.usageRatio),
        statusText: item.isOverBudget ? '超预算' : (item.hasArButNoBudget ? '未分配预算' : '正常'),
        statusClass: item.isOverBudget ? 'tag-risk' : (item.hasArButNoBudget ? 'tag-warning' : 'tag-normal')
      }))
    }
  });
}

module.exports = {
  toNumber,
  computeMetrics,
  enrichProject,
  formatMoney,
  formatNumber,
  formatPercent
};
