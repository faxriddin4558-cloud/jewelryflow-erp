-- Synthetic identities only (local disposable cluster; no usable passwords — tests set JWT claims directly).
insert into organizations (id, code, name, status) values ('00000000-0000-0000-0000-0000000000b2','orgb','Test Org B','ACTIVE') on conflict do nothing;
insert into auth.users (id, email, encrypted_password) values
 ('a0000000-0000-4000-8000-000000000001','t.director@audit.test', 'local-no-login'),
 ('a0000000-0000-4000-8000-000000000002','t.manager@audit.test',  'local-no-login'),
 ('a0000000-0000-4000-8000-00000000000a','t.sellera@audit.test',  'local-no-login'),
 ('a0000000-0000-4000-8000-00000000000b','t.sellerb@audit.test',  'local-no-login'),
 ('a0000000-0000-4000-8000-00000000000c','t.sellerc@audit.test',  'local-no-login'),
 ('a0000000-0000-4000-8000-0000000000dd','t.inactive@audit.test', 'local-no-login'),
 ('a0000000-0000-4000-8000-0000000000ee','t.noemp@audit.test',    'local-no-login'),
 ('a0000000-0000-4000-8000-0000000000ff','t.noorg@audit.test',    'local-no-login'),
 ('b0000000-0000-4000-8000-000000000001','t.dirb@audit.test',     'local-no-login');
-- same shape as /api/sales/employees/create (id = user_id)
insert into employees (id,user_id,employee_code,name,full_name,email,role,role_type,position,department,is_active,status,organization_id) values
 ('a0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000001','T-DIR','T Direktor','T Direktor','t.director@audit.test','admin','director','Director','Boshqaruv',true,'active','00000000-0000-0000-0000-000000000001'),
 ('a0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000002','T-MGR','T Menejer','T Menejer','t.manager@audit.test','production_manager','production manager','Production Manager','Boshqaruv',true,'active','00000000-0000-0000-0000-000000000001'),
 ('a0000000-0000-4000-8000-00000000000a','a0000000-0000-4000-8000-00000000000a','T-SA','T Sotuvchi A','T Sotuvchi A','t.sellera@audit.test','sales','seller','Seller','Savdo',true,'active','00000000-0000-0000-0000-000000000001'),
 ('a0000000-0000-4000-8000-00000000000b','a0000000-0000-4000-8000-00000000000b','T-SB','T Sotuvchi B','T Sotuvchi B','t.sellerb@audit.test','sales','seller','Seller','Savdo',true,'active','00000000-0000-0000-0000-000000000001'),
 ('a0000000-0000-4000-8000-00000000000c','a0000000-0000-4000-8000-00000000000c','T-SC','T Sotuvchi C','T Sotuvchi C','t.sellerc@audit.test','sales','seller','Seller','Savdo',true,'active','00000000-0000-0000-0000-000000000001'),
 ('a0000000-0000-4000-8000-0000000000dd','a0000000-0000-4000-8000-0000000000dd','T-SX','T Nofaol','T Nofaol','t.inactive@audit.test','sales','seller','Seller','Savdo',false,'inactive','00000000-0000-0000-0000-000000000001'),
 ('a0000000-0000-4000-8000-0000000000ff','a0000000-0000-4000-8000-0000000000ff','T-NO','T Orgsiz','T Orgsiz','t.noorg@audit.test','sales','seller','Seller','Savdo',true,'active',null),
 ('b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','T-DB','T Direktor B','T Direktor B','t.dirb@audit.test','admin','director','Director','Boshqaruv',true,'active','00000000-0000-0000-0000-0000000000b2');
