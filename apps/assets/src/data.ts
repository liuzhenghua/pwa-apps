export type Account={id:string;name:string;kind:'asset'|'debt';category:string;product?:string;liquidity:'liquid'|'locked'|'illiquid';created:string;archived?:boolean;archivedAt?:string};
export const accountTitle=(a:Account)=>`${a.name} · ${a.product||((a.category==='银行存款'&&a.kind==='asset')?(a.liquidity==='liquid'?'活期':a.liquidity==='locked'?'定期':a.category):a.category)}`;
export function liquidAssets(data:Data,date=today()){return data.accounts.filter(a=>!a.archived&&a.kind==='asset'&&a.liquidity==='liquid'&&a.created<=date).reduce((sum,a)=>sum+(latest(data,a.id,date)?.amount||0),0)}
export type Balance={id:string;accountId:string;amount:number;date:string;recordedAt:number;note:string};
export type Audit={id:string;date:string;checked:string[];skipped:string[];changed?:string[];createdAt:number};
export type Data={version:1;updatedAt?:number;accounts:Account[];balances:Balance[];audits:Audit[];reports?:MonthlyReport[]};
export const emptyData=():Data=>({version:1,updatedAt:0,accounts:[],balances:[],audits:[]});
export function dataModifiedAt(data:Data):number{return Math.max(data.updatedAt||0,...data.balances.map(x=>x.recordedAt),...data.audits.map(x=>x.createdAt),...data.accounts.map(x=>new Date(`${x.created}T00:00:00`).getTime()),0)}
export function sameData(a:Data,b:Data):boolean{return JSON.stringify([a.accounts,a.balances,a.audits])===JSON.stringify([b.accounts,b.balances,b.audits])}
export const today=()=>new Date().toLocaleDateString('sv-SE');
export const money=(value:number)=>new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY',maximumFractionDigits:2}).format(value);
export function latest(data:Data,id:string,date=today()){return data.balances.filter(x=>x.accountId===id&&x.date<=date).sort((a,b)=>b.date.localeCompare(a.date)||b.recordedAt-a.recordedAt||b.id.localeCompare(a.id))[0]}
export const accountsAt=(data:Data,date:string)=>data.accounts.filter(x=>x.created<=date&&(!x.archived||!!x.archivedAt&&x.archivedAt>date));
export function totals(data:Data,date=today()){let assets=0,debts=0,missing=0,carried=0;for(const account of accountsAt(data,date)){const record=latest(data,account.id,date);if(!record){missing++;continue}if(record.date<date)carried++;if(account.kind==='asset')assets+=record.amount;else debts+=record.amount}return {assets,debts,net:assets-debts,missing,carried}}
export function validate(raw:unknown):Data{if(!raw||typeof raw!=='object')throw Error('备份格式错误');const d=raw as Data;if(d.version!==1||!Array.isArray(d.accounts)||!Array.isArray(d.balances)||!Array.isArray(d.audits))throw Error('不支持此备份格式');if(d.updatedAt!==undefined&&(!Number.isFinite(d.updatedAt)||d.updatedAt<0))throw Error('修改时间无效');const ids=new Set<string>();for(const a of d.accounts){if(!a||typeof a.id!=='string'||typeof a.name!=='string'||!['asset','debt'].includes(a.kind)||typeof a.category!=='string'||(a.product!==undefined&&typeof a.product!=='string')||!['liquid','locked','illiquid'].includes(a.liquidity)||(a.archivedAt!==undefined&&!/^\d{4}-\d{2}-\d{2}$/.test(a.archivedAt))||!/^\d{4}-\d{2}-\d{2}$/.test(a.created)||ids.has(a.id))throw Error('账户数据无效');ids.add(a.id)}for(const b of d.balances){if(!b||typeof b.id!=='string'||!ids.has(b.accountId)||!Number.isFinite(b.amount)||b.amount<0||!/^\d{4}-\d{2}-\d{2}$/.test(b.date)||typeof b.recordedAt!=='number'||typeof b.note!=='string')throw Error('余额记录无效')}for(const a of d.audits){if(!a||typeof a.id!=='string'||!Array.isArray(a.checked)||!Array.isArray(a.skipped)||typeof a.date!=='string')throw Error('盘点记录无效')}return refreshMonthlyReports(d)}
const DB='pwa-apps-assets';export async function load():Promise<Data>{return new Promise((resolve,reject)=>{const open=indexedDB.open(DB,1);open.onupgradeneeded=()=>open.result.createObjectStore('state');open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result;const tx=db.transaction('state');const req=tx.objectStore('state').get('data');req.onsuccess=()=>{try{resolve(req.result?validate(req.result):emptyData())}catch(e){reject(e)}db.close()};req.onerror=()=>reject(req.error)}})}
export async function save(data:Data):Promise<void>{return new Promise((resolve,reject)=>{const open=indexedDB.open(DB,1);open.onerror=()=>reject(open.error);open.onsuccess=()=>{const db=open.result;const tx=db.transaction('state','readwrite');tx.objectStore('state').put(data,'data');tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>{db.close();reject(tx.error)}}})}

export type MonthlyReport={month:string;asOf:string;assets:number;debts:number;net:number;liquid:number;accounts:number;missing:number;carried:number;checked:number;changed:number;skipped:number;auditedAt?:number};
export function refreshMonthlyReports(data:Data,date=today()):Data{
 const months=[...data.balances.map(b=>b.date.slice(0,7)),...data.audits.map(a=>a.date.slice(0,7))].filter(m=>m<=date.slice(0,7)).sort();
 if(!months.length)return {...data,reports:[]};
 const reports:MonthlyReport[]=[];let month=months[0];
 while(month<=date.slice(0,7)){
  const [year,num]=month.split('-').map(Number);const end=new Date(year,num,0,12).toLocaleDateString('sv-SE');const asOf=end>date?date:end;
  const accounts=accountsAt(data,asOf);const summary=totals(data,asOf);const audit=data.audits.filter(a=>a.date.slice(0,7)===month&&a.date<=asOf).sort((a,b)=>b.createdAt-a.createdAt)[0];
  const checked=accounts.filter(a=>{const b=latest(data,a.id,asOf);return !!b&&!!audit&&audit.checked.includes(a.id)&&b.recordedAt<=audit.createdAt}).length;
  reports.push({month,asOf,assets:summary.assets,debts:summary.debts,net:summary.net,liquid:accounts.filter(a=>a.kind==='asset'&&a.liquidity==='liquid').reduce((sum,a)=>sum+(latest(data,a.id,asOf)?.amount||0),0),accounts:accounts.length,changed:audit?.changed?.filter(id=>accounts.some(a=>a.id===id)).length||0,skipped:audit?.skipped.filter(id=>accounts.some(a=>a.id===id)).length||0,missing:summary.missing,carried:accounts.filter(a=>{const b=latest(data,a.id,asOf);return b&&b.date.slice(0,7)<month}).length,checked,...(audit?{auditedAt:audit.createdAt}:{})});
  month=new Date(year,num,1,12).toLocaleDateString('sv-SE').slice(0,7);
 }
 return {...data,reports};
}
