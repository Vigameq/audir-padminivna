ALTER TABLE nc_actions
  ADD COLUMN IF NOT EXISTS assigned_user_id BIGINT REFERENCES users(id);
