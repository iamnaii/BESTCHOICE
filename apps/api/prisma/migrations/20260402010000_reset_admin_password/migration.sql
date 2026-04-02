-- Reset admin password to '123456'
UPDATE "users"
SET "password" = '$2b$10$RfxhofrUrnSJMbMNnW0vZ.XvuLKA955DnKVctLg5EDLzDybnGAXTC'
WHERE "email" = 'akenarin.ak@gmail.com';
