const XLSX=require('xlsx');
const path=require('node:path');
const txt=v=>String(v??'').trim();
const upper=v=>txt(v).toUpperCase();
const num=v=>{const n=Number(String(v??0).replace(',','.'));return Number.isFinite(n)?n:0};
const id=v=>/^\d+(?:\.0+)?$/.test(txt(v))?String(Number(v)):upper(v);
function date(v){
 if(typeof v==='number'&&v>1)return new Date(Date.UTC(1899,11,30)+Math.floor(v)*86400000).toISOString().slice(0,10);
 const s=txt(v);if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(0,10);
 const m=s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);return m?`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:null;
}
function rows(wb,name){const sh=wb.Sheets[name]||wb.Sheets[wb.SheetNames[0]];if(!sh)throw Error('El Excel no tiene hojas.');return XLSX.utils.sheet_to_json(sh,{defval:'',raw:true,blankrows:false});}
function getCell(s,c){return txt(s?.[c]?.v)}
function detect(file){const n=path.basename(file).toLowerCase();return n.endsWith('.xlsm')?'master':n.includes('stock')?'stock':n.includes('client')?'clients':n.includes('pendient')?'pending':''}
function extract(file,kind){
 const actual=kind||detect(file);if(!['pending','stock','clients','master'].includes(actual))throw Error('Tipo de archivo no válido.');
 const wb=XLSX.readFile(file,{bookVBA:false,cellStyles:false,cellFormula:false,cellHTML:false,cellDates:false});
 if(actual==='clients'){
  const data=rows(wb,'clientes').map(x=>({id:id(x.codigo),name:txt(x.nombre),address:txt(x.direc),city:txt(x.locali),province:txt(x.provincia),route:txt(x.transp)})).filter(x=>x.id);
  return {kind:actual,records:[...new Map(data.map(x=>[x.id,x])).values()]};
 }
 if(actual==='stock'){
  const data=rows(wb,'stock').map(x=>({sku:upper(x.cod),description:txt(x.mat),qty:Math.max(0,num(x.cant)),location:txt(x.ubicacion),weight:Math.max(0,num(x.pesoxuni))})).filter(x=>x.sku);
  return {kind:actual,records:[...new Map(data.map(x=>[x.sku,x])).values()]};
 }
 if(actual==='pending'){
  const groups=new Map();
  for(const r of rows(wb,'pedido pendiente')){
   const clientId=id(r.codigo),orderNo=id(r.fnfact),sku=upper(r.fcod),qty=num(r.pendiente);
   if(!clientId||!orderNo||!sku||qty<=0)continue;
   const k=`${clientId}|${orderNo}`;
   if(!groups.has(k))groups.set(k,{clientId,orderNo,name:txt(r.nombre),orderDate:date(r.ffact),dueDate:date(r.fentre),destination:txt(r.dir_entrega||r.locali),items:new Map()});
   const o=groups.get(k),d=date(r.fentre);
   if(d&&(!o.dueDate||d<o.dueDate))o.dueDate=d;
   const item=o.items.get(sku);
   if(item)item.qty+=qty;
   else o.items.set(sku,{sku,description:txt(r.fdesc),qty,location:txt(r.ubicacion),stock:num(r.exist)});
  }
  const orders=[...groups.values()].map(({items,...o})=>({...o,items:[...items.values()]}));
  return {kind:actual,records:orders};
 }
 const aliases=[],historical=[],usedLabels=[];const t=wb.Sheets.tablas;
 if(!t)throw Error('No se encontró la hoja tablas del libro maestro.');
 const range=XLSX.utils.decode_range(t['!ref']||'A1:J1');
 for(let r=2;r<=range.e.r+1;r++){
   const old=upper(getCell(t,`I${r}`)),updated=upper(getCell(t,`J${r}`));
   if(old&&updated)aliases.push({old,updated});
 }
 // Conservar el número de bulto máximo ya utilizado en Excel, sin recrear
 // bultos de Access que no fueron incluidos en los archivos adjuntos.
 const hist=new Map();
 function addHistoric(clientId,orderNo,lastBox){
  if(!clientId||!orderNo)return;
  const key=`${clientId}|${orderNo}`;
  const prior=hist.get(key)||{clientId,orderNo,lastBox:0};
  const n=Number(lastBox);
  if(Number.isInteger(n)&&n>prior.lastBox&&n<1000000)prior.lastBox=n;
  hist.set(key,prior);
 }
 const h=wb.Sheets.thiago;
 if(h){const z=XLSX.utils.decode_range(h['!ref']||'A1:L1');for(let r=11;r<=z.e.r+1;r++){
   addHistoric(id(getCell(h,`L${r}`)),id(getCell(h,`K${r}`)),getCell(h,`G${r}`));
 }}
 const b=wb.Sheets['base bultos'];if(b){const z=XLSX.utils.decode_range(b['!ref']||'A1:C1');for(let r=2;r<=z.e.r+1;r++){
  addHistoric(id(getCell(b,`A${r}`)),id(getCell(b,`B${r}`)),getCell(b,`C${r}`));
 }}
 historical.push(...hist.values());
 const aliasMap=new Map(aliases.map(a=>[a.old,a.updated]));
 const labels=wb.Sheets.baseetiquetas;
 if(labels){const a=XLSX.utils.decode_range(labels['!ref']||'A1:B1');for(let r=2;r<=a.e.r+1;r++){
  const sku=upper(getCell(labels,`A${r}`)),labelId=Number(getCell(labels,`B${r}`));
  if(sku&&Number.isInteger(labelId)&&labelId>0)usedLabels.push({sku:aliasMap.get(sku)||sku,labelId});
 }}
 return {kind:actual,aliases:[...new Map(aliases.map(a=>[a.old,a])).values()],historical,
  usedLabels:[...new Map(usedLabels.map(x=>[`${x.sku}|${x.labelId}`,x])).values()]};
}
module.exports={extract,detect,date,id};
