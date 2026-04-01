import requests
import sqlite3
import json
import os
from datetime import datetime

# --- CONFIGURACIÓN ---
URL_API = "https://ineuportalgis.enel.com/server/rest/services/Hosted/ESP_Prod_power_cut_View/FeatureServer/0/query"
DB_PATH = "averias_historico.db"

PARAMS = {
    "f": "json",
    "where": "1=1",
    "returnGeometry": "true",
    "outFields": "*",
    "outSR": "4326"
}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Referer": "https://ineuportalgis.enel.com/",
    "Accept": "*/*"
}

# --- VAPID CONFIG (cargada una sola vez) ---
VAPID_KEYS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.vapid_keys.json')
VAPID_CONFIG = None

def load_vapid_config():
    global VAPID_CONFIG
    if VAPID_CONFIG is not None:
        return VAPID_CONFIG
    try:
        with open(VAPID_KEYS_PATH, 'r') as f:
            VAPID_CONFIG = json.load(f)
    except FileNotFoundError:
        print("[WARN] No se encontró .vapid_keys.json - Las notificaciones push no funcionarán.")
        print("[WARN] Ejecuta: python generate_vapid.py")
        VAPID_CONFIG = None
    return VAPID_CONFIG


def inicializar_db():
    conexion = sqlite3.connect(DB_PATH)
    conexion.execute("PRAGMA foreign_keys = ON")
    cursor = conexion.cursor()

    # Comprobar si necesitamos migrar el esquema antiguo
    tabla_existe = cursor.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='averias'"
    ).fetchone()

    if tabla_existe:
        cols = [row[1] for row in cursor.execute("PRAGMA table_info(averias)").fetchall()]
        if 'activa' not in cols:
            _migrar_esquema(conexion)
    else:
        _crear_tablas(conexion)

    return conexion


def _crear_tablas(conexion):
    cursor = conexion.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS averias (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            referencia TEXT UNIQUE,
            objectid INTEGER,
            municipio TEXT,
            territorio TEXT,
            clientes_afectados INTEGER,
            causa TEXT,
            inicio TEXT,
            fin_previsto TEXT,
            latitud REAL,
            longitud REAL,
            fecha_captura TEXT,
            fecha_actualizacion TEXT,
            nota TEXT,
            actualizacion TEXT,
            activa INTEGER DEFAULT 1
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            endpoint TEXT UNIQUE NOT NULL,
            p256dh TEXT NOT NULL,
            auth TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS subscription_municipios (
            subscription_id INTEGER NOT NULL,
            municipio TEXT NOT NULL,
            PRIMARY KEY (subscription_id, municipio),
            FOREIGN KEY (subscription_id) REFERENCES push_subscriptions(id) ON DELETE CASCADE
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS notification_log (
            subscription_id INTEGER NOT NULL,
            averia_objectid INTEGER NOT NULL,
            sent_at TEXT DEFAULT (datetime('now')),
            UNIQUE(subscription_id, averia_objectid)
        )
    ''')
    conexion.commit()


def _migrar_esquema(conexion):
    """Migra el esquema antiguo (objectid como PK, sin campo activa)
    al nuevo (referencia como UNIQUE, campo activa)."""
    print("[INFO] Migrando base de datos al nuevo esquema...")
    cursor = conexion.cursor()

    # 1. Renombrar tabla actual
    cursor.execute("ALTER TABLE averias RENAME TO averias_old")

    # 2. Crear tabla nueva
    cursor.execute('''
        CREATE TABLE averias (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            referencia TEXT UNIQUE,
            objectid INTEGER,
            municipio TEXT,
            territorio TEXT,
            clientes_afectados INTEGER,
            causa TEXT,
            inicio TEXT,
            fin_previsto TEXT,
            latitud REAL,
            longitud REAL,
            fecha_captura TEXT,
            fecha_actualizacion TEXT,
            nota TEXT,
            actualizacion TEXT,
            activa INTEGER DEFAULT 0
        )
    ''')

    # 3. Migrar datos deduplicados (1 registro por referencia, el más reciente)
    cursor.execute('''
        INSERT OR IGNORE INTO averias
            (referencia, objectid, municipio, territorio,
             clientes_afectados, causa, inicio, fin_previsto,
             latitud, longitud, fecha_captura, fecha_actualizacion,
             nota, actualizacion, activa)
        SELECT referencia, MAX(objectid), municipio, territorio,
               MAX(clientes_afectados), causa, inicio, fin_previsto,
               latitud, longitud, MIN(fecha_captura), MAX(fecha_captura),
               nota, actualizacion, 0
        FROM averias_old
        WHERE referencia IS NOT NULL AND referencia != ''
        GROUP BY referencia
    ''')

    registros_antes = cursor.execute("SELECT COUNT(*) FROM averias_old").fetchone()[0]
    registros_despues = cursor.execute("SELECT COUNT(*) FROM averias").fetchone()[0]

    # 4. Eliminar tabla antigua
    cursor.execute("DROP TABLE averias_old")

    # 5. Crear las demás tablas si no existen
    _crear_tablas_push(cursor)

    conexion.commit()
    print(f"[INFO] Migracion completada: {registros_antes} -> {registros_despues} registros unicos.")


def _crear_tablas_push(cursor):
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            endpoint TEXT UNIQUE NOT NULL,
            p256dh TEXT NOT NULL,
            auth TEXT NOT NULL,
            created_at TEXT DEFAULT (datetime('now'))
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS subscription_municipios (
            subscription_id INTEGER NOT NULL,
            municipio TEXT NOT NULL,
            PRIMARY KEY (subscription_id, municipio),
            FOREIGN KEY (subscription_id) REFERENCES push_subscriptions(id) ON DELETE CASCADE
        )
    ''')
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS notification_log (
            subscription_id INTEGER NOT NULL,
            averia_objectid INTEGER NOT NULL,
            sent_at TEXT DEFAULT (datetime('now')),
            UNIQUE(subscription_id, averia_objectid)
        )
    ''')


def obtener_datos():
    try:
        respuesta = requests.get(URL_API, params=PARAMS, headers=HEADERS, timeout=15)
        respuesta.raise_for_status()
        return respuesta.json().get("features", [])
    except Exception as e:
        print(f"Error al conectar con la API: {e}")
        return []


def enviar_notificaciones(averias_nuevas):
    """Envía notificaciones push a los suscriptores de los municipios afectados."""
    if not averias_nuevas:
        return

    config = load_vapid_config()
    if not config:
        return

    try:
        from pywebpush import webpush, WebPushException
    except ImportError:
        print("[WARN] pywebpush no instalado. No se enviarán notificaciones.")
        return

    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")

    # Limpiar log de notificaciones antiguas (> 7 días)
    conn.execute("DELETE FROM notification_log WHERE sent_at < datetime('now', '-7 days')")

    # Agrupar averias nuevas por municipio
    por_municipio = {}
    for averia in averias_nuevas:
        mun = averia['municipio']
        if mun not in por_municipio:
            por_municipio[mun] = []
        por_municipio[mun].append(averia)

    municipios_nuevos = list(por_municipio.keys())
    if not municipios_nuevos:
        conn.close()
        return

    # Buscar suscripciones que vigilan estos municipios
    placeholders = ','.join('?' * len(municipios_nuevos))
    subs = conn.execute(f'''
        SELECT ps.id, ps.endpoint, ps.p256dh, ps.auth, sm.municipio
        FROM push_subscriptions ps
        JOIN subscription_municipios sm ON ps.id = sm.subscription_id
        WHERE sm.municipio IN ({placeholders})
    ''', municipios_nuevos).fetchall()

    if not subs:
        conn.close()
        return

    # Obtener el id de la averia en la BD (para notification_log)
    ref_to_id = {}
    for averia in averias_nuevas:
        row = conn.execute('SELECT id FROM averias WHERE referencia=?', (averia['referencia'],)).fetchone()
        if row:
            ref_to_id[averia['referencia']] = row['id']

    subs_a_eliminar = set()
    enviadas = 0

    for sub in subs:
        municipio = sub['municipio']
        averias_mun = por_municipio.get(municipio, [])
        if not averias_mun:
            continue

        # Filtrar las que ya se notificaron
        sin_notificar = []
        for av in averias_mun:
            averia_id = ref_to_id.get(av['referencia'])
            if not averia_id:
                continue
            ya = conn.execute(
                'SELECT 1 FROM notification_log WHERE subscription_id=? AND averia_objectid=?',
                (sub['id'], averia_id)
            ).fetchone()
            if not ya:
                av['_db_id'] = averia_id
                sin_notificar.append(av)

        if not sin_notificar:
            continue

        # Construir payload agrupado
        total_afectados = sum(a.get('clientes_afectados') or 0 for a in sin_notificar)
        if len(sin_notificar) == 1:
            av = sin_notificar[0]
            title = f"Nueva avería en {municipio}"
            body = f"{av.get('clientes_afectados') or '?'} afectados · {av.get('causa') or 'Causa desconocida'}"
        else:
            title = f"{len(sin_notificar)} averías en {municipio}"
            body = f"{total_afectados} clientes afectados en total"

        payload = json.dumps({
            'title': title,
            'body': body,
            'data': {
                'municipio': municipio,
                'objectid': sin_notificar[0].get('_db_id')
            }
        })

        try:
            webpush(
                subscription_info={
                    "endpoint": sub['endpoint'],
                    "keys": {"p256dh": sub['p256dh'], "auth": sub['auth']}
                },
                data=payload,
                vapid_private_key=os.path.join(os.path.dirname(VAPID_KEYS_PATH), '.vapid_private.pem'),
                vapid_claims={"sub": config['claims_email']}
            )
            # Registrar en log
            for av in sin_notificar:
                conn.execute(
                    'INSERT OR IGNORE INTO notification_log (subscription_id, averia_objectid) VALUES (?,?)',
                    (sub['id'], av['_db_id'])
                )
            enviadas += 1
        except WebPushException as e:
            if e.response is not None and e.response.status_code in (404, 410):
                subs_a_eliminar.add(sub['id'])
            else:
                print(f"[PUSH ERROR] {e}")
        except Exception as e:
            print(f"[PUSH ERROR] {e}")

    # Eliminar suscripciones expiradas
    for sub_id in subs_a_eliminar:
        conn.execute('DELETE FROM push_subscriptions WHERE id=?', (sub_id,))

    conn.commit()
    conn.close()

    if enviadas > 0:
        print(f"[PUSH] {enviadas} notificaciones enviadas.")
    if subs_a_eliminar:
        print(f"[PUSH] {len(subs_a_eliminar)} suscripciones expiradas eliminadas.")


def procesar_averias():
    conexion = inicializar_db()
    cursor = conexion.cursor()
    averias_api = obtener_datos()

    if not averias_api:
        # Si la API falla o no devuelve nada, no marcar nada como resuelta
        conexion.close()
        print("Proceso completado. 0 averías desde la API (posible error de red).")
        return

    ahora = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    refs_api = set()
    nuevas = 0
    averias_nuevas = []

    for item in averias_api:
        attr = item.get("attributes", {})
        geom = item.get("geometry", {})
        ref = attr.get("cd_code")
        if not ref:
            continue

        refs_api.add(ref)
        municipio = attr.get("municipality", "Desconocido")

        # Comprobar si esta referencia ya existe (para saber si es nueva)
        existente = cursor.execute(
            'SELECT id FROM averias WHERE referencia = ?', (ref,)
        ).fetchone()

        # UPSERT: insertar si es nueva, actualizar si ya existe
        cursor.execute('''
            INSERT INTO averias
                (referencia, objectid, municipio, territorio,
                 clientes_afectados, causa, inicio, fin_previsto,
                 latitud, longitud, fecha_captura, fecha_actualizacion,
                 nota, actualizacion, activa)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
            ON CONFLICT(referencia) DO UPDATE SET
                objectid = excluded.objectid,
                clientes_afectados = excluded.clientes_afectados,
                fin_previsto = excluded.fin_previsto,
                fecha_actualizacion = excluded.fecha_actualizacion,
                nota = excluded.nota,
                actualizacion = excluded.actualizacion,
                activa = 1
        ''', (
            ref,
            attr.get("objectid1"),
            municipio,
            attr.get("territory"),
            attr.get("affected_client"),
            attr.get("service_des_es"),
            attr.get("interruption_date"),
            attr.get("reposition_date"),
            geom.get("y"),
            geom.get("x"),
            ahora,
            ahora,
            attr.get("note"),
            attr.get("update_time")
        ))

        # Es nueva si no existía antes del UPSERT
        if existente is None:
            nuevas += 1
            averias_nuevas.append({
                'referencia': ref,
                'municipio': municipio,
                'territorio': attr.get("territory"),
                'clientes_afectados': attr.get("affected_client"),
                'causa': attr.get("service_des_es"),
            })

    # Marcar como resueltas las que ya no están en la API
    if refs_api:
        placeholders = ','.join('?' * len(refs_api))
        resueltas = cursor.execute(f'''
            UPDATE averias SET activa = 0
            WHERE activa = 1 AND referencia NOT IN ({placeholders})
        ''', list(refs_api))
        if resueltas.rowcount > 0:
            print(f"[INFO] {resueltas.rowcount} averías marcadas como resueltas.")

    conexion.commit()
    conexion.close()

    total_activas = len(refs_api)
    print(f"Proceso completado. {total_activas} averías activas en España. {nuevas} nuevas.")

    # Enviar notificaciones push para las averías genuinamente nuevas
    if averias_nuevas:
        try:
            enviar_notificaciones(averias_nuevas)
        except Exception as e:
            print(f"[ERROR] Fallo al enviar notificaciones: {e}")


if __name__ == "__main__":
    procesar_averias()
