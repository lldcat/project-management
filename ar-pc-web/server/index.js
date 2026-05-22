import express from 'express';
import cors from 'cors';
import Database from 'better-sqlite3';
import multer from 'multer';
import XLSX from 'xlsx';

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
app.use(cors());
app.use(express.json({ limit: '5mb' }));

const db = new Database(new URL('./ar.db', import.meta.url).pathname);

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('employee','admin')),
  default_sap TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ar_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  sap_order_no TEXT NOT NULL,
  item_no TEXT,
  client_name TEXT,
  inspection_time REAL DEFAULT 0,
  office_time REAL DEFAULT 0,
  travelling_time REAL DEFAULT 0,
  non_billable_time REAL DEFAULT 0,
  total_time REAL DEFAULT 0,
  description TEXT,
  record_type TEXT DEFAULT 'non_project',
  exported INTEGER DEFAULT 0,
  FOREIGN KEY(user_id) REFERENCES users(id)
);
`);

const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get().c;
if (!userCount) {
  db.prepare('INSERT INTO users(name,role,default_sap) VALUES (?,?,?)').run('Admin', 'admin', '21601350');
  db.prepare('INSERT INTO users(name,role,default_sap) VALUES (?,?,?)').run('Employee A', 'employee', '48201350');
}

const TASK_MAP = {
  'Administration activities': { '21601350': '501631', '48201350': '500908', '48301350': '500909', '48401350': '500910' },
  'Attend/conduct training, seminar, workshop or conference': { '21601350': '501632', '48201350': '500915', '48301350': '500916', '48401350': '500917' },
  'Audit activities (if unit is subject to internal or external audit)': { '21601350': '501633', '48201350': '500943', '48301350': '500944', '48401350': '500945' },
  'Corrective and Preventive Action (CPA) activities': { '21601350': '501634', '48201350': '500950', '48301350': '500951', '48401350': '500952' },
  'Customer communication, enquiries, visits, marketing': { '21601350': '501635', '48201350': '500929', '48301350': '500930', '48401350': '500931' },
  'Equipment calibration, maintenance, repair': { '21601350': '501636', '48201350': '500957', '48301350': '500958', '48401350': '500959' },
  'Housekeeping, 5S, workplace safety activities': { '21601350': '501637', '48201350': '500936', '48301350': '500937', '48401350': '500938' },
  Leave: { '21601350': '501638', '48201350': '500894', '48301350': '500895', '48401350': '500896' },
  'Management activities': { '21601350': '501639', '48201350': '500964', '48301350': '500965', '48401350': '500966' },
  Meetings: { '21601350': '501640', '48201350': '500994', '48301350': '500995', '48401350': '500996' },
  Others: { '21601350': '501641', '48201350': '500978', '48301350': '500979', '48401350': '500980' },
  'Prepare quotations, payment notice': { '21601350': '501642', '48201350': '500971', '48301350': '500972', '48401350': '500973' },
  'Read test standards or other technical specifications': { '21601350': '501643', '48201350': '500922', '48301350': '500923', '48401350': '500924' },
  Sickness: { '21601350': '501644', '48201350': '500901', '48301350': '500902', '48401350': '500903' }
};

const calcTotal = (r) => Number(r.inspection_time || 0) + Number(r.office_time || 0) + Number(r.travelling_time || 0) + Number(r.non_billable_time || 0);

app.get('/api/meta', (_, res) => res.json({ taskMap: TASK_MAP, sapOptions: ['21601350', '48201350', '48301350', '48401350'] }));
app.get('/api/users', (_, res) => res.json(db.prepare('SELECT * FROM users').all()));
app.put('/api/users/:id/default-sap', (req, res) => {
  db.prepare('UPDATE users SET default_sap=? WHERE id=?').run(req.body.default_sap, req.params.id);
  res.json({ ok: true });
});

app.get('/api/records', (req, res) => {
  const { month, user_id, sap_order_no, client_name, record_type, role } = req.query;
  let q = `SELECT r.*, u.name user_name FROM ar_records r JOIN users u ON u.id=r.user_id WHERE 1=1`;
  const p = [];
  if (month) { q += ' AND substr(r.date,1,7)=?'; p.push(month); }
  if (user_id) { q += ' AND r.user_id=?'; p.push(user_id); }
  if (sap_order_no) { q += ' AND r.sap_order_no=?'; p.push(sap_order_no); }
  if (client_name) { q += ' AND r.client_name LIKE ?'; p.push(`%${client_name}%`); }
  if (record_type) { q += ' AND r.record_type=?'; p.push(record_type); }
  if (role === 'employee' && user_id) { q += ' AND r.user_id=?'; p.push(user_id); }
  res.json(db.prepare(q + ' ORDER BY r.date DESC').all(...p));
});

app.post('/api/records/bulk-save', (req, res) => {
  const tx = db.transaction((rows) => {
    for (const r of rows) {
      const total = calcTotal(r);
      if (r.id) {
        db.prepare(`UPDATE ar_records SET date=?,sap_order_no=?,item_no=?,client_name=?,inspection_time=?,office_time=?,travelling_time=?,non_billable_time=?,total_time=?,description=?,record_type=? WHERE id=? AND exported=0`).run(
          r.date, r.sap_order_no, r.item_no, r.client_name, r.inspection_time, r.office_time, r.travelling_time, r.non_billable_time, total, r.description, r.record_type || 'non_project', r.id
        );
      } else {
        db.prepare(`INSERT INTO ar_records(user_id,date,sap_order_no,item_no,client_name,inspection_time,office_time,travelling_time,non_billable_time,total_time,description,record_type) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          r.user_id, r.date, r.sap_order_no, r.item_no, r.client_name, r.inspection_time, r.office_time, r.travelling_time, r.non_billable_time, total, r.description, r.record_type || 'non_project'
        );
      }
    }
  });
  tx(req.body.records || []);
  res.json({ ok: true });
});

app.delete('/api/records/:id', (req, res) => {
  db.prepare('DELETE FROM ar_records WHERE id=? AND exported=0').run(req.params.id);
  res.json({ ok: true });
});

app.post('/api/records/import/preview', upload.single('file'), (req, res) => {
  const wb = XLSX.read(req.file.buffer, { type: 'buffer' });
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  const errors = [];
  rows.forEach((row, i) => {
    ['Date', 'SAP Order No.', 'Description'].forEach((k) => { if (!row[k]) errors.push({ row: i + 2, field: k, reason: '必填' }); });
  });
  res.json({ rows, errors });
});

app.post('/api/records/export', (req, res) => {
  const rows = db.prepare('SELECT date as "Date", sap_order_no as "SAP Order No.", item_no as "Item No.", client_name as "Client Name", inspection_time as "Inspection/On Site Time (H)", office_time as "Office Time (H)", travelling_time as "Travelling Time (H)", non_billable_time as "Non-billable (H)", total_time as "Total Time (H)", description as "Description", id FROM ar_records WHERE id IN (' + req.body.ids.map(() => '?').join(',') + ')').all(...req.body.ids);
  const ids = rows.map((r) => r.id);
  rows.forEach((r) => delete r.id);
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'AR');
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  if (ids.length) db.prepare(`UPDATE ar_records SET exported=1 WHERE id IN (${ids.map(() => '?').join(',')})`).run(...ids);
  res.setHeader('Content-Disposition', 'attachment; filename="ar-export.xlsx"');
  res.end(buf);
});

app.listen(3001, () => console.log('server on 3001'));
