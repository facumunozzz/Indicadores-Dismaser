import {createRequire} from 'node:module';
import test from 'node:test';
import assert from 'node:assert/strict';
import {dateISO,orderLinesSorted} from '../src/domain.js';
const require=createRequire(import.meta.url);
const {parseLabel,parseClientOrder}=require('../electron/scanner.cjs');
test('etiqueta 18 caracteres: 8 + 5 + 5',()=>{
 const x=parseLabel('H21412I30002400031');
 assert.deepEqual([x.sku,x.qty,x.labelId],['H21412I3',24,31]);
});
test('etiqueta 23 caracteres elimina ceros iniciales',()=>{
 const x=parseLabel('00000H21412I30002400031');
 assert.deepEqual([x.sku,x.qty,x.labelId],['H21412I3',24,31]);
});
test('rechaza largo y cantidades inválidas',()=>{
 assert.throws(()=>parseLabel('H21412I30000000031'));
 assert.throws(()=>parseLabel('111111111'));
});
test('lector interpreta cliente-pedido con apóstrofe',()=>{
 assert.deepEqual(parseClientOrder("0200'11609"),{clientId:'200',orderNo:'11609'});
});
test('completos bajan al final',()=>{
 const x=orderLinesSorted([{sku:'FIN',requested:10,prepared:10,location:'1 A-1'},{sku:'PEN',requested:12,prepared:5,location:'3 C-1'}]);
 assert.equal(x[0].sku,'PEN');assert.equal(x[1].sku,'FIN');
});
test('fechas de Excel',()=>assert.equal(dateISO(46090),'2026-03-09'));
