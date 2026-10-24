const { runSqlQuery } = require('./execute-staging-sql.js');

async function testSession() {
  const query = `
    select
      set_config('request.jwt.claims', '{"sub": "77777777-7777-4777-7777-777777777777", "role": "authenticated"}', false),
      set_config('app.current_organization_id', '00000000-0000-0000-0000-000000000001', false);

    select
      auth.uid() as uid,
      public.current_organization_id() as org_id,
      public.current_employee_role_text() as role;
  `;

  const res = await runSqlQuery(query);
  console.log('Session test result:', res);
}

testSession().catch(console.error);
