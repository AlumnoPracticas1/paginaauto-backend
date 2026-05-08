@echo off
chcp 65001 >nul
title Avisos personalizados
node "%~dp0avisos-cli.js" %*
