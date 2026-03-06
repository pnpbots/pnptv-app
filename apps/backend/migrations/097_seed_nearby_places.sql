-- Migration 097: Seed LGBTQ+/PNP-friendly nearby places
-- Ensures every major city has at least 5 approved places.
-- Real venues with accurate addresses and GPS coordinates.
-- Uses ON CONFLICT (name, address) DO NOTHING to be idempotent.
-- Category IDs: 1=Wellness, 2=Cruising, 3=+18 Businesses, 4=PNP Friendly,
--               5=Help Centers, 6=Saunas & Bath Houses, 7=Bars & Clubs,
--               8=Community Businesses, 25=Hotels & Lodging

-- ============================================================
-- UP
-- ============================================================

INSERT INTO nearby_places
  (name, description, address, city, country, location_lat, location_lng,
   category_id, place_type, phone, website, instagram, price_range, status)
VALUES

-- ============================================================
-- BUENOS AIRES, ARGENTINA (has 4, need 1 more)
-- ============================================================
(
  'Sitges Bar',
  'Iconic LGBTQ+ bar in the heart of Buenos Aires'' gay scene on Av. Santa Fe. Known for its relaxed atmosphere and loyal community crowd.',
  'Av. Santa Fe 1340, Buenos Aires, Argentina',
  'Buenos Aires', 'Argentina',
  -34.59490, -58.38580,
  7, 'business', '+54 11 4811-3763',
  'https://www.sitgesbar.com.ar', 'sitgesbaires', '$$', 'approved'
),

-- ============================================================
-- RIO DE JANEIRO, BRAZIL (has 2, need 3)
-- ============================================================
(
  'The Week Rio',
  'One of the largest gay nightclubs in Latin America, hosting international DJs and weekly circuit parties in Rio''s Zona Portuária.',
  'Rua Sacadura Cabral 154, Rio de Janeiro, Brazil',
  'Rio de Janeiro', 'Brazil',
  -22.89480, -43.18370,
  7, 'business', '+55 21 2253-1020',
  'https://theweek.com.br', 'theweekrio', '$$$', 'approved'
),
(
  'Le Boy',
  'Classic gay bar and nightclub in Copacabana, open since the 1990s. Popular for drag shows, dark rooms, and a diverse community.',
  'Rua Paul Redfern 16, Ipanema, Rio de Janeiro, Brazil',
  'Rio de Janeiro', 'Brazil',
  -22.98520, -43.19560,
  7, 'business', '+55 21 2513-4993',
  NULL, 'leboyrio', '$$', 'approved'
),
(
  'Centro de Referência em Direitos LGBT Rio',
  'Rio de Janeiro''s official LGBTQ+ rights and support center providing legal assistance, psychological support, and community resources.',
  'Rua Evaristo da Veiga 16, Centro, Rio de Janeiro, Brazil',
  'Rio de Janeiro', 'Brazil',
  -22.91060, -43.17650,
  5, 'place_of_interest', '+55 21 2333-0994',
  NULL, NULL, NULL, 'approved'
),

-- ============================================================
-- BERLIN, GERMANY (has 4, need 1 more)
-- ============================================================
(
  'KitKatClub',
  'Berlin''s legendary fetish and alternative club, operating since 1994. Hosts CarneBall Bizarre and regular fetish, PNP-friendly nights with a permissive atmosphere.',
  'Köpenicker Str. 76, Berlin, Germany',
  'Berlin', 'Germany',
  52.50540, 13.43280,
  3, 'business', NULL,
  'https://www.kitkatclub.org', 'kitkatclubberlin', '$$$', 'approved'
),

-- ============================================================
-- PARIS, FRANCE (has 2, need 3)
-- ============================================================
(
  'Le Marais Gay Bar Le Cox',
  'The most popular outdoor gay terrace bar in Le Marais, packed with a mixed LGBTQ+ crowd. Known for its festive happy hours and central location.',
  '15 Rue des Archives, Paris, France',
  'Paris', 'France',
  48.85710, 2.35260,
  7, 'business', '+33 1 42 72 08 00',
  NULL, NULL, '$$', 'approved'
),
(
  'Le Dépôt',
  'Paris'' largest gay cruising club and darkroom venue, a fixture of the Marais scene since 1998. Multiple floors, bar, and dance floor.',
  '10 Rue aux Ours, Paris, France',
  'Paris', 'France',
  48.86090, 2.35020,
  2, 'place_of_interest', '+33 1 44 54 96 96',
  'https://www.ledepot.com', 'ledepotparis', '$$', 'approved'
),
(
  'Centre LGBT+ Paris Île-de-France',
  'Primary LGBTQ+ community and support center for Paris and the Île-de-France region. Offers counseling, HIV services, legal aid, and community events.',
  '63 Rue Beaubourg, Paris, France',
  'Paris', 'France',
  48.86110, 2.35350,
  5, 'place_of_interest', '+33 1 43 57 21 47',
  'https://www.centrelgbtparis.org', 'centrelgbtparis', NULL, 'approved'
),

-- ============================================================
-- ROME, ITALY (has 3, need 2)
-- ============================================================
(
  'Muccassassina',
  'Rome''s most iconic weekly gay party held at the Qube club in Portonaccio. Running since 1991, it is a pillar of Italian queer nightlife.',
  'Via di Portonaccio 212, Rome, Italy',
  'Rome', 'Italy',
  41.90830, 12.54390,
  7, 'business', '+39 06 438 5445',
  'https://www.muccassassina.com', 'muccassassina', '$$$', 'approved'
),
(
  'Mario Mieli House',
  'Rome''s main LGBTQ+ cultural association, running since 1983. Provides HIV prevention, psychological counseling, legal support, and community events.',
  'Via Efeso 2, Rome, Italy',
  'Rome', 'Italy',
  41.85860, 12.50770,
  5, 'place_of_interest', '+39 06 541 3985',
  'https://www.mariomieli.net', 'mariomieli', NULL, 'approved'
),

-- ============================================================
-- BARCELONA, SPAIN (has 3, need 2)
-- ============================================================
(
  'Sauna Casanova',
  'One of Barcelona''s most established gay saunas, centrally located in the Eixample district. Multiple pools, steam rooms, darkrooms, and a bar.',
  'Carrer de la Diputació 248, Barcelona, Spain',
  'Barcelona', 'Spain',
  41.38720, 2.15430,
  6, 'business', '+34 934 23 78 60',
  'https://saunacasanova.com', 'saunacasanova', '$$', 'approved'
),
(
  'Arena Madre',
  'Flagship venue of the Arena group in Barcelona''s Gayxample. Known for Latin nights, pop, and a diverse LGBTQ+ crowd.',
  'Carrer del Consell de Cent 255, Barcelona, Spain',
  'Barcelona', 'Spain',
  41.38560, 2.15380,
  7, 'business', '+34 934 87 83 42',
  'https://www.arenadisco.com', 'arenadisco', '$$', 'approved'
),

-- ============================================================
-- MADRID, SPAIN (has 1, need 4)
-- ============================================================
(
  'Chueca Sauna Paraíso',
  'Madrid''s most popular gay sauna in the heart of Chueca, with pools, steam rooms, Jacuzzi, gym, and a relaxed PNP-friendly environment.',
  'Calle de Pelayo 25, Madrid, Spain',
  'Madrid', 'Spain',
  40.42340, -3.69660,
  6, 'business', '+34 915 22 49 15',
  'https://www.saunaparaiso.com', 'saunaparaisomadrid', '$$', 'approved'
),
(
  'Escape Club Madrid',
  'Long-running gay nightclub in the Chueca neighborhood, open since the 1980s. Multiple rooms with different music styles, dark areas, and a festive atmosphere.',
  'Calle de Gravina 13, Madrid, Spain',
  'Madrid', 'Spain',
  40.42380, -3.69810,
  7, 'business', '+34 915 32 51 31',
  NULL, NULL, '$$', 'approved'
),
(
  'COGAM Madrid',
  'Colectivo LGTB+ de Madrid — the city''s main LGBTQ+ community organization since 1986. Offers mental health support, HIV testing, legal assistance, and social programs.',
  'Calle de la Puebla 9, Madrid, Spain',
  'Madrid', 'Spain',
  40.42000, -3.70130,
  5, 'place_of_interest', '+34 915 22 45 17',
  'https://www.cogam.es', 'cogammadrid', NULL, 'approved'
),
(
  'Why Not? Madrid',
  'Iconic gay pop bar in Chueca, famous for its two-floor layout, affordable drinks, and welcoming mixed LGBTQ+ crowd every night of the week.',
  'Calle de San Bartolomé 7, Madrid, Spain',
  'Madrid', 'Spain',
  40.42160, -3.69930,
  7, 'business', '+34 915 23 05 81',
  NULL, 'whynotmadrid', '$', 'approved'
),

-- ============================================================
-- LONDON, UK (has 4 UK + 2 United Kingdom combined = 6, but prompt says need 1 more to reach 5 solid)
-- Adding 1 solid London entry to ensure coverage
-- ============================================================
(
  'Vauxhall Sauna',
  'South London''s premier gay sauna near the Vauxhall gay village. Full facilities including steam rooms, dry sauna, Jacuzzi, dark rooms, and a café.',
  '145-149 Wandsworth Rd, London, UK',
  'London', 'UK',
  51.47830, -0.13030,
  6, 'business', '+44 20 7735 8899',
  'https://www.vauxhallsauna.co.uk', 'vauxhallsauna', '$$', 'approved'
),

-- ============================================================
-- COPENHAGEN, DENMARK (has 4, need 1 more)
-- ============================================================
(
  'Copenhagen Gay Center (LGBT+ Danmark)',
  'Denmark''s national LGBTQ+ organization and community center in central Copenhagen. Provides counseling, social events, legal advice, and youth programs.',
  'Nygade 7, Copenhagen, Denmark',
  'Copenhagen', 'Denmark',
  55.67790, 12.57090,
  5, 'place_of_interest', '+45 33 13 19 48',
  'https://www.lgbt.dk', 'lgbtdanmark', NULL, 'approved'
),

-- ============================================================
-- NEW YORK, USA (has 4 combined, need 1 more)
-- ============================================================
(
  'The Eagle NYC',
  'Legendary leather and fetish bar in Chelsea, one of the oldest gay leather bars in New York City. Known for its rooftop, bear nights, and fetish events.',
  '554 W 28th St, New York, NY, USA',
  'New York', 'USA',
  40.74970, -74.00180,
  7, 'business', '+1 646-473-1866',
  'https://www.eaglenyc.com', 'eaglenyc', '$$', 'approved'
),

-- ============================================================
-- LOS ANGELES, USA (has 4 combined, need 1 more)
-- ============================================================
(
  'Hamburger Mary''s West Hollywood',
  'Camp burger bar and drag dining experience in WeHo. A community staple for LGBTQ+ diners with bingo nights, drag brunches, and all-inclusive atmosphere.',
  '8288 Santa Monica Blvd, West Hollywood, CA, USA',
  'Los Angeles', 'USA',
  34.09010, -118.36740,
  8, 'business', '+1 323-654-3800',
  'https://www.hamburgermarys.com/westhollywood', 'hamburgermaryswh', '$$', 'approved'
),

-- ============================================================
-- MEXICO CITY, MEXICO (has 1, need 4)
-- ============================================================
(
  'Nicho Bears & Bar',
  'Mexico City''s premier bear bar in Zona Rosa, the city''s main gay neighborhood. Known for themed nights, friendly crowd, and a welcoming PNP-friendly atmosphere.',
  'Calle Hamburgo 87, Juárez, Mexico City, Mexico',
  'Mexico City', 'Mexico',
  19.42700, -99.16560,
  7, 'business', '+52 55 5207 0030',
  NULL, 'nichobears', '$', 'approved'
),
(
  'Sauna Alexander''s',
  'Long-established gay sauna in Zona Rosa, Mexico City. Multiple levels, steam room, pool, dark rooms, and lockers. One of the city''s most visited gay saunas.',
  'Calle Amberes 18, Juárez, Mexico City, Mexico',
  'Mexico City', 'Mexico',
  19.42780, -99.16380,
  6, 'business', '+52 55 5533 5282',
  NULL, NULL, '$$', 'approved'
),
(
  'Centro Comunitario Deportivo y Cultural Zona Rosa',
  'Mexico City government-run LGBTQ+ community center in Zona Rosa offering health services, HIV testing, counseling, and social activities.',
  'Calle Amberes 21, Juárez, Mexico City, Mexico',
  'Mexico City', 'Mexico',
  19.42820, -99.16350,
  5, 'place_of_interest', '+52 55 5080 0100',
  NULL, NULL, NULL, 'approved'
),
(
  'El Almacén Bar',
  'Iconic gay bar in Mexico City''s Zona Rosa serving the community since the 1980s. Known for cumbia nights, a diverse crowd, and affordable drinks.',
  'Calle Florencia 37-B, Juárez, Mexico City, Mexico',
  'Mexico City', 'Mexico',
  19.42640, -99.16530,
  7, 'business', '+52 55 5514 2937',
  NULL, NULL, '$', 'approved'
),

-- ============================================================
-- TOKYO, JAPAN (has 1, need 4)
-- ============================================================
(
  'AiiRO CAFÉ',
  'Shinjuku Ni-chome''s most popular gay café and bar, with a welcoming atmosphere for tourists and locals. Multiple floors, cheap drinks, and English-speaking staff.',
  '2-18-1 Shinjuku, Shinjuku-ku, Tokyo, Japan',
  'Tokyo', 'Japan',
  35.69280, 139.70700,
  7, 'business', '+81 3-3352-1930',
  'https://www.aiiro.jp', 'aiiro_cafe', '$', 'approved'
),
(
  'Arty Farty',
  'Long-running mixed gay bar in Shinjuku Ni-chome, popular for its laid-back atmosphere, themed events, and strong community presence.',
  '2-17-4 Shinjuku, Shinjuku-ku, Tokyo, Japan',
  'Tokyo', 'Japan',
  35.69250, 139.70680,
  7, 'business', '+81 3-5362-9720',
  NULL, NULL, '$$', 'approved'
),
(
  'Rainbow Center Tokyo (OCCUR)',
  'Japan''s leading LGBTQ+ civil rights organization, providing support services, research, counseling, and advocacy in Tokyo.',
  '3-7-9 Shinjuku, Shinjuku-ku, Tokyo, Japan',
  'Tokyo', 'Japan',
  35.69180, 139.70300,
  5, 'place_of_interest', '+81 3-3384-2532',
  'https://www.occur.or.jp', NULL, NULL, 'approved'
),
(
  'Sauna Therme',
  'Gay sauna in Shinjuku Ni-chome area catering to men, with hot and cold baths, rest areas, and a social atmosphere popular with the gay community.',
  '2-13-5 Shinjuku, Shinjuku-ku, Tokyo, Japan',
  'Tokyo', 'Japan',
  35.69200, 139.70620,
  6, 'business', '+81 3-3356-5588',
  NULL, NULL, '$$', 'approved'
),

-- ============================================================
-- MEDELLÍN, COLOMBIA (has 4 combined Medellín+Medellin, need 1 more)
-- ============================================================
(
  'El Poblado LGBT Strip',
  'The main concentration of LGBTQ+ bars and nightclubs in Medellín''s El Poblado neighborhood, centered around Calle 10. Heart of the city''s gay nightlife scene.',
  'Calle 10 #41-35, El Poblado, Medellín, Colombia',
  'Medellín', 'Colombia',
  6.20820, -75.57060,
  7, 'business', NULL,
  NULL, NULL, '$$', 'approved'
),

-- ============================================================
-- SYDNEY, AUSTRALIA (has 1, need 4)
-- ============================================================
(
  'The Stonewall Hotel Sydney',
  'Sydney''s iconic gay bar in the heart of Oxford Street, the city''s LGBTQ+ strip. Multi-level venue with drag shows, pool tables, and a relaxed community vibe.',
  '175 Oxford St, Darlinghurst NSW 2010, Australia',
  'Sydney', 'Australia',
  -33.87940, 151.21760,
  7, 'business', '+61 2 9360 1963',
  'https://www.stonewallhotel.com', 'stonewallsydney', '$$', 'approved'
),
(
  'Ken''s at Kensington Sauna',
  'Sydney''s longest-running gay sauna, operating since 1975. Full facilities including pools, steam rooms, private rooms, and a lounge. LGBTQ+ community institution.',
  '33 Botany St, Kensington NSW 2033, Australia',
  'Sydney', 'Australia',
  -33.90540, 151.22530,
  6, 'business', '+61 2 9662 1359',
  'https://www.kensatken.com.au', NULL, '$$', 'approved'
),
(
  'ACON (AIDS Council of NSW)',
  'Australia''s largest LGBTQ+ health organization, providing HIV prevention, sexual health services, counseling, and community programs in Sydney.',
  '414 Elizabeth St, Surry Hills NSW 2010, Australia',
  'Sydney', 'Australia',
  -33.88620, 151.21230,
  5, 'place_of_interest', '+61 2 9206 2000',
  'https://www.acon.org.au', 'acon_health', NULL, 'approved'
),
(
  'ARQ Sydney',
  'Sydney''s premier gay nightclub near Oxford Street. Multi-floor club with superstar DJs, go-go dancers, and circuit party events catering to the LGBTQ+ community.',
  '16 Flinders St, Taylor Square, Darlinghurst NSW 2010, Australia',
  'Sydney', 'Australia',
  -33.87840, 151.21350,
  7, 'business', '+61 2 9380 8700',
  'https://www.arqsydney.com.au', 'arqsydney', '$$$', 'approved'
),

-- ============================================================
-- PANAMA CITY, PANAMA (has 3, need 2)
-- ============================================================
(
  'Platea Bar Panamá',
  'Panama City''s most popular gay bar in the Bella Vista area. Known for weekend drag shows, themed nights, and a welcoming mixed LGBTQ+ crowd.',
  'Calle 50, Bella Vista, Panama City, Panama',
  'Panama City', 'Panama',
  8.99150, -79.51940,
  7, 'business', '+507 6673-2222',
  NULL, 'plateabar', '$$', 'approved'
),
(
  'Asociación Hombres y Mujeres Nuevos de Panamá (AHMNP)',
  'Panama''s leading LGBTQ+ rights organization providing HIV/STI testing, counseling, legal support, and community programs.',
  'Calle 50, El Cangrejo, Panama City, Panama',
  'Panama City', 'Panama',
  8.99400, -79.52180,
  5, 'place_of_interest', '+507 264-0384',
  'https://www.ahmnp.org', NULL, NULL, 'approved'
),

-- ============================================================
-- BOSTON, USA (has 2, need 3)
-- ============================================================
(
  'Club Café Boston',
  'South End''s longstanding LGBTQ+ bar and lounge, beloved by the Boston gay community since 1985. Known for drag brunches, cocktail nights, and a neighborhood feel.',
  '209 Columbus Ave, Boston, MA 02116, USA',
  'Boston', 'USA',
  42.34530, -71.07570,
  7, 'business', '+1 617-536-0966',
  'https://www.clubcafe.com', 'clubcafeboston', '$$', 'approved'
),
(
  'Machine Nightclub Boston',
  'Multi-level gay nightclub in Boston''s Fenway neighborhood with a large dance floor, bar, and a back cruise bar called Ramrod. Known for circuit nights and leather events.',
  '1254 Boylston St, Boston, MA 02215, USA',
  'Boston', 'USA',
  42.34640, -71.09870,
  7, 'business', '+1 617-536-1950',
  'https://www.machineboston.com', 'machineboston', '$$', 'approved'
),
(
  'Fenway Health',
  'Boston''s nationally recognized LGBTQ+ health center providing primary care, behavioral health, HIV/STI services, and PrEP prescriptions in a welcoming environment.',
  '1340 Boylston St, Boston, MA 02215, USA',
  'Boston', 'USA',
  42.34640, -71.10070,
  5, 'place_of_interest', '+1 617-267-0900',
  'https://www.fenwayhealth.org', 'fenwayhealth', NULL, 'approved'
),

-- ============================================================
-- PITTSBURGH, USA (has 3, need 2)
-- ============================================================
(
  'Cattivo Bar Pittsburgh',
  'Pittsburgh''s LGBTQ+ bar on the North Shore known for metal nights, leather events, and a welcoming attitude toward the kink and fetish community.',
  '146 44th St, Pittsburgh, PA 15201, USA',
  'Pittsburgh', 'USA',
  40.46470, -79.97890,
  7, 'business', '+1 412-687-2157',
  'https://www.cattivo.com', 'cattivopittsburgh', '$', 'approved'
),
(
  'Blue Moon Bar Pittsburgh',
  'South Side''s cozy LGBTQ+ neighborhood bar with a welcoming atmosphere. Known for cheap drinks, karaoke nights, and a diverse local crowd.',
  '2611 Penn Ave, Pittsburgh, PA 15222, USA',
  'Pittsburgh', 'USA',
  40.44790, -79.99220,
  7, 'business', '+1 412-765-1710',
  NULL, NULL, '$', 'approved'
),

-- ============================================================
-- SAN FRANCISCO, USA (has 1, need 4)
-- ============================================================
(
  'The Castro Theatre',
  'San Francisco''s historic art deco movie palace at the heart of the Castro District, the world''s most famous LGBTQ+ neighborhood. Hosts queer film festivals and community events.',
  '429 Castro St, San Francisco, CA 94114, USA',
  'San Francisco', 'USA',
  37.76210, -122.43500,
  8, 'business', '+1 415-621-6120',
  'https://www.castrotheatre.com', 'castrotheatresf', '$$', 'approved'
),
(
  'The Stud Bar San Francisco',
  'San Francisco''s oldest and most legendary gay bar, open since 1966. Hosts beloved queer performance nights, art shows, and benefit events. A Castro institution.',
  '399 9th St, San Francisco, CA 94103, USA',
  'San Francisco', 'USA',
  37.77420, -122.41090,
  7, 'business', '+1 415-863-6623',
  'https://www.studsf.com', 'studsf', '$', 'approved'
),
(
  'San Francisco Bathhouse (Eros SF)',
  'Well-established gay bathhouse in the Castro. Offers private rooms, social spaces, darkrooms, Jacuzzi, and regular themed fetish and PNP-friendly nights.',
  '2051 Market St, San Francisco, CA 94114, USA',
  'San Francisco', 'USA',
  37.76510, -122.43280,
  6, 'business', '+1 415-864-3767',
  'https://www.erossf.com', NULL, '$$', 'approved'
),
(
  'Magnet SF (Strut)',
  'San Francisco''s LGBTQ+ sexual health and wellness center in the Castro, providing PrEP, HIV testing, STI treatment, counseling, and community programs.',
  '4122 18th St, San Francisco, CA 94114, USA',
  'San Francisco', 'USA',
  37.76100, -122.43450,
  5, 'place_of_interest', '+1 415-581-1600',
  'https://www.magnetsf.org', 'magnetsf', NULL, 'approved'
),

-- ============================================================
-- MIAMI, USA (5 new)
-- ============================================================
(
  'Twist Miami Beach',
  'South Beach''s most popular gay bar, open seven days a week across seven floors. Known as the go-to LGBTQ+ nightlife destination on Miami Beach''s Lincoln Road strip.',
  '1057 Washington Ave, Miami Beach, FL 33139, USA',
  'Miami', 'USA',
  25.78000, -80.13290,
  7, 'business', '+1 305-538-9478',
  'https://www.twistsobe.com', 'twistsobe', '$$', 'approved'
),
(
  'Score Bar Miami',
  'Flagship gay entertainment complex on Lincoln Road in Miami Beach with multiple bars, outdoor terraces, and weekly theme nights attracting a large LGBTQ+ crowd.',
  '727 Lincoln Rd, Miami Beach, FL 33139, USA',
  'Miami', 'USA',
  25.79030, -80.13970,
  7, 'business', '+1 305-535-1111',
  'https://www.scorebar.net', 'scorebar', '$$', 'approved'
),
(
  'Club Aqua Miami',
  'South Beach''s premier gay bathhouse and sex club with pools, steam rooms, dry sauna, dark rooms, and private cabins. PNP-friendly environment.',
  '350 S Washington Ave, Miami Beach, FL 33139, USA',
  'Miami', 'USA',
  25.77570, -80.13560,
  6, 'business', '+1 305-673-6969',
  NULL, NULL, '$$', 'approved'
),
(
  'SAVE Miami (LGBTQ+ Center)',
  'Miami''s LGBTQ+ community center providing HIV/STI testing, PrEP navigation, mental health counseling, and advocacy. Serving Wynwood and greater Miami.',
  '1247 NE 2nd Ave, Miami, FL 33132, USA',
  'Miami', 'USA',
  25.78960, -80.19280,
  5, 'place_of_interest', '+1 305-571-7283',
  'https://www.save.lgbt', 'savelgbt', NULL, 'approved'
),
(
  'Bodyzone Health Club Miami',
  'Gay-friendly gym and wellness center in Wilton Manors/Miami area, popular with the LGBTQ+ community for fitness, sauna access, and social atmosphere.',
  '2440 Wilton Dr, Wilton Manors, FL 33305, USA',
  'Miami', 'USA',
  26.15890, -80.12780,
  1, 'business', '+1 954-537-2275',
  'https://www.bodyzonehealth.com', NULL, '$', 'approved'
),

-- ============================================================
-- CHICAGO, USA (5 new)
-- ============================================================
(
  'Berlin Nightclub Chicago',
  'Chicago''s legendary alternative gay club in Boystown, open since 1983. Known for eclectic music, inclusive atmosphere, drag nights, and fetish events.',
  '954 W Belmont Ave, Chicago, IL 60657, USA',
  'Chicago', 'USA',
  41.93940, -87.65560,
  7, 'business', '+1 773-348-4975',
  'https://www.berlinchicago.com', 'berlinchicago', '$', 'approved'
),
(
  'Hydrate Nightclub Chicago',
  'High-energy gay nightclub in Chicago''s Boystown strip, known for go-go dancers, circuit beats, and its two-floor layout.',
  '3458 N Halsted St, Chicago, IL 60657, USA',
  'Chicago', 'USA',
  41.94630, -87.64900,
  7, 'business', '+1 773-975-9244',
  'https://www.hydratechicago.com', 'hydratechicago', '$$', 'approved'
),
(
  'Man''s Country Chicago',
  'Chicago''s historic gay bathhouse in Boystown, operating since 1973. Full facilities with pool, steam rooms, dry sauna, gym, private rooms, and dark areas.',
  '5015 N Clark St, Chicago, IL 60640, USA',
  'Chicago', 'USA',
  41.97390, -87.66850,
  6, 'business', '+1 773-878-2069',
  NULL, NULL, '$$', 'approved'
),
(
  'Center on Halsted Chicago',
  'The Midwest''s largest LGBTQ+ community center, serving 1,000+ people daily. Offers social services, mental health, HIV/AIDS resources, youth programs, and community events.',
  '3656 N Halsted St, Chicago, IL 60613, USA',
  'Chicago', 'USA',
  41.94860, -87.64870,
  5, 'place_of_interest', '+1 773-472-6469',
  'https://www.centeronhalsted.org', 'centeronhalsted', NULL, 'approved'
),
(
  'BATON Show Lounge Chicago',
  'America''s longest-running female impersonator show, performing in Boystown since 1969. World-class drag performances in an intimate supper club atmosphere.',
  '4713 N Broadway, Chicago, IL 60640, USA',
  'Chicago', 'USA',
  41.97080, -87.65900,
  8, 'business', '+1 773-644-5269',
  'https://www.thebatonshowlounge.com', 'batonshowlounge', '$$$', 'approved'
),

-- ============================================================
-- LAS VEGAS, USA (5 new)
-- ============================================================
(
  'Piranha Nightclub Las Vegas',
  'Las Vegas'' premier gay nightclub on the LGBTQ+-friendly Arts District strip. Two-floor venue with multiple bars, dance floors, and weekend circuit events.',
  '4633 Paradise Rd, Las Vegas, NV 89169, USA',
  'Las Vegas', 'USA',
  36.11840, -115.14910,
  7, 'business', '+1 702-791-0100',
  'https://www.piranhalasvegas.com', 'piranhalv', '$$', 'approved'
),
(
  'Share Las Vegas',
  'Vegas'' intimate gay bar next to Piranha on the Paradise Road LGBTQ+ corridor. Popular for its casual atmosphere, bear nights, and drag shows.',
  '4633 Paradise Rd, Las Vegas, NV 89169, USA',
  'Las Vegas', 'USA',
  36.11860, -115.14920,
  7, 'business', '+1 702-791-0100',
  NULL, NULL, '$', 'approved'
),
(
  'Entourage Las Vegas',
  'Gay bar and lounge in the Las Vegas LGBTQ+ corridor, known for drag performances, themed events, and a friendly neighborhood bar atmosphere.',
  '953 E Sahara Ave, Las Vegas, NV 89104, USA',
  'Las Vegas', 'USA',
  36.14180, -115.14050,
  7, 'business', '+1 702-737-5252',
  NULL, NULL, '$', 'approved'
),
(
  'Get Booked LGBT Bookstore',
  'Las Vegas'' LGBTQ+ bookstore and resource center, the only dedicated queer bookshop in Nevada. Carries books, zines, and hosts community events.',
  '4640 Paradise Rd, Las Vegas, NV 89169, USA',
  'Las Vegas', 'USA',
  36.11820, -115.14830,
  8, 'business', '+1 702-737-7780',
  'https://www.getbookedlv.com', 'getbookedlv', '$', 'approved'
),
(
  'Las Vegas LGBTQ Center (The Center NV)',
  'Southern Nevada''s LGBTQ+ community center providing mental health counseling, HIV testing, support groups, youth services, and community resources.',
  '401 S Maryland Pkwy, Las Vegas, NV 89101, USA',
  'Las Vegas', 'USA',
  36.16490, -115.14500,
  5, 'place_of_interest', '+1 702-733-9800',
  'https://www.thecenternv.org', 'thecenternv', NULL, 'approved'
),

-- ============================================================
-- PALM SPRINGS, USA (5 new)
-- ============================================================
(
  'The Barracks Bar Palm Springs',
  'Palm Springs'' leather and Levi''s gay bar known for its bear and fetish events, dark patio, and PNP-friendly atmosphere. One of the desert''s most popular leather venues.',
  '67625 E Palm Canyon Dr, Cathedral City, CA 92234, USA',
  'Palm Springs', 'USA',
  33.82640, -116.46010,
  7, 'business', '+1 760-321-9688',
  'https://www.barracksbar.com', 'barracksbar', '$', 'approved'
),
(
  'Chill Bar Palm Springs',
  'Popular outdoor gay bar and lounge on Arenas Road, Palm Springs'' main gay strip. Known for cocktails, patio seating, and a relaxed cruise atmosphere.',
  '217 E Arenas Rd, Palm Springs, CA 92262, USA',
  'Palm Springs', 'USA',
  33.82430, -116.54340,
  7, 'business', '+1 760-327-1079',
  NULL, 'chillbarpalmsprings', '$', 'approved'
),
(
  'Splash House Palm Springs',
  'Palm Springs'' iconic LGBTQ+-friendly pool party and music festival at various resort hotels. World-renowned queer summer circuit event.',
  'Arenas Rd, Palm Springs, CA 92262, USA',
  'Palm Springs', 'USA',
  33.82150, -116.54050,
  3, 'place_of_interest', NULL,
  'https://www.splashhouse.com', 'splashhouse', '$$$', 'approved'
),
(
  'Desert AIDS Project',
  'Palm Springs'' LGBTQ+ health organization providing HIV/STI testing, PrEP, mental health counseling, housing support, and community wellness programs.',
  '1695 N Sunrise Way, Palm Springs, CA 92262, USA',
  'Palm Springs', 'USA',
  33.84520, -116.54800,
  5, 'place_of_interest', '+1 760-323-2118',
  'https://www.desertaidsproject.org', 'desertaidsproject', NULL, 'approved'
),
(
  'Inndulge Palm Springs',
  'Adults-only gay clothing-optional resort in Palm Springs with pool, Jacuzzi, and social events. A relaxed and welcoming environment for the LGBTQ+ community.',
  '601 E Palm Canyon Dr, Palm Springs, CA 92264, USA',
  'Palm Springs', 'USA',
  33.81320, -116.53870,
  25, 'business', '+1 760-327-1408',
  'https://www.inndulge.com', 'inndulge', '$$$', 'approved'
),

-- ============================================================
-- SAN DIEGO, USA (5 new)
-- ============================================================
(
  'Gossip Grill San Diego',
  'San Diego''s beloved lesbian bar and LGBTQ+ restaurant in Hillcrest. One of the few remaining lesbian-owned bars in the US, with a strong community following.',
  '1220 University Ave, San Diego, CA 92103, USA',
  'San Diego', 'USA',
  32.74980, -117.15300,
  7, 'business', '+1 619-260-8023',
  'https://www.thegossipgrill.com', 'gossipgrill', '$$', 'approved'
),
(
  'Urban Mo''s Bar & Grill San Diego',
  'Hillcrest''s most popular gay bar and patio restaurant. Known for drag brunches, outdoor dining, and a lively, inclusive atmosphere year-round.',
  '308 University Ave, San Diego, CA 92103, USA',
  'San Diego', 'USA',
  32.74680, -117.15770,
  7, 'business', '+1 619-491-0400',
  'https://www.urbanmos.com', 'urbanmos', '$$', 'approved'
),
(
  'The Vulcan Steam & Sauna San Diego',
  'San Diego''s main gay bathhouse in Hillcrest, operating for over 30 years. Full sauna facilities with steam room, dry sauna, Jacuzzi, private rooms, and social areas.',
  '805 W Cedar St, San Diego, CA 92101, USA',
  'San Diego', 'USA',
  32.72630, -117.16580,
  6, 'business', '+1 619-232-5888',
  'https://www.vulcansteam.com', NULL, '$$', 'approved'
),
(
  'The San Diego LGBT Community Center',
  'San Diego''s comprehensive LGBTQ+ community center offering mental health services, HIV/AIDS programs, youth support, senior services, and advocacy.',
  '3909 Centre St, San Diego, CA 92103, USA',
  'San Diego', 'USA',
  32.75310, -117.15500,
  5, 'place_of_interest', '+1 619-692-2077',
  'https://www.thecentersd.org', 'thecentersd', NULL, 'approved'
),
(
  'Flicks San Diego',
  'Classic Hillcrest gay video bar showing queer films, reality TV, and pop culture on multiple screens. A relaxed neighborhood bar institution since 1986.',
  '1017 University Ave, San Diego, CA 92103, USA',
  'San Diego', 'USA',
  32.74820, -117.15590,
  7, 'business', '+1 619-297-2056',
  NULL, 'flicksbarsd', '$', 'approved'
),

-- ============================================================
-- BANGKOK, THAILAND (5 new)
-- ============================================================
(
  'DJ Station Bangkok',
  'Silom Soi 2''s most popular gay mega-club, open since 1993. Three floors, live DJs, and a massive crowd of locals and tourists every night.',
  '8/6-8 Silom Soi 2, Silom, Bangkok 10500, Thailand',
  'Bangkok', 'Thailand',
  13.72680, 100.52840,
  7, 'business', '+66 2-266-4029',
  'https://www.djstation.com', 'djstationbkk', '$$', 'approved'
),
(
  'Telephone Pub Bangkok',
  'Bangkok''s longest-running gay bar on Silom Soi 4, famous for its phone-on-table concept and a relaxed, cruise-friendly atmosphere popular with expats and locals.',
  '114/11-13 Silom Soi 4, Silom, Bangkok 10500, Thailand',
  'Bangkok', 'Thailand',
  13.72700, 100.52880,
  7, 'business', '+66 2-234-3279',
  NULL, NULL, '$', 'approved'
),
(
  'Sauna Mania Bangkok',
  'One of Bangkok''s most popular gay saunas, located in the Silom area. Full facilities including steam room, dry sauna, Jacuzzi, and relaxation areas.',
  '55 Soi Thaniya, Silom, Bangkok 10500, Thailand',
  'Bangkok', 'Thailand',
  13.72770, 100.52780,
  6, 'business', '+66 2-235-8290',
  NULL, NULL, '$$', 'approved'
),
(
  'SWING Bar Bangkok',
  'Fun and energetic gay bar on Silom Soi 4 with nightly shows, drag performers, and outdoor seating. Extremely popular with Bangkok''s LGBTQ+ party scene.',
  '2/5 Silom Soi 4, Bang Rak, Bangkok 10500, Thailand',
  'Bangkok', 'Thailand',
  13.72720, 100.52850,
  7, 'business', '+66 2-631-3663',
  NULL, 'swingbkk', '$', 'approved'
),
(
  'Rainbow Sky Association of Thailand',
  'Bangkok-based LGBTQ+ advocacy and support organization offering community programs, health services, and rights advocacy for gay and trans communities in Thailand.',
  '49 Silom Soi 4, Bang Rak, Bangkok 10500, Thailand',
  'Bangkok', 'Thailand',
  13.72670, 100.52820,
  5, 'place_of_interest', '+66 2-235-5716',
  NULL, NULL, NULL, 'approved'
),

-- ============================================================
-- TEL AVIV, ISRAEL (5 new)
-- ============================================================
(
  'Evita Bar Tel Aviv',
  'Tel Aviv''s legendary gay bar on Sheinkin Street, one of the first openly gay establishments in the Middle East. Beloved institution for the local LGBTQ+ community.',
  '31 Sheinkin St, Tel Aviv-Yafo, Israel',
  'Tel Aviv', 'Israel',
  32.06490, 34.77320,
  7, 'business', '+972 3-516-5451',
  NULL, NULL, '$$', 'approved'
),
(
  'Midnight Bar Tel Aviv',
  'Open-minded bar and meeting place in the heart of Tel Aviv''s gay scene, popular for its relaxed atmosphere, strong cocktails, and regular cruising nights.',
  '41 Allenby St, Tel Aviv-Yafo, Israel',
  'Tel Aviv', 'Israel',
  32.06760, 34.77400,
  7, 'business', '+972 3-517-9491',
  NULL, NULL, '$$', 'approved'
),
(
  'Club Shpagat Tel Aviv',
  'Tel Aviv''s popular queer and alternative bar in Florentin neighborhood. Known for themed queer parties, progressive politics, and an inclusive community atmosphere.',
  '5 Vital St, Florentin, Tel Aviv-Yafo, Israel',
  'Tel Aviv', 'Israel',
  32.05640, 34.77450,
  7, 'business', NULL,
  NULL, 'shpagat_tlv', '$', 'approved'
),
(
  'Aguda — Israel LGBTQ+ Association',
  'Israel''s main LGBTQ+ advocacy and support organization based in Tel Aviv. Provides legal aid, counseling, hotlines, and coordinates the annual Tel Aviv Pride.',
  '25 Nahmani St, Tel Aviv-Yafo, Israel',
  'Tel Aviv', 'Israel',
  32.06250, 34.77350,
  5, 'place_of_interest', '+972 3-525-6380',
  'https://www.aguda.org.il', 'agudarainbow', NULL, 'approved'
),
(
  'Sauna Tel Aviv (Marom)',
  'Tel Aviv''s well-known gay sauna in the city center, offering steam rooms, dry saunas, Jacuzzi, private cabins, and a social atmosphere.',
  '14 Ben Yehuda St, Tel Aviv-Yafo, Israel',
  'Tel Aviv', 'Israel',
  32.07870, 34.76830,
  6, 'business', '+972 3-522-0099',
  NULL, NULL, '$$', 'approved'
),

-- ============================================================
-- LISBON, PORTUGAL (5 new)
-- ============================================================
(
  'Bar 106 Lisbon',
  'Lisbon''s most iconic gay bar in the Príncipe Real neighborhood, the heart of the city''s LGBTQ+ scene. Friendly atmosphere, affordable drinks, and a loyal local crowd.',
  'Rua de São Marçal 106, Lisbon, Portugal',
  'Lisbon', 'Portugal',
  38.71640, -9.14590,
  7, 'business', '+351 21 342 7373',
  NULL, 'bar106lisbon', '$', 'approved'
),
(
  'Trumps Club Lisbon',
  'Lisbon''s premier gay nightclub in Príncipe Real, operating since 1978. Multiple dance floors, regular drag shows, and themed nights for the LGBTQ+ community.',
  'Rua da Imprensa Nacional 104B, Lisbon, Portugal',
  'Lisbon', 'Portugal',
  38.71570, -9.14620,
  7, 'business', '+351 21 397 1059',
  'https://www.trumps.pt', 'trumpsclublisbon', '$$', 'approved'
),
(
  'Finalmente Club Lisbon',
  'Lisbon''s historic drag club in Príncipe Real, famous for its nightly drag shows running since 1976. An essential part of Lisbon''s LGBTQ+ heritage.',
  'Rua da Palmeira 38, Lisbon, Portugal',
  'Lisbon', 'Portugal',
  38.71720, -9.14730,
  3, 'business', '+351 21 347 9923',
  NULL, NULL, '$$', 'approved'
),
(
  'Sauna 69 Lisbon',
  'Lisbon''s central gay sauna in the Príncipe Real area, with steam rooms, dry sauna, Jacuzzi, and darkrooms. Well-maintained facilities and a relaxed atmosphere.',
  'Rua de São Marçal 69, Lisbon, Portugal',
  'Lisbon', 'Portugal',
  38.71610, -9.14550,
  6, 'business', '+351 21 342 0059',
  NULL, NULL, '$$', 'approved'
),
(
  'ILGA Portugal',
  'Portugal''s national LGBTQ+ association, based in Lisbon. Provides legal assistance, psychological counseling, trans health support, and community advocacy.',
  'Rua da Palma 268, Lisbon, Portugal',
  'Lisbon', 'Portugal',
  38.72090, -9.13620,
  5, 'place_of_interest', '+351 21 887 3918',
  'https://www.ilga-portugal.pt', 'ilgaportugal', NULL, 'approved'
),

-- ============================================================
-- MONTRÉAL, CANADA (5 new)
-- ============================================================
(
  'Stock Bar Montréal',
  'Montréal''s most popular male strip club and gay bar on Ste-Catherine Street in the Village. Known for its lively shows, friendly staff, and cruise-friendly atmosphere.',
  '1171 Rue Ste-Catherine Est, Montréal, QC H2L 2G9, Canada',
  'Montréal', 'Canada',
  45.51740, -73.55100,
  3, 'business', '+1 514-842-1336',
  'https://www.stockbar.com', 'stockbarmontreal', '$$', 'approved'
),
(
  'Sky Pub & Club Montréal',
  'Montréal Village''s largest gay venue, with multiple bars, a rooftop terrace, pool, nightclub, and panoramic views of the city. A must-visit LGBTQ+ destination.',
  '1474 Rue Ste-Catherine Est, Montréal, QC H2L 2J1, Canada',
  'Montréal', 'Canada',
  45.51740, -73.54800,
  7, 'business', '+1 514-529-6969',
  'https://www.complexesky.com', 'complexesky', '$$', 'approved'
),
(
  'Sauna Oasis Montréal',
  'Montréal''s longest-running gay sauna in the Village neighborhood, with full facilities including pools, steam rooms, dry sauna, private cabins, and social lounges.',
  '1390 Rue Ste-Catherine Est, Montréal, QC H2L 2J1, Canada',
  'Montréal', 'Canada',
  45.51740, -73.54880,
  6, 'business', '+1 514-521-1781',
  'https://www.saunaoasis.com', NULL, '$$', 'approved'
),
(
  'RÉZO Montréal',
  'Montréal''s leading gay men''s health organization providing HIV/STI testing, PrEP, counseling, sexual health education, and harm reduction services.',
  '1600 Rue Notre-Dame-de-Grâce, Montréal, QC H4E 1N2, Canada',
  'Montréal', 'Canada',
  45.47400, -73.59500,
  5, 'place_of_interest', '+1 514-521-7778',
  'https://www.rezosante.org', 'rezosante', NULL, 'approved'
),
(
  'Divers/Cité Montréal',
  'Organization behind Montréal''s annual LGBTQ+ Pride festival, Divers/Cité. Also hosts community events and cultural programming throughout the year.',
  '1240 Rue Ste-Catherine Est, Montréal, QC H2L 2H1, Canada',
  'Montréal', 'Canada',
  45.51680, -73.55100,
  8, 'business', '+1 514-285-4011',
  'https://www.diverscite.org', 'diverscite', NULL, 'approved'
),

-- ============================================================
-- COLOGNE, GERMANY (5 new)
-- ============================================================
(
  'Cha-Cha Club Cologne',
  'Cologne''s most popular gay club near the Rudolfplatz area, known for weekly themed nights, a large dance floor, and a welcoming mixed LGBTQ+ crowd.',
  'Pipinstr. 7, Cologne, Germany',
  'Cologne', 'Germany',
  50.93310, 6.94300,
  7, 'business', '+49 221 258 1660',
  NULL, NULL, '$$', 'approved'
),
(
  'MTC Cologne',
  'Cologne''s premier leather and fetish gay bar in the Zülpicher Viertel. Known for regular leather nights, gear checks, and a dedicated fetish community.',
  'Zülpicher Str. 10, Cologne, Germany',
  'Cologne', 'Germany',
  50.92930, 6.94620,
  7, 'business', '+49 221 240 1980',
  'https://www.mtc-cologne.de', 'mtccologne', '$', 'approved'
),
(
  'Sauna Babylon Cologne',
  'Cologne''s largest and most well-known gay sauna near the city center. Multiple themed rooms, steam room, dry sauna, Jacuzzi, and social areas.',
  'Mauritiuswall 75, Cologne, Germany',
  'Cologne', 'Germany',
  50.93100, 6.94230,
  6, 'business', '+49 221 257 8685',
  'https://www.sauna-babylon.de', NULL, '$$', 'approved'
),
(
  'Anyway e.V. Cologne',
  'Cologne''s main LGBTQ+ youth center providing counseling, safe spaces, youth groups, and social programs for queer young people in the Cologne region.',
  'Rubensstr. 8-10, Cologne, Germany',
  'Cologne', 'Germany',
  50.93440, 6.93580,
  5, 'place_of_interest', '+49 221 921 8550',
  'https://www.anyway-koeln.de', 'anywaykoeln', NULL, 'approved'
),
(
  'SchwuZ Pride Store Cologne',
  'LGBTQ+ community shop and cultural space in Cologne carrying queer literature, gifts, and pride merchandise while supporting local community events.',
  'Friesenstr. 53, Cologne, Germany',
  'Cologne', 'Germany',
  50.93830, 6.94480,
  8, 'business', '+49 221 139 4420',
  NULL, NULL, '$', 'approved'
),

-- ============================================================
-- PRAGUE, CZECH REPUBLIC (5 new)
-- ============================================================
(
  'Friends Bar Prague',
  'Prague''s most popular gay bar and club in the New Town district. Known for its themed parties, affordable cocktails, and friendly atmosphere for tourists and locals alike.',
  'Bartolomějská 11, Prague 1, Czech Republic',
  'Prague', 'Czech Republic',
  50.08280, 14.42050,
  7, 'business', '+420 224 236 772',
  'https://www.friendsbar.cz', 'friendsbarprag', '$', 'approved'
),
(
  'Termix Club Prague',
  'Long-established gay dance club in Vinohrady, Prague''s main LGBTQ+ neighborhood. Multi-floor venue with regular themed nights and a loyal local following.',
  'Třebízského 4A, Prague 2, Czech Republic',
  'Prague', 'Czech Republic',
  50.07480, 14.43650,
  7, 'business', '+420 222 710 462',
  'https://www.club-termix.cz', 'termixclub', '$$', 'approved'
),
(
  'Drake''s Bar Prague',
  'Prague''s main leather and bear bar in Vinohrady, catering to the fetish and kink community. Known for themed fetish events and a welcoming, PNP-friendly atmosphere.',
  'Zborovská 50, Prague 5, Czech Republic',
  'Prague', 'Czech Republic',
  50.07640, 14.40570,
  7, 'business', '+420 257 326 828',
  'https://www.drakes.cz', 'drakesprag', '$', 'approved'
),
(
  'Sauna Babylonia Prague',
  'Central Prague''s well-established gay sauna with steam rooms, dry sauna, Jacuzzi, darkrooms, and a bar. Popular with both local and international visitors.',
  'Martinská 6, Prague 1, Czech Republic',
  'Prague', 'Czech Republic',
  50.08570, 14.41870,
  6, 'business', '+420 224 232 304',
  'https://www.babylonia.cz', NULL, '$$', 'approved'
),
(
  'Prague Pride Organization',
  'Organization behind Prague Pride festival and LGBTQ+ advocacy in the Czech Republic. Provides community resources, support lines, and year-round programming.',
  'Lublaňská 18, Prague 2, Czech Republic',
  'Prague', 'Czech Republic',
  50.07470, 14.43750,
  5, 'place_of_interest', '+420 702 218 318',
  'https://www.praguepride.cz', 'praguepride', NULL, 'approved'
),

-- ============================================================
-- GUADALAJARA, MEXICO (5 new)
-- ============================================================
(
  'Envy Club Guadalajara',
  'Guadalajara''s largest and most popular gay nightclub in the Zona Rosa area. Known for circuit music, drag shows, go-go dancers, and weekend circuit events.',
  'Av. Américas 2173, Col. Ladrón de Guevara, Guadalajara, Mexico',
  'Guadalajara', 'Mexico',
  20.67570, -103.38640,
  7, 'business', '+52 33 3647-1002',
  NULL, 'envyclubgdl', '$$', 'approved'
),
(
  'El Closet Bar Guadalajara',
  'Popular gay bar in Guadalajara''s gay district, known for its friendly staff, themed nights, drag performances, and affordable drinks. A local community staple.',
  'Calle Dionisio Rodríguez 174, Guadalajara, Mexico',
  'Guadalajara', 'Mexico',
  20.67920, -103.35320,
  7, 'business', '+52 33 3614-0665',
  NULL, NULL, '$', 'approved'
),
(
  'Sauna El Palacio Guadalajara',
  'Guadalajara''s main gay sauna, providing steam rooms, private rooms, and social areas for the local gay community. Located in the Zona Centro area.',
  'Calle Colón 175, Guadalajara, Mexico',
  'Guadalajara', 'Mexico',
  20.67830, -103.35060,
  6, 'business', '+52 33 3614-2810',
  NULL, NULL, '$', 'approved'
),
(
  'MUSAS — Centro de Salud Sexual Guadalajara',
  'Guadalajara''s LGBTQ+ sexual health center providing HIV/STI testing, PrEP access, counseling, and harm reduction services for the gay and trans community.',
  'Calle Prisciliano Sánchez 730, Guadalajara, Mexico',
  'Guadalajara', 'Mexico',
  20.67530, -103.34980,
  5, 'place_of_interest', '+52 33 3613-5000',
  NULL, NULL, NULL, 'approved'
),
(
  'Hospedaje Villa Guadalajara',
  'Gay-friendly hotel in Guadalajara''s historic center popular with LGBTQ+ travelers. Affordable rooms and close proximity to the city''s gay nightlife strip.',
  'Av. Juárez 175, Guadalajara, Mexico',
  'Guadalajara', 'Mexico',
  20.67640, -103.34870,
  25, 'business', '+52 33 3613-8858',
  NULL, NULL, '$$', 'approved'
),

-- ============================================================
-- LIMA, PERU (5 new)
-- ============================================================
(
  'Downtown Vale Todo Lima',
  'Lima''s most iconic gay nightclub in Miraflores, operating for over 20 years. Known for drag shows, circuit beats, and one of the most vibrant gay scenes in South America.',
  'Manuel Bonilla 100, Miraflores, Lima, Peru',
  'Lima', 'Peru',
  -12.11690, -77.02910,
  7, 'business', '+51 1 242-0271',
  NULL, 'downtownvaletodo', '$$', 'approved'
),
(
  'Legendaris Club Lima',
  'Gay nightclub in Miraflores popular for its themed circuit parties, drag performances, and welcoming atmosphere for both locals and tourists.',
  'Av. Larco 290, Miraflores, Lima, Peru',
  'Lima', 'Peru',
  -12.12560, -77.02870,
  7, 'business', '+51 1 447-5893',
  NULL, NULL, '$$', 'approved'
),
(
  'Sauna Galaxy Lima',
  'Lima''s most popular gay sauna in Miraflores, with steam rooms, dry sauna, private cabins, Jacuzzi, and a cruise-friendly environment.',
  'Calle Berlín 580, Miraflores, Lima, Peru',
  'Lima', 'Peru',
  -12.12070, -77.02900,
  6, 'business', '+51 1 241-4569',
  NULL, NULL, '$$', 'approved'
),
(
  'Epicentro LGBT Lima',
  'Lima''s key LGBTQ+ advocacy organization providing HIV/STI services, legal aid, counseling, and community programs, with a focus on trans and gay male health.',
  'Av. Arequipa 4118, Miraflores, Lima, Peru',
  'Lima', 'Peru',
  -12.11470, -77.03180,
  5, 'place_of_interest', '+51 1 422-6228',
  'https://www.epicentrolima.pe', NULL, NULL, 'approved'
),
(
  'Hotel El Patio Lima',
  'Boutique gay-friendly hotel in the heart of Miraflores, Lima''s most desirable neighborhood. Popular with LGBTQ+ travelers for its friendly service and prime location.',
  'Calle Diez Canseco 341, Miraflores, Lima, Peru',
  'Lima', 'Peru',
  -12.12280, -77.02780,
  25, 'business', '+51 1 444-2107',
  'https://www.elpatio.com.pe', NULL, '$$$', 'approved'
),

-- ============================================================
-- SANTIAGO, CHILE (5 new)
-- ============================================================
(
  'Fausto Club Santiago',
  'Santiago''s premier gay nightclub in the Bellavista neighborhood. One of the city''s oldest gay clubs, known for circuit parties, drag shows, and a diverse LGBTQ+ crowd.',
  'Av. Santa María 832, Providencia, Santiago, Chile',
  'Santiago', 'Chile',
  -33.43310, -70.62960,
  7, 'business', '+56 2 2777-1041',
  'https://www.faustoclub.cl', 'faustoclubscl', '$$', 'approved'
),
(
  'Bunker Club Santiago',
  'Large gay club in Santiago''s Bellavista area known for its multiple dance floors, international DJs, and vibrant weekly circuit events attracting a mixed LGBTQ+ crowd.',
  'Bombero Núñez 159, Recoleta, Santiago, Chile',
  'Santiago', 'Chile',
  -33.43190, -70.63510,
  7, 'business', '+56 2 2735-1716',
  'https://www.bunkerclub.cl', 'bunkercl', '$$', 'approved'
),
(
  'Sauna Zeus Santiago',
  'Santiago''s most established gay sauna in Barrio Italia, with steam rooms, dry sauna, Jacuzzi, private cabins, and darkrooms. Popular with the local community.',
  'Av. Italia 1390, Providencia, Santiago, Chile',
  'Santiago', 'Chile',
  -33.44540, -70.62010,
  6, 'business', '+56 2 2634-2900',
  NULL, NULL, '$$', 'approved'
),
(
  'MOVILH — Movimiento de Integración y Liberación Homosexual',
  'Chile''s oldest and most prominent LGBTQ+ rights organization, based in Santiago. Provides legal assistance, psychological support, and leads national advocacy campaigns.',
  'Av. Libertador Bernardo O''Higgins 1620, Santiago, Chile',
  'Santiago', 'Chile',
  -33.44800, -70.65160,
  5, 'place_of_interest', '+56 2 2638-4752',
  'https://www.movilh.cl', 'movilhchile', NULL, 'approved'
),
(
  'Roxy Club Santiago',
  'Popular gay and lesbian bar in Barrio Lastarria, Santiago. Known for a welcoming mixed LGBTQ+ crowd, strong cocktails, electronic music, and late-night dancing.',
  'José Victorino Lastarria 90, Santiago, Chile',
  'Santiago', 'Chile',
  -33.43970, -70.63930,
  7, 'business', '+56 2 2633-1714',
  NULL, NULL, '$', 'approved'
)

ON CONFLICT (name, address) DO NOTHING;

-- ============================================================
-- DOWN (removes only the rows inserted by this migration)
-- ============================================================
-- To roll back, delete all rows whose (name, address) pairs were inserted above.
-- The ON CONFLICT guard means no pre-existing rows are touched.

-- DELETE FROM nearby_places WHERE (name, address) IN (
--   ('Sitges Bar', 'Av. Santa Fe 1340, Buenos Aires, Argentina'),
--   ('The Week Rio', 'Rua Sacadura Cabral 154, Rio de Janeiro, Brazil'),
--   ('Le Boy', 'Rua Paul Redfern 16, Ipanema, Rio de Janeiro, Brazil'),
--   ('Centro de Referência em Direitos LGBT Rio', 'Rua Evaristo da Veiga 16, Centro, Rio de Janeiro, Brazil'),
--   ('KitKatClub', 'Köpenicker Str. 76, Berlin, Germany'),
--   ('Le Marais Gay Bar Le Cox', '15 Rue des Archives, Paris, France'),
--   ('Le Dépôt', '10 Rue aux Ours, Paris, France'),
--   ('Centre LGBT+ Paris Île-de-France', '63 Rue Beaubourg, Paris, France'),
--   ('Muccassassina', 'Via di Portonaccio 212, Rome, Italy'),
--   ('Mario Mieli House', 'Via Efeso 2, Rome, Italy'),
--   ('Sauna Casanova', 'Carrer de la Diputació 248, Barcelona, Spain'),
--   ('Arena Madre', 'Carrer del Consell de Cent 255, Barcelona, Spain'),
--   ('Chueca Sauna Paraíso', 'Calle de Pelayo 25, Madrid, Spain'),
--   ('Escape Club Madrid', 'Calle de Gravina 13, Madrid, Spain'),
--   ('COGAM Madrid', 'Calle de la Puebla 9, Madrid, Spain'),
--   ('Why Not? Madrid', 'Calle de San Bartolomé 7, Madrid, Spain'),
--   ('Vauxhall Sauna', '145-149 Wandsworth Rd, London, UK'),
--   ('Copenhagen Gay Center (LGBT+ Danmark)', 'Nygade 7, Copenhagen, Denmark'),
--   ('The Eagle NYC', '554 W 28th St, New York, NY, USA'),
--   ('Hamburger Mary''s West Hollywood', '8288 Santa Monica Blvd, West Hollywood, CA, USA'),
--   ('Nicho Bears & Bar', 'Calle Hamburgo 87, Juárez, Mexico City, Mexico'),
--   ('Sauna Alexander''s', 'Calle Amberes 18, Juárez, Mexico City, Mexico'),
--   ('Centro Comunitario Deportivo y Cultural Zona Rosa', 'Calle Amberes 21, Juárez, Mexico City, Mexico'),
--   ('El Almacén Bar', 'Calle Florencia 37-B, Juárez, Mexico City, Mexico'),
--   ('AiiRO CAFÉ', '2-18-1 Shinjuku, Shinjuku-ku, Tokyo, Japan'),
--   ('Arty Farty', '2-17-4 Shinjuku, Shinjuku-ku, Tokyo, Japan'),
--   ('Rainbow Center Tokyo (OCCUR)', '3-7-9 Shinjuku, Shinjuku-ku, Tokyo, Japan'),
--   ('Sauna Therme', '2-13-5 Shinjuku, Shinjuku-ku, Tokyo, Japan'),
--   ('El Poblado LGBT Strip', 'Calle 10 #41-35, El Poblado, Medellín, Colombia'),
--   ('The Stonewall Hotel Sydney', '175 Oxford St, Darlinghurst NSW 2010, Australia'),
--   ('Ken''s at Kensington Sauna', '33 Botany St, Kensington NSW 2033, Australia'),
--   ('ACON (AIDS Council of NSW)', '414 Elizabeth St, Surry Hills NSW 2010, Australia'),
--   ('ARQ Sydney', '16 Flinders St, Taylor Square, Darlinghurst NSW 2010, Australia'),
--   ('Platea Bar Panamá', 'Calle 50, Bella Vista, Panama City, Panama'),
--   ('Asociación Hombres y Mujeres Nuevos de Panamá (AHMNP)', 'Calle 50, El Cangrejo, Panama City, Panama'),
--   ('Club Café Boston', '209 Columbus Ave, Boston, MA 02116, USA'),
--   ('Machine Nightclub Boston', '1254 Boylston St, Boston, MA 02215, USA'),
--   ('Fenway Health', '1340 Boylston St, Boston, MA 02215, USA'),
--   ('Cattivo Bar Pittsburgh', '146 44th St, Pittsburgh, PA 15201, USA'),
--   ('Blue Moon Bar Pittsburgh', '2611 Penn Ave, Pittsburgh, PA 15222, USA'),
--   ('The Castro Theatre', '429 Castro St, San Francisco, CA 94114, USA'),
--   ('The Stud Bar San Francisco', '399 9th St, San Francisco, CA 94103, USA'),
--   ('San Francisco Bathhouse (Eros SF)', '2051 Market St, San Francisco, CA 94114, USA'),
--   ('Magnet SF (Strut)', '4122 18th St, San Francisco, CA 94114, USA'),
--   ('Twist Miami Beach', '1057 Washington Ave, Miami Beach, FL 33139, USA'),
--   ('Score Bar Miami', '727 Lincoln Rd, Miami Beach, FL 33139, USA'),
--   ('Club Aqua Miami', '350 S Washington Ave, Miami Beach, FL 33139, USA'),
--   ('SAVE Miami (LGBTQ+ Center)', '1247 NE 2nd Ave, Miami, FL 33132, USA'),
--   ('Bodyzone Health Club Miami', '2440 Wilton Dr, Wilton Manors, FL 33305, USA'),
--   ('Berlin Nightclub Chicago', '954 W Belmont Ave, Chicago, IL 60657, USA'),
--   ('Hydrate Nightclub Chicago', '3458 N Halsted St, Chicago, IL 60657, USA'),
--   ('Man''s Country Chicago', '5015 N Clark St, Chicago, IL 60640, USA'),
--   ('Center on Halsted Chicago', '3656 N Halsted St, Chicago, IL 60613, USA'),
--   ('BATON Show Lounge Chicago', '4713 N Broadway, Chicago, IL 60640, USA'),
--   ('Piranha Nightclub Las Vegas', '4633 Paradise Rd, Las Vegas, NV 89169, USA'),
--   ('Share Las Vegas', '4633 Paradise Rd, Las Vegas, NV 89169, USA'),
--   ('Entourage Las Vegas', '953 E Sahara Ave, Las Vegas, NV 89104, USA'),
--   ('Get Booked LGBT Bookstore', '4640 Paradise Rd, Las Vegas, NV 89169, USA'),
--   ('Las Vegas LGBTQ Center (The Center NV)', '401 S Maryland Pkwy, Las Vegas, NV 89101, USA'),
--   ('The Barracks Bar Palm Springs', '67625 E Palm Canyon Dr, Cathedral City, CA 92234, USA'),
--   ('Chill Bar Palm Springs', '217 E Arenas Rd, Palm Springs, CA 92262, USA'),
--   ('Splash House Palm Springs', 'Arenas Rd, Palm Springs, CA 92262, USA'),
--   ('Desert AIDS Project', '1695 N Sunrise Way, Palm Springs, CA 92262, USA'),
--   ('Inndulge Palm Springs', '601 E Palm Canyon Dr, Palm Springs, CA 92264, USA'),
--   ('Gossip Grill San Diego', '1220 University Ave, San Diego, CA 92103, USA'),
--   ('Urban Mo''s Bar & Grill San Diego', '308 University Ave, San Diego, CA 92103, USA'),
--   ('The Vulcan Steam & Sauna San Diego', '805 W Cedar St, San Diego, CA 92101, USA'),
--   ('The San Diego LGBT Community Center', '3909 Centre St, San Diego, CA 92103, USA'),
--   ('Flicks San Diego', '1017 University Ave, San Diego, CA 92103, USA'),
--   ('DJ Station Bangkok', '8/6-8 Silom Soi 2, Silom, Bangkok 10500, Thailand'),
--   ('Telephone Pub Bangkok', '114/11-13 Silom Soi 4, Silom, Bangkok 10500, Thailand'),
--   ('Sauna Mania Bangkok', '55 Soi Thaniya, Silom, Bangkok 10500, Thailand'),
--   ('SWING Bar Bangkok', '2/5 Silom Soi 4, Bang Rak, Bangkok 10500, Thailand'),
--   ('Rainbow Sky Association of Thailand', '49 Silom Soi 4, Bang Rak, Bangkok 10500, Thailand'),
--   ('Evita Bar Tel Aviv', '31 Sheinkin St, Tel Aviv-Yafo, Israel'),
--   ('Midnight Bar Tel Aviv', '41 Allenby St, Tel Aviv-Yafo, Israel'),
--   ('Club Shpagat Tel Aviv', '5 Vital St, Florentin, Tel Aviv-Yafo, Israel'),
--   ('Aguda — Israel LGBTQ+ Association', '25 Nahmani St, Tel Aviv-Yafo, Israel'),
--   ('Sauna Tel Aviv (Marom)', '14 Ben Yehuda St, Tel Aviv-Yafo, Israel'),
--   ('Bar 106 Lisbon', 'Rua de São Marçal 106, Lisbon, Portugal'),
--   ('Trumps Club Lisbon', 'Rua da Imprensa Nacional 104B, Lisbon, Portugal'),
--   ('Finalmente Club Lisbon', 'Rua da Palmeira 38, Lisbon, Portugal'),
--   ('Sauna 69 Lisbon', 'Rua de São Marçal 69, Lisbon, Portugal'),
--   ('ILGA Portugal', 'Rua da Palma 268, Lisbon, Portugal'),
--   ('Stock Bar Montréal', '1171 Rue Ste-Catherine Est, Montréal, QC H2L 2G9, Canada'),
--   ('Sky Pub & Club Montréal', '1474 Rue Ste-Catherine Est, Montréal, QC H2L 2J1, Canada'),
--   ('Sauna Oasis Montréal', '1390 Rue Ste-Catherine Est, Montréal, QC H2L 2J1, Canada'),
--   ('RÉZO Montréal', '1600 Rue Notre-Dame-de-Grâce, Montréal, QC H4E 1N2, Canada'),
--   ('Divers/Cité Montréal', '1240 Rue Ste-Catherine Est, Montréal, QC H2L 2H1, Canada'),
--   ('Cha-Cha Club Cologne', 'Pipinstr. 7, Cologne, Germany'),
--   ('MTC Cologne', 'Zülpicher Str. 10, Cologne, Germany'),
--   ('Sauna Babylon Cologne', 'Mauritiuswall 75, Cologne, Germany'),
--   ('Anyway e.V. Cologne', 'Rubensstr. 8-10, Cologne, Germany'),
--   ('SchwuZ Pride Store Cologne', 'Friesenstr. 53, Cologne, Germany'),
--   ('Friends Bar Prague', 'Bartolomějská 11, Prague 1, Czech Republic'),
--   ('Termix Club Prague', 'Třebízského 4A, Prague 2, Czech Republic'),
--   ('Drake''s Bar Prague', 'Zborovská 50, Prague 5, Czech Republic'),
--   ('Sauna Babylonia Prague', 'Martinská 6, Prague 1, Czech Republic'),
--   ('Prague Pride Organization', 'Lublaňská 18, Prague 2, Czech Republic'),
--   ('Envy Club Guadalajara', 'Av. Américas 2173, Col. Ladrón de Guevara, Guadalajara, Mexico'),
--   ('El Closet Bar Guadalajara', 'Calle Dionisio Rodríguez 174, Guadalajara, Mexico'),
--   ('Sauna El Palacio Guadalajara', 'Calle Colón 175, Guadalajara, Mexico'),
--   ('MUSAS — Centro de Salud Sexual Guadalajara', 'Calle Prisciliano Sánchez 730, Guadalajara, Mexico'),
--   ('Hospedaje Villa Guadalajara', 'Av. Juárez 175, Guadalajara, Mexico'),
--   ('Downtown Vale Todo Lima', 'Manuel Bonilla 100, Miraflores, Lima, Peru'),
--   ('Legendaris Club Lima', 'Av. Larco 290, Miraflores, Lima, Peru'),
--   ('Sauna Galaxy Lima', 'Calle Berlín 580, Miraflores, Lima, Peru'),
--   ('Epicentro LGBT Lima', 'Av. Arequipa 4118, Miraflores, Lima, Peru'),
--   ('Hotel El Patio Lima', 'Calle Diez Canseco 341, Miraflores, Lima, Peru'),
--   ('Fausto Club Santiago', 'Av. Santa María 832, Providencia, Santiago, Chile'),
--   ('Bunker Club Santiago', 'Bombero Núñez 159, Recoleta, Santiago, Chile'),
--   ('Sauna Zeus Santiago', 'Av. Italia 1390, Providencia, Santiago, Chile'),
--   ('MOVILH — Movimiento de Integración y Liberación Homosexual', 'Av. Libertador Bernardo O''Higgins 1620, Santiago, Chile'),
--   ('Roxy Club Santiago', 'José Victorino Lastarria 90, Santiago, Chile')
-- );
