CREATE TABLE chat_library_operations (
 id TEXT PRIMARY KEY, request_key TEXT NOT NULL UNIQUE,
 company TEXT NOT NULL CHECK (company IN ('SHOP','FINANCE')),
 action TEXT NOT NULL CHECK (action IN ('SEND','CREDIT')),
 actor_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 room_id TEXT NOT NULL REFERENCES chat_rooms(id) ON DELETE RESTRICT,
 file_id TEXT NOT NULL REFERENCES chat_library_files(id) ON DELETE RESTRICT,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX chat_library_operations_room_idx ON chat_library_operations(room_id);
CREATE INDEX chat_library_operations_file_idx ON chat_library_operations(file_id);
CREATE INDEX chat_library_operations_actor_idx ON chat_library_operations(actor_id);
ALTER TABLE room_credit_files ADD COLUMN library_request_key TEXT UNIQUE, ADD COLUMN source_library_file_id TEXT;
