"""
Script de un solo uso para generar claves VAPID.
Ejecutar: python generate_vapid.py
Genera .vapid_keys.json (gitignored) con las claves necesarias para Web Push.
"""
import json
import base64
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization

# Generar par de claves ECDH sobre curva P-256 (requerida por Web Push)
private_key = ec.generate_private_key(ec.SECP256R1())

# Clave privada en formato PEM (para pywebpush)
private_pem = private_key.private_bytes(
    encoding=serialization.Encoding.PEM,
    format=serialization.PrivateFormat.PKCS8,
    encryption_algorithm=serialization.NoEncryption()
).decode('utf-8')

# Clave publica en formato sin comprimir (65 bytes) -> base64url (para el navegador)
public_numbers = private_key.public_key().public_numbers()
x = public_numbers.x.to_bytes(32, 'big')
y = public_numbers.y.to_bytes(32, 'big')
public_uncompressed = b'\x04' + x + y
public_key_b64 = base64.urlsafe_b64encode(public_uncompressed).rstrip(b'=').decode('utf-8')

# Clave privada raw (32 bytes) -> base64url (para pywebpush inline)
private_numbers = private_key.private_numbers()
private_raw = private_numbers.private_value.to_bytes(32, 'big')
private_key_b64 = base64.urlsafe_b64encode(private_raw).rstrip(b'=').decode('utf-8')

# Guardar fichero PEM (pywebpush tambien acepta rutas a ficheros PEM)
with open('.vapid_private.pem', 'w') as f:
    f.write(private_pem)

keys = {
    "public_key": public_key_b64,
    "private_key_pem": private_pem,
    "private_key_b64": private_key_b64,
    "private_key_file": ".vapid_private.pem",
    "claims_email": "mailto:admin@emonitor.local"
}

with open('.vapid_keys.json', 'w') as f:
    json.dump(keys, f, indent=2)

print("Claves VAPID generadas correctamente.")
print(f"Clave publica (applicationServerKey): {public_key_b64}")
print(f"Clave privada (base64url): {private_key_b64}")
print("Guardado en .vapid_keys.json y .vapid_private.pem")
