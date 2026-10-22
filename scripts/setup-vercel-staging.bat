@echo off
title JewelryFlow Sales — Vercel Staging Ulanish va Deploy
echo ==============================================================================
echo JEWELRYFLOW SALES — VERCEL STAGING ULANISH VA TEKSHIRUV
echo Target Loyiha: jewelryflow-sales-staging
echo Local Branch: feature/jewelryflow-sales-mvp
echo ==============================================================================
echo.
echo [1/3] Vercel CLI avtorizatsiyasi tekshirilmoqda...
call npx vercel whoami
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo [INFO] Vercel CLI ga login qilish kerak.
  echo Iltimos, royxatdan GitHub yoki Email ni tanlang va brauzerda tasdiqlang:
  echo.
  call npx vercel login
)

echo.
echo [2/3] Loyihani mavjud 'jewelryflow-sales-staging' ga link qilish...
call npx vercel link --project jewelryflow-sales-staging --yes

echo.
echo [3/3] Loyiha holati:
call npx vercel project inspect jewelryflow-sales-staging
echo.
pause
