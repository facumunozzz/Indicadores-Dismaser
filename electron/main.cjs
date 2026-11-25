const {app,BrowserWindow,ipcMain,dialog}=require('electron');
const path=require('node:path');
const fs=require('node:fs');
const config=require('./config.cjs');
const db=require('./repository.cjs');
const {extract}=require('./importers.cjs');
let windowRef, station;
const development=process.argv.includes('--dev');
async function reply(fn){try{return {ok:true,...(await fn())};}catch(e){
 const msg=e.number===2601||e.number===2627?'Registro duplicado (puede que otra estación haya utilizado la etiqueta): '+e.message:e.message||String(e);
 return {ok:false,error:msg};}}
function makeWindow(){
 windowRef=new BrowserWindow({width:1720,height:980,minWidth:1080,minHeight:640,show:false,
  backgroundColor:'#dae4f0',webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true}});
 windowRef.once('ready-to-show',()=>windowRef.show());
 if(development)windowRef.loadURL('http://127.0.0.1:5173');
 else windowRef.loadFile(path.join(__dirname,'..','dist','index.html'));
 windowRef.webContents.setWindowOpenHandler(()=>({action:'deny'}));
}
function csvCell(v){let str=String(v??'');if(/^[\s]*[=+@-]/.test(str))str="'"+str;return `"${str.replaceAll('"','""')}"`;}
app.whenReady().then(async()=>{
 config.initialize(app.getPath('userData'));station=config.station();
 let connectionError='';
 try{await db.connect(config.getConfig());await db.stationIdReady(station);}catch(e){connectionError=e.message;}
 ipcMain.handle('picking:state',()=>reply(async()=>({config:config.publicConfig(),connected:db.connected(),connectionError,
  state:db.connected()?await db.snapshot(station):null})));
 ipcMain.handle('picking:configure',(_e,c)=>reply(async()=>{
  config.saveConfig(c);await db.connect(config.getConfig());await db.stationIdReady(station);connectionError='';
  return {config:config.publicConfig(),connected:true,state:await db.snapshot(station)};
 }));
 ipcMain.handle('picking:action',(_e,a)=>reply(async()=>{
  if(!a||typeof a.type!=='string')throw Error('Operación inválida.');
  const result=await db.action(station,a);return {...result,state:await db.snapshot(station)};
 }));
 ipcMain.handle('picking:import',(_e,kind)=>reply(async()=>{
  const types=['pending','stock','clients','master'];if(!types.includes(kind))throw Error('Tipo de Excel no permitido.');
  const file=await dialog.showOpenDialog(windowRef,{title:'Importar '+kind,filters:[{name:'Excel',extensions:['xls','xlsx','xlsm']}],properties:['openFile']});
  if(file.canceled||!file.filePaths?.[0])return {canceled:true};
  const selected=file.filePaths[0];const payload=extract(selected,kind);
  if(kind==='pending'&&!payload.records.length)throw Error('No se encontraron pedidos pendientes válidos. Importación cancelada.');
  const result=await db.importRecords(payload,selected);
  return {imported:result,state:await db.snapshot(station)};
 }));
 ipcMain.handle('picking:print',(_e,boxes)=>reply(async()=>{
   if(!Array.isArray(boxes)||boxes.length<1||boxes.length>100)throw Error('Elegí entre 1 y 100 etiquetas.');
   const escape=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
   const html=boxes.map(b=>{
    if(!Number.isInteger(Number(b.number))||!Array.isArray(b.items))throw Error('Datos de etiqueta incorrectos.');
    return `<section class="label"><header>PEDIDOS A PREPARAR</header><h1>BULTO ${escape(b.number)}</h1><b>CLIENTE ${escape(b.clientId)} · PEDIDO ${escape(b.orderId)}</b><h2>${escape(b.clientName)}</h2>
    <p>PALLET: ${escape(b.pallet||'SIN ASIGNAR')}</p><p>RECIPIENTE: ${escape(b.container)}</p><p>PESO: ${escape(b.weight)} kg</p><p>PREPARADOR: ${escape(b.preparador)}</p><p>FECHA: ${escape(b.closedAt)}</p>
    <hr>${b.items.slice(0,120).map(x=>`<div class="item">${escape(x.sku)} — ${escape(x.quantity)} unidades<small>${escape(x.description)}</small></div>`).join('')}
    <footer>Formato de prueba: verificar medidas e impresora antes de producir.</footer></section>`;
   }).join('');
   const document=`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><style>
    @page{size:100mm 150mm;margin:3mm}body{font-family:Arial,sans-serif;color:#111;margin:0}.label{break-after:page;padding:3mm;box-sizing:border-box;min-height:136mm;border:1px solid black}.label:last-child{break-after:auto}
    h1{font-size:34px;margin:9px 0}h2{font-size:18px}header{font-size:12px;font-weight:bold}p{margin:6px 0}.item{font-size:12px;border-bottom:1px solid #ddd;padding:4px 0}.item small{display:block;font-size:10px}footer{font-size:9px;margin-top:12px}
    </style></head><body>${html}</body></html>`;
   const printWindow=new BrowserWindow({width:650,height:820,title:'Etiquetas de bultos',autoHideMenuBar:true,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});
   await printWindow.loadURL('data:text/html;charset=utf-8,'+encodeURIComponent(document));
   await db.recordPrinting(station,boxes.map(b=>b.id),'SOLICITADA');
   printWindow.webContents.print({silent:false,printBackground:true},(success,why)=>{
    void db.recordPrinting(station,boxes.map(b=>b.id),success?'ENVIADA_AL_SPOOLER':'CANCELADA',why||'').catch(()=>{});
    if(!success&&why!=='Print job canceled')dialog.showErrorBox('Impresión',why||'Error de impresión');
   });
   return {printRequested:true};
 }));
 ipcMain.handle('picking:export',()=>reply(async()=>{
  const d=await dialog.showSaveDialog(windowRef,{title:'Exportar estado del picking',defaultPath:'estado-picking.csv',filters:[{name:'CSV',extensions:['csv']}]});
  if(d.canceled||!d.filePath)return {canceled:true};
  const rows=await db.listCsv();const cols=['Pedido','Cliente','NombreCliente','Codigo','Descripcion','Pedida','Preparada','Pendiente','Ubicacion','Pallet','MarcaSincronizacion'];
  const csv='\ufeff'+[cols,...rows.map(x=>cols.map(c=>x[c]))].map(x=>x.map(csvCell).join(';')).join('\r\n');
  fs.writeFileSync(d.filePath,csv,'utf8');return {file:d.filePath};
 }));
 makeWindow();
 app.on('activate',()=>{if(BrowserWindow.getAllWindows().length===0)makeWindow();});
}).catch(e=>{dialog.showErrorBox('Pedidos a Preparar',e.message||String(e));app.quit();});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
app.on('before-quit',()=>{void db.shutdown()});
