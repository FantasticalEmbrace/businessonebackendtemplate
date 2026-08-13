/**
 * Normalize long product descriptions for display (storefront + admin preview).
 * Renders real HTML from hmherbs; plain text stays plain with paragraph breaks only at display time.
 */
(function (global) {
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = String(text ?? '');
        return div.innerHTML;
    }

    function decodeHtmlEntities(str) {
        if (!str) return '';
        let s = String(str).trim();
        if (!/&lt;|&gt;|&amp;|&#\d+;|&#x[\da-f]+;/i.test(s)) return s;
        const ta = document.createElement('textarea');
        ta.innerHTML = s;
        return ta.value.trim();
    }

    function looksLikeHtml(str) {
        return /<[a-z][\s\S]*>/i.test(String(str || '').trim());
    }

    function normalizeDisclaimerCheck(text) {
        return String(text || '')
            .toLowerCase()
            .replace(/&amp;/g, '&')
            .replace(/[^a-z0-9&]+/g, ' ')
            .trim();
    }

    /** FDA supplement disclaimer duplicated in many imported descriptions */
    function isFdaDisclaimerText(text) {
        const t = normalizeDisclaimerCheck(text);
        if (!t || !t.includes('not been evaluated')) return false;
        if (!(t.includes('food and drug') || t.includes('food drug'))) return false;
        return t.includes('diagnose') || t.includes('intended to');
    }

    function stripInlineDisclaimerText(text) {
        return String(text || '')
            .replace(
                /\s*(?:\*?\s*)?(?:DISCLAIMER:?\s*)?These\s+statements\s+have\s+not\s+been\s+evaluated[\s\S]{0,240}?prevent\s+any\s+disease\.?\s*/gi,
                ''
            )
            .trim();
    }

    function stripFdaDisclaimer(raw) {
        let s = decodeHtmlEntities(String(raw || '').trim());
        if (!s) return '';

        if (looksLikeHtml(s)) {
            const root = document.createElement('div');
            root.innerHTML = s;
            root.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li, section, article, blockquote').forEach((el) => {
                if (isFdaDisclaimerText(el.textContent)) {
                    el.remove();
                    return;
                }
                const cleaned = stripInlineDisclaimerText(el.innerHTML);
                if (cleaned !== el.innerHTML) el.innerHTML = cleaned;
            });
            Array.from(root.childNodes).forEach((node) => {
                if (node.nodeType === Node.TEXT_NODE && isFdaDisclaimerText(node.textContent)) {
                    node.remove();
                }
            });
            s = root.innerHTML.trim();
        } else {
            const paragraphs = s.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
            if (paragraphs.length > 1) {
                s = paragraphs
                    .filter((p) => !isFdaDisclaimerText(p))
                    .map((p) => stripInlineDisclaimerText(p))
                    .join('\n\n')
                    .trim();
            } else {
                s = s
                    .split(/\n/)
                    .map((line) => line.trim())
                    .filter((line) => line && !isFdaDisclaimerText(line))
                    .map((line) => stripInlineDisclaimerText(line))
                    .join('\n')
                    .trim();
            }
        }

        return stripInlineDisclaimerText(
            s.replace(
                /(?:<p[^>]*>\s*)?(?:<strong>\s*)?DISCLAIMER:?\s*(?:<\/strong>)?[\s\S]*?prevent any disease\.?\s*(?:<\/p>)?\s*$/i,
                ''
            )
        )
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    function blockTags() {
        return new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TR', 'BLOCKQUOTE', 'SECTION', 'ARTICLE']);
    }

    /** Convert stored HTML into plain text for merchant editing. */
    function htmlToPlainText(raw) {
        let s = stripFdaDisclaimer(decodeHtmlEntities(String(raw || '').trim()));
        if (!s) return '';
        if (!looksLikeHtml(s)) return s;

        const root = document.createElement('div');
        root.innerHTML = s;

        const lines = [];
        const pushLine = (text) => {
            const t = String(text || '').replace(/\s+/g, ' ').trim();
            if (t) lines.push(t);
        };

        function walk(node) {
            if (!node) return;
            if (node.nodeType === Node.TEXT_NODE) {
                pushLine(node.textContent);
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return;

            const tag = node.tagName;
            if (tag === 'BR') {
                lines.push('');
                return;
            }

            if (blockTags().has(tag)) {
                const text = node.textContent.replace(/\s+/g, ' ').trim();
                if (text) {
                    if (lines.length && lines[lines.length - 1] !== '') lines.push('');
                    pushLine(text);
                    lines.push('');
                }
                return;
            }

            Array.from(node.childNodes).forEach(walk);
        }

        Array.from(root.childNodes).forEach(walk);

        return lines
            .join('\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();
    }

    /** Convert merchant plain text back to HTML for storage / storefront. */
    function prepareLongDescriptionForSave(raw) {
        const s = String(raw || '').trim();
        if (!s) return '';
        if (looksLikeHtml(s)) {
            return formatLongDescriptionForDisplay(htmlToPlainText(s));
        }
        return formatLongDescriptionForDisplay(s);
    }

    function sanitizeDisplayHtml(html) {
        const allowedTags = new Set([
            'P', 'DIV', 'SPAN', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'UL', 'OL', 'LI',
            'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'A', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH',
            'BLOCKQUOTE', 'SECTION', 'ARTICLE', 'SUP', 'SUB', 'HR'
        ]);
        const allowedAttrs = new Set(['href', 'src', 'alt', 'title', 'class', 'colspan', 'rowspan', 'target', 'rel']);

        const root = document.createElement('div');
        root.innerHTML = String(html || '');

        function walk(node) {
            if (!node) return;
            if (node.nodeType === Node.ELEMENT_NODE) {
                const tag = node.tagName;
                if (!allowedTags.has(tag)) {
                    const parent = node.parentNode;
                    if (parent) {
                        while (node.firstChild) parent.insertBefore(node.firstChild, node);
                        parent.removeChild(node);
                    }
                    return;
                }
                Array.from(node.attributes).forEach((attr) => {
                    const name = attr.name.toLowerCase();
                    const value = String(attr.value || '');
                    if (name.startsWith('on') || name === 'style' || name === 'srcdoc') {
                        node.removeAttribute(attr.name);
                        return;
                    }
                    if (!allowedAttrs.has(name)) {
                        node.removeAttribute(attr.name);
                        return;
                    }
                    if ((name === 'href' || name === 'src') && /^\s*(javascript|data):/i.test(value)) {
                        node.removeAttribute(attr.name);
                    }
                });
            }
            const children = node.childNodes ? Array.from(node.childNodes) : [];
            children.forEach(walk);
        }

        walk(root);
        return root.innerHTML.trim();
    }

    function formatLongDescriptionForDisplay(raw) {
        let s = stripFdaDisclaimer(decodeHtmlEntities(String(raw || '').trim()));
        if (!s) return '';

        if (looksLikeHtml(s)) {
            return sanitizeDisplayHtml(s);
        }

        const blocks = s.split(/\n\s*\n/).filter((p) => p.trim());
        if (blocks.length > 1) {
            return blocks.map((p) => `<p>${escapeHtml(p.trim())}</p>`).join('');
        }

        const lines = s.split(/\n/).filter((p) => p.trim());
        if (lines.length > 1) {
            return lines.map((p) => `<p>${escapeHtml(p.trim())}</p>`).join('');
        }

        return `<p>${escapeHtml(s)}</p>`;
    }

    const api = {
        escapeHtml,
        decodeHtmlEntities,
        looksLikeHtml,
        isFdaDisclaimerText,
        stripFdaDisclaimer,
        htmlToPlainText,
        prepareLongDescriptionForSave,
        formatLongDescriptionForDisplay
    };

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    } else {
        global.HMDescriptionHtml = api;
    }
})(typeof window !== 'undefined' ? window : global);
