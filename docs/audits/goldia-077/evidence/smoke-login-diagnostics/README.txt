Production smoke "L-manager: landed on /sales/login" (2026-11-06): the harness recorded no reason. The login code did
not change between e717ffc (manager PASS) and 2b48df9 (only the "Davriy Hisobot" menu entry and isManagementUiRole);
the server only sends a user back to /sales/login when there is no session or for a demo e-mail - no role check.
The smoke asks the e-mails / passwords by hand on every run, so a refused Auth login (typo, changed password, rate
limit, banned / unconfirmed user) looked identical to any other failure.
Fix (harness only): on a failed login the smoke records the Supabase Auth status + error code (response body read only
on failure - no token), the message the login page shows, the page navigation and the demo-account case; the check
still FAILs. Staging tests with the synthetic users (read-only smoke, writes blocked):
  run1  users banned            -> FAIL L-manager | the Auth user is banned | auth=400 user_banned | page="User is banned"
  run2  wrong manager password  -> FAIL L-manager | ... (invalid_credentials) | auth=400 invalid_credentials
  run3  correct credentials     -> L-director / L-manager / L-seller PASS; 63 PASS, 1 REVIEW (no baseline file), 0 FAIL
