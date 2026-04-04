--
-- PostgreSQL database dump
--

\restrict x799JFCsHBFSZAtoedPMHhvHHdi5clh5T8eUGQ0BWDfqnXPbUkFbmrIURXcv6Ye

-- Dumped from database version 16.13
-- Dumped by pg_dump version 16.13

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Data for Name: performers; Type: TABLE DATA; Schema: public; Owner: pnptvbot
--

COPY public.performers (id, user_id, display_name, bio, photo_url, availability_schedule, timezone, allowed_call_types, max_call_duration, base_price, buffer_time_before, buffer_time_after, status, is_available, availability_message, total_calls, total_rating, rating_count, created_at, updated_at, created_by, updated_by, bio_short, default_timezone, allowed_call_types_json, durations_minutes, base_price_cents, currency, buffer_before_minutes, buffer_after_minutes, max_daily_calls, is_featured, next_show_date) FROM stdin;
e1c2bb7e-a086-4f5e-bcc1-07e86165eee7	8599671840	Santino	\N	\N	[]	UTC	{video,audio}	60	60.00	15	15	active	t	\N	0	0.00	0	2026-03-07 02:48:48.53143	2026-03-07 02:48:48.53143	\N	\N	\N	America/Bogota	["video", "audio"]	[15, 30, 60]	10000	USD	5	10	\N	t	\N
689f0ee5-0d9a-4267-9310-9d2bddac30d9	6158016962	Milo	\N	\N	[]	UTC	{video,audio}	60	60.00	15	15	active	t	\N	0	0.00	0	2026-03-07 02:48:48.53143	2026-03-07 02:48:48.53143	\N	\N	\N	America/Bogota	["video", "audio"]	[15, 30, 60]	10000	USD	5	10	\N	t	\N
ee6266a3-60b2-4aab-95e6-24afbc7a4f27	fe20b76b-6451-49ec-84c8-1e4bffab96eb	Frank	\N	\N	[]	UTC	{video,audio}	60	60.00	15	15	active	t	\N	0	0.00	0	2026-03-07 03:16:07.356151	2026-03-07 03:16:07.356151	\N	\N	\N	America/Bogota	["video", "audio"]	[15, 30, 60]	10000	USD	5	10	\N	t	\N
d75c5825-8cca-4588-9d6b-48fae2031e05	7246621722	Lex! Slam!	\N	\N	[]	UTC	{video,audio}	60	60.00	15	15	active	t	\N	0	0.00	0	2026-02-11 10:14:17.306056	2026-03-07 19:50:19.8659	admin	\N	\N	America/Bogota	["video", "audio"]	[15, 30, 60]	10000	USD	5	10	\N	t	\N
\.


--
-- Data for Name: call_availability_slots; Type: TABLE DATA; Schema: public; Owner: pnptvbot
--

COPY public.call_availability_slots (id, performer_id, date, start_time, end_time, timezone, is_available, is_booked, booking_id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: creator_subscriptions; Type: TABLE DATA; Schema: public; Owner: pnptvbot
--

COPY public.creator_subscriptions (id, creator_id, subscriber_id, status, price_usd, started_at, expires_at, cancelled_at, payment_id, auto_renew, created_at, renewal_payment_id) FROM stdin;
\.


--
-- Data for Name: creator_earnings; Type: TABLE DATA; Schema: public; Owner: pnptvbot
--

COPY public.creator_earnings (id, creator_id, subscription_id, amount_gross, amount_creator, amount_platform, status, period_month, created_at, paid_at, metadata) FROM stdin;
\.


--
-- Data for Name: creator_enrollments; Type: TABLE DATA; Schema: public; Owner: pnptvbot
--

COPY public.creator_enrollments (id, user_id, tier, status, terms_accepted_at, terms_accepted_ip, content_commitment_accepted_at, payment_method, payment_address, payment_network, id_document_path, signature_data, submitted_at, reviewed_at, reviewed_by, admin_notes, created_at, updated_at) FROM stdin;
2	8599671840	diamond	approved	2026-03-06 00:01:51.740719+00	\N	2026-03-06 00:01:51.740719+00	\N	\N	\N	\N	\N	2026-03-05 23:01:51.740719+00	2026-03-06 00:01:51.740719+00	c6fdb3eb-3a87-4f5a-b369-400b536438fd	Manually approved by admin — all requirements met.	2026-03-06 00:01:51.740719+00	2026-03-06 00:01:51.740719+00
\.


--
-- Data for Name: creator_milestone_notifications; Type: TABLE DATA; Schema: public; Owner: pnptvbot
--

COPY public.creator_milestone_notifications (id, user_id, milestone_type, status, notified_at, responded_at, metadata) FROM stdin;
\.


--
-- Data for Name: creator_strike_log; Type: TABLE DATA; Schema: public; Owner: pnptvbot
--

COPY public.creator_strike_log (id, creator_id, strike_number, reason, issued_by, created_at) FROM stdin;
\.


--
-- Data for Name: model_applications; Type: TABLE DATA; Schema: public; Owner: pnptvbot
--

COPY public.model_applications (id, user_id, application_type, stage_name, bio, instagram_handle, twitter_handle, onlyfans_url, profile_photo_url, legal_full_name, date_of_birth, country, city_state, id_front_url, id_back_url, terms_agreed, terms_agreed_at, terms_version, call_scheduled, call_scheduled_at, status, admin_notes, reviewed_by, reviewed_at, created_at, updated_at, requested_price_usd) FROM stdin;
0552ea00-9ecf-4826-bcd4-a97479406004	5643392748	both	CloudComputa	🐻💨 Your favorite cloudy bear from CDMX. Serving thick fog and high-def PNP experiences. 🌫️ Don't settle for blurry clips—get the full, high-quality play. Get lifted here: ⬇️ [Cloudcomputa.online]	\N	@cloudcumputa	http://darkfans.com/CloudComputa?ref=10915580	/uploads/model-applications/5643392748/profile/profile_1772925911961.webp	Fernando Mendoza Rodriguez	1990-05-03	Mexico	CDMX	/uploads/model-applications/5643392748/id/id_front_1772925996239.webp	/uploads/model-applications/5643392748/id/id_back_1772925996239.webp	t	2026-03-07 23:26:38.985637+00	1.0	t	2026-03-07 23:26:46.337194+00	rejected	Guapote esto aún no debería haber salido aún me encuentro terminando algunos ajustes así que le voy a dar que no pero estas re mega que si prontamente va? 	8599671840	2026-03-08 08:58:17.484513+00	2026-03-07 23:26:38.985637+00	2026-03-08 08:58:17.484513+00	\N
\.


--
-- Name: creator_enrollments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: pnptvbot
--

SELECT pg_catalog.setval('public.creator_enrollments_id_seq', 2, true);


--
-- Name: creator_milestone_notifications_id_seq; Type: SEQUENCE SET; Schema: public; Owner: pnptvbot
--

SELECT pg_catalog.setval('public.creator_milestone_notifications_id_seq', 2, true);


--
-- PostgreSQL database dump complete
--

\unrestrict x799JFCsHBFSZAtoedPMHhvHHdi5clh5T8eUGQ0BWDfqnXPbUkFbmrIURXcv6Ye

