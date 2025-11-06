import React, { useEffect, useMemo, useState } from 'react';
import * as d3 from 'd3';
import Papa from 'papaparse';

/**
 * Market Intelligence Graph — compact demo (≈600 lines)
 * Tabs: Graph | Market Pulse | League Table
 * Theme: tech/corporate blue
 */

// ---------------- Sample Data (replace via CSV upload) ----------------
const SAMPLE_NODES = [
  { id: 'COMP:AAPL', label: 'Apple Inc.', type: 'Company', ticker: 'AAPL', sector: 'Technology', country: 'United States' },
  { id: 'COMP:MSFT', label: 'Microsoft', type: 'Company', ticker: 'MSFT', sector: 'Technology', country: 'United States' },
  { id: 'COMP:NVDA', label: 'NVIDIA', type: 'Company', ticker: 'NVDA', sector: 'Technology', country: 'United States' },
  { id: 'COMP:AMZN', label: 'Amazon', type: 'Company', ticker: 'AMZN', sector: 'Consumer Disc.', country: 'United States' },
];

const SAMPLE_EDGES = [
  { source: 'COMP:AAPL', target: 'COMP:MSFT', type: 'MENTION|STRATEGIC_PARTNER', weight: 1.8 },
  { source: 'COMP:AAPL', target: 'COMP:NVDA', type: 'SUPPLIER', weight: 1.3 },
  { source: 'COMP:MSFT', target: 'COMP:NVDA', type: 'STRATEGIC_PARTNER', weight: 1.7 },
  { source: 'COMP:NVDA', target: 'COMP:AMZN', type: 'MARKET_ACTIVITY', weight: 1.2 },
  { source: 'COMP:AAPL', target: 'COMP:AMZN', type: 'NEWS_CO_MENTION', weight: 1.4 },
];

const SAMPLE_BONDS = [
  { id: 'BOND:AAPL-2029', issuer_ticker: 'AAPL', label: 'AAPL 3.1% 2029', face_value: 1500000000, coupon: 0.031, issue_date: '2022-10-01', maturity_date: '2029-10-01', rating: 'AA-' },
  { id: 'BOND:MSFT-2030', issuer_ticker: 'MSFT', label: 'MSFT 2.8% 2030', face_value: 2200000000, coupon: 0.028, issue_date: '2020-05-01', maturity_date: '2030-05-01', rating: 'AAA' },
];

const SAMPLE_RATINGS = [
  { issuer_ticker: 'AAPL', moodys: 'Aa1', sp: 'AA+', fitch: 'AA+' },
  { issuer_ticker: 'MSFT', moodys: 'Aaa', sp: 'AAA', fitch: 'AAA' },
  { issuer_ticker: 'NVDA', moodys: 'Aa3', sp: 'AA-', fitch: 'AA-' },
];

const SAMPLE_DEALS = [
  { company_a: 'COMP:MSFT', company_b: 'COMP:NVDA', deal_type: 'CLOUD_PARTNERSHIP', announced_date: '2024-11-01', value_usd: 1200000000, notes: 'AI infra', bookrunners: 'JPMorgan; Goldman Sachs' },
  { company_a: 'COMP:AAPL', company_b: 'COMP:AMZN', deal_type: 'SUPPLY_AGREEMENT', announced_date: '2025-02-10', value_usd: 500000000, notes: 'logistics', bookrunners: 'BofA Securities' },
];

// ---------------- Theme ----------------
const COLORS = {
  bgFrom: '#eff6ff', bgTo: '#dbeafe',
  card: 'bg-white', border: 'border-blue-100',
  textSubtle: 'text-slate-600', textMuted: 'text-slate-500',
  primary: '#1d4ed8', primaryDark: '#1e40af', primaryLight: '#3b82f6',
  edge: '#2563eb', edgeSoft: '#60a5fa',
};
const TYPE_COLORS = { Company: '#1d4ed8', Bank: '#0284c7', Debt: '#60a5fa', Person: '#38bdf8', Institution: '#93c5fd' };
const EDGE_TYPES = ['MENTION','STRATEGIC_PARTNER','SUPPLIER','GEO_PROXIMITY','NEWS_CO_MENTION','MARKET_ACTIVITY','DEAL','DEBT_SECURITY','CREDIT_RATING','BOOKRUNNER'];

// ---------------- Ratings helpers ----------------
const RATING_ORDER = ['AAA','AA+','AA','AA-','A+','A','A-','BBB+','BBB','BBB-','BB+','BB','BB-','B+','B','B-','CCC+','CCC','CCC-','CC','C','D'];
const MOODYS_TO_SP = { Aaa:'AAA', Aa1:'AA+', Aa2:'AA', Aa3:'AA-', A1:'A+', A2:'A', A3:'A-', Baa1:'BBB+', Baa2:'BBB', Baa3:'BBB-', Ba1:'BB+', Ba2:'BB', Ba3:'BB-', B1:'B+', B2:'B', B3:'B-', Caa1:'CCC+', Caa2:'CCC', Caa3:'CCC-', Ca:'CC', C:'C', D:'D' };
const toUnifiedMark = (m) => { if(!m) return null; const t=String(m).trim(); if(RATING_ORDER.includes(t.toUpperCase())) return t.toUpperCase(); return MOODYS_TO_SP[t] || MOODYS_TO_SP[t.charAt(0).toUpperCase()+t.slice(1)] || null; };
const ratingToScore = (r) => { const i=RATING_ORDER.indexOf(String(r||'').toUpperCase()); return i>=0? i+1 : null; };
const yearsBetween = (a,b)=> (new Date(b).getTime()-new Date(a).getTime())/(365.25*24*3600*1000);
const prettyUSD = (n)=> n==null||isNaN(n)?'—':Math.round(Number(n)).toLocaleString(undefined,{style:'currency',currency:'USD',maximumFractionDigits:0});

// ---------------- Graph logic ----------------
function computeWeightedDegree(nodes, edges){
  const d = Object.fromEntries(nodes.map(n=>[n.id,0]));
  edges.forEach(e=>{ const s=typeof e.source==='string'?e.source:e?.source?.id; const t=typeof e.target==='string'?e.target:e?.target?.id; if(s in d) d[s]=(d[s]||0)+(e.weight||1); if(t in d) d[t]=(d[t]||0)+(e.weight||1); });
  return d;
}
function scaleEdgesByMultipliers(edges, multipliers){
  return edges.map(e=>{ const f=String(e.type).split('|').reduce((a,t)=>a*(multipliers[t]??1),1); return {...e, weight:(e.weight??1)*f}; });
}

function useForceLayout(nodes, edges, w, h){
  const [pos,setPos]=useState({});
  useEffect(()=>{
    const links=edges.map(e=>({...e}));
    const sim=d3.forceSimulation(nodes.map(n=>({...n})))
      .force('link', d3.forceLink(links).id(d=>d.id).distance(l=>120-Math.min((l.weight||1)*8,60)))
      .force('charge', d3.forceManyBody().strength(-220))
      .force('center', d3.forceCenter(w/2,h/2))
      .on('tick',()=>{ const p={}; sim.nodes().forEach(n=>{ p[n.id]={x:n.x,y:n.y}; }); setPos(p); });
    return ()=>sim.stop();
  }, [nodes,edges,w,h]);
  return pos;
}

// ---------------- Small UI helpers ----------------
function FilePicker({ label, onLoad }){
  return (
    <div className='flex items-center gap-2'>
      <label className='text-sm text-slate-600 w-28' title='Upload a CSV file matching the expected columns for this data type.'>{label}</label>
      <input type='file' accept='.csv' className='block text-sm file:mr-2 file:px-2 file:py-1 file:rounded file:border file:border-blue-200 file:text-blue-700 file:bg-blue-50' onChange={e=>{ const f=e.target.files?.[0]; if(!f) return; Papa.parse(f,{header:true,dynamicTyping:true,complete:r=>onLoad(r.data)}); }} />
    </div>
  );
}

function GraphStats({ nodes, edges }){
  const t = useMemo(()=>({ n:nodes.length, e:edges.length, w:edges.reduce((a,x)=>a+(+x.weight||0),0), deals:edges.filter(x=>String(x.type).includes('DEAL')).length }),[nodes,edges]);
  return (
    <div className='mt-2 grid grid-cols-5 gap-2 text-center'>
      {[{label:'Nodes',val:t.n},{label:'Edges',val:t.e},{label:'Total Weight',val:Math.round(t.w)},{label:'Deal Links',val:t.deals},{label:'Banks',val:nodes.filter(n=>n.type==='Bank').length}].map((x,i)=> (
        <div key={i} className={`rounded-xl p-3 border ${COLORS.border}`} title={`${x.label}`}>
          <div className='text-2xl font-bold text-blue-900'>{x.val}</div>
          <div className={`text-xs ${COLORS.textSubtle}`}>{x.label}</div>
        </div>
      ))}
    </div>
  );
}

// ---------------- Data transforms ----------------
function deriveDebtNodesAndEdges(bonds){
  const debtNodes = bonds.map(b=>{ const id=String(b.id||''); const bid=id.startsWith('BOND:')?id:`BOND:${id}`; return { id: bid, label: b.label||id, type:'Debt', face_value:+b.face_value||0, rating:b.rating||null }; });
  const vals = debtNodes.map(d=>d.face_value); const mn=Math.min(...vals,0), mx=Math.max(...vals,1); const scale=v=>0.5+1.5*((v-mn)/(mx-mn||1));
  const debtEdges = bonds.map(b=>{ const id=String(b.id||''); const bid=id.startsWith('BOND:')?id:`BOND:${id}`; return { source:`COMP:${b.issuer_ticker}`, target:bid, type:'DEBT_SECURITY', weight:scale(+b.face_value||0) }; });
  return { debtNodes, debtEdges };
}

function summarizeDebtByIssuer(bonds, ratingsWide){
  const by = {}; const now=new Date();
  bonds.forEach(b=>{ const k=b.issuer_ticker; if(!k) return; const fv=+b.face_value||0; const mat=new Date(b.maturity_date); if(!by[k]) by[k]={total:0,num:0,den:0,nxt:0}; by[k].total+=fv; const y=Math.max(yearsBetween(now,mat),0); by[k].num+=fv*y; by[k].den+=fv; if(yearsBetween(now,mat)<=1.0001) by[k].nxt+=fv; });
  return Object.entries(by).map(([issuer, v])=>{
    const r=ratingsWide.find(x=>(x.issuer_ticker||x.issuer)===issuer)||{};
    const m=toUnifiedMark(r.moodys), s=toUnifiedMark(r.sp), f=toUnifiedMark(r.fitch);
    const scores=[m,s,f].map(x=>x?ratingToScore(x):null).filter(x=>x!=null);
    const avg=scores.length? scores.reduce((a,b)=>a+b,0)/scores.length : null;
    const disp=scores.length? Math.max(...scores)-Math.min(...scores) : null;
    return { issuer, moodys:r.moodys||'—', sp:r.sp||'—', fitch:r.fitch||'—', moodys_u:m||'—', sp_u:s||'—', fitch_u:f||'—', avgScore:avg, dispersion:disp, totalFace:v.total, WAM_years:v.den? v.num/v.den:0, next12m:v.nxt };
  });
}

function deriveDealEdges(deals){
  const vals=deals.map(d=>+d.value_usd||0); const mn=Math.min(...vals,0), mx=Math.max(...vals,1); const scale=v=>0.5+2*((v-mn)/(mx-mn||1));
  return deals.map(d=>({ source:d.company_a, target:d.company_b, type:`DEAL|${(d.deal_type||'GENERIC').toUpperCase()}`, announced_date:d.announced_date, value_usd:+d.value_usd||0, weight:scale(+d.value_usd||0), notes:d.notes||'' }));
}

const normalizeBookrunners = (br)=>!br?[]:Array.isArray(br)?br.map(s=>String(s).trim()).filter(Boolean):String(br).split(/[;,]/).map(s=>s.trim()).filter(Boolean);
function deriveBankNodesAndEdges(deals){
  const bankNodesMap=new Map(); const bankEdges=[]; const vals=deals.map(d=>+d.value_usd||0); const mn=Math.min(...vals,0), mx=Math.max(...vals,1); const scale=v=>0.5+2*((v-mn)/(mx-mn||1));
  deals.forEach(d=>{ const banks=normalizeBookrunners(d.bookrunners); const ends=[d.company_a,d.company_b].filter(Boolean); const w=scale(+d.value_usd||0); banks.forEach(b=>{ const id=`BANK:${b}`; if(!bankNodesMap.has(id)) bankNodesMap.set(id,{id,label:b,type:'Bank'}); ends.forEach(end=>bankEdges.push({source:id,target:end,type:'DEAL|BOOKRUNNER',weight:w})); }); });
  return { bankNodes:[...bankNodesMap.values()], bankEdges };
}

function computeLeagueTable(deals){
  const m=new Map();
  deals.forEach(d=>{ const v=+d.value_usd||0; normalizeBookrunners(d.bookrunners).forEach(b=>{ const cur=m.get(b)||{bank:b,deals:0,total:0}; cur.deals+=1; cur.total+=v; m.set(b,cur); }); });
  return [...m.values()].map(r=>({...r,avg:r.deals? r.total/r.deals:0}));
}

function buildLeagueHTML(rows,title='Bookrunner League Table'){
  const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const tr=rows.map((r,i)=>`<tr><td>${i+1}</td><td>${esc(r.bank)}</td><td>${esc(prettyUSD(r.total))}</td><td>${r.deals}</td><td>${esc(prettyUSD(r.avg))}</td></tr>`).join('');
  return `<!doctype html><meta charset='utf-8'><title>${esc(title)}</title><style>body{font-family:ui-sans-serif;padding:20px}table{border-collapse:collapse;width:100%}th,td{padding:8px;border-bottom:1px solid #eee;text-align:left}</style><h1>${esc(title)}</h1><table><thead><tr><th>Rank</th><th>Bank</th><th>Total Value</th><th>Deals</th><th>Avg Deal</th></tr></thead><tbody>${tr}</tbody></table>`;
}

// ---------------- Canvas pieces ----------------
function Legend(){ return (<div className='px-2 pt-3 pb-1'><div className='inline-flex items-center gap-3 text-xs bg-blue-50 rounded-full px-3 py-1 border border-blue-100'><LegendSwatch color={TYPE_COLORS.Company} label='Company' /><LegendSwatch color={TYPE_COLORS.Debt} label='Debt' /><LegendSwatch color={TYPE_COLORS.Bank} label='Bank' /><span className={` ${COLORS.textMuted}`}>Edge width ∝ weight</span></div></div>); }
function LegendSwatch({color,label}){ return (<span className='inline-flex items-center gap-1'><span className='w-3 h-3 rounded-full' style={{background:color}} /><span>{label}</span></span>); }

function GraphCanvas({ nodes, edges, width, height }){
  const pos = useForceLayout(nodes, edges, width, height);
  const nodeR = (n)=> n.type==='Company'?10 : n.type==='Debt'?6 : n.type==='Bank'?9 : 7;
  const strokeFor = (n)=> n.type==='Company'? '#1e3a8a' : n.type==='Bank'? '#0c4a6e' : '#1e293b';
  return (
    <svg viewBox="0 0 980 520" preserveAspectRatio="xMidYMid meet"  role='img' aria-label='Knowledge graph canvas' className='rounded-xl border border-blue-100' style={{background: 'radial-gradient(1200px 600px at 70% -10%, #e0f2fe 0%, #eff6ff 40%, #ffffff 90%)'}}>
      {edges.map((e,i)=>{ const sId=typeof e.source==='string'?e.source:e?.source?.id; const tId=typeof e.target==='string'?e.target:e?.target?.id; const s=pos[sId], t=pos[tId]; if(!s||!t) return null; const w=Math.max(1,Math.min(8,(e.weight||1))); return (<line key={i} x1={s.x} y1={s.y} x2={t.x} y2={t.y} stroke={COLORS.edge} strokeOpacity={0.4} strokeWidth={w}/>); })}
      {nodes.map(n=>{ const p=pos[n.id]; if(!p) return null; const fill=TYPE_COLORS[n.type]||COLORS.primaryLight; return (<g key={n.id} transform={`translate(${p.x},${p.y})`}><circle r={nodeR(n)} fill={fill} stroke={strokeFor(n)} strokeWidth={1.5}/><text y={-12} textAnchor='middle' className='text-[10px]' style={{fill:'#0f172a'}}>{n.label}</text></g>); })}
    </svg>
  );
}

function DebtRatingsPanel({ bonds, ratings, onLoadBonds, onLoadRatings }){
  const rows = useMemo(()=>summarizeDebtByIssuer(bonds, ratings),[bonds,ratings]);
  const max = Math.max(...rows.map(r=>r.totalFace||r.total||0),1);
  return (
    <div className={`rounded-2xl shadow p-5 ${COLORS.card} border ${COLORS.border}`}>
      <h2 className='text-lg font-semibold text-blue-900' title='Issuer-level rollup: agency ratings, weighted-average maturity, upcoming redemptions, and total outstanding.'>Debt & Ratings</h2>
      <div className='grid grid-cols-1 gap-3 mb-4'>
        <FilePicker label='bonds.csv' onLoad={onLoadBonds} />
        <FilePicker label='ratings.csv' onLoad={onLoadRatings} />
      </div>
      <div className='overflow-x-auto mb-4'>
        <table className='min-w-full text-sm'><thead><tr className='text-left text-blue-800'><th className='py-2 pr-4' title='Issuer ticker or name.'>Issuer</th><th className='py-2 pr-4' title="Latest Moody's rating (as provided).">Moody's</th><th className='py-2 pr-4' title='Latest S&amp;P rating (as provided).'>S&amp;P</th><th className='py-2 pr-4' title='Latest Fitch rating (as provided).'>Fitch</th><th className='py-2 pr-4' title='Average of agency scores (lower is stronger). Sorted ascending.'>Avg ↓</th><th className='py-2 pr-4' title='Spread between highest and lowest agency scores.'>Disp.</th><th className='py-2 pr-4' title='Total outstanding face value across bonds.'>Total</th><th className='py-2 pr-4' title='Weighted-average maturity in years (face-value weighted).'>WAM</th><th className='py-2 pr-4' title='Face value maturing in the next 12 months.'>Next 12m</th><th className='py-2 pr-4' title='Relative bar showing each issuer’s total vs the max.'>Visual</th></tr></thead><tbody>
          {rows.slice().sort((a,b)=>(a.avgScore||999)-(b.avgScore||999)).map(r=> (
            <tr key={r.issuer} className='border-t border-blue-100'>
              <td className='py-2 pr-4 font-medium text-blue-900'>{r.issuer}</td>
              <td className='py-2 pr-4'>{r.moodys} <span className={`text-xs ${COLORS.textMuted}`}>[{r.moodys_u}]</span></td>
              <td className='py-2 pr-4'>{r.sp} <span className={`text-xs ${COLORS.textMuted}`}>[{r.sp_u}]</span></td>
              <td className='py-2 pr-4'>{r.fitch} <span className={`text-xs ${COLORS.textMuted}`}>[{r.fitch_u}]</span></td>
              <td className='py-2 pr-4'>{r.avgScore? r.avgScore.toFixed(2): '—'}</td>
              <td className='py-2 pr-4'>{r.dispersion!=null? r.dispersion.toFixed(1): '—'}</td>
              <td className='py-2 pr-4'>{prettyUSD(r.totalFace||r.total)}</td>
              <td className='py-2 pr-4'>{(r.WAM_years||0).toFixed(2)}</td>
              <td className='py-2 pr-4'>{prettyUSD(r.next12m)}</td>
              <td className='py-2 pr-4'><div className='w-36 h-2 bg-blue-50 rounded'><div className='h-2 rounded' style={{width:`${100*((r.totalFace||r.total)/max)}%`, background:'#60a5fa'}}/></div></td>
            </tr>
          ))}
        </tbody></table>
      </div>
    </div>
  );
}

function LeagueTablePanel({ deals }){
  const [rankBy, setRankBy] = useState('value');
  const [topN, setTopN] = useState(5);
  const table = useMemo(()=>computeLeagueTable(deals),[deals]);
  const sorted = useMemo(()=>{ const a=table.slice(); a.sort((x,y)=> rankBy==='value' ? (y.total-x.total || y.deals-x.deals) : (y.deals-x.deals || y.total-x.total)); return a; },[table,rankBy]);
  const top = sorted.slice(0, topN);
  const total = table.reduce((s,r)=>s+r.total,0);
  const url = useMemo(()=>{ const html=buildLeagueHTML(top); const blob=new Blob([html],{type:'text/html'}); return URL.createObjectURL(blob); },[top]);
  useEffect(()=>()=>{ try{ URL.revokeObjectURL(url); }catch(_){} },[url]);
  return (
    <div className={`rounded-2xl shadow p-5 ${COLORS.card} border ${COLORS.border}`}>
      <div className='flex items-center gap-2'>
        <h2 className='text-lg font-semibold text-blue-900' title='Ranks banks by total deal value or count based on uploaded deals.'>Bookrunner League Table</h2>
        <a href={url} target='_blank' rel='noopener' className='ml-auto text-sm underline text-blue-700' title='Open a lightweight HTML view of the current league table in a new tab.'>Open as link</a>
      </div>
      <div className='flex flex-wrap items-center gap-3 mb-3 text-sm mt-2'>
        <label className='inline-flex items-center gap-2' title='Rank banks by total credited value.'><input type='radio' name='rankBy' checked={rankBy==='value'} onChange={()=>setRankBy('value')} /> <span className='text-blue-900'>By Value</span></label>
        <label className='inline-flex items-center gap-2' title='Rank banks by number of credited deals.'><input type='radio' name='rankBy' checked={rankBy==='count'} onChange={()=>setRankBy('count')} /> <span className='text-blue-900'>By Count</span></label>
        <label className='inline-flex items-center gap-2 ml-4' title='How many top rows to display.'>Top
          <select value={topN} onChange={e=>setTopN(+e.target.value)} className='border border-blue-200 rounded px-2 py-1 text-blue-900'>
            {[5,10,20].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      </div>
      <div className='overflow-x-auto'>
        <table className='min-w-full text-sm'><thead><tr className='text-left text-blue-800'><th className='py-2 pr-4' title='Position after sorting by value or count.'>Rank</th><th className='py-2 pr-4' title='Bookrunner name as parsed from deal data.'>Bank</th><th className='py-2 pr-4' title='Total credited deal value.'>Total</th><th className='py-2 pr-4' title='Number of credited deals.'>Deals</th><th className='py-2 pr-4' title='Average deal value for the bank.'>Avg</th><th className='py-2 pr-4' title='Share of total deal value among the top N.'>Share</th></tr></thead><tbody>
          {top.map((r,i)=> (
            <tr key={r.bank} className='border-t border-blue-100'>
              <td className='py-2 pr-4 font-mono text-blue-900'>{i+1}</td>
              <td className='py-2 pr-4 font-medium text-blue-900'>{r.bank}</td>
              <td className='py-2 pr-4'>{prettyUSD(r.total)}</td>
              <td className='py-2 pr-4'>{r.deals}</td>
              <td className='py-2 pr-4'>{prettyUSD(r.avg)}</td>
              <td className='py-2 pr-4'>{total? ((r.total/total)*100).toFixed(1):'—'}%</td>
            </tr>
          ))}
        </tbody></table>
      </div>
    </div>
  );
}

// ---------------- Alerts + Pulse ----------------
function formatDate(d){ try{ return new Date(d).toISOString().slice(0,19).replace('T',' ');}catch(_){ return String(d);} }
function computeAlerts({ nodes, edges, bonds, ratings, deals }, cfg){
  const C = { redeemNextMonths:12, redeemMinUSD:250_000_000, pulseWeight:3, newsWeight:1.5, dispMin:2, bankSkew:0.33, bankDom:0.5, ...(cfg||{}) };
  const alerts = [];
  const debtRows = summarizeDebtByIssuer(bonds, ratings||[]);
  debtRows.filter(r=> (r.next12m||0) >= C.redeemMinUSD).forEach(r=>{ alerts.push({ type:'Redemption Watch', severity: (r.next12m||0) >= Math.max(1_000_000_000, C.redeemMinUSD*2)? 'high':'med', entity:r.issuer, message:`${r.issuer}: ${prettyUSD(r.next12m)} due in ${C.redeemNextMonths}m` }); });
  const actEdges = edges.filter(e=> String(e.type).includes('MARKET_ACTIVITY'));
  if(actEdges.length){ const by=new Map(); actEdges.forEach(e=>{ const s=typeof e.source==='string'?e.source:e.source.id; const t=typeof e.target==='string'?e.target:e.target.id; [s,t].map(x=>String(x||'').split(':')[1]).forEach(k=>{ if(!k) return; const cur=by.get(k)||{count:0,weight:0}; cur.count+=1; cur.weight+=(e.weight||1); by.set(k,cur); }); }); [...by.entries()].filter(([,stat])=> stat.weight>=C.pulseWeight).sort((a,b)=>b[1].weight-a[1].weight).slice(0,3).forEach(([tick,stat])=>alerts.push({ type:'Market Pulse', severity: stat.weight>=C.pulseWeight*1.5? 'high':'med', entity: tick, message: `${tick}: activity up`})); }
  debtRows.filter(r=> (r.dispersion||0) >= C.dispMin).forEach(r=> alerts.push({ type:'Ratings Dispersion', severity: (r.dispersion||0)>=C.dispMin+1? 'high':'med', entity:r.issuer, message:'Agency disagreement' }));
  edges.filter(e=> String(e.type).includes('NEWS_CO_MENTION') && (e.weight||1) >= C.newsWeight).forEach(e=>{ const s=typeof e.source==='string'?e.source:e.source.id; const t=typeof e.target==='string'?e.target:e.target.id; alerts.push({ type:'Headlines', severity:'low', entity:`${s}↔${t}`, message:'Co-mention' }); });
  const league=computeLeagueTable(deals||[]); if(league.length){ const total=league.reduce((s,r)=>s+r.total,0)||1; const top=league.slice().sort((a,b)=>b.total-a.total)[0]; const share=top.total/total; if(share>=C.bankDom) alerts.push({ type:'Bookrunner Dominance', severity:'high', entity:top.bank, message:`Share ${(share*100).toFixed(1)}%`}); else if(share>=C.bankSkew) alerts.push({ type:'Bookrunner Skew', severity:'med', entity:top.bank, message:`Leads ${(share*100).toFixed(1)}%`}); }
  return alerts.slice(0,10);
}

function Pill({ children, tone='default' }){ const map={ high:'bg-red-50 text-red-700 border-red-200', med:'bg-amber-50 text-amber-700 border-amber-200', low:'bg-blue-50 text-blue-700 border-blue-200', default:'bg-slate-50 text-slate-700 border-slate-200' }; return <span className={`text-xs px-2 py-0.5 rounded-full border ${map[tone]}`}>{children}</span>; }
function Num({ label, value, onChange, step=1, min=0, max=1e12, suffix='' }){ return (<label className='text-sm text-blue-900 flex items-center justify-between gap-2'><span className='whitespace-nowrap'>{label}</span><input type='number' className='w-36 border border-blue-200 rounded px-2 py-1 text-right' value={value} step={step} min={min} max={max} onChange={e=>onChange(+e.target.value)} />{suffix && <span className='text-blue-800 text-xs'>{suffix}</span>}</label>); }
function MarketPulseAlerts({ nodes, edges, bonds, ratings, deals, cfg, onUpdateCfg }){
  const [alerts, setAlerts] = useState([]); const [auto, setAuto] = useState(true); const [ts, setTs] = useState(()=>formatDate(Date.now()));
  const scan = React.useCallback(()=>{ const res=computeAlerts({nodes,edges,bonds,ratings,deals},cfg); setAlerts(res); setTs(formatDate(Date.now())); }, [nodes,edges,bonds,ratings,deals,cfg]);
  useEffect(()=>{ scan(); }, [scan]);
  useEffect(()=>{ if(!auto) return; const ms=Math.max(3000,(cfg?.scanIntervalSec??10)*1000); const id=setInterval(scan,ms); return ()=>clearInterval(id); },[auto,scan,cfg]);
  const C={redeemNextMonths:12,redeemMinUSD:250_000_000,pulseWeight:3,newsWeight:1.5,dispMin:2,bankSkew:0.33,bankDom:0.5,scanIntervalSec:10,...(cfg||{})};
  return (
    <div className={`rounded-2xl shadow p-5 bg-white border ${COLORS.border}`}>
      <div className='flex items-center gap-2'>
        <h2 className='text-lg font-semibold text-blue-900' title='Live alert panel summarising redemptions, market activity, ratings dispersion and headlines.'>Market Pulse — Activity Alerts</h2>
        <span className='ml-2'><Pill tone='low'>demo</Pill></span>
        <div className='ml-auto flex items-center gap-3 text-sm'>
          <label className='inline-flex items-center gap-2 text-blue-900'><input type='checkbox' checked={auto} onChange={e=>setAuto(e.target.checked)} /> Auto-refresh</label>
          <button onClick={scan} className='px-2 py-1 rounded border border-blue-200 text-blue-700 hover:bg-blue-50'>Run scan</button>
        </div>
      </div>
      <div className='mt-1 text-xs text-slate-500'>Last scan: {ts}</div>
      <details className='mt-3'><summary className='cursor-pointer text-sm text-blue-800'>Alert Settings</summary><div className='mt-2 grid grid-cols-1 gap-2'>
        <Num label={<span title='Minimum total face value maturing in the next period to trigger a Redemption Watch alert.'>Redemption min (USD mm)</span>} value={Math.round(C.redeemMinUSD/1_000_000)} step={50} min={0} onChange={v=>onUpdateCfg({...C,redeemMinUSD:(+v)*1_000_000})} suffix='mm' />
        <Num label={<span title='Minimum aggregated activity weight on MARKET_ACTIVITY edges before flagging as Market Pulse.'>Market pulse min weight</span>} value={C.pulseWeight} step={0.1} min={0} onChange={v=>onUpdateCfg({...C,pulseWeight:v})} />
        <Num label={<span title='Minimum weight for NEWS_CO_MENTION edges to surface headline co-mentions.'>News co-mention min weight</span>} value={C.newsWeight} step={0.1} min={0} onChange={v=>onUpdateCfg({...C,newsWeight:v})} />
        <Num label={<span title='How far apart the agencies are on an issuer (higher = more disagreement).'>Ratings dispersion min</span>} value={C.dispMin} step={0.5} min={0} onChange={v=>onUpdateCfg({...C,dispMin:v})} />
        <Num label={<span title='Share of total deal value led by the top bank to flag skewed leadership.'>Bank skew share (%)</span>} value={Math.round(C.bankSkew*100)} step={1} min={0} max={100} suffix='%' onChange={v=>onUpdateCfg({...C,bankSkew:(+v)/100})} />
        <Num label={<span title='Share threshold where one bank is considered dominant in the bookrunner league.'>Bank dominance (%)</span>} value={Math.round(C.bankDom*100)} step={1} min={0} max={100} suffix='%' onChange={v=>onUpdateCfg({...C,bankDom:(+v)/100})} />
        <Num label={<span title='How often the demo re-scans the data to refresh alerts.'>Auto-refresh (sec)</span>} value={C.scanIntervalSec} step={1} min={3} onChange={v=>onUpdateCfg({...C,scanIntervalSec:v})} />
      </div></details>
      <div className='mt-3 space-y-2'>
        {alerts.length===0 && (<div className='text-sm text-slate-600'>No alerts right now.</div>)}
        {alerts.map((a,idx)=>(
          <div key={idx} className='flex items-start gap-3 bg-blue-50/50 border border-blue-100 rounded-xl px-3 py-2'>
            <Pill tone={a.severity==='high'?'high':a.severity==='med'?'med':'low'}>{a.type}</Pill>
            <div className='text-sm'><div className='text-blue-900 font-medium'>{a.entity}</div><div className='text-slate-700'>{a.message}</div></div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- Market Pulse Tab (news-feed style) ----------------
const StarLogo = ({className='w-5 h-5'}) => (<svg viewBox='0 0 24 24' fill='currentColor' className={className}><path d='M12 2l2.9 6.1 6.7.9-4.8 4.6 1.2 6.6L12 17.8 6 20.2l1.2-6.6L2.4 9l6.7-.9L12 2z'/></svg>);
const extractTicker = (id)=>{ if(!id) return null; const s=String(id); const parts=s.split(':'); return parts.length>1? parts[1]: s; };
function buildPulseFeed({edges,bonds,ratings,deals, news=[]}){
  const items=[];
  (deals||[]).forEach(d=>{ items.push({ ts:d.announced_date||new Date().toISOString(), tone:'low', kind:'Deal', text:`Deal: ${extractTicker(d.company_a)} ↔ ${extractTicker(d.company_b)} ${d.deal_type? '('+String(d.deal_type).replace(/_/g,' ')+')':''} ${d.value_usd? '· '+prettyUSD(d.value_usd): ''}` }); });
  (edges||[]).filter(e=> String(e.type).includes('NEWS_CO_MENTION')).forEach(e=>{ const s=extractTicker(typeof e.source==='string'? e.source : e?.source?.id); const t=extractTicker(typeof e.target==='string'? e.target : e?.target?.id); items.push({ ts:new Date().toISOString(), tone:'low', kind:'Headlines', text:`Headlines: ${s} ↔ ${t}` }); });
  const debtRows=summarizeDebtByIssuer(bonds||[], ratings||[]); debtRows.filter(r=> (r.next12m||0) > 0).forEach(r=>{ items.push({ ts:new Date().toISOString(), tone:(r.next12m||0)>=1_000_000_000?'high':'med', kind:'Redemption', text:`Redemption: ${r.issuer} ${prettyUSD(r.next12m)} in next 12m` }); });
  debtRows.filter(r=> (r.dispersion||0) >= 2).forEach(r=>{ items.push({ ts:new Date().toISOString(), tone:'med', kind:'Ratings', text:`Ratings dispersion: ${r.issuer}` }); });
  (news||[]).forEach(n=>{ items.push({ ts:n.ts||new Date().toISOString(), tone:n.tone||'low', kind:'News', text:n.title||'News item', url:n.url, summary:n.summary }); });
  return items.sort((a,b)=> new Date(b.ts) - new Date(a.ts)).slice(0,20);
}
function MarketPulsePanel({ edges, cfg, onUpdateCfg, bonds = SAMPLE_BONDS, ratings = SAMPLE_RATINGS, deals = SAMPLE_DEALS }){
  const [news] = useState([
    { title: 'Alphabet to sell at least $3 billion in U.S. dollar bonds', url: 'https://finance.yahoo.com/news/alphabet-sell-least-3-billion-082528526.html', summary: 'Reported multi-tranche USD offering; use of proceeds: general corporate purposes.', tone: 'med', ts: new Date().toISOString() }
  ]);
  const feed = useMemo(()=> buildPulseFeed({edges, bonds, ratings, deals, news}), [edges, bonds, ratings, deals, news]);
  return (
    <div className={`rounded-2xl shadow p-5 ${COLORS.card} border ${COLORS.border}`}>
      <div className='flex items-center gap-3'><div className='text-blue-900 inline-flex items-center gap-2 font-semibold text-lg' title='News-style feed built from deals, co-mentions and redemption watches.'><StarLogo className='w-5 h-5'/> Market Pulse</div></div>
      <div className='mt-3 space-y-2'>
        {feed.length===0 && (<div className='text-sm text-slate-600'>No pulse items yet.</div>)}
        {feed.map((it,idx)=> (
          <div key={idx} className='flex items-start gap-3 bg-blue-50/50 border border-blue-100 rounded-xl px-3 py-2'>
            <Pill tone={it.tone}>{it.kind}</Pill>
            <div className='text-sm'>
              <div className='text-blue-900'>
                {it.text}
                {it.url && (
                  <a className='ml-2 underline text-blue-700' href={it.url} target='_blank' rel='noopener' title='Open source story'>(source)</a>
                )}
              </div>
              {it.summary && <div className='text-slate-700'>{it.summary}</div>}
              <div className='text-xs text-slate-500'>{formatDate(it.ts)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- Main ----------------
export default function KnowledgeGraphDemo(){
  const [activeTab, setActiveTab] = useState('graph');
  const [nodes, setNodes] = useState(SAMPLE_NODES);
  const [edgesBase, setEdgesBase] = useState(SAMPLE_EDGES);
  const [bonds, setBonds] = useState(SAMPLE_BONDS);
  const [ratings, setRatings] = useState(SAMPLE_RATINGS);
  const [deals, setDeals] = useState(SAMPLE_DEALS);
  const [includePersons, setIncludePersons] = useState(false);
  const [includeBanks, setIncludeBanks] = useState(true);
  const [focusDeals, setFocusDeals] = useState(true);
  const [mult, setMult] = useState({MENTION:1,STRATEGIC_PARTNER:1,SUPPLIER:1,GEO_PROXIMITY:1,NEWS_CO_MENTION:1,MARKET_ACTIVITY:1,DEAL:1.5,DEBT_SECURITY:1,CREDIT_RATING:1,BOOKRUNNER:1.6});
  const [alertCfg, setAlertCfg] = useState({ redeemNextMonths:12, redeemMinUSD:250_000_000, pulseWeight:3, newsWeight:1.5, dispMin:2, bankSkew:0.33, bankDom:0.5, scanIntervalSec:10 });
  const width = 980, height = 520;

  const debtDerived = useMemo(()=>deriveDebtNodesAndEdges(bonds),[bonds]);
  const dealEdges = useMemo(()=>deriveDealEdges(deals),[deals]);
  const bankDerived = useMemo(()=>deriveBankNodesAndEdges(deals),[deals]);

  const combinedNodes = useMemo(()=>{ const ids=new Set(); const list=[...nodes, ...debtDerived.debtNodes, ...bankDerived.bankNodes]; const out=[]; list.forEach(n=>{ if(!ids.has(n.id)) { ids.add(n.id); out.push(n); } }); return out; },[nodes,debtDerived,bankDerived]);
  const combinedEdgesBase = useMemo(()=>[...edgesBase, ...debtDerived.debtEdges, ...dealEdges, ...bankDerived.bankEdges],[edgesBase,debtDerived,dealEdges,bankDerived]);
  const edges = useMemo(()=>scaleEdgesByMultipliers(combinedEdgesBase, mult),[combinedEdgesBase,mult]);

  const filtered = useMemo(()=>{ let fn=combinedNodes, fe=edges; if(!includePersons){ fn=fn.filter(n=>n.type!=='Person'); } if(!includeBanks){ fn=fn.filter(n=>n.type!=='Bank'); } const ok=new Set(fn.map(n=>n.id)); fe=fe.filter(e=> ok.has(typeof e.source==='string'?e.source:e.source.id) && ok.has(typeof e.target==='string'?e.target:e.target.id) && !String(e.type).includes('BOARD_ROLE')); if(focusDeals){ fe=fe.filter(e=>{ const s=String(e.type); return s.includes('DEAL')||s.includes('SUPPLIER')||s.includes('STRATEGIC_PARTNER')||s.includes('BOOKRUNNER'); }); } return {nodes:fn, edges:fe}; },[combinedNodes,edges,includePersons,includeBanks,focusDeals]);

  const degree = useMemo(()=>computeWeightedDegree(filtered.nodes, filtered.edges),[filtered]);
  const topDegree = useMemo(()=>[...filtered.nodes].map(n=>({node:n,score:degree[n.id]||0})).sort((a,b)=>b.score-a.score).slice(0,5),[filtered.nodes,degree]);

  function onNodesLoaded(rows){ const c=rows.filter(r=>r.id&&r.label&&r.type); setNodes(c); }
  function onEdgesLoaded(rows){ const c=rows.filter(r=>r.source&&r.target); c.forEach(r=>r.weight=Number(r.weight||1)); setEdgesBase(c); }
  function onBondsLoaded(rows){ const c=rows.filter(r=>r.id&&r.issuer_ticker&&r.maturity_date); c.forEach(r=>{ r.face_value=+r.face_value||0; r.coupon=+r.coupon||0;}); setBonds(c); }
  function onRatingsLoaded(rows){ if(rows.length && (rows[0].agency||rows[0].Agency)){ const map={}; rows.forEach(r=>{ const issuer=r.issuer_ticker||r.issuer; const agency=String(r.agency||r.Agency).toLowerCase(); const rating=r.rating||r.Rating; if(!issuer) return; map[issuer]=map[issuer]||{issuer_ticker:issuer}; if(agency.includes('mood')) map[issuer].moodys=rating; if(agency.includes('s&p')||agency==='sp'||agency.includes('standard')) map[issuer].sp=rating; if(agency.includes('fitch')) map[issuer].fitch=rating; }); setRatings(Object.values(map)); } else { const cleaned=rows.filter(r=>(r.issuer_ticker||r.issuer)&&(r.moodys||r.sp||r.fitch)); const wide=cleaned.map(r=>({ issuer_ticker:r.issuer_ticker||r.issuer, moodys:r.moodys, sp:r.sp, fitch:r.fitch })); setRatings(wide); } }
  function onDealsLoaded(rows){ const c=rows.filter(r=>r.company_a&&r.company_b); c.forEach(r=>{ r.value_usd=+r.value_usd||0; if(r.bookrunners&&!Array.isArray(r.bookrunners)) r.bookrunners=normalizeBookrunners(r.bookrunners); }); setDeals(c); }

  return (
    <div className='min-h-screen w-full text-slate-900 p-6' style={{background: `linear-gradient(180deg, ${COLORS.bgFrom}, ${COLORS.bgTo})`}}>
      <div className='max-w-7xl mx-auto'>
        <div className='mb-4 flex items-center justify-between'>
          <div className='text-xl font-bold text-blue-900 inline-flex items-center gap-2' title='Interactive knowledge graph: companies, banks, and debt instruments connected by deals and relationships.'>
            <svg aria-hidden='true' viewBox='0 0 24 24' className='w-5 h-5 text-blue-700'><path fill='currentColor' d='M12 2l2.9 6.1 6.7.9-4.8 4.6 1.2 6.6L12 17.8 6 20.2l1.2-6.6L2.4 9l6.7-.9L12 2z'/></svg>
            Market Intelligence Graph
          </div>
          <div className='flex gap-2'>
            <button title='Explore the network: nodes are companies/banks/debt; edges are relationships. Drag to see structure.' onClick={()=>setActiveTab('graph')} className={`px-3 py-2 rounded-full text-sm border ${activeTab==='graph'? 'bg-blue-900 text-white border-blue-900' : 'bg-white text-blue-700 border-blue-200 hover:bg-blue-50'}`}>Graph</button>
            <button title='News-style feed of synthetic alerts: deals, redemptions, co-mentions.' onClick={()=>setActiveTab('market')} className={`px-3 py-2 rounded-full text-sm border inline-flex items-center gap-2 ${activeTab==='market'? 'bg-blue-900 text-white border-blue-900' : 'bg-white text-blue-700 border-blue-200 hover:bg-blue-50'}`}><StarLogo/> Market Pulse</button>
            <button title='Top bookrunners by total value or count. Export as simple HTML link.' onClick={()=>setActiveTab('league')} className={`px-3 py-2 rounded-full text-sm border ${activeTab==='league'? 'bg-blue-900 text-white border-blue-900' : 'bg-white text-blue-700 border-blue-200 hover:bg-blue-50'}`}>League Table</button>
          </div>
        </div>

        <details className='mb-4 rounded-2xl border border-blue-100 bg-white p-4'>
          <summary className='cursor-pointer text-blue-900 font-semibold inline-flex items-center gap-2' title='What this dashboard is, who it serves, and how the graph works.'>
            <svg aria-hidden='true' viewBox='0 0 24 24' className='w-5 h-5 text-blue-700'><circle cx='12' cy='12' r='10' fill='none' stroke='currentColor' strokeWidth='1.5'/><path d='M12 8.5a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8Zm-1.1 3.2h1.8v5.1h-1.8z' fill='currentColor'/></svg>
            <span>About this demo</span>
          </summary>
          <div className='mt-2 text-sm text-slate-700 space-y-2'>
            <p><strong>Who this serves:</strong> Syndicate & DCM bankers, traders, sales, and risk teams who need a compact view of issuer networks, upcoming redemptions, and bookrunner positioning.</p>
            <p><strong>Impact:</strong> Surface actionable moments (redemptions, leadership shifts, co-mentions) quickly; focus coverage and origination; spot cross-sell opportunities across shared partners and banks.</p>
            <p><strong>How the knowledge graph works:</strong> Nodes represent <em>companies</em>, <em>bonds</em>, and <em>banks</em>. Edges represent relationships (deals, supply, co-mentions, bookrunner links). Edge width is a weighted strength. You can rebalance strengths under <em>Relationship Weights</em> and filter the view with the toggles. The <em>Market Pulse</em> tab converts these signals into a simple alert feed.</p>
          </div>
        </details>

        {activeTab==='graph' ? (
          <div className='grid grid-cols-1 lg:grid-cols-3 gap-6'>
            <div className='lg:col-span-1 space-y-6'>
              <MarketPulseAlerts nodes={filtered.nodes} edges={filtered.edges} bonds={bonds} ratings={ratings} deals={deals} cfg={alertCfg} onUpdateCfg={setAlertCfg} />
              <div className={`rounded-2xl shadow p-5 ${COLORS.card} border ${COLORS.border}`}>
                <h2 className='text-lg font-semibold text-blue-900' title='Upload CSVs to replace sample nodes, edges, deals, bonds, and ratings.'>Data</h2>
                <div className='space-y-3'>
                  <FilePicker label='nodes.csv' onLoad={onNodesLoaded} />
                  <FilePicker label='edges.csv' onLoad={onEdgesLoaded} />
                  <FilePicker label='deals.csv' onLoad={onDealsLoaded} />
                </div>
                <div className='mt-4 flex flex-wrap items-center gap-4'>
                  <label className='inline-flex items-center gap-2 text-sm text-blue-900' title='Include natural persons (e.g., executives) if present in your dataset.'><input type='checkbox' checked={includePersons} onChange={e=>setIncludePersons(e.target.checked)} /> Include Person nodes</label>
                  <label className='inline-flex items-center gap-2 text-sm text-blue-900' title='Toggle visibility of bank nodes and their bookrunner links.'><input type='checkbox' checked={includeBanks} onChange={e=>setIncludeBanks(e.target.checked)} /> Include Banks</label>
                  <label className='inline-flex items-center gap-2 text-sm text-blue-900' title='Limit to deal/supplier/partner/bookrunner edges for a cleaner view.'><input type='checkbox' checked={focusDeals} onChange={e=>setFocusDeals(e.target.checked)} /> Focus on deals</label>
                </div>
              </div>
              <div className={`rounded-2xl shadow p-5 ${COLORS.card} border ${COLORS.border}`}>
                <h2 className='text-lg font-semibold text-blue-900' title='Tune how strongly each relationship type contributes to edge weight and layout.'>Relationship Weights</h2>
                <div className='space-y-3'>
                  {EDGE_TYPES.map(t=> (
                    <div key={t} className='flex items-center gap-3' title={`Adjust multiplier for ${t}`}>
                      <div className='w-40 text-sm font-medium text-blue-900'>{t}</div>
                      <input type='range' min={0} max={3} step={0.1} value={mult[t]??1} onChange={e=>setMult(m=>({...m,[t]:+e.target.value}))} className='w-full accent-blue-600'/>
                      <div className='w-12 text-right text-sm tabular-nums text-blue-900'>{(mult[t]??1).toFixed(1)}×</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className={`rounded-2xl shadow p-5 ${COLORS.card} border ${COLORS.border}`}>
                <h2 className='text-lg font-semibold text-blue-900' title='Most connected nodes after weighting; quick way to spot hubs.'>Top by Weighted Degree</h2>
                <div className='mt-3 space-y-2'>
                  {topDegree.map(({node,score})=> (
                    <div key={node.id} className='flex items-center justify-between text-sm bg-blue-50 border border-blue-100 rounded-xl px-3 py-2' title='Node with high weighted connections is influential in this network segment.'>
                      <div className='truncate'>
                        <div className='font-medium text-blue-900'>{node.label}</div>
                        <div className={`${COLORS.textMuted} text-xs`}>{node.type}</div>
                      </div>
                      <div className='font-mono text-blue-900'>{(score||0).toFixed(2)}</div>
                    </div>
                  ))}
                </div>
                <div className='mt-4'><GraphStats nodes={filtered.nodes} edges={filtered.edges} /></div>
              </div>
              <details className={`rounded-2xl shadow p-5 ${COLORS.card} border ${COLORS.border}`}>
                <summary className='cursor-pointer text-lg font-semibold select-none text-blue-900'>Debt &amp; Ratings</summary>
                <div className='mt-3'><DebtRatingsPanel bonds={bonds} ratings={ratings} onLoadBonds={onBondsLoaded} onLoadRatings={onRatingsLoaded} /></div>
              </details>
            </div>
            <div className={`lg:col-span-2 rounded-2xl shadow p-3 ${COLORS.card} border ${COLORS.border}`} title='Graph view: width of edges = relationship strength. Use weights panel to rebalance.'>
              <h2 className='text-lg font-semibold px-2 pt-1 text-blue-900' title='Interactive knowledge graph: companies, banks, and debt instruments connected by deals and relationships.'>Market Intelligence Graph</h2>
              <GraphCanvas nodes={filtered.nodes} edges={filtered.edges} width={width} height={height} />
              <Legend />
            </div>
          </div>
        ) : activeTab==='market' ? (
          <MarketPulsePanel edges={edges} cfg={alertCfg} onUpdateCfg={setAlertCfg} bonds={bonds} ratings={ratings} deals={deals} />
        ) : (
          <LeagueTablePanel deals={deals} />
        )}
      </div>
    </div>
  );
}

// ---------------- Expose helpers for console/tests & ESM export ----------------
function runLightweightTests(){
  const deg = computeWeightedDegree([{id:'A'},{id:'B'}],[{source:'A',target:'B',weight:2}]);
  console.assert(deg.A===2 && deg.B===2, 'computeWeightedDegree failed');

  const lt = computeLeagueTable([
    {value_usd:100, bookrunners:'Bank A; Bank B'},
    {value_usd:200, bookrunners:'Bank A'}
  ]);
  const bankA = lt.find(x=>x.bank==='Bank A');
  console.assert(bankA && bankA.total===300 && bankA.deals===2, 'league aggregation failed');

  const summary = summarizeDebtByIssuer([
    {issuer_ticker:'AAA', face_value:500e6, maturity_date:'2026-01-01'},
    {issuer_ticker:'AAA', face_value:250e6, maturity_date:'2025-06-01'}
  ], [{issuer_ticker:'AAA', moodys:'Aa2', sp:'AA', fitch:'AA-'}]);
  console.assert(Array.isArray(summary) && summary[0] && summary[0].issuer==='AAA', 'summarizeDebtByIssuer failed');
  return 'ok';
}

if (typeof window !== 'undefined') {
  Object.assign(window, { computeWeightedDegree, computeLeagueTable, summarizeDebtByIssuer, deriveDealEdges, deriveBankNodesAndEdges, buildLeagueHTML, runLightweightTests });
}

export { computeWeightedDegree, computeLeagueTable, summarizeDebtByIssuer, deriveDealEdges, deriveBankNodesAndEdges, buildLeagueHTML, runLightweightTests };
