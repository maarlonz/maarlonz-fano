# Fano Insieme

Mappa di Fano (ristoranti, aperitivi, caffè, street food, gelaterie, luoghi storici e mare) con chat e incontri.
Registrazione solo con nickname: il server dà un token salvato nel browser che riserva il nickname su quel dispositivo.

## Avvio
    node server.js          # http://localhost:8770  (PORT=xxxx per cambiare porta)

Nessuna dipendenza npm. I dati utenti/chat/incontri stanno in `data/db.json`,
oppure su Upstash Redis se sono impostate `UPSTASH_REDIS_REST_URL` e `UPSTASH_REDIS_REST_TOKEN`
(così sopravvivono ai riavvii di Render; chiave `fano:db`).

## Metterlo online (dal PC)
Doppio clic su `AvviaFanoPubblico.bat`: avvia il server e un tunnel Cloudflare gratuito
(`X:\Tools\cloudflared\cloudflared.exe`). Il link `https://....trycloudflare.com` compare nella
finestra: è valido finché il PC resta acceso e cambia a ogni riavvio.
Il tunnel trattiene lo streaming (SSE), quindi il client passa da solo al long-polling (`/api/poll`).

## Aggiornare i locali
I locali vengono da OpenStreetMap (`data/osm.json`, query Overpass). Dopo aver riscaricato `osm.json`:
    python build_places.py
I luoghi storici con descrizione sono nella lista `STORIA` di `build_places.py`.
