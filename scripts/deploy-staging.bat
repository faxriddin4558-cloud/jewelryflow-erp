@echo off
title JewelryFlow Sales — Staging Deploy
echo ==============================================================================
echo JEWELRYFLOW SALES — STAGING DEPLOY (001-035 MIGRATSIYALAR VA DEMO SEED)
echo Target Loyiha: vouehtlmsunebracahon (jewelryflow-sales-staging)
echo Production loyihasi: Mutlaqo ulanmagan va himoyalangan.
echo ==============================================================================
echo.
npx supabase db push --include-seed
echo.
if %ERRORLEVEL% EQU 0 (
  echo [MUVAFFAQIYAT] Barcha 35 ta migratsiya va demo seed Staging loyihasiga ornatildi!
) else (
  echo [XATOLIK] Migratsiyani ornatishda xatolik yuz berdi.
)
echo.
pause
