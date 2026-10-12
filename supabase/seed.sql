-- =============================================================================
-- Seed de développement — fait correspondre la base à supabase/mock-data.ts
-- du prototype front-end (mêmes pays, universités et catégories), pour que les
-- écrans déjà construits (annuaire, marketplace, inscription) fonctionnent
-- immédiatement une fois branchés sur cette base.
-- N'est appliqué qu'en local via `supabase db reset` — jamais en production.
-- =============================================================================

insert into public.countries (code, name, dial_code, mobile_money_providers, region, flag_emoji) values
  ('CM', 'Cameroun',       '+237', array['MTN MoMo', 'Orange Money'],            'Afrique centrale',    '🇨🇲'),
  ('CI', 'Côte d''Ivoire', '+225', array['MTN MoMo', 'Orange Money', 'Wave'],    'Afrique de l''Ouest', '🇨🇮'),
  ('SN', 'Sénégal',        '+221', array['Orange Money', 'Wave'],                'Afrique de l''Ouest', '🇸🇳'),
  ('GA', 'Gabon',          '+241', array['Airtel Money'],                        'Afrique centrale',    '🇬🇦'),
  ('CD', 'RD Congo',       '+243', array['Airtel Money', 'Orange Money'],        'Afrique centrale',    '🇨🇩'),
  ('BJ', 'Bénin',          '+229', array['MTN MoMo', 'Moov Money'],              'Afrique de l''Ouest', '🇧🇯'),
  ('TG', 'Togo',           '+228', array['Moov Money'],                          'Afrique de l''Ouest', '🇹🇬'),
  ('BF', 'Burkina Faso',   '+226', array['Orange Money', 'Moov Money'],          'Afrique de l''Ouest', '🇧🇫'),
  ('ML', 'Mali',           '+223', array['Orange Money', 'Moov Money'],          'Afrique de l''Ouest', '🇲🇱'),
  ('GN', 'Guinée',         '+224', array['Orange Money', 'MTN MoMo'],            'Afrique de l''Ouest', '🇬🇳'),
  ('CG', 'Congo',          '+242', array['MTN MoMo', 'Airtel Money'],            'Afrique centrale',    '🇨🇬'),
  ('MA', 'Maroc',          '+212', array['Carte bancaire'],                      'Afrique du Nord',     '🇲🇦');

insert into public.universities (name, short_name, city, country_code, student_count) values
  ('Université de Yaoundé I',                    'UY1',     'Yaoundé',       'CM', 45000),
  ('Université de Yaoundé II',                   'UY2',     'Soa',           'CM', 38000),
  ('Université de Douala',                       'UDo',     'Douala',        'CM', 52000),
  ('Université de Dschang',                      'UDs',     'Dschang',       'CM', 24000),
  ('Université de Buea',                         'UB',      'Buea',          'CM', 19000),
  ('Université de Ngaoundéré',                   'UN',      'Ngaoundéré',    'CM', 21000),
  ('IUT Fotso Victor de Bandjoun',                'IUT FV',  'Bandjoun',      'CM', 4200),
  ('École Nationale Supérieure Polytechnique',   'ENSPY',   'Yaoundé',       'CM', 3100),
  ('Université Catholique d''Afrique Centrale',  'UCAC',    'Yaoundé',       'CM', 6000),
  ('Institut Universitaire de la Côte',          'IUC',     'Douala',        'CM', 7500),
  ('Université Cheikh Anta Diop',                'UCAD',    'Dakar',         'SN', 80000),
  ('Université Félix Houphouët-Boigny',          'UFHB',    'Abidjan',       'CI', 60000),
  ('Université Omar Bongo',                      'UOB',     'Libreville',    'GA', 18000),
  ('Université d''Abomey-Calavi',                'UAC',     'Abomey-Calavi', 'BJ', 55000);

insert into public.categories (slug, name, sort_order) values
  ('telephones',  'Téléphones',            1),
  ('ordinateurs', 'Ordinateurs',           2),
  ('audio',       'Audio et accessoires',  3),
  ('livres',      'Livres et fournitures', 4),
  ('services',    'Services et cours',     5),
  ('mode',        'Mode',                  6),
  ('maison',      'Maison et chambre',     7);
