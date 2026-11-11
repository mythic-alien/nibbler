@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>&1
if %errorlevel%==0 (
  start "Nibbler local server" cmd /k "py -3 -m http.server 8765 --bind 127.0.0.1"
) else (
  start "Nibbler local server" cmd /k "python -m http.server 8765 --bind 127.0.0.1"
)
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8765/"
echo Nibbler is running at http://127.0.0.1:8765/
echo Close the server window to stop it.
endlocal
