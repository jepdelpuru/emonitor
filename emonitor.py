import os
import sys
import time
import threading
import sqlite3
import json
from flask import Flask, jsonify, render_template, request, send_from_directory
from harscript import procesar_averias
from datetime import datetime

app = Flask(__name__)

# --- VAPID CONFIG ---
VAPID_KEYS_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.vapid_keys.json')

def load_vapid_public_key():
    try:
        with open(VAPID_KEYS_PATH, 'r') as f:
            return json.load(f).get('public_key', '')
    except FileNotFoundError:
        return ''

# --- BACKGROUND SCRAPER (con file lock para evitar duplicados) ---
LOCK_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.scraper.lock')

def start_background_scraper():
    """Lanza el scraper en un hilo. Usa file lock para garantizar que
    solo UN proceso en todo el sistema ejecute el scraper, sin importar
    cuántas instancias de Flask haya (dev reloader, gunicorn workers, etc.)."""

    def scraper_loop():
        lock_file = None
        try:
            lock_file = open(LOCK_PATH, 'w')
            if sys.platform == 'win32':
                import msvcrt
                msvcrt.locking(lock_file.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(lock_file, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except (IOError, OSError):
            print("[INFO] Otro proceso ya ejecuta el scraper. Este proceso NO lo lanzará.")
            if lock_file:
                lock_file.close()
            return

        print(f"[INFO] Scraper iniciado (PID {os.getpid()})")

        try:
            while True:
                try:
                    print("[INFO] Ejecutando búsqueda automática de averías nuevas...")
                    procesar_averias()
                except Exception as e:
                    print(f"[ERROR] Falló el scraper automático: {e}")
                time.sleep(300)  # 5 minutos
        finally:
            lock_file.close()

    thread = threading.Thread(target=scraper_loop, daemon=True)
    thread.start()

start_background_scraper()
DB_PATH = 'averias_historico.db'

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn

# Cache buster - changes every restart to force browsers to fetch fresh files
BOOT_TIME = int(time.time())

@app.route('/')
def index():
    return render_template('index.html', v=BOOT_TIME)

@app.route('/api/averias', methods=['GET'])
def api_averias():
    municipio = request.args.get('municipio')
    territorio = request.args.get('territorio')

    historico = request.args.get('historico')

    conn = get_db_connection()
    query = 'SELECT * FROM averias WHERE 1=1'
    params = []

    # Por defecto solo activas; ?historico=1 para ver todo
    if not historico:
        query += ' AND activa = 1'

    if municipio:
        query += ' AND municipio LIKE ?'
        params.append(f'%{municipio}%')
    if territorio:
        query += ' AND territorio LIKE ?'
        params.append(f'%{territorio}%')

    query += ' ORDER BY fecha_captura DESC'

    averias = conn.execute(query, params).fetchall()
    conn.close()

    result = [dict(row) for row in averias]
    return jsonify(result)

@app.route('/api/stats', methods=['GET'])
def api_stats():
    territorio = request.args.get('territorio')
    conn = get_db_connection()

    if territorio:
        stats_territorio = conn.execute('''
            SELECT territorio, COUNT(*) as total
            FROM averias
            WHERE activa = 1 AND territorio LIKE ?
            GROUP BY territorio
            ORDER BY total DESC
        ''', (f'%{territorio}%',)).fetchall()

        stats_municipio = conn.execute('''
            SELECT municipio, COUNT(*) as total
            FROM averias
            WHERE activa = 1 AND territorio LIKE ?
            GROUP BY municipio
            ORDER BY total DESC
            LIMIT 100
        ''', (f'%{territorio}%',)).fetchall()
    else:
        stats_territorio = conn.execute('''
            SELECT territorio, COUNT(*) as total
            FROM averias
            WHERE activa = 1
            GROUP BY territorio
            ORDER BY total DESC
        ''').fetchall()

        stats_municipio = conn.execute('''
            SELECT municipio, COUNT(*) as total
            FROM averias
            WHERE activa = 1
            GROUP BY municipio
            ORDER BY total DESC
            LIMIT 100
        ''').fetchall()

    conn.close()

    return jsonify({
        "territorios": [dict(row) for row in stats_territorio],
        "municipios": [dict(row) for row in stats_municipio]
    })

@app.route('/api/territorios', methods=['GET'])
def api_territorios():
    conn = get_db_connection()
    territorios = conn.execute('''
        SELECT DISTINCT territorio
        FROM averias
        WHERE activa = 1 AND territorio IS NOT NULL AND territorio != ''
        ORDER BY territorio ASC
    ''').fetchall()
    conn.close()

    return jsonify([row['territorio'] for row in territorios])

@app.route('/api/municipios', methods=['GET'])
def api_municipios():
    conn = get_db_connection()
    municipios = conn.execute('''
        SELECT DISTINCT municipio
        FROM averias
        WHERE municipio IS NOT NULL AND municipio != ''
        ORDER BY municipio ASC
    ''').fetchall()
    conn.close()
    return jsonify([row['municipio'] for row in municipios])

# --- PUSH NOTIFICATION ENDPOINTS ---

@app.route('/api/push/vapid-public-key', methods=['GET'])
def api_vapid_public_key():
    public_key = load_vapid_public_key()
    if not public_key:
        return jsonify({"error": "VAPID keys not configured"}), 500
    return jsonify({"publicKey": public_key})

@app.route('/api/push/subscribe', methods=['POST'])
def api_push_subscribe():
    data = request.get_json()
    if not data:
        return jsonify({"error": "JSON body required"}), 400

    subscription = data.get('subscription')
    municipios = data.get('municipios', [])

    if not subscription or not subscription.get('endpoint'):
        return jsonify({"error": "subscription.endpoint required"}), 400

    keys = subscription.get('keys', {})
    if not keys.get('p256dh') or not keys.get('auth'):
        return jsonify({"error": "subscription.keys (p256dh, auth) required"}), 400

    if not municipios or not isinstance(municipios, list):
        return jsonify({"error": "municipios list required"}), 400

    conn = get_db_connection()

    # Upsert suscripción
    conn.execute('''
        INSERT INTO push_subscriptions (endpoint, p256dh, auth)
        VALUES (?, ?, ?)
        ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth
    ''', (subscription['endpoint'], keys['p256dh'], keys['auth']))

    # Obtener ID de la suscripción
    row = conn.execute('SELECT id FROM push_subscriptions WHERE endpoint=?',
                        (subscription['endpoint'],)).fetchone()
    sub_id = row['id']

    # Reemplazar municipios
    conn.execute('DELETE FROM subscription_municipios WHERE subscription_id=?', (sub_id,))
    for mun in municipios:
        conn.execute('INSERT OR IGNORE INTO subscription_municipios (subscription_id, municipio) VALUES (?,?)',
                      (sub_id, mun))

    conn.commit()
    conn.close()
    return jsonify({"ok": True, "subscription_id": sub_id})

@app.route('/api/push/history', methods=['GET'])
def api_push_history():
    endpoint = request.args.get('endpoint')
    conn = get_db_connection()

    if endpoint:
        rows = conn.execute('''
            SELECT nl.sent_at, a.id, a.municipio, a.territorio,
                   a.clientes_afectados, a.causa, a.inicio, a.fin_previsto,
                   a.referencia, a.nota, a.latitud, a.longitud
            FROM notification_log nl
            JOIN push_subscriptions ps ON nl.subscription_id = ps.id
            JOIN averias a ON nl.averia_objectid = a.id
            WHERE ps.endpoint = ?
            ORDER BY nl.sent_at DESC
            LIMIT 100
        ''', (endpoint,)).fetchall()
    else:
        rows = conn.execute('''
            SELECT nl.sent_at, a.id, a.municipio, a.territorio,
                   a.clientes_afectados, a.causa, a.inicio, a.fin_previsto,
                   a.referencia, a.nota, a.latitud, a.longitud
            FROM notification_log nl
            JOIN averias a ON nl.averia_objectid = a.id
            ORDER BY nl.sent_at DESC
            LIMIT 100
        ''').fetchall()

    conn.close()
    return jsonify([dict(row) for row in rows])

@app.route('/api/push/unsubscribe', methods=['POST'])
def api_push_unsubscribe():
    data = request.get_json()
    if not data or not data.get('endpoint'):
        return jsonify({"error": "endpoint required"}), 400

    conn = get_db_connection()
    conn.execute('DELETE FROM push_subscriptions WHERE endpoint=?', (data['endpoint'],))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})

@app.route('/manifest.json')
def serve_manifest():
    return send_from_directory('static', 'manifest.json', mimetype='application/manifest+json')

@app.route('/sw.js')
def serve_sw():
    return send_from_directory('static', 'sw.js', mimetype='application/javascript')

if __name__ == '__main__':
    app.run(host='0.0.0.0', debug=True, port=5006)
