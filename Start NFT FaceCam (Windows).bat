@echo off
REM Opens NFT FaceCam in its own Chrome/Edge window, set up so it keeps running
REM smoothly while OBS captures it in the background.
setlocal
set "APPFILE=%~dp0index.html"
set "APPURL=file:///%APPFILE:\=/%"
set "PROFILE=%LOCALAPPDATA%\NFTFaceCam\BrowserProfile"
set "FLAGS=--user-data-dir="%PROFILE%" --no-first-run --disable-backgrounding-occluded-windows --disable-renderer-backgrounding --disable-background-timer-throttling"

set "B="
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "B=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not defined B if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "B=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
if not defined B if exist "%LocalAppData%\Google\Chrome\Application\chrome.exe" set "B=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not defined B if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "B=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not defined B if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "B=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"

if not defined B (
  echo Could not find Google Chrome or Microsoft Edge. Opening in your default browser instead.
  start "" "%APPFILE%"
  exit /b
)
start "" "%B%" %FLAGS% --app="%APPURL%"
