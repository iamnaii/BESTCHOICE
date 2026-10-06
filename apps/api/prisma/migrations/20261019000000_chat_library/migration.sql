CREATE TABLE chat_library_folders (
 id TEXT PRIMARY KEY, company TEXT NOT NULL CHECK (company IN ('SHOP','FINANCE')),
 branch_id TEXT REFERENCES branches(id) ON DELETE RESTRICT,
 creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 name TEXT NOT NULL, created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP(3) NOT NULL, deleted_at TIMESTAMP(3)
);
CREATE INDEX chat_library_folders_scope_idx ON chat_library_folders(company,branch_id,deleted_at);
CREATE UNIQUE INDEX chat_library_folders_name_idx ON chat_library_folders(company,COALESCE(branch_id,''),lower(name)) WHERE deleted_at IS NULL;
CREATE TABLE chat_library_files (
 id TEXT PRIMARY KEY, company TEXT NOT NULL CHECK (company IN ('SHOP','FINANCE')),
 branch_id TEXT REFERENCES branches(id) ON DELETE RESTRICT,
 creator_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 folder_id TEXT REFERENCES chat_library_folders(id) ON DELETE RESTRICT,
 key TEXT NOT NULL UNIQUE, name TEXT NOT NULL, mime_type TEXT NOT NULL,
 size INTEGER NOT NULL CHECK (size > 0 AND size <= 10485760),
 request_key TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL,
 created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TIMESTAMP(3) NOT NULL, deleted_at TIMESTAMP(3)
);
CREATE INDEX chat_library_files_scope_idx ON chat_library_files(company,branch_id,deleted_at,created_at);
CREATE INDEX chat_library_files_folder_idx ON chat_library_files(folder_id);
CREATE INDEX chat_library_files_creator_idx ON chat_library_files(creator_id);
