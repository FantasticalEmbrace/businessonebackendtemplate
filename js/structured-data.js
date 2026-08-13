// Structured Data (Schema.org) Implementation for HM Herbs
// Enhances SEO with rich snippets and better search engine understanding

class StructuredDataManager {
    constructor() {
        this.baseUrl = window.location.origin;
        this.init();
    }

    init() {
        const currentPage = this.getCurrentPageType();
        const isHomepage = currentPage === 'homepage';

        // index.html already ships Organization, WebSite, and LocalBusiness JSON-LD.
        if (!isHomepage) {
            this.addOrganizationSchema();
            this.addWebsiteSchema();
            this.addLocalBusinessSchema();
        }
        this.addBreadcrumbSchema();
        
        // Add page-specific schemas based on current page
        switch (currentPage) {
            case 'homepage':
                this.addHomepageSchema();
                break;
            case 'products':
                this.addProductCatalogSchema();
                break;
            case 'product':
                this.addProductSchema();
                break;
            case 'service':
                this.addServiceSchema();
                break;
        }
    }

    getCurrentPageType() {
        const path = window.location.pathname;
        if (path === '/' || path === '/index.html') return 'homepage';
        if (path.includes('products')) return 'products';
        if (path.includes('product/')) return 'product';
        if (path.includes('edsa') || path.includes('service')) return 'service';
        return 'other';
    }

    addSchema(schema) {
        const script = document.createElement('script');
        script.type = 'application/ld+json';
        script.textContent = JSON.stringify(schema);
        document.head.appendChild(script);
    }

    addOrganizationSchema() {
        const organizationSchema = {
            "@context": "https://schema.org",
            "@type": "Organization",
            "name": "H&M Herbs & Vitamins",
            "alternateName": "HM Herbs",
            "description": "Premium natural health products, herbs, vitamins, and wellness supplements organized by health conditions and brands.",
            "url": this.baseUrl,
            "logo": `${this.baseUrl}/images/logo.png`,
            "image": `${this.baseUrl}/images/og-image.jpg`,
            "telephone": "+1-706-861-9454",
            "email": "hmherbs1@gmail.com",
            "address": {
                "@type": "PostalAddress",
                "streetAddress": "1140 Battlefield Pkwy",
                "addressLocality": "Fort Oglethorpe",
                "addressRegion": "GA",
                "postalCode": "30742",
                "addressCountry": "US"
            },
            "sameAs": [
                "https://www.facebook.com/hmherbs",
                "https://www.instagram.com/hmherbs",
                "https://twitter.com/hmherbs"
            ],
            "foundingDate": "1995-05-01",
            "slogan": "Your trusted source for natural wellness",
            "knowsAbout": [
                "Herbal Medicine",
                "Nutritional Supplements",
                "Vitamins",
                "Natural Health",
                "Wellness",
                "EDSA Testing",
                "Holistic Health"
            ]
        };

        this.addSchema(organizationSchema);
    }

    addWebsiteSchema() {
        const websiteSchema = {
            "@context": "https://schema.org",
            "@type": "WebSite",
            "name": "H&M Herbs & Vitamins",
            "url": this.baseUrl,
            "description": "Premium natural health products, herbs, vitamins, and wellness supplements organized by health conditions and brands.",
            "publisher": {
                "@type": "Organization",
                "name": "H&M Herbs & Vitamins"
            },
            "potentialAction": {
                "@type": "SearchAction",
                "target": {
                    "@type": "EntryPoint",
                    "urlTemplate": `${this.baseUrl}/products.html?search={search_term_string}`
                },
                "query-input": "required name=search_term_string"
            },
            "mainEntity": {
                "@type": "ItemList",
                "name": "Health Categories",
                "itemListElement": [
                    {
                        "@type": "ListItem",
                        "position": 1,
                        "name": "Blood Pressure & Heart Health",
                        "url": `${this.baseUrl}/categories.html`
                    },
                    {
                        "@type": "ListItem",
                        "position": 2,
                        "name": "Allergies & Immune Support",
                        "url": `${this.baseUrl}/categories.html`
                    },
                    {
                        "@type": "ListItem",
                        "position": 3,
                        "name": "Digestive Health",
                        "url": `${this.baseUrl}/categories.html`
                    }
                ]
            }
        };

        this.addSchema(websiteSchema);
    }

    addLocalBusinessSchema() {
        const localBusinessSchema = {
            "@context": "https://schema.org",
            "@type": "HealthAndBeautyBusiness",
            "name": "H&M Herbs & Vitamins",
            "description": "Premium natural health products, herbs, vitamins, and wellness supplements store.",
            "url": this.baseUrl,
            "telephone": "+1-706-861-9454",
            "email": "hmherbs1@gmail.com",
            "address": {
                "@type": "PostalAddress",
                "streetAddress": "1140 Battlefield Pkwy",
                "addressLocality": "Fort Oglethorpe",
                "addressRegion": "GA",
                "postalCode": "30742",
                "addressCountry": "US"
            },
            "geo": {
                "@type": "GeoCoordinates",
                "latitude": "34.9487",
                "longitude": "-85.2569"
            },
            "openingHoursSpecification": [
                {
                    "@type": "OpeningHoursSpecification",
                    "dayOfWeek": ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
                    "opens": "10:00",
                    "closes": "17:00"
                },
                {
                    "@type": "OpeningHoursSpecification",
                    "dayOfWeek": "Saturday",
                    "opens": "10:00",
                    "closes": "13:00"
                }
            ],
            "priceRange": "$$",
            "paymentAccepted": ["Cash", "Credit Card", "PayPal"],
            "currenciesAccepted": "USD",
            "hasOfferCatalog": {
                "@type": "OfferCatalog",
                "name": "Health Products Catalog",
                "itemListElement": [
                    {
                        "@type": "Offer",
                        "itemOffered": {
                            "@type": "Product",
                            "name": "Herbal Supplements",
                            "category": "Health Supplements"
                        }
                    },
                    {
                        "@type": "Offer",
                        "itemOffered": {
                            "@type": "Product",
                            "name": "Vitamins & Minerals",
                            "category": "Nutritional Supplements"
                        }
                    }
                ]
            }
        };

        this.addSchema(localBusinessSchema);
    }

    addBreadcrumbSchema() {
        const breadcrumbItems = this.generateBreadcrumbs();
        if (breadcrumbItems.length > 1) {
            const breadcrumbSchema = {
                "@context": "https://schema.org",
                "@type": "BreadcrumbList",
                "itemListElement": breadcrumbItems
            };

            this.addSchema(breadcrumbSchema);
        }
    }

    generateBreadcrumbs() {
        const path = window.location.pathname;
        const breadcrumbs = [];
        
        // Always start with home
        breadcrumbs.push({
            "@type": "ListItem",
            "position": 1,
            "name": "Home",
            "item": this.baseUrl
        });

        // Add path-specific breadcrumbs
        if (path.includes('products')) {
            breadcrumbs.push({
                "@type": "ListItem",
                "position": 2,
                "name": "Products",
                "item": `${this.baseUrl}/products.html`
            });
        }

        return breadcrumbs;
    }

    addHomepageSchema() {
        const homepageSchema = {
            "@context": "https://schema.org",
            "@type": "WebPage",
            "name": "H&M Herbs & Vitamins - Premium Natural Health Products",
            "description": "Premium herbs, vitamins, and natural health supplements organized by health conditions. EDSA wellness testing available in-store.",
            "url": this.baseUrl,
            "mainEntity": {
                "@type": "ItemList",
                "name": "Featured Health Categories",
                "numberOfItems": 12,
                "itemListElement": [
                    {
                        "@type": "ListItem",
                        "position": 1,
                        "name": "Blood Pressure & Heart Health"
                    },
                    {
                        "@type": "ListItem",
                        "position": 2,
                        "name": "Allergies & Immune Support"
                    },
                    {
                        "@type": "ListItem",
                        "position": 3,
                        "name": "Digestive Health"
                    }
                ]
            },
            "about": {
                "@type": "Thing",
                "name": "Natural Health Products",
                "description": "Comprehensive selection of herbs, vitamins, supplements, and wellness products"
            },
            "mentions": [
                {
                    "@type": "Service",
                    "name": "EDSA Testing",
                    "description": "Electro Dermal Stress Analysis for personalized health assessment"
                }
            ]
        };

        this.addSchema(homepageSchema);
    }

    addProductCatalogSchema() {
        const catalogSchema = {
            "@context": "https://schema.org",
            "@type": "CollectionPage",
            "name": "Health Products Catalog",
            "description": "Browse our complete catalog of herbs, vitamins, supplements, and natural health products.",
            "url": `${this.baseUrl}/products.html`,
            "mainEntity": {
                "@type": "ItemList",
                "name": "Product Categories",
                "itemListElement": [
                    {
                        "@type": "ListItem",
                        "position": 1,
                        "name": "Herbs & Botanicals"
                    },
                    {
                        "@type": "ListItem",
                        "position": 2,
                        "name": "Vitamins & Minerals"
                    },
                    {
                        "@type": "ListItem",
                        "position": 3,
                        "name": "Nutritional Supplements"
                    }
                ]
            }
        };

        this.addSchema(catalogSchema);
    }

    addProductSchema(productData = null) {
        // This would be called for individual product pages
        // productData would come from the product details
        if (!productData) return;

        const productSchema = {
            "@context": "https://schema.org",
            "@type": "Product",
            "name": productData.name,
            "description": productData.description,
            "image": productData.image,
            "sku": productData.sku,
            "brand": {
                "@type": "Brand",
                "name": productData.brand
            },
            "category": productData.category,
            "offers": {
                "@type": "Offer",
                "price": productData.price,
                "priceCurrency": "USD",
                "availability": productData.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
                "seller": {
                    "@type": "Organization",
                    "name": "H&M Herbs & Vitamins"
                }
            },
            "aggregateRating": productData.rating ? {
                "@type": "AggregateRating",
                "ratingValue": productData.rating.value,
                "reviewCount": productData.rating.count
            } : null
        };

        this.addSchema(productSchema);
    }

    addServiceSchema() {
        const serviceSchema = {
            "@context": "https://schema.org",
            "@type": "Service",
            "name": "EDSA Biofeedback Testing",
            "description": "Electro Dermal Stress Analysis wellness session offered in-store by appointment.",
            "url": `${this.baseUrl}/#edsa-service`,
            "provider": {
                "@type": "Organization",
                "name": "H&M Herbs & Vitamins"
            },
            "serviceType": "Health Assessment",
            "areaServed": {
                "@type": "City",
                "name": "Fort Oglethorpe",
                "containedInPlace": {
                    "@type": "State",
                    "name": "Georgia"
                }
            },
            "hasOfferCatalog": {
                "@type": "OfferCatalog",
                "name": "EDSA Services",
                "itemListElement": [
                    {
                        "@type": "Offer",
                        "itemOffered": {
                            "@type": "Service",
                            "name": "Comprehensive EDSA Analysis",
                            "description": "Full body stress analysis and health assessment"
                        },
                        "price": "75",
                        "priceCurrency": "USD"
                    }
                ]
            }
        };

        this.addSchema(serviceSchema);
    }

    // Method to add FAQ schema for pages with FAQs
    addFAQSchema(faqData) {
        const faqSchema = {
            "@context": "https://schema.org",
            "@type": "FAQPage",
            "mainEntity": faqData.map(faq => ({
                "@type": "Question",
                "name": faq.question,
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": faq.answer
                }
            }))
        };

        this.addSchema(faqSchema);
    }

    // Method to add review schema
    addReviewSchema(reviewData) {
        const reviewSchema = {
            "@context": "https://schema.org",
            "@type": "Review",
            "itemReviewed": {
                "@type": "Organization",
                "name": "H&M Herbs & Vitamins"
            },
            "author": {
                "@type": "Person",
                "name": reviewData.author
            },
            "reviewRating": {
                "@type": "Rating",
                "ratingValue": reviewData.rating,
                "bestRating": "5"
            },
            "reviewBody": reviewData.text,
            "datePublished": reviewData.date
        };

        this.addSchema(reviewSchema);
    }
}

// Initialize structured data when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new StructuredDataManager();
});

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = StructuredDataManager;
}
