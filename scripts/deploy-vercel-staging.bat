@echo off
title JewelryFlow Sales — Vercel Staging Deploy
echo ==============================================================================
echo JEWELRYFLOW SALES — VERCEL STAGING DEPLOY
echo Loyiha: jewelryflow-sales-staging
echo Branch: feature/jewelryflow-sales-mvp
echo Target Supabase: vouehtlmsunebracahon (Sydney Cloud)
echo ==============================================================================
echo.
echo [1/3] Vercel CLI login tekshiruvi...
call npx vercel whoami
if %ERRORLEVEL% NEQ 0 (
  echo.
  echo [INFO] Vercel CLI ga login qilish kerak.
  echo Iltimos, royxatdan GitHub yoki Email ni tanlang va brauzerda tasdiqlang:
  echo.
  call npx vercel login
)

echo.
echo [2/3] Loyihani mavjud 'jewelryflow-sales-staging' loyihasiga bog'lash (linking)...
call npx vercel link --project jewelryflow-sales-staging --yes

echo.
echo [3/3] 'jewelryflow-sales-staging' loyihasini jonli STAGING ga deploy qilish...
call npx vercel --prod --yes

echo.
echo ==============================================================================
echo DEPLOYMENT YAKUNLANDI!
echo ==============================================================================
echo.
pause
