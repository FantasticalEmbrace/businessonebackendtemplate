/**

 * Ensures images/products has a canonical JPEG and common missing filenames (e.g. life-ext.jpg).

 * Run at server start and via: node backend/scripts/ensure-product-catalog-images.js

 *

 * The canonical file is a minimal valid JPEG so decoders succeed; replace with real assets in production.

 */

const path = require('path');

const fs = require('fs').promises;



const CANONICAL = 'nature-s-puls-probiotic-mega.jpg';



const MINIMAL_JPEG = Buffer.from(

    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCwAA8A/9k=',

    'base64'

);



/** Always ensure these exist if missing or 0-byte (DB often references them). */

const REQUIRED_ALIASES = ['life-ext.jpg'];



/**

 * @param {string} projectRoot - Repo root (parent of /images)

 * @param {{ info?: Function, warn?: Function }} [log]

 */

async function ensureProductCatalogImages(projectRoot, log = console) {

    const info = typeof log.info === 'function' ? log.info.bind(log) : console.log;

    const dir = path.join(projectRoot, 'images', 'products');

    await fs.mkdir(dir, { recursive: true });



    const canonicalPath = path.join(dir, CANONICAL);

    let writeCanonical = false;

    try {

        const st = await fs.stat(canonicalPath);

        if (!st.isFile() || st.size === 0) {

            writeCanonical = true;

        }

    } catch {

        writeCanonical = true;

    }

    if (writeCanonical) {

        await fs.writeFile(canonicalPath, MINIMAL_JPEG);

        info(

            `[catalog images] Wrote placeholder ${CANONICAL} under images/products/ — replace with a real product photo when available.`

        );

    }



    for (const name of REQUIRED_ALIASES) {

        const dest = path.join(dir, name);

        let needCopy = false;

        try {

            const st = await fs.stat(dest);

            if (!st.isFile() || st.size === 0) {

                needCopy = true;

            }

        } catch {

            needCopy = true;

        }

        if (needCopy) {

            await fs.copyFile(canonicalPath, dest);

            info(`[catalog images] Restored ${name} from ${CANONICAL}`);

        }

    }



    let entries;

    try {

        entries = await fs.readdir(dir);

    } catch {

        return;

    }

    for (const name of entries) {

        if (!/^life-ext.*\.jpe?g$/i.test(name)) {

            continue;

        }

        const dest = path.join(dir, name);

        try {

            const st = await fs.stat(dest);

            if (st.isFile() && st.size === 0) {

                await fs.copyFile(canonicalPath, dest);

                info(`[catalog images] Repaired empty file: ${name}`);

            }

        } catch {

            // ignore

        }

    }

}



module.exports = { ensureProductCatalogImages, CANONICAL, MINIMAL_JPEG };


