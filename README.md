# Pedidos a Preparar 0.2 — Hoja Thiago + React / Electron / SQL Server

## Qué es esta entrega

Se reconstruyó la pantalla de **la hoja `thiago` de `Pedidos a Preparar 11.1 thiago(1).xlsm`** y la parte central del picking sobre SQL Server. No es el tablero genérico de la versión 0.1: la vista inicial reproduce la organización de D7, G9, K1, B1, el preparador y las columnas B:T. Es **código fuente**, no ejecutable `.exe` precompilado ni una migración definitiva homologada en depósito.

Los datos operativos nuevos no se guardan en JSON local: cada movimiento se escribe en `dbo.MovimientosPicking`, y los pedidos, bultos, remisiones, etiquetas e importaciones se guardan en tablas específicas de `PedidosAPreparar`. Cada PC conserva únicamente un identificador de estación y la configuración de conexión cifrada con la protección local de Windows.

## 1. Instalar SQL Server desde cero

**En la computadora que va a actuar como servidor** (puede ser una PC de la empresa al principio):

1. Instalá **Microsoft SQL Server 2022 Express** o Standard y **SQL Server Management Studio (SSMS)**. Para una primera prueba en una sola PC, Express es suficiente.
2. Durante la configuración de SQL Server, habilitá *Mixed Mode (SQL Server and Windows Authentication)* si usarás el usuario `picking_app` incluido. Elegí una contraseña fuerte para el administrador; no uses `sa` como usuario de la aplicación.
3. Abrí SSMS conectado a la instancia con una cuenta administradora.
4. Ejecutá primero el archivo **`sql/01_crear_base.sql`**: crea la base **`PedidosAPreparar`** y todas las tablas, índices y restricciones sin borrar información preexistente.
5. Abrí **`sql/02_usuario_aplicacion.sql`**. **Reemplazá la cadena `REEMPLAZAR_CON_CLAVE_FUERTE_ANTES_DE_EJECUTAR` en la variable `@Clave` por una contraseña fuerte propia.** El script se niega a correr con el valor de ejemplo. Ejecutalo: crea el usuario restringido `picking_app` con permisos sobre esta base únicamente.
6. En **SQL Server Configuration Manager**, habilitá TCP/IP para la instancia, fijá un puerto estático (por ejemplo **1433** si está libre), reiniciá el servicio y verificá la escucha. Para una instancia con nombre, conviene un puerto fijo en vez de depender de SQL Browser.
7. En caso de acceso desde otras PC, habilitá **solo el puerto TCP elegido** en el firewall de Windows **para la red interna autorizada**. No expongas SQL Server directamente a Internet. Usá una IP fija o nombre DNS interno para el servidor.
8. Desde SSMS, como administrador, comprobá con:

   ```sql
   USE PedidosAPreparar;
   SELECT name FROM sys.tables ORDER BY name;
   ```

   Deberán aparecer `Pedidos`, `PedidoLineas`, `MovimientosPicking`, `Bultos`, `BultoLineas`, `Remisiones`, `Clientes`, `Articulos`, `Asignaciones`, `Estaciones`, `EtiquetasHistoricas`, `Impresiones`, `Auditoria` e `Importaciones` (entre otras).

**No se ejecutaron estos scripts sobre tu servidor:** para hacerlo hace falta acceder a tu instalación de SQL Server; esta entrega incluye los scripts listos para ejecutarse en SSMS.

## 2. Instalar el programa en Windows

1. Instalá Node.js 22 LTS en la PC de picking.
2. Descomprimí este proyecto.
3. Hacé doble clic en **`INICIAR-WINDOWS.bat`**; instala dependencias y ejecuta React/Electron en modo de desarrollo. Alternativamente, abrí PowerShell en la carpeta y ejecutá:

   ```powershell
   npm install
   npm run dev
   ```

4. La primera vez aparece **Conectar a SQL Server**. Completá `Servidor` (por ejemplo `localhost` o `192.168.1.20`), `Puerto TCP`, `Usuario picking_app` y la contraseña que configuraste en SSMS.
5. Cuando la conexión funcione, Electron creará automáticamente un **ID único de estación**, que se usa para impedir que dos computadoras tomen el mismo pedido al mismo tiempo.
6. Para crear el instalador de Windows (requiere acceso a npm y ejecutarlo en Windows): **`GENERAR-INSTALADOR-WINDOWS.bat`**. Los instaladores quedan en `release/`. Este ZIP no contiene un EXE ya compilado.

**Producción:** SQL Server con certificado válido, `Cifrar conexión TLS` activado y `Confiar en certificado` desactivado. La opción de confiar en certificado/autenticación sin TLS se suministra para pruebas dentro de red local y debe revisarse antes de desplegar.

## 3. Cargar los Excel por primera vez

En **Base / Importar**, usá este orden:

1. `clientes.xls` → clientes y transporte.
2. `stock.xls` → códigos, existencias informadas, pesos y ubicaciones.
3. `pedido pendiente(3).xls` → pedidos con saldo de entrega, cliente, fechas y artículos.
4. `Pedidos a Preparar 11.1 thiago(1).xlsm` → códigos equivalentes de `tablas!I:J`, indicadores de pedidos empezados, número máximo de bulto usado (`thiago!G` y `base bultos!C`) y etiquetas **ya usadas** registradas en `baseetiquetas!A:B`.

El proceso **no sobrescribe el Excel ni ejecuta VBA**; lee los datos de cada archivo. Los escaneos nuevos, en cambio, se guardan directamente en SQL Server.

**Importante sobre bultos anteriores:** la importación del XLSM conserva el mayor número de bulto visible para cada pedido, evitando reutilizarlo. No importa el contenido de los bultos guardados en la base Access que no se proporcionó. Verificá numeraciones con esa base antes de comenzar.

**Atención al saldo importado:** el campo `pendiente` del Excel es un saldo, no la cantidad original histórica. La app guarda por separado cuánto se pickeó, cerró, remitió y cuánto fue conciliado con una exportación posterior para reducir el riesgo de duplicaciones. Si la fuente cambia por anulaciones o movimientos de otro sistema, la conciliación puede resultar ambigua. Antes de usarlo en producción, validá la política de conciliación con el sistema que genera `pedido pendiente.xls` y la base Access original.

## 4. Operar como en Thiago

- **D3/D4**: escribí nombre del preparador y pulsá *Guardar*.
- **PEDIDO**: elegí hasta 3 pedidos y un máximo total de 45 líneas; también hay selección automática por fecha.
- **D7**: dejá el foco en el campo de lectura y escaneá. Los lectores que funcionan como teclado deben enviar **Enter** al terminar la lectura.
- **G9**: escaneá `CLIENTE-PEDIDO` (ejemplo `200-11609`) para seleccionar entre los pedidos cargados. Si solo hay uno asignado, se selecciona automáticamente.
- **Etiquetas de 18 caracteres**: código(8) + cantidad(5) + ID(5). **De 23 caracteres**: código(13) + cantidad(5) + ID(5). El programa elimina ceros iniciales en el código, aplica las equivalencias de `tablas!I:J`, comprueba el saldo y rechaza identificadores repetidos contra `MovimientosPicking` y `EtiquetasHistoricas`.
- **E**: permite corregir manualmente una cantidad, siempre que no reduzca unidades cerradas en bulto. Se audita la diferencia.
- **IMPRIMIR**: cierra las unidades escaneadas en el siguiente bulto de K1 y abre la impresión preliminar. Podés marcar artículos con la casilla de la nueva **columna A**, para cerrar solo esos artículos si hay recipientes distintos.
- **GRANEL**: cada etiqueta crea un movimiento y cierra automáticamente **un bulto independiente**; la vista muestra cada etiqueta como una fila y una fila separada para el saldo. El comando IMPRIMIR permite imprimir los bultos GRANEL preparados.
- **K1**: número sugerido del próximo bulto; podés modificarlo por uno que aún no fue utilizado para ese pedido.
- **PALLET**: cambia el pallet del pedido seleccionado; se conserva en SQL Server.
- **REMITIR**: requiere bultos cerrados y ningún movimiento sin cerrar. Genera remisión con identificación de parcial/total, registra los bultos y libera el pedido de la estación.
- **Reimpresión**: desde Bultos / Etiquetas, o con `REIMPRIMEETQ`, se puede abrir el diálogo de impresión de un bulto ya guardado.
- **Colores**: filas celestes RGB(197,217,241), alerta roja cuando el stock informado es inferior a la cantidad pendiente. Las líneas completadas se colocan al final de la grilla sin demoras de `Worksheet_Change`.

## 5. Qué se guarda exactamente

| Tabla SQL Server | Datos | Motivo |
|---|---|---|
| `Clientes` | Código, nombre, dirección, ruta | Consulta de cliente |
| `Articulos` | Código, descripción, stock (última importación), ubicación, peso | Datos de picking |
| `Pedidos`, `PedidoLineas` | Cliente-pedido, fechas, cantidades y acumulados | Estado de cada línea |
| `MovimientosPicking` | Cada etiqueta, artículo, cantidad, modo, operador, estación y hora | Trazabilidad del escaneo |
| `EtiquetasHistoricas` | Etiquetas utilizadas antes de migrar | Evita reutilización de códigos |
| `Bultos`, `BultoLineas` | Número, pallet, recipiente, contenido, peso, fecha y preparador | Trazabilidad de paquetes |
| `Remisiones` | Cierre del pedido, operador, parcial/total | Expedición |
| `Estaciones`, `Asignaciones` | Pedido activo y reserva de pedidos por PC | Evitar preparación concurrente |
| `Auditoria`, `Impresiones`, `Importaciones` | Historial, solicitudes de impresión, fuentes y fechas | Control y diagnóstico |

## 6. Copia de seguridad

Programá un **backup automático** de la base SQL Server con SQL Server Agent (ediciones que lo incluyen) o con el **Programador de tareas de Windows** + `sqlcmd` (Express). Ejemplo manual desde SSMS, ajustando una ruta válida en el **servidor**:

```sql
BACKUP DATABASE PedidosAPreparar
TO DISK = N'C:\Backups\PedidosAPreparar.bak'
WITH INIT, CHECKSUM, NAME = N'Respaldo Pedidos a Preparar';
```

Verificá periódicamente que el archivo se genere y que sea posible restaurarlo **en otra instancia de prueba**. No guardes la única copia en el mismo disco físico que contiene SQL Server.

## 7. Estado de equivalencia con el Excel (importante)

**Implementado en código:** pantalla Thiago, campos B:T y D7/G9/K1, preparador, 3 pedidos/45 líneas, scanner 18/23, alias I:J, control global de etiquetas repetidas, picking normal, modo granel con bultos individuales, corrección manual, selección, cierre de bultos, remisión parcial/total, pallet, impresión básica, reimpresión, color de stock, ordenamiento de completos, auditoría y persistencia SQL centralizada.

**Aún no homologado o incompleto:** los circuitos especiales `PUERTA`, `VERIFICACION`, impresión real de pallet y remito oficial, etiquetas con formato exacto de la impresora térmica, toda la lógica de `BURLETES` y `ROLLOS`, copia/migración del histórico de `listadodebultos` desde Access, y las excepciones complejas de `CRITERIO`, `picking1`, `aprueba` y `cierra_caja`. Las órdenes de impresión se registran como **solicitadas o enviadas al spooler**, no como impresión física confirmada. **No usar como reemplazo productivo sin homologación en depósito.**

## 8. Pruebas y seguridad

```powershell
npm test
npm run check:node
```

Los tests automáticos comprueban lectura 18/23, ceros iniciales, cliente-pedido, fechas y ordenamiento. La conexión y transacciones reales de SQL Server, la interfaz en Electron y el proceso de impresión deben probarse en una PC con SQL Server y las dependencias instaladas. Si una PC pierde conexión, **la aplicación no debería aceptar nuevos picks hasta que SQL confirme el guardado**, evitando aparentar avances que no quedaron registrados.

El usuario SQL `picking_app` tiene permisos de datos sobre esta base, pero no permisos para administrar el servidor. La contraseña se cifra localmente con Electron safeStorage en Windows y no se envía a la interfaz React. Cada lector o computadora se identifica por su ID de estación; el campo preparador identifica al operador, pero **todavía no hay autenticación personal con contraseña**.
# Indicadores-Dismaser
