@echo off
setlocal
cd /d "%~dp0"

rem Optional: pass a source folder as the first argument, otherwise the
rem script's built-in default (or COLLECTION_SRC) is used.
rem Usage:  sync-collection.cmd "D:\path\to\Obsidian\vault"

echo === Collection sync ===
echo.

node scripts\sync-collection.mjs %*

set "EXITCODE=%ERRORLEVEL%"
echo.
if "%EXITCODE%"=="0" (
  echo [OK] Collection sync finished successfully.
) else (
  echo [FAILED] Collection sync exited with code %EXITCODE%.
)

echo.
echo Press any key to close this window...
pause >nul
endlocal
