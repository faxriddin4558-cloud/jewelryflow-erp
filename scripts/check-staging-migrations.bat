@echo off
title JewelryFlow Sales — Staging Migratsiyalar Tekshiruvi
echo ==============================================================================
echo JEWELRYFLOW SALES — STAGING MIGRATION LIST (001 - 035)
echo Target Loyiha: vouehtlmsunebracahon (jewelryflow-sales-staging)
echo Production loyihasi: Mutlaqo ulanmagan va himoyalangan.
echo ==============================================================================
echo.
echo Supabase Staging bazangiz parolini kiriting (parol ekranda korinmaydi):
echo.
npx supabase migration list
echo.
pause
