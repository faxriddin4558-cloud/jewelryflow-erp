// Ends the audit: bans the audit GoTrue users (kept, not deleted, so audit rows stay referentially intact).
// Re-enable with ban_duration "none" (and new passwords via setup.js logic) for a later browser audit.
const { creds, svc } = require('./lib');
(async () => { const c = creds(); for (const [t, u] of Object.entries(c)) { const r = await svc('PUT', `auth/v1/admin/users/${u.id}`, { ban_duration: process.argv[2] || '876000h' }); console.log(t, r.ok ? 'banned' : r.error); } })();
