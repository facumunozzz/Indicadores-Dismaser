const sql=require('mssql');
const {parseLabel,parseClientOrder}=require('./scanner.cjs');
const path=require('node:path');
let pool=null;
function request(tx,params={}){const r=tx?new sql.Request(tx):pool.request();for(const [k,v] of Object.entries(params))r.input(k,v===undefined?null:v);return r;}
async function query(q,params={},tx){return (await request(tx,params).query(q)).recordset||[];}
async function connect(config){
 if(pool){await pool.close().catch(()=>{});pool=null;}
 if(!config.password)throw Error('Configurá una contraseña SQL Server o la variable PICKING_DB_PASSWORD.');
 const p=new sql.ConnectionPool({server:config.server,port:config.port,database:'PedidosAPreparar',user:config.user,password:config.password,
  pool:{max:10,min:0,idleTimeoutMillis:30000},connectionTimeout:10000,requestTimeout:45000,
  options:{encrypt:config.encrypt,trustServerCertificate:config.trustServerCertificate,appName:'PedidosAPrepararElectron'}});
 await p.connect();pool=p;
 await query('SELECT TOP 1 PedidoId FROM dbo.Pedidos');return true;
}
function connected(){return Boolean(pool?.connected);}
async function txDo(fn){if(!connected())throw Error('No hay conexión a SQL Server.');const tx=new sql.Transaction(pool);
 await tx.begin(sql.ISOLATION_LEVEL.SERIALIZABLE);try{const result=await fn(tx);await tx.commit();return result;}catch(e){await tx.rollback().catch(()=>{});throw e;}}
async function stationIdReady(id){
 await query(`IF NOT EXISTS(SELECT 1 FROM dbo.Estaciones WHERE EstacionId=@s)
 INSERT INTO dbo.Estaciones(EstacionId) VALUES(@s)`,{s:id});
}
async function log(tx,station,actor,evt,orderId,detail=''){
 await query('INSERT INTO dbo.Auditoria(EstacionId,Preparador,Evento,PedidoId,Detalle) VALUES(@s,@u,@e,@p,@d)',
  {s:station,u:actor,e:evt,p:orderId||null,d:String(detail).slice(0,1000)},tx);
}
function chunk(arr,n=300){const out=[];for(let i=0;i<arr.length;i+=n)out.push(arr.slice(i,i+n));return out;}
async function bulkJson(tx,q,records){for(const data of chunk(records))await request(tx).input('json',sql.NVarChar(sql.MAX),JSON.stringify(data)).query(q);}
async function importRecords(payload,file){
 const kind=payload.kind;
 return txDo(async tx=>{
 let total=0,warning='';
 if(kind==='clients'){
  await bulkJson(tx,`MERGE dbo.Clientes WITH (HOLDLOCK) AS t USING
  (SELECT * FROM OPENJSON(@json) WITH(id NVARCHAR(30) '$.id',name NVARCHAR(250) '$.name',address NVARCHAR(300) '$.address',city NVARCHAR(120) '$.city',province NVARCHAR(120) '$.province',route NVARCHAR(200) '$.route')) AS s ON t.ClienteId=s.id
  WHEN MATCHED THEN UPDATE SET Nombre=s.name,Direccion=s.address,Localidad=s.city,Provincia=s.province,Transporte=s.route,ActualizadoEn=SYSUTCDATETIME()
  WHEN NOT MATCHED THEN INSERT(ClienteId,Nombre,Direccion,Localidad,Provincia,Transporte) VALUES(s.id,s.name,s.address,s.city,s.province,s.route);`,payload.records);
  total=payload.records.length;
 }else if(kind==='stock'){
  await bulkJson(tx,`MERGE dbo.Articulos WITH (HOLDLOCK) AS t USING
   (SELECT * FROM OPENJSON(@json) WITH(sku NVARCHAR(60) '$.sku',description NVARCHAR(300) '$.description',qty DECIMAL(18,3) '$.qty',location NVARCHAR(100) '$.location',weight DECIMAL(18,5) '$.weight')) s ON t.Codigo=s.sku
   WHEN MATCHED THEN UPDATE SET Descripcion=s.description,StockInformado=s.qty,Ubicacion=s.location,PesoUnitario=s.weight,ActualizadoEn=SYSUTCDATETIME()
   WHEN NOT MATCHED THEN INSERT(Codigo,Descripcion,StockInformado,Ubicacion,PesoUnitario) VALUES(s.sku,s.description,s.qty,s.location,s.weight);`,payload.records);
   await query(`UPDATE l SET Ubicacion=CASE WHEN l.Ubicacion='' THEN a.Ubicacion ELSE l.Ubicacion END,
    PesoUnitario=a.PesoUnitario FROM dbo.PedidoLineas l JOIN dbo.Articulos a ON a.Codigo=l.Codigo`,{},tx);
   total=payload.records.length;
 }else if(kind==='master'){
   await bulkJson(tx,`MERGE dbo.AliasCodigos WITH (HOLDLOCK) t USING
    (SELECT * FROM OPENJSON(@json) WITH(old NVARCHAR(60) '$.old',updated NVARCHAR(60) '$.updated')) s ON t.CodigoAnterior=s.old
    WHEN MATCHED THEN UPDATE SET CodigoNuevo=s.updated
    WHEN NOT MATCHED THEN INSERT(CodigoAnterior,CodigoNuevo) VALUES(s.old,s.updated);`,payload.aliases);
   await bulkJson(tx,`UPDATE p SET EmpezadoExcel=1,
    UltimoBultoExcel=CASE WHEN COALESCE(s.lastBox,0)>p.UltimoBultoExcel THEN s.lastBox ELSE p.UltimoBultoExcel END
    FROM dbo.Pedidos p JOIN OPENJSON(@json) WITH(
     clientId NVARCHAR(30) '$.clientId',orderNo NVARCHAR(30) '$.orderNo',lastBox INT '$.lastBox') s
    ON p.ClienteId=s.clientId AND p.Numero=s.orderNo`,payload.historical);
   await bulkJson(tx,`MERGE dbo.EtiquetasHistoricas WITH(HOLDLOCK) t USING
    (SELECT * FROM OPENJSON(@json) WITH(sku NVARCHAR(60) '$.sku',labelId INT '$.labelId')) s
    ON t.Codigo=s.sku AND t.EtiquetaNumero=s.labelId
    WHEN NOT MATCHED THEN INSERT(Codigo,EtiquetaNumero) VALUES(s.sku,s.labelId);`,payload.usedLabels||[]);
   total=payload.aliases.length+payload.historical.length+(payload.usedLabels||[]).length;
   warning='El histórico del XLSM solo marca pedidos comenzados. No se importan movimientos de Access ni se duplican cantidades.';
 }else if(kind==='pending'){
   const orders=payload.records;
   const lines=orders.flatMap(o=>o.items.map(i=>({clientId:o.clientId,orderNo:o.orderNo,...i})));
   await bulkJson(tx,`MERGE dbo.Pedidos WITH (HOLDLOCK) t USING
    (SELECT * FROM OPENJSON(@json) WITH(clientId NVARCHAR(30) '$.clientId',orderNo NVARCHAR(30) '$.orderNo',name NVARCHAR(250) '$.name',orderDate DATE '$.orderDate',dueDate DATE '$.dueDate',destination NVARCHAR(200) '$.destination')) s
    ON t.ClienteId=s.clientId AND t.Numero=s.orderNo
    WHEN MATCHED THEN UPDATE SET NombreCliente=s.name,FechaPedido=s.orderDate,FechaEntrega=s.dueDate,Ruta=s.destination,Archivado=0,FechaImportacion=SYSUTCDATETIME(),ActualizadoEn=SYSUTCDATETIME()
    WHEN NOT MATCHED THEN INSERT(ClienteId,Numero,NombreCliente,FechaPedido,FechaEntrega,Ruta)
    VALUES(s.clientId,s.orderNo,s.name,s.orderDate,s.dueDate,s.destination);`,orders.map(({items,...o})=>o));
   // Trae saldos externos y concilia únicamente remisiones YA confirmadas en origen.
   await bulkJson(tx,`MERGE dbo.PedidoLineas WITH (HOLDLOCK) t USING
    (SELECT p.PedidoId,x.sku,x.description,x.qty,x.location,COALESCE(a.PesoUnitario,0) peso
    FROM OPENJSON(@json) WITH(clientId NVARCHAR(30) '$.clientId',orderNo NVARCHAR(30) '$.orderNo',sku NVARCHAR(60) '$.sku',description NVARCHAR(300) '$.description',qty DECIMAL(18,3) '$.qty',location NVARCHAR(100) '$.location') x
    JOIN dbo.Pedidos p ON p.ClienteId=x.clientId AND p.Numero=x.orderNo
    LEFT JOIN dbo.Articulos a ON a.Codigo=x.sku) s
    ON t.PedidoId=s.PedidoId AND t.Codigo=s.sku
    WHEN MATCHED THEN UPDATE SET
      CantidadConciliada=t.CantidadConciliada + CASE WHEN t.FuentePendiente>s.qty AND t.CantidadRemitida>t.CantidadConciliada
      THEN CASE WHEN (t.FuentePendiente-s.qty)<(t.CantidadRemitida-t.CantidadConciliada) THEN(t.FuentePendiente-s.qty) ELSE(t.CantidadRemitida-t.CantidadConciliada) END ELSE 0 END,
      FuentePendiente=s.qty,Descripcion=s.description,
      Ubicacion=CASE WHEN t.Ubicacion='' THEN s.location ELSE t.Ubicacion END,
      PesoUnitario=s.peso
    WHEN NOT MATCHED THEN INSERT(PedidoId,Codigo,Descripcion,FuentePendiente,Ubicacion,PesoUnitario)
      VALUES(s.PedidoId,s.sku,s.description,s.qty,s.location,s.peso);`,lines);
   const warns=await query(`UPDATE l SET MarcaSincronizacion=CASE WHEN l.FuentePendiente < (l.CantidadPickeada-l.CantidadConciliada)
    THEN N'CONFLICTO: el saldo importado es menor que el avance sin conciliar' ELSE N'' END
    FROM dbo.PedidoLineas l; SELECT COUNT(1) n FROM dbo.PedidoLineas WHERE MarcaSincronizacion<>''`,{},tx);
   const n=warns[0]?.n||0;if(n)warning=`Hay ${n} líneas con conflicto de sincronización: revisalas antes de seguir pickeando.`;
   total=lines.length;
 }else throw Error('Tipo de importación no reconocido.');
 await query(`INSERT INTO dbo.Importaciones(Tipo,Archivo,Registros,Advertencias) VALUES(@kind,@file,@n,@w)`,
 {kind,file:path.basename(file).slice(0,300),n:total,w:warning},tx);
 await log(tx,null,null,'IMPORTAR '+kind,null,`${total} registros. ${warning}`);
 return {kind,records:total,warning};
 });
}
function value(n){return Number(n||0);}
async function snapshot(station){
 if(!connected())throw Error('No hay conexión con SQL Server.');
 await stationIdReady(station);
 const [st,orders,items,assignments,boxes,scans,history,imports,boxItems,prints]=await Promise.all([
  query('SELECT * FROM dbo.Estaciones WHERE EstacionId=@s',{s:station}),
  query(`SELECT PedidoId,ClienteId,Numero,NombreCliente,CONVERT(VARCHAR(10),FechaPedido,23) FechaPedido,
   CONVERT(VARCHAR(10),FechaEntrega,23) FechaEntrega,Ruta,Categoria,Pallet,EmpezadoExcel,UltimoBultoExcel,Archivado FROM dbo.Pedidos WHERE Archivado=0 ORDER BY FechaEntrega,Numero`),
  query(`SELECT l.LineaId,l.PedidoId,l.Codigo,l.Descripcion,l.FuentePendiente,l.CantidadPickeada,l.CantidadEnBultos,l.CantidadRemitida,l.CantidadConciliada,l.Ubicacion,l.PesoUnitario,l.Recipiente,l.Observacion,l.MarcaSincronizacion,CONVERT(VARCHAR(19),l.FechaPreparado,120) FechaPreparado,COALESCE(a.StockInformado,0) StockInformado
   FROM dbo.PedidoLineas l LEFT JOIN dbo.Articulos a ON a.Codigo=l.Codigo JOIN dbo.Pedidos p ON p.PedidoId=l.PedidoId WHERE p.Archivado=0 ORDER BY l.Ubicacion,l.Codigo`),
  query('SELECT PedidoId,EstacionId FROM dbo.Asignaciones'),
  query(`SELECT TOP 400 b.BultoId,b.PedidoId,b.Numero,b.TipoRecipiente,b.Pallet,b.PesoKg,b.Preparador,CONVERT(VARCHAR(19),b.FechaCierre,120) FechaCierre,b.RemisionId
   FROM dbo.Bultos b ORDER BY b.BultoId DESC`),
  query(`SELECT TOP 2000 m.MovimientoId,m.LineaId,m.Codigo,m.EtiquetaNumero,m.Cantidad,m.Origen,m.Modo,m.BultoId,
   b.Numero BultoNumero,b.RemisionId,CONVERT(VARCHAR(19),m.Fecha,120) Fecha
   FROM dbo.MovimientosPicking m LEFT JOIN dbo.Bultos b ON b.BultoId=m.BultoId ORDER BY m.MovimientoId DESC`),
  query(`SELECT TOP 150 a.AuditoriaId,a.Evento,a.Detalle,a.Preparador,CONVERT(VARCHAR(19),a.Fecha,120) Fecha FROM dbo.Auditoria a ORDER BY a.AuditoriaId DESC`),
  query(`SELECT TOP 30 Tipo,Archivo,Registros,Advertencias,CONVERT(VARCHAR(19),Fecha,120) Fecha FROM dbo.Importaciones ORDER BY ImportacionId DESC`),
  query('SELECT BultoId,LineaId,Cantidad FROM dbo.BultoLineas WHERE BultoId IN (SELECT TOP 400 BultoId FROM dbo.Bultos ORDER BY BultoId DESC)'),
  query("SELECT BultoId,MAX(CASE WHEN Estado='ENVIADA_AL_SPOOLER' THEN 1 ELSE 0 END) Enviada FROM dbo.Impresiones GROUP BY BultoId")
 ]);
 const assignMap=new Map(assignments.map(a=>[String(a.PedidoId),a.EstacionId]));
 const orderMap=new Map();
 const normalized=orders.map(o=>{
 const key=`${o.ClienteId}|${o.Numero}`;
 const obj={id:o.PedidoId,key,orderId:o.Numero,clientId:o.ClienteId,clientName:o.NombreCliente,dueDate:o.FechaEntrega||'',orderDate:o.FechaPedido||'',route:o.Ruta,category:o.Categoria,pallet:o.Pallet,
   legacyStarted:Boolean(o.EmpezadoExcel),legacyLastBox:value(o.UltimoBultoExcel),assignedStation:assignMap.get(String(o.PedidoId))||'',items:[],boxes:[]};
 orderMap.set(String(o.PedidoId),obj);return obj;
 });
 const lineById=new Map();
 for(const r of items){const o=orderMap.get(String(r.PedidoId));if(!o)continue;
  const line={id:r.LineaId,sku:r.Codigo,description:r.Descripcion,requested:value(r.FuentePendiente),prepared:value(r.CantidadPickeada)-value(r.CantidadConciliada),boxedQty:value(r.CantidadEnBultos)-value(r.CantidadConciliada),remittedQty:value(r.CantidadRemitida)-value(r.CantidadConciliada),
    location:r.Ubicacion,weight:value(r.PesoUnitario),availableStock:value(r.StockInformado),container:r.Recipiente,note:r.Observacion,warning:r.MarcaSincronizacion,preparedAt:r.FechaPreparado||''};
  o.items.push(line);lineById.set(String(r.LineaId),o);
 }
 const sentLabels=new Set(prints.filter(p=>p.Enviada).map(p=>String(p.BultoId)));
 const bmap=new Map();for(const b of boxes){const o=orderMap.get(String(b.PedidoId));const row={id:b.BultoId,number:b.Numero,orderId:o?.orderId,orderKey:o?.key,clientName:o?.clientName,clientId:o?.clientId,container:b.TipoRecipiente,pallet:b.Pallet,weight:value(b.PesoKg),preparador:b.Preparador,closedAt:b.FechaCierre,remitted:Boolean(b.RemisionId),printSent:sentLabels.has(String(b.BultoId)),items:[]};bmap.set(String(b.BultoId),row);if(o)o.boxes.push(row);}
 for(const bi of boxItems){const b=bmap.get(String(bi.BultoId)),o=lineById.get(String(bi.LineaId));if(!b||!o)continue;const l=o.items.find(l=>String(l.id)===String(bi.LineaId));if(l)b.items.push({sku:l.sku,description:l.description,quantity:value(bi.Cantidad)});}
 const stationInfo=st[0]||{};
 const focused=orderMap.get(String(stationInfo.PedidoActivoId||''));
 const active=normalized.filter(o=>o.assignedStation===station).map(o=>o.key);
 const current=focused?.assignedStation===station?focused:normalized.find(o=>o.assignedStation===station);
 const next=current?Math.max(1,current.legacyLastBox+1,...current.boxes.map(b=>b.number+1)):1;
 return {station:{id:station,preparador:stationInfo.Preparador||'',mode:stationInfo.Modo||'NORMAL',activeKey:current?.key||'',nextBox:stationInfo.BultoSugerido||next},
   orders:normalized,activeKeys:active,boxes:[...bmap.values()],scans:scans.map(m=>({id:m.MovimientoId,lineId:m.LineaId,sku:m.Codigo,labelId:m.EtiquetaNumero,qty:value(m.Cantidad),mode:m.Modo,boxNo:m.BultoNumero,boxId:m.BultoId,remitted:Boolean(m.RemisionId),at:m.Fecha})),audit:history,imports};
}
async function stationLocked(tx,station){
 const s=(await query('SELECT * FROM dbo.Estaciones WITH(UPDLOCK,HOLDLOCK) WHERE EstacionId=@station',{station},tx))[0];
 if(!s)throw Error('No se encontró esta estación.');
 return s;
}
async function orderLocked(tx,station,key){
 const {clientId,orderNo}=parseClientOrder(String(key||'').replace('|','-'))||{};
 if(!clientId||!orderNo)throw Error('Pedido inválido. Elegí cliente-pedido.');
 const rows=await query(`SELECT p.* FROM dbo.Pedidos p WITH(UPDLOCK,HOLDLOCK)
 JOIN dbo.Asignaciones a ON a.PedidoId=p.PedidoId
 WHERE p.ClienteId=@c AND p.Numero=@n AND a.EstacionId=@s`,{c:clientId,n:orderNo,s:station},tx);
 if(!rows.length)throw Error('El pedido no está asignado a esta estación (o está abierto en otra computadora).');
 return rows[0];
}
async function currentOrderLocked(tx,station,info){
 let id=info.PedidoActivoId;
 if(!id){
  const rows=await query('SELECT PedidoId FROM dbo.Asignaciones WHERE EstacionId=@s',{s:station},tx);
  if(rows.length===1)id=rows[0].PedidoId;
 }
 if(!id)throw Error('Seleccioná un pedido activo en G9 antes de escanear.');
 const o=(await query(`SELECT p.* FROM dbo.Pedidos p WITH(UPDLOCK,HOLDLOCK)
 JOIN dbo.Asignaciones a ON a.PedidoId=p.PedidoId AND a.EstacionId=@s WHERE p.PedidoId=@p`,{s:station,p:id},tx))[0];
 if(!o)throw Error('El pedido activo no está asignado a esta estación.');
 return o;
}
async function nextBox(tx,station,order,info){
 const rows=await query('SELECT COALESCE(MAX(Numero),0)+1 AS n FROM dbo.Bultos WITH(UPDLOCK,HOLDLOCK) WHERE PedidoId=@p',{p:order.PedidoId},tx);
 return Math.max(value(rows[0]?.n),value(order.UltimoBultoExcel)+1,value(info.BultoSugerido));
}
async function closeBoxTx(tx,station,info,order,lineIds=null,movementIds=null){
 const movements=await query(`SELECT m.MovimientoId,m.LineaId,m.Cantidad,l.Codigo,l.Recipiente,l.PesoUnitario
  FROM dbo.MovimientosPicking m WITH (UPDLOCK,HOLDLOCK)
  JOIN dbo.PedidoLineas l ON l.LineaId=m.LineaId
  WHERE l.PedidoId=@p AND m.EstacionId=@s AND m.BultoId IS NULL`,{p:order.PedidoId,s:station},tx);
 const allowedLines=lineIds?new Set(lineIds.map(Number)):null;
 const allowedMoves=movementIds?new Set(movementIds.map(Number)):null;
 const selected=movements.filter(m=>(!allowedLines||allowedLines.has(Number(m.LineaId)))&&(!allowedMoves||allowedMoves.has(Number(m.MovimientoId))));
 if(!selected.length)throw Error('No hay mercadería nueva pendiente de cerrar en bulto.');
 const types=new Set(selected.filter(x=>x.Cantidad>0).map(x=>x.Recipiente));
 if(types.size!==1)throw Error('No se pueden mezclar tipos de recipiente en el mismo bulto. Seleccioná las líneas correspondientes.');
 if(types.has('GRANEL')&&selected.filter(x=>x.Cantidad>0).length>1)throw Error('GRANEL utiliza un bulto por etiqueta.');
 const grouped=new Map();for(const r of selected){const id=Number(r.LineaId);const entry=grouped.get(id)||{id,qty:0,weight:Number(r.PesoUnitario||0)};entry.qty+=Number(r.Cantidad);grouped.set(id,entry);}
 for(const item of grouped.values())if(item.qty<=0)throw Error('Hay líneas con cantidad neta cero o negativa. Corregí las cantidades antes de cerrar.');
 const no=await nextBox(tx,station,order,info);
 const weight=[...grouped.values()].reduce((n,l)=>n+l.qty*l.weight,0);
 const response=await query(`INSERT INTO dbo.Bultos(PedidoId,Numero,TipoRecipiente,Pallet,PesoKg,Preparador,EstacionId)
  OUTPUT INSERTED.BultoId AS id VALUES(@p,@n,@r,@pallet,@w,@prep,@s)`,{
   p:order.PedidoId,n:no,r:[...types][0],pallet:order.Pallet,w:weight,prep:info.Preparador||'SIN IDENTIFICAR',s:station},tx);
 const boxId=response[0].id;
 for(const item of grouped.values()){
  await query(`INSERT INTO dbo.BultoLineas(BultoId,LineaId,Cantidad) VALUES(@b,@l,@q);
  UPDATE dbo.PedidoLineas SET CantidadEnBultos=CantidadEnBultos+@q WHERE LineaId=@l`,
  {b:boxId,l:item.id,q:item.qty},tx);
 }
 const idJSON=JSON.stringify(selected.map(x=>x.MovimientoId));
 await request(tx,{boxId}).input('ids',sql.NVarChar(sql.MAX),idJSON).query(`UPDATE m SET BultoId=@boxId FROM dbo.MovimientosPicking m
   INNER JOIN OPENJSON(@ids) WITH(id BIGINT '$') x ON m.MovimientoId=x.id`);
 await query('UPDATE dbo.Estaciones SET BultoSugerido=@b WHERE EstacionId=@s',{b:no+1,s:station},tx);
 await log(tx,station,info.Preparador,'CERRAR_BULTO',order.PedidoId,`Bulto ${no}, recipiente ${[...types][0]}, ${selected.length} movimiento(s)`);
 return {boxId,boxNumber:no};
}
async function action(station,act){
 if(!act||typeof act.type!=='string')throw Error('Operación no reconocida.');
 return txDo(async tx=>{
 const info=await stationLocked(tx,station),type=act.type;
 if(type==='SET_PREPARADOR'){
  const name=String(act.name||'').trim().slice(0,100);
  if(!name)throw Error('Ingresá el nombre del preparador.');
  await query('UPDATE dbo.Estaciones SET Preparador=@n,ActualizadoEn=SYSUTCDATETIME() WHERE EstacionId=@s',{n:name,s:station},tx);
  await log(tx,station,name,'PREPARADOR',null,name);return {};
 }
 if(type==='SET_MODE'){
  const mode=String(act.mode||'').toUpperCase();if(!['NORMAL','GRANEL','BURLETES','ROLLOS'].includes(mode))throw Error('Modo no implementado.');
  await query('UPDATE dbo.Estaciones SET Modo=@m WHERE EstacionId=@s',{m:mode,s:station},tx);return {};
 }
 if(type==='ASSIGN'||type==='AUTO_ASSIGN'){
  const own=await query(`SELECT a.PedidoId,p.ClienteId,p.Numero FROM dbo.Asignaciones a JOIN dbo.Pedidos p ON p.PedidoId=a.PedidoId WHERE a.EstacionId=@s`,{s:station},tx);
  let chosen=act.keys||[];
  if(type==='AUTO_ASSIGN'){
   chosen=own.map(x=>`${x.ClienteId}|${x.Numero}`);
   const eligible=await query(`SELECT p.PedidoId,p.ClienteId,p.Numero,COUNT(l.LineaId) CantLineas
   FROM dbo.Pedidos p WITH(UPDLOCK,HOLDLOCK)
   JOIN dbo.PedidoLineas l ON l.PedidoId=p.PedidoId
   LEFT JOIN dbo.Asignaciones a ON a.PedidoId=p.PedidoId
   WHERE a.PedidoId IS NULL AND p.Archivado=0 AND p.EmpezadoExcel=0
    AND NOT EXISTS(SELECT 1 FROM dbo.MovimientosPicking m JOIN dbo.PedidoLineas x ON x.LineaId=m.LineaId WHERE x.PedidoId=p.PedidoId)
   GROUP BY p.PedidoId,p.ClienteId,p.Numero,p.FechaEntrega
   ORDER BY CASE WHEN p.FechaEntrega<=DATEADD(DAY,1,CONVERT(date,GETDATE())) THEN 0 WHEN p.FechaEntrega IS NULL THEN 2 ELSE 1 END,p.FechaEntrega,p.Numero`,{},tx);
   const currentCount=own.length;
   const lc=await query(`SELECT COUNT(*) n FROM dbo.PedidoLineas l JOIN dbo.Asignaciones a ON a.PedidoId=l.PedidoId WHERE a.EstacionId=@s`,{s:station},tx);
   let lines=value(lc[0]?.n);
   for(const e of eligible){if(chosen.length>=3)break;if(lines+Number(e.CantLineas)>45)continue;chosen.push(`${e.ClienteId}|${e.Numero}`);lines+=Number(e.CantLineas);}
  }
  chosen=[...new Set(chosen.map(String))];if(chosen.length>3)throw Error('No se pueden preparar más de 3 pedidos a la vez.');
  const found=[];
  for(const key of chosen){
   const parts=parseClientOrder(key.replace('|','-'));
   if(!parts)throw Error(`Pedido inválido: ${key}`);
   const orders=await query(`SELECT p.PedidoId,p.ClienteId,p.Numero,p.Archivado,a.EstacionId AS Dueño,
    (SELECT COUNT(*) FROM dbo.PedidoLineas WHERE PedidoId=p.PedidoId) CantLineas
    FROM dbo.Pedidos p WITH(UPDLOCK,HOLDLOCK) LEFT JOIN dbo.Asignaciones a ON a.PedidoId=p.PedidoId
    WHERE p.ClienteId=@c AND p.Numero=@n`,{c:parts.clientId,n:parts.orderNo},tx);
   if(!orders.length)throw Error(`Pedido ${key} no encontrado.`);
   if(orders[0].Archivado)throw Error(`Pedido ${key} archivado.`);
   if(orders[0].Dueño&&orders[0].Dueño!==station)throw Error(`Pedido ${key} ocupado por otra estación.`);
   found.push(orders[0]);
  }
  if(found.reduce((n,o)=>n+Number(o.CantLineas),0)>45)throw Error('La selección supera 45 líneas de picking.');
  const ids=new Set(found.map(x=>String(x.PedidoId)));
  for(const prior of own)if(!ids.has(String(prior.PedidoId))){
   const open=(await query(`SELECT COUNT(*) n FROM dbo.MovimientosPicking m JOIN dbo.PedidoLineas l ON l.LineaId=m.LineaId
   WHERE l.PedidoId=@p AND m.BultoId IS NULL`,{p:prior.PedidoId},tx))[0]?.n;
   if(open)throw Error(`No podés quitar el pedido ${prior.Numero} con escaneos sin cerrar en bulto.`);
   await query('DELETE FROM dbo.Asignaciones WHERE PedidoId=@p',{p:prior.PedidoId},tx);
  }
  for(const o of found)if(!o.Dueño)await query('INSERT INTO dbo.Asignaciones(PedidoId,EstacionId) VALUES(@p,@s)',{p:o.PedidoId,s:station},tx);
  const focused=found.find(o=>String(o.PedidoId)===String(info.PedidoActivoId))||found[0];
  await query('UPDATE dbo.Estaciones SET PedidoActivoId=@p,BultoSugerido=NULL WHERE EstacionId=@s',{p:focused?.PedidoId||null,s:station},tx);
  await log(tx,station,info.Preparador,type,null,chosen.join(', '));return {selected:chosen};
 }
 if(type==='FOCUS'){
  const order=await orderLocked(tx,station,act.key);
  await query('UPDATE dbo.Estaciones SET PedidoActivoId=@p,BultoSugerido=NULL WHERE EstacionId=@s',{p:order.PedidoId,s:station},tx);return {};
 }
 const order=act.key?await orderLocked(tx,station,act.key):await currentOrderLocked(tx,station,info);
 if(type==='SET_PALLET'||type==='SET_CATEGORY'){
  const v=String(act.value||'').trim().toUpperCase().slice(0,type==='SET_PALLET'?60:50);
  await query(type==='SET_PALLET'?'UPDATE dbo.Pedidos SET Pallet=@v WHERE PedidoId=@p':'UPDATE dbo.Pedidos SET Categoria=@v WHERE PedidoId=@p',{v,p:order.PedidoId},tx);
  await log(tx,station,info.Preparador,type,order.PedidoId,v);return {};
 }
 if(type==='SET_NEXT_BOX'){
  const n=Number(act.number);if(!Number.isInteger(n)||n<1||n>999999)throw Error('Número de bulto inválido.');
  const used=await query('SELECT COALESCE(MAX(Numero),0) ultimo FROM dbo.Bultos WHERE PedidoId=@p',{p:order.PedidoId},tx);
  const ultimo=Math.max(Number(used[0]?.ultimo),value(order.UltimoBultoExcel));
  if(n<=ultimo)throw Error(`Ya existen bultos registrados hasta el ${ultimo}. Elegí uno mayor.`);
  await query('UPDATE dbo.Estaciones SET BultoSugerido=@n WHERE EstacionId=@s',{n,s:station},tx);return {};
 }
 if(type==='SET_LINE'){
  const lineId=Number(act.lineId);
  const l=(await query('SELECT * FROM dbo.PedidoLineas WITH(UPDLOCK,HOLDLOCK) WHERE LineaId=@id AND PedidoId=@p',{id:lineId,p:order.PedidoId},tx))[0];
  if(!l)throw Error('Artículo no encontrado en el pedido activo.');
  const f=String(act.field||''),v=String(act.value??'').trim();
  if(f==='location'||f==='note'||f==='container'){
   if(f==='container'&&!['CAJA','BOLSA','GRANEL','PALLET','ROLLO','BURLETES','OTRO'].includes(v.toUpperCase()))throw Error('Recipiente inválido.');
   const q={location:'UPDATE dbo.PedidoLineas SET Ubicacion=@v WHERE LineaId=@id',note:'UPDATE dbo.PedidoLineas SET Observacion=@v WHERE LineaId=@id',container:'UPDATE dbo.PedidoLineas SET Recipiente=@v WHERE LineaId=@id'}[f];
   await query(q,{v:v.slice(0,f==='note'?500:100).toUpperCase(),id:lineId},tx);return {};
  }
  if(f!=='prepared')throw Error('Campo no editable.');
  const newQty=Number(String(act.value).replace(',','.'));
  const current=value(l.CantidadPickeada)-value(l.CantidadConciliada);
  const min=value(l.CantidadEnBultos)-value(l.CantidadConciliada);
  if(!Number.isFinite(newQty)||newQty<min-0.0001||newQty>value(l.FuentePendiente)+0.0001)throw Error(`Cantidad entre ${min} y ${l.FuentePendiente}. No se pueden retirar unidades ya cerradas.`);
  if(l.MarcaSincronizacion)throw Error(l.MarcaSincronizacion);
  const delta=Number((newQty-current).toFixed(3));if(!delta)return {};
  await query(`UPDATE dbo.PedidoLineas SET CantidadPickeada=CantidadPickeada+@q,FechaPreparado=SYSUTCDATETIME() WHERE LineaId=@l;
   INSERT INTO dbo.MovimientosPicking(LineaId,Codigo,Cantidad,Origen,Modo,EstacionId,Preparador) VALUES(@l,@c,@q,'MANUAL',@m,@s,@u)`,
   {l:lineId,c:l.Codigo,q:delta,m:info.Modo,s:station,u:info.Preparador||'SIN IDENTIFICAR'},tx);
  await log(tx,station,info.Preparador,'CANTIDAD_MANUAL',order.PedidoId,`${l.Codigo}: ${current} -> ${newQty}`);
  return {};
 }
 if(type==='SCAN'){
  if(!info.Preparador?.trim())throw Error('Indicá Preparado por antes de utilizar el lector.');
  const scan=parseLabel(act.barcode);
  const aliases=await query('SELECT CodigoNuevo FROM dbo.AliasCodigos WHERE CodigoAnterior=@c',{c:scan.sku},tx);
  const sku=aliases[0]?.CodigoNuevo||scan.sku;
  const l=(await query(`SELECT * FROM dbo.PedidoLineas WITH(UPDLOCK,HOLDLOCK) WHERE PedidoId=@p AND Codigo=@c`,{p:order.PedidoId,c:sku},tx))[0];
  if(!l)throw Error(`El artículo ${sku} no está en el pedido activo ${order.Numero}.`);
  if(l.MarcaSincronizacion)throw Error(l.MarcaSincronizacion);
  const remaining=value(l.FuentePendiente)-(value(l.CantidadPickeada)-value(l.CantidadConciliada));
  if(scan.qty>remaining+0.00001)throw Error(`La etiqueta trae ${scan.qty}, pero al artículo ${sku} le quedan ${remaining}.`);
  const duplicate=await query(`SELECT 1 AS Duplicada WHERE
   EXISTS(SELECT 1 FROM dbo.MovimientosPicking WITH (UPDLOCK,HOLDLOCK)
     WHERE Codigo=@c AND EtiquetaNumero=@id)
   OR EXISTS(SELECT 1 FROM dbo.EtiquetasHistoricas WITH (UPDLOCK,HOLDLOCK)
     WHERE Codigo=@c AND EtiquetaNumero=@id)`,{c:sku,id:scan.labelId},tx);
  if(duplicate.length)throw Error(`La etiqueta ${scan.labelId} de ${sku} ya fue utilizada. No se puede duplicar el picking.`);
  const m=info.Modo==='GRANEL'?'GRANEL':info.Modo;
  const inserted=await query(`INSERT INTO dbo.MovimientosPicking(LineaId,Codigo,EtiquetaNumero,EtiquetaCruda,Cantidad,Origen,Modo,EstacionId,Preparador)
   OUTPUT INSERTED.MovimientoId AS id VALUES(@l,@c,@id,@raw,@q,'ESCANER',@m,@s,@u);
   UPDATE dbo.PedidoLineas SET CantidadPickeada=CantidadPickeada+@q,FechaPreparado=SYSUTCDATETIME() WHERE LineaId=@l`,
  {l:l.LineaId,c:sku,id:scan.labelId,raw:scan.raw,q:scan.qty,m,s:station,u:info.Preparador},tx);
  await log(tx,station,info.Preparador,'ESCANEO',order.PedidoId,`${sku} +${scan.qty}, etiqueta ${scan.labelId}`);
  if(m==='GRANEL'){
   await query('UPDATE dbo.PedidoLineas SET Recipiente=N\'GRANEL\' WHERE LineaId=@l',{l:l.LineaId},tx);
   const b=await closeBoxTx(tx,station,{...info,Modo:'GRANEL'},order,null,[inserted[0].id]);
   return {message:`GRANEL: etiqueta ${scan.labelId}, bulto ${b.boxNumber}`,boxId:b.boxId};
  }
  return {message:`${sku}: +${scan.qty} unidades registradas`};
 }
 if(type==='CLOSE_BOX'){
  if(!info.Preparador?.trim())throw Error('Indicá Preparado por.');
  const b=await closeBoxTx(tx,station,info,order,act.lineIds?.length?act.lineIds:null);
  return {message:`Bulto ${b.boxNumber} cerrado correctamente`,boxId:b.boxId};
 }
 if(type==='REMIT'){
  if(!info.Preparador?.trim())throw Error('Indicá Preparado por.');
  const open=await query(`SELECT m.MovimientoId FROM dbo.MovimientosPicking m
   JOIN dbo.PedidoLineas l ON l.LineaId=m.LineaId WHERE l.PedidoId=@p AND m.BultoId IS NULL`,{p:order.PedidoId},tx);
  if(open.length)throw Error('Hay escaneos o correcciones sin cerrar en bulto. Usá IMPRIMIR / Cerrar bulto.');
  const boxes=await query(`SELECT BultoId FROM dbo.Bultos WITH(UPDLOCK,HOLDLOCK) WHERE PedidoId=@p AND RemisionId IS NULL`,{p:order.PedidoId},tx);
  if(!boxes.length)throw Error('Este pedido no tiene bultos nuevos para remitir.');
  const remain=await query(`SELECT SUM(FuentePendiente-(CantidadPickeada-CantidadConciliada)) restante FROM dbo.PedidoLineas WHERE PedidoId=@p`,{p:order.PedidoId},tx);
  const parcial=value(remain[0]?.restante)>0.0001;
  const result=await query(`INSERT INTO dbo.Remisiones(PedidoId,Preparador,EstacionId,Parcial,Observacion)
   OUTPUT INSERTED.RemisionId id VALUES(@p,@u,@s,@parcial,@obs)`,
   {p:order.PedidoId,u:info.Preparador,s:station,parcial,obs:String(act.note||'').slice(0,400)},tx);
  await query(`UPDATE l SET CantidadRemitida=CantidadRemitida+x.qty FROM dbo.PedidoLineas l JOIN
   (SELECT bl.LineaId,SUM(bl.Cantidad) qty FROM dbo.BultoLineas bl JOIN dbo.Bultos b ON b.BultoId=bl.BultoId
     WHERE b.PedidoId=@p AND b.RemisionId IS NULL GROUP BY bl.LineaId) x ON x.LineaId=l.LineaId`,{p:order.PedidoId},tx);
  await query('UPDATE dbo.Bultos SET RemisionId=@r WHERE PedidoId=@p AND RemisionId IS NULL',{r:result[0].id,p:order.PedidoId},tx);
  await query('DELETE FROM dbo.Asignaciones WHERE PedidoId=@p',{p:order.PedidoId},tx);
  if(String(info.PedidoActivoId)===String(order.PedidoId)){
   const next=(await query('SELECT TOP 1 PedidoId FROM dbo.Asignaciones WHERE EstacionId=@s ORDER BY AsignadoEn',{s:station},tx))[0];
   await query('UPDATE dbo.Estaciones SET PedidoActivoId=@p,BultoSugerido=NULL WHERE EstacionId=@s',{p:next?.PedidoId||null,s:station},tx);
  }
  await log(tx,station,info.Preparador,'REMITIR',order.PedidoId,`${boxes.length} bulto(s), ${parcial?'PARCIAL':'COMPLETO'}`);
  return {message:`Pedido ${order.Numero} remitido (${parcial?'parcial':'completo'}). ${boxes.length} bulto(s).`};
 }
 throw Error(`Comando ${type} todavía no implementado.`);
 });
}
async function listCsv(){
 const rows=await query(`SELECT p.Numero Pedido,p.ClienteId Cliente,p.NombreCliente,l.Codigo,l.Descripcion,
  l.FuentePendiente Pedida,l.CantidadPickeada-l.CantidadConciliada Preparada,
  l.FuentePendiente-l.CantidadPickeada+l.CantidadConciliada Pendiente,
  l.Ubicacion,p.Pallet,l.MarcaSincronizacion FROM dbo.Pedidos p JOIN dbo.PedidoLineas l ON p.PedidoId=l.PedidoId ORDER BY p.Numero,l.Codigo`);
 return rows;
}
async function recordPrinting(station,boxIds,status='SOLICITADA',error=''){
 if(!Array.isArray(boxIds)||!boxIds.length)return;
 return txDo(async tx=>{
  for(const id of boxIds){
   const b=(await query('SELECT BultoId,PedidoId,Numero FROM dbo.Bultos WHERE BultoId=@b',{b:Number(id)},tx))[0];
   if(!b)continue;
   await query(`INSERT INTO dbo.Impresiones(BultoId,EstacionId,Estado,Error) VALUES(@b,@s,@estado,@e)`,
    {b:b.BultoId,s:station,estado:status,e:error.slice(0,300)},tx);
   await log(tx,station,null,'IMPRESIÓN '+status,b.PedidoId,`Bulto ${b.Numero}`);
  }
 });
}
async function shutdown(){if(pool){await pool.close().catch(()=>{});pool=null;}}
module.exports={connect,connected,stationIdReady,importRecords,snapshot,action,listCsv,recordPrinting,shutdown};
