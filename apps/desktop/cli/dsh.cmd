@echo off
setlocal DisableDelayedExpansion
set "ELECTRON_RUN_AS_NODE=1"
rem Peto: Peto Agent keeps its own Harness home unless DSH_HOME names another.
if not defined DSH_HOME set "DSH_HOME=%USERPROFILE%\.peto-agent"
"%~dp0..\..\..\..\Peto Agent.exe" --expose-internals "%~dp0..\..\..\app.asar\dsh\node_modules\@deepseek-ai\dsh-desktop-host\lib\cli.js" %*
exit /b %errorlevel%
