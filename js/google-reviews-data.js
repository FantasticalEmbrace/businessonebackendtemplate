/**

 * Public review quotes for the homepage carousel.

 * Only includes entries we can document as sourced from public Google reviews.

 * Do NOT add Review or AggregateRating JSON-LD — display only.

 */

(function (global) {

    'use strict';



    const GOOGLE_MAPS_REVIEWS_URL =

        'https://www.google.com/maps/search/?api=1&query=H%26M+Herbs+%26+Vitamins,+1140+Battlefield+Pkwy,+Fort+Oglethorpe,+GA+30742';



    /** @type {Array<{author:string,text:string,birdeyeVerified?:boolean}>} */

    const GOOGLE_REVIEWS = [

        {

            author: 'Melanie Morton',

            text: 'Helpful, knowledgeable and they have great products!',

            birdeyeVerified: true

        },

        {

            author: 'Bethany Dean',

            text: "I've been coming to this place for years. They are always so friendly and helpful. They have really great quality herbs and vitamins for pretty much any problem that is bothering you. I hope they don't ever leave, because it's so hard to find a good herb shop like this.",

            birdeyeVerified: true

        },

        {

            author: 'Stephen Butler',

            text: 'I usually just order all our supplements and herbs online but needed something the same day, so I went here. I was super impressed by this place. Selection was really good and prices are amazing for a smaller local place and actually might be cheaper than I could find online. Has a peaceful atmosphere and the gentleman that is there is always super helpful. Would highly recommend checking this place out!',

            birdeyeVerified: true

        },

        {

            author: 'DeAnna A.',

            text: "I've been going to h and m herbs for several years. They're always so helpful and caring!",

            birdeyeVerified: true

        }

    ];



    function escapeHtml(str) {

        return String(str || '')

            .replace(/&/g, '&amp;')

            .replace(/</g, '&lt;')

            .replace(/>/g, '&gt;')

            .replace(/"/g, '&quot;');

    }



    function renderGoogleReviewsCarousel(trackEl) {

        if (!trackEl) return;

        const reviews = GOOGLE_REVIEWS.filter((review) => review.birdeyeVerified);

        trackEl.innerHTML = reviews.map((review) => {

            const quote = escapeHtml(review.text);

            const author = escapeHtml(review.author);

            return (

                `<article class="testimonial-card" data-review-source="google-verified">` +

                `<blockquote class="testimonial-content" cite="${GOOGLE_MAPS_REVIEWS_URL}">` +

                `<p>&ldquo;${quote}&rdquo;</p>` +

                `</blockquote>` +

                `<footer class="testimonial-author">` +

                `<div class="author-info">` +

                `<cite class="author-name">${author}</cite>` +

                `<span class="review-source-tag">Google review</span>` +

                `</div>` +

                `</footer>` +

                `</article>`

            );

        }).join('');

    }



    global.HM_GOOGLE_REVIEWS = {

        mapsUrl: GOOGLE_MAPS_REVIEWS_URL,

        reviews: GOOGLE_REVIEWS,

        renderCarousel: renderGoogleReviewsCarousel

    };

})(typeof window !== 'undefined' ? window : globalThis);

