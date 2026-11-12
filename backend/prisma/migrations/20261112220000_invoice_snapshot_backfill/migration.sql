UPDATE `invoices` AS i
JOIN `purchase_orders` AS po ON po.`id` = i.`purchase_order_id`
JOIN `suppliers` AS s ON s.`id` = po.`supplier_id`
SET i.`partner_name` = COALESCE(i.`partner_name`, s.`name`),
    i.`partner_company` = COALESCE(i.`partner_company`, s.`company_name`),
    i.`partner_email` = COALESCE(i.`partner_email`, s.`email`),
    i.`partner_phone` = COALESCE(i.`partner_phone`, s.`phone`),
    i.`partner_address` = COALESCE(i.`partner_address`, NULLIF(CONCAT_WS(', ', NULLIF(s.`address`, ''), NULLIF(s.`city`, ''), NULLIF(s.`state`, ''), NULLIF(s.`postal_code`, ''), NULLIF(s.`country`, '')), '')),
    i.`partner_tax_id` = COALESCE(i.`partner_tax_id`, s.`tax_registration`),
    i.`payment_terms` = COALESCE(i.`payment_terms`, s.`payment_terms`)
WHERE i.`type` = 'PURCHASE';

UPDATE `invoices` AS i
JOIN `sales_orders` AS so ON so.`id` = i.`sales_order_id`
JOIN `buyers` AS b ON b.`id` = so.`buyer_id`
SET i.`partner_name` = COALESCE(i.`partner_name`, b.`name`),
    i.`partner_company` = COALESCE(i.`partner_company`, b.`company_name`),
    i.`partner_email` = COALESCE(i.`partner_email`, b.`email`),
    i.`partner_phone` = COALESCE(i.`partner_phone`, b.`phone`),
    i.`partner_address` = COALESCE(i.`partner_address`, NULLIF(CONCAT_WS(', ', NULLIF(b.`billing_address`, ''), NULLIF(b.`city`, ''), NULLIF(b.`state`, ''), NULLIF(b.`postal_code`, ''), NULLIF(b.`country`, '')), '')),
    i.`partner_tax_id` = COALESCE(i.`partner_tax_id`, b.`tax_registration`)
WHERE i.`type` = 'SALES';

UPDATE `invoice_items` AS ii
JOIN `invoices` AS i ON i.`id` = ii.`invoice_id`
JOIN `purchase_order_items` AS poi ON poi.`purchase_order_id` = i.`purchase_order_id` AND poi.`product_name` = ii.`product_name` AND poi.`sku` = ii.`sku`
SET ii.`description` = COALESCE(ii.`description`, poi.`product_description`)
WHERE i.`type` = 'PURCHASE';

UPDATE `invoice_items` AS ii
JOIN `invoices` AS i ON i.`id` = ii.`invoice_id`
JOIN `sales_order_items` AS soi ON soi.`sales_order_id` = i.`sales_order_id` AND soi.`product_name` = ii.`product_name` AND soi.`sku` = ii.`sku`
SET ii.`description` = COALESCE(ii.`description`, soi.`product_description`)
WHERE i.`type` = 'SALES';
