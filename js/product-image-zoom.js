/**
 * Product image zoom — Amazon-style hover lens on desktop, pinch/drag lightbox on touch.
 */
(function () {
    'use strict';

    const DESKTOP_MQ = '(hover: hover) and (pointer: fine) and (min-width: 992px)';
    const ZOOM_MIN = 1;
    const ZOOM_MAX = 4;
    const LENS_FRACTION = 0.42;

    function isPlaceholderSrc(src) {
        const s = String(src || '');
        return !s || s.startsWith('data:image/svg');
    }

    function prefersHoverZoom() {
        return window.matchMedia(DESKTOP_MQ).matches;
    }

    /** Amazon-style lens + side pane on hover (desktop). */
    class AmazonHoverZoom {
        constructor(options = {}) {
            this.resolveUrl = options.resolveUrl || ((url) => url);
            this.onRequestLightbox = options.onRequestLightbox || (() => {});
            this.mainImage = null;
            this.imagesRoot = null;
            this.frame = null;
            this.lens = null;
            this.pane = null;
            this.active = false;
            this.zoomScale = 2.5;
            this._onMove = (e) => this.handleMove(e);
            this._onEnter = () => this.activate();
            this._onLeave = () => this.deactivate();
            this._onLoad = () => this.refresh();
            this._onKey = (e) => {
                if (e.key !== 'Enter' && e.key !== ' ') return;
                e.preventDefault();
                this.onRequestLightbox();
            };
        }

        bindMainImage(mainImage) {
            this.unbind();
            if (!mainImage) return;

            this.mainImage = mainImage;
            this.imagesRoot = mainImage.closest('.product-images');
            this.frame = mainImage.closest('.product-main-image');
            if (!this.frame || !this.imagesRoot) return;

            this.frame.classList.add('hm-amazon-zoom-frame');
            this.imagesRoot.classList.add('hm-amazon-zoom-root');

            if (!this.lens) {
                this.lens = document.createElement('div');
                this.lens.className = 'hm-amazon-zoom-lens';
                this.lens.setAttribute('aria-hidden', 'true');
                this.frame.appendChild(this.lens);
            }

            if (!this.pane) {
                this.pane = document.createElement('div');
                this.pane.className = 'hm-amazon-zoom-pane';
                this.pane.setAttribute('aria-hidden', 'true');
                this.imagesRoot.appendChild(this.pane);
            }

            if (!this.frame.querySelector('.hm-amazon-zoom-hint')) {
                const hint = document.createElement('span');
                hint.className = 'hm-amazon-zoom-hint';
                hint.setAttribute('aria-hidden', 'true');
                hint.textContent = 'Roll over image to zoom in';
                this.frame.appendChild(hint);
            }

            mainImage.classList.add('product-image-zoomable');
            mainImage.setAttribute('role', 'button');
            mainImage.setAttribute('tabindex', '0');
            mainImage.setAttribute('aria-label', 'Product image. Hover to magnify or press Enter to open full view.');

            this.frame.addEventListener('mouseenter', this._onEnter);
            this.frame.addEventListener('mouseleave', this._onLeave);
            this.frame.addEventListener('mousemove', this._onMove);
            mainImage.addEventListener('load', this._onLoad);
            mainImage.addEventListener('keydown', this._onKey);

            this.refresh();
        }

        unbind() {
            if (this.frame) {
                this.frame.removeEventListener('mouseenter', this._onEnter);
                this.frame.removeEventListener('mouseleave', this._onLeave);
                this.frame.removeEventListener('mousemove', this._onMove);
                this.frame.classList.remove('hm-amazon-zoom-frame', 'is-zooming');
            }
            if (this.mainImage) {
                this.mainImage.removeEventListener('load', this._onLoad);
                this.mainImage.removeEventListener('keydown', this._onKey);
            }
            this.deactivate();
            this.mainImage = null;
            this.imagesRoot = null;
            this.frame = null;
        }

        refresh() {
            if (!this.mainImage || !this.pane) return;
            const src = this.mainImage.currentSrc || this.mainImage.src;
            if (isPlaceholderSrc(src) || !prefersHoverZoom()) {
                this.deactivate();
                this.frame?.classList.remove('hm-amazon-zoom-ready');
                return;
            }

            const displayW = this.frame.clientWidth || 1;
            const naturalW = this.mainImage.naturalWidth || displayW;
            this.zoomScale = Math.min(ZOOM_MAX, Math.max(2, naturalW / displayW));
            if (!Number.isFinite(this.zoomScale) || this.zoomScale < 1.2) {
                this.zoomScale = 2;
            }

            const url = this.resolveUrl(src);
            this.pane.style.backgroundImage = url ? `url(${JSON.stringify(url)})` : 'none';
            this.frame.classList.add('hm-amazon-zoom-ready');
        }

        activate() {
            if (!prefersHoverZoom() || !this.frame?.classList.contains('hm-amazon-zoom-ready')) return;
            this.active = true;
            this.frame.classList.add('is-zooming');
            this.imagesRoot?.classList.add('is-amazon-zoom-active');
            this.pane?.removeAttribute('hidden');
            this.lens?.removeAttribute('hidden');
        }

        deactivate() {
            this.active = false;
            this.frame?.classList.remove('is-zooming');
            this.imagesRoot?.classList.remove('is-amazon-zoom-active');
            if (this.pane) {
                this.pane.setAttribute('hidden', '');
            }
            if (this.lens) {
                this.lens.setAttribute('hidden', '');
            }
        }

        handleMove(event) {
            if (!this.active || !this.frame || !this.lens || !this.pane) return;

            const rect = this.frame.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const y = event.clientY - rect.top;

            if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
                return;
            }

            const lensW = rect.width * LENS_FRACTION;
            const lensH = rect.height * LENS_FRACTION;

            let left = x - lensW / 2;
            let top = y - lensH / 2;
            left = Math.max(0, Math.min(left, rect.width - lensW));
            top = Math.max(0, Math.min(top, rect.height - lensH));

            this.lens.style.width = `${lensW}px`;
            this.lens.style.height = `${lensH}px`;
            this.lens.style.transform = `translate(${left}px, ${top}px)`;

            const scaleX = rect.width / lensW;
            const scaleY = rect.height / lensH;
            const bgW = rect.width * scaleX;
            const bgH = rect.height * scaleY;

            this.pane.style.backgroundSize = `${bgW}px ${bgH}px`;
            this.pane.style.backgroundPosition = `${-left * scaleX}px ${-top * scaleY}px`;
        }
    }

    /** Full-screen viewer for touch devices and keyboard users. */
    class ProductImageLightbox {
        constructor(options = {}) {
            this.getImages = options.getImages || (() => []);
            this.resolveUrl = options.resolveUrl || ((url) => url);
            this.getActiveIndex = options.getActiveIndex || (() => 0);

            this.currentIndex = 0;
            this.scale = 1;
            this.translateX = 0;
            this.translateY = 0;
            this.isOpen = false;
            this.isDragging = false;
            this.activePointers = new Map();
            this.pointerMoved = false;
            this.pinchStartDistance = 0;
            this.pinchStartScale = 1;

            this.buildModal();
            this.bindModalEvents();
        }

        buildModal() {
            const root = document.createElement('div');
            root.id = 'product-image-zoom-modal';
            root.className = 'product-image-zoom';
            root.hidden = true;
            root.setAttribute('role', 'dialog');
            root.setAttribute('aria-modal', 'true');
            root.setAttribute('aria-label', 'Product image viewer');
            root.innerHTML = [
                '<div class="product-image-zoom-backdrop" data-zoom-dismiss></div>',
                '<div class="product-image-zoom-dialog">',
                '  <button type="button" class="product-image-zoom-close modal-close" aria-label="Close image viewer"></button>',
                '  <button type="button" class="product-image-zoom-nav product-image-zoom-prev" aria-label="Previous image">',
                '    <i class="fas fa-chevron-left" aria-hidden="true"></i>',
                '  </button>',
                '  <button type="button" class="product-image-zoom-nav product-image-zoom-next" aria-label="Next image">',
                '    <i class="fas fa-chevron-right" aria-hidden="true"></i>',
                '  </button>',
                '  <div class="product-image-zoom-stage">',
                '    <div class="product-image-zoom-canvas">',
                '      <img class="product-image-zoom-img" alt="" draggable="false">',
                '    </div>',
                '  </div>',
                '  <p class="product-image-zoom-hint">Pinch or double-tap to zoom · Drag to move around</p>',
                '</div>',
            ].join('');

            document.body.appendChild(root);

            this.root = root;
            this.stage = root.querySelector('.product-image-zoom-stage');
            this.canvas = root.querySelector('.product-image-zoom-canvas');
            this.img = root.querySelector('.product-image-zoom-img');
            this.prevBtn = root.querySelector('.product-image-zoom-prev');
            this.nextBtn = root.querySelector('.product-image-zoom-next');
        }

        bindModalEvents() {
            this.root.querySelector('[data-zoom-dismiss]').addEventListener('click', () => this.close());
            this.root.querySelector('.product-image-zoom-close').addEventListener('click', () => this.close());

            this.prevBtn.addEventListener('click', () => this.stepImage(-1));
            this.nextBtn.addEventListener('click', () => this.stepImage(1));

            document.addEventListener('keydown', (e) => {
                if (!this.isOpen) return;
                if (e.key === 'Escape') {
                    e.preventDefault();
                    this.close();
                } else if (e.key === 'ArrowLeft') {
                    e.preventDefault();
                    this.stepImage(-1);
                } else if (e.key === 'ArrowRight') {
                    e.preventDefault();
                    this.stepImage(1);
                }
            });

            this.stage.addEventListener('wheel', (e) => {
                if (!this.isOpen) return;
                e.preventDefault();
                const delta = e.deltaY < 0 ? 0.35 : -0.35;
                this.setScale(this.scale + delta, e.clientX, e.clientY);
            }, { passive: false });

            this.stage.addEventListener('pointerdown', (e) => this.onPointerDown(e));
            this.stage.addEventListener('pointermove', (e) => this.onPointerMove(e));
            this.stage.addEventListener('pointerup', (e) => this.onPointerUp(e));
            this.stage.addEventListener('pointercancel', (e) => this.onPointerUp(e));

            this.img.addEventListener('dblclick', (e) => {
                e.preventDefault();
                if (this.scale > 1) {
                    this.resetTransform();
                } else {
                    this.setScale(2, e.clientX, e.clientY);
                }
            });

            this.img.addEventListener('load', () => this.resetTransform());
        }

        open(index = 0) {
            const images = this.getImages();
            if (!images.length) return;

            this.currentIndex = Math.max(0, Math.min(index, images.length - 1));
            this.isOpen = true;
            this.root.hidden = false;
            this.root.classList.add('is-open');
            document.body.classList.add('product-image-zoom-open');
            this.resetTransform();
            this.loadCurrentImage();
            this.updateNavButtons();
            this.root.querySelector('.product-image-zoom-close').focus();
        }

        close() {
            if (!this.isOpen) return;
            this.isOpen = false;
            this.root.hidden = true;
            this.root.classList.remove('is-open');
            document.body.classList.remove('product-image-zoom-open');
            this.resetTransform();
        }

        stepImage(delta) {
            const images = this.getImages();
            if (images.length <= 1) return;
            this.currentIndex = (this.currentIndex + delta + images.length) % images.length;
            this.resetTransform();
            this.loadCurrentImage();
            this.updateNavButtons();
        }

        loadCurrentImage() {
            const images = this.getImages();
            const image = images[this.currentIndex];
            if (!image) return;
            this.img.src = this.resolveUrl(image.image_url);
            this.img.alt = image.alt_text || 'Product image';
        }

        updateNavButtons() {
            const multi = this.getImages().length > 1;
            this.prevBtn.hidden = !multi;
            this.nextBtn.hidden = !multi;
        }

        setScale(nextScale, clientX, clientY) {
            const prevScale = this.scale;
            this.scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, nextScale));

            if (this.scale === 1) {
                this.translateX = 0;
                this.translateY = 0;
            } else if (typeof clientX === 'number' && typeof clientY === 'number') {
                const rect = this.stage.getBoundingClientRect();
                const offsetX = clientX - rect.left - rect.width / 2;
                const offsetY = clientY - rect.top - rect.height / 2;
                const ratio = this.scale / prevScale - 1;
                this.translateX -= offsetX * ratio;
                this.translateY -= offsetY * ratio;
            }

            this.clampTranslate();
            this.applyTransform();
        }

        resetTransform() {
            this.scale = 1;
            this.translateX = 0;
            this.translateY = 0;
            this.applyTransform();
        }

        applyTransform() {
            const value = `translate(${this.translateX}px, ${this.translateY}px) scale(${this.scale})`;
            this.canvas.style.transform = value;
            this.stage.classList.toggle('is-zoomed', this.scale > 1);
            this.stage.classList.toggle('is-dragging', this.isDragging);
        }

        clampTranslate() {
            if (!this.stage || this.scale <= 1) {
                this.translateX = 0;
                this.translateY = 0;
                return;
            }
            const rect = this.stage.getBoundingClientRect();
            const maxX = (rect.width * (this.scale - 1)) / 2 + 48;
            const maxY = (rect.height * (this.scale - 1)) / 2 + 48;
            this.translateX = Math.max(-maxX, Math.min(maxX, this.translateX));
            this.translateY = Math.max(-maxY, Math.min(maxY, this.translateY));
        }

        onPointerDown(e) {
            if (!this.isOpen) return;
            this.stage.setPointerCapture(e.pointerId);
            this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            this.pointerMoved = false;
            this.pointerDownX = e.clientX;
            this.pointerDownY = e.clientY;

            if (this.activePointers.size === 2) {
                this.pinchStartDistance = this.getPointerDistance();
                this.pinchStartScale = this.scale;
                this.isDragging = false;
                return;
            }

            if (this.scale > 1) {
                this.isDragging = true;
                this.dragStartX = e.clientX;
                this.dragStartY = e.clientY;
                this.dragOriginX = this.translateX;
                this.dragOriginY = this.translateY;
            }
        }

        onPointerMove(e) {
            if (!this.isOpen || !this.activePointers.has(e.pointerId)) return;
            this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

            if (Math.hypot(e.clientX - this.pointerDownX, e.clientY - this.pointerDownY) > 6) {
                this.pointerMoved = true;
            }

            if (this.activePointers.size === 2) {
                const distance = this.getPointerDistance();
                if (this.pinchStartDistance > 0) {
                    this.setScale(this.pinchStartScale * (distance / this.pinchStartDistance));
                }
                return;
            }

            if (!this.isDragging || this.scale <= 1) return;
            e.preventDefault();
            this.translateX = this.dragOriginX + (e.clientX - this.dragStartX);
            this.translateY = this.dragOriginY + (e.clientY - this.dragStartY);
            this.clampTranslate();
            this.applyTransform();
        }

        onPointerUp(e) {
            this.activePointers.delete(e.pointerId);
            if (this.activePointers.size < 2) {
                this.pinchStartDistance = 0;
            }
            if (this.activePointers.size === 0) {
                this.isDragging = false;
                this.applyTransform();
            }
            try {
                this.stage.releasePointerCapture(e.pointerId);
            } catch {
                // ignore
            }
        }

        getPointerDistance() {
            const points = Array.from(this.activePointers.values());
            if (points.length < 2) return 0;
            return Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
        }
    }

    class ProductImageZoom {
        constructor(options = {}) {
            this.getImages = options.getImages || (() => []);
            this.resolveUrl = options.resolveUrl || ((url) => url);
            this.getActiveIndex = options.getActiveIndex || (() => 0);

            this.lightbox = new ProductImageLightbox({
                getImages: this.getImages,
                resolveUrl: this.resolveUrl,
                getActiveIndex: this.getActiveIndex,
            });

            this.hoverZoom = new AmazonHoverZoom({
                resolveUrl: this.resolveUrl,
                onRequestLightbox: () => this.open(this.getActiveIndex()),
            });

            this._mq = window.matchMedia(DESKTOP_MQ);
            this._onMqChange = () => this._syncMode();
            if (this._mq.addEventListener) {
                this._mq.addEventListener('change', this._onMqChange);
            } else {
                this._mq.addListener(this._onMqChange);
            }
        }

        bindMainImage(mainImage) {
            this.boundMainImage = mainImage;
            this.hoverZoom.bindMainImage(mainImage);
            this._syncMode(mainImage);
        }

        _syncMode(mainImage = this.boundMainImage) {
            if (!mainImage) return;

            mainImage.onclick = null;
            if (!prefersHoverZoom()) {
                mainImage.onclick = (e) => {
                    if (isPlaceholderSrc(mainImage.src)) return;
                    e.preventDefault();
                    this.open(this.getActiveIndex());
                };
            }
        }

        refresh() {
            this.hoverZoom.refresh();
        }

        open(index) {
            this.lightbox.open(index);
        }

        bindMainImageFromDetail(mainImage) {
            this.bindMainImage(mainImage);
        }
    }

    window.HMProductImageZoom = ProductImageZoom;
})();
