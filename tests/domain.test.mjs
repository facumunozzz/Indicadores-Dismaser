import test from 'node:test';
import assert from 'node:assert/strict';
import { dateISO, keyFor, dateState, recommended, canAssign, progress, effectiveLineCount } from '../src/domain.js';

const make = (n, dueDate, lines = 1, opts = {}) => ({
  key: `1|${n}`, orderId: String(n), clientId: '1', dueDate,
  items: Array.from({ length: lines }, (_, i) => ({ id: String(i), requested: 10, prepared: 0 })), ...opts
});
test('convierte correctamente fechas Excel y normaliza clientes', () => {
  assert.equal(dateISO(46100), '2026-03-19');
  assert.equal(keyFor('00200', 11609), '200|11609');
  assert.equal(dateState('2026-11-09', '2026-11-10'), 'VENCIDO');
});
test('ordena vencidos antes que posteriores y respeta tres pedidos', () => {
  const orders = [make(4, '2026-11-30'), make(5, ''), make(2, '2026-11-10'), make(3, '2026-11-11'), make(1, '2026-11-09')];
  assert.deepEqual(recommended(orders, [], '2026-11-10'), ['1|1', '1|2', '1|3']);
});
test('impide superar las 45 líneas totales', () => {
  assert.match(canAssign([make(1, '', 30), make(2, '', 16)], ['1|1', '1|2']), /45/);
  assert.equal(canAssign([make(1, '', 20), make(2, '', 25)], ['1|1', '1|2']), '');
});
test('omite los pedidos que ya se empezaron en el Excel', () => {
  assert.deepEqual(recommended([make(1, '2026-11-09', 1, { legacyStarted: true }), make(2, '2026-11-11')], [], '2026-11-10'), ['1|2']);
});
test('detecta preparación y estado de listo', () => {
  const order = make(1, '', 1);
  assert.equal(progress(order).status, 'PENDIENTE');
  order.items[0].prepared = 10;
  assert.equal(progress(order).status, 'LISTO');
});
test('cuenta hijos de estructura como VBA', () => {
  assert.equal(effectiveLineCount(['A', 'B'], { A: ['X', 'Y'], Y: ['Z'] }), 5);
});
