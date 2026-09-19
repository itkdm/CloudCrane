-- Official PbootCMS V3.2.26 SQLite migration.
-- Upstream commit: 8c7ad1da5e1d1ba217fde56912f001e14cb9b0ea
-- SHA-256: 23dcede5cd8745a3820705b41d1f42ea18b923e0613c3e59ce02156530fe0696
--
-- Sqlite数据库升级脚本
-- 适用于PbootCMS 3.2.26
-- 说明：ay_content 索引与新装 schema 对齐，IF EXISTS / IF NOT EXISTS 保证可重复执行。

CREATE INDEX IF NOT EXISTS ay_content_title_index ON ay_content (title);

DROP INDEX IF EXISTS ay_content_unique;
