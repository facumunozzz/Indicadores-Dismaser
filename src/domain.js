/** Reglas de negocio compartidas entre Electron y React. Sin dependencias. */
export const MAX_ORDERS = 3;
export const MAX_LINES = 45;
export const CONTAINERS = ['CAJA', 'BOLSA', 'GRANEL', 'PALLET', 'ROLLO', 'OTRO'];

export function idValue(v) {
  const s = String(v ?? '').trim();
  if (/^\d+(?:\.0+)?$/.test(s)) return String(Number(s));
  return s.toUpperCase();
}
export function keyFor(clientId, orderId) {
  return `${idValue(clientId)}|${idValue(orderId)}`;
}
export function quantity(v) {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : 0;
}
export function dateISO(v) {
  if (typeof v === 'number' && Number.isFinite(v) && v > 1) {
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 86400000).toISOString().slice(0, 10);
  }
  const s = String(v ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return '';
}
export function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function addDaysISO(iso, n) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export function dateState(dueDate, today = todayISO()) {
  if (!dueDate) return 'SIN FECHA';
  if (dueDate < today) return 'VENCIDO';
  if (dueDate === today) return 'HOY';
  if (dueDate === addDaysISO(today, 1)) return 'MAÑANA';
  return 'POSTERIOR';
}
export function progress(order) {
  const lines = order.items || [];
  const asked = lines.reduce((n, i) => n + quantity(i.requested), 0);
  const done = lines.reduce((n, i) => n + quantity(i.prepared), 0);
  const completed = lines.length > 0 && lines.every(i => quantity(i.prepared) >= quantity(i.requested));
  const remaining = Math.max(0, asked - done);
  let status = 'PENDIENTE';
  if (order.archived) status = 'ARCHIVADO';
  else if (completed && (order.remissions || []).length) status = 'REMITIDO';
  else if (completed) status = 'LISTO';
  else if ((order.remissions || []).length) status = 'PARCIAL REMITIDO';
  else if (done > 0 || order.legacyStarted) status = 'EMPEZADO';
  return { asked, done, remaining, completed, status, percent: asked ? Math.min(100, Math.round(done / asked * 100)) : 0 };
}
export function orderPriority(order, today = todayISO()) {
  // Reproduce la prioridad comprobada del formulario VBA: vencidos/hoy/mañana,
  // después fechas futuras y finalmente sin fecha. Dentro de un grupo, fecha más vieja.
  const t = order.dueDate || '9999-12-31';
  const stage = !order.dueDate ? 2 : t <= addDaysISO(today, 1) ? 0 : 1;
  return `${stage}|${t}|${String(order.orderId).padStart(12, '0')}`;
}
export function recommended(orders, activeKeys = [], today = todayISO()) {
  const active = new Set(activeKeys);
  let slots = MAX_ORDERS - active.size;
  let lines = orders.filter(o => active.has(o.key)).reduce((n, o) => n + (o.effectiveLines || o.items.length), 0);
  if (slots <= 0) return [];
  const sorted = orders.filter(o => !active.has(o.key) && !o.archived && !o.legacyStarted &&
    progress(o).status === 'PENDIENTE')
    .sort((a, b) => orderPriority(a, today).localeCompare(orderPriority(b, today)));
  const result = [];
  for (const o of sorted) {
    const count = o.effectiveLines || o.items.length;
    if (count > MAX_LINES || count <= 0 || lines + count > MAX_LINES) continue;
    result.push(o.key); lines += count; slots -= 1;
    if (slots === 0) break;
  }
  return result;
}
export function canAssign(orders, keys) {
  const unique = [...new Set(keys)];
  if (unique.length > MAX_ORDERS) return `Máximo ${MAX_ORDERS} pedidos simultáneos.`;
  const selected = unique.map(k => orders.find(o => o.key === k));
  if (selected.some(o => !o)) return 'Se seleccionó un pedido que no existe.';
  if (selected.some(o => o.archived || ['REMITIDO', 'LISTO'].includes(progress(o).status)))
    return 'Hay pedidos archivados o ya terminados en la selección.';
  const lineCount = selected.reduce((n, o) => n + (o.effectiveLines || o.items.length), 0);
  if (lineCount > MAX_LINES) return `El total supera las ${MAX_LINES} líneas (${lineCount}).`;
  return '';
}
export function orderLinesSorted(lines) {
  return [...lines].sort((a, b) => {
    const af = quantity(a.prepared) >= quantity(a.requested);
    const bf = quantity(b.prepared) >= quantity(b.requested);
    if (af !== bf) return Number(af) - Number(bf);
    return String(a.location || '').localeCompare(String(b.location || ''), 'es', { numeric: true });
  });
}
export function effectiveLineCount(products, structures = {}) {
  const memo = new Map();
  function walk(code, stack = new Set()) {
    const c = String(code).trim().toUpperCase();
    if (memo.has(c)) return memo.get(c);
    if (stack.has(c)) return MAX_LINES + 1;
    const next = new Set(stack); next.add(c);
    let count = 1;
    for (const child of structures[c] || []) {
      count += walk(child, next);
      if (count > MAX_LINES) break;
    }
    memo.set(c, count);
    return count;
  }
  return products.reduce((sum, sku) => sum + walk(sku), 0);
}
