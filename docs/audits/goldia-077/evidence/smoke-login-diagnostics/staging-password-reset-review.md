# reset-staging-test-passwords.ps1: security review and hardening (2026-11-11)
Staging `vouehtlmsunebracahon`, read-only pre-check via SQL: director@ / manager@ / seller@goldia.uz each exist exactly once
in Auth (50 users in total), are confirmed, not banned, have 1 identity and exactly 1 active employee row in
"Goldia Jewelry Demo Staging" with roles admin / production_manager / sales.

Already safe before this change: the URL is fixed to staging; production / JFS Demo / ERP refs are refused; the key and passwords
are typed hidden (SecureString) and never printed, written or put in env; there is no delete; the new password is proven with a real login (token sub = the account).

Hardened:
| Risk | Before | Now |
|---|---|---|
| any account could be passed with -Accounts | only the org check | allow-list of the 3 e-mails + expected role, active flag, exactly 1 employee row |
| silent extra Auth change | set email_confirm for an unconfirmed account | STOP; the body is `{password}` only (`ban_duration` only with an explicit -Unban) |
| banned account | continued, the login failed | STOP before any change unless -Unban |
| no confirmation step | wrote right after the prompts | -DryRun; typed phrase `STAGING vouehtlmsunebracahon` before the first write |
| weak password | >= 12 characters | >= 14 characters, 3 character classes, not the e-mail name / "goldia", the 3 passwords must differ |
| new sb_secret_ keys | refused ("not a JWT") | accepted in the apikey header only; another project's key is refused by staging (401) before any change |
| proof session left open | the refresh token stayed valid | signed out (logout scope=local) |
| side effects not proven | - | after the change: Auth id / e-mail / confirmation / ban and employee id / role / org / active are re-read and must be unchanged |

Not run here: PowerShell is not available in this cloud session (downloading it was not permitted). Static review only:
ASCII only, braces balanced. The owner's -DryRun is the first real execution and changes nothing.
