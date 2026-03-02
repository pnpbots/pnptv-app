CREATE TABLE IF NOT EXISTS support_ticket_messages (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  sender_type VARCHAR(20) NOT NULL,
  sender_name VARCHAR(255),
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_stm_user_id ON support_ticket_messages(user_id);
CREATE INDEX IF NOT EXISTS idx_stm_created_at ON support_ticket_messages(created_at);
