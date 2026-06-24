-- Promote the product's designated admin (Ida) from the legacy email-allowlist
-- bootstrap to a real 'admin' role, so she is managed by role like everyone
-- else instead of showing up as an "Agent" who merely has Settings access.
-- Idempotent: only touches rows still on the default 'agent' role, and
-- User.email is unique so at most one row matches.
UPDATE "User" SET "role" = 'admin'
WHERE LOWER("email") = 'ida@doldadress.se' AND "role" = 'agent';
