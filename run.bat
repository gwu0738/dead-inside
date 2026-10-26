@echo off
setlocal EnableDelayedExpansion
title Dead Links Scraper
cd /d "%~dp0"

:: ------------------------------------------------------------------ checks
where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo  Node.js is not installed or not on PATH. Get it from https://nodejs.org ^(LTS^) and run this again.
    echo.
    pause
    exit /b 1
)
if not exist "node_modules\axios" (
    echo  First run: installing dependencies ^(axios^)...
    call npm install --no-audit --no-fund
    if errorlevel 1 ( echo  npm install failed. & pause & exit /b 1 )
)

:menu
cls
echo  ==========================================================
echo       DEAD LINKS SCRAPER  -  CoinMarketCap / CoinGecko / DexScreener
echo  ==========================================================
echo.
echo   WHAT TO SCAN
echo.
echo   [1]  Quick check        CMC top 100  +  CoinGecko top 50          (~10 min)
echo   [2]  Dead-link hunt     CMC ranks 200-499  +  CoinGecko 200-299   (~35 min)  ^<- recommended
echo   [3]  Deep hunt          CMC ranks 500-1499 ^(no CoinGecko^)         (~60 min)
echo   [4]  Custom             choose your own ranks
echo   [5]  Re-validate        re-check the links from the last scan ^(no scraping^)
echo.
echo   OTHER
echo.
echo   [6]  Open the last report
echo   [7]  Install / update browser support ^(Playwright^) for screenshots
echo   [8]  Show all command-line options
echo   [0]  Exit
echo.
choice /C 123456780 /N /M "  Pick a number: "
set PICK=%errorlevel%
if %PICK%==9 exit /b 0
if %PICK%==1 ( set "SCAN=--cmc 100 --cmc-start 1 --cg 50 --cg-start 1" & set "NAME=quick" & goto browser )
if %PICK%==2 ( set "SCAN=--cmc 300 --cmc-start 200 --cg 100 --cg-start 200" & set "NAME=hunt_200-499" & goto browser )
if %PICK%==3 ( set "SCAN=--cmc 1000 --cmc-start 500 --cg 0" & set "NAME=deep_500-1499" & goto browser )
if %PICK%==4 goto custom
if %PICK%==5 goto revalidate
if %PICK%==6 goto openlast
if %PICK%==7 goto installpw
if %PICK%==8 ( node dead_links_scraper.js --help & echo. & pause & goto menu )
goto menu

:: ------------------------------------------------------------------ custom
:custom
cls
echo  CUSTOM SCAN  ^(press Enter to accept the value in brackets^)
echo.
set "CMC_N=300"
set "CMC_S=200"
set "CG_N=100"
set "CG_S=200"
set /p CMC_N="  CoinMarketCap: how many coins      [300] : "
set /p CMC_S="  CoinMarketCap: start at rank       [200] : "
set /p CG_N="  CoinGecko: how many coins (0=skip) [100] : "
set /p CG_S="  CoinGecko: start at rank           [200] : "
choice /C YN /N /M "  Include DexScreener latest/boosted tokens? [Y/N] : "
if errorlevel 2 ( set "DEX=--no-dex" ) else ( set "DEX=" )
set "SCAN=--cmc !CMC_N! --cmc-start !CMC_S! --cg !CG_N! --cg-start !CG_S! !DEX!"
set "NAME=custom_cmc!CMC_S!-!CG_S!"
goto browser

:: ------------------------------------------------------------------ revalidate
:revalidate
if not exist "last_output.txt" ( echo  No previous scan found. & pause & goto menu )
set /p LASTOUT=<last_output.txt
if not exist "!LASTOUT!\found_links.json" ( echo  Previous scan folder "!LASTOUT!" has no found_links.json. & pause & goto menu )
set "SCAN=--reuse-found"
set "NAME=revalidate"
set "REUSE_OUT=!LASTOUT!"
goto browser

:: ------------------------------------------------------------------ browser mode
:browser
cls
echo  BROWSER MODE  ^(screenshots + exact position of each dead link on the page^)
echo.
echo   [1]  None             fastest; placement estimated from site data, no screenshots
echo   [2]  Headless Chromium screenshots + measured placement; DexScreener pages stay blocked     ^<- default
echo   [3]  My Chrome        your installed Chrome, temporary profile, window visible ^(passes Cloudflare^)
echo   [4]  My Chrome + MY PROFILE   uses your cookies/logins. CLOSE CHROME COMPLETELY FIRST ^(also tray^)
echo   [5]  My Chrome + copy of my profile   Chrome can stay open ^(cookies may not carry over^)
echo   [6]  Microsoft Edge + MY PROFILE      close Edge first
echo.
choice /C 123456 /N /D 2 /T 30 /M "  Pick a number (auto-picks 2 in 30s): "
set B=%errorlevel%
set "BROWSER="
if %B%==2 set "BROWSER=--screenshots --headless"
if %B%==3 set "BROWSER=--chrome --screenshots"
if %B%==4 set "BROWSER=--chrome --chrome-profile default --screenshots"
if %B%==5 set "BROWSER=--chrome --chrome-profile default --chrome-profile-copy --screenshots"
if %B%==6 set "BROWSER=--edge --chrome-profile default --screenshots"
if %B% GEQ 2 (
    if not exist "node_modules\playwright" (
        echo.
        echo  Browser mode needs Playwright. Installing it now ^(one time, ~1 min^)...
        call npm install playwright --no-audit --no-fund
        if %B%==2 call npx playwright install chromium
    )
)
if %B%==4 (
    echo.
    echo  Reminder: Chrome must be fully closed or the profile cannot be opened. The script will say so if it is still running.
    pause
)
if %B%==6 (
    echo.
    echo  Reminder: Edge must be fully closed.
    pause
)

:: ------------------------------------------------------------------ run
for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd_HHmm"') do set "TS=%%i"
if defined REUSE_OUT ( set "OUT=!REUSE_OUT!" ) else ( set "OUT=output\!TS!_!NAME!" )
cls
echo  Running:
echo.
echo    node dead_links_scraper.js !SCAN! !BROWSER! --out "!OUT!"
echo.
echo  Output folder: !OUT!
echo  You can leave this window open and keep working. Press Ctrl+C to stop.
echo  ----------------------------------------------------------------
node dead_links_scraper.js !SCAN! !BROWSER! --out "!OUT!"
set RC=%errorlevel%
>last_output.txt echo !OUT!
echo.
echo  ----------------------------------------------------------------
if not %RC%==0 (
    echo  The scraper exited with an error ^(code %RC%^). Scroll up for details.
    pause
    goto menu
)
echo  Done.  CSV:    !OUT!\DEAD_LINKS.csv
echo         Report: !OUT!\report\index.html
echo.
choice /C YN /N /D Y /T 20 /M "  Open the HTML report now? [Y/N] (auto-yes in 20s): "
if errorlevel 2 goto afterrun
if exist "!OUT!\report\index.html" start "" "!OUT!\report\index.html"
:afterrun
set "REUSE_OUT="
echo.
choice /C MX /N /M "  [M] back to menu   [X] exit : "
if errorlevel 2 exit /b 0
goto menu

:: ------------------------------------------------------------------ open last
:openlast
if not exist "last_output.txt" ( echo  No previous scan found. & pause & goto menu )
set /p LASTOUT=<last_output.txt
if exist "!LASTOUT!\report\index.html" ( start "" "!LASTOUT!\report\index.html" ) else ( echo  Report not found in "!LASTOUT!". & pause )
goto menu

:: ------------------------------------------------------------------ playwright
:installpw
echo.
echo  Installing Playwright ^(browser automation^) and the bundled Chromium...
call npm install playwright --no-audit --no-fund
call npx playwright install chromium
echo.
echo  Done. Modes 3-6 use your installed Chrome/Edge and need nothing else.
pause
goto menu
