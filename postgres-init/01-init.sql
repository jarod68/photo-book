CREATE TABLE IF NOT EXISTS photo_views (
  id       SERIAL PRIMARY KEY,
  album    VARCHAR(255) NOT NULL,
  filename VARCHAR(255) NOT NULL,
  views    BIGINT       NOT NULL DEFAULT 0,
  UNIQUE (album, filename)
);
