function runAction(state, action, domain) {
  if (!action || typeof action.type !== 'string') throw Error('Acción desconocida.');
  const order = state.orders.find(o => o.key === action.key);
  const at = new Date().toISOString();
  const requireOrder = () => { if (!order) throw Error('Pedido no encontrado.'); return order; };
  const log = (type, detail) => {
    state.audit.unshift({ type, detail, at, preparador: state.settings.preparador });
    state.audit = state.audit.slice(0, 1500);
  };
  switch (action.type) {
    case 'SET_PREPARADOR': {
      const name = String(action.name || '').trim().slice(0, 80);
      if (!name) throw Error('Ingresá el nombre del preparador.');
      state.settings.preparador = name; break;
    }
    case 'ASSIGN': {
      const keys = [...new Set(action.keys || [])];
      const error = domain.canAssign(state.orders, keys);
      if (error) throw Error(error);
      state.activeKeys = keys;
      state.focusedKey = keys.includes(state.focusedKey) ? state.focusedKey : keys[0] || '';
      log('ASIGNACIÓN', keys.map(k => k.replace('|', '-')).join(', '));
      break;
    }
    case 'AUTO_ASSIGN': {
      state.activeKeys = (state.activeKeys || []).filter(k => state.orders.some(o => o.key === k && !o.archived));
      const picks = domain.recommended(state.orders, state.activeKeys);
      state.activeKeys.push(...picks);
      if (!state.activeKeys.includes(state.focusedKey)) state.focusedKey = state.activeKeys[0] || '';
      log('ASIGNACIÓN AUTOMÁTICA', picks.map(k => k.replace('|', '-')).join(', ') || 'Sin pedidos elegibles');
      break;
    }
    case 'FOCUS': {
      if (!state.activeKeys.includes(action.key)) throw Error('El pedido no está cargado para preparación.');
      state.focusedKey = action.key; break;
    }
    case 'SET_LINE': {
      requireOrder();
      if (order.archived) throw Error('No se puede editar un pedido archivado.');
      const line = order.items.find(i => i.id === action.lineId);
      if (!line) throw Error('Artículo no encontrado.');
      if (action.field === 'prepared') {
        const q = Number(action.value);
        if (!Number.isFinite(q) || q < 0 || q > line.requested)
          throw Error(`La cantidad debe estar entre 0 y ${line.requested}.`);
        if (q < (line.boxedQty || 0)) throw Error('No se puede reducir una cantidad que ya está dentro de un bulto.');
        line.prepared = q;
      } else if (action.field === 'location') line.location = String(action.value || '').trim().slice(0, 100);
      else if (action.field === 'container') {
        const c = String(action.value || '').toUpperCase();
        if (!domain.CONTAINERS.includes(c)) throw Error('Tipo de recipiente no válido.');
        line.container = c;
      } else if (action.field === 'note') line.note = String(action.value || '').slice(0, 400);
      else throw Error('Campo no editable.');
      order.updatedAt = at;
      break;
    }
    case 'SET_PALLET': {
      requireOrder(); order.palletId = String(action.value || '').trim().slice(0, 80); break;
    }
    case 'SET_CATEGORY': {
      requireOrder(); order.category = String(action.value || '').trim().slice(0, 30); break;
    }
    case 'CLOSE_BOX': {
      requireOrder();
      if (!state.activeKeys.includes(order.key)) throw Error('Activá el pedido antes de cerrar un bulto.');
      const allow = new Set(action.lineIds || []);
      const selected = order.items.filter(i => i.prepared > (i.boxedQty || 0) &&
        (!allow.size || allow.has(i.id)));
      if (!selected.length) throw Error('No hay cantidades nuevas para incluir en el bulto.');
      if (selected.some(i => !String(i.location || '').trim())) throw Error('Todos los artículos preparados deben tener ubicación.');
      const types = new Set(selected.map(i => i.container || 'CAJA'));
      if (types.size > 1) throw Error('No mezcles distintos recipientes en el mismo bulto: seleccioná artículos del mismo tipo.');
      if (types.has('GRANEL') && selected.length > 1) throw Error('El granel debe cerrarse en un bulto separado por artículo.');
      const boxCount = state.boxes.filter(b => b.orderKey === order.key).length + 1;
      const box = {
        id: `${order.orderId}-${boxCount}`, number: boxCount, orderKey: order.key,
        orderId: order.orderId, clientName: order.clientName, clientId: order.clientId,
        pallet: order.palletId || '', preparador: state.settings.preparador,
        createdAt: at, remittedAt: '',
        items: selected.map(i => ({ sku: i.sku, description: i.description,
          quantity: i.prepared - (i.boxedQty || 0), location: i.location,
          container: i.container || 'CAJA', weight: (i.prepared - (i.boxedQty || 0)) * (i.weight || 0) }))
      };
      for (const i of selected) i.boxedQty = i.prepared;
      state.boxes.push(box);
      log('CIERRE DE BULTO', box.id);
      break;
    }
    case 'REMIT': {
      requireOrder();
      const opened = state.boxes.filter(b => b.orderKey === order.key && !b.remittedAt);
      if (!opened.length) throw Error('Primero cerrá al menos un bulto nuevo.');
      const outstanding = order.items.filter(i => (i.prepared || 0) > (i.boxedQty || 0));
      if (outstanding.length) throw Error('Hay artículos preparados sin cerrar en un bulto.');
      if (order.items.some(i => i.prepared > 0 && !String(i.location || '').trim()))
        throw Error('Faltan ubicaciones de artículos preparados.');
      for (const b of opened) b.remittedAt = at;
      order.remissions ||= [];
      order.remissions.push({ at, preparador: state.settings.preparador, boxIds: opened.map(b => b.id),
        complete: domain.progress(order).completed });
      state.activeKeys = state.activeKeys.filter(k => k !== order.key);
      state.activeKeys.push(...domain.recommended(state.orders, state.activeKeys));
      if (!state.activeKeys.includes(state.focusedKey)) state.focusedKey = state.activeKeys[0] || '';
      log('REMITIDO', `${order.orderId} - ${opened.length} bulto(s)`);
      break;
    }
    case 'DEMO': {
      if (state.orders.length) throw Error('La demostración solo se carga cuando no hay pedidos reales.');
      const today = domain.todayISO();
      const examples = [
        { p: 12851, client: 'Ferretería Norte', due: -2, lines: 4 },
        { p: 12852, client: 'Distribuidora Central', due: 0, lines: 5 },
        { p: 12853, client: 'Casa de Herrajes Sur', due: 1, lines: 3 },
        { p: 12854, client: 'Mayorista Industrial', due: 3, lines: 8 },
        { p: 12855, client: 'Comercial del Oeste', due: 5, lines: 6 }
      ];
      state.orders = examples.map((x, oi) => ({
        key: `${oi + 1}|${x.p}`, orderId: String(x.p), clientId: String(oi + 1),
        clientName: x.client, dueDate: domain.addDaysISO(today, x.due),
        orderDate: today, destination: '', category: '', route: 'EXPRESO',
        palletId: '', legacyStarted: false, remissions: [], archived: false,
        effectiveLines: x.lines,
        items: Array.from({ length: x.lines }, (_, i) => ({
          id: `COD-${oi + 1}-${i + 1}`, sku: `COD-${oi + 1}-${i + 1}`,
          description: `Artículo de demostración ${i + 1}`,
          requested: 10 * (i + 1), prepared: 0, boxedQty: 0,
          location: `2 ${String.fromCharCode(65 + i % 5)}-${i % 4 + 1}`,
          availableStock: 60, weight: 0.15, container: 'CAJA', note: ''
        }))
      }));
      state.stock = {};
      log('DEMOSTRACIÓN', 'Datos ficticios de prueba');
      break;
    }
    default: throw Error(`La acción ${action.type} no está permitida.`);
  }
  return state;
}
module.exports = { runAction };
