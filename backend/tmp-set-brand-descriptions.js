const mysql = require('mysql2/promise');
require('dotenv').config();

// Map of brand slugs to real descriptions
const descriptions = {
    'ac-grace': 'AC Grace specializes in Unique E natural vitamin E tocopherol and tocotrienol supplements known for purity and potency.',
    'aps': 'APS Nutrition formulates sports nutrition and pre-workout supplements designed to support strength, energy, and performance.',
    'bioneurix': 'BioNeurix develops clinically researched mood, stress, and emotional wellness formulas such as Amoryn and Seredyn.',
    'buried-treasure': 'Buried Treasure crafts high-potency liquid vitamins, minerals, and herbal blends for fast absorption and family nutrition.',
    'carlson': 'Carlson provides premium vitamins, minerals, and award-winning omega-3 fish oils founded in 1965.',
    'dr-tonys': "Dr. Tony's delivers doctor-formulated liquid multivitamins and targeted wellness blends created by Dr. Tony O’Donnell.",
    'enzymedica': 'Enzymedica offers high-quality digestive enzymes and gut health solutions to support nutrient absorption and comfort.',
    'formor': 'ForMor International offers nutritional supplements and functional beverages focused on everyday wellness and energy support.',
    'hm-herbs': 'H&M Herbs house line featuring Cardio Amaze and related heart health and nitric oxide support formulas.',
    'hemp-bombs': 'Hemp Bombs produces hemp-derived CBD gummies, oils, capsules, and topicals for relaxation and recovery.',
    'herbs-for-life': 'Herbs For Life creates herbal tinctures and nutritional formulas rooted in traditional botanical wellness.',
    'hi-tech-pharmaceuticals': 'Hi-Tech Pharmaceuticals manufactures sports nutrition, thermogenic, and performance supplements using advanced delivery systems.',
    'highland-labs': 'Highland Labs produces vitamins, minerals, and specialty supplements with an emphasis on bioavailable forms.',
    'hippie-jacks': 'Hippie Jacks offers botanical wellness blends and herbal supplements inspired by natural living.',
    'hm-enterprise': 'HM Enterprise provides HM Herbs-branded vitamins, minerals, and wellness products curated for everyday health.',
    'host-defence': 'Host Defense, founded by mycologist Paul Stamets, delivers organic mushroom supplements for immune and overall wellness.',
    'irwin-naturals': 'Irwin Naturals creates softgel-based nutritional supplements targeting energy, weight management, and daily wellness.',
    'life-flo': 'Life-Flo offers natural body care, magnesium, progesterone creams, and skin-support formulas made with clean ingredients.',
    'life-s-fortune': "Life's Fortune provides comprehensive multivitamins and minerals aimed at daily energy and immune support.",
    'md-science': 'MD Science Lab (Swiss Navy) formulates sexual wellness lubricants and nutritional supplements for intimate health.',
    'michael-s-health': "Michael's Health (Michael's Naturopathic Programs) develops condition-specific vitamins and supplements formulated by Dr. Michael Schwartz.",
    'natural-balance': 'Natural Balance blends science-backed herbs, vitamins, and specialty nutrients for energy, mood, and weight support.',
    'nature-s-balance': "Nature's Balance offers herbal extracts and nutritional supplements designed to balance stress and support vitality.",
    'nature-s-plus': "Nature's Plus delivers a wide range of vitamins, minerals, and whole-food supplements for family nutrition.",
    'nature-s-sunshine': "Nature's Sunshine manufactures herbal supplements, essential oils, and targeted formulas with quality testing from seed to shelf.",
    'newton-homeopathics': 'Newton Homeopathics provides professional-grade homeopathic remedies crafted in small batches for holistic wellness.',
    'newton-homeopathics-kids': "Newton Homeopathics Kids offers gentle, kid-friendly homeopathic remedies tailored for common children’s wellness needs.",
    'newton-homeopathics-pets': 'Newton Homeopathics Pets supplies homeopathic solutions formulated for dogs and cats to support natural health.',
    'north-american-herb-spice': 'North American Herb & Spice pioneers wild-sourced oregano oil and whole food supplements for immune and respiratory support.',
    'our-father-s-healing-herbs': 'Our Father’s Healing Herbs produces traditional herbal remedies and tinctures inspired by natural healing practices.',
    'oxy-life': 'Oxy Life provides oxygen-enhanced supplements, liquid vitamins, and specialty formulas to support energy and overall health.',
    "perrin-s-naturals": 'Perrin\'s Naturals creates skin care balms and creams using botanicals like red clover to support healthy-looking skin.',
    'powerthin-phase-ii': 'Powerthin Phase II is a thermogenic weight-management formula designed to promote energy, metabolism, and focus.',
    'unknown': 'Miscellaneous items and unbranded products curated by HM Herbs.'
};

async function run() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'hmherbs',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    });

    try {
        for (const [slug, description] of Object.entries(descriptions)) {
            const [result] = await pool.execute(
                'UPDATE brands SET description = ? WHERE slug = ?',
                [description, slug]
            );
            console.log(`Updated ${slug}: affectedRows=${result.affectedRows}`);
        }
    } catch (err) {
        console.error('Error updating brand descriptions:', err.message);
    } finally {
        await pool.end();
    }
}

run();

