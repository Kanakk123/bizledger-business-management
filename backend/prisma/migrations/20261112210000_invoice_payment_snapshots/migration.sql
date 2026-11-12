ALTER TABLE `invoices`
  ADD COLUMN `payment_terms` VARCHAR(100) NULL,
  ADD COLUMN `partner_name` VARCHAR(150) NULL,
  ADD COLUMN `partner_company` VARCHAR(150) NULL,
  ADD COLUMN `partner_email` VARCHAR(150) NULL,
  ADD COLUMN `partner_phone` VARCHAR(30) NULL,
  ADD COLUMN `partner_address` TEXT NULL,
  ADD COLUMN `partner_tax_id` VARCHAR(50) NULL;

ALTER TABLE `invoice_items` ADD COLUMN `description` TEXT NULL;

ALTER TABLE `payments`
  ADD COLUMN `idempotency_key` VARCHAR(100) NULL,
  ADD COLUMN `created_by_id` INTEGER NULL,
  ADD UNIQUE INDEX `payments_idempotency_key_key` (`idempotency_key`),
  ADD INDEX `payments_created_by_id_idx` (`created_by_id`),
  ADD CONSTRAINT `payments_created_by_id_fkey` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`) ON DELETE SET NULL ON UPDATE CASCADE;
