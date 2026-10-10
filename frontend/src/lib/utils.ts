import {clsx,type ClassValue} from 'clsx';
import {twMerge} from 'tailwind-merge';
export const cn=(...inputs:ClassValue[])=>twMerge(clsx(inputs));
export const number=(value:string|number|undefined,decimals=0)=>new Intl.NumberFormat('en-IN',{maximumFractionDigits:decimals}).format(Number(value??0));
export const money=(value:string|number|undefined)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(Number(value??0));
export const date=(value:string)=>new Intl.DateTimeFormat('en-IN',{day:'numeric',month:'short',year:'numeric',timeZone:'Asia/Kolkata'}).format(new Date(value));
export const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export const label=(value:string)=>value.toLowerCase().replaceAll('_',' ').replace(/(^|\s)\S/g,c=>c.toUpperCase());
export function exportCsv(name:string,rows:Record<string,unknown>[]) {if(!rows.length)return;const keys=Object.keys(rows[0]);const escape=(v:unknown)=>`"${String(v??'').replace(/^[=+@-]/,"'$&").replaceAll('"','""')}"`;const csv=[keys.map(escape).join(','),...rows.map(r=>keys.map(k=>escape(r[k])).join(','))].join('\r\n');const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=`${name}.csv`;a.click();URL.revokeObjectURL(url);}
