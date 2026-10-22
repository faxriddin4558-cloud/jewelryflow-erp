const https = require('https');
const { execSync } = require('child_process');
const { createClient } = require('@supabase/supabase-js');

async function verifyAll() {
  console.log('--- 1. Testing Live Vercel Staging HTTP response ---');
  await new Promise((resolve) => {
    https.get('https://jewelryflow-sales-staging.vercel.app/sales/login', (res) => {
      console.log('HTTP Status /sales/login:', res.statusCode);
      resolve();
    }).on('error', (e) => {
      console.error('HTTP Error:', e.message);
      resolve();
    });
  });

  console.log('\n--- 2. Testing Live Supabase Auth for all 3 Roles ---');
  const rawKeys = execSync('npx supabase projects api-keys --project-ref vouehtlmsunebracahon --output json', { encoding: 'utf8' });
  const jsonStart = rawKeys.indexOf('[');
  const jsonEnd = rawKeys.lastIndexOf(']') + 1;
  const keys = JSON.parse(rawKeys.slice(jsonStart, jsonEnd));
  const anonKey = keys.find(k => k.name === 'anon').api_key;
  const supabaseUrl = 'https://vouehtlmsunebracahon.supabase.co';
  const anonClient = createClient(supabaseUrl, anonKey);

  const demoPass = process.env.NEXT_PUBLIC_DEMO_PASSWORD || 'GoldiaPassword2026!';
  const roles = [
    { role: 'Director', email: 'director@goldia.uz', button: 'Alisher (Direktor)' },
    { role: 'Manager', email: 'manager@goldia.uz', button: 'Rustam (Boshqaruvchi)' },
    { role: 'Seller (Toshkent)', email: 'seller@goldia.uz', button: 'Jamshid (Sotuvchi)' },
    { role: 'Seller (Navoiy)', email: 'dilshod@jewelryflow.uz', button: 'Dilshod (Sotuvchi)' },
    { role: 'Seller (Buxoro)', email: 'jasur@jewelryflow.uz', button: 'Jasur (Sotuvchi)' }
  ];

  for (const r of roles) {
    const { data, error } = await anonClient.auth.signInWithPassword({
      email: r.email,
      password: demoPass
    });

    if (error || !data?.session) {
      console.error('FAIL: ' + r.button + ' [' + r.email + ']: ' + (error ? error.message : 'No session'));
    } else {
      console.log('PASS: ' + r.button + ' -> Auth muvaffaqiyatli! User ID: ' + data.user.id.slice(0, 8) + '..., Token olindi.');
      
      // Test RLS with session token
      const authed = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: 'Bearer ' + data.session.access_token } }
      });
      const { data: emp, error: empErr } = await authed.from('employees').select('id, name, full_name, role_type, department').ilike('email', r.email).single();
      if (empErr) {
        console.error('  RLS xatosi (' + r.email + '): ' + empErr.message);
      } else {
        console.log('  RLS Xodim: ' + (emp.name || emp.full_name) + ' | Rol: ' + emp.role_type + ' | Bolim: ' + emp.department);
      }
    }
  }
}
verifyAll();
