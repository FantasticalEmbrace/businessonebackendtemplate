const { stripBrandPrefix } = require('./strip-brand-from-product-names');

const samples = [
    ['Newton Labs Allergies', 'Newton Labs', 'newton-labs', 'Allergies'],
    ['NOW Foods Vitamin D-3 1000 IU', 'NOW Foods', 'now-foods', 'Vitamin D-3 1000 IU'],
    ["Nature's Way Sambucus Elderberry", "Nature's Way", 'natures-way', 'Sambucus Elderberry'],
    ['Allergies', 'Newton Labs', 'newton-labs', null],
    ['Newton Homeopathics Kids Allergies', 'Newton Homeopathics', 'newton-homeopathics', 'Kids Allergies']
];

let failed = 0;
for (const [name, brand, slug, expected] of samples) {
    const actual = stripBrandPrefix(name, brand, slug);
    const ok = actual === expected;
    if (!ok) failed++;
    console.log(`${ok ? 'OK' : 'FAIL'}: ${name} -> ${actual || '(no change)'}${expected ? ` (expected: ${expected})` : ''}`);
}
process.exit(failed ? 1 : 0);
