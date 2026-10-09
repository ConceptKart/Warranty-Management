-- ============================================================================
-- Warranty & Replacement Management — MySQL schema
-- Source of truth: PROJECT_FLOW.md + existing Next.js / Prisma usage
-- Dialect: MySQL 8.x (utf8mb4)
--
-- Fresh install: run this file top-to-bottom on an empty database.
-- Table/column names match the current application queries where possible.
-- ============================================================================

SET NAMES utf8mb4;
SET time_zone = '+00:00';
SET FOREIGN_KEY_CHECKS = 0;
SET SQL_MODE = 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION';

-- Optional: CREATE DATABASE IF NOT EXISTS warranty_management
--   CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- USE warranty_management;

-- ============================================================================
-- 1. Identity & Access
-- ============================================================================

CREATE TABLE IF NOT EXISTS roles (
  role_id      INT UNSIGNED NOT NULL AUTO_INCREMENT,
  role_code    VARCHAR(20)  NOT NULL,
  role_name    VARCHAR(50)  NOT NULL,
  description  VARCHAR(255) NULL,
  is_active    TINYINT(1)   NOT NULL DEFAULT 1,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (role_id),
  UNIQUE KEY uq_roles_code (role_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS permissions (
  permission_id   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  permission_code VARCHAR(50)  NOT NULL,
  permission_name VARCHAR(100) NOT NULL,
  description     VARCHAR(255) NULL,
  created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (permission_id),
  UNIQUE KEY uq_permissions_code (permission_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS role_permissions (
  role_permission_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  role_id            INT UNSIGNED NOT NULL,
  permission_id      INT UNSIGNED NOT NULL,
  created_at         DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (role_permission_id),
  UNIQUE KEY uq_role_permission (role_id, permission_id),
  CONSTRAINT fk_rp_role
    FOREIGN KEY (role_id) REFERENCES roles (role_id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_rp_permission
    FOREIGN KEY (permission_id) REFERENCES permissions (permission_id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- App reads admin_users.role as a string code (admin/manager/...).
-- role_id is the relational link; role is kept for API/session compatibility.
CREATE TABLE IF NOT EXISTS admin_users (
  user_id       INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username      VARCHAR(50)  NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name     VARCHAR(100) NOT NULL,
  email         VARCHAR(100) NULL DEFAULT '',
  role_id       INT UNSIGNED NULL,
  role          VARCHAR(20)  NOT NULL DEFAULT 'support',
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  last_login    DATETIME     NULL,
  created_at    DATETIME     NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  UNIQUE KEY uq_admin_users_username (username),
  KEY idx_admin_users_role (role),
  KEY idx_admin_users_role_id (role_id),
  KEY idx_admin_users_active (is_active),
  CONSTRAINT fk_admin_users_role
    FOREIGN KEY (role_id) REFERENCES roles (role_id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 2. Customers
-- ============================================================================

CREATE TABLE IF NOT EXISTS customers (
  customer_id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  baselinker_customer_id  VARCHAR(50)  NULL,
  email                   VARCHAR(255) NOT NULL,
  first_name              VARCHAR(100) NULL,
  last_name               VARCHAR(100) NULL,
  phone                   VARCHAR(20)  NULL,
  address                 TEXT         NULL,
  created_at              DATETIME     NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME     NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (customer_id),
  KEY idx_customers_email (email),
  KEY idx_customers_phone (phone),
  KEY idx_customers_baselinker (baselinker_customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 3. Product catalog + warranty mappings
-- ============================================================================

CREATE TABLE IF NOT EXISTS products (
  product_id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  baselinker_product_id    VARCHAR(50)  NULL,
  product_name             VARCHAR(255) NOT NULL,
  product_sku              VARCHAR(100) NULL,
  category                 VARCHAR(100) NULL,
  warranty_period_months   DECIMAL(4,2) NULL DEFAULT 12.00,
  replacement_period_days  DECIMAL(4,2) NULL DEFAULT 10.00,
  is_electronic            TINYINT(1)   NULL DEFAULT 1,
  ean                      VARCHAR(50)  NULL,
  created_at               DATETIME     NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               DATETIME     NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (product_id),
  KEY idx_products_sku (product_sku),
  KEY idx_products_ean (ean),
  KEY idx_products_baselinker (baselinker_product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Website / BaseLinker catalog warranty source (used by portal + Amazon fallback)
CREATE TABLE IF NOT EXISTS bl_products (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id      BIGINT       NULL COMMENT 'BaseLinker product id',
  parent_id       BIGINT       NULL DEFAULT 0,
  sku             VARCHAR(100) NULL,
  ean             VARCHAR(50)  NULL,
  category_id     INT          NULL,
  category_name   VARCHAR(150) NULL,
  product_name    VARCHAR(255) NULL,
  is_variant      TINYINT(1)   NULL DEFAULT 0,
  inventory_id    INT          NULL,
  synced_at       DATETIME     NULL,
  warranty        VARCHAR(100) NULL COMMENT 'Text e.g. "1 year", "6 months"',
  created_at      DATETIME     NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bl_products_sku (sku),
  KEY idx_bl_products_ean (ean),
  KEY idx_bl_products_category (category_id),
  KEY idx_bl_products_product_id (product_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Amazon SKU / variant warranty mapping (months)
CREATE TABLE IF NOT EXISTS amazon_sku_mapping (
  mapping_id      INT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id      VARCHAR(50)  NULL,
  variant_id      VARCHAR(50)  NULL,
  sku             VARCHAR(100) NULL,
  warranty_given  DECIMAL(6,2) NULL DEFAULT 0 COMMENT 'Warranty months',
  created_at      DATETIME     NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME     NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (mapping_id),
  KEY idx_asm_product (product_id),
  KEY idx_asm_variant (variant_id),
  KEY idx_asm_sku (sku)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 4. Troubleshooting
-- ============================================================================

CREATE TABLE IF NOT EXISTS issue_types (
  issue_type_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  issue_name    VARCHAR(100) NOT NULL,
  issue_code    VARCHAR(50)  NOT NULL,
  description   TEXT         NULL,
  is_active     TINYINT(1)   NULL DEFAULT 1,
  created_at    DATETIME     NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (issue_type_id),
  UNIQUE KEY uq_issue_types_code (issue_code),
  KEY idx_issue_types_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Category / EAN troubleshooting content (portal ean-issues API)
CREATE TABLE IF NOT EXISTS troubleshooting_guide (
  guide_id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  category_id        INT          NULL,
  ean                VARCHAR(50)  NULL,
  issue              VARCHAR(255) NOT NULL,
  troubleshoot_steps TEXT         NULL,
  sort_order         INT          NOT NULL DEFAULT 0,
  is_active          TINYINT(1)   NOT NULL DEFAULT 1,
  created_at         DATETIME     NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME     NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (guide_id),
  KEY idx_tg_category (category_id),
  KEY idx_tg_ean (ean),
  KEY idx_tg_issue (issue)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Hostinger api_category_issues parity
CREATE TABLE IF NOT EXISTS category_issues (
  id                     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  category               VARCHAR(150) NOT NULL,
  issue_name             VARCHAR(255) NOT NULL,
  troubleshooting_steps  TEXT         NOT NULL,
  created_at             DATETIME     NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             DATETIME     NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_category_issues_category (category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 5. Canonical orders + line items
-- ============================================================================

CREATE TABLE IF NOT EXISTS orders (
  order_id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  baselinker_order_id   VARCHAR(50)  NOT NULL,
  order_number          VARCHAR(100) NULL,
  customer_id           INT UNSIGNED NOT NULL,
  source_platform       VARCHAR(50)  NULL COMMENT 'amazon | shopify | website | flipkart',
  order_value           DECIMAL(10,2) NULL,
  order_status          VARCHAR(50)  NULL,
  order_date            DATETIME     NOT NULL,
  delivery_date         DATETIME     NULL,
  warranty_start_date   DATETIME     NULL,
  warranty_end_date     DATETIME     NULL,
  replacement_end_date  DATETIME     NULL,
  original_order_id     VARCHAR(50)  NULL,
  is_cloned_order       TINYINT(1)   NULL DEFAULT 0,
  clone_reason          VARCHAR(255) NULL,
  ticket_number         VARCHAR(20)  NULL,
  created_at            DATETIME     NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            DATETIME     NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (order_id),
  KEY idx_orders_baselinker (baselinker_order_id),
  KEY idx_orders_number (order_number),
  KEY idx_orders_customer (customer_id),
  KEY idx_orders_platform (source_platform),
  KEY idx_orders_date (order_date),
  KEY idx_orders_ticket_number (ticket_number),
  CONSTRAINT fk_orders_customer
    FOREIGN KEY (customer_id) REFERENCES customers (customer_id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS order_products (
  order_product_id   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id           INT UNSIGNED NOT NULL,
  product_id         INT UNSIGNED NOT NULL,
  sku                VARCHAR(100) NULL,
  ean                VARCHAR(50)  NULL,
  quantity           INT          NOT NULL DEFAULT 1,
  unit_price         DECIMAL(10,2) NULL,
  total_price        DECIMAL(10,2) NULL,
  external_line_id   VARCHAR(100) NULL,
  source_platform    VARCHAR(50)  NULL,
  created_at         DATETIME     NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (order_product_id),
  KEY idx_op_order (order_id),
  KEY idx_op_product (product_id),
  KEY idx_op_sku (sku),
  KEY idx_op_ean (ean),
  CONSTRAINT fk_op_order
    FOREIGN KEY (order_id) REFERENCES orders (order_id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_op_product
    FOREIGN KEY (product_id) REFERENCES products (product_id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 6. Amazon order mirror (portal verify + admin tools + cron sync)
-- ============================================================================

CREATE TABLE IF NOT EXISTS amazon_order_details (
  id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  amazon_order_id      VARCHAR(50)  NULL,
  sku                  VARCHAR(100) NULL,
  amazon_title         VARCHAR(255) NULL,
  order_date           DATETIME     NOT NULL,
  product_id           INT          NULL,
  variant_id           INT          NULL,
  base_linker_order_id INT          NULL,
  ean                  VARCHAR(50)  NULL,
  created_at           DATETIME     NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME     NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_amazon_order_sku (amazon_order_id, sku),
  KEY idx_aod_amazon_order (amazon_order_id),
  KEY idx_aod_sku (sku),
  KEY idx_aod_order_date (order_date),
  KEY idx_aod_baselinker (base_linker_order_id),
  KEY idx_aod_ean (ean)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 7. Shopify / Website order mirror
-- ============================================================================

CREATE TABLE IF NOT EXISTS shopify_orders (
  id                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  base_order_id     VARCHAR(100) NOT NULL,
  order_date        DATETIME     NOT NULL,
  shopify_order_id  VARCHAR(100) NOT NULL,
  product_id        BIGINT       NOT NULL DEFAULT 0,
  variant_id        BIGINT       NOT NULL DEFAULT 0,
  sku               VARCHAR(100) NULL,
  awb_number        VARCHAR(150) NULL,
  customer_name     VARCHAR(150) NOT NULL DEFAULT '',
  phone_number      VARCHAR(20)  NULL,
  email             VARCHAR(150) NULL,
  customer_address  TEXT         NOT NULL,
  city              VARCHAR(100) NOT NULL DEFAULT '',
  state             VARCHAR(100) NOT NULL DEFAULT '',
  pincode           VARCHAR(20)  NOT NULL DEFAULT '',
  qty               INT          NOT NULL DEFAULT 1,
  ean               BIGINT       NULL,
  delivery_date     DATETIME     NULL COMMENT 'Optional; 10-day replacement helpers',
  delivery_status   VARCHAR(50)  NULL COMMENT 'Optional local delivery status',
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_shopify_order_sku_variant (shopify_order_id, sku, variant_id),
  KEY idx_so_shopify_order (shopify_order_id),
  KEY idx_so_base_order (base_order_id),
  KEY idx_so_sku (sku),
  KEY idx_so_awb (awb_number),
  KEY idx_so_order_date (order_date),
  KEY idx_so_ean (ean)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 8. Ticket types & statuses
-- ============================================================================

CREATE TABLE IF NOT EXISTS ticket_types (
  ticket_type_id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  type_name      VARCHAR(50)  NOT NULL,
  type_code      VARCHAR(20)  NOT NULL,
  description    TEXT         NULL,
  is_active      TINYINT(1)   NULL DEFAULT 1,
  PRIMARY KEY (ticket_type_id),
  UNIQUE KEY uq_ticket_types_code (type_code),
  KEY idx_ticket_types_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ticket_statuses (
  status_id      INT UNSIGNED NOT NULL AUTO_INCREMENT,
  status_name    VARCHAR(100) NOT NULL,
  status_code    VARCHAR(50)  NOT NULL,
  ticket_type_id INT UNSIGNED NOT NULL,
  sort_order     INT          NOT NULL DEFAULT 0,
  is_final       TINYINT(1)   NULL DEFAULT 0,
  is_protected   TINYINT(1)   NOT NULL DEFAULT 0
    COMMENT 'Admin-set / protected from blind shipment sync overwrite',
  is_active      TINYINT(1)   NULL DEFAULT 1,
  status_color   VARCHAR(7)   NULL DEFAULT '#007bff',
  created_at     DATETIME     NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (status_id),
  UNIQUE KEY uq_status_code_per_type (ticket_type_id, status_code),
  KEY idx_ts_type_sort (ticket_type_id, sort_order),
  KEY idx_ts_code (status_code),
  CONSTRAINT fk_ts_ticket_type
    FOREIGN KEY (ticket_type_id) REFERENCES ticket_types (ticket_type_id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 9. Warranty tickets (core case file)
-- ============================================================================

CREATE TABLE IF NOT EXISTS warranty_tickets (
  ticket_id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_number             VARCHAR(20)  NOT NULL,
  order_id                  INT UNSIGNED NOT NULL,
  claim_number              VARCHAR(100) NULL,
  product_id                INT UNSIGNED NOT NULL,
  selected_products_json    TEXT         NULL COMMENT 'Legacy multi-product JSON snapshot',
  product_quantity          INT          NOT NULL DEFAULT 1,
  ticket_type_id            INT UNSIGNED NOT NULL,
  issue_type_id             INT UNSIGNED NOT NULL,
  status_id                 INT UNSIGNED NOT NULL,
  customer_description      TEXT         NOT NULL,
  internal_notes            TEXT         NULL,
  resolution_details        TEXT         NULL,
  ticket_date               DATETIME     NULL DEFAULT CURRENT_TIMESTAMP,
  resolution_date           DATETIME     NULL,
  priority                  VARCHAR(20)  NOT NULL DEFAULT 'medium',
  assigned_to               VARCHAR(100) NULL,
  tracking_number           VARCHAR(100) NULL,
  awb_number                VARCHAR(100) NULL,
  reverse_awb_number        VARCHAR(100) NULL,
  courier_partner           VARCHAR(100) NULL,
  shipment_status           VARCHAR(50)  NULL DEFAULT 'pending',
  baselinker_integrated     TINYINT(1)   NULL DEFAULT 0,
  cloned_from_order_id      INT UNSIGNED NULL,
  replacement_ean           VARCHAR(100) NULL,
  replacement_product_id    INT          NULL,
  replacement_variant_id    INT          NULL,
  replacement_warehouse_id  INT          NULL,
  replacement_location      VARCHAR(100) NULL,
  source_device             VARCHAR(255) NULL,
  created_at                DATETIME     NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                DATETIME     NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (ticket_id),
  UNIQUE KEY uq_warranty_tickets_number (ticket_number),
  KEY idx_wt_order (order_id),
  KEY idx_wt_product (product_id),
  KEY idx_wt_type (ticket_type_id),
  KEY idx_wt_status (status_id),
  KEY idx_wt_issue (issue_type_id),
  KEY idx_wt_priority (priority),
  KEY idx_wt_awb (awb_number),
  KEY idx_wt_reverse_awb (reverse_awb_number),
  KEY idx_wt_claim (claim_number),
  KEY idx_wt_created (created_at),
  CONSTRAINT fk_wt_order
    FOREIGN KEY (order_id) REFERENCES orders (order_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_wt_product
    FOREIGN KEY (product_id) REFERENCES products (product_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_wt_type
    FOREIGN KEY (ticket_type_id) REFERENCES ticket_types (ticket_type_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_wt_status
    FOREIGN KEY (status_id) REFERENCES ticket_statuses (status_id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_wt_issue
    FOREIGN KEY (issue_type_id) REFERENCES issue_types (issue_type_id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Normalized multi-product claim lines (complements selected_products_json)
CREATE TABLE IF NOT EXISTS ticket_items (
  ticket_item_id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id                INT UNSIGNED NOT NULL,
  product_id               INT UNSIGNED NULL,
  sku                      VARCHAR(100) NULL,
  ean                      VARCHAR(50)  NULL,
  product_name_snapshot    VARCHAR(255) NULL,
  quantity                 INT          NOT NULL DEFAULT 1,
  issue_text               VARCHAR(255) NULL,
  warranty_months          DECIMAL(6,2) NULL,
  warranty_status          VARCHAR(40)  NULL COMMENT 'active | expired_by_date | no_info',
  warranty_eligible        TINYINT(1)   NULL,
  replacement_eligible     TINYINT(1)   NULL,
  created_at               DATETIME     NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (ticket_item_id),
  KEY idx_ti_ticket (ticket_id),
  KEY idx_ti_product (product_id),
  KEY idx_ti_sku (sku),
  CONSTRAINT fk_ti_ticket
    FOREIGN KEY (ticket_id) REFERENCES warranty_tickets (ticket_id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_ti_product
    FOREIGN KEY (product_id) REFERENCES products (product_id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ticket_status_history (
  history_id     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id      INT UNSIGNED NOT NULL,
  old_status_id  INT UNSIGNED NULL,
  new_status_id  INT UNSIGNED NOT NULL,
  changed_by     VARCHAR(100) NOT NULL,
  change_reason  TEXT         NULL,
  notes          TEXT         NULL,
  changed_at     DATETIME     NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (history_id),
  KEY idx_tsh_ticket (ticket_id),
  KEY idx_tsh_changed_at (changed_at),
  KEY idx_tsh_new_status (new_status_id),
  CONSTRAINT fk_tsh_ticket
    FOREIGN KEY (ticket_id) REFERENCES warranty_tickets (ticket_id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_tsh_old_status
    FOREIGN KEY (old_status_id) REFERENCES ticket_statuses (status_id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_tsh_new_status
    FOREIGN KEY (new_status_id) REFERENCES ticket_statuses (status_id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ticket_comments (
  comment_id    INT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id     INT UNSIGNED NOT NULL,
  comment_type  VARCHAR(20)  NOT NULL DEFAULT 'note',
  comment_text  TEXT         NOT NULL,
  author_name   VARCHAR(100) NOT NULL,
  author_email  VARCHAR(255) NULL,
  author_user_id INT UNSIGNED NULL,
  is_internal   TINYINT(1)   NULL DEFAULT 0,
  created_at    DATETIME     NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (comment_id),
  KEY idx_tc_ticket (ticket_id),
  KEY idx_tc_author_user (author_user_id),
  CONSTRAINT fk_tc_ticket
    FOREIGN KEY (ticket_id) REFERENCES warranty_tickets (ticket_id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_tc_author_user
    FOREIGN KEY (author_user_id) REFERENCES admin_users (user_id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ticket_attachments (
  attachment_id      INT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id          INT UNSIGNED NOT NULL,
  original_filename  VARCHAR(255) NOT NULL,
  stored_filename    VARCHAR(255) NOT NULL,
  file_path          VARCHAR(500) NOT NULL,
  remote_url         VARCHAR(500) NULL,
  file_type          VARCHAR(50)  NOT NULL,
  file_size          INT          NOT NULL DEFAULT 0,
  is_compressed      TINYINT(1)   NULL DEFAULT 0,
  uploaded_by        VARCHAR(100) NOT NULL,
  created_at         DATETIME     NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (attachment_id),
  KEY idx_ta_ticket (ticket_id),
  CONSTRAINT fk_ta_ticket
    FOREIGN KEY (ticket_id) REFERENCES warranty_tickets (ticket_id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- App table name is ticket_email_log (singular)
CREATE TABLE IF NOT EXISTS ticket_email_log (
  log_id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id        INT UNSIGNED NULL,
  recipient_email  VARCHAR(255) NOT NULL,
  subject          VARCHAR(500) NOT NULL,
  status_code      VARCHAR(80)  NOT NULL DEFAULT '' COMMENT 'Trigger/source e.g. pending, accepted, custom',
  sent             TINYINT(1)   NOT NULL DEFAULT 0,
  error_message    TEXT         NULL,
  body_html        MEDIUMTEXT   NULL,
  smtp_response    VARCHAR(255) NULL,
  sent_at          DATETIME     NOT NULL,
  created_at       DATETIME     NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (log_id),
  KEY idx_tel_ticket (ticket_id),
  KEY idx_tel_sent_at (sent_at),
  KEY idx_tel_recipient (recipient_email),
  CONSTRAINT fk_tel_ticket
    FOREIGN KEY (ticket_id) REFERENCES warranty_tickets (ticket_id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 10. Logistics: shipments + tracking
-- ============================================================================

CREATE TABLE IF NOT EXISTS shipments (
  shipment_id        INT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id          INT UNSIGNED NOT NULL,
  awb_number         VARCHAR(100) NOT NULL,
  courier_partner    VARCHAR(100) NOT NULL,
  shipment_type      VARCHAR(20)  NOT NULL DEFAULT 'forward' COMMENT 'forward | reverse',
  pickup_address     TEXT         NULL,
  delivery_address   TEXT         NOT NULL,
  shipment_status    VARCHAR(50)  NULL DEFAULT 'created',
  estimated_delivery DATETIME     NULL,
  actual_delivery    DATETIME     NULL,
  weight_kg          DECIMAL(8,3) NULL,
  dimensions         VARCHAR(100) NULL,
  declared_value     DECIMAL(10,2) NULL,
  cod_amount         DECIMAL(10,2) NULL DEFAULT 0,
  shipway_order_id   VARCHAR(100) NULL,
  tracking_url       VARCHAR(500) NULL,
  created_at         DATETIME     NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME     NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (shipment_id),
  KEY idx_shipments_ticket (ticket_id),
  KEY idx_shipments_awb (awb_number),
  KEY idx_shipments_type (shipment_type),
  KEY idx_shipments_status (shipment_status),
  KEY idx_shipments_shipway (shipway_order_id),
  CONSTRAINT fk_shipments_ticket
    FOREIGN KEY (ticket_id) REFERENCES warranty_tickets (ticket_id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shipment_tracking (
  tracking_id       INT UNSIGNED NOT NULL AUTO_INCREMENT,
  shipment_id       INT UNSIGNED NOT NULL,
  status_code       VARCHAR(50)  NOT NULL,
  status_message    VARCHAR(255) NULL,
  location          VARCHAR(255) NULL,
  timestamp         DATETIME     NOT NULL,
  courier_status    VARCHAR(100) NULL,
  remarks           TEXT         NULL,
  is_delivered      TINYINT(1)   NOT NULL DEFAULT 0,
  is_exception      TINYINT(1)   NOT NULL DEFAULT 0,
  exception_reason  VARCHAR(255) NULL,
  raw_event         JSON         NULL,
  created_at        DATETIME     NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tracking_id),
  KEY idx_st_shipment (shipment_id),
  KEY idx_st_timestamp (timestamp),
  KEY idx_st_status (status_code),
  CONSTRAINT fk_st_shipment
    FOREIGN KEY (shipment_id) REFERENCES shipments (shipment_id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- 11. Shipway integration support tables (used by existing code)
-- ============================================================================

CREATE TABLE IF NOT EXISTS shipway_config (
  config_id        INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email            VARCHAR(150) NULL,
  api_key          VARCHAR(255) NULL,
  api_url          VARCHAR(255) NULL,
  timeout_seconds  INT          NULL DEFAULT 30,
  is_active        TINYINT(1)   NOT NULL DEFAULT 1,
  created_at       DATETIME     NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (config_id),
  KEY idx_shipway_config_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shipway_webhook_logs (
  webhook_id        INT UNSIGNED NOT NULL AUTO_INCREMENT,
  awb_number        VARCHAR(100) NULL,
  event_type        VARCHAR(80)  NULL,
  webhook_data      MEDIUMTEXT   NOT NULL COMMENT 'Raw JSON payload',
  shipment_id       INT UNSIGNED NULL,
  processed         TINYINT(1)   NOT NULL DEFAULT 0,
  processing_error  TEXT         NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at      DATETIME     NULL,
  PRIMARY KEY (webhook_id),
  KEY idx_swl_awb (awb_number),
  KEY idx_swl_processed (processed),
  KEY idx_swl_created (created_at),
  KEY idx_swl_shipment (shipment_id),
  CONSTRAINT fk_swl_shipment
    FOREIGN KEY (shipment_id) REFERENCES shipments (shipment_id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shipway_tracking_cache (
  cache_id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  awb_number           VARCHAR(100) NOT NULL,
  shipment_type        VARCHAR(20)  NULL,
  external_status      VARCHAR(100) NULL,
  mapped_status        VARCHAR(50)  NULL,
  external_updated_at  VARCHAR(50)  NULL,
  last_synced_at       DATETIME     NULL,
  tracking_data        MEDIUMTEXT   NULL,
  expires_at           DATETIME     NULL,
  created_at           DATETIME     NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME     NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (cache_id),
  UNIQUE KEY uq_stc_awb (awb_number),
  KEY idx_stc_mapped (mapped_status),
  KEY idx_stc_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shipway_sync_state (
  sync_key         VARCHAR(100) NOT NULL,
  last_sync_value  VARCHAR(255) NULL,
  updated_at       DATETIME     NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (sync_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shipway_activity_logs (
  activity_id   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  activity_type VARCHAR(80)  NULL,
  awb_number    VARCHAR(100) NULL,
  message       TEXT         NULL,
  meta_json     MEDIUMTEXT   NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (activity_id),
  KEY idx_sal_awb (awb_number),
  KEY idx_sal_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================================
-- 12. Seed / reference data
-- ============================================================================

INSERT INTO roles (role_code, role_name, description) VALUES
  ('admin',      'Administrator', 'Full access including user management'),
  ('manager',    'Manager',       'Tickets, reports, export; no user management'),
  ('support',    'Support',       'Ticket handling and status updates'),
  ('operations', 'Operations',    'Shipments and AWB assignment'),
  ('packer',     'Packer',        'Pack / handover and shipment viewing')
ON DUPLICATE KEY UPDATE
  role_name = VALUES(role_name),
  description = VALUES(description);

INSERT INTO permissions (permission_code, permission_name) VALUES
  ('view_all_tickets',        'View all tickets'),
  ('edit_tickets',            'Edit tickets'),
  ('delete_tickets',          'Delete tickets'),
  ('manage_users',            'Manage admin users'),
  ('view_reports',            'View reports'),
  ('export_data',             'Export ticket data'),
  ('manage_statuses',         'Manage ticket statuses'),
  ('view_internal_comments',  'View internal comments'),
  ('add_internal_comments',   'Add internal comments'),
  ('manage_shipments',        'Manage shipments'),
  ('assign_awb',              'Assign AWB'),
  ('view_shipment_info',      'View shipment info'),
  ('update_pack_status',      'Update pack / handover status')
ON DUPLICATE KEY UPDATE
  permission_name = VALUES(permission_name);

-- Role → permission matrix (mirrors src/lib/auth/permissions.ts)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
CROSS JOIN permissions p
WHERE r.role_code = 'admin'
ON DUPLICATE KEY UPDATE role_id = role_permissions.role_id;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
JOIN permissions p ON p.permission_code IN (
  'view_all_tickets','edit_tickets','view_reports','export_data',
  'manage_statuses','view_internal_comments','add_internal_comments'
)
WHERE r.role_code = 'manager'
ON DUPLICATE KEY UPDATE role_id = role_permissions.role_id;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
JOIN permissions p ON p.permission_code IN (
  'view_all_tickets','edit_tickets','manage_statuses','add_internal_comments'
)
WHERE r.role_code = 'support'
ON DUPLICATE KEY UPDATE role_id = role_permissions.role_id;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
JOIN permissions p ON p.permission_code IN (
  'view_all_tickets','edit_tickets','manage_shipments','assign_awb',
  'manage_statuses','add_internal_comments','view_shipment_info'
)
WHERE r.role_code = 'operations'
ON DUPLICATE KEY UPDATE role_id = role_permissions.role_id;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.role_id, p.permission_id
FROM roles r
JOIN permissions p ON p.permission_code IN (
  'view_all_tickets','edit_tickets','view_shipment_info',
  'update_pack_status','add_internal_comments'
)
WHERE r.role_code = 'packer'
ON DUPLICATE KEY UPDATE role_id = role_permissions.role_id;

INSERT INTO ticket_types (type_name, type_code, description, is_active) VALUES
  ('Warranty',    'warranty',    'Standard product warranty claim', 1),
  ('Replacement', 'replacement', '10-day replacement claim', 1)
ON DUPLICATE KEY UPDATE
  type_name = VALUES(type_name),
  description = VALUES(description),
  is_active = VALUES(is_active);

INSERT INTO issue_types (issue_name, issue_code, description, is_active) VALUES
  ('General Issue',     'general',           'Default / fallback issue type', 1),
  ('Not Working',       'not_working',       'Product not working', 1),
  ('Issue Not Listed',  'not_listed',        'Customer selected issue not listed', 1),
  ('Damaged',           'damaged',           'Product arrived damaged', 1),
  ('Wrong Product',     'wrong_product',     'Wrong item received', 1)
ON DUPLICATE KEY UPDATE
  issue_name = VALUES(issue_name),
  description = VALUES(description),
  is_active = VALUES(is_active);

-- Status seeds for BOTH ticket types (codes used by Shipway sync + admin UI)
-- is_protected = 1 for admin-set statuses that shipment sync must not overwrite

DROP TEMPORARY TABLE IF EXISTS tmp_status_seed;
CREATE TEMPORARY TABLE tmp_status_seed (
  status_code   VARCHAR(50) NOT NULL,
  status_name   VARCHAR(100) NOT NULL,
  sort_order    INT NOT NULL,
  is_final      TINYINT(1) NOT NULL DEFAULT 0,
  is_protected  TINYINT(1) NOT NULL DEFAULT 0,
  status_color  VARCHAR(7) NOT NULL DEFAULT '#007bff'
);

INSERT INTO tmp_status_seed (status_code, status_name, sort_order, is_final, is_protected, status_color) VALUES
  ('pending',                  'Pending',                    10, 0, 0, '#ffc107'),
  ('under_review',             'Under Review',               20, 0, 1, '#17a2b8'),
  ('accepted',                 'Accepted',                   30, 0, 1, '#28a745'),
  ('rejected',                 'Rejected',                   40, 1, 1, '#dc3545'),
  ('pending_customer',         'Pending Customer',           50, 0, 1, '#fd7e14'),
  ('escalated',                'Escalated',                  60, 0, 1, '#6f42c1'),
  ('awb_assigned_return',      'AWB Assigned (Return)',      70, 0, 0, '#007bff'),
  ('return_pickup_generated',  'Return Pickup Generated',    80, 0, 0, '#007bff'),
  ('return_out_for_pickup',    'Return Out For Pickup',      90, 0, 0, '#0d6efd'),
  ('return_in_transit',        'Return In Transit',         100, 0, 0, '#0d6efd'),
  ('return_delivered',         'Return Delivered',          110, 0, 0, '#198754'),
  ('return_cancelled',         'Return Cancelled',          120, 0, 0, '#6c757d'),
  ('awb_assigned_forward',     'AWB Assigned (Forward)',    130, 0, 0, '#007bff'),
  ('in_transit',               'In Transit',                140, 0, 0, '#0d6efd'),
  ('out_for_delivery',         'Out For Delivery',          150, 0, 0, '#0d6efd'),
  ('delivered',                'Delivered',                 160, 0, 0, '#198754'),
  ('undelivered',              'Undelivered',               170, 0, 0, '#dc3545'),
  ('pickup_exception',         'Pickup Exception',          180, 0, 0, '#dc3545'),
  ('unit_replaced',            'Unit Replaced',             190, 0, 1, '#20c997'),
  ('refund_initiated',         'Refund Initiated',          200, 0, 0, '#fd7e14'),
  ('case_completed',           'Case Completed',            210, 1, 1, '#6c757d'),
  ('closed',                   'Closed',                    220, 1, 1, '#343a40');

INSERT INTO ticket_statuses (
  status_name, status_code, ticket_type_id, sort_order,
  is_final, is_protected, is_active, status_color
)
SELECT
  s.status_name,
  s.status_code,
  t.ticket_type_id,
  s.sort_order,
  s.is_final,
  s.is_protected,
  1,
  s.status_color
FROM tmp_status_seed s
CROSS JOIN ticket_types t
WHERE t.type_code IN ('warranty', 'replacement')
  AND NOT EXISTS (
    SELECT 1 FROM ticket_statuses ts
    WHERE ts.ticket_type_id = t.ticket_type_id
      AND ts.status_code = s.status_code
  );

DROP TEMPORARY TABLE IF EXISTS tmp_status_seed;

-- Default admin user (password: admin123) — change immediately in production
-- bcrypt hash generated for admin123
INSERT INTO admin_users (
  username, password_hash, full_name, email, role_id, role, is_active, created_at
)
SELECT
  'admin',
  '$2b$10$tLnT1c0UL19rKn7TuqAGGu4KD3j9KrIvH/7Q2fjk9sjUEB6zwdsN6',
  'System Administrator',
  'admin@conceptkart.com',
  r.role_id,
  'admin',
  1,
  NOW()
FROM roles r
WHERE r.role_code = 'admin'
  AND NOT EXISTS (SELECT 1 FROM admin_users u WHERE u.username = 'admin');

INSERT INTO admin_users (
  username, password_hash, full_name, email, role_id, role, is_active, created_at
)
SELECT
  'manager',
  '$2b$10$tLnT1c0UL19rKn7TuqAGGu4KD3j9KrIvH/7Q2fjk9sjUEB6zwdsN6',
  'Customer Service Manager',
  'manager@conceptkart.com',
  r.role_id,
  'manager',
  1,
  NOW()
FROM roles r
WHERE r.role_code = 'manager'
  AND NOT EXISTS (SELECT 1 FROM admin_users u WHERE u.username = 'manager');

-- Placeholder product so claims can resolve a product_id on fresh DBs
INSERT INTO products (
  product_name, product_sku, category,
  warranty_period_months, replacement_period_days, is_electronic, created_at
)
SELECT
  'Placeholder Product', 'PLACEHOLDER-SKU', 'General',
  12.00, 10.00, 1, NOW()
WHERE NOT EXISTS (SELECT 1 FROM products LIMIT 1);

-- ============================================================================
-- BaseLinker orders mirror (Hostinger api_baseorders)
-- ============================================================================

CREATE TABLE IF NOT EXISTS baseorders (
  id                        BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id                  BIGINT       NOT NULL,
  shop_order_id             VARCHAR(100) NULL,
  external_order_id         VARCHAR(100) NULL,
  order_source              VARCHAR(100) NULL,
  order_source_id           INT          NULL,
  order_source_info         VARCHAR(255) NULL,
  order_status_id           INT          NULL,
  order_page                INT          NULL,
  confirmed                 TINYINT(1)   NULL DEFAULT 0,
  date_add                  INT          NULL,
  date_confirmed            INT          NULL,
  date_in_status            INT          NULL,
  user_login                VARCHAR(150) NULL,
  phone                     VARCHAR(50)  NULL,
  email                     VARCHAR(255) NULL,
  user_comments             TEXT         NULL,
  admin_comments            TEXT         NULL,
  currency                  VARCHAR(10)  NULL,
  payment_method            VARCHAR(100) NULL,
  payment_method_cod        TINYINT(1)   NULL,
  payment_done              DECIMAL(12,2) NULL,
  want_invoice              TINYINT(1)   NULL,
  delivery_method_id        INT          NULL,
  delivery_method           VARCHAR(150) NULL,
  delivery_price            DECIMAL(12,2) NULL,
  delivery_package_module   VARCHAR(100) NULL,
  delivery_package_nr       VARCHAR(100) NULL,
  delivery_fullname           VARCHAR(150) NULL,
  delivery_company          VARCHAR(150) NULL,
  delivery_address          TEXT         NULL,
  delivery_city             VARCHAR(100) NULL,
  delivery_state            VARCHAR(100) NULL,
  delivery_postcode         VARCHAR(30)  NULL,
  delivery_country          VARCHAR(100) NULL,
  delivery_country_code     VARCHAR(10)  NULL,
  delivery_point_id         VARCHAR(100) NULL,
  delivery_point_name       VARCHAR(150) NULL,
  delivery_point_address    TEXT         NULL,
  delivery_point_postcode   VARCHAR(30)  NULL,
  delivery_point_city       VARCHAR(100) NULL,
  invoice_fullname            VARCHAR(150) NULL,
  invoice_company           VARCHAR(150) NULL,
  invoice_nip               VARCHAR(50)  NULL,
  invoice_address           TEXT         NULL,
  invoice_city              VARCHAR(100) NULL,
  invoice_state             VARCHAR(100) NULL,
  invoice_postcode          VARCHAR(30)  NULL,
  invoice_country           VARCHAR(100) NULL,
  invoice_country_code      VARCHAR(10)  NULL,
  extra_field_1             TEXT         NULL,
  extra_field_2             TEXT         NULL,
  pick_state                INT          NULL,
  pack_state                INT          NULL,
  products                  LONGTEXT     NULL,
  PRIMARY KEY (id),
  KEY idx_baseorders_order_id (order_id),
  KEY idx_baseorders_external (external_order_id),
  KEY idx_baseorders_shop (shop_order_id),
  KEY idx_baseorders_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================================
-- End of schema.sql
-- ============================================================================
