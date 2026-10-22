@echo off
title JewelryFlow Sales — Vercel Staging Deploy
echo ==============================================================================
echo JEWELRYFLOW SALES — VERCEL STAGING DEPLOY
echo Loyiha: jewelryflow-sales-staging
echo Branch: feature/jewelryflow-sales-mvp
echo Target Supabase: vouehtlmsunebracahon (Sydney Cloud)
echo ==============================================================================
echo.
echo 1. Vercel CLI ga login tekshiruvi:
call npx vercel whoami
if %ERRORLEVEL% NEQ 0 (
  echo Vercel ga brauzer orqali login qilinmoqda...
  call npx vercel login
)
echo.
echo 2. Staging loyihasini deploy qilish:
call npx vercel --prod
echo.
pause
