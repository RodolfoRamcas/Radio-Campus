# Radio Campus

Radio inteligente e interactiva para el campus. Una pantalla pública muestra la canción que suena y dos opciones para la siguiente. La comunidad vota desde el celular escaneando un código QR, sin instalar nada. Las opciones se eligen según la hora, la temperatura local y el calendario institucional. Entre canciones suenan anuncios del campus leídos con voz generada por IA.

| Dirección | Para qué |
| --- | --- |
| `/pantalla` | Pantalla pública horizontal: canción actual, votación, QR, temporizador, resultados y anuncios. Reproduce el audio tras un clic en **Activar audio** (sin contraseña). |
| `/votar` | Página móvil de votación (la abre el QR). |
| `/admin` | Panel de administración con contraseña. |

## Inicio rápido (local)

Requisitos: Node.js 22.13 o superior y una conexión a internet (YouTube y el clima se consultan en línea).

```bash
npm install
cp .env.example .env      # en Windows: copy .env.example .env
```

Edita `.env` y define al menos `ADMIN_PASSWORD`. Después:

```bash
npm run dev
```

Abre `http://localhost:5173/pantalla` y pulsa **Activar audio**. El panel está en `http://localhost:5173/admin`. Para votar, abre `http://localhost:5173/votar`. Para votar desde un celular en la misma red, usa `npm run dev -- --host`.

`npm run dev` levanta todo junto: la interfaz (Vite + React), el Worker, el Durable Object y su base SQLite. Usa el mismo runtime de Cloudflare (`workerd`) que en producción. Los datos locales se guardan en `.wrangler/`; bórrala para empezar de cero.

La primera vez se carga un catálogo de ejemplo con 57 canciones, 8 reglas, 6 eventos y 4 anuncios. Todos los videos se comprobaron y permiten reproducción embebida.

### Comandos

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Desarrollo local con recarga automática |
| `npm test` | Pruebas (51) del algoritmo, el motor, la API y los servicios |
| `npm run build` | Compila para producción en `dist/` |
| `npm run preview` | Compila y sirve la versión de producción localmente |
| `npm run deploy` | Compila y publica en Cloudflare |

## Despliegue en Cloudflare

El sistema completo corre en **Cloudflare Workers** con un **Durable Object**. No hace falta otro servidor ni otra base de datos. El plan gratuito alcanza para un campus (ver [Costos](#servicios-costos-y-límites)).

### Opción A: desde GitHub (recomendada)

1. Sube este repositorio a GitHub.
2. En el panel de Cloudflare: **Workers & Pages → Create → Import a repository** y elige el repositorio.
3. Configuración de compilación:
   - Build command: `npm run build`
   - Deploy command: `npx wrangler deploy`
4. Después del primer despliegue, en **Settings → Variables and Secrets** agrega, con tipo **Secret**:
   - `ADMIN_PASSWORD`: obligatoria.
   - `GEMINI_API_KEY`: opcional; sin ella, los anuncios usan la voz del navegador.
   - `SESSION_SECRET`: opcional.
5. Cada `git push` a la rama principal vuelve a desplegar.

### Opción B: desde tu computadora

```bash
npx wrangler login
npm run deploy
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put GEMINI_API_KEY     # opcional
```

Cloudflare entrega una dirección HTTPS del tipo `https://radio-campus.<tu-cuenta>.workers.dev`. Desde ella funcionan `/pantalla`, `/votar` y `/admin`. Se puede asignar un dominio propio en **Settings → Domains & Routes**.

### Variables de entorno

| Variable | Dónde | Obligatoria | Uso |
| --- | --- | --- | --- |
| `ADMIN_PASSWORD` | Secreto | Sí | Contraseña del panel |
| `GEMINI_API_KEY` | Secreto | No | Voz de los anuncios (Gemini TTS) y etiquetas sugeridas al agregar canciones ([obtener clave](https://aistudio.google.com/apikey)) |
| `SESSION_SECRET` | Secreto | No | Firma sesiones y cookies de voto. Si falta, el servidor genera una y la guarda en su base. |
| `GEMINI_TTS_MODEL` | `wrangler.jsonc` → `vars` | No | Modelo de voz (por defecto `gemini-3.8-flash-lite-tts`) |
| `GEMINI_MODEL` | `wrangler.jsonc` → `vars` | No | Modelo que sugiere etiquetas de canciones (por defecto `gemini-3.5-flash-lite`) |

En local, estos valores van en `.env`, que git ignora. Ninguna clave llega al navegador: solo el servidor las usa.

## Operación diaria

1. **Pantalla con audio.** En la computadora conectada a la pantalla y a las bocinas, abre `/pantalla` en pantalla completa (F11) y pulsa **Activar audio** (el navegador exige un clic antes de reproducir sonido). Si se corta la red, se reconecta y recupera el audio sola.
2. **Más pantallas.** Cualquier otra pantalla puede abrir `/pantalla` y elegir **Solo mostrar, sin audio**. Solo una pantalla reproduce el audio a la vez.
3. **Votación.** El QR lleva a `/votar`. Cada ronda se abre al empezar una canción y cierra antes de que termine, para mostrar los resultados. La ganadora suena a continuación.
4. **Panel.** Desde **En vivo** se pausa o reanuda la programación, se salta una canción, se cierra una ronda antes de tiempo, se programa una canción o un anuncio y se reordena la cola.

## Arquitectura

```
 Celulares (/votar)        Pantalla (/pantalla)                Panel (/admin)
        │  HTTPS + WebSocket          │  WebSocket + YouTube IFrame       │  HTTPS + WebSocket
        └──────────────┬──────────────┴───────────────┬───────────────────┘
                       ▼                              │
            Cloudflare Worker (worker/index.js)        │  Archivos estáticos (React)
                       │ /api/*                        │  servidos por Workers Assets
                       ▼
        Durable Object "Radio" (una sola instancia)
        ├── RadioEngine (server/engine.js): programación, rondas, votos, cola
        ├── SQLite (catálogo, configuración, rondas, votos, historial, audio)
        ├── WebSockets con hibernación: envía el estado a todos los clientes
        └── Alarma: cierra rondas y avanza la programación por reloj del servidor
                       │
        ┌──────────────┼───────────────────────┐
        ▼              ▼                       ▼
   Open-Meteo     Gemini TTS              YouTube oEmbed
   (temperatura)  (voz de anuncios)       (validar videos)
```

**Por qué un Durable Object.** Es un único punto de control con su propia base SQLite. Todos los votos y transiciones pasan por él en orden, así que no hay condiciones de carrera. El cierre de rondas y el conteo oficial ocurren en el servidor, con su reloj y su alarma, y nunca dependen del reloj del celular. Los WebSockets mantienen sincronizados a todos los dispositivos, sin importar el navegador.

**Quién decide qué.** El servidor decide todo: qué suena, cuándo cierra la ronda y qué ganó. La pantalla con audio solo reproduce lo que el servidor indica y le avisa cuándo empezó (con la duración real), cuándo terminó o si falló. Si no hay pantalla reproductora, la programación avanza por reloj.

### Ciclo de una canción

1. Empieza una canción. Si no hay otra canción programada en la cola, se abre una ronda con dos opciones elegidas por el algoritmo.
2. La ronda cierra cuando se cumple su duración configurada, o antes si la canción va a terminar. Siempre queda un margen para mostrar los resultados.
3. Gana la opción con más votos. Los empates y las rondas sin votos se resuelven con reglas configurables. La ganadora pasa a la cola.
4. Al terminar la canción suena **un anuncio**. Si todos sonaron hace poco, rotan: primero el que lleva más tiempo sin sonar. Nunca suena uno vencido o sin aprobar, ni encima de la música.
5. La voz IA **presenta la siguiente canción** (por ejemplo: "¡Ustedes lo eligieron! En Radio Campus suena This Love, de Maroon 5."). Esa canción se decide al terminar la anterior, así que su presentación se genera mientras suena el anuncio. Si el audio no está listo, se usa la voz del navegador.
6. Suena la canción y se abre la siguiente ronda.

Ambas cosas se pueden apagar en Configuración ("Un anuncio entre cada canción" y "La voz IA presenta cada canción").

### Algoritmo de selección musical

Implementado en `src/shared/selection.js` y compartido entre servidor y panel (simulador):

1. **Autorizadas.** Excluye canciones desactivadas, con restricciones bloqueadas (por ejemplo `explicita`), de temporada fuera de su festividad, la que suena y las que ya están en cola.
2. **Sin repetir.** Excluye las últimas *N* canciones y lo que sonó en los últimos *M* minutos.
3. **Reglas.** Recorre las reglas que aplican al contexto, de mayor a menor prioridad. Cada una acota géneros, energía, lista o temática obligatoria, siempre que queden canciones suficientes; si no, se "relaja" y queda registrado. Una regla **exclusiva** (como la de exámenes) ignora a las de menor prioridad.
4. **Afinidad.** Ordena por coincidencia de ambiente, temática y energía, ponderada por la prioridad de cada regla, con un toque de variedad configurable. Evita dos opciones del mismo artista.
5. **Respaldo.** Si no hay suficientes candidatas, o falta el dato del clima y así está configurado, usa la **lista de respaldo autorizada**.

Cada ronda guarda el motivo de su selección (reglas aplicadas, relajadas y respaldo), visible en el panel en "¿Por qué estas opciones?". El **simulador** de la sección Reglas muestra qué se ofrecería en cualquier fecha, hora y temperatura.

Cada canción tiene las etiquetas que pide el proyecto: **género, energía (1–5), ambiente, temática y restricciones**. El vocabulario de etiquetas se edita en Configuración.

### Estructura del código

```
src/
  shared/        Lógica pura compartida: contexto, selección, rondas, anuncios, horarios
  client/        Conexión en tiempo real, API, YouTube, voz del navegador
  components/    Reproductores (video y locución), indicador de conexión
  pages/         Pantalla, Votación, Inicio y admin/ (secciones del panel)
  styles/        Estilos por superficie
server/
  engine.js      Motor de la radio (máquina de estados)
  api.js         Rutas HTTP de /api
  db.js          Esquema SQLite y acceso a datos
  validate.js    Validación de todo lo que llega del panel
  services.js    Open-Meteo, Gemini TTS, YouTube oEmbed
  auth.js        Sesiones y firmas HMAC
  seed.js        Datos de ejemplo
worker/index.js  Worker y Durable Object (WebSockets, alarmas)
test/            Pruebas con node:test (el motor se prueba con node:sqlite)
```

## Base de datos

SQLite dentro del Durable Object. Persiste aunque se recarguen las páginas o se reinicie el servicio.

| Tabla | Contenido |
| --- | --- |
| `songs` | Catálogo: id de YouTube, título, artista, duración, género, energía, ambientes, temáticas, restricciones, activa y número de fallas |
| `playlists` | Listas de reproducción (ids de canciones) |
| `rules` | Reglas contextuales: nombre, prioridad, exclusiva, condición (JSON) y efecto (JSON) |
| `events` | Festividades, exámenes y eventos: tipo, temática, fechas |
| `announcements` | Anuncios: texto, aprobación, prioridad, vigencia, días, franja horaria, frecuencia y voz |
| `announcement_audio` | Audio WAV generado de cada anuncio, con hash del texto para regenerarlo si cambia |
| `rounds` | Rondas: opciones, apertura, cierre, conteo, ganadora, resolución y motivo de la selección |
| `votes` | Un voto por votante y ronda (clave primaria `round_id, voter`), con hash de IP |
| `plays` | Historial de reproducción: canciones y anuncios, origen y estado (completa, saltada, error) |
| `audit` | Bitácora de acciones de administración y fallas |
| `kv` | Configuración general, estado de la programación, caché del clima y secretos generados |

## Seguridad

- El panel y sus WebSockets requieren sesión: contraseña en el secreto `ADMIN_PASSWORD`, cookie `HttpOnly`, `Secure` y `SameSite=Strict` firmada con HMAC, que vence a las 12 horas. Tras 5 intentos fallidos, la IP espera 10 minutos.
- Las escrituras desde otro origen se rechazan (protección CSRF).
- Cualquier `/pantalla` puede tomar el audio con un clic; solo una lo reproduce a la vez (la última que lo pide).
- **Votos repetidos.** Cada dispositivo recibe una cookie firmada y la base solo acepta un voto por dispositivo y ronda. Además, hay un límite opcional de votos por red. En el wifi del campus muchas personas comparten IP, así que viene desactivado. Borrar cookies permite volver a votar; es el límite práctico de una votación sin cuentas.
- Todo lo que llega del panel se valida en el servidor. Las claves solo existen en el servidor.

## Manejo de fallas

| Situación | Qué pasa |
| --- | --- |
| Un video no se puede reproducir (borrado, bloqueado para embeber) | Se salta, se registra la falla en la canción y se avisa en el panel y la pantalla |
| Varias fallas seguidas (4) | La programación se pausa sola y el panel lo explica; se reanuda con un clic |
| La pantalla pierde la conexión | Indicador "Reconectando…"; al volver, se resincroniza y recupera el audio |
| No hay pantalla reproductora | La programación sigue por reloj del servidor; panel y pantalla lo indican |
| Open-Meteo no responde | Se usa la última lectura de la hora anterior; si no hay, se aplica la lista de respaldo (o se ignoran las reglas de temperatura, según la configuración) |
| Sin clave o sin cuota de Gemini | Los anuncios se leen con la voz del navegador |
| El navegador bloquea el audio | Botón visible para reanudarlo |
| Configuración dañada | Panel → Configuración → **Restaurar desde archivo** con el último respaldo, o **Restablecer datos de ejemplo** |

**Respaldos.** En Configuración, **Descargar respaldo** exporta catálogo, listas, reglas, eventos, anuncios y configuración en JSON. Conviene descargarlo antes de cada cambio grande. Restaurar no borra el historial de votos.

## Servicios, costos y límites

| Servicio | Para qué | Cuenta | Costo |
| --- | --- | --- | --- |
| Cloudflare Workers + Durable Objects | Alojamiento HTTPS, API, tiempo real, base de datos | Cuenta gratuita de Cloudflare | Gratis en el plan Free. Plan Paid: 5 USD/mes. |
| YouTube (IFrame Player API) | Reproducción de música por streaming | No requiere clave | Gratis |
| Open-Meteo | Temperatura local y buscador de ciudades | No requiere clave | Gratis para uso no comercial |
| Gemini (Google AI Studio) | Voz de los anuncios y etiquetas sugeridas de canciones | Cuenta de Google y clave de API | Nivel gratuito disponible. En el de pago, un anuncio de 20 s cuesta menos de 0.01 USD, y cada audio se genera una sola vez. |
| GitHub | Repositorio | Cuenta gratuita | Gratis |

**Límites del plan Free de Cloudflare** (al momento de escribir; consulta la [página de precios](https://developers.cloudflare.com/durable-objects/platform/pricing/)): 100 000 peticiones al día, 100 000 filas escritas en SQLite al día y 5 GB de almacenamiento. Los archivos estáticos no cuentan. Cada voto, conexión y transición usa unas pocas peticiones o escrituras; los mensajes WebSocket entrantes cuentan 20 a 1. Un campus con algunos cientos de votos por hora queda muy por debajo. Si se acercara al límite, el plan Paid (5 USD/mes) lo multiplica.

**Cuota de Gemini.** El nivel gratuito tiene límites por minuto y por día. Si se agotan, la vista previa y los anuncios nuevos usan la voz del navegador hasta que se renueve.

### Sobre YouTube y las licencias musicales

Se eligió YouTube porque es el único proveedor con integración oficial que permite reproducir canciones completas sin que cada oyente tenga una cuenta de pago. Spotify, por ejemplo, exige Premium para su reproductor web, y otros servicios solo ofrecen fragmentos de 30 segundos. El sistema respeta las condiciones de la API de YouTube: el reproductor oficial queda **visible** en la pantalla, no se descarga ni se extrae el audio y no se ocultan los anuncios del propio YouTube.

Ninguna plataforma de streaming otorga, por sí sola, el permiso de **ejecución pública** de la música en un espacio abierto. Antes de operar en el campus, la institución debe confirmar que tiene las licencias correspondientes (en México, por ejemplo, ante la SACM) o limitar el catálogo a música con licencia que lo permita.

## Pruebas

```bash
npm test
```

Cubren las reglas contextuales (exámenes sobre Navidad, mañana/mediodía, respaldo por falta de candidatas o de clima, temporada), la resolución de rondas y desempates, el voto único, el cierre por reloj del servidor, la pausa, las fallas de reproducción, la programación de anuncios, la persistencia tras un reinicio, la API con sesión y CSRF, y las respuestas de YouTube y Gemini (simuladas).

## Mantenimiento

- **Agregar canciones.** Panel → Canciones → Agregar y pega el enlace de YouTube. Sin pulsar nada más, el sistema comprueba que el video permita reproducción embebida y que no esté repetido; llena título, artista y duración, y la IA sugiere género, energía, ambiente, temática y restricciones. Revisa las sugerencias antes de guardar: lo que cambies a mano no se sobrescribe. Sin clave de Gemini, las etiquetas se llenan a mano. Revisa periódicamente las canciones con fallas.
- **Cambiar reglas.** Usa el simulador antes de guardar para ver el efecto.
- **Calendario.** Registra cada semestre las fechas de exámenes y festividades.
- **Actualizar dependencias.** `npm outdated` y luego `npm update`. Corre `npm test` antes de publicar.
- **Logs.** En el panel de Cloudflare: Workers → radio-campus → Logs (observabilidad activada en `wrangler.jsonc`).
