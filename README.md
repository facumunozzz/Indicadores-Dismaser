# Dismaser Control — menú inicial (React + Electron)

## Requisitos (Windows)
- Node.js LTS y npm, instalados desde https://nodejs.org/
- Windows 10/11 de 64 bits
- Conexión a internet solo para `npm install` (y obtener dependencias)

## Puesta en marcha
1. Abrir una terminal en la carpeta `dismaser-menu-react`.
2. Ejecutar `npm install`.
3. Ejecutar `npm run dev` para iniciar Vite y Electron.
4. Hacer clic en los módulos y entrar en **Configuración** para elegir una carpeta compartida.

## Compilar para Windows
En **Windows**:

```powershell
npm run build
npm run dist:win
```

El instalador quedará en la carpeta `release`.

## Archivos
- `package.json`: dependencias, comandos e instalador.
- `index.html`: página de entrada de React.
- `vite.config.js`: construcción y servidor de desarrollo.
- `electron/main.cjs`: ventana Electron y selección segura de carpetas.
- `electron/preload.cjs`: API mínima y aislada entre React y Electron.
- `src/main.jsx`: inicialización de React.
- `src/App.jsx`: menú y pantallas iniciales.
- `src/styles.css`: diseño adaptable y modo oscuro.
- `.gitignore`: evita incluir archivos temporales.

## Limitación importante
Configurar una carpeta de Dropbox en una computadora **no** significa que esta versión ya comparta indicadores. Eso se programará cuando se incorpore importación/validación de Excel y consolidación controlada de datos. Para evitar conflictos entre usuarios, habrá un responsable de actualización y el resto tendrá acceso de lectura.
