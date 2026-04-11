-- Register channel-access as a one-time add_on for paid channel/hangout access
INSERT INTO add_ons (id, name, add_on_type, description)
VALUES ('channel-access', 'Channel Access', 'one-time', 'One-time access to a paid creator channel and its linked hangout')
ON CONFLICT (id) DO NOTHING;
