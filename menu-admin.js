// Business One Menu Admin - JavaScript

const API_BASE_URL = (() => {
    if (typeof window !== 'undefined' && typeof window.hmHerbsStorefrontApiBase === 'function') {
        const origin = window.hmHerbsStorefrontApiBase();
        return origin || window.location.origin;
    }
    const h = window.location.hostname;
    const isLoopback = h === 'localhost' || h === '127.0.0.1';
    if (isLoopback && window.location.port !== '3001') return 'http://localhost:3001';
    return window.location.origin;
})();

const AUTH_STORAGE_KEY = 'adminToken';

let currentEditingItemId = null;

function getAdminToken() {
    return sessionStorage.getItem(AUTH_STORAGE_KEY) || localStorage.getItem(AUTH_STORAGE_KEY) || '';
}

function setAdminToken(token) {
    sessionStorage.setItem(AUTH_STORAGE_KEY, token);
}

function adminFetch(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    const token = getAdminToken();
    if (token) headers.Authorization = `Bearer ${token}`;
    if (options.body && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }
    return fetch(`${API_BASE_URL}${path}`, { ...options, headers });
}

function showMenuAdminApp() {
    document.getElementById('menu-admin-login')?.setAttribute('hidden', '');
    const app = document.getElementById('menu-admin-app');
    if (app) app.hidden = false;
}

function showMenuAdminLogin(message = '') {
    const app = document.getElementById('menu-admin-app');
    if (app) app.hidden = true;
    const overlay = document.getElementById('menu-admin-login');
    if (overlay) overlay.removeAttribute('hidden');
    const err = document.getElementById('menu-admin-login-error');
    if (err) err.textContent = message || '';
}

async function loginMenuAdmin() {
    const email = document.getElementById('menu-admin-email')?.value?.trim();
    const password = document.getElementById('menu-admin-password')?.value || '';
    const err = document.getElementById('menu-admin-login-error');
    if (!email || !password) {
        if (err) err.textContent = 'Email and password are required.';
        return;
    }
    if (err) err.textContent = '';
    try {
        const res = await fetch(`${API_BASE_URL}/api/admin/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Login failed');
        setAdminToken(data.token);
        showMenuAdminApp();
        loadMenuItems();
        loadApiKeys();
    } catch (e) {
        if (err) err.textContent = e.message || 'Login failed';
    }
}

function parseFeaturesForForm(value) {
    if (!value) return '';
    if (Array.isArray(value)) return value.join('\n');
    try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        return Array.isArray(parsed) ? parsed.join('\n') : '';
    } catch {
        return '';
    }
}

async function parseMenuAdminResponse(response) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 401 || response.status === 403) {
        showMenuAdminLogin(data.error || 'Session expired. Sign in again.');
        throw new Error(data.error || 'Unauthorized');
    }
    if (!response.ok) {
        throw new Error(data.error || `Request failed (${response.status})`);
    }
    return data;
}

function escapeHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Branded dialogs — styled with this page's own .modal / .btn classes so they
// match the site design instead of using unstyleable native alert()/confirm().
function menuShowDialog({ title = '', message = '', buttons = [] }) {
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.className = 'modal active';
        overlay.style.zIndex = '2000';

        const content = document.createElement('div');
        content.className = 'modal-content';
        content.style.maxWidth = '440px';
        content.setAttribute('role', 'dialog');
        content.setAttribute('aria-modal', 'true');

        if (title) {
            const header = document.createElement('div');
            header.className = 'modal-header';
            const h = document.createElement('h2');
            h.textContent = title;
            header.appendChild(h);
            content.appendChild(header);
        }

        const body = document.createElement('div');
        body.className = 'modal-body';
        const p = document.createElement('p');
        p.textContent = message;
        p.style.cssText = 'margin:0 0 1.5rem;white-space:pre-line;line-height:1.55;';
        body.appendChild(p);

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:0.75rem;justify-content:flex-end;flex-wrap:wrap;';

        const cancelValue = () => {
            const c = buttons.find((b) => b.cancel);
            return c ? c.value : false;
        };
        const cleanup = (val) => {
            document.removeEventListener('keydown', onKey);
            overlay.remove();
            resolve(val);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') {
                e.preventDefault();
                cleanup(cancelValue());
            }
        };

        buttons.forEach((b) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'btn ' + (b.className || 'btn-primary');
            btn.textContent = b.label;
            btn.addEventListener('click', () => cleanup(b.value));
            btnRow.appendChild(btn);
        });

        body.appendChild(btnRow);
        content.appendChild(body);
        overlay.appendChild(content);
        overlay.addEventListener('mousedown', (e) => {
            if (e.target === overlay) cleanup(cancelValue());
        });
        document.addEventListener('keydown', onKey);
        document.body.appendChild(overlay);
        const focusBtn = btnRow.querySelector('.btn-primary') || btnRow.querySelector('button');
        if (focusBtn) focusBtn.focus();
    });
}

function menuAlert(message, { title = 'Notice' } = {}) {
    return menuShowDialog({
        title,
        message,
        buttons: [{ label: 'OK', value: true, className: 'btn-primary' }],
    });
}

function menuConfirm(
    message,
    { title = 'Please confirm', confirmLabel = 'Confirm', cancelLabel = 'Cancel', danger = false } = {}
) {
    return menuShowDialog({
        title,
        message,
        buttons: [
            { label: cancelLabel, value: false, className: 'btn-secondary', cancel: true },
            { label: confirmLabel, value: true, className: danger ? 'btn-danger' : 'btn-primary' },
        ],
    });
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    setupTabs();
    setupEventListeners();
    document.getElementById('menu-admin-login-btn')?.addEventListener('click', loginMenuAdmin);
    document.getElementById('menu-admin-password')?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') loginMenuAdmin();
    });
    if (getAdminToken()) {
        showMenuAdminApp();
        loadMenuItems();
        loadApiKeys();
    } else {
        showMenuAdminLogin();
    }
});

// Tab Switching
function setupTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;
            
            // Update buttons
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Update content
            tabContents.forEach(content => {
                content.classList.remove('active');
                if (content.id === `${tabName}-tab`) {
                    content.classList.add('active');
                }
            });
        });
    });
}

// Event Listeners
function setupEventListeners() {
    // Menu Item Modal
    document.getElementById('addMenuItemBtn').addEventListener('click', () => {
        openMenuItemModal();
    });

    document.getElementById('closeMenuItemModal').addEventListener('click', closeMenuItemModal);
    document.getElementById('cancelMenuItemBtn').addEventListener('click', closeMenuItemModal);

    document.getElementById('menuItemForm').addEventListener('submit', handleMenuItemSubmit);

    // API Key Modal
    document.getElementById('addApiKeyBtn').addEventListener('click', () => {
        openApiKeyModal();
    });

    document.getElementById('closeApiKeyModal').addEventListener('click', closeApiKeyModal);
    document.getElementById('cancelApiKeyBtn').addEventListener('click', closeApiKeyModal);
    document.getElementById('apiKeyForm').addEventListener('submit', handleApiKeySubmit);

    // API Key Display Modal
    document.getElementById('closeApiKeyDisplayModal').addEventListener('click', closeApiKeyDisplayModal);
    document.getElementById('closeApiKeyDisplayBtn').addEventListener('click', closeApiKeyDisplayModal);
    document.getElementById('copyApiKeyBtn').addEventListener('click', copyApiKey);

    // Close modals on outside click
    document.querySelectorAll('.modal').forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
            }
        });
    });
}

// Menu Items
async function loadMenuItems() {
    const tbody = document.getElementById('menuItemsTableBody');
    tbody.innerHTML = '<tr><td colspan="6" class="loading">Loading menu items...</td></tr>';

    try {
        const response = await adminFetch('/api/menu/admin/items');
        const data = await parseMenuAdminResponse(response);

        if (data.success && data.items) {
            renderMenuItems(data.items);
        } else {
            tbody.innerHTML = '<tr><td colspan="6" class="loading">Error loading menu items</td></tr>';
        }
    } catch (error) {
        console.error('Error loading menu items:', error);
        tbody.innerHTML = '<tr><td colspan="6" class="loading">Error: ' + escapeHtml(error.message) + '</td></tr>';
    }
}

function renderMenuItems(items) {
    const tbody = document.getElementById('menuItemsTableBody');
    
    if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="loading">No menu items found. Add your first item!</td></tr>';
        return;
    }

    tbody.innerHTML = items.map(item => `
        <tr>
            <td><code>${escapeHtml(item.item_id)}</code></td>
            <td><strong>${escapeHtml(item.name)}</strong></td>
            <td>${escapeHtml(item.category || '-')}</td>
            <td>${escapeHtml(item.display_order)}</td>
            <td>
                <span class="status-badge ${item.is_active ? 'active' : 'inactive'}">
                    ${item.is_active ? 'Active' : 'Inactive'}
                </span>
            </td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-sm btn-secondary" onclick="editMenuItem(${item.id})">Edit</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteMenuItem(${item.id})">Delete</button>
                </div>
            </td>
        </tr>
    `).join('');
}

function openMenuItemModal(item = null) {
    const modal = document.getElementById('menuItemModal');
    const form = document.getElementById('menuItemForm');
    const title = document.getElementById('menuItemModalTitle');
    
    if (item) {
        title.textContent = 'Edit Menu Item';
        currentEditingItemId = item.id;
        
        document.getElementById('menuItemId').value = item.id;
        document.getElementById('itemId').value = item.item_id;
        document.getElementById('itemName').value = item.name;
        document.getElementById('itemDescription').value = item.description || '';
        document.getElementById('itemOverview').value = item.overview || '';
        document.getElementById('itemFeatures').value = parseFeaturesForForm(item.features_json);
        document.getElementById('itemIconClass').value = item.icon_class || '';
        document.getElementById('itemCategory').value = item.category || '';
        document.getElementById('itemPrice').value = item.price || '';
        document.getElementById('itemImageUrl').value = item.image_url || '';
        document.getElementById('itemDisplayOrder').value = item.display_order || 0;
        document.getElementById('itemIsActive').checked = Boolean(item.is_active);
        
        document.getElementById('itemId').disabled = true;
    } else {
        title.textContent = 'Add Menu Item';
        currentEditingItemId = null;
        form.reset();
        document.getElementById('itemId').disabled = false;
    }
    
    modal.classList.add('active');
}

function closeMenuItemModal() {
    document.getElementById('menuItemModal').classList.remove('active');
    document.getElementById('menuItemForm').reset();
    currentEditingItemId = null;
}

async function handleMenuItemSubmit(e) {
    e.preventDefault();
    
    const formData = {
        item_id: document.getElementById('itemId').value,
        name: document.getElementById('itemName').value,
        description: document.getElementById('itemDescription').value,
        overview: document.getElementById('itemOverview').value,
        features_json: document.getElementById('itemFeatures').value,
        icon_class: document.getElementById('itemIconClass').value,
        price: document.getElementById('itemPrice').value || null,
        image_url: document.getElementById('itemImageUrl').value || null,
        category: document.getElementById('itemCategory').value || null,
        display_order: parseInt(document.getElementById('itemDisplayOrder').value) || 0,
        is_active: document.getElementById('itemIsActive').checked ? 1 : 0
    };
    
    try {
        let response;
        if (currentEditingItemId) {
            // Update
            response = await adminFetch(`/api/menu/admin/items/${currentEditingItemId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
        } else {
            // Create
            response = await adminFetch('/api/menu/admin/items', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(formData)
            });
        }
        
        const data = await parseMenuAdminResponse(response);
        
        if (data.success) {
            closeMenuItemModal();
            loadMenuItems();
            menuAlert('Menu item saved successfully!', { title: 'Success' });
        } else {
            menuAlert(data.error || 'Failed to save menu item', { title: 'Error' });
        }
    } catch (error) {
        console.error('Error saving menu item:', error);
        menuAlert(error.message, { title: 'Error' });
    }
}

async function editMenuItem(id) {
    try {
        const response = await adminFetch('/api/menu/admin/items');
        const data = await parseMenuAdminResponse(response);
        
        if (data.success && data.items) {
            const item = data.items.find(i => i.id === id);
            if (item) {
                openMenuItemModal(item);
            }
        }
    } catch (error) {
        console.error('Error loading menu item:', error);
        menuAlert('Error loading menu item', { title: 'Error' });
    }
}

async function deleteMenuItem(id) {
    const confirmedDelete = await menuConfirm('Are you sure you want to delete this menu item?', {
        title: 'Delete menu item',
        confirmLabel: 'Delete',
        danger: true,
    });
    if (!confirmedDelete) {
        return;
    }
    
    try {
        const response = await adminFetch(`/api/menu/admin/items/${id}`, {
            method: 'DELETE'
        });
        
        const data = await parseMenuAdminResponse(response);
        
        if (data.success) {
            loadMenuItems();
            menuAlert('Menu item deleted successfully!', { title: 'Success' });
        } else {
            menuAlert(data.error || 'Failed to delete menu item', { title: 'Error' });
        }
    } catch (error) {
        console.error('Error deleting menu item:', error);
        menuAlert(error.message, { title: 'Error' });
    }
}

// API Keys
async function loadApiKeys() {
    const tbody = document.getElementById('apiKeysTableBody');
    tbody.innerHTML = '<tr><td colspan="6" class="loading">Loading API keys...</td></tr>';

    try {
        const response = await adminFetch('/api/menu/admin/keys');
        const data = await parseMenuAdminResponse(response);

        if (data.success && data.keys) {
            renderApiKeys(data.keys);
        } else {
            tbody.innerHTML = '<tr><td colspan="6" class="loading">Error loading API keys</td></tr>';
        }
    } catch (error) {
        console.error('Error loading API keys:', error);
        tbody.innerHTML = '<tr><td colspan="6" class="loading">Error: ' + escapeHtml(error.message) + '</td></tr>';
    }
}

function renderApiKeys(keys) {
    const tbody = document.getElementById('apiKeysTableBody');
    
    if (keys.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="loading">No API keys found. Generate your first key!</td></tr>';
        return;
    }

    tbody.innerHTML = keys.map(key => `
        <tr>
            <td><strong>${escapeHtml(key.name)}</strong></td>
            <td><code>${key.api_key ? escapeHtml(key.api_key.substring(0, 20) + '...') : 'N/A'}</code></td>
            <td>
                <span class="status-badge ${key.is_active ? 'active' : 'inactive'}">
                    ${key.is_active ? 'Active' : 'Inactive'}
                </span>
            </td>
            <td>${formatDate(key.created_at)}</td>
            <td>${key.last_used_at ? formatDate(key.last_used_at) : 'Never'}</td>
            <td>
                <div class="action-buttons">
                    <button class="btn btn-sm ${key.is_active ? 'btn-secondary' : 'btn-success'}" 
                            onclick="toggleApiKey(${key.id}, ${!key.is_active})">
                        ${key.is_active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button class="btn btn-sm btn-danger" onclick="deleteApiKey(${key.id})">Delete</button>
                </div>
            </td>
        </tr>
    `).join('');
}

function openApiKeyModal() {
    document.getElementById('apiKeyModal').classList.add('active');
    document.getElementById('apiKeyForm').reset();
}

function closeApiKeyModal() {
    document.getElementById('apiKeyModal').classList.remove('active');
}

async function handleApiKeySubmit(e) {
    e.preventDefault();
    
    const name = document.getElementById('apiKeyName').value;
    
    try {
        const response = await adminFetch('/api/menu/admin/keys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        
        const data = await parseMenuAdminResponse(response);
        
        if (data.success && data.apiKey) {
            closeApiKeyModal();
            showApiKeyDisplay(data.apiKey);
            loadApiKeys();
        } else {
            menuAlert(data.error || 'Failed to generate API key', { title: 'Error' });
        }
    } catch (error) {
        console.error('Error generating API key:', error);
        menuAlert(error.message, { title: 'Error' });
    }
}

function showApiKeyDisplay(apiKey) {
    document.getElementById('generatedApiKey').textContent = apiKey;
    document.getElementById('apiKeyDisplayModal').classList.add('active');
}

function closeApiKeyDisplayModal() {
    document.getElementById('apiKeyDisplayModal').classList.remove('active');
}

function copyApiKey() {
    const apiKey = document.getElementById('generatedApiKey').textContent;
    navigator.clipboard.writeText(apiKey).then(() => {
        const btn = document.getElementById('copyApiKeyBtn');
        const originalText = btn.textContent;
        btn.textContent = 'Copied!';
        btn.classList.add('btn-success');
        setTimeout(() => {
            btn.textContent = originalText;
            btn.classList.remove('btn-success');
        }, 2000);
    }).catch(() => {
        menuAlert('Could not copy to clipboard. Select the key and copy manually.', { title: 'Copy failed' });
    });
}

async function toggleApiKey(id, isActive) {
    try {
        const response = await adminFetch(`/api/menu/admin/keys/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ is_active: isActive ? 1 : 0 })
        });
        
        const data = await parseMenuAdminResponse(response);
        
        if (data.success) {
            loadApiKeys();
        } else {
            menuAlert(data.error || 'Failed to update API key', { title: 'Error' });
        }
    } catch (error) {
        console.error('Error updating API key:', error);
        menuAlert(error.message, { title: 'Error' });
    }
}

async function deleteApiKey(id) {
    const confirmedKeyDelete = await menuConfirm(
        'Are you sure you want to delete this API key? This action cannot be undone.',
        { title: 'Delete API key', confirmLabel: 'Delete', danger: true }
    );
    if (!confirmedKeyDelete) {
        return;
    }
    
    try {
        const response = await adminFetch(`/api/menu/admin/keys/${id}`, {
            method: 'DELETE'
        });
        
        const data = await parseMenuAdminResponse(response);
        
        if (data.success) {
            loadApiKeys();
            menuAlert('API key deleted successfully!', { title: 'Success' });
        } else {
            menuAlert(data.error || 'Failed to delete API key', { title: 'Error' });
        }
    } catch (error) {
        console.error('Error deleting API key:', error);
        menuAlert(error.message, { title: 'Error' });
    }
}

function formatDate(dateString) {
    if (!dateString) return 'N/A';
    const date = new Date(dateString);
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Make functions globally available
window.editMenuItem = editMenuItem;
window.deleteMenuItem = deleteMenuItem;
window.toggleApiKey = toggleApiKey;
window.deleteApiKey = deleteApiKey;

