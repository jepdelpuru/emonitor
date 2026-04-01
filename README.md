# E-Monitor Live

**Monitor en tiempo real de averias electricas en Espana**

Dashboard interactivo que rastrea cortes electricos de la red de distribucion, los muestra en un mapa y te avisa con notificaciones push cuando hay una nueva averia en tu zona.

---

## Que hace

- **Mapa interactivo** con todas las averias electricas activas en Espana, agrupadas por clusters
- **Scraping automatico** cada 5 minutos de la API publica de e-distribucion (Enel)
- **Notificaciones push** configurables por municipio: recibe alertas cuando hay un corte en tu zona
- **Filtros por territorio** (comunidad autonoma / provincia) y busqueda por poblacion
- **Estadisticas en vivo** de averias por zona y municipio
- **Historial completo** de incidencias pasadas
- **PWA instalable** en movil como app nativa
- **Tema claro/oscuro** con persistencia

---

## Capturas

### Vista principal - Mapa con averias activas
```
+-------------------------------------------------------+
|  E-Monitor Live                    [Toda Espana v] [Q] |
|  Code by Kikoso                                        |
|-------------------------------------------------------|
|                                                        |
|           * Mapa interactivo (Leaflet)                 |
|        con marcadores rojos (activas)                  |
|        y naranjas (historicas)                          |
|        agrupados en clusters                           |
|                                                        |
|-------------------------------------------------------|
| Comunidades    |  Historial              [142 eventos] |
| Andalucia  45  |  [Sevilla]         Activo             |
| Catalunya  23  |  850 afectados - Averia MT             |
| Madrid     18  |  Inicio: 01/04/2026 08:30             |
|                |                                        |
| Poblaciones    |  [Malaga]          Activo              |
| Sevilla    12  |  1200 afectados - Averia BT            |
| Malaga      8  |  Inicio: 01/04/2026 09:15             |
+-------------------------------------------------------+
```

### Notificaciones push
```
+----------------------------------+
|  Alertas de Averias              |
|  [Configurar]  [Historial]      |
|                                  |
|  Alertas activas para 3 pobl.   |
|                                  |
|  [x] Sevilla                    |
|  [x] Malaga                     |
|  [x] Granada                    |
|  --- Todas las poblaciones ---  |
|  [ ] Cordoba                    |
|  [ ] Cadiz                      |
|                                  |
|  3 poblaciones    [Guardar]     |
+----------------------------------+
```

### Notificacion en el movil
```
+----------------------------------+
|  E-Monitor Live                  |
|  Nueva averia en Sevilla         |
|  850 afectados - Averia MT       |
+----------------------------------+
```

---

## Stack tecnico

| Componente | Tecnologia |
|---|---|
| Backend | Flask (Python) |
| Base de datos | SQLite |
| Frontend | HTML5, CSS3, JavaScript vanilla |
| Mapa | Leaflet + MarkerCluster |
| Push notifications | Web Push (VAPID) + pywebpush |
| PWA | Service Worker + manifest.json |
| Fuente de datos | API publica de e-distribucion (Enel) |

---

## Instalacion

### 1. Clonar el repositorio

```bash
git clone https://github.com/jepdelpuru/emonitor.git
cd emonitor
```

### 2. Instalar dependencias

```bash
pip install -r requirements.txt
```

### 3. Generar claves VAPID (para notificaciones push)

```bash
python generate_vapid.py
```

Esto crea `.vapid_keys.json` y `.vapid_private.pem` en el directorio del proyecto.

### 4. Ejecutar

```bash
python emonitor.py
```

La app estara disponible en `http://localhost:5006`

---

## API Endpoints

| Metodo | Ruta | Descripcion |
|---|---|---|
| `GET` | `/api/averias` | Lista averias activas. Params: `municipio`, `territorio`, `historico=1` |
| `GET` | `/api/stats` | Estadisticas agrupadas por territorio y municipio |
| `GET` | `/api/territorios` | Lista de territorios con averias activas |
| `GET` | `/api/municipios` | Lista de todos los municipios registrados |
| `POST` | `/api/push/subscribe` | Suscribirse a notificaciones push para municipios |
| `POST` | `/api/push/unsubscribe` | Cancelar suscripcion push |
| `GET` | `/api/push/history` | Historial de notificaciones enviadas |

### Ejemplo: obtener averias activas en Andalucia

```bash
curl "http://localhost:5006/api/averias?territorio=Andalucia"
```

```json
[
  {
    "id": 1,
    "referencia": "ESP-2026-001234",
    "municipio": "Sevilla",
    "territorio": "Andalucia",
    "clientes_afectados": 850,
    "causa": "Averia en MT",
    "inicio": "01/04/2026 08:30",
    "fin_previsto": "01/04/2026 12:00",
    "latitud": 37.3891,
    "longitud": -5.9845,
    "activa": 1
  }
]
```

### Ejemplo: estadisticas por zona

```bash
curl "http://localhost:5006/api/stats"
```

```json
{
  "territorios": [
    { "territorio": "Andalucia", "total": 45 },
    { "territorio": "Catalunya", "total": 23 }
  ],
  "municipios": [
    { "municipio": "Sevilla", "total": 12 },
    { "municipio": "Malaga", "total": 8 }
  ]
}
```

---

## Como funciona

```
                    +---------------------+
                    |  API e-distribucion  |
                    |   (datos publicos)   |
                    +---------+-----------+
                              |
                         cada 5 min
                              |
                    +---------v-----------+
                    |    harscript.py      |
                    |  (scraper + upsert) |
                    +---------+-----------+
                              |
                    +---------v-----------+
                    |   SQLite (averias)   |
                    |  push_subscriptions  |
                    |  notification_log    |
                    +---------+-----------+
                              |
                    +---------v-----------+
                    |     Flask API        |
                    |    emonitor.py       |
                    +---------+-----------+
                              |
               +--------------+--------------+
               |                             |
     +---------v---------+       +-----------v---------+
     |   Web Dashboard   |       |  Push Notifications |
     |  Mapa + Paneles   |       |  (VAPID / webpush)  |
     +-------------------+       +---------------------+
```

1. **Scraper** (`harscript.py`) consulta la API de e-distribucion cada 5 minutos
2. Inserta averias nuevas y marca como resueltas las que desaparecen de la API
3. Si hay averias nuevas, envia **notificaciones push** a los suscriptores de esos municipios
4. El **dashboard** consulta la API Flask y renderiza el mapa con Leaflet
5. El usuario puede filtrar por territorio, buscar poblaciones y configurar alertas

---

## Estructura del proyecto

```
emonitor/
  emonitor.py           # Servidor Flask + rutas API
  harscript.py          # Scraper de averias + notificaciones push
  generate_vapid.py     # Generador de claves VAPID
  requirements.txt      # Dependencias Python
  templates/
    index.html          # Frontend principal (PWA)
  static/
    css/style.css       # Estilos (glassmorphism, responsive)
    js/main.js          # Logica del dashboard, mapa, push
    sw.js               # Service Worker (PWA + push)
    manifest.json       # Manifiesto PWA
    icons/              # Iconos de la app (72px - 512px)
```

---

## Licencia

MIT

---

*Hecho con mass por [Kikoso](https://github.com/jepdelpuru)*
