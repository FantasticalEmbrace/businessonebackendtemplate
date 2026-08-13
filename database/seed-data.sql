-- H&M Herbs & Vitamins - Seed Data
-- Initial data for health categories, brands, and sample products

-- Insert health condition categories
INSERT INTO health_categories (name, slug, description, sort_order) VALUES
('Blood Pressure', 'blood-pressure', 'Natural supplements to support healthy blood pressure levels', 1),
('Heart Health', 'heart-health', 'Cardiovascular support and heart health supplements', 2),
('Allergies', 'allergies', 'Natural allergy relief and immune system support', 3),
('Digestive Health', 'digestive-health', 'Digestive enzymes, probiotics, and gut health support', 4),
('Joint & Arthritis', 'joint-arthritis', 'Joint support, arthritis relief, and mobility supplements', 5),
('Immune Support', 'immune-support', 'Immune system boosters and wellness supplements', 6),
('Stress & Anxiety', 'stress-anxiety', 'Natural stress relief and anxiety management', 7),
('Sleep Support', 'sleep-support', 'Natural sleep aids and relaxation supplements', 8),
('Energy & Vitality', 'energy-vitality', 'Energy boosters and vitality supplements', 9),
('Brain Health', 'brain-health', 'Cognitive support and brain health supplements', 10),
('Womens Health', 'womens-health', 'Specialized supplements for womens health needs', 11),
('Mens Health', 'mens-health', 'Specialized supplements for mens health needs', 12),
('Pet Health', 'pet-health', 'Natural health products for cats and dogs', 13),
('Weight Management', 'weight-management', 'Natural weight loss and metabolism support', 14),
('Skin Health', 'skin-health', 'Supplements and topicals for healthy skin', 15),
('Eye Health', 'eye-health', 'Vision support and eye health supplements', 16),
('Liver Support', 'liver-support', 'Liver detox and hepatic support supplements', 17),
('Respiratory Health', 'respiratory-health', 'Lung and respiratory system support', 18),
('Bone Health', 'bone-health', 'Calcium, vitamin D, and bone strength supplements', 19),
('Anti-Aging', 'anti-aging', 'Antioxidants and anti-aging supplements', 20),
('CBD', 'cbd', 'Premium hemp and CBD products for natural wellness support', 0);

-- Insert major brands
INSERT INTO brands (name, slug, description) VALUES
('Standard Enzyme', 'standard-enzyme', 'Professional-grade enzyme and nutritional supplements'),
('Natures Plus', 'natures-plus', 'Premium natural vitamins and supplements'),
('Global Healing', 'global-healing', 'Organic and natural health products'),
('Host Defence', 'host-defence', 'Mushroom-based immune support supplements'),
('HM Enterprise', 'hm-enterprise', 'H&M Herbs proprietary formulations and products'),
('Terry Naturally', 'terry-naturally', 'Clinically studied natural health products'),
('Unicity', 'unicity', 'Science-based nutritional supplements'),
('Newton Labs', 'newton-labs', 'Homeopathic remedies and natural medicines'),
('Regal Labs', 'regal-labs', 'Cannabis-based health and wellness products'),
('Doctors Blend', 'doctors-blend', 'Physician-formulated nutritional supplements'),
('Miracle II', 'miracle-ii', 'Natural personal care and wellness products'),
('Herbs for Life', 'herbs-for-life', 'Traditional herbal remedies and supplements'),
('Advanced Orthomolecular Research', 'aor', 'Research-based nutritional supplements'),
('Cardio Amaze', 'cardio-amaze', 'Cardiovascular health supplements'),
('Life Extension', 'life-extension', 'Anti-aging and longevity supplements');

-- Insert product categories
INSERT INTO product_categories (name, slug, description, sort_order) VALUES
('Vitamins', 'vitamins', 'Essential vitamins and vitamin complexes', 1),
('Minerals', 'minerals', 'Essential minerals and trace elements', 2),
('Herbs & Botanicals', 'herbs-botanicals', 'Traditional herbs and botanical extracts', 3),
('Enzymes', 'enzymes', 'Digestive and systemic enzymes', 4),
('Probiotics', 'probiotics', 'Beneficial bacteria for digestive health', 5),
('Amino Acids', 'amino-acids', 'Essential and non-essential amino acids', 6),
('Antioxidants', 'antioxidants', 'Free radical fighting compounds', 7),
('Essential Fatty Acids', 'essential-fatty-acids', 'Omega-3, omega-6, and other healthy fats', 8),
('Homeopathic', 'homeopathic', 'Homeopathic remedies and preparations', 9),
('Topical Products', 'topical-products', 'Creams, lotions, and topical applications', 10),
('Liquid Supplements', 'liquid-supplements', 'Liquid vitamins and supplements', 11),
('Capsules & Tablets', 'capsules-tablets', 'Traditional capsule and tablet supplements', 12),
('Powders', 'powders', 'Powder supplements and drink mixes', 13),
('Pet Supplements', 'pet-supplements', 'Health products for pets', 14),
('Specialty Formulas', 'specialty-formulas', 'Unique and specialized formulations', 15),
('CBD', 'cbd', 'Hemp-derived CBD oils, gummies, topicals, and wellness products', 16);

-- Sample products removed - products will be populated via scraping tool
-- Use the admin console "Scrape HM Herbs" button to populate products from the original website

-- Insert system settings
INSERT INTO settings (key_name, value, description, type) VALUES
('site_name', 'H&M Herbs & Vitamins', 'Website name', 'string'),
('site_description', 'Your trusted source for premium natural health products, herbs, vitamins, and wellness supplements.', 'Website description', 'string'),
('free_shipping_threshold', '25.00', 'Minimum order amount for free shipping', 'number'),
('tax_rate', '0.08', 'Default tax rate', 'number'),
('currency', 'USD', 'Default currency', 'string'),
('edsa_service_enabled', 'true', 'Enable EDSA service bookings', 'boolean'),
('edsa_service_price', '75.00', 'Price for EDSA service', 'number'),
('edsa_service_description', 'Electro Dermal Stress Analysis - A non-invasive health assessment technique', 'EDSA service description', 'string');

-- Insert default admin user (password should be changed immediately)
INSERT INTO admin_users (email, password_hash, first_name, last_name, role) VALUES
('hmherbs1@gmail.com', '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMQJqhN8/LewdBPj6hsxq5S/kS', 'Admin', 'User', 'admin');

-- Insert email templates
INSERT INTO email_templates (name, subject, html_content, text_content, variables) VALUES
('order_confirmation', 'Order Confirmation - {{order_number}}', 
'<h1>Thank you for your order!</h1><p>Your order {{order_number}} has been received and is being processed.</p>', 
'Thank you for your order! Your order {{order_number}} has been received and is being processed.', 
'["order_number", "customer_name", "order_total"]'),

('edsa_booking_confirmation', 'EDSA Appointment Confirmation', 
'<h1>Your EDSA appointment has been confirmed</h1><p>Date: {{appointment_date}}<br>Time: {{appointment_time}}</p>', 
'Your EDSA appointment has been confirmed. Date: {{appointment_date}} Time: {{appointment_time}}', 
'["customer_name", "appointment_date", "appointment_time"]'),

('welcome_email', 'Welcome to H&M Herbs & Vitamins!', 
'<h1>Welcome {{customer_name}}!</h1><p>Thank you for creating an account with us.</p>', 
'Welcome {{customer_name}}! Thank you for creating an account with us.', 
'["customer_name"]');
