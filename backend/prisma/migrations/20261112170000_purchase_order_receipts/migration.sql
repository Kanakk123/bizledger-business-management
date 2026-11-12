ALTER TABLE `purchase_order_items`
  ADD COLUMN `product_description` TEXT NULL;

CREATE TABLE `goods_receipts` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `receipt_number` VARCHAR(50) NOT NULL,
  `idempotency_key` VARCHAR(100) NOT NULL,
  `purchase_order_id` INTEGER NOT NULL,
  `received_by_id` INTEGER NULL,
  `received_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `notes` TEXT NULL,
  UNIQUE INDEX `goods_receipts_receipt_number_key` (`receipt_number`),
  UNIQUE INDEX `goods_receipts_idempotency_key_key` (`idempotency_key`),
  INDEX `goods_receipts_purchase_order_id_received_at_idx` (`purchase_order_id`, `received_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `goods_receipts_purchase_order_id_fkey`
    FOREIGN KEY (`purchase_order_id`) REFERENCES `purchase_orders` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `goods_receipts_received_by_id_fkey`
    FOREIGN KEY (`received_by_id`) REFERENCES `users` (`id`)
    ON DELETE SET NULL ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `goods_receipt_items` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `goods_receipt_id` INTEGER NOT NULL,
  `purchase_order_item_id` INTEGER NOT NULL,
  `quantity` DECIMAL(12, 3) NOT NULL,
  UNIQUE INDEX `goods_receipt_items_goods_receipt_id_purchase_order_item_id_key` (`goods_receipt_id`, `purchase_order_item_id`),
  INDEX `goods_receipt_items_purchase_order_item_id_idx` (`purchase_order_item_id`),
  PRIMARY KEY (`id`),
  CONSTRAINT `goods_receipt_items_goods_receipt_id_fkey`
    FOREIGN KEY (`goods_receipt_id`) REFERENCES `goods_receipts` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `goods_receipt_items_purchase_order_item_id_fkey`
    FOREIGN KEY (`purchase_order_item_id`) REFERENCES `purchase_order_items` (`id`)
    ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
