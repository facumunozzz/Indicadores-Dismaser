import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import * as d from '../src/domain.js';
const require = createRequire(import.meta.url);
const { runAction } = require('../electron/actions.cjs');
const { newState } = require('../electron/storage.cjs');

function fixture() {
  const state = newState();
  state.orders = [
    { key: '1|100', orderId: '100', clientId: '1', clientName: 'Cliente A',
      dueDate: '2026-11-09', effectiveLines: 2, remissions: [], items: [
        { id: 'X', sku: 'X', description: 'Producto X', requested: 10,
          prepared: 0, boxedQty: 0, location: '2 A-1', container: 'CAJA', weight: .2 }
      ] },
    { key: '2|101', orderId: '101', clientId: '2', clientName: 'Cliente B',
      dueDate: '2026-11-11', effectiveLines: 1, remissions: [], items: [
        { id: 'Y', sku: 'Y', description: 'Producto Y', requested: 3,
          prepared: 0, boxedQty: 0, location: '1 B-3', container: 'CAJA', weight: .1 }
      ] }
  ];
  state.activeKeys = ['1|100']; state.focusedKey = '1|100';
  return state;
}
const run = (state, action) => runAction(state, action, d);

test('bloquea preparación superior a lo solicitado', () => {
  const s=fixture();
  assert.throws(() => run(s, { type:'SET_LINE', key:'1|100', lineId:'X', field:'prepared', value:11 }), /entre 0 y 10/);
});
test('cierra bulto, no permite bajar cantidad ya embalada y remite', () => {
  const s=fixture();
  run(s, {type:'SET_LINE',key:'1|100',lineId:'X',field:'prepared',value:10});
  run(s, {type:'CLOSE_BOX',key:'1|100'});
  assert.equal(s.boxes[0].id,'100-1');
  assert.equal(s.boxes[0].items[0].quantity,10);
  assert.throws(() => run(s,{type:'SET_LINE',key:'1|100',lineId:'X',field:'prepared',value:5}),/bulto/);
  run(s, {type:'REMIT',key:'1|100'});
  assert.equal(d.progress(s.orders[0]).status,'REMITIDO');
  assert.equal(s.activeKeys[0],'2|101');
});
test('ubicación obligatoria antes del cierre', () => {
  const s=fixture();
  run(s,{type:'SET_LINE',key:'1|100',lineId:'X',field:'location',value:''});
  run(s,{type:'SET_LINE',key:'1|100',lineId:'X',field:'prepared',value:2});
  assert.throws(() => run(s,{type:'CLOSE_BOX',key:'1|100'}),/ubicación/);
});
test('remisión parcial mantiene pendiente el saldo', () => {
  const s=fixture();
  run(s,{type:'SET_LINE',key:'1|100',lineId:'X',field:'prepared',value:4});
  run(s,{type:'CLOSE_BOX',key:'1|100'});
  run(s,{type:'REMIT',key:'1|100'});
  assert.equal(d.progress(s.orders[0]).status,'PARCIAL REMITIDO');
  assert.equal(d.progress(s.orders[0]).remaining,6);
});
