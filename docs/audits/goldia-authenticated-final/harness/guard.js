// Every write goes ONLY to the isolated test project; production ref is refused.
const TEST_REF = 'yvvbdoqncubtwlzskgml', PROD_REF = 'vrozlllcaxinavzxueif';
const ref = JSON.parse(Buffer.from(process.env.SUPABASE_SERVICE_ROLE_KEY.split('.')[1], 'base64url')).ref;
if (ref !== TEST_REF || ref === PROD_REF) throw new Error('refusing: service key is not the isolated test project');
module.exports = { URL: `https://${TEST_REF}.supabase.co`, KEY: process.env.SUPABASE_SERVICE_ROLE_KEY, ANON: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, REF: ref };
