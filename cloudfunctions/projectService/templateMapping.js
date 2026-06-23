const PROJECT_EXPORT_TEMPLATE_MAPPING = {
  customerName: 'B3',
  sapNos: 'B4',
  projectPeriod: 'B5',
  pmName: 'B6',
  memberNames: 'B7',
  subProjectNameRow: 8,
  subProjectBudgetHoursRow: 9,
  subProjectUnitPriceRow: 10,
  travelCost: 'B11',
  bac: 'B12',
  memberAllocatedHoursRow: 13,
  plannedCompletedHoursRow: 14,
  plannedCompletionRatio: 'B15',
  plannedValue: 'B16',
  arMemberNameRow: 17,
  arHoursRow: 18,
  actualCompletionRatio: 'B19',
  earnedValue: 'B20',
  actualCost: 'B21',
  costVariance: 'B22',
  scheduleVariance: 'B23',
  costPerformanceIndex: 'B24',
  schedulePerformanceIndex: 'B25'
};

const PROJECT_EXPORT_SHEET = {
  firstDynamicColumn: 2,
  templateDynamicColumns: 3,
  remarkColumn: 5,
  maxSheetNameLength: 31
};

const SUMMARY_COLUMNS = [
  '项目名称',
  '客户名称',
  '所有 SAP 号',
  '项目状态',
  'PM',
  '项目组员',
  '项目开始日期',
  '项目结束日期',
  'closedAt',
  'BAC',
  '差旅费',
  '预算总人天',
  '预算总工时',
  '实际 AR Time',
  'PV',
  'EV',
  'AC',
  'CV',
  'CPI',
  'SPI',
  '导出时间',
  'AR 数据更新时间'
];

// If the Excel template changes, update this mapping first instead of scattering
// cell address changes throughout the export business logic.
module.exports = {
  PROJECT_EXPORT_TEMPLATE_MAPPING,
  PROJECT_EXPORT_SHEET,
  SUMMARY_COLUMNS
};
