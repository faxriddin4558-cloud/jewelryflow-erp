@echo off
title JewelryFlow Sales — Vercel Staging Sozlamalari
echo ==============================================================================
echo JEWELRYFLOW SALES — VERCEL STAGING LOYIHASI SOZLAMALARI
echo Loyiha: jewelryflow-sales-staging
echo Target Branch: feature/jewelryflow-sales-mvp
echo ==============================================================================
echo.
echo 1. Vercel CLI autentifikatsiyasini tekshirish...
call npx vercel whoami
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo [INFO] Vercel CLI ga login qilinmoqda. Brauzeringizda tasdiqlash oynasi ochiladi:
  call npx vercel login
)
echo.
echo 2. Loyihani faqat 'jewelryflow-sales-staging' bilan boglash:
call npx vercel link --project jewelryflow-sales-staging
echo.
echo 3. Loyiha holatini korish:
call npx vercel project inspect jewelryflow-sales-staging
echo.
pause
