function main(workbook: ExcelScript.Workbook) {
  const records: Record<string, string | number | boolean>[] = [];
  const summaries: Record<string, string | number>[] = [];
  const summaryMap: Record<string, {
    sheetName: string;
    employeeName: string;
    sapOrderNo: string;
    itemNo: string;
    totalArHours: number;
    recordCount: number;
  }> = {};

  workbook.getWorksheets().forEach(sheet => {
    const sheetName = sheet.getName();
    const usedRange = sheet.getUsedRange();
    if (!usedRange) return;

    const rowCount = usedRange.getRowIndex() + usedRange.getRowCount();
    if (rowCount < 1) return;

    const values = sheet.getRangeByIndexes(0, 0, rowCount, 9).getValues();
    values.forEach((row, index) => {
      const rowNumber = index + 1;
      const sapOrderNo = toCodeText(row[1]);
      if (!sapOrderNo) return;
      if (sapOrderNo.indexOf('7') !== 0 && sapOrderNo.indexOf('5') !== 0) return;
      if (isWeekendPlaceholder(row[0], sapOrderNo)) return;

      const rawItemNo = toCodeText(row[2]);
      const itemNo = rawItemNo || (sapOrderNo.indexOf('7') === 0 ? '1000' : '');
      const totalHours = getTotalHours(row);
      const isProjectRelated = sapOrderNo.indexOf('7') === 0;
      const record = {
        sheetName,
        employeeName: sheetName,
        rowNumber,
        date: toDateText(row[0]),
        sapOrderNo,
        rawItemNo,
        itemNo,
        clientName: toText(row[3]),
        onsiteHours: toNumberOrBlank(row[4]),
        officeHours: toNumberOrBlank(row[5]),
        travellingHours: toNumberOrBlank(row[6]),
        nonBillableHours: toNumberOrBlank(row[7]),
        totalHours,
        isProjectRelated
      };
      records.push(record);

      if (!isProjectRelated || totalHours === '') return;
      const key = `${sheetName}#${sapOrderNo}#${itemNo}`;
      if (!summaryMap[key]) {
        summaryMap[key] = { sheetName, employeeName: sheetName, sapOrderNo, itemNo, totalArHours: 0, recordCount: 0 };
      }
      summaryMap[key].totalArHours += Number(totalHours);
      summaryMap[key].recordCount += 1;
    });
  });

  Object.keys(summaryMap).forEach(key => {
    const summary = summaryMap[key];
    summaries.push({
      sheetName: summary.sheetName,
      employeeName: summary.employeeName,
      sapOrderNo: summary.sapOrderNo,
      itemNo: summary.itemNo,
      totalArHours: round2(summary.totalArHours),
      recordCount: summary.recordCount
    });
  });

  return {
    source: 'power-automate-office-script',
    runTime: new Date().toISOString(),
    recordCount: records.length,
    summaryCount: summaries.length,
    records,
    summaries
  };
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function toCodeText(value: unknown): string {
  return toText(value).replace(/\.0$/, '');
}

function toNumberOrBlank(value: unknown): number | '' {
  if (value === null || value === undefined || String(value).trim() === '') return '';
  const n = Number(value);
  return Number.isFinite(n) ? n : '';
}

function getTotalHours(row: (string | number | boolean)[]): number | '' {
  const total = toNumberOrBlank(row[8]);
  if (total !== '') return total;

  const hourValues = [row[4], row[5], row[6], row[7]].map(toNumberOrBlank);
  if (hourValues.every(value => value === '')) return '';

  return hourValues.reduce((sum: number, value) => sum + (value === '' ? 0 : value), 0);
}

function toDateText(value: unknown): string {
  if (value === null || value === undefined || String(value).trim() === '') return '';
  if (typeof value === 'number') {
    const epoch = Date.UTC(1899, 11, 30);
    return new Date(epoch + value * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  }
  return String(value).trim();
}

function isWeekendPlaceholder(dateValue: unknown, sapOrderNo: string): boolean {
  const text = `${toText(dateValue)} ${sapOrderNo}`.toUpperCase();
  return text.indexOf('SAT') === 0 || text.indexOf('SUN') === 0 || text.indexOf(' SAT') >= 0 || text.indexOf(' SUN') >= 0;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
