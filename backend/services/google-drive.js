'use strict';

const { google } = require('googleapis');
const { Readable } = require('stream');
const logger = require('../utils/logger');
const GoogleDriveOAuthService = require('./google-drive-oauth');

const ROOT_FOLDER_NAME = 'Business One';
const JOBS_FOLDER_NAME = 'Jobs';

function isQuotaError(error) {
    const data = error?.response?.data?.error || {};
    const reasons = Array.isArray(data.errors) ? data.errors.map((e) => String(e.reason || '')) : [];
    const msg = String(error?.message || data.message || '').toLowerCase();
    return (
        reasons.some((r) => /storageQuotaExceeded|quotaExceeded/i.test(r)) ||
        msg.includes('storagequotaexceeded') ||
        msg.includes('quota exceeded') ||
        msg.includes('storage quota')
    );
}

function isDriveUnavailableError(error) {
    if (isQuotaError(error)) return true;
    if (error?.code === 'GOOGLE_TOKEN_EXPIRED') return true;
    const status = Number(error?.response?.status || error?.code || 0);
    return status === 401 || status === 403 || status === 429 || status >= 500;
}

class GoogleDriveService {
    async ensureDriveClient(pool, req) {
        return GoogleDriveOAuthService._handleAuthApiCall(pool, async () => {
            const { auth, rootFolderId } = await GoogleDriveOAuthService.getAuthenticatedClient(pool, req);
            const drive = google.drive({ version: 'v3', auth });
            return { drive, rootFolderId };
        });
    }

    async _findChildFolder(drive, parentId, name) {
        const q = [
            `name = '${String(name).replace(/'/g, "\\'")}'`,
            `mimeType = 'application/vnd.google-apps.folder'`,
            `'${parentId}' in parents`,
            'trashed = false'
        ].join(' and ');
        const res = await drive.files.list({
            q,
            fields: 'files(id, name)',
            spaces: 'drive',
            pageSize: 5
        });
        return res.data?.files?.[0] || null;
    }

    async _createFolder(drive, parentId, name) {
        const res = await drive.files.create({
            requestBody: {
                name,
                mimeType: 'application/vnd.google-apps.folder',
                parents: parentId ? [parentId] : undefined
            },
            fields: 'id, name, webViewLink'
        });
        return res.data;
    }

    async _ensureChildFolder(drive, parentId, name) {
        const existing = await this._findChildFolder(drive, parentId, name);
        if (existing?.id) return existing;
        return this._createFolder(drive, parentId, name);
    }

    /**
     * Ensures Business One / Jobs / {jobFolder} [/ {workItemFolder}] and returns leaf folder id.
     */
    async ensureJobFolder(pool, req, { jobLabel, workItemLabel } = {}) {
        return GoogleDriveOAuthService._handleAuthApiCall(pool, async () => {
            const { drive, rootFolderId: storedRoot } = await GoogleDriveOAuthService.getAuthenticatedClient(
                pool,
                req
            );

            let businessRootId = storedRoot;
            if (!businessRootId) {
                // App-owned root at Drive "My Drive"
                const about = await drive.about.get({ fields: 'user,storageQuota' });
                const myDriveRoot = 'root';
                const business = await this._ensureChildFolder(drive, myDriveRoot, ROOT_FOLDER_NAME);
                businessRootId = business.id;
                await GoogleDriveOAuthService.saveRootFolderId(pool, businessRootId);
                logger.info('[integration][google-drive] Created Business One root folder', {
                    folderId: businessRootId,
                    email: about.data?.user?.emailAddress
                });
            }

            const jobsFolder = await this._ensureChildFolder(drive, businessRootId, JOBS_FOLDER_NAME);
            const jobFolderName = String(jobLabel || 'Job').trim() || 'Job';
            const jobFolder = await this._ensureChildFolder(drive, jobsFolder.id, jobFolderName);

            let leaf = jobFolder;
            const wi = String(workItemLabel || '').trim();
            if (wi) {
                leaf = await this._ensureChildFolder(drive, jobFolder.id, wi.slice(0, 120));
            }
            return { drive, folderId: leaf.id, jobFolderId: jobFolder.id };
        });
    }

    /**
     * Upload an image buffer to the merchant Drive. Throws with code DRIVE_FULL or DRIVE_UNAVAILABLE on failure.
     */
    async uploadJobPhoto(pool, req, opts = {}) {
        const {
            buffer,
            mimeType = 'image/jpeg',
            fileName,
            jobLabel,
            workItemLabel,
            caption = ''
        } = opts;

        if (!buffer || !Buffer.isBuffer(buffer)) {
            const err = new Error('No image data');
            err.code = 'DRIVE_UNAVAILABLE';
            throw err;
        }

        try {
            const { drive, folderId } = await this.ensureJobFolder(pool, req, { jobLabel, workItemLabel });
            const name = String(fileName || `photo-${Date.now()}.jpg`).slice(0, 180);
            const stream = Readable.from(buffer);

            const created = await drive.files.create({
                requestBody: {
                    name,
                    parents: [folderId],
                    description: caption ? String(caption).slice(0, 500) : undefined
                },
                media: {
                    mimeType: mimeType || 'image/jpeg',
                    body: stream
                },
                fields: 'id, name, webViewLink, webContentLink, mimeType, size'
            });

            // Best-effort: anyone with link can view (customer portals / share). Failures ignored.
            try {
                await drive.permissions.create({
                    fileId: created.data.id,
                    requestBody: { role: 'reader', type: 'anyone' }
                });
            } catch (permErr) {
                logger.warn('[integration][google-drive] Could not set public reader permission', {
                    error: permErr.message,
                    fileId: created.data.id
                });
            }

            // Re-fetch link after permission change
            let webViewLink = created.data.webViewLink || '';
            try {
                const meta = await drive.files.get({
                    fileId: created.data.id,
                    fields: 'id, webViewLink, webContentLink'
                });
                webViewLink = meta.data.webViewLink || webViewLink;
            } catch {
                /* keep original */
            }

            return {
                driveFileId: created.data.id,
                url: webViewLink || `https://drive.google.com/file/d/${created.data.id}/view`,
                name: created.data.name,
                storage: 'drive'
            };
        } catch (error) {
            if (error?.code === 'GOOGLE_TOKEN_EXPIRED') {
                const err = new Error(error.message);
                err.code = 'DRIVE_UNAVAILABLE';
                err.reason = 'token_expired';
                throw err;
            }
            if (isQuotaError(error)) {
                const err = new Error('Google Drive storage is full');
                err.code = 'DRIVE_FULL';
                err.reason = 'storageQuotaExceeded';
                throw err;
            }
            if (isDriveUnavailableError(error)) {
                const err = new Error(error.message || 'Google Drive unavailable');
                err.code = 'DRIVE_UNAVAILABLE';
                throw err;
            }
            logger.error('[integration][google-drive] Upload failed', { error: error.message });
            const err = new Error(error.message || 'Google Drive upload failed');
            err.code = 'DRIVE_UNAVAILABLE';
            throw err;
        }
    }
}

module.exports = new GoogleDriveService();
module.exports.isQuotaError = isQuotaError;
module.exports.isDriveUnavailableError = isDriveUnavailableError;
