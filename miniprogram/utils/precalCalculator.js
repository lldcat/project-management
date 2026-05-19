function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function round4(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return 0;
  return Math.round(Number(value) * 10000) / 10000;
}

function safeDivide(a, b) {
  const d = toNumber(b);
  if (!d) return 0;
  return toNumber(a) / d;
}

function sum(items, getter) {
  return (items || []).reduce((acc, item) => acc + toNumber(typeof getter === 'function' ? getter(item) : item[getter]), 0);
}

function getServiceRate(service, parameters) {
  const rates = (parameters && parameters.serviceRates) || [];
  const clean = String(service || 'ESG').toUpperCase();
  return rates.find(item => String(item.service || '').toUpperCase() === clean) || rates[0] || {};
}

function cleanLine(line, index) {
  const raw = line || {};
  return {
    lineId: raw.lineId || `L${Date.now()}_${index}`,
    productDescription: raw.productDescription || '',
    orderCreateCenter: raw.orderCreateCenter || '',
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

function calculateLineItem(line, ctx) {
  const rate = ctx.serviceRate || {};
  const totalOrderValue = ctx.totalOrderValue;
  const orderValue = toNumber(line.orderValue);
  const onsiteMD = toNumber(line.onsiteMD);
  const offsiteMD = toNumber(line.offsiteMD);
  const quotationMDDefault = orderValue > 0 && totalOrderValue > 0 ? 0.5 * orderValue / totalOrderValue : 0;
  const quotationMD = line.quotationMDOverridden ? toNumber(line.quotationMD) : quotationMDDefault;
  const travelMDDefault = onsiteMD * 0.1;
  const travelMD = line.travelMDOverridden ? toNumber(line.travelMD) : travelMDDefault;
  const totalMD = onsiteMD + offsiteMD + quotationMD + travelMD;
  const hours = totalMD * 8;
  const netSales = orderValue - toNumber(line.subcontractingTranslation) - toNumber(line.subcontractingDesign) - toNumber(line.subcontractingTravel) - toNumber(line.subcontractingOther) - toNumber(line.subcontractingIC) - toNumber(line.internalSubcon);
  const mdCosts = hours * toNumber(rate.hourlyRate);
  const resultOfOrder = netSales - toNumber(line.otherProjectCosts) - mdCosts;
  const icSubconRate = String(line.orderCreateCenter) === '2160' ? 0.8 : 0;
  const allocationCostByExtSales = orderValue * toNumber(rate.allocationCostExtSalesRatio);
  const allocationCostByICSales = 0; // 当前 AUD Pre-cal 的 D40:H40 为空，IC sales allocation 组件按 Excel 现状为 0。
  const allocationCostsByHour = hours * toNumber(rate.hourlyAllocationCost);
  const allocationCostSimulation = String(line.orderCreateCenter) === '2160'
    ? allocationCostByExtSales + allocationCostByICSales - allocationCostsByHour
    : allocationCostByExtSales - allocationCostsByHour;
  const overhead = Math.max(allocationCostSimulation, 0);
  const operatingResult = netSales - toNumber(line.otherProjectCosts) - mdCosts - overhead;
  const subcontractingSalesRatio = safeDivide(
    toNumber(line.subcontractingTranslation) + toNumber(line.subcontractingDesign) + toNumber(line.subcontractingTravel) + toNumber(line.subcontractingOther) + toNumber(line.subcontractingIC),
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
      roMargin: round4(safeDivide(resultOfOrder, orderValue)),
      allocationCostByExtSales: round4(allocationCostByExtSales),
      allocationCostByICSales: round4(allocationCostByICSales),
      allocationCostsByHour: round4(allocationCostsByHour),
      allocationCostSimulation: round4(allocationCostSimulation),
      overhead: round4(overhead),
      operatingResult: round4(operatingResult),
      operatingMargin: round4(safeDivide(operatingResult, orderValue)),
      subcontractingSalesRatio: round4(subcontractingSalesRatio)
    }
  });
}

function calculateSummary(lineItems, rate) {
  const totalOrderValue = sum(lineItems, 'orderValue');
  const resultOfOrder = sum(lineItems, item => item.calculated.resultOfOrder);
  const operatingResult = sum(lineItems, item => item.calculated.operatingResult);
  const totalSub = sum(lineItems, item => toNumber(item.subcontractingTranslation) + toNumber(item.subcontractingDesign) + toNumber(item.subcontractingTravel) + toNumber(item.subcontractingOther) + toNumber(item.subcontractingIC));
  return {
    totalOrderValue: round4(totalOrderValue),
    totalOnsiteMD: round4(sum(lineItems, 'onsiteMD')),
    totalOffsiteMD: round4(sum(lineItems, 'offsiteMD')),
    totalQuotationMD: round4(sum(lineItems, 'quotationMD')),
    totalTravelMD: round4(sum(lineItems, 'travelMD')),
    totalMD: round4(sum(lineItems, item => item.calculated.totalMD)),
    totalHours: round4(sum(lineItems, item => item.calculated.hours)),
    totalNetSales: round4(sum(lineItems, item => item.calculated.netSales)),
    totalMDCosts: round4(sum(lineItems, item => item.calculated.mdCosts)),
    resultOfOrder: round4(resultOfOrder),
    roMargin: round4(safeDivide(resultOfOrder, totalOrderValue)),
    overhead: round4(sum(lineItems, item => item.calculated.overhead)),
    operatingResult: round4(operatingResult),
    operatingMargin: round4(safeDivide(operatingResult, totalOrderValue)),
    plannedORSales: round4(toNumber(rate.plannedMarginPercent) / 100),
    subcontractingSalesRatio: round4(safeDivide(totalSub, totalOrderValue))
  };
}

function calculateScenario(lineItems, rate, hourlyRate) {
  const hr = toNumber(hourlyRate);
  if (!hr) return { available: false, plannedORSales: round4(toNumber(rate.plannedMarginPercent) / 100) };
  const totalOrderValue = sum(lineItems, 'orderValue');
  const totalNetSales = sum(lineItems, item => item.calculated.netSales);
  const totalOther = sum(lineItems, 'otherProjectCosts');
  const totalHours = sum(lineItems, item => item.calculated.hours);
  const overhead = sum(lineItems, item => item.calculated.overhead);
  const mdCosts = totalHours * hr;
  const resultOfOrder = totalNetSales - totalOther - mdCosts;
  const operatingResult = totalNetSales - totalOther - mdCosts - overhead;
  return {
    available: true,
    hourlyRate: round4(hr),
    mdCosts: round4(mdCosts),
    resultOfOrder: round4(resultOfOrder),
    roMargin: round4(safeDivide(resultOfOrder, totalOrderValue)),
    overhead: round4(overhead),
    operatingResult: round4(operatingResult),
    operatingMargin: round4(safeDivide(operatingResult, totalOrderValue)),
    plannedORSales: round4(toNumber(rate.plannedMarginPercent) / 100)
  };
}

function formulaExplanations() {
  return {
    quotationMD: { label: '报价阶段MD', formula: '0.5 × 当前明细金额 / 总订单金额', note: '可手动覆盖。' },
    travelMD: { label: '差旅MD', formula: 'Onsite MD × 10%', note: '按确认后的逻辑计算。' },
    netSales: { label: 'Net Sales', formula: 'Order Value - 分包费用 - internal subcon' },
    mdCosts: { label: 'MD Costs', formula: 'Hours × Hourly Rate' },
    resultOfOrder: { label: 'RO', formula: 'Net Sales - Other Project Costs - MD Costs' },
    operatingResult: { label: 'Operating Result', formula: 'Net Sales - Other Project Costs - MD Costs - Overhead' }
  };
}

function calculatePrecal(record, parameters) {
  const rate = getServiceRate(record.service, parameters);
  const lines = (record.lineItems || []).map(cleanLine);
  const totalOrderValue = sum(lines, 'orderValue');
  const calculatedLines = lines.map(line => calculateLineItem(line, { totalOrderValue, serviceRate: rate }));
  return {
    serviceCode: rate.serviceCode || '',
    lineItems: calculatedLines,
    calculationResult: calculateSummary(calculatedLines, rate),
    productivityScenarios: {
      productivity70: calculateScenario(calculatedLines, rate, rate.productivity70HourlyRate),
      productivity80: calculateScenario(calculatedLines, rate, rate.productivity80HourlyRate)
    },
    formulaExplanations: formulaExplanations()
  };
}

function formatMoney(value) {
  const n = toNumber(value);
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatPercent(value) {
  return `${(toNumber(value) * 100).toFixed(2)}%`;
}

module.exports = {
  calculatePrecal,
  toNumber,
  formatMoney,
  formatPercent
};
