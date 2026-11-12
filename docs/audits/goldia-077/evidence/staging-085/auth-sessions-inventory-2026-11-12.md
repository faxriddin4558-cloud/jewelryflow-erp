# Staging Auth sessions: inventory (read-only, 2026-11-12, e-mails masked). Nothing was deleted.
| Organization | Accounts (masked) | Banned | Sessions | First..last |
|---|---|---|---|---|
| GOLDIA AUDIT 075 A (sintetik) | 11 synthetic (audit.fx075.* x5, audit.stg075.* x4, audit.fx077.id* x2, audit.ui075.wo*) | all | 585 | 11-03..11-11 |
| GOLDIA AUDIT 075 B (sintetik) | 8 synthetic (audit.fx075.* x3, audit.stg075.* x3, audit.ui075.* x2) | all | 67 | 11-03..11-11 |
| GOLDIA AUDIT (sintetik, real Auth) 2026-11-03 | 3 synthetic (audit.stg.*) | all | 32 | 11-03 |
| no employee | 4 synthetic noemp (audit.stg075/fx075/stg/ui075.noemp) | all | 17 | 11-03..11-11 |
| GOLDIA AUDIT 085 C (sintetik) | 4 synthetic (audit.c085.*) | all | 23 | 11-11 |
| no employee | **1 NON-synthetic account goldiaadmin…@gmail.com** | no | 1 | 10-27 |
| Goldia Jewelry Demo Staging | director@ / manager@ / seller@goldia.uz (real demo accounts, smoke + password check) | no | 9 | 11-11 |
Proposal (needs a separate approval): revoke only the sessions of the synthetic accounts (@goldia-audit.test). The gmail account and the
3 demo accounts are NOT touched. In this run only the 4 C accounts' sessions are revoked (as approved).
