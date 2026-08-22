-- Adds role-based access control: admin (full CRUD, including managing
-- other users), technician (create/edit catalog items, no delete, no user
-- management beyond their own password), beginner (read-only everywhere,
-- own password only). Existing accounts default to admin so nobody already
-- using this system is locked out or silently demoted by this change.
ALTER TABLE technicians ADD COLUMN role TEXT NOT NULL DEFAULT 'admin';
