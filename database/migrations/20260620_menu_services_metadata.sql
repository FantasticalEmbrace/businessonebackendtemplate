-- Extended metadata for Business One public service menu
ALTER TABLE menu_items
    ADD COLUMN icon_class VARCHAR(100) NULL COMMENT 'Font Awesome icon class' AFTER category,
    ADD COLUMN overview TEXT NULL COMMENT 'Long-form service overview' AFTER description,
    ADD COLUMN features_json JSON NULL COMMENT 'Array of feature bullet strings' AFTER overview;

UPDATE menu_items SET
    icon_class = 'fas fa-cash-register',
    overview = 'Our Point of Sale systems are designed to help businesses of all sizes manage their sales operations efficiently. With real-time inventory tracking, comprehensive reporting, and seamless payment integration, you can focus on growing your business while we handle the technology.',
    features_json = JSON_ARRAY(
        'Real-time inventory tracking',
        'Sales reporting and analytics',
        'Multi-location support',
        'Customer management',
        'Integration with payment processors',
        'Mobile and tablet compatible'
    )
WHERE item_id = 'pos';

UPDATE menu_items SET
    icon_class = 'fas fa-credit-card',
    overview = 'Accept payments seamlessly with our secure payment processing solutions. We offer competitive rates, multiple payment methods including credit cards, debit cards, and digital wallets. Our 24/7 fraud monitoring ensures your transactions are always secure.',
    features_json = JSON_ARRAY(
        'Competitive processing rates',
        'Secure payment gateway',
        'Multiple payment methods',
        '24/7 fraud monitoring',
        'Quick settlement times',
        'Dedicated account manager'
    )
WHERE item_id = 'payment';

UPDATE menu_items SET
    icon_class = 'fas fa-phone-alt',
    overview = 'Stay connected with clients and team members using our advanced business phone systems. Our hold queue technology ensures customers never hear continuous ringing or busy signals, providing a professional experience. Features include voicemail to email, call forwarding, conference calling, and mobile app integration.',
    features_json = JSON_ARRAY(
        'Professional hold queues',
        'Voicemail to email',
        'Call forwarding and routing',
        'Conference calling',
        'Mobile app integration',
        'Unlimited calling plans'
    )
WHERE item_id = 'phone';

UPDATE menu_items SET
    icon_class = 'fas fa-globe',
    overview = 'Establish a strong online presence with our professional website development services. We create responsive, SEO-optimized websites that work seamlessly across all devices. Whether you need a simple business site or a full e-commerce platform, we have the expertise to bring your vision to life.',
    features_json = JSON_ARRAY(
        'Responsive design',
        'SEO optimization',
        'Content management system',
        'E-commerce integration',
        'Mobile-first approach',
        'Ongoing support and maintenance'
    )
WHERE item_id = 'website';
