# Staging 085 smoke login failure: read-only diagnosis (2026-11-11)
Staging `vouehtlmsunebracahon` only. Every query was read-only. No password, ban, Auth or deploy change was made.

1. DB level: the latest migration is 20260101000085, with history 080..085. opening tables and rpc_financial_restart exist,
   there are 12 draft-guard triggers and 0 opening periods.
2. Function-body parity with repository 001..085 (supabase/release/function_body_parity_085_full_readonly.sql):
   `RESULT|function_parity_085|OK|identical=136 crlf_only=46 different=0 missing=0 extra=0`.
   Before the release there were 59 crlf_only bodies (STAGING-080-AUDIT §2). Functions recreated by 081..085 now come from LF files
   (.gitattributes `*.sql eol=lf`), so their CR-only formatting is gone. The remaining 46 are still CR-only. No logical code was lost or changed.
3. Auth: 3 POST /token grant_type=password at 11:51:06, 11:51:55 and 11:52:45 UTC, all `400 invalid_credentials`.
   No `user_banned` and no successful sign-in in the last 3 days.
4. Accounts in "Goldia Jewelry Demo Staging" (admin x3, production_manager x2, sales x4): all exist, are not banned, are confirmed,
   are active, have a password and are linked (employees.user_id = auth.users.id, the e-mail matches). The synthetic audit org users are banned
   (that would give `user_banned`, not what happened).
5. Cause: for each role, the e-mail/password pair typed at the smoke prompt does not match any active staging Auth user
   (wrong or old password, or a non-staging e-mail). GoTrue gives the same code for both cases. The DB, the release, RLS and the frontend are not the cause.
   Note: the dir… director account was updated in Auth on 2026-11-04, after its last login on 2026-10-27, which is consistent with a password change.
