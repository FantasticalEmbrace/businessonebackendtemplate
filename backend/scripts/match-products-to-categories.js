/**
 * Script to match products to categories based on product name and description keywords
 * Uses keyword matching to intelligently assign products to the correct category
 */

const { loadBackendEnv, createPool } = require('../utils/dbConfig');
const logger = require('../utils/logger');

loadBackendEnv();

class ProductCategoryMatcher {
    constructor() {
        this.pool = createPool({ connectionLimit: 10, queueLimit: 0 });

        // Category keyword mappings - products matching these keywords will be assigned to the category
        this.categoryKeywords = {
            'Vitamins': ['vitamin', 'multivitamin', 'vit', 'b-complex', 'b12', 'b6', 'd3', 'c', 'e', 'k2', 'biotin', 'folate', 'niacin'],
            'Minerals': ['mineral', 'calcium', 'magnesium', 'zinc', 'iron', 'selenium', 'chromium', 'copper', 'manganese', 'potassium'],
            'Herbs & Botanicals': ['herb', 'botanical', 'ginkgo', 'ginseng', 'turmeric', 'echinacea', 'milk thistle', 'ashwagandha', 'rhodiola', 'astragalus', 'reishi', 'chaga'],
            'Amino Acids': ['amino acid', 'l-arginine', 'l-lysine', 'l-glutamine', 'taurine', 'carnitine', 'tyrosine', 'tryptophan', 'bcaa', 'branch chain'],
            'Enzymes': ['enzyme', 'digestive enzyme', 'protease', 'amylase', 'lipase', 'bromelain', 'papain', 'lactase'],
            'Probiotics': ['probiotic', 'lactobacillus', 'bifidobacterium', 'acidophilus', 'culture', 'flora'],
            'Omega & Fatty Acids': ['omega', 'fish oil', 'epa', 'dha', 'flax', 'evening primrose', 'borage', 'krill oil', 'cod liver'],
            'Antioxidants': ['antioxidant', 'coq10', 'coenzyme q10', 'alpha lipoic', 'resveratrol', 'quercetin', 'lycopene', 'lutein', 'zeaxanthin'],
            'Protein & Fitness': ['protein', 'whey', 'casein', 'pea protein', 'soy protein', 'creatine', 'pre-workout', 'post-workout', 'bcaa'],
            'Weight Management': ['weight', 'diet', 'metabolism', 'fat burner', 'carb blocker', 'appetite', 'slim', 'lean'],
            'Sleep Support': ['sleep', 'melatonin', 'valerian', 'chamomile', 'passionflower', 'insomnia', 'rest'],
            'Energy & Vitality': ['energy', 'b12', 'b-complex', 'caffeine', 'guarana', 'yerba mate', 'rhodiola', 'adaptogen'],
            'Digestive Health': ['digestive', 'digestion', 'stomach', 'gut', 'probiotic', 'enzyme', 'fiber', 'psyllium', 'prebiotic'],
            'Immune Support': ['immune', 'immunity', 'elderberry', 'echinacea', 'vitamin c', 'zinc', 'astragalus', 'reishi'],
            'Joint & Bone Health': ['joint', 'bone', 'glucosamine', 'chondroitin', 'msm', 'calcium', 'vitamin d', 'osteoporosis', 'arthritis'],
            'Heart Health': ['heart', 'cardiac', 'cardiovascular', 'coq10', 'omega', 'fish oil', 'hawthorn', 'garlic'],
            'Brain & Cognitive': ['brain', 'cognitive', 'memory', 'focus', 'ginkgo', 'phosphatidylserine', 'dha', 'omega'],
            'Skin Health': ['skin', 'collagen', 'biotin', 'vitamin e', 'hyaluronic', 'dermal', 'complexion'],
            'Eye Health': ['eye', 'vision', 'lutein', 'zeaxanthin', 'bilberry', 'astaxanthin', 'ocular'],
            'Hair & Nails': ['hair', 'nail', 'biotin', 'collagen', 'keratin', 'silica'],
            'Men\'s Health': ['men', 'male', 'prostate', 'testosterone', 'saw palmetto', 'tribulus'],
            'Women\'s Health': ['women', 'female', 'menstrual', 'menopause', 'pms', 'evening primrose', 'black cohosh'],
            'Pet Supplements': ['pet', 'dog', 'cat', 'animal', 'canine', 'feline'],
            'Homeopathic': ['homeopathic', 'homeopathy', 'arnica', 'belladonna', 'nux vomica'],
            'Topical Products': ['cream', 'ointment', 'gel', 'lotion', 'topical', 'apply', 'rub', 'massage'],
            'General': [] // Default category - no specific keywords
        };
    }

    async matchAndAssignCategories() {
        let connection;
        try {
            connection = await this.pool.getConnection();
            await connection.beginTransaction();

            const results = {
                matched: 0,
                updated: 0,
                notMatched: 0,
                notMatchedProducts: [],
                categoryAssignments: {}
            };

            // Get all active categories
            const [categories] = await connection.execute(
                'SELECT id, name FROM product_categories WHERE is_active = 1 ORDER BY name'
            );

            if (categories.length === 0) {
                logger.warn('No active categories found in database.');
                return { ...results, message: 'No active categories found.' };
            }

            // Build category map for quick lookup
            const categoryMap = {};
            categories.forEach(cat => {
                categoryMap[cat.name] = cat.id;
            });

            // Get all products
            const [products] = await connection.execute(
                'SELECT id, name, short_description, long_description, category_id FROM products ORDER BY name'
            );

            if (products.length === 0) {
                logger.warn('No products found in database.');
                return { ...results, message: 'No products found.' };
            }

            logger.info(`Starting category matching for ${products.length} products...`);

            for (const product of products) {
                const productName = (product.name || '').trim();
                const shortDesc = (product.short_description || '').trim();
                const longDesc = (product.long_description || '').trim();
                const searchText = `${productName} ${shortDesc} ${longDesc}`.toLowerCase();

                if (!productName) {
                    results.notMatched++;
                    results.notMatchedProducts.push({
                        id: product.id,
                        name: productName,
                        reason: 'Empty product name'
                    });
                    continue;
                }

                let matchedCategory = null;
                let bestMatchScore = 0;

                // Try to match against each category's keywords
                for (const [categoryName, keywords] of Object.entries(this.categoryKeywords)) {
                    if (!categoryMap[categoryName]) continue; // Category doesn't exist in DB
                    if (keywords.length === 0) continue; // Skip "General" category for now

                    let matchScore = 0;
                    for (const keyword of keywords) {
                        if (searchText.includes(keyword.toLowerCase())) {
                            matchScore += keyword.length; // Longer keywords = higher score
                        }
                    }

                    if (matchScore > bestMatchScore) {
                        matchedCategory = categoryMap[categoryName];
                        bestMatchScore = matchScore;
                    }
                }

                // If no match found, assign to "General" category (if it exists)
                if (!matchedCategory && categoryMap['General']) {
                    matchedCategory = categoryMap['General'];
                    bestMatchScore = 0;
                }

                if (matchedCategory) {
                    results.matched++;
                    if (product.category_id !== matchedCategory) {
                        await connection.execute(
                            'UPDATE products SET category_id = ?, updated_at = NOW() WHERE id = ?',
                            [matchedCategory, product.id]
                        );
                        results.updated++;

                        // Track assignments
                        const categoryName = categories.find(c => c.id === matchedCategory)?.name || 'Unknown';
                        if (!results.categoryAssignments[categoryName]) {
                            results.categoryAssignments[categoryName] = 0;
                        }
                        results.categoryAssignments[categoryName]++;
                    } else {
                        // Product already has correct category
                        const categoryName = categories.find(c => c.id === matchedCategory)?.name || 'Unknown';
                        if (!results.categoryAssignments[categoryName]) {
                            results.categoryAssignments[categoryName] = 0;
                        }
                        results.categoryAssignments[categoryName]++;
                    }
                } else {
                    results.notMatched++;
                    results.notMatchedProducts.push({
                        id: product.id,
                        name: productName,
                        reason: 'No matching category found'
                    });
                }
            }

            await connection.commit();
            logger.info('Product category matching completed', {
                total: products.length,
                matched: results.matched,
                updated: results.updated,
                notMatched: results.notMatched,
                assignments: results.categoryAssignments
            });
            return { ...results, success: true, message: 'Product category matching completed.' };

        } catch (error) {
            if (connection) await connection.rollback();
            logger.error('Error during product category matching:', error);
            throw error;
        } finally {
            if (connection) connection.release();
        }
    }
}

if (require.main === module) {
    (async () => {
    loadBackendEnv();
        try {
            const matcher = new ProductCategoryMatcher();
            const result = await matcher.matchAndAssignCategories();
            console.log('\n📊 Matching Results:');
            console.log(`✅ Matched: ${result.matched}`);
            console.log(`🔄 Updated: ${result.updated}`);
            console.log(`❌ Not Matched: ${result.notMatched}`);
            console.log('\n📋 Category Assignments:');
            Object.entries(result.categoryAssignments || {}).forEach(([category, count]) => {
                console.log(`   ${category}: ${count} products`);
            });
            if (result.notMatchedProducts.length > 0 && result.notMatchedProducts.length <= 10) {
                console.log('\n⚠️  Products not matched:');
                result.notMatchedProducts.forEach(p => {
                    console.log(`   - ${p.name} (ID: ${p.id}): ${p.reason}`);
                });
            }
        } catch (error) {
            console.error('Failed to run product category matcher:', error);
            process.exit(1);
        } finally {
            process.exit(0);
        }
    })();
}

module.exports = ProductCategoryMatcher;

