const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {safeStorage} = require('electron');
let directory;
const configPath = () => path.join(directory,'servidor-sql.json');
const stationPath = () => path.join(directory,'estacion.json');
function initialize(dir) { directory=dir; fs.mkdirSync(directory,{recursive:true}); }
function station() {
  let value;try{value=JSON.parse(fs.readFileSync(stationPath(),'utf8'));}catch{}
  if(!value?.id){ value={id:crypto.randomUUID(),createdAt:new Date().toISOString()};fs.writeFileSync(stationPath(),JSON.stringify(value,null,2)); }
  return value.id;
}
function getConfig(){
 let c={};try{c=JSON.parse(fs.readFileSync(configPath(),'utf8'))}catch{}
 let password='';
 if(c.passwordEncrypted && safeStorage.isEncryptionAvailable()){
  try{password=safeStorage.decryptString(Buffer.from(c.passwordEncrypted,'base64'))}catch{}
 }
 password=process.env.PICKING_DB_PASSWORD || password;
 return { server:process.env.PICKING_DB_SERVER||c.server||'localhost',port:Number(process.env.PICKING_DB_PORT||c.port||1433),
  database:'PedidosAPreparar',user:process.env.PICKING_DB_USER||c.user||'picking_app',password,
  encrypt:c.encrypt===true,trustServerCertificate:c.trustServerCertificate!==false };
}
function publicConfig(){const {password,...value}=getConfig();return {...value,hasPassword:Boolean(password),stationId:station()};}
function saveConfig(c){
 const prev={};
 try{Object.assign(prev,JSON.parse(fs.readFileSync(configPath(),'utf8')))}catch{}
 const next={ server:String(c.server||'').trim(),port:Number(c.port||1433),
   user:String(c.user||'').trim(),encrypt:Boolean(c.encrypt),trustServerCertificate:Boolean(c.trustServerCertificate),
   passwordEncrypted:prev.passwordEncrypted||'' };
 if(!next.server || !next.user || !Number.isInteger(next.port) || next.port<1 || next.port>65535) throw Error('Datos de conexión SQL Server no válidos.');
 if(c.password){
   if(!safeStorage.isEncryptionAvailable()) throw Error('En este equipo no está disponible el cifrado de credenciales. Usá PICKING_DB_PASSWORD en el entorno.');
   next.passwordEncrypted=safeStorage.encryptString(String(c.password)).toString('base64');
 }
 fs.writeFileSync(configPath(),JSON.stringify(next,null,2),'utf8');
 return publicConfig();
}
module.exports={initialize,getConfig,publicConfig,saveConfig,station};
