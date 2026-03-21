-- Migration 174: Stream Analytics Sessions
-- Tracks each individual live stream session with viewer, tip, and duration metrics.

CREATE TABLE IF NOT EXISTS live_stream_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_ref VARCHAR(100) NOT NULL,
  streamer_id VARCHAR(100) NOT NULL,
  stream_type VARCHAR(20) DEFAULT 'hls', -- 'hls' or 'webrtc'
  title VARCHAR(200),
  description TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  peak_viewers INTEGER DEFAULT 0,
  total_unique_viewers INTEGER DEFAULT 0,
  total_tips_amount DECIMAL(10,2) DEFAULT 0,
  total_tips_count INTEGER DEFAULT 0,
  avg_watch_duration_seconds INTEGER DEFAULT 0,
  thumbnail_url TEXT,
  status VARCHAR(20) DEFAULT 'live', -- 'live', 'ended', 'error'
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stream_sessions_channel ON live_stream_sessions(channel_ref);
CREATE INDEX IF NOT EXISTS idx_stream_sessions_streamer ON live_stream_sessions(streamer_id);
CREATE INDEX IF NOT EXISTS idx_stream_sessions_started ON live_stream_sessions(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_stream_sessions_status ON live_stream_sessions(status);
