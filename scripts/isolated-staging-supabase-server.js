const http = require('http');
const fs = require('fs');
const path = require('path');
const { PGlite } = require('@electric-sql/pglite');
const { uuid_ossp } = require('@electric-sql/pglite/contrib/uuid_ossp');
const { pg_trgm } = require('@electric-sql/pglite/contrib/pg_trgm');
const { btree_gist } = require('@electric-sql/pglite/contrib/btree_gist');

const PORT = parseInt(process.env.STAGING_SUPABASE_PORT || '54321', 10);

// Fictional test organization and user IDs
const ORG_GOLDIA_ID = '00000000-0000-0000-0000-000000000001';
const ORG_SAMARKAND_ID = '00000000-0000-0000-0000-000000000002';

const TEST_USERS = [
  {
    id: '11111111-1111-4001-8001-000000000001',
    email: 'director@goldia.uz',
    password: 'GoldiaPassword2026!',
    role: 'admin',
    organization_id: ORG_GOLDIA_ID,
    full_name: 'Alisher Director (Goldia)'
  },
  {
    id: '11111111-1111-4001-8001-000000000002',
    email: 'manager@goldia.uz',
    password: 'GoldiaPassword2026!',
    role: 'production_manager',
    organization_id: ORG_GOLDIA_ID,
    full_name: 'Bobur Manager (Goldia)'
  },
  {
    id: '11111111-1111-4001-8001-000000000003',
    email: 'operator@goldia.uz',
    password: 'GoldiaPassword2026!',
    role: 'department_operator',
    organization_id: ORG_GOLDIA_ID,
    full_name: 'Davron Usta (Goldia)'
  },
  {
    id: '11111111-1111-4001-8001-000000000004',
    email: 'qc@goldia.uz',
    password: 'GoldiaPassword2026!',
    role: 'quality_inspector',
    organization_id: ORG_GOLDIA_ID,
    full_name: 'Dilshod Nazoratchi (Goldia)'
  },
  {
    id: '22222222-2222-4002-8002-000000000001',
    email: 'director@samarkand.uz',
    password: 'SamarkandPassword2026!',
    role: 'admin',
    organization_id: ORG_SAMARKAND_ID,
    full_name: 'Sardor Director (Samarkand)'
  }
];

let dbInstance = null;
let serverInstance = null;

async function setupSupabaseBase(db) {
  await db.exec(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role;
      END IF;
    END $$;

    CREATE SCHEMA IF NOT EXISTS auth;

    CREATE TABLE IF NOT EXISTS auth.users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT UNIQUE,
      raw_user_meta_data JSONB DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ DEFAULT now()
    );

    CREATE OR REPLACE FUNCTION auth.uid()
    RETURNS UUID
    LANGUAGE sql
    STABLE
    AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
    $$;

    CREATE OR REPLACE FUNCTION auth.role()
    RETURNS TEXT
    LANGUAGE sql
    STABLE
    AS $$
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'authenticated');
    $$;

    CREATE OR REPLACE FUNCTION auth.jwt()
    RETURNS JSONB
    LANGUAGE sql
    STABLE
    AS $$
      SELECT json_build_object(
        'sub', current_setting('request.jwt.claim.sub', true),
        'role', COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'authenticated')
      )::jsonb;
    $$;

    CREATE OR REPLACE FUNCTION moddatetime()
    RETURNS TRIGGER
    LANGUAGE plpgsql
    AS $$
    BEGIN
      NEW.updated_at = NOW();
      RETURN NEW;
    END;
    $$;
  `);
}

async function applyAllMigrations(db) {
  const migrationsDir = path.resolve(__dirname, '../supabase/migrations');
  const files = fs
    .readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const filePath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(filePath, 'utf8');
    const sanitizedSql = sql
      .replace(
        /create\s+extension\s+if\s+not\s+exists\s+"moddatetime";/gi,
        '-- moddatetime handled natively'
      )
      .replace(
        /create\s+extension\s+if\s+not\s+exists\s+"pgcrypto";/gi,
        '-- pgcrypto gen_random_uuid is native in PG13+'
      );

    await db.exec(sanitizedSql);
  }

  await db.exec(`
    GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon;
    GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;
    GRANT ALL ON ALL ROUTINES IN SCHEMA public TO authenticated, service_role;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated, service_role;
  `);
}

async function seedStagingData(db) {
  // Seed Organizations
  await db.exec(`
    INSERT INTO public.organizations (id, code, name, status)
    VALUES 
      ('${ORG_GOLDIA_ID}'::uuid, 'goldia', 'Goldia Jewelry Factory', 'ACTIVE'),
      ('${ORG_SAMARKAND_ID}'::uuid, 'samarkand', 'Samarkand Gold Factory', 'ACTIVE')
    ON CONFLICT (code) DO NOTHING;
  `);

  // Seed Users into auth.users and public.employees
  for (const u of TEST_USERS) {
    await db.exec(`
      INSERT INTO auth.users (id, email, raw_user_meta_data)
      VALUES (
        '${u.id}'::uuid,
        '${u.email}',
        '{"role": "${u.role}", "organization_id": "${u.organization_id}", "full_name": "${u.full_name}"}'::jsonb
      )
      ON CONFLICT (id) DO UPDATE SET
        raw_user_meta_data = EXCLUDED.raw_user_meta_data;

      INSERT INTO public.employees (
        id, user_id, name, full_name, email, role, role_type, organization_id, is_active, status
      )
      VALUES (
        '${u.id}'::uuid,
        '${u.id}'::uuid,
        '${u.full_name}',
        '${u.full_name}',
        '${u.email}',
        '${u.role}',
        '${u.role}',
        '${u.organization_id}'::uuid,
        true,
        'active'
      )
      ON CONFLICT (id) DO UPDATE SET
        role = EXCLUDED.role,
        role_type = EXCLUDED.role_type,
        full_name = EXCLUDED.full_name,
        name = EXCLUDED.name,
        organization_id = EXCLUDED.organization_id;
    `);
  }

  // Seed Factory Settings for Samarkand (no bypasses)
  await db.exec(`
    INSERT INTO public.organization_factory_settings (
      organization_id, disabled_stage_codes, disabled_stage_orders, disabled_department_slugs
    )
    VALUES (
      '${ORG_SAMARKAND_ID}'::uuid,
      ARRAY[]::text[],
      ARRAY[]::integer[],
      ARRAY[]::text[]
    )
    ON CONFLICT (organization_id) DO UPDATE SET
      disabled_stage_codes = EXCLUDED.disabled_stage_codes,
      disabled_stage_orders = EXCLUDED.disabled_stage_orders;
  `);

  // Seed Inventory items (Safe gold balance)
  await db.exec(`
    INSERT INTO public.inventory_items (
      id, name, category, proba, on_hand, quantity_on_hand, reserved, organization_id
    )
    VALUES 
      ('33333333-3333-4001-8001-000000000001'::uuid, 'Chisto Oltin 999.9', 'Gold', 999.9, 1000.0000, 1000.0000, 0, '${ORG_GOLDIA_ID}'::uuid),
      ('33333333-3333-4001-8001-000000000002'::uuid, 'Oltin Lom 585', 'scrap', 585.0, 500.0000, 500.0000, 0, '${ORG_GOLDIA_ID}'::uuid),
      ('33333333-3333-4001-8001-000000000003'::uuid, 'Ligatura Master Qotishma', 'consumable', 0.0, 150.0000, 150.0000, 0, '${ORG_GOLDIA_ID}'::uuid),
      ('33333333-3333-4001-8001-000000000004'::uuid, 'Oltin 585 SAFE', 'Gold', 585.0, 1000.0000, 1000.0000, 0, '${ORG_GOLDIA_ID}'::uuid),
      ('33333333-3333-4002-8002-000000000001'::uuid, 'Samarkand Chisto Oltin 999.9', 'Gold', 999.9, 500.0000, 500.0000, 0, '${ORG_SAMARKAND_ID}'::uuid),
      ('33333333-3333-4002-8002-000000000002'::uuid, 'Samarkand Oltin 585 SAFE', 'Gold', 585.0, 500.0000, 500.0000, 0, '${ORG_SAMARKAND_ID}'::uuid)
    ON CONFLICT (id) DO UPDATE SET
      category = EXCLUDED.category,
      on_hand = EXCLUDED.on_hand,
      quantity_on_hand = EXCLUDED.quantity_on_hand;
  `);

  // Seed Machines
  await db.exec(`
    INSERT INTO public.machines (id, name, department, status, organization_id)
    VALUES
      (gen_random_uuid(), 'LASER-01', 'Lazer', 'IDLE', '${ORG_GOLDIA_ID}'::uuid),
      (gen_random_uuid(), 'CAST-01', 'Quyish', 'IDLE', '${ORG_GOLDIA_ID}'::uuid),
      (gen_random_uuid(), 'LASER-SAM-01', 'Lazer', 'IDLE', '${ORG_SAMARKAND_ID}'::uuid)
    ON CONFLICT DO NOTHING;
  `);
}

function createJWT(user) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: user.id,
    email: user.email,
    role: 'authenticated',
    user_metadata: {
      role: user.role,
      organization_id: user.organization_id,
      full_name: user.full_name
    },
    app_metadata: {
      provider: 'email',
      providers: ['email']
    },
    exp: Math.floor(Date.now() / 1000) + 86400 * 7
  })).toString('base64url');
  return `${header}.${payload}.sig`;
}

function parseToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  try {
    const parts = token.split('.');
    if (parts.length < 2) return null;
    const payloadStr = Buffer.from(parts[1], 'base64url').toString('utf8');
    return JSON.parse(payloadStr);
  } catch {
    return null;
  }
}

async function setSqlContext(db, user) {
  if (!user || !user.sub) {
    await db.exec(`
      SELECT set_config('request.jwt.claim.sub', '', false);
      SELECT set_config('request.jwt.claim.role', 'anon', false);
      SET ROLE anon;
    `);
  } else {
    await db.exec(`
      SELECT set_config('request.jwt.claim.sub', '${user.sub}', false);
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
      SET ROLE authenticated;
    `);
  }
}

async function startStagingServer(port = PORT) {
  dbInstance = new PGlite({
    extensions: { uuid_ossp, pg_trgm, btree_gist }
  });

  await setupSupabaseBase(dbInstance);
  await applyAllMigrations(dbInstance);
  await seedStagingData(dbInstance);

  return new Promise((resolve) => {
    serverInstance = http.createServer(async (req, res) => {
      res.setHeader('Access-Control-Allow-Origin', req.headers['origin'] || '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Expose-Headers', '*');

      if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
      }

      const parsedUrl = new URL(req.url, `http://localhost:${port}`);
      const pathname = parsedUrl.pathname;
      const tokenPayload = parseToken(req.headers['authorization']);
      console.log(`[STAGING-REQ] ${req.method} ${pathname} Auth:${req.headers['authorization'] ? 'BEARER' : 'NONE'}`);

      // Read Body
      let bodyData = '';
      req.on('data', chunk => { bodyData += chunk; });
      req.on('end', async () => {
        let jsonBody = {};
        if (bodyData) {
          try { jsonBody = JSON.parse(bodyData); } catch {}
        }

        try {
          // 1. Health check & reset
          if (pathname === '/staging/health') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', isolated: true, pglite: true }));
            return;
          }

          if (pathname === '/staging/reset' && req.method === 'POST') {
            await seedStagingData(dbInstance);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ reset: true }));
            return;
          }

          // 2. Auth: /auth/v1/token
          if (pathname === '/auth/v1/token') {
            const { email, password } = jsonBody;
            const user = TEST_USERS.find(u => u.email.toLowerCase() === (email || '').toLowerCase());
            if (!user || (password && password !== user.password)) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({
                error: 'invalid_grant',
                error_description: 'Email yoki parol noto\'g\'ri!'
              }));
              return;
            }

            const token = createJWT(user);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              access_token: token,
              token_type: 'bearer',
              expires_in: 86400 * 7,
              refresh_token: 'ref-' + token,
              user: {
                id: user.id,
                aud: 'authenticated',
                role: 'authenticated',
                email: user.email,
                user_metadata: {
                  role: user.role,
                  organization_id: user.organization_id,
                  full_name: user.full_name
                },
                app_metadata: { provider: 'email', providers: ['email'] }
              }
            }));
            return;
          }

          // 3. Auth: /auth/v1/user
          if (pathname === '/auth/v1/user') {
            if (!tokenPayload || !tokenPayload.sub) {
              res.writeHead(401, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ message: 'Invalid or missing JWT' }));
              return;
            }

            const user = TEST_USERS.find(u => u.id === tokenPayload.sub);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              id: tokenPayload.sub,
              aud: 'authenticated',
              role: 'authenticated',
              email: tokenPayload.email,
              user_metadata: tokenPayload.user_metadata || {},
              app_metadata: tokenPayload.app_metadata || { provider: 'email' }
            }));
            return;
          }

          // 4. Auth: /auth/v1/logout
          if (pathname === '/auth/v1/logout') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({}));
            return;
          }

          // Set SQL context for RLS
          await setSqlContext(dbInstance, tokenPayload);

          // 5. REST RPC: /rest/v1/rpc/<rpc_name>
          if (pathname.startsWith('/rest/v1/rpc/')) {
            const rpcName = pathname.replace('/rest/v1/rpc/', '').replace(/\/$/, '');
            const params = jsonBody || {};
            const paramKeys = Object.keys(params);

            let sqlQuery = '';
            let paramValues = [];

            if (paramKeys.length === 0) {
              sqlQuery = `SELECT public.${rpcName}() as result;`;
            } else {
              const argList = paramKeys.map((k, i) => `${k} => $${i + 1}`).join(', ');
              sqlQuery = `SELECT public.${rpcName}(${argList}) as result;`;
              paramValues = paramKeys.map(k => params[k]);
            }

            const result = await dbInstance.query(sqlQuery, paramValues);
            const output = result.rows && result.rows.length > 0 ? result.rows[0].result : null;

            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(output !== undefined ? output : {}));
            return;
          }

          // 6. REST Tables: /rest/v1/<table>
          if (pathname.startsWith('/rest/v1/')) {
            const tableName = pathname.replace('/rest/v1/', '').split('?')[0].replace(/\/$/, '');
            
            // Build simple query from params
            const selectCol = parsedUrl.searchParams.get('select') || '*';
            const orderParam = parsedUrl.searchParams.get('order');
            const limitParam = parsedUrl.searchParams.get('limit');

            const whereClauses = [];
            const whereValues = [];

            parsedUrl.searchParams.forEach((val, key) => {
              if (['select', 'order', 'limit', 'offset'].includes(key)) return;
              if (val.startsWith('eq.')) {
                whereValues.push(val.slice(3));
                whereClauses.push(`${key} = $${whereValues.length}`);
              } else if (val.startsWith('gt.')) {
                whereValues.push(val.slice(3));
                whereClauses.push(`${key} > $${whereValues.length}`);
              } else if (val.startsWith('gte.')) {
                whereValues.push(val.slice(4));
                whereClauses.push(`${key} >= $${whereValues.length}`);
              } else if (val.startsWith('lt.')) {
                whereValues.push(val.slice(3));
                whereClauses.push(`${key} < $${whereValues.length}`);
              } else if (val.startsWith('lte.')) {
                whereValues.push(val.slice(4));
                whereClauses.push(`${key} <= $${whereValues.length}`);
              }
            });

            if (req.method === 'GET' || req.method === 'HEAD') {
              let sql = `SELECT ${selectCol} FROM public.${tableName}`;
              if (whereClauses.length > 0) {
                sql += ` WHERE ` + whereClauses.join(' AND ');
              }
              if (orderParam) {
                const parts = orderParam.split('.');
                const col = parts[0];
                const dir = parts[1] === 'desc' ? 'DESC' : 'ASC';
                sql += ` ORDER BY ${col} ${dir}`;
              }
              if (limitParam) {
                sql += ` LIMIT ${parseInt(limitParam, 10)}`;
              }

              const result = await dbInstance.query(sql, whereValues);
              res.writeHead(200, {
                'Content-Type': 'application/json',
                'Content-Range': `0-${result.rows.length}/${result.rows.length}`
              });
              if (req.method === 'HEAD') {
                res.end();
              } else {
                res.end(JSON.stringify(result.rows));
              }
              return;
            }

            if (req.method === 'POST') {
              const items = Array.isArray(jsonBody) ? jsonBody : [jsonBody];
              const inserted = [];
              for (const item of items) {
                const cols = Object.keys(item);
                const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
                const vals = cols.map(c => item[c]);
                const insertSql = `INSERT INTO public.${tableName} (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *;`;
                const r = await dbInstance.query(insertSql, vals);
                inserted.push(r.rows[0]);
              }
              res.writeHead(201, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(Array.isArray(jsonBody) ? inserted : inserted[0]));
              return;
            }

            if (req.method === 'PATCH') {
              const updateCols = Object.keys(jsonBody);
              const setClause = updateCols.map((c, i) => `${c} = $${i + 1}`).join(', ');
              const updateVals = updateCols.map(c => jsonBody[c]);

              let patchSql = `UPDATE public.${tableName} SET ${setClause}`;
              if (whereClauses.length > 0) {
                const adjustedWhere = whereClauses.map((c, i) => {
                  return c.replace(/\$\d+/, `$${updateVals.length + i + 1}`);
                });
                patchSql += ` WHERE ` + adjustedWhere.join(' AND ');
                updateVals.push(...whereValues);
              }
              patchSql += ` RETURNING *;`;

              const result = await dbInstance.query(patchSql, updateVals);
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(result.rows));
              return;
            }
          }

          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Endpoint not found', pathname }));
        } catch (err) {
          console.error(`[STAGING-SERVER-ERROR] ${pathname}:`, err.message);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            message: err.message,
            code: err.code || 'PGRST_ERROR',
            details: err.detail || err.message
          }));
        }
      });
    });

    serverInstance.listen(port, () => {
      console.log(`[ISOLATED-STAGING-SERVER] Running on http://127.0.0.1:${port}`);
      resolve({ server: serverInstance, db: dbInstance });
    });
  });
}

function stopStagingServer() {
  return new Promise((resolve) => {
    if (serverInstance) {
      serverInstance.close(() => {
        console.log('[ISOLATED-STAGING-SERVER] Stopped.');
        resolve();
      });
    } else {
      resolve();
    }
  });
}

if (require.main === module) {
  startStagingServer().then(() => {
    console.log('Press Ctrl+C to stop staging server.');
  });
}

module.exports = {
  startStagingServer,
  stopStagingServer,
  TEST_USERS,
  ORG_GOLDIA_ID,
  ORG_SAMARKAND_ID
};
