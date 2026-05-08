CREATE DATABASE IF NOT EXISTS paginaauto
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE paginaauto;

CREATE TABLE IF NOT EXISTS previews (
  id           VARCHAR(64)  PRIMARY KEY,
  source       VARCHAR(16)  NOT NULL,
  status       VARCHAR(24)  NOT NULL DEFAULT 'pending',
  priority     VARCHAR(16)  NOT NULL DEFAULT 'medium',
  file         VARCHAR(512),
  line         INT,
  message      TEXT,
  stack        MEDIUMTEXT,
  diagnosis    MEDIUMTEXT,
  original     LONGTEXT,
  fixed        LONGTEXT,
  diff         LONGTEXT,
  validation   TEXT,
  backup_path  VARCHAR(512),
  extra        JSON         NULL,
  deployer     VARCHAR(32)  NULL,
  catalog_code VARCHAR(64)  NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_status (status),
  INDEX idx_priority (priority),
  INDEX idx_created (created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS notes (
  id         VARCHAR(64)  PRIMARY KEY,
  date       DATE         NOT NULL,
  text       TEXT         NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_date (date)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS error_catalog (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  code          VARCHAR(64)  NOT NULL,
  platform      VARCHAR(32)  NOT NULL,
  pattern_regex VARCHAR(512) NULL,
  category      VARCHAR(64)  NULL,
  severity      VARCHAR(16)  NOT NULL DEFAULT 'medium',
  cause         TEXT         NULL,
  solution      TEXT         NULL,
  docs_url      VARCHAR(512) NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uniq_code_platform (code, platform),
  INDEX idx_platform (platform)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS deployers (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(32)  NOT NULL UNIQUE,
  display_name  VARCHAR(64)  NOT NULL,
  url_patterns  JSON         NULL,
  header_hints  JSON         NULL,
  color         VARCHAR(16)  NULL,
  docs_url      VARCHAR(512) NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS chat_messages (
  id         BIGINT       PRIMARY KEY AUTO_INCREMENT,
  role       VARCHAR(32)  NOT NULL,
  content    MEDIUMTEXT   NOT NULL,
  created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_created (created_at)
) ENGINE=InnoDB;
