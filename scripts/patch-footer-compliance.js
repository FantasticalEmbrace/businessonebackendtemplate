#!/usr/bin/env node
'use strict';
const fs = require('fs');
const path = require('path');

const repo = path.resolve(__dirname, '..');
const files = [
  'index.html', 'product.html', 'products.html', 'about.html', 'checkout.html',
  'privacy-policy.html', 'shipping-returns.html', 'gift-cards.html',
  'ccpa-privacy-rights.html', 'categories.html', 'brands.html',
  'terms-and-conditions.html', 'coa.html'
];

const infoOld1 = `                <div class="footer-section footer-info-section">
                    <h4>Information</h4>
                    <ul>
                        <li><a href="about.html">About Us</a></li>
                        <li><a href="shipping-returns.html">Shipping & Returns</a></li>
                        <li><a href="#contact">Contact Us</a></li>
                    </ul>
                </div>`;

const infoOld2 = infoOld1.replace('#contact', 'index.html#contact');

const infoNew = `                <div class="footer-section footer-info-section">
                    <h4>Information</h4>
                    <ul>
                        <li><a href="about.html">About Us</a></li>
                        <li><a href="privacy-policy.html">Privacy Policy</a></li>
                        <li><a href="terms-and-conditions.html">Terms &amp; Conditions</a></li>
                        <li><a href="shipping-returns.html#shipping-policy">Shipping Policy</a></li>
                        <li><a href="shipping-returns.html#refund-policy">Refund Policy</a></li>
                        <li><a href="coa.html">Lab Results (COA)</a></li>
                        <li><a href="index.html#contact">Contact Us</a></li>
                    </ul>
                </div>`;

const linksOld = `                    <div class="footer-bottom-links">
                        <a href="ccpa-privacy-rights.html">Do Not Sell My Personal Information</a>
                        <span class="separator">|</span>
                        <button id="cookie-preferences" class="link-button">Cookie Preferences</button>
                        <span class="separator">|</span>
                        <a href="admin.html" class="admin-link">Admin</a>
                    </div>`;

const linksOldCats = `                    <div class="footer-bottom-links">
                        <a href="privacy-policy.html">Privacy Policy</a>
                        <span class="separator">|</span>
                        <a href="terms-and-conditions.html">Terms &amp; Conditions</a>
                        <span class="separator">|</span>
                        <a href="ccpa-privacy-rights.html">Do Not Sell My Personal Information</a>
                        <span class="separator">|</span>
                        <button id="cookie-preferences" class="link-button">Cookie Preferences</button>
                        <span class="separator">|</span>
                        <a href="admin.html" class="admin-link">Admin</a>
                    </div>`;

const linksNew = `                    <div class="footer-bottom-links">
                        <a href="privacy-policy.html">Privacy Policy</a>
                        <span class="separator">|</span>
                        <a href="terms-and-conditions.html">Terms &amp; Conditions</a>
                        <span class="separator">|</span>
                        <a href="shipping-returns.html#shipping-policy">Shipping Policy</a>
                        <span class="separator">|</span>
                        <a href="shipping-returns.html#refund-policy">Refund Policy</a>
                        <span class="separator">|</span>
                        <a href="coa.html">Lab Results (COA)</a>
                        <span class="separator">|</span>
                        <a href="index.html#contact">Contact Us</a>
                        <span class="separator">|</span>
                        <a href="ccpa-privacy-rights.html">Do Not Sell My Personal Information</a>
                        <span class="separator">|</span>
                        <button id="cookie-preferences" class="link-button">Cookie Preferences</button>
                        <span class="separator">|</span>
                        <a href="admin.html" class="admin-link">Admin</a>
                    </div>`;

const disclaimers = `            <div class="footer-compliance-disclaimers">
                <p class="footer-thc-disclaimer"><strong>Hemp / THC Notice:</strong> Hemp-derived products offered on this site contain no more than 0.3% &Delta;9-THC on a dry weight basis, or as stated on each product&rsquo;s Certificate of Analysis.</p>
                <p class="footer-fda-disclaimer"><strong>FDA Disclaimer:</strong> The statements made regarding these products have not been evaluated by the Food and Drug Administration. The efficacy of these products has not been confirmed by FDA-approved research. These products are not intended to diagnose, treat, cure or prevent any disease. All information presented here is not meant as a substitute for or alternative to information from health care practitioners. Please consult your health care professional about potential interactions or other possible complications before using any product. The Federal Food, Drug, and Cosmetic Act require this notice.</p>
            </div>

`;

const cardLogos = `                <div class="footer-card-logos" aria-label="Accepted payment methods">
                    <ul class="footer-card-logos-list" role="list">
                        <li><img class="footer-card-logo" src="images/payment/visa.svg" width="48" height="16"
                                alt="Visa"></li>
                        <li><img class="footer-card-logo" src="images/payment/mastercard.svg" width="40" height="24"
                                alt="Mastercard"></li>
                        <li><img class="footer-card-logo" src="images/payment/amex.svg" width="40" height="24"
                                alt="American Express"></li>
                        <li><img class="footer-card-logo" src="images/payment/discover.svg" width="48" height="16"
                                alt="Discover"></li>
                    </ul>
                </div>
`;

for (const f of files) {
  const p = path.join(repo, f);
  if (!fs.existsSync(p)) { console.log('SKIP', f); continue; }
  let c = fs.readFileSync(p, 'utf8');
  const orig = c;
  const n = c.replace(/\r\n/g, '\n');

  let u = n;
  if (u.includes(infoOld1)) u = u.replace(infoOld1, infoNew);
  else if (u.includes(infoOld2)) u = u.replace(infoOld2, infoNew);

  if (u.includes(linksOld)) u = u.replace(linksOld, linksNew);
  if (u.includes(linksOldCats)) u = u.replace(linksOldCats, linksNew);

  if (!u.includes('footer-compliance-disclaimers')) {
    u = u.replace('            <!-- Footer Bottom -->\n            <div class="footer-bottom">', '            <!-- Footer Bottom -->\n' + disclaimers + '            <div class="footer-bottom">');
    if (!u.includes('footer-compliance-disclaimers')) {
      u = u.replace('            <div class="footer-bottom">', disclaimers + '            <div class="footer-bottom">');
    }
  }

  if (f === 'categories.html' && !u.includes('footer-card-logos')) {
    u = u.replace('            <div class="footer-bottom">\n                <div class="footer-bottom-content">', '            <div class="footer-bottom">\n' + cardLogos + '                <div class="footer-bottom-content">');
  }

  if (u !== n) {
    fs.writeFileSync(p, u.replace(/\n/g, '\r\n'), 'utf8');
    console.log('UPDATED', f);
  } else {
    console.log('NOCHANGE', f);
  }
}

console.log('Done');
