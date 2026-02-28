-- Migration 086: Seed Saunas & Bath Houses (Category 6)
-- Inserts 27 pre-approved sauna/bathhouse venues with geocoded coordinates
-- Safe to re-run: uses unique index + ON CONFLICT DO NOTHING

-- Create a unique index on (name, address) to support idempotent inserts
CREATE UNIQUE INDEX IF NOT EXISTS idx_nearby_places_name_address
  ON nearby_places (name, address);

INSERT INTO nearby_places
  (name, description, address, city, country, location_lat, location_lng, category_id, place_type, status, price_range)
VALUES
  -- 6.1 Der Boiler — Berlin, Germany
  ('Der Boiler',
   'Sprawling, modern sauna open 24/7 on weekends; massive local and tourist mix.',
   'Mehringdamm 34, Berlin, Germany',
   'Berlin', 'Germany',
   52.49380000, 13.38790000,
   6, 'business', 'approved', '$$'),

  -- 6.2 Steamworks Toronto — Toronto, Canada
  ('Steamworks Toronto',
   'Sleek, modern 24/7 bathhouse blending gym facilities with extensive dark cruising zones.',
   '540 Church St, Toronto, ON, Canada',
   'Toronto', 'Canada',
   43.66590000, -79.38030000,
   6, 'business', 'approved', '$$'),

  -- 6.3 Alexander Sauna — Athens, Greece
  ('Alexander Sauna',
   'Four-floor venue renowned for its dark labyrinth vibes and rare outdoor garden.',
   'Meg. Alexandrou 134, Athens, Greece',
   'Athens', 'Greece',
   37.97780000, 23.71300000,
   6, 'business', 'approved', '$$'),

  -- 6.4 Outside Leisure — Belfast, UK
  ('Outside Leisure',
   'Discreet sauna in the gay quarter featuring spa pools, slings, and cinema rooms.',
   '1-5 Donegal Lane, Belfast, UK',
   'Belfast', 'United Kingdom',
   54.59780000, -5.93010000,
   6, 'business', 'approved', '$$'),

  -- 6.5 Gay Sauna NZ — Amsterdam, Netherlands
  ('Gay Sauna NZ',
   'Central bathhouse near Centraal Station with strong weekend theme nights and infusions.',
   'Nieuwezijds Armsteeg 95, Amsterdam, Netherlands',
   'Amsterdam', 'Netherlands',
   52.37430000, 4.89250000,
   6, 'business', 'approved', '$$'),

  -- 6.6 Basement Gay Sauna — Manchester, UK
  ('Basement Gay Sauna',
   'Manchester''s largest sauna featuring steam areas, cafes, and extensive private cabins.',
   '18 Tariff Street, Manchester, UK',
   'Manchester', 'United Kingdom',
   53.48320000, -2.23480000,
   6, 'business', 'approved', '$$'),

  -- 6.7 Wet Spa and Sauna — Brisbane, Australia
  ('Wet Spa and Sauna',
   'Fully tiled steam room, heated indoor pool, and well-equipped private quarters.',
   '22 Jeays Street, Brisbane, Australia',
   'Brisbane', 'Australia',
   -27.45910000, 153.03520000,
   6, 'business', 'approved', '$$'),

  -- 6.8 H2O Sauna — Benidorm, Spain
  ('H2O Sauna',
   'Relaxed resort-town facility popular with European holidaymakers seeking after-beach relaxation.',
   'Calle Tomás Ortuño 46, Benidorm, Spain',
   'Benidorm', 'Spain',
   38.53420000, -0.13050000,
   6, 'business', 'approved', '$$'),

  -- 6.9 Sauna Thermas 205 — Porto, Portugal
  ('Sauna Thermas 205',
   'Central Porto sauna blending bright spa comforts with moody, low-lit play zones.',
   'Rua Guedes de Azevedo 205, Porto, Portugal',
   'Porto', 'Portugal',
   41.15030000, -8.60560000,
   6, 'business', 'approved', '$$'),

  -- 6.10 Apollion Gay Sauna — Rome, Italy
  ('Apollion Gay Sauna',
   'Rome''s largest bathhouse featuring multi-level Turkish baths and themed play zones.',
   'Via Mecenate 59a, Rome, Italy',
   'Rome', 'Italy',
   41.88870000, 12.51440000,
   6, 'business', 'approved', '$$'),

  -- 6.11 Hamman Sauna & Spa — Panama City, Panama
  ('Hamman Sauna & Spa',
   'Refined Turkish bath-inspired labyrinth in downtown Panama City.',
   'Calle 32 Este, Panama City, Panama',
   'Panama City', 'Panama',
   8.98360000, -79.52420000,
   6, 'business', 'approved', '$$'),

  -- 6.12 Steamworks Edinburgh — Edinburgh, UK
  ('Steamworks Edinburgh',
   'Clean, multi-level facility catering to locals and students near Old Town.',
   '5 Broughton Market, Edinburgh, UK',
   'Edinburgh', 'United Kingdom',
   55.95680000, -3.18810000,
   6, 'business', 'approved', '$$'),

  -- 6.13 Buenos Aires A Full — Buenos Aires, Argentina
  ('Buenos Aires A Full',
   'Large central venue blending traditional wellness with high-energy nightlife elements.',
   'Viamonte 1770, Buenos Aires, Argentina',
   'Buenos Aires', 'Argentina',
   -34.59930000, -58.39310000,
   6, 'business', 'approved', '$$'),

  -- 6.14 Amigo Sauna — Copenhagen, Denmark
  ('Amigo Sauna',
   '800m² facility spanning three floors, central to the city''s gay nightlife hub.',
   'Studiestræde 31 A, Copenhagen, Denmark',
   'Copenhagen', 'Denmark',
   55.67730000, 12.56910000,
   6, 'business', 'approved', '$$'),

  -- 6.15 Clubhouse II — Fort Lauderdale, FL, USA
  ('Clubhouse II',
   'Vintage "Seventy''s Bathhouse" featuring 24-hour access, whirlpools, and video lounges.',
   '2650 E. Oakland Park Blvd, Fort Lauderdale, FL, USA',
   'Fort Lauderdale', 'United States',
   26.16620000, -80.11660000,
   6, 'business', 'approved', '$$'),

  -- 6.16 North Hollywood Spa — Los Angeles, CA, USA
  ('North Hollywood Spa',
   'Massive 12,000 sq ft, two-floor facility with over 100 private rooms and a garden sundeck.',
   '5636 Vineland Ave, Los Angeles, CA, USA',
   'Los Angeles', 'United States',
   34.17020000, -118.36880000,
   6, 'business', 'approved', '$$'),

  -- 6.17 Thermas Lagoa — São Paulo, Brazil
  ('Thermas Lagoa',
   'Iconic multi-level Brazilian sauna offering pools, gym, and expansive cruising areas.',
   'R. Pedro Taques 130, Consolação, São Paulo, Brazil',
   'São Paulo', 'Brazil',
   -23.55380000, -46.65460000,
   6, 'business', 'approved', '$$'),

  -- 6.18 Flex Gay Sauna — Athens, Greece
  ('Flex Gay Sauna',
   'Modern wellness facility in historic Athens equipped with a gym and dedicated erotic zones.',
   'Polikltou 6, Athens, Greece',
   'Athens', 'Greece',
   37.97520000, 23.72840000,
   6, 'business', 'approved', '$$'),

  -- 6.19 't Herenhuis — Antwerp, Belgium
  ('t Herenhuis',
   'Classic townhouse converted into a multi-floor sauna with grand historical aesthetics.',
   'De Lescluzestraat 63, Antwerp, Belgium',
   'Antwerp', 'Belgium',
   51.21510000, 4.40280000,
   6, 'business', 'approved', '$$'),

  -- 6.20 Rio G Spa — Rio de Janeiro, Brazil
  ('Rio G Spa',
   'Tri-level spa directly across from Ipanema''s gay beach with cinema and dark rooms.',
   'Rua Teixeira de Melo 16, Rio de Janeiro, Brazil',
   'Rio de Janeiro', 'Brazil',
   -22.98380000, -43.19780000,
   6, 'business', 'approved', '$$'),

  -- 6.21 Florence Baths — Florence, Italy
  ('Florence Baths',
   'Discreet central location near the Duomo balancing historic aesthetics and sexual play.',
   'Via Guelfa 93, Florence, Italy',
   'Florence', 'Italy',
   43.77630000, 11.25310000,
   6, 'business', 'approved', '$$'),

  -- 6.22 Babylon — Bogotá, Colombia
  ('Babylon',
   'Established metropolitan sauna facility catering to local urban populations.',
   'Calle 73, No 14-32, Bogotá, Colombia',
   'Bogotá', 'Colombia',
   4.66270000, -74.06140000,
   6, 'business', 'approved', '$$'),

  -- 6.23 Atlantix — Bogotá, Colombia
  ('Atlantix',
   'Central bathhouse located within the high-end Rosa commercial zone.',
   'Carrera 13, No 78-47, Bogotá, Colombia',
   'Bogotá', 'Colombia',
   4.66760000, -74.05580000,
   6, 'business', 'approved', '$$'),

  -- 6.24 Bagoas club — Bogotá, Colombia
  ('Bagoas club',
   'Facility dedicated to thermal relaxation and private cruising.',
   'Calle 69 No 10-30, Bogotá, Colombia',
   'Bogotá', 'Colombia',
   4.65480000, -74.06120000,
   6, 'business', 'approved', '$$'),

  -- 6.25 Casa Romana — Bogotá, Colombia
  ('Casa Romana',
   'Architecturally distinct urban sauna providing steam amenities and social spaces.',
   'Calle 35 No 7-24, Bogotá, Colombia',
   'Bogotá', 'Colombia',
   4.62340000, -74.06640000,
   6, 'business', 'approved', '$$'),

  -- 6.26 Complices — Bogotá, Colombia
  ('Complices',
   'Central bathhouse environment focused on social interaction and anonymous encounters.',
   'Carrera 13A No 38-60, Bogotá, Colombia',
   'Bogotá', 'Colombia',
   4.62770000, -74.06430000,
   6, 'business', 'approved', '$$'),

  -- 6.27 El Mediterraneo — Bogotá, Colombia
  ('El Mediterraneo',
   'Established gay sauna offering steam rooms and private accommodations.',
   'Calle 66 No 10-15, Bogotá, Colombia',
   'Bogotá', 'Colombia',
   4.65090000, -74.06200000,
   6, 'business', 'approved', '$$')

ON CONFLICT (name, address) DO NOTHING;
