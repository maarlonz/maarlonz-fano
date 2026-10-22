@echo off
title Fano Insieme - sito pubblico
cd /d "%~dp0"
echo.
echo  Avvio il server di Fano Insieme...
start "Fano Insieme - server (non chiudere)" /min node server.js
timeout /t 2 >nul
echo.
echo  Ora creo il link pubblico. Cerca qui sotto la riga con  https://....trycloudflare.com
echo  e mandala ai tuoi amici. Il link cambia ogni volta che riavvii.
echo  Per spegnere il sito chiudi questa finestra e quella del server.
echo.
"X:\Tools\cloudflared\cloudflared.exe" tunnel --no-autoupdate --url http://localhost:8770
pause
