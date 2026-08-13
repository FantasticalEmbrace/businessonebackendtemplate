'use strict';

const { CATALOG_BY_TYPE, findModel, getModelFields, fieldVisible, fieldRequired } = require('../services/posHardwareCatalog');

function audit() {
    const problems = [];
    let modelCount = 0;

    for (const [equipmentType, typeCatalog] of Object.entries(CATALOG_BY_TYPE)) {
        for (const [brandId, brand] of Object.entries(typeCatalog.brands)) {
            for (const [modelKey, modelDef] of Object.entries(brand.models)) {
                modelCount++;
                const id = modelDef.id;
                const { configFields } = getModelFields(id);
                if (!configFields.length) {
                    problems.push(`${id} (${equipmentType}/${brandId}/${modelKey}): no configFields`);
                    continue;
                }
                const def = findModel(id);
                if (!def) {
                    problems.push(`${id}: findModel miss`);
                }
                const sampleConfigs = [
                    {},
                    { connection: 'network' },
                    { connection: 'usb' },
                    { connection: 'integrated' },
                    { connection: 'ethernet' },
                    { connection: 'wifi' },
                    { connection: 'semi_integrated' },
                    { connection: 'serial' },
                    { mode: 'browser' },
                    { mode: 'hdmi' },
                    { mode: 'pole' }
                ];
                for (const cfg of sampleConfigs) {
                    cfg.catalogModelId = id;
                    for (const field of configFields) {
                        if (fieldRequired(field, cfg) && fieldVisible(field, cfg)) {
                            /* ok - field can be required in some states */
                        }
                    }
                }
            }
        }
    }

    return { modelCount, problems };
}

const { modelCount, problems } = audit();
if (problems.length) {
    console.error(`Hardware catalog audit FAILED (${problems.length} issues, ${modelCount} models):`);
    problems.forEach((p) => console.error(' -', p));
    process.exit(1);
}
console.log(`Hardware catalog audit OK — ${modelCount} models, all have configFields.`);
