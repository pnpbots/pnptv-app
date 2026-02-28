-- Migration 087: Seed Bars & Clubs (Category 7)
-- Inserts 27 pre-approved LGBTQ+ bars and clubs with geocoded coordinates
-- Safe to re-run: uses unique index + ON CONFLICT DO NOTHING
-- (unique index idx_nearby_places_name_address created in migration 086)

INSERT INTO nearby_places
  (name, description, address, city, country, location_lat, location_lng, category_id, place_type, status, price_range)
VALUES
  -- 7.1 Berghain — Berlin, Germany
  ('Berghain',
   'Legendary techno temple in a former power station; iconic queer nightlife institution with marathon weekend parties.',
   'Am Wriezener Bahnhof, Berlin, Germany',
   'Berlin', 'Germany',
   52.51110000, 13.44100000,
   7, 'business', 'approved', '$$$'),

  -- 7.2 SchwuZ — Berlin, Germany
  ('SchwuZ',
   'Berlin''s oldest queer club featuring multi-floor dance areas, drag shows, and themed party nights since 1977.',
   'Rollbergstraße 26, Berlin, Germany',
   'Berlin', 'Germany',
   52.47790000, 13.43200000,
   7, 'business', 'approved', '$$'),

  -- 7.3 Heaven — London, UK
  ('Heaven',
   'Iconic nightclub under the Charing Cross arches; one of London''s longest-running gay venues since 1979.',
   'The Arches, Villiers Street, London, UK',
   'London', 'United Kingdom',
   51.50780000, -0.12380000,
   7, 'business', 'approved', '$$'),

  -- 7.4 G-A-Y Late — London, UK
  ('G-A-Y Late',
   'Legendary Soho late-night venue with pop music, cheap drinks, and a welcoming atmosphere for all.',
   '5 Goslett Yard, London, UK',
   'London', 'United Kingdom',
   51.51300000, -0.13020000,
   7, 'business', 'approved', '$$'),

  -- 7.5 The Abbey — Los Angeles, CA, USA
  ('The Abbey',
   'West Hollywood landmark and one of America''s most famous gay bars; expansive outdoor patio and craft cocktails.',
   '692 N Robertson Blvd, West Hollywood, CA, USA',
   'Los Angeles', 'United States',
   34.08360000, -118.38430000,
   7, 'business', 'approved', '$$$'),

  -- 7.6 Stonewall Inn — New York, NY, USA
  ('Stonewall Inn',
   'Historic birthplace of the modern LGBTQ+ rights movement; still operating as a bar and national monument.',
   '53 Christopher St, New York, NY, USA',
   'New York', 'United States',
   40.73390000, -74.00210000,
   7, 'business', 'approved', '$$'),

  -- 7.7 Julius'' Bar — New York, NY, USA
  ('Julius'' Bar',
   'NYC''s oldest operating gay bar dating to 1966; cozy dive-bar atmosphere in the West Village.',
   '159 W 10th St, New York, NY, USA',
   'New York', 'United States',
   40.73370000, -74.00170000,
   7, 'business', 'approved', '$$'),

  -- 7.8 Theatron — Bogota, Colombia
  ('Theatron',
   'Massive 5,000-capacity multi-room mega-club; one of the largest LGBTQ+ venues in Latin America.',
   'Calle 58 No 10-18, Bogota, Colombia',
   'Bogota', 'Colombia',
   4.64510000, -74.06400000,
   7, 'business', 'approved', '$$'),

  -- 7.9 El Chapinero — Bogota, Colombia
  ('El Mozo',
   'Trendy cocktail bar in the heart of Chapinero, Bogota''s vibrant LGBTQ+ district.',
   'Calle 64 No 9-17, Bogota, Colombia',
   'Bogota', 'Colombia',
   4.65130000, -74.06230000,
   7, 'business', 'approved', '$$'),

  -- 7.10 Via Appia — Bogota, Colombia
  ('Via Appia',
   'Popular LGBTQ+ nightclub in Chapinero featuring reggaeton, electronic music, and themed nights.',
   'Carrera 13 No 63-27, Bogota, Colombia',
   'Bogota', 'Colombia',
   4.65040000, -74.06120000,
   7, 'business', 'approved', '$$'),

  -- 7.11 Theatron de Pelicula — Bucaramanga, Colombia
  ('Theatron de Pelicula',
   'Regional LGBTQ+ anchor venue in conservative Santander region; multi-room entertainment complex.',
   'Calle 34 No 31-23, Bucaramanga, Colombia',
   'Bucaramanga', 'Colombia',
   7.12540000, -73.12270000,
   7, 'business', 'approved', '$$'),

  -- 7.12 The Cock — Amsterdam, Netherlands
  ('The Cock',
   'Trendy cocktail bar on Amstel with terrace views; popular pre-party spot in Amsterdam''s gay heart.',
   'Amstel 54, Amsterdam, Netherlands',
   'Amsterdam', 'Netherlands',
   52.36640000, 4.89870000,
   7, 'business', 'approved', '$$'),

  -- 7.13 Cafe t Mandje — Amsterdam, Netherlands
  ('Cafe t Mandje',
   'Historic bar opened in 1927; one of the world''s first openly LGBTQ+ establishments.',
   'Zeedijk 63, Amsterdam, Netherlands',
   'Amsterdam', 'Netherlands',
   52.37440000, 4.90010000,
   7, 'business', 'approved', '$$'),

  -- 7.14 Punto G Bar — Buenos Aires, Argentina
  ('Punto G Bar',
   'Vibrant Palermo nightlife staple with drag performances, DJs, and a packed weekend dance floor.',
   'Av. Cordoba 4785, Buenos Aires, Argentina',
   'Buenos Aires', 'Argentina',
   -34.59350000, -58.42780000,
   7, 'business', 'approved', '$$'),

  -- 7.15 A Bar of Their Own — Minneapolis, MN, USA
  ('A Bar of Their Own',
   'Pioneering queer women''s sports bar; intersectional inclusivity space with big-screen sports and events.',
   '672 Selby Ave, Saint Paul, MN, USA',
   'Saint Paul', 'United States',
   44.94680000, -93.12400000,
   7, 'business', 'approved', '$$'),

  -- 7.16 Chueca District Bar — Madrid, Spain
  ('Dlite Club',
   'High-energy LGBTQ+ dance club in the heart of Madrid''s Chueca neighborhood.',
   'Calle de Pelayo 59, Madrid, Spain',
   'Madrid', 'Spain',
   40.42290000, -3.69780000,
   7, 'business', 'approved', '$$'),

  -- 7.17 Axel Hotel Sky Bar — Barcelona, Spain
  ('Axel Hotel Sky Bar',
   'Rooftop bar atop the iconic LGBTQ+ hotel in Barcelona''s Eixample gayborhood; pool and panoramic views.',
   'Carrer d''Aribau 33, Barcelona, Spain',
   'Barcelona', 'Spain',
   41.38690000, 2.16110000,
   7, 'business', 'approved', '$$$'),

  -- 7.18 Le Marais Cafe Cox — Paris, France
  ('Cafe Cox',
   'Iconic Le Marais cruising bar; bustling terrace and packed interior in the heart of gay Paris.',
   '15 Rue des Archives, Paris, France',
   'Paris', 'France',
   48.85780000, 2.35370000,
   7, 'business', 'approved', '$$'),

  -- 7.19 Rosas Bar — Paris, France
  ('Rosas Bar',
   'Intimate Le Marais cocktail bar with a warm atmosphere and expertly crafted drinks.',
   '10 Rue de la Verrerie, Paris, France',
   'Paris', 'France',
   48.85590000, 2.35200000,
   7, 'business', 'approved', '$$'),

  -- 7.20 The Week — Sao Paulo, Brazil
  ('The Week',
   'Massive 6,000-capacity superclub; one of South America''s premier LGBTQ+ circuit party destinations.',
   'Rua Guaicurus 324, Sao Paulo, Brazil',
   'Sao Paulo', 'Brazil',
   -23.52610000, -46.66730000,
   7, 'business', 'approved', '$$$'),

  -- 7.21 Alegria — Sao Paulo, Brazil
  ('Alegria',
   'Iconic party brand hosting massive LGBTQ+ electronic music events across Sao Paulo venues.',
   'Rua Augusta 765, Sao Paulo, Brazil',
   'Sao Paulo', 'Brazil',
   -23.55340000, -46.65450000,
   7, 'business', 'approved', '$$'),

  -- 7.22 Arq — Sydney, Australia
  ('Arq',
   'Sydney''s premier multi-level gay nightclub in Darlinghurst with world-class DJs and themed nights.',
   '16 Flinders St, Sydney, Australia',
   'Sydney', 'Australia',
   -33.87800000, 151.21480000,
   7, 'business', 'approved', '$$'),

  -- 7.23 Shinjuku Ni-chome Dragon — Tokyo, Japan
  ('Dragon Men',
   'Stylish cocktail bar in Shinjuku Ni-chome, Tokyo''s legendary LGBTQ+ district.',
   '2-11-4 Shinjuku, Tokyo, Japan',
   'Tokyo', 'Japan',
   35.69210000, 139.70710000,
   7, 'business', 'approved', '$$'),

  -- 7.24 Noa Noa — Mexico City, Mexico
  ('Noa Noa',
   'Legendary Mexico City LGBTQ+ venue named after Juan Gabriel''s iconic song; cultural institution.',
   'Calle Marroqui 38, Mexico City, Mexico',
   'Mexico City', 'Mexico',
   19.42800000, -99.13490000,
   7, 'business', 'approved', '$$'),

  -- 7.25 Mala Conducta — Medellin, Colombia
  ('Mala Conducta',
   'Popular LGBTQ+ bar and club in Medellin''s Parque Lleras nightlife zone.',
   'Carrera 40 No 10-21, Medellin, Colombia',
   'Medellin', 'Colombia',
   6.20880000, -75.57150000,
   7, 'business', 'approved', '$$'),

  -- 7.26 Bar Frida — Copenhagen, Denmark
  ('Bar Frida',
   'Cozy neighborhood queer bar in the heart of Copenhagen with a welcoming, diverse crowd.',
   'Studiestrade 24, Copenhagen, Denmark',
   'Copenhagen', 'Denmark',
   55.67720000, 12.56970000,
   7, 'business', 'approved', '$$'),

  -- 7.27 Eagle Toronto — Toronto, Canada
  ('Eagle Toronto',
   'Iconic leather and fetish bar in the Village; a cornerstone of Toronto''s alternative queer nightlife.',
   '457 Church St, Toronto, Canada',
   'Toronto', 'Canada',
   43.66390000, -79.38150000,
   7, 'business', 'approved', '$$')

ON CONFLICT (name, address) DO NOTHING;
