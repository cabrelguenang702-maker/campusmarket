-- 0057 — Les 54 pays africains proposés à l'inscription (liste fournie le 14/10/2026). Appliquée en production par insertion directe.
-- Les moyens de paiement des pays ajoutés restent vides tant que le prestataire n'y est pas configuré (réglable dans Admin > Géographie).
-- Régions : classification de l'ONU.
insert into public.countries (code, name, dial_code, region) values
('ZA','Afrique du Sud','+27','Afrique australe'),('DZ','Algérie','+213','Afrique du Nord'),('AO','Angola','+244','Afrique centrale'),('BJ','Bénin','+229',E'Afrique de l''Ouest'),
('BW','Botswana','+267','Afrique australe'),('BF','Burkina Faso','+226',E'Afrique de l''Ouest'),('BI','Burundi','+257',E'Afrique de l''Est'),('CV','Cabo Verde (Cap-Vert)','+238',E'Afrique de l''Ouest'),
('CM','Cameroun','+237','Afrique centrale'),('KM','Comores','+269',E'Afrique de l''Est'),('CG','Congo (République du Congo)','+242','Afrique centrale'),('CD','Congo (République démocratique du Congo)','+243','Afrique centrale'),
('CI',E'Côte d''Ivoire','+225',E'Afrique de l''Ouest'),('DJ','Djibouti','+253',E'Afrique de l''Est'),('EG','Égypte','+20','Afrique du Nord'),('ER','Érythrée','+291',E'Afrique de l''Est'),
('SZ','Eswatini','+268','Afrique australe'),('ET','Éthiopie','+251',E'Afrique de l''Est'),('GA','Gabon','+241','Afrique centrale'),('GM','Gambie','+220',E'Afrique de l''Ouest'),
('GH','Ghana','+233',E'Afrique de l''Ouest'),('GN','Guinée','+224',E'Afrique de l''Ouest'),('GW','Guinée-Bissau','+245',E'Afrique de l''Ouest'),('GQ','Guinée équatoriale','+240','Afrique centrale'),
('KE','Kenya','+254',E'Afrique de l''Est'),('LS','Lesotho','+266','Afrique australe'),('LR','Libéria','+231',E'Afrique de l''Ouest'),('LY','Libye','+218','Afrique du Nord'),
('MG','Madagascar','+261',E'Afrique de l''Est'),('MW','Malawi','+265',E'Afrique de l''Est'),('ML','Mali','+223',E'Afrique de l''Ouest'),('MA','Maroc','+212','Afrique du Nord'),
('MU','Maurice','+230',E'Afrique de l''Est'),('MR','Mauritanie','+222',E'Afrique de l''Ouest'),('MZ','Mozambique','+258',E'Afrique de l''Est'),('NA','Namibie','+264','Afrique australe'),
('NE','Niger','+227',E'Afrique de l''Ouest'),('NG','Nigéria','+234',E'Afrique de l''Ouest'),('UG','Ouganda','+256',E'Afrique de l''Est'),('CF','République centrafricaine','+236','Afrique centrale'),
('RW','Rwanda','+250',E'Afrique de l''Est'),('ST','Sao Tomé-et-Principe','+239','Afrique centrale'),('SN','Sénégal','+221',E'Afrique de l''Ouest'),('SC','Seychelles','+248',E'Afrique de l''Est'),
('SL','Sierra Leone','+232',E'Afrique de l''Ouest'),('SO','Somalie','+252',E'Afrique de l''Est'),('SD','Soudan','+249','Afrique du Nord'),('SS','Soudan du Sud','+211',E'Afrique de l''Est'),
('TZ','Tanzanie','+255',E'Afrique de l''Est'),('TD','Tchad','+235','Afrique centrale'),('TG','Togo','+228',E'Afrique de l''Ouest'),('TN','Tunisie','+216','Afrique du Nord'),
('ZM','Zambie','+260',E'Afrique de l''Est'),('ZW','Zimbabwe','+263',E'Afrique de l''Est')
on conflict (code) do update set name = excluded.name where public.countries.code in ('CG','CD');
update public.countries set flag_emoji = chr(127397 + ascii(substr(code, 1, 1))) || chr(127397 + ascii(substr(code, 2, 1))) where flag_emoji is null;
