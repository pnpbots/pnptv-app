-- Add compound index on nearby_places for location-based proximity queries
-- Eliminates full table scan on every map search
CREATE INDEX IF NOT EXISTS idx_nearby_places_location
  ON nearby_places (location_lat, location_lng)
  WHERE location_lat IS NOT NULL AND location_lng IS NOT NULL;
