import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const emptyRow = (userId) => ({ user_id: userId, date: '', sap_order_no: '', item_no: '', client_name: '', inspection_time: 0, office_time: 0, travelling_time: 0, non_billable_time: 0, total_time: 0, description: '', record_type: 'non_project', task: '' });

function App() {
  const [users, setUsers] = useState([]); const [currentUser, setCurrentUser] = useState(2);
  const [records, setRecords] = useState([]); const [meta, setMeta] = useState({ taskMap: {}, sapOptions: [] });
  const [filters, setFilters] = useState({ month: '', user_id: '', sap_order_no: '', client_name: '', record_type: '' });
  const [importResult, setImportResult] = useState(null);
  const me = users.find((u) => u.id === Number(currentUser));

  const load = async () => {
    const [u, m, r] = await Promise.all([
      fetch('/api/users').then((x) => x.json()),
      fetch('/api/meta').then((x) => x.json()),
      fetch('/api/records?' + new URLSearchParams({ ...filters, role: me?.role || 'employee', user_id: filters.user_id || currentUser })).then((x) => x.json())
    ]);
    setUsers(u); setMeta(m); setRecords(r);
  };
  useEffect(() => { load(); }, [currentUser]);

  const setCell = (idx, k, v) => setRecords((arr) => arr.map((r, i) => {
    if (i !== idx) return r;
    const n = { ...r, [k]: v };
    ['inspection_time', 'office_time', 'travelling_time', 'non_billable_time'].forEach((f) => n[f] = Number(n[f] || 0));
    n.total_time = n.inspection_time + n.office_time + n.travelling_time + n.non_billable_time;
    if (k === 'task') { n.sap_order_no = me?.default_sap; n.item_no = meta.taskMap[v]?.[n.sap_order_no] || ''; n.description = v; }
    return n;
  }));

  const save = async () => { await fetch('/api/records/bulk-save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ records }) }); await load(); };
  const exportRows = async () => {
    const ids = records.filter((r) => r.id).map((r) => r.id);
    const res = await fetch('/api/records/export', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids }) });
    const blob = await res.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'ar-export.xlsx'; a.click(); await load();
  };
  const errors = useMemo(() => importResult?.errors || [], [importResult]);

  return <div className='p'>
    <h2>AR PC Web（独立版）</h2>
    <div className='note'>提醒：非项目类记录自动使用员工默认 SAP Order No.，Task 会自动带出 Item No.</div>
    <div>当前用户：<select value={currentUser} onChange={(e)=>setCurrentUser(e.target.value)}>{users.map(u=><option key={u.id} value={u.id}>{u.name} ({u.role})</option>)}</select></div>
    <div className='toolbar'>
      <input type='month' onChange={(e)=>setFilters({...filters, month:e.target.value})}/><input placeholder='Client Name' onChange={(e)=>setFilters({...filters, client_name:e.target.value})}/>
      <button onClick={load}>筛选</button><button onClick={()=>setRecords([...records, emptyRow(Number(currentUser))])}>新增行</button><button onClick={save}>批量保存</button><button onClick={exportRows}>导出Excel</button>
      <input type='file' accept='.xlsx,.xls' onChange={async (e)=>{const fd = new FormData(); fd.append('file', e.target.files[0]); const r = await fetch('/api/records/import/preview', { method:'POST', body:fd}); setImportResult(await r.json());}}/>
    </div>
    <table><thead><tr>{['Date','SAP Order No.','Task','Item No.','Client Name','Inspection','Office','Travel','Non-billable','Total','Description','Record Type','操作'].map(h=><th key={h}>{h}</th>)}</tr></thead>
    <tbody>{records.map((r,i)=><tr key={i} className={r.exported?'locked':''}>
      <td><input value={r.date||''} onChange={e=>setCell(i,'date',e.target.value)} disabled={me?.role==='employee'&&r.exported}/></td>
      <td><input value={r.sap_order_no||''} onChange={e=>setCell(i,'sap_order_no',e.target.value)} disabled={me?.role==='employee'&&r.exported}/></td>
      <td><select value={r.task||''} onChange={e=>setCell(i,'task',e.target.value)}><option></option>{Object.keys(meta.taskMap).map(t=><option key={t}>{t}</option>)}</select></td>
      <td><input value={r.item_no||''} onChange={e=>setCell(i,'item_no',e.target.value)}/></td><td><input value={r.client_name||''} onChange={e=>setCell(i,'client_name',e.target.value)}/></td>
      {['inspection_time','office_time','travelling_time','non_billable_time'].map(f=><td key={f}><input type='number' value={r[f]??0} onChange={e=>setCell(i,f,e.target.value)} /></td>)}
      <td><input value={r.total_time||0} readOnly/></td><td><input value={r.description||''} onChange={e=>setCell(i,'description',e.target.value)}/></td>
      <td><select value={r.record_type||'non_project'} onChange={e=>setCell(i,'record_type',e.target.value)}><option value='non_project'>non_project</option><option value='project'>project</option></select></td>
      <td><button onClick={async ()=>{if(r.id){await fetch('/api/records/'+r.id,{method:'DELETE'});load();} else setRecords(records.filter((_,x)=>x!==i));}}>删除</button></td>
    </tr>)}</tbody></table>
    {importResult && <div><h4>导入预览（仅校验不入库）</h4><div>行数: {importResult.rows.length}</div>{errors.map((e,ix)=><div key={ix} className='err'>第{e.row}行 {e.field}: {e.reason}</div>)}</div>}
  </div>;
}

createRoot(document.getElementById('root')).render(<App />);
