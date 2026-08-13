// Testimonials Carousel - Rotating carousel showing 3 testimonials at a time
// Set localStorage DEBUG_CAROUSEL=1 to enable verbose slide logging
const DEBUG_CAROUSEL = typeof window !== 'undefined' &&
    window.localStorage && window.localStorage.getItem('DEBUG_CAROUSEL') === '1';

class TestimonialsCarousel {
    constructor() {
        const track = document.querySelector('.testimonials-track');
        if (
            track &&
            track.dataset.renderGoogleReviews === 'true' &&
            window.HM_GOOGLE_REVIEWS &&
            typeof window.HM_GOOGLE_REVIEWS.renderCarousel === 'function'
        ) {
            window.HM_GOOGLE_REVIEWS.renderCarousel(track);
        }

        this.carousel = document.querySelector('.testimonials-carousel');
        this.track = document.querySelector('.testimonials-track');
        // Get only original cards (not cloned ones)
        this.cards = document.querySelectorAll('.testimonials-track > .testimonial-card:not(.cloned)');
        this.prevBtn = document.querySelector('.carousel-prev');
        this.nextBtn = document.querySelector('.carousel-next');
        this.indicatorsContainer = document.querySelector('.carousel-indicators');

        this.currentIndex = 0;
        this.itemsPerView = this.getItemsPerView();
        this.totalSlides = Math.ceil(this.cards.length / this.itemsPerView);
        this.autoPlayInterval = null;
        this.autoPlayDelay = 5000; // 5 seconds

        if (DEBUG_CAROUSEL) {
            console.log(`🎠 Testimonials Carousel: Found ${this.cards.length} reviews, showing ${this.itemsPerView} at a time, ${this.totalSlides} slides`);
        }

        if (this.carousel && this.track && this.cards.length > 0) {
            this.init();
        } else {
            console.warn('⚠️ Testimonials carousel elements not found');
        }
    }

    getItemsPerView() {
        if (window.innerWidth <= 768) {
            return 1; // 1 item on mobile
        } else if (window.innerWidth <= 1200) {
            return 2; // 2 items on tablet
        } else {
            return 3; // 3 items on desktop
        }
    }

    init() {
        // Clone cards for infinite loop effect
        this.cloneCards();

        // Hide indicators - user requested to keep original design without indicator bars
        if (this.indicatorsContainer) {
            this.indicatorsContainer.style.display = 'none';
        }

        // Setup event listeners
        this.setupEventListeners();

        // Start auto-play
        this.startAutoPlay();

        // Handle window resize
        window.addEventListener('resize', () => {
            clearTimeout(this.resizeTimeout);
            this.resizeTimeout = setTimeout(() => {
                this.itemsPerView = this.getItemsPerView();
                this.totalSlides = Math.ceil(this.cards.length / this.itemsPerView);
                // Indicators are hidden, no need to update
                this.goToSlide(this.currentIndex);
            }, 250);
        });

        // Initial positioning - wait for layout to be ready
        // Use double requestAnimationFrame to ensure layout is complete
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                this.goToSlide(0);
            });
        });
    }

    cloneCards() {
        // Get original cards (in case this is called multiple times)
        const originalCards = Array.from(this.track.querySelectorAll('.testimonial-card:not(.cloned)'));

        if (originalCards.length === 0) {
            console.warn('⚠️ No original cards found to clone');
            return;
        }

        // Clone first few cards and append to end for seamless infinite loop
        const cardsToClone = Math.min(this.itemsPerView, originalCards.length);
        for (let i = 0; i < cardsToClone; i++) {
            const clonedCard = originalCards[i].cloneNode(true);
            clonedCard.classList.add('cloned');
            this.track.appendChild(clonedCard);
        }

        // Clone last few cards and prepend to start for seamless infinite loop
        const startIndex = Math.max(0, originalCards.length - this.itemsPerView);
        for (let i = startIndex; i < originalCards.length; i++) {
            const clonedCard = originalCards[i].cloneNode(true);
            clonedCard.classList.add('cloned');
            this.track.insertBefore(clonedCard, this.track.firstChild);
        }

        if (DEBUG_CAROUSEL) {
            console.log(`✅ Cloned ${cardsToClone + (originalCards.length - startIndex)} cards for seamless loop`);
        }
    }

    createIndicators() {
        this.indicatorsContainer.innerHTML = '';
        for (let i = 0; i < this.totalSlides; i++) {
            const indicator = document.createElement('button');
            indicator.classList.add('carousel-indicator');
            if (i === 0) {
                indicator.classList.add('active');
            }
            indicator.setAttribute('aria-label', `Go to testimonial group ${i + 1}`);
            indicator.addEventListener('click', () => this.goToSlide(i));
            this.indicatorsContainer.appendChild(indicator);
        }
    }

    updateIndicators() {
        const indicators = this.indicatorsContainer.querySelectorAll('.carousel-indicator');
        indicators.forEach((indicator, index) => {
            indicator.classList.toggle('active', index === this.currentIndex);
        });
    }

    setupEventListeners() {
        if (this.prevBtn) {
            this.prevBtn.addEventListener('click', () => this.prevSlide());
        }

        if (this.nextBtn) {
            this.nextBtn.addEventListener('click', () => this.nextSlide());
        }

        // Pause on hover
        this.carousel.addEventListener('mouseenter', () => this.stopAutoPlay());
        this.carousel.addEventListener('mouseleave', () => this.startAutoPlay());

        // Keyboard navigation
        this.carousel.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowLeft') {
                this.prevSlide();
            } else if (e.key === 'ArrowRight') {
                this.nextSlide();
            }
        });

        // Touch/swipe support — store on the instance so handleSwipe() can
        // read them. (Previously these were closure-locals and handleSwipe
        // threw a ReferenceError on every swipe.)
        this._touchStartX = 0;
        this._touchEndX = 0;

        this.carousel.addEventListener('touchstart', (e) => {
            this._touchStartX = e.changedTouches[0].screenX;
        }, { passive: true });

        this.carousel.addEventListener('touchend', (e) => {
            this._touchEndX = e.changedTouches[0].screenX;
            this.handleSwipe();
        }, { passive: true });
    }

    handleSwipe() {
        const swipeThreshold = 50;
        const diff = (this._touchStartX || 0) - (this._touchEndX || 0);

        if (Math.abs(diff) > swipeThreshold) {
            if (diff > 0) {
                this.nextSlide();
            } else {
                this.prevSlide();
            }
        }
    }

    goToSlide(index) {
        // Ensure index is within valid range
        if (index < 0) {
            index = this.totalSlides - 1;
        } else if (index >= this.totalSlides) {
            index = 0;
        }

        this.currentIndex = index;

        // Get all cards in the track (including cloned ones)
        const allCards = Array.from(this.track.querySelectorAll('.testimonial-card'));
        if (allCards.length === 0) {
            console.warn('⚠️ No cards found');
            return;
        }

        // Calculate which card index we want to show as the first visible card
        // After cloning, structure is: [cloned_last_N] [original_11] [cloned_first_N]
        // Original cards start at index = itemsPerView (after the cloned cards at start)
        // For slide index, we want to show original cards starting at (index * itemsPerView)
        const targetCardIndex = this.itemsPerView + (index * this.itemsPerView);

        if (targetCardIndex >= allCards.length) {
            console.warn(`⚠️ Target card index ${targetCardIndex} exceeds card count ${allCards.length}`);
            return;
        }

        // Get gap from CSS
        const trackStyle = getComputedStyle(this.track);
        const gapValue = parseFloat(trackStyle.gap) || 24; // Default to 1.5rem (24px)

        // Get the actual rendered width of the first card
        // This accounts for flexbox calc() values and responsive breakpoints
        const firstCard = allCards[0];
        const firstCardWidth = firstCard.offsetWidth;
        
        if (firstCardWidth === 0) {
            console.warn('⚠️ Card width is 0, retrying...');
            requestAnimationFrame(() => this.goToSlide(index));
            return;
        }
        
        // Calculate translateX: move by targetCardIndex cards
        // Each card is firstCardWidth wide, with gapValue gaps between them
        // For N cards, we have N card widths + (N-1) gaps
        const translateX = -(targetCardIndex * firstCardWidth + (targetCardIndex - 1) * gapValue);
        
        // Apply the calculated transform with !important to override any CSS conflicts
        this.track.style.setProperty('transform', `translateX(${translateX}px)`, 'important');
        this.track.style.setProperty('-webkit-transform', `translateX(${translateX}px)`, 'important');

        if (DEBUG_CAROUSEL) {
            const startCardNum = index * this.itemsPerView;
            const endCardNum = Math.min((index + 1) * this.itemsPerView - 1, this.cards.length - 1);
            console.log(`🔄 Slide ${index + 1}/${this.totalSlides}: translateX(${translateX.toFixed(2)}px), showing original cards ${startCardNum}-${endCardNum} (targetCardIndex: ${targetCardIndex}, cardWidth: ${firstCardWidth.toFixed(2)}px, gap: ${gapValue}px)`);
            console.log(`   Applied transform: ${this.track.style.transform}`);
            console.log(`   Computed transform: ${getComputedStyle(this.track).transform}`);
        }

        // Indicators are hidden, no need to update
    }

    nextSlide() {
        this.currentIndex = (this.currentIndex + 1) % this.totalSlides;
        this.goToSlide(this.currentIndex);
        this.restartAutoPlay();
    }

    prevSlide() {
        this.currentIndex = (this.currentIndex - 1 + this.totalSlides) % this.totalSlides;
        this.goToSlide(this.currentIndex);
        this.restartAutoPlay();
    }

    startAutoPlay() {
        this.stopAutoPlay();
        this.autoPlayInterval = setInterval(() => {
            this.nextSlide();
        }, this.autoPlayDelay);
    }

    stopAutoPlay() {
        if (this.autoPlayInterval) {
            clearInterval(this.autoPlayInterval);
            this.autoPlayInterval = null;
        }
    }

    restartAutoPlay() {
        this.stopAutoPlay();
        this.startAutoPlay();
    }
}

// Initialize carousel when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        new TestimonialsCarousel();
    });
} else {
    new TestimonialsCarousel();
}

