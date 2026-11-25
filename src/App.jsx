import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Barcode,Boxes,ClipboardList,Database,History,Printer,RefreshCcw,Search,PackageCheck,CheckCircle2,AlertTriangle,FileUp,Play,Box,Settings,Keyboard,ShieldCheck} from 'lucide-react';
import {dateState,orderLinesSorted} from './domain.js';

const fmt=n=>new Intl.NumberFormat('es-AR',{maximumFractionDigits:3}).format(Number(n||0));
const displayDate=s=>s?String(s).slice(0,10).split('-').reverse().join('/'):'—';
const timeAR=s=>s?new Date(String(s).replace(' ','T')+'Z').toLocaleTimeString('es-AR',{timeZone:'America/Argentina/Buenos_Aires',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'';
const stampAR=s=>s?new Date(String(s).replace(' ','T')+'Z').toLocaleString('es-AR',{timeZone:'America/Argentina/Buenos_Aires'}):'';
const orderStatus=o=>{
 const rem=o.items.reduce((s,l)=>s+Math.max(0,l.requested-l.prepared),0);
 if(!o.items.length)return 'SIN LÍNEAS';
 if(rem<=0.0001&&o.boxes.some(b=>b.remitted))return 'REMITIDO';
 if(rem<=0.0001)return 'COMPLETO';
 if(o.boxes.some(b=>b.remitted))return 'PARCIAL REMITIDO';
 if(o.items.some(l=>l.prepared>0))return 'EMPEZADO';
 return o.legacyStarted?'EMPEZADO EN EXCEL':dateState(o.dueDate);
};
const modes=['NORMAL','GRANEL','BURLETES','ROLLOS'];
const cols=[['B','CÓDIGO'],['C','DESCRIPCIÓN'],['D','CANT PEDIDA'],['E','CANT PREPARADA'],['F','UBICACIÓN'],['G','BULTO'],['H','PESO'],['I','RECIPIENTE'],['J','STOCK'],['K','PEDIDO'],['L','NUM CLIENTE'],['M','CLIENTE'],['N','N° BULTO'],['O','N° PALLET'],['P','FECHA PEDIDO'],['Q','FECHA'],['R','ENTREGA'],['S','HORA'],['T','HORA PREPARADO']];
function ErrorBanner({message,onClose}){return message?<div className="alert alert-error"><AlertTriangle size={18}/><span>{message}</span><button onClick={onClose} aria-label="Cerrar">✕</button></div>:null;}
function InfoBanner({message,onClose}){return message?<div className="alert alert-ok"><CheckCircle2 size={18}/><span>{message}</span><button onClick={onClose} aria-label="Cerrar">✕</button></div>:null;}
function Editable({value,onSave,number=false,short=false,disabled=false}){
 const [draft,setDraft]=useState(String(value??''));
 useEffect(()=>setDraft(String(value??'')),[value]);
 const apply=()=>{if(String(value??'')!==draft)onSave(number?Number(draft.replace(',','.')):draft)};
 return <input className={`inline-edit ${short?'short':''}`} value={draft} disabled={disabled}
 onChange={e=>setDraft(e.target.value)} onBlur={apply} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();if(e.key==='Escape')setDraft(String(value??''));}}/>;
}
async function printDocument(boxes){
 if(!boxes.length)return;
 const r=await window.pickingAPI.printLabels(boxes);
 if(!r.ok)window.alert(r.error||'No se pudo abrir la impresión.');
}
function Modal({title,onClose,children,wide=false}){
 return <div className="modal-overlay" onMouseDown={e=>{if(e.target===e.currentTarget)onClose()}}><div className={`modal ${wide?'wide':''}`} role="dialog" aria-modal="true"><header className="modal-header"><strong>{title}</strong><button onClick={onClose} title="Cerrar">✕</button></header><div className="modal-content">{children}</div></div></div>;
}
export default function App(){
 const [result,setResult]=useState(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[tab,setTab]=useState('thiago');
 const [config,setConfig]=useState({server:'localhost',port:1433,user:'picking_app',password:'',encrypt:false,trustServerCertificate:true});
 const [name,setName]=useState(''),[barcode,setBarcode]=useState(''),[query,setQuery]=useState(''),[statusFilter,setStatusFilter]=useState('TODOS');
 const [modal,setModal]=useState(''),[selected,setSelected]=useState([]),[focusText,setFocusText]=useState(''),[palletText,setPalletText]=useState(''),[manual,setManual]=useState({line:null,qty:''});
 const [labelSelection,setLabelSelection]=useState([]);
 const [boxLineSelection,setBoxLineSelection]=useState([]);
 const [nextBoxInput,setNextBoxInput]=useState('1');
 const reader=useRef(null),busyRef=useRef(false);
 const state=result?.state,station=state?.station,orders=state?.orders||[],activeKeys=state?.activeKeys||[],current=orders.find(o=>o.key===station?.activeKey);
 const focusReader=()=>window.setTimeout(()=>reader.current?.focus(),80);
 useEffect(()=>setBoxLineSelection([]),[station?.activeKey]);
 const load=async()=>{try{const r=await window.pickingAPI.state();if(!r.ok)throw Error(r.error);setResult(r);setConfig(p=>({...p,...r.config,password:''}));if(r.state?.station)setName(r.state.station.preparador);setError(r.connectionError||'');}catch(e){setError(e.message)}};
 useEffect(()=>{if(window.pickingAPI)load();else setError('Esta aplicación necesita ejecutarse desde Electron.');},[]);
 useEffect(()=>{if(tab==='thiago'&&state)focusReader()},[tab,Boolean(state)]);
 async function dispatch(a,{keepFocus=true}={}){
  if(busyRef.current)return null;busyRef.current=true;setBusy(true);setError('');setNotice('');
  try{const r=await window.pickingAPI.action(a);if(!r.ok)throw Error(r.error);setResult(p=>({...p,state:r.state}));if(r.state?.station)setName(r.state.station.preparador);
   if(r.message)setNotice(r.message);return r;
  }catch(e){setError(e.message||String(e));return null}finally{busyRef.current=false;setBusy(false);if(keepFocus&&tab==='thiago')focusReader()}
 }
 const importFile=async(kind)=>{setBusy(true);setError('');try{const r=await window.pickingAPI.import(kind);if(!r.ok)throw Error(r.error);
 if(r.state)setResult(p=>({...p,state:r.state}));if(r.imported)setNotice(`${r.imported.records} registros importados. ${r.imported.warning||''}`);
 }catch(e){setError(e.message)}finally{setBusy(false)}};
 async function saveConfig(e){e.preventDefault();setBusy(true);setError('');try{const r=await window.pickingAPI.configure(config);if(!r.ok)throw Error(r.error);setResult(r);setConfig(p=>({...p,...r.config,password:''}));setName(r.state?.station?.preparador||'');setNotice('Conexión SQL Server establecida correctamente.');setModal('');}catch(e){setError(e.message)}finally{setBusy(false)}}
 async function focusOrder(key){const r=await dispatch({type:'FOCUS',key});if(r){setModal('');setFocusText('')}}
 function chooseMode(mode){return dispatch({type:'SET_MODE',mode});}
 async function closeAndPrint(){if(!current){setError('No hay pedido activo.');return;}
 if(station?.mode==='GRANEL'){
   const bs=current.boxes.filter(b=>!b.remitted&&b.container==='GRANEL'&&!b.printSent);if(!bs.length)return setError('No hay bultos de granel preparados.');
   printDocument(bs);setNotice(`Se enviaron ${bs.length} etiquetas GRANEL a la vista de impresión.`);return;
 }
 const r=await dispatch({type:'CLOSE_BOX',key:current.key,lineIds:boxLineSelection});if(r?.boxId){setBoxLineSelection([]);const b=r.state.boxes.find(b=>String(b.id)===String(r.boxId));if(b)printDocument([b]);}
 }
 async function remit(){if(!current)return setError('Seleccioná un pedido activo.');
 const pending=current.items.reduce((n,l)=>n+Math.max(0,l.requested-l.prepared),0);
 if(pending>0&&!window.confirm(`El pedido ${current.orderId} tiene ${fmt(pending)} unidades pendientes. ¿Confirmás la remisión PARCIAL de los bultos cerrados?`))return;
 await dispatch({type:'REMIT',key:current.key});
 }
 function scannerInput(value){
 const v=String(value||'').trim();setBarcode('');if(!v)return;
 const cmd=v.toUpperCase().replaceAll(' ','');
 if(['PEDIDO','BUSCAR'].includes(cmd)){setModal('select');setSelected(activeKeys);return;}
 if(cmd==='ACTIVA'){setModal('focus');return;}
 if(cmd==='REMITIR'){void remit();return;}
 if(cmd==='IMPRIMIR'||cmd==='IM%RIMIR'){void closeAndPrint();return;}
 if(['GRANEL','BURLETES','ROLLOS','NORMAL'].includes(cmd)){void chooseMode(cmd);return;}
 if(cmd==='PALLET'){setPalletText(current?.pallet||'');setModal('pallet');return;}
 if(cmd==='ACTUALIZAR'){void importFile('pending');return;}
 if(cmd==='CODIGOMANUAL'){setModal('manual');return;}
 if(cmd==='REIMPRIMEETQ'){setModal('labels');return;}
 if(cmd==='IMPRIMEPALLET'){setModal('palletPrint');return;}
 if(cmd==='IMPRIMEREMITO'){setModal('remitoPrint');return;}
 if(cmd==='TILDE'||cmd==='RESET'){setNotice('Lector preparado. Los movimientos registrados se conservan.');focusReader();return;}
 if(['PUERTA','VERIFICACION'].includes(cmd)){setError(`El comando ${cmd} utiliza otro circuito VBA que aún no está homologado en esta versión. No se registró ningún movimiento.`);return;}
 const pair=v.replaceAll("'",'-');const m=pair.match(/^(\d+)-(\d+)$/);
 if(m){const key=`${Number(m[1])}|${Number(m[2])}`;if(!activeKeys.includes(key))return setError(`El pedido ${pair} no está cargado en esta estación. Usá PEDIDO para incorporarlo.`);void focusOrder(key);return;}
 if(v.length===18||v.length===23){void dispatch({type:'SCAN',barcode:v});return;}
 setError(`Lectura no reconocida: ${v}. Escaneá CLIENTE-PEDIDO o etiqueta de 18/23 caracteres.`);
 }
 const visibleOrders=useMemo(()=>orders.filter(o=>{
  const text=`${o.orderId} ${o.clientId} ${o.clientName} ${o.route}`.toUpperCase();
  const stateName=orderStatus(o);return text.includes(query.trim().toUpperCase())&&(statusFilter==='TODOS'||stateName===statusFilter);
 }).sort((a,b)=>{const p=o=>!o.dueDate?'9999-99-99':o.dueDate;return p(a).localeCompare(p(b))}),[orders,query,statusFilter,state]);
 const selectedOrders=selected.map(k=>orders.find(o=>o.key===k)).filter(Boolean);
 const linesSelected=selectedOrders.reduce((n,o)=>n+o.items.length,0);
 const toggleSelected=(key)=>setSelected(p=>p.includes(key)?p.filter(x=>x!==key):p.length>=3?p:[...p,key]);
 const allRows=useMemo(()=>{
  const activeOrders=orders.filter(o=>activeKeys.includes(o.key));const raw=[];
  for(const o of activeOrders){for(const l of o.items){
   const gr=(state?.scans||[]).filter(s=>Number(s.lineId)===Number(l.id)&&s.mode==='GRANEL'&&!s.remitted&&s.qty>0);
   for(const g of gr){raw.push({order:o,line:l,key:`${l.id}-g${g.id}`,granel:true,req:g.qty,prep:g.qty,scan:g,location:l.location,done:true});}
   const covered=gr.reduce((n,s)=>n+s.qty,0);
   const req=Math.max(0,l.requested-covered),prep=Math.max(0,l.prepared-covered);
   if(req>0||!gr.length)raw.push({order:o,line:l,key:String(l.id),req,prep,location:l.location,done:prep>=req&&req>0,granel:false});
  }}
  return raw.sort((a,b)=>Number(a.done)-Number(b.done)||String(a.location).localeCompare(String(b.location),'es',{numeric:true}));
 },[orders,activeKeys,state?.scans]);
 const activeIdSet=new Set(allRows.map(r=>String(r.line.id)));
 const lastScan=(state?.scans||[]).find(s=>activeIdSet.has(String(s.lineId)));
 const lastRow=allRows.find(r=>String(r.line.id)===String(lastScan?.lineId));
 const lastLocation=lastRow?.location||'—';
 const allBoxes=useMemo(()=>[...(state?.boxes||[])].sort((a,b)=>b.id-a.id),[state]);
 const pendingCount=orders.filter(o=>orderStatus(o)==='VENCIDO'||orderStatus(o)==='HOY').length;
 const pickedToday=(state?.scans||[]).filter(s=>String(s.at||'').slice(0,10)===new Date().toISOString().slice(0,10)).length;

 if(!result?.connected)return <div className="connect-page"><div className="connect-card"><div className="big-icon"><Database size={34}/></div><h1>Pedidos a Preparar</h1>
 <p>Versión Thiago · Base de datos SQL Server</p><ErrorBanner message={error} onClose={()=>setError('')}/><form onSubmit={saveConfig}>
 <label>Servidor SQL Server o IP<input required value={config.server} onChange={e=>setConfig({...config,server:e.target.value})} placeholder="localhost o 192.168.1.20"/></label>
 <div className="fields-two"><label>Puerto TCP<input type="number" min="1" max="65535" value={config.port} onChange={e=>setConfig({...config,port:e.target.value})}/></label><label>Usuario SQL<input required value={config.user} onChange={e=>setConfig({...config,user:e.target.value})}/></label></div>
 <label>Contraseña SQL Server<input type="password" placeholder={config.hasPassword?'Dejar vacío para conservar':'Contraseña del usuario picking_app'} value={config.password||''} onChange={e=>setConfig({...config,password:e.target.value})}/></label>
 <div className="options"><label><input type="checkbox" checked={Boolean(config.encrypt)} onChange={e=>setConfig({...config,encrypt:e.target.checked})}/> Cifrar conexión TLS</label><label><input type="checkbox" checked={Boolean(config.trustServerCertificate)} onChange={e=>setConfig({...config,trustServerCertificate:e.target.checked})}/> Confiar en certificado (solo red interna de prueba)</label></div>
 <button type="submit" className="primary" disabled={busy}><Database size={17}/> {busy?'Conectando...':'Conectar a SQL Server'}</button>
 </form><p className="small-muted">Primero ejecutá <code>sql/01_crear_base.sql</code> y <code>sql/02_usuario_aplicacion.sql</code> en SQL Server Management Studio. Esta aplicación no puede crear una instancia SQL Server por sí misma.</p></div></div>;

 return <div className="shell">
  <header className="topbar"><div className="app-title"><Barcode size={23}/><div><strong>Pedidos a Preparar</strong><small>THIAGO · SQL Server · v0.2</small></div></div>
   <nav className="nav-tabs">{[['thiago','Hoja Thiago',Barcode],['pedidos','Pedidos',ClipboardList],['bultos','Bultos / Etiquetas',Boxes],['historial','Historial',History],['datos','Base / Importar',Database]].map(([id,title,Icon])=><button className={tab===id?'on':''} key={id} onClick={()=>setTab(id)}><Icon size={17}/>{title}</button>)}</nav>
   <div className="connection"><span className="green-dot"/>SQL conectado <span className="station-tag">{station?.id?.slice(0,8)}</span><button className="icon-btn" onClick={load} title="Actualizar datos"><RefreshCcw size={17}/></button></div>
  </header>
  <div className="message-area"><ErrorBanner message={error} onClose={()=>setError('')}/><InfoBanner message={notice} onClose={()=>setNotice('')}/></div>
  {tab==='thiago'&&<div className="thiago-page">
   <div className="legacy-toolbar"><div className="sheet-flag">THIAGO <span>FORMATO DE TRABAJO ORIGINAL</span></div>
    <div className="quick-stats"><span><b>{orders.length}</b> pedidos en base</span><span><b>{activeKeys.length}/3</b> seleccionados</span><span><b>{allRows.length}/45</b> líneas</span><span><b>{pendingCount}</b> urgentes</span></div>
   </div>
   <div className="sheet-commands">
    <div className="sheet-cell code-command"><span className="cell-ref">B1</span><label>TIPO DE PREPARACIÓN</label><strong className={station?.mode==='GRANEL'?'mode-granel':''}>{station?.mode||'NORMAL'}</strong></div>
    <div className="sheet-cell"><span className="cell-ref">D3 · D4</span><label>PREPARADO POR</label><div className="inline-field"><input value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==='Enter'&&dispatch({type:'SET_PREPARADOR',name})}/><button onClick={()=>dispatch({type:'SET_PREPARADOR',name})} title="Guardar preparador">Guardar</button></div></div>
    <div className="sheet-cell"><span className="cell-ref">F6</span><label>ÚLTIMA UBICACIÓN</label><strong>{lastLocation}</strong></div>
    <div className="sheet-cell"><span className="cell-ref">H1 · I1</span><label>PALLET</label><strong>{current?.pallet||'Sin asignar'}</strong></div>
    <div className="sheet-cell"><span className="cell-ref">J1 · K1</span><label>BULTO ACTIVO</label><button className="cell-number" title="Cambiar siguiente bulto" onClick={()=>{setNextBoxInput(String(station?.nextBox||1));setModal('boxNumber')}}>{current?station?.nextBox:'—'}</button></div>
   </div>
   <div className="reader-row">
    <div className="reader-field"><div><span className="cell-ref">D7</span><label>LECTURA DE CÓDIGO / COMANDO</label></div><div className="reader-input"><Barcode size={22}/><input ref={reader} value={barcode} onChange={e=>setBarcode(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();scannerInput(barcode)}}} placeholder="Escaneá una etiqueta, CLIENTE-PEDIDO o escribí un comando y presioná Enter" autoComplete="off" disabled={busy}/><button onClick={()=>scannerInput(barcode)} disabled={busy}>Ingresar</button></div></div>
    <div className="focus-order"><span className="cell-ref">F9 · G9</span><label>PEDIDO ACTIVO</label><button className="active-order" onClick={()=>setModal('focus')}>{current?`${current.clientId}-${current.orderId}`:'Seleccionar pedido'}</button><small>{current?.clientName||'Sin pedido activo'}</small></div>
   </div>
   <div className="action-toolbar"><button className="solid" onClick={()=>{setSelected(activeKeys);setModal('select')}}><ClipboardList size={17}/> PEDIDO</button>
    <button onClick={()=>setModal('focus')}>ACTIVA</button><button onClick={()=>setModal('manual')}>CÓDIGO MANUAL</button>
    <button onClick={closeAndPrint} disabled={!current||busy}><Printer size={16}/> IMPRIMIR</button>
    <button className="danger-action" onClick={remit} disabled={!current||busy}><PackageCheck size={17}/> REMITIR</button>
    <div className="mode-selector">{modes.map(m=><button key={m} className={m===station?.mode?'selected':''} onClick={()=>chooseMode(m)}>{m}</button>)}</div>
   </div>
   <div className="sheet-explainer"><span>Artículos pendientes arriba · completados abajo</span><span>Rojo: stock informado insuficiente · celeste: fila normal</span><span>Marcá la columna A para cerrar solamente ciertas líneas en un bulto</span></div>
   <div className="excel-scroll"><table className="excel-grid"><thead><tr><th className="select-col"><span className="excel-col">A</span>CAJA</th>{cols.map(([c,title])=><th key={c}><span className="excel-col">{c}</span>{title}</th>)}</tr></thead>
    <tbody>{allRows.length?allRows.map(row=>{
     const {line:l,order:o,req,prep,granel,scan}=row;const active=o.key===current?.key;
     const shortage=l.availableStock<Math.max(0,l.requested-l.prepared)&&l.availableStock>=0;
     const movement=(state.scans||[]).find(s=>String(s.lineId)===String(l.id)&&!s.remitted);
     const lastScan=(state.scans||[]).find(s=>String(s.lineId)===String(l.id));
     const boxNo=granel?scan?.boxNo:movement?.boxNo||((l.prepared>0)?station?.nextBox:'');
     const canEdit=active&&!granel;
     return <tr key={row.key} className={`${shortage?'no-stock':''} ${row.done?'completed':''} ${active?'active-row':''} ${granel?'granel-row':''}`}>
      <td className="select-check"><input type="checkbox" title="Incluir en próximo bulto" disabled={!active||granel||l.prepared<=l.boxedQty} checked={boxLineSelection.includes(Number(l.id))} onChange={()=>setBoxLineSelection(p=>p.includes(Number(l.id))?p.filter(x=>x!==Number(l.id)):[...p,Number(l.id)])}/></td>
      <td className="mono sku" title="Doble clic para cantidad manual" onDoubleClick={()=>{setManual({line:{...l,orderKey:o.key},qty:String(l.prepared)});setModal('manual')}}>{l.sku}</td>
      <td title={l.description}>{l.description}{l.warning&&<span className="warning-mark" title={l.warning}> ⚠</span>}</td>
      <td className="num">{fmt(req)}</td><td className="qty-cell">{canEdit?<Editable value={prep} number short onSave={v=>dispatch({type:'SET_LINE',key:o.key,lineId:l.id,field:'prepared',value:v})}/>:fmt(prep)}</td>
      <td>{canEdit?<Editable value={l.location} short onSave={v=>dispatch({type:'SET_LINE',key:o.key,lineId:l.id,field:'location',value:v})}/>:l.location}</td>
      <td className="num">{boxNo||'—'}</td><td className="num">{fmt(prep*l.weight)}</td>
      <td>{canEdit?<select className="inline-edit" value={l.container||'CAJA'} onChange={e=>dispatch({type:'SET_LINE',key:o.key,lineId:l.id,field:'container',value:e.target.value})}>{['CAJA','BOLSA','GRANEL','ROLLO','BURLETES','PALLET','OTRO'].map(m=><option key={m}>{m}</option>)}</select>:(granel?'GRANEL':l.container)}</td>
      <td className="num">{fmt(l.availableStock)}</td><td className="num mono">{o.orderId}</td><td className="num mono">{o.clientId}</td><td title={o.clientName}>{o.clientName}</td><td className="num">{boxNo||station?.nextBox}</td><td className="mono">{o.pallet||'—'}</td>
      <td>{displayDate(o.orderDate)}</td><td>{new Date().toLocaleDateString('es-AR')}</td><td>{displayDate(o.dueDate)}</td><td>{timeAR(scan?.at||lastScan?.at||l.preparedAt)}</td><td>{timeAR(scan?.at||lastScan?.at||l.preparedAt)}</td>
     </tr>}) : <tr><td colSpan={cols.length+1} className="empty-grid">No hay pedidos cargados en esta estación. Utilizá el comando PEDIDO para seleccionarlos.</td></tr>}</tbody>
   </table></div>
   <div className="bottom-status"><span><ShieldCheck size={15}/> Las operaciones se guardan en SQL Server al confirmar cada escaneo</span><span>{busy?'Procesando...':'Lector listo · Enter para confirmar'}</span></div>
  </div>}
  {tab==='pedidos'&&<main className="module-page"><div className="module-header"><div><h2>Pedidos pendientes</h2><p>Seleccioná hasta 3 pedidos, con un total máximo de 45 líneas. Priorización por fecha de entrega.</p></div><div className="right-actions"><button onClick={async()=>{const r=await dispatch({type:'AUTO_ASSIGN'});if(r)setTab('thiago')}}><Play size={16}/> Selección automática</button><button className="solid" onClick={()=>{setSelected(activeKeys);setModal('select')}}>Elegir pedidos</button></div></div>
  <div className="filterbar"><Search size={17}/><input placeholder="Buscar cliente, pedido o ruta" value={query} onChange={e=>setQuery(e.target.value)}/><select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>{['TODOS','VENCIDO','HOY','MAÑANA','POSTERIOR','EMPEZADO','EMPEZADO EN EXCEL','COMPLETO','PARCIAL REMITIDO','REMITIDO'].map(x=><option key={x}>{x}</option>)}</select></div>
  <div className="standard-table"><table><thead><tr><th>Prioridad</th><th>Entrega</th><th>Cliente / Pedido</th><th>Ruta</th><th>Líneas</th><th>Estado</th><th>Asignación</th><th></th></tr></thead><tbody>{visibleOrders.map(o=><tr key={o.key}><td><span className={`status ${dateState(o.dueDate).toLowerCase().replace(' ','-')}`}>{dateState(o.dueDate)}</span></td><td>{displayDate(o.dueDate)}</td><td><b>{o.clientId} - {o.orderId}</b><small>{o.clientName}</small></td><td>{o.route}</td><td>{o.items.length}</td><td>{orderStatus(o)}</td><td>{o.assignedStation?o.assignedStation===station.id?'ESTA ESTACIÓN':'OTRA ESTACIÓN':'Libre'}</td><td><button onClick={()=>{setSelected([...new Set([...activeKeys,o.key])]);setModal('select')}}>Seleccionar</button></td></tr>)}</tbody></table></div>
  </main>}
  {tab==='bultos'&&<main className="module-page"><div className="module-header"><div><h2>Bultos y etiquetas</h2><p>Los cierres quedan registrados por pedido, número, recipiente, peso, fecha y preparador.</p></div><button onClick={()=>setTab('thiago')}>Volver a Thiago</button></div>
   <div className="box-grid">{allBoxes.length?allBoxes.map(b=><article className="box-card" key={b.id}><div className="box-top"><Box size={24}/><span className={`status ${b.remitted?'ok':''}`}>{b.remitted?'REMITIDO':'SIN REMITIR'}</span></div><h3>Bulto {b.number}</h3><b>{b.clientId}-{b.orderId}</b><p>{b.clientName}</p><div className="box-props"><span>{b.container}</span><span>{b.pallet||'Sin pallet'}</span><span>{fmt(b.weight)} kg</span></div><small>Preparó {b.preparador} · {stampAR(b.closedAt)}</small><div className="box-lines">{b.items.map((l,i)=><div key={i}>{l.sku} · {fmt(l.quantity)} u.</div>)}</div><button onClick={()=>printDocument([b])}><Printer size={15}/> {b.remitted?'Reimprimir':'Imprimir etiqueta'}</button></article>):<div className="empty-state">Todavía no se cerraron bultos.</div>}</div>
  </main>}
  {tab==='historial'&&<main className="module-page"><div className="module-header"><div><h2>Historial de movimientos</h2><p>Auditoría persistente: escaneos, preparación manual, cambios, cierres, remisiones e importaciones.</p></div><button onClick={async()=>{const r=await window.pickingAPI.export();if(!r.ok)setError(r.error);else if(r.file)setNotice(`Exportado: ${r.file}`)}}>Exportar picking a CSV</button></div><div className="standard-table"><table><thead><tr><th>Fecha</th><th>Evento</th><th>Preparador</th><th>Detalle</th></tr></thead><tbody>{(state?.audit||[]).map(a=><tr key={a.AuditoriaId}><td>{stampAR(a.Fecha)}</td><td><b>{a.Evento}</b></td><td>{a.Preparador}</td><td>{a.Detalle}</td></tr>)}</tbody></table></div></main>}
  {tab==='datos'&&<main className="module-page"><div className="module-header"><div><h2>SQL Server e importaciones</h2><p>Los Excel aportan información. Las operaciones reales se guardan exclusivamente en la base PedidosAPreparar.</p></div><button onClick={()=>setModal('config')}><Settings size={17}/> Cambiar conexión</button></div>
   <div className="import-grid">{[['clients','Clientes','clientes.xls','Nombre, dirección y transporte'],['stock','Stock','stock.xls','Código, existencia, ubicación y peso'],['pending','Pedidos pendientes','pedido pendiente.xls','Cliente, pedido, artículo, saldo y fechas'],['master','Libro Thiago','Pedidos a Preparar.xlsm','Equivalencias de códigos e indicios de preparación']].map(([kind,label,file,description])=><div className="import-card" key={kind}><FileUp size={26}/><h3>{label}</h3><strong>{file}</strong><p>{description}</p><button onClick={()=>importFile(kind)} disabled={busy}>Importar archivo</button></div>)}</div>
   <div className="database-note"><h3>Base centralizada</h3><p>SQL Server: <b>PedidosAPreparar</b> · Estación: <code>{station.id}</code>. No modifica los archivos Excel originales.</p><p>Importar de nuevo los pendientes NO elimina las preparaciones realizadas. Si el saldo importado es menor al ya preparado sin conciliar, el sistema bloquea esa línea y solicita revisión.</p></div>
   <h3>Últimas importaciones</h3><div className="standard-table"><table><thead><tr><th>Fecha</th><th>Tipo</th><th>Archivo</th><th>Registros</th><th>Observaciones</th></tr></thead><tbody>{state.imports.map((x,i)=><tr key={i}><td>{stampAR(x.Fecha)}</td><td>{x.Tipo}</td><td>{x.Archivo}</td><td>{x.Registros}</td><td>{x.Advertencias}</td></tr>)}</tbody></table></div>
  </main>}
  {modal==='select'&&<Modal title="Cargar pedidos al picking (máx. 3 pedidos / 45 líneas)" onClose={()=>setModal('')} wide><div className="selection-bar"><span>{selected.length}/3 pedidos · {linesSelected}/45 líneas</span><button onClick={()=>setSelected([])}>Limpiar</button></div><div className="filterbar"><Search size={16}/><input value={query} placeholder="Buscar número o cliente" onChange={e=>setQuery(e.target.value)}/></div><div className="selector-list">{visibleOrders.map(o=><label key={o.key} className="selector-item"><input type="checkbox" checked={selected.includes(o.key)} disabled={Boolean(o.assignedStation&&o.assignedStation!==station.id)||(!selected.includes(o.key)&&(selected.length>=3||linesSelected+o.items.length>45))} onChange={()=>toggleSelected(o.key)}/><span><b>{o.clientId}-{o.orderId}</b><small>{o.clientName}</small></span><span>{o.items.length} líneas</span><span>{displayDate(o.dueDate)}</span><span>{o.assignedStation&&o.assignedStation!==station.id?'OTRA ESTACIÓN':orderStatus(o)}</span></label>)}</div><div className="modal-actions"><button onClick={()=>setModal('')}>Cancelar</button><button className="solid" disabled={linesSelected>45||selected.length>3} onClick={async()=>{const r=await dispatch({type:'ASSIGN',keys:selected});if(r){setModal('');setTab('thiago')}}}>Cargar selección</button></div></Modal>}
  {modal==='focus'&&<Modal title="ACTIVA — Seleccionar cliente-pedido (G9)" onClose={()=>setModal('')}><label className="modal-label">Escaneá o escribí CLIENTE-PEDIDO<input autoFocus value={focusText} onChange={e=>setFocusText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){const key=focusText.replaceAll("'",'-').replace('-', '|');void focusOrder(key)}}} placeholder="Ejemplo: 200-11609"/></label><div className="focus-list">{orders.filter(o=>activeKeys.includes(o.key)).map(o=><button key={o.key} onClick={()=>focusOrder(o.key)}><b>{o.clientId}-{o.orderId}</b> {o.clientName}</button>)}</div><div className="modal-actions"><button onClick={()=>setModal('')}>Cancelar</button><button className="solid" onClick={()=>focusOrder(focusText.replaceAll("'",'-').replace('-','|'))}>Activar</button></div></Modal>}
  {modal==='manual'&&<Modal title="CODIGOMANUAL — Preparación manual" onClose={()=>setModal('')}><p>Seleccioná una línea del pedido activo. La modificación queda registrada en la auditoría con el preparador.</p><select className="wide-select" value={manual.line?.id||''} onChange={e=>{const l=current?.items.find(x=>String(x.id)===e.target.value);setManual({line:l?{...l,orderKey:current.key}:null,qty:l?String(l.prepared):''})}}><option value="">Elegí artículo…</option>{current?.items.map(l=><option key={l.id} value={l.id}>{l.sku} · {l.description}</option>)}</select>{manual.line&&<label className="modal-label">Cantidad preparada total (mín. {fmt(manual.line.boxedQty)} / máx. {fmt(manual.line.requested)})<input autoFocus value={manual.qty} inputMode="decimal" onChange={e=>setManual({...manual,qty:e.target.value})}/></label>}<div className="modal-actions"><button onClick={()=>setModal('')}>Cancelar</button><button className="solid" disabled={!manual.line} onClick={async()=>{const r=await dispatch({type:'SET_LINE',key:manual.line.orderKey,lineId:manual.line.id,field:'prepared',value:Number(manual.qty.replace(',','.'))});if(r)setModal('')}}>Guardar cantidad</button></div></Modal>}
  {modal==='boxNumber'&&<Modal title="K1 — Siguiente número de bulto" onClose={()=>setModal('')}><label className="modal-label">Número a utilizar para el siguiente bulto del pedido {current?.orderId}<input autoFocus type="number" min="1" value={nextBoxInput} onChange={e=>setNextBoxInput(e.target.value)} /></label><div className="modal-actions"><button onClick={()=>setModal('')}>Cancelar</button><button className="solid" onClick={async()=>{const r=await dispatch({type:'SET_NEXT_BOX',number:Number(nextBoxInput)});if(r)setModal('')}}>Guardar</button></div></Modal>}
  {modal==='pallet'&&<Modal title="PALLET — Cambiar pallet del pedido activo" onClose={()=>setModal('')}><label className="modal-label">Pallet para pedido {current?.orderId}<input autoFocus value={palletText} onChange={e=>setPalletText(e.target.value)} placeholder="Ejemplo t-00031"/></label><div className="modal-actions"><button onClick={()=>setModal('')}>Cancelar</button><button className="solid" onClick={async()=>{const r=await dispatch({type:'SET_PALLET',key:current?.key,value:palletText});if(r)setModal('')}}>Asignar pallet</button></div></Modal>}
  {modal==='labels'&&<Modal title="REIMPRIMEETQ — Bultos registrados" onClose={()=>setModal('')}><div className="selector-list">{allBoxes.map(b=><label key={b.id} className="selector-item"><input type="checkbox" checked={labelSelection.includes(b.id)} onChange={()=>setLabelSelection(p=>p.includes(b.id)?p.filter(x=>x!==b.id):[...p,b.id])}/><span><b>Bulto {b.number}</b><small>Pedido {b.orderId} · {b.container}</small></span><span>{stampAR(b.closedAt)}</span></label>)}</div><div className="modal-actions"><button onClick={()=>setModal('')}>Cancelar</button><button className="solid" onClick={()=>printDocument(allBoxes.filter(b=>labelSelection.includes(b.id)))}>Imprimir seleccionados</button></div></Modal>}
  {modal==='palletPrint'&&<Modal title="IMPRIMEPALLET" onClose={()=>setModal('')}><p>La etiqueta física de pallet del Excel utiliza otro diseño. Esta versión conserva el número de pallet y los bultos asociados en SQL Server, pero falta homologar el formato de impresora. No se enviará una etiqueta de pallet potencialmente incorrecta.</p><button onClick={()=>setModal('')}>Cerrar</button></Modal>}
  {modal==='remitoPrint'&&<Modal title="IMPRIMEREMITO" onClose={()=>setModal('')}><p>El remito oficial del Excel depende de una rutina y un formato de impresión distintos. En esta versión se registra la remisión en SQL Server, pero la impresión fiscal/comercial requiere validar el diseño y el circuito real antes de activarla.</p><button onClick={()=>setModal('')}>Cerrar</button></Modal>}
  {modal==='config'&&<Modal title="Conexión SQL Server" onClose={()=>setModal('')}><form onSubmit={saveConfig}><label className="modal-label">Servidor<input value={config.server} onChange={e=>setConfig({...config,server:e.target.value})}/></label><label className="modal-label">Puerto<input type="number" value={config.port} onChange={e=>setConfig({...config,port:e.target.value})}/></label><label className="modal-label">Usuario<input value={config.user} onChange={e=>setConfig({...config,user:e.target.value})}/></label><label className="modal-label">Contraseña<input type="password" value={config.password||''} onChange={e=>setConfig({...config,password:e.target.value})} placeholder="Vacío = conservar contraseña guardada"/></label><div className="options"><label><input type="checkbox" checked={Boolean(config.encrypt)} onChange={e=>setConfig({...config,encrypt:e.target.checked})}/> Cifrar TLS</label><label><input type="checkbox" checked={Boolean(config.trustServerCertificate)} onChange={e=>setConfig({...config,trustServerCertificate:e.target.checked})}/> Confiar certificado</label></div><div className="modal-actions"><button type="button" onClick={()=>setModal('')}>Cancelar</button><button className="solid" type="submit">Guardar y conectar</button></div></form></Modal>}
 </div>;
}
