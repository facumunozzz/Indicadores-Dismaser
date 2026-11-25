const fs = require('node:fs');
const path = require('node:path');

function newState() {
  return {
    version: 1,
    orders: [], stock: {}, clients: {}, boxes: [], structures: {}, legacyKeys: [],
    activeKeys: [], focusedKey: '', settings: { preparador: 'Preparador' },
    imports: [], audit: []
  };
}
function createStorage(userData) {
  const file = path.join(userData, 'pedidos-a-preparar.json');
  fs.mkdirSync(userData, { recursive: true });
  function load() {
    if (!fs.existsSync(file)) return newState();
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (raw.version !== 1 || !Array.isArray(raw.orders)) throw Error('Versión de datos desconocida');
      return { ...newState(), ...raw, settings: { ...newState().settings, ...raw.settings } };
    } catch (err) {
      throw Error(`No se pudo leer la base local (${file}). No se sobrescribió. ${err.message}`);
    }
  }
  function save(state) {
    const temp = `${file}.tmp`;
    // Copia preventiva de la versión anterior y reemplazo por archivo completo.
    if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
    fs.writeFileSync(temp, JSON.stringify(state), 'utf8');
    fs.renameSync(temp, file);
  }
  return { load, save, file };
}
module.exports = { createStorage, newState };
