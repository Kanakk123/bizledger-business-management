ALTER TABLE `sales_order_items`
  ADD COLUMN `fulfilled_quantity` DECIMAL(12, 3) NOT NULL DEFAULT 0,
  ADD COLUMN `returned_quantity` DECIMAL(12, 3) NOT NULL DEFAULT 0,
  ADD COLUMN `product_description` TEXT NULL;

CREATE TABLE `sales_fulfillments` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `fulfillment_number` VARCHAR(50) NOT NULL,
  `idempotency_key` VARCHAR(100) NOT NULL,
  `sales_order_id` INTEGER NOT NULL,
  `fulfilled_by_id` INTEGER NULL,
  `fulfilled_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `notes` TEXT NULL,
  UNIQUE INDEX `sales_fulfillments_fulfillment_number_key` (`fulfillment_number`),
  UNIQUE INDEX `sales_fulfillments_idempotency_key_key` (`idempotency_key`),
  INDEX `sales_fulfillments_sales_order_id_fulfilled_at_idx` (`sales_order_id`, `fulfilled_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `sales_fulfillments_sales_order_id_fkey`
    FOREIGN KEY (`sales_order_id`) REFERENCES `sales_orders` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `sales_fulfillments_fulfilled_by_id_fkey`
    FOREIGN KEY (`fulfilled_by_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sales_fulfillment_items` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `fulfillment_id` INTEGER NOT NULL,
  `sales_order_item_id` INTEGER NOT NULL,
  `quantity` DECIMAL(12, 3) NOT NULL,
  UNIQUE INDEX `sales_fulfillment_items_fulfillment_id_sales_order_item_id_key` (`fulfillment_id`, `sales_order_item_id`),
  INDEX `sales_fulfillment_items_sales_order_item_id_idx` (`sales_order_item_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `sales_fulfillment_items_fulfillment_id_fkey`
    FOREIGN KEY (`fulfillment_id`) REFERENCES `sales_fulfillments` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `sales_fulfillment_items_sales_order_item_id_fkey`
    FOREIGN KEY (`sales_order_item_id`) REFERENCES `sales_order_items` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sales_returns` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `return_number` VARCHAR(50) NOT NULL,
  `idempotency_key` VARCHAR(100) NOT NULL,
  `sales_order_id` INTEGER NOT NULL,
  `processed_by_id` INTEGER NULL,
  `returned_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `reason` TEXT NULL,
  UNIQUE INDEX `sales_returns_return_number_key` (`return_number`),
  UNIQUE INDEX `sales_returns_idempotency_key_key` (`idempotency_key`),
  INDEX `sales_returns_sales_order_id_returned_at_idx` (`sales_order_id`, `returned_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `sales_returns_sales_order_id_fkey`
    FOREIGN KEY (`sales_order_id`) REFERENCES `sales_orders` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `sales_returns_processed_by_id_fkey`
    FOREIGN KEY (`processed_by_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `sales_return_items` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `sales_return_id` INTEGER NOT NULL,
  `sales_order_item_id` INTEGER NOT NULL,
  `quantity` DECIMAL(12, 3) NOT NULL,
  UNIQUE INDEX `sales_return_items_sales_return_id_sales_order_item_id_key` (`sales_return_id`, `sales_order_item_id`),
  INDEX `sales_return_items_sales_order_item_id_idx` (`sales_order_item_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `sales_return_items_sales_return_id_fkey`
    FOREIGN KEY (`sales_return_id`) REFERENCES `sales_returns` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `sales_return_items_sales_order_item_id_fkey`
    FOREIGN KEY (`sales_order_item_id`) REFERENCES `sales_order_items` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
