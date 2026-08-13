/**
 * Brands and Categories Landing Pages
 * Loads and displays brands/categories with animations
 */

class BrandsCategoriesPage {
    constructor() {
        this.apiBaseUrl = this.getApiBaseUrl();
        this.isBrandsPage = window.location.pathname.includes('brands.html');
        this.isCategoriesPage = window.location.pathname.includes('categories.html');
        // Also check if we're on index page with brands section
        this.hasBrandsGrid = document.getElementById('brands-grid') !== null;
        this.init();
    }

    getApiBaseUrl() {
        if (window.location.protocol === 'file:') {
            return 'http://localhost:3001';
        }
        const h = window.location.hostname;
        const isLoopback = h === 'localhost' || h === '127.0.0.1';
        if (isLoopback && window.location.port !== '3001') {
            return 'http://localhost:3001';
        }
        return '';
    }

    async init() {
        if (this.isBrandsPage || this.hasBrandsGrid) {
            await this.loadBrands();
        }
        if (this.isCategoriesPage || document.getElementById('health-categories-grid')) {
            await this.loadCategories();
        }
    }

    async loadBrands() {
        const grid = document.getElementById('brands-grid');
        if (!grid) return;

        try {
            const fetchFn = window.fetch || globalThis.fetch;
            const base = this.apiBaseUrl || '';
            const response = await fetchFn(`${base}/api/brands`);

            if (!response.ok) throw new Error('Failed to load brands');

            const brands = await response.json();
            const sortedBrands = this.sortBrands(brands);
            const displayBrands = sortedBrands.filter((brand) => {
                if (this.isMiscBrand(brand)) return true;
                return !!this.getBrandImagePath(brand);
            });
            this.renderBrands(displayBrands, grid);
        } catch (error) {
            // Use fallback on any error
            const fallbackBrands = this.sortBrands(this.getFallbackBrands());
            this.renderBrands(fallbackBrands, grid);
        }
    }

    async loadCategories() {
        const grid = document.getElementById('categories-grid') ||
            document.getElementById('health-categories-grid');
        if (!grid) return;

        try {
            const fetchFn = window.fetch || globalThis.fetch;
            const base = this.apiBaseUrl || '';
            const response = await fetchFn(`${base}/api/health-categories`);

            if (!response.ok) throw new Error('Failed to load categories');

            const categories = await response.json();
            this.renderCategories(this.sortCategories(categories), grid);
        } catch (error) {
            // Use fallback on any error
            const fallbackCategories = this.getFallbackCategories();
            this.renderCategories(this.sortCategories(fallbackCategories), grid);
        }
    }

    sortBrands(brands = []) {
        return [...brands].sort((a, b) => {
            const nameA = (this.getDisplayBrandName(a) || a?.name || '').toLowerCase();
            const nameB = (this.getDisplayBrandName(b) || b?.name || '').toLowerCase();
            return nameA.localeCompare(nameB);
        });
    }

    sortCategories(categories = []) {
        return [...categories].sort((a, b) =>
            (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' })
        );
    }

    getBrandImagePath(brand) {
        const logo = String(brand.logo_url || brand.logoUrl || '').trim();
        if (logo) {
            if (logo.startsWith('http') || logo.startsWith('//') || logo.startsWith('data:')) return logo;
            return logo.startsWith('/') ? logo : `/${logo}`;
        }

        // Map brand names/slugs to image filenames
        const brandImageMap = {
            'standard-enzyme': 'standard-enzyme.jpg',
            'standard enzyme': 'standard-enzyme.jpg',
            'natures-plus': 'natures-plus.jpg',
            'natures plus': 'natures-plus.jpg',
            'global-healing': 'global-healing.jpg',
            'global healing': 'global-healing.jpg',
            'host-defence': 'host-defense.jpg',
            'host defence': 'host-defense.jpg',
            'host-defense': 'host-defense.jpg',
            'host defense': 'host-defense.jpg',
            'hm-enterprise': 'hm-herbs.png',
            'hm enterprise': 'hm-herbs.png',
            'hm-herbs': 'hm-herbs.png',
            'hm herbs': 'hm-herbs.png',
            'terry-naturally': 'terry-naturally.jpg',
            'terry naturally': 'terry-naturally.jpg',
            'unicity': 'unicity.jpg',
            'newton-labs': 'newton-homeopathics.png',
            'newton labs': 'newton-homeopathics.png',
            'newton-homeopathics': 'newton-homeopathics.png',
            'newton homeopathics': 'newton-homeopathics.png',
            'newton-labs-kids': 'newton-homeopathic-kids.png',
            'newton labs kids': 'newton-homeopathic-kids.png',
            'newton-homeopathics-kids': 'newton-homeopathic-kids.png',
            'newton homeopathics kids': 'newton-homeopathic-kids.png',
            'newton-homeopathic-kids': 'newton-homeopathic-kids.png',
            'newton homeopathic kids': 'newton-homeopathic-kids.png',
            'newton-labs-pets': 'newton-homeopathics-pets.png',
            'newton labs pets': 'newton-homeopathics-pets.png',
            'newton-homeopathics-pets': 'newton-homeopathics-pets.png',
            'newton homeopathics pets': 'newton-homeopathics-pets.png',
            'newton-homeopathic-pets': 'newton-homeopathics-pets.png',
            'newton homeopathic pets': 'newton-homeopathics-pets.png',
            'regal-labs': 'regal-labs.jpg',
            'regal labs': 'regal-labs.jpg',
            'doctors-blend': 'doctors-blend.jpg',
            'doctors blend': 'doctors-blend.jpg',
            'doctor\'s-blend': 'doctors-blend.jpg',
            'doctor\'s blend': 'doctors-blend.jpg',
            'ac-grace': 'ac-grace.png',
            'aps': 'APS.jpg',
            'aor': 'APS.jpg',
            'bio-neurix': 'BioNeurix.png',
            'bio neurix': 'BioNeurix.png',
            'bioneurix': 'BioNeurix.png',
            'buried-treasure': 'Buried Treasure.jpg',
            'buried treasure': 'Buried Treasure.jpg',
            'edom-labs': 'Edom Labs.jpg',
            'edom labs': 'Edom Labs.jpg',
            'flexcin': 'Flexcin.jpg',
            'formor': 'formor.jpg',
            'formor-international': 'formor.jpg',
            'formor international': 'formor.jpg',
            'go-out': 'go-out.jpg',
            'go out': 'go-out.jpg',
            'carlson': 'Carlson.jpg',
            'enzymedica': 'Enzymedica.jpg',
            'enzymedica corp': 'Enzymedica.jpg',
            'hi-tech-pharmaceuticals': 'HI Tech Pharmaceuticals.png',
            'hi tech pharmaceuticals': 'HI Tech Pharmaceuticals.png',
            'life\'s-fortune': 'life\'s-fortune.jpg',
            'life\'s fortune': 'life\'s-fortune.jpg',
            'lifes-fortune': 'life\'s-fortune.jpg',
            'lifes fortune': 'life\'s-fortune.jpg',
            'life-extension': 'Life Extension.jpg',
            'life extension': 'Life Extension.jpg',
            'life-flo': 'Life-Flo.png',
            'life flo': 'Life-Flo.png',
            'natures-balance': 'Nature\'s Balance.jpg',
            'natures balance': 'Nature\'s Balance.jpg',
            'nature-s-balance': 'Nature\'s Balance.jpg',
            'natural-balance': 'Natural Balance.png',
            'natural balance': 'Natural Balance.png',
            'natures-sunshine': 'Nature\'s Sunshine.jpg',
            'natures sunshine': 'Nature\'s Sunshine.jpg',
            'nature-s-sunshine': 'Nature\'s Sunshine.jpg',
            'natures-plus': 'Nature\'s Plus.jpg',
            'natures plus': 'Nature\'s Plus.jpg',
            'nature-s-plus': 'Nature\'s Plus.jpg',
            'hemp-bombs': 'Hemp Bombs.png',
            'hemp bombs': 'Hemp Bombs.png',
            'hempbombs': 'Hemp Bombs.png',
            'highland-labs': 'Highland Labs.jpg',
            'highland labs': 'Highland Labs.jpg',
            'hippie-jacks': 'Hippie Jacks.jpg',
            'hippie jacks': 'Hippie Jacks.jpg',
            'hm-enterprise': 'HM Enterprise.jpg',
            'hm enterprise': 'HM Enterprise.jpg',
            "dr-tonys": "Dr. Tony's.png",
            "dr tonys": "Dr. Tony's.png",
            'irwin-naturals': 'Irwin Naturals.jpg',
            'irwin naturals': 'Irwin Naturals.jpg',
            'now-foods': 'now-foods.jpg',
            'now foods': 'now-foods.jpg',
            'oxy-life': 'Oxy Life.png',
            'oxy life': 'Oxy Life.png',
            'oxylife': 'Oxy Life.png',
            'perrin\'s-naturals': 'perrin\'s-naturals.jpg',
            'perrin\'s naturals': 'perrin\'s-naturals.jpg',
            'perrins-naturals': 'perrin\'s-naturals.jpg',
            'perrins naturals': 'perrin\'s-naturals.jpg',
            'power-thin-phase-2': 'power-thin-phase-II.jpg',
            'power thin phase 2': 'power-thin-phase-II.jpg',
            'powerthin-phase-ii': 'power-thin-phase-II.jpg',
            'powerthin phase ii': 'power-thin-phase-II.jpg',
            'power-thin-phase-ii': 'power-thin-phase-II.jpg',
            'power thin phase ii': 'power-thin-phase-II.jpg',
            'miracle-ii': 'power-thin-phase-II.jpg',
            'miracle ii': 'power-thin-phase-II.jpg',
            'purple-tiger': 'purple-tiger.jpg',
            'purple tiger': 'purple-tiger.jpg',
            'skinny-magic': 'skinny-magic.jpg',
            'skinny magic': 'skinny-magic.jpg',
            'vista-life': 'vista-life.jpg',
            'vista life': 'vista-life.jpg',
            'herbs-for-life': 'Herbs For Life.png',
            'herbs for life': 'Herbs For Life.png',
            'md-science': 'MD Science.jpg',
            'md science': 'MD Science.jpg',
            'michael-s-health': "Michael's Health.png",
            'michaels-health': "Michael's Health.png",
            "michael's health": "Michael's Health.png",
            'michaels health': "Michael's Health.png",
            'north-american-herb-spice': 'North American Herb & Spice.jpg',
            'north american herb & spice': 'North American Herb & Spice.jpg',
            'north american herb and spice': 'North American Herb & Spice.jpg',
            'our-father-s-healing-herbs': "Our Father's Healing.png",
            "our father's healing herbs": "Our Father's Healing.png",
            'our-father-s-healing': "Our Father's Healing.png",
            "our father's healing": "Our Father's Healing.png",
            'cardio-amaze': 'cardio-amaze.jpg',
            'cardio amaze': 'cardio-amaze.jpg',
            'd-b-p-team': 'd-b-p-team.jpg',
            'd.b.p team': 'd-b-p-team.jpg',
            'dbp-team': 'd-b-p-team.jpg',
            'drt-male-supplements': 'drt-male-supplements.jpg',
            'drt male supplements': 'drt-male-supplements.jpg',
            'bio-tech': 'BioNeurix.png',
            'bio tech': 'BioNeurix.png',
            'bioneurix-coporation': 'BioNeurix.png',
            'carlson-labs': 'Carlson.jpg',
            'carlson labs': 'Carlson.jpg',
            'd-b-p-dist': 'd-b-p-team.jpg',
            'd.b.p. dist.': 'd-b-p-team.jpg',
            'edom-lab': 'Edom Labs.jpg',
            'hippie-jack-s': 'Hippie Jacks.jpg',
            "hippie jack's": 'Hippie Jacks.jpg',
            'life-extenstion': 'Life Extension.jpg',
            'm-d-science-labs': 'MD Science.jpg',
            'm.d.science labs': 'MD Science.jpg',
            'oxylife-inc': 'Oxy Life.png',
            'oxylife, inc.': 'Oxy Life.png',
            'unicity-enrich': 'unicity.jpg',
            'highland-labor': 'Highland Labs.jpg',
            'threshold': 'terry-naturally.jpg',
            'thres': 'terry-naturally.jpg',
            'nut-solaray': "Nature's Sunshine.jpg"
        };

        // Try to match by slug first, then by name
        const slug = (brand.slug || brand.name.toLowerCase().replace(/\s+/g, '-')).toLowerCase();
        const name = brand.name.toLowerCase();

        let imageFile = brandImageMap[slug] || brandImageMap[name];
        if (!imageFile) return null;

        return `images/brand-images/${imageFile}`;
    }

    isMiscBrand(brand) {
        const rawSlug = (brand.slug || brand.name || '').toLowerCase();
        const cleanSlug = rawSlug.replace(/[^a-z0-9]/g, '');
        const name = (brand.name || '').toLowerCase();
        return (
            cleanSlug === 'unknown' ||
            rawSlug === 'unknown' ||
            name === 'miscellaneous' ||
            name === 'unknown'
        );
    }

    isOurFathersHealingBrand(brand) {
        const name = (brand.name || '').toLowerCase();
        const slug = (brand.slug || '').toLowerCase();
        const cleanSlug = slug.replace(/[^a-z0-9]/g, '');
        return (
            (name.includes('our father') && name.includes('healing')) ||
            (slug.includes('our-father') && slug.includes('healing')) ||
            cleanSlug.includes('ourfathershealing')
        );
    }

    getDisplayBrandName(brand) {
        const name = brand.name || '';
        if (this.isOurFathersHealingBrand(brand)) {
            return "Our Father's Healing";
        }
        const lower = name.toLowerCase();
        // Normalize ForMor naming
        if (lower.includes('formor')) {
            return 'ForMor';
        }
        // Show a friendlier label for unknown brand bucket
        if (name.toLowerCase() === 'unknown') {
            return 'Miscellaneous';
        }
        return name;
    }

    renderBrands(brands, container) {
        container.innerHTML = '';

        if (brands.length === 0) {
            container.innerHTML = '<div class="loading-state"><p>No brands available</p></div>';
            return;
        }

        // Brand-specific background colors (helps logos with transparent backgrounds)
        const brandBackgroundMap = {
            'our-father-s-healing-herbs': '#cbd8e8',
            "our father's healing herbs": '#cbd8e8',
            'our-father-s-healing': '#cbd8e8',
            "our father's healing": '#cbd8e8'
        };

        // Use DocumentFragment for better performance
        const fragment = document.createDocumentFragment();

        brands.forEach((brand, index) => {
            // Normalize slug defensively (remove spaces/hyphens/odd chars)
            const rawSlug = (brand.slug || brand.name || '').toLowerCase();
            const cleanSlug = rawSlug.replace(/[^a-z0-9]/g, '');
            const isMisc = this.isMiscBrand(brand);
            const hrefSlug = encodeURIComponent(cleanSlug || rawSlug);

            // Create wrapper to hold card and name
            const wrapper = document.createElement('div');
            wrapper.className = 'brand-item-wrapper';
            wrapper.style.animationDelay = `${index * 0.02}s`;

            const card = document.createElement('a');
            card.href = `products.html?brand=${hrefSlug}`;
            card.className = 'brand-card';
            // Apply brand-specific background if configured
            const brandBg =
                brandBackgroundMap[rawSlug] ||
                brandBackgroundMap[cleanSlug] ||
                brandBackgroundMap[brand.slug] ||
                brandBackgroundMap[brand.name?.toLowerCase()];
            if (brandBg) {
                card.style.backgroundColor = brandBg;
            } else if (isMisc) {
                // Sleeker dedicated look for the miscellaneous bucket
                card.style.background = 'linear-gradient(145deg, #0fbf9f 0%, #00b3c6 45%, #5ed196 100%)';
                card.style.boxShadow = '0 16px 34px rgba(0, 128, 117, 0.28)';
                card.style.border = '1px solid rgba(255, 255, 255, 0.16)';
                card.style.display = 'flex';
                card.style.alignItems = 'center';
                card.style.justifyContent = 'center';
                card.style.flexDirection = 'column';
            }
            // Add special class for Powerthin Phase II to have black background
            if (brand.slug === 'power-thin-phase-2' || brand.name.toLowerCase().includes('powerthin')) {
                card.className += ' powerthin-card';
            }
            if (this.isOurFathersHealingBrand(brand)) {
                card.className += ' our-fathers-healing-card';
            }

            // Try to get brand image, fallback to icon if not found
            const imagePath = isMisc ? null : this.getBrandImagePath(brand);
            if (imagePath) {
                const img = document.createElement('img');
                const cacheBust = this.isOurFathersHealingBrand(brand) ? '?v=2026-06-04' : '';
                img.src = `${imagePath}${cacheBust}`;
                img.alt = `${this.getDisplayBrandName(brand)} logo`;
                img.className = 'brand-card-image';
                img.onerror = function () {
                    // If image fails to load, replace with fallback icon
                    const icon = document.createElement('div');
                    icon.className = 'brand-card-icon';
                    icon.innerHTML = '<i class="fas fa-tag" aria-hidden="true"></i>';
                    card.innerHTML = '';
                    card.appendChild(icon);
                };
                card.appendChild(img);
            } else {
                // Fallback to icon if no image found
                const icon = document.createElement('div');
                icon.className = 'brand-card-icon';
                if (isMisc) {
                    icon.style.width = '104px';
                    icon.style.height = '104px';
                    icon.style.display = 'flex';
                    icon.style.alignItems = 'center';
                    icon.style.justifyContent = 'center';
                    icon.style.background = 'linear-gradient(140deg, rgba(255,255,255,0.26), rgba(255,255,255,0.10))';
                    icon.style.borderRadius = '30px';
                    icon.style.boxShadow = '0 12px 26px rgba(0,0,0,0.18)';
                    icon.style.border = '1px solid rgba(255,255,255,0.22)';
                    icon.style.fontFamily = '"Poppins", "Segoe UI", sans-serif';
                    icon.style.fontWeight = '800';
                    icon.style.letterSpacing = '0.10em';
                    icon.style.fontSize = '36px';
                    icon.style.color = '#f5fff9';
                    icon.style.textTransform = 'uppercase';
                    icon.textContent = 'Misc.';
                } else {
                    icon.innerHTML = '<i class="fas fa-tag" aria-hidden="true"></i>';
                }
                card.appendChild(icon);
            }

            // Add description overlay that appears on hover
            const descriptionOverlay = document.createElement('div');
            descriptionOverlay.className = 'brand-description-overlay';
            descriptionOverlay.textContent = brand.description || 'Explore products from this trusted brand';
            card.appendChild(descriptionOverlay);

            // Add brand name below the card container
            const brandName = document.createElement('div');
            brandName.className = 'brand-card-name';
            brandName.textContent = this.getDisplayBrandName(brand);

            wrapper.appendChild(card);
            wrapper.appendChild(brandName);
            fragment.appendChild(wrapper);
        });

        // Append all at once for better performance
        container.appendChild(fragment);
    }

    renderCategories(categories, container) {
        container.innerHTML = '';

        if (categories.length === 0) {
            container.innerHTML = '<div class="loading-state"><p>No categories available</p></div>';
            return;
        }

        // Icon mapping for categories
        const categoryIcons = {
            'blood-pressure': 'fa-heartbeat',
            'heart-health': 'fa-heart',
            'allergies': 'fa-allergies',
            'digestive-health': 'fa-pills',
            'joint-arthritis': 'fa-bone',
            'immune-support': 'fa-shield-alt',
            'stress-anxiety': 'fa-spa',
            'sleep-support': 'fa-bed',
            'energy-vitality': 'fa-bolt',
            'brain-health': 'fa-brain',
            'womens-health': 'fa-venus',
            'female': 'fa-venus',
            'mens-health': 'fa-mars',
            'male': 'fa-mars',
            'men-products': 'fa-mars',
            'women-products': 'fa-venus',
            'pet-health': 'fa-paw',
            'weight-management': 'fa-weight',
            'skin-health': 'fa-hand-sparkles',
            'eye-health': 'fa-eye',
            'liver-support': 'fa-leaf',
            'respiratory-health': 'fa-lungs',
            'bone-health': 'fa-bone',
            'anti-aging': 'fa-star',
            'cbd': 'fa-cannabis'
        };

        categories.forEach((category, index) => {
            const card = document.createElement('a');
            let slug = category.slug || category.name.toLowerCase().replace(/\s+/g, '-');
            // Normalize slug - remove special characters and ensure consistent format
            slug = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
            // Use healthCategory param to match backend health category filtering
            card.href = `products.html?healthCategory=${encodeURIComponent(slug)}`;
            card.className = 'category-card';
            card.style.animationDelay = `${index * 0.05}s`;

            const icon = document.createElement('div');
            icon.className = 'category-card-icon';
            // Try to find icon - check exact match first, then try variations
            let iconClass = categoryIcons[slug];
            if (!iconClass) {
                // Try matching by name if slug doesn't match
                const nameKey = category.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '-');
                iconClass = categoryIcons[nameKey];
            }
            // Fallback to default icon
            iconClass = iconClass || 'fa-layer-group';
            icon.innerHTML = `<i class="fas ${iconClass}" aria-hidden="true"></i>`;

            const title = document.createElement('h3');
            title.className = 'category-card-title';
            title.textContent = category.name;

            const description = document.createElement('p');
            description.className = 'category-card-description';
            description.textContent = category.description || 'Find products for this health condition';

            const arrow = document.createElement('div');
            arrow.className = 'category-card-arrow';
            arrow.innerHTML = '<i class="fas fa-arrow-right" aria-hidden="true"></i>';

            card.appendChild(icon);
            card.appendChild(title);
            card.appendChild(description);
            card.appendChild(arrow);

            container.appendChild(card);
        });
    }

    getFallbackBrands() {
        return [
            { name: 'AC Grace', slug: 'ac-grace', description: 'Premium natural health and wellness products designed to support your overall well-being and vitality.' },
            { name: 'APS', slug: 'aps', description: 'Advanced research-based nutritional supplements formulated with cutting-edge science for optimal health outcomes.' },
            // Use the correct live slug to avoid mismatches if fallback is used
            { name: 'BioNeurix', slug: 'bioneurix', description: 'Specialized brain health and cognitive support supplements to enhance mental clarity, focus, and memory.' },
            { name: 'Cardio Amaze', slug: 'cardio-amaze', description: 'Comprehensive cardiovascular health supplements designed to support heart function and circulation.' },
            { name: 'Doctors Blend', slug: 'doctors-blend', description: 'Physician-formulated nutritional supplements created by medical professionals for evidence-based health support.' },
            { name: 'Edom Labs', slug: 'edom-labs', description: 'Premium quality nutritional supplements manufactured with the highest standards for purity and potency.' },
            { name: 'Flexcin', slug: 'flexcin', description: 'Advanced joint health and mobility support supplements to help maintain flexibility and reduce joint discomfort.' },
            { name: 'Formor', slug: 'formor', description: 'Natural health and wellness products crafted with traditional ingredients and modern formulations.' },
            { name: 'Global Healing', slug: 'global-healing', description: 'Organic and natural health products sourced from around the world to support holistic wellness.' },
            { name: 'Go Out', slug: 'go-out', description: 'Natural supplements designed to support an active lifestyle and outdoor wellness activities.' },
            { name: 'Herbs for Life', slug: 'herbs-for-life', description: 'Traditional herbal remedies and supplements based on centuries of natural healing wisdom.' },
            { name: 'High Tech Pharmaceuticals', slug: 'high-tech-pharmaceuticals', description: 'Advanced nutritional supplements utilizing pharmaceutical-grade ingredients and cutting-edge formulations.' },
            { name: 'HM Enterprise', slug: 'hm-enterprise', description: 'H&M Herbs proprietary formulations and exclusive products developed for optimal health and wellness.' },
            { name: 'Host Defence', slug: 'host-defence', description: 'Mushroom-based immune support supplements featuring organic, sustainably grown medicinal mushrooms.' },
            { name: 'Life\'s Fortune', slug: 'lifes-fortune', description: 'Anti-aging and longevity supplements designed to support healthy aging and vitality throughout life.' },
            { name: 'Natures Balance', slug: 'natures-balance', description: 'Natural vitamins and supplements formulated to help restore and maintain your body\'s natural balance.' },
            { name: 'Natures Plus', slug: 'natures-plus', description: 'Premium natural vitamins and supplements made with whole food ingredients and advanced nutritional science.' },
            { name: 'Natures Sunshine', slug: 'natures-sunshine', description: 'Premium natural health products backed by over 50 years of research and quality manufacturing standards.' },
            { name: 'Newton Homeopathics', slug: 'newton-labs', description: 'Homeopathic remedies and natural medicines following traditional homeopathic principles for gentle, effective healing.' },
            { name: 'Now Foods', slug: 'now-foods', description: 'Quality natural supplements and foods manufactured with rigorous testing and quality control standards since 1968.' },
            { name: 'Oxy Life', slug: 'oxy-life', description: 'Oxygen-based health and wellness products designed to support cellular health and energy production.' },
            { name: 'Perrin\'s Naturals', slug: 'perrins-naturals', description: 'Natural health and wellness products crafted with care using traditional and modern natural healing methods.' },
            { name: 'Powerthin Phase II', slug: 'power-thin-phase-2', description: 'Advanced weight management and wellness products designed to support healthy metabolism and energy levels.' },
            { name: 'Purple Tiger', slug: 'purple-tiger', description: 'Natural health and wellness products featuring unique formulations for comprehensive wellness support.' },
            { name: 'Regal Labs', slug: 'regal-labs', description: 'Cannabis-based health and wellness products formulated with premium hemp and CBD extracts for natural relief.' },
            { name: 'Skinny Magic', slug: 'skinny-magic', description: 'Weight management and wellness products designed to support healthy weight goals and metabolic function.' },
            { name: 'Standard Enzyme', slug: 'standard-enzyme', description: 'Professional-grade enzyme and nutritional supplements formulated for optimal digestive and systemic health.' },
            { name: 'Terry Naturally', slug: 'terry-naturally', description: 'Clinically studied natural health products backed by scientific research and proven effectiveness.' },
            { name: 'Unicity', slug: 'unicity', description: 'Science-based nutritional supplements developed through extensive research to support optimal health and wellness.' },
            { name: 'Vista Life', slug: 'vista-life', description: 'Natural health and wellness products designed to enhance your quality of life through comprehensive nutritional support.' }
        ];
    }

    getFallbackCategories() {
        return [
            { name: 'Allergies', slug: 'allergies', description: 'Natural allergy relief and immune system support' },
            { name: 'Anti-Aging', slug: 'anti-aging', description: 'Antioxidants and anti-aging supplements' },
            { name: 'Blood Pressure', slug: 'blood-pressure', description: 'Natural supplements to support healthy blood pressure levels' },
            { name: 'Bone Health', slug: 'bone-health', description: 'Calcium, vitamin D, and bone strength supplements' },
            { name: 'CBD', slug: 'cbd', description: 'Premium hemp and CBD oils, gummies, topicals, and wellness products' },
            { name: 'Digestive Health', slug: 'digestive-health', description: 'Digestive enzymes, probiotics, and gut health support' },
            { name: 'Energy & Vitality', slug: 'energy-vitality', description: 'Energy boosters and vitality supplements' },
            { name: 'Eye Health', slug: 'eye-health', description: 'Vision support and eye health supplements' },
            { name: 'Heart Health', slug: 'heart-health', description: 'Cardiovascular support and heart health supplements' },
            { name: 'Immune Support', slug: 'immune-support', description: 'Immune system boosters and wellness supplements' },
            { name: 'Joint & Arthritis', slug: 'joint-arthritis', description: 'Joint support, arthritis relief, and mobility supplements' },
            { name: 'Liver Support', slug: 'liver-support', description: 'Liver detox and hepatic support supplements' },
            { name: 'Mens Health', slug: 'mens-health', description: 'Specialized supplements for mens health needs' },
            { name: 'Pet Health', slug: 'pet-health', description: 'Natural health products for cats and dogs' },
            { name: 'Respiratory Health', slug: 'respiratory-health', description: 'Lung and respiratory system support' },
            { name: 'Skin Health', slug: 'skin-health', description: 'Supplements and topicals for healthy skin' },
            { name: 'Sleep Support', slug: 'sleep-support', description: 'Natural sleep aids and relaxation supplements' },
            { name: 'Stress & Anxiety', slug: 'stress-anxiety', description: 'Natural stress relief and anxiety management' },
            { name: 'Weight Management', slug: 'weight-management', description: 'Natural weight loss and metabolism support' },
            { name: 'Womens Health', slug: 'womens-health', description: 'Specialized supplements for womens health needs' },
            { name: 'Brain Health', slug: 'brain-health', description: 'Cognitive support and brain health supplements' }
        ];
    }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new BrandsCategoriesPage();
    });
} else {
    new BrandsCategoriesPage();
}

