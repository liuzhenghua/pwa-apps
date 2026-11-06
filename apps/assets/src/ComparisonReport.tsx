import type { MonthlyReport } from './data';
import { money } from './data';

const signed=(n:number)=>`${n>0?'+':n<0?'−':''}${money(Math.abs(n))}`;
const percent=(n:number,base:number)=>base>0?`${n>0?'+':''}${(n/base*100).toFixed(1)}%`:'—';
export function ComparisonReport({current,baseline,includeProperty}:{current:MonthlyReport;baseline:MonthlyReport;includeProperty:boolean}){
 const details=(r:MonthlyReport)=>(r.details||[]).filter(a=>includeProperty||a.category!=='房产');
 const filtered=(r:MonthlyReport)=>{const property=includeProperty?0:(r.details||[]).filter(a=>a.kind==='asset'&&a.category==='房产').reduce((s,a)=>s+(a.amount||0),0);return {assets:r.assets-property,debts:r.debts,net:r.net-property,liquid:r.liquid}};
 const a=filtered(current),b=filtered(baseline),delta=a.net-b.net,assetDelta=a.assets-b.assets,debtContribution=b.debts-a.debts;
 const ratio=(assets:number,debts:number)=>assets>0?debts/assets*100:null;
 const ratioA=ratio(a.assets,a.debts),ratioB=ratio(b.assets,b.debts);
 const rows=[['净资产',a.net,b.net],['总资产',a.assets,b.assets],['总负债',a.debts,b.debts],['流动资金',a.liquid,b.liquid]] as const;
 const complete=current.missing===0&&baseline.missing===0;
 const prior=new Map(details(baseline).map(x=>[x.accountId,x]));const now=new Map(details(current).map(x=>[x.accountId,x]));
 const movements=[...new Set([...prior.keys(),...now.keys()])].map(id=>{const old=prior.get(id),next=now.get(id);const value=(x:typeof old)=>x?.amount==null?0:x.amount*(x.kind==='debt'?-1:1);return {id,name:next?.name||old!.name,contribution:value(next)-value(old),status:!old?'本期新增记录':!next?'本期退出记录':'余额变化',unknown:old?.amount===null||next?.amount===null}}).filter(x=>x.contribution!==0||x.unknown).sort((x,y)=>Math.abs(y.contribution)-Math.abs(x.contribution));
 return <section className="comparison-report" aria-label="月度财务对比报告">
 <header><span className="comparison-kicker">月度财务对比</span><h3>{baseline.month} <span>→</span> {current.month}</h3><p>{includeProperty?'含房产':'不含房产'} · 两期均采用各自报告保存的余额</p></header>
 {!complete&&<p className="comparison-quality">存在未录入余额，本报告仅展示已记录金额，不作完整增长结论。</p>}
 <div className="comparison-headline"><span>净资产{delta>=0?'增加':'减少'}</span><strong>{signed(delta)}</strong><small>{complete&&b.net>0?`较基期 ${percent(delta,b.net)}`:'基期净资产非正数或数据不完整，不计算增长率'}</small></div>
 <div className="comparison-table-wrap"><table><thead><tr><th>指标</th><th>基期</th><th>本期</th><th>变化</th></tr></thead><tbody>{rows.map(([label,value,base])=><tr key={label}><th>{label}</th><td>{money(base)}</td><td>{money(value)}</td><td>{signed(value-base)}</td></tr>)}<tr><th>负债率</th><td>{ratioB===null?'—':`${ratioB.toFixed(1)}%`}</td><td>{ratioA===null?'—':`${ratioA.toFixed(1)}%`}</td><td>{ratioA===null||ratioB===null?'—':`${ratioA-ratioB>0?'+':''}${(ratioA-ratioB).toFixed(1)} 个百分点`}</td></tr></tbody></table></div>
 <h4>净资产变化来自哪里</h4><div className="comparison-drivers"><div><span>资产{assetDelta>=0?'增加':'减少'}</span><b>{signed(assetDelta)}</b></div><div><span>负债{debtContribution>=0?'减少':'增加'}的贡献</span><b>{signed(debtContribution)}</b></div><p>资产变化 − 负债变化 = 净资产变化。余额变化包含转账、估值和账户增减，不能直接视为收入或投资收益。</p></div>
 {current.details&&baseline.details&&<><h4>账户变化贡献</h4><p className="comparison-note">按对净资产的影响排序，最多展示 5 项。新增、退出记录单独标注，不代表当期真实收支。</p>{movements.length?movements.slice(0,5).map(x=><div className="comparison-account" key={x.id}><span><b>{x.name}</b><small>{x.status}{x.unknown?' · 缺少余额':''}</small></span><strong>{x.unknown?'无法确定':signed(x.contribution)}</strong></div>):<p className="comparison-note">两期账户余额没有变化。</p>}</>}
 <h4>报告数据说明</h4><div className="comparison-quality"><p>基期截至 {baseline.asOf}，本期截至 {current.asOf}。{current.month===todayMonth()?'本月尚未结束，为月内进度对比。':''}</p><p>沿用此前月份余额：基期 {baseline.carried} 个，本期 {current.carried} 个；缺少余额：基期 {baseline.missing} 个，本期 {current.missing} 个。</p><p>盘点：基期{baseline.auditedAt?'已完成':'未完成'}，本期{current.auditedAt?'已完成':'未完成'}。盘点完成不代表所有账户均已核实，请结合跳过账户数查看。</p>{!includeProperty&&(!current.details||!baseline.details)&&<p>部分旧报告缺少账户明细，无法完整剔除房产，请使用含房产口径查看。</p>}</div>
 </section>;
}
const todayMonth=()=>new Date().toLocaleDateString('sv-SE').slice(0,7);
