/**
 * Shop Schedule (merchant admin) — same Scheduling calendar grid + Business One styling.
 * Book / edit appointments here (POS Calendar is view-only).
 * Capacity = bays. Technician is optional staff-only; never shown on customer booking.
 * Shop verticals only — ecommerce Scheduling schedule stays on admin-scheduling-calendar.js.
 */
(function () {
    'use strict';

    const YEARS = (() => {
        const y = new Date().getFullYear() + 1;
        const out = [];
        for (let i = 0; i < 30; i++) out.push(String(y - i));
        return out;
    })();

    const MAKES = [
        'Toyota',
        'Honda',
        'Ford',
        'Chevrolet',
        'GMC',
        'Nissan',
        'Jeep',
        'Ram',
        'Subaru',
        'BMW',
        'Mercedes-Benz',
        'Hyundai',
        'Kia',
        'Volkswagen',
        'Mazda'
    ];

    const MODELS = {
        Toyota: ['Camry', 'Corolla', 'RAV4', 'Highlander', 'Tacoma', 'Tundra', 'Sequoia', '4Runner'],
        Honda: ['Civic', 'Accord', 'CR-V', 'Pilot', 'Odyssey', 'Ridgeline'],
        Ford: ['F-150', 'Escape', 'Explorer', 'Mustang', 'Bronco', 'Ranger'],
        Chevrolet: ['Silverado', 'Equinox', 'Malibu', 'Tahoe', 'Traverse', 'Colorado'],
        GMC: ['Sierra', 'Yukon', 'Terrain', 'Acadia', 'Canyon'],
        Nissan: ['Altima', 'Rogue', 'Sentra', 'Frontier', 'Pathfinder'],
        Jeep: ['Wrangler', 'Grand Cherokee', 'Cherokee', 'Gladiator'],
        Ram: ['1500', '2500', '3500'],
        Subaru: ['Outback', 'Forester', 'Crosstrek', 'Ascent', 'Impreza'],
        BMW: ['3 Series', '5 Series', 'X3', 'X5'],
        'Mercedes-Benz': ['C-Class', 'E-Class', 'GLC', 'GLE'],
        Hyundai: ['Elantra', 'Tucson', 'Santa Fe', 'Sonata'],
        Kia: ['Sportage', 'Telluride', 'Forte', 'Sorento'],
        Volkswagen: ['Jetta', 'Tiguan', 'Atlas', 'Golf'],
        Mazda: ['CX-5', 'CX-50', 'Mazda3', 'CX-90']
    };

    const DEMO_SAMPLES = {
        auto: [
            {
                startTime: '09:00',
                customerName: 'Wayne Johnson',
                vehicle: '2021 Toyota Sequoia',
                year: '2021',
                make: 'Toyota',
                model: 'Sequoia',
                vehicleType: 'suv',
                bay: 'Bay 1'
            },
            {
                startTime: '09:00',
                customerName: 'Judy Johnson',
                vehicle: '2019 GMC Yukon',
                year: '2019',
                make: 'GMC',
                model: 'Yukon',
                vehicleType: 'suv',
                bay: 'Bay 2'
            },
            {
                startTime: '11:00',
                customerName: 'Riley Chen',
                vehicle: '2018 Honda Civic',
                year: '2018',
                make: 'Honda',
                model: 'Civic',
                vehicleType: 'car',
                bay: 'Bay 3'
            }
        ],
        body: [
            {
                startTime: '09:00',
                customerName: 'Chris Patel',
                vehicle: '2018 Honda Civic',
                year: '2018',
                make: 'Honda',
                model: 'Civic',
                vehicleType: 'car',
                bay: 'Booth A'
            },
            {
                startTime: '10:30',
                customerName: 'Elena Ruiz',
                vehicle: '2020 Ford F-150',
                year: '2020',
                make: 'Ford',
                model: 'F-150',
                vehicleType: 'truck',
                bay: 'Booth B'
            }
        ],
        tire: [
            {
                startTime: '09:00',
                customerName: 'Marcus Lee',
                vehicle: '2022 Subaru Outback',
                year: '2022',
                make: 'Subaru',
                model: 'Outback',
                vehicleType: 'suv',
                bay: 'Rack 1'
            },
            {
                startTime: '09:00',
                customerName: 'Nina Brooks',
                vehicle: '2017 Chevy Silverado',
                year: '2017',
                make: 'Chevrolet',
                model: 'Silverado',
                vehicleType: 'truck',
                bay: 'Rack 2'
            }
        ],
        upholstery: [
            {
                startTime: '09:00',
                customerName: 'Sam Ortiz',
                vehicle: 'Sofa recover',
                vehicleType: 'sofa',
                bay: 'Bench 1'
            },
            {
                startTime: '11:00',
                customerName: 'Pat Kim',
                vehicle: '2015 BMW 3 Series · seats',
                year: '2015',
                make: 'BMW',
                model: '3 Series',
                vehicleType: 'vehicle',
                bay: 'Bench 2'
            }
        ]
    };

    const DEMO_BAYS = {
        auto: ['Bay 1', 'Bay 2', 'Bay 3'],
        body: ['Booth A', 'Booth B', 'Prep bay'],
        tire: ['Rack 1', 'Rack 2', 'Mount bay'],
        upholstery: ['Bench 1', 'Bench 2', 'Pickup staging']
    };

    function esc(s) {
        return String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function todayYmd() {
        return new Date().toISOString().slice(0, 10);
    }

    function shopVertical(app) {
        const v = String(app?.demoVertical || app?._primaryShopVertical?.() || '').toLowerCase();
        if (['auto', 'body', 'tire', 'upholstery'].includes(v)) return v;
        return 'auto';
    }

    function ensureDemoStore(app) {
        if (!app._shopApptDemoStore) {
            app._shopApptDemoStore = { byDay: {}, seq: 1 };
        }
        return app._shopApptDemoStore;
    }

    function seedDemoDay(app, day, vert) {
        const store = ensureDemoStore(app);
        const key = `${day}:${vert}`;
        if (store.byDay[key]) return store.byDay[key];
        const samples = DEMO_SAMPLES[vert] || DEMO_SAMPLES.auto;
        store.byDay[key] = samples.map((s, i) => ({
            id: `demo-${vert}-${day}-${i}`,
            date: day,
            startTime: s.startTime,
            startsAt: `${day}T${s.startTime}:00`,
            customerName: s.customerName,
            vehicle: s.vehicle || '',
            jobType: vert,
            bay: s.bay,
            year: s.year || '',
            make: s.make || '',
            model: s.model || '',
            vehicleType: s.vehicleType || '',
            vin: '',
            status: 'scheduled',
            notes: ''
        }));
        return store.byDay[key];
    }

    function searchSelectHtml({ name, attr, placeholder, value, label }) {
        return `<div class="pos-search-select admin-shop-ss" data-admin-ss ${attr || ''}>
      <input type="hidden" data-ss-value value="${esc(value || '')}">
      <input type="text" class="form-control" data-ss-input role="combobox" aria-autocomplete="list"
        aria-expanded="false" aria-label="${esc(name)}" placeholder="${esc(placeholder || 'Search…')}"
        value="${esc(label || value || '')}" autocomplete="off" spellcheck="false">
      <ul class="admin-shop-ss-list" data-ss-list role="listbox" hidden></ul>
    </div>`;
    }

    function bindSearchSelect(root, { getOptions, onChange } = {}) {
        if (!root || root._bound) return;
        root._bound = true;
        const input = root.querySelector('[data-ss-input]');
        const hidden = root.querySelector('[data-ss-value]');
        const list = root.querySelector('[data-ss-list]');
        if (!input || !hidden || !list) return;

        const close = () => {
            list.hidden = true;
            input.setAttribute('aria-expanded', 'false');
        };
        const open = () => {
            list.hidden = false;
            input.setAttribute('aria-expanded', 'true');
        };
        const render = (filterText) => {
            const q = String(filterText || '').trim().toLowerCase();
            const options = (typeof getOptions === 'function' ? getOptions() : []) || [];
            const filtered = q
                ? options.filter((o) => `${o.label || ''} ${o.value || ''}`.toLowerCase().includes(q))
                : options;
            list.innerHTML = filtered.length
                ? filtered
                      .map(
                          (o) =>
                              `<li role="option" data-value="${esc(o.value)}" data-label="${esc(
                                  o.label ?? o.value
                              )}">${esc(o.label ?? o.value)}</li>`
                      )
                      .join('')
                : `<li class="admin-shop-ss-empty">No matches</li>`;
            open();
        };
        const pick = (value, label) => {
            hidden.value = value != null ? String(value) : '';
            input.value = label != null ? String(label) : hidden.value;
            close();
            onChange?.(hidden.value, input.value);
        };
        root._setOptions = (options, selected) => {
            root._options = options || [];
            getOptions = () => root._options;
            if (selected != null) {
                const hit = root._options.find((o) => String(o.value) === String(selected));
                if (hit) {
                    hidden.value = String(hit.value);
                    input.value = String(hit.label ?? hit.value);
                } else if (selected === '') {
                    hidden.value = '';
                    input.value = '';
                }
            }
        };
        root._getValue = () => hidden.value;
        input.addEventListener('focus', () => render(input.value));
        input.addEventListener('input', () => {
            hidden.value = '';
            render(input.value);
        });
        list.addEventListener('mousedown', (ev) => {
            const li = ev.target.closest('[data-value]');
            if (!li) return;
            ev.preventDefault();
            pick(li.getAttribute('data-value'), li.getAttribute('data-label'));
        });
        document.addEventListener('click', (ev) => {
            if (!root.contains(ev.target)) close();
        });
    }

    const mixin = {
        async loadShopAppointmentsCalendar() {
            const container = document.getElementById('schedulingBookingsTable');
            if (!container) return;

            const pageTitle = document.querySelector('#scheduling .page-title');
            if (pageTitle) pageTitle.textContent = 'Shop schedule';
            const intro = document.querySelector('#scheduling .content-header p');
            if (intro) {
                intro.innerHTML =
                    'Book and edit shop appointments. Capacity equals your <strong>bays</strong> (3 bays ⇒ up to 3 bookings at the same time). Customers never see technician names — techs pick a bay at clock-in.';
            }

            container.innerHTML = `<div class="loading"><div class="spinner"></div>Loading shop schedule…</div>`;

            this._shopCalAppointments = [];
            this._shopCalById = new Map();

            const vert = shopVertical(this);
            const day = todayYmd();

            container.innerHTML = this.renderShopCalendarPage(vert, day);
            this.bindShopCalendarPage(container, vert);
            await this.refreshShopCalendarData();
        },

        renderShopCalendarPage(vert, day) {
            const isUph = vert === 'upholstery';
            const vehicleTypeOpts = isUph
                ? [
                      { value: 'vehicle', label: 'Vehicle interior' },
                      { value: 'sofa', label: 'Sofa' },
                      { value: 'sectional', label: 'Sectional' },
                      { value: 'armchair', label: 'Armchair' },
                      { value: 'dining', label: 'Dining chairs' },
                      { value: 'ottoman', label: 'Ottoman' },
                      { value: 'other', label: 'Other piece' }
                  ]
                : [
                      { value: 'car', label: 'Car / sedan' },
                      { value: 'suv', label: 'SUV / crossover' },
                      { value: 'truck', label: 'Truck / pickup' },
                      { value: 'van', label: 'Van' },
                      { value: 'other', label: 'Other' }
                  ];

            return `<div class="shop-admin-cal-layout" data-shop-admin-cal>
  <div class="shop-admin-cal-grid">
    <div data-shop-admin-cal-mount></div>
  </div>
  <aside class="shop-admin-cal-book card">
    <div class="card-content">
      <h3 style="margin:0 0 0.5rem;color:var(--primary-green);font-size:1.1rem;">Book appointment</h3>
      <p class="form-help" style="margin:0 0 0.75rem;">Assigns the next free bay for the selected time. Technician is not shown to customers.</p>
      <div class="form-group">
        <label>Date</label>
        <input type="date" class="form-control" data-shop-book-date value="${esc(day)}">
      </div>
      <div class="form-group">
        <label>Time</label>
        <input type="time" class="form-control" data-shop-book-time value="09:00">
      </div>
      <div class="form-group">
        <label>Customer</label>
        <input type="text" class="form-control" data-shop-book-name placeholder="Name" autocomplete="name">
      </div>
      <div class="form-group">
        <label>${isUph ? 'Piece type' : 'Vehicle type'}</label>
        ${searchSelectHtml({
            name: isUph ? 'Piece type' : 'Vehicle type',
            attr: 'data-shop-book-vtype-ss',
            placeholder: 'Search…',
            value: vehicleTypeOpts[0].value,
            label: vehicleTypeOpts[0].label
        })}
      </div>
      <div class="form-group">
        <label>VIN (last 6)</label>
        <div style="display:flex;gap:0.35rem;">
          <input type="text" class="form-control" data-shop-book-vin-tail maxlength="6" placeholder="Last 6" autocomplete="off" spellcheck="false">
          <button type="button" class="btn btn-secondary btn-sm" data-shop-book-vin-lookup>Look up</button>
        </div>
        <p class="form-help" data-shop-book-vin-status style="margin-top:0.35rem;"></p>
      </div>
      <div class="form-group">
        <label>Year</label>
        ${searchSelectHtml({ name: 'Year', attr: 'data-shop-book-year-ss', placeholder: 'Search year…' })}
      </div>
      <div class="form-group">
        <label>Make</label>
        ${searchSelectHtml({ name: 'Make', attr: 'data-shop-book-make-ss', placeholder: 'Search make…' })}
      </div>
      <div class="form-group">
        <label>Model</label>
        ${searchSelectHtml({ name: 'Model', attr: 'data-shop-book-model-ss', placeholder: 'Search model…' })}
      </div>
      <input type="hidden" data-shop-book-vin value="">
      <p class="form-help" data-shop-book-vehicle-preview>Pick year, make, and model — or look up by VIN last 6.</p>
      <p class="form-help" data-shop-book-avail aria-live="polite"></p>
      <button type="button" class="btn btn-primary" data-shop-book-create>Book appointment</button>
    </div>
  </aside>
</div>
<style>
.shop-admin-cal-layout{display:grid;grid-template-columns:minmax(0,1fr) minmax(16rem,22rem);gap:1rem;align-items:start;}
@media(max-width:1100px){.shop-admin-cal-layout{grid-template-columns:1fr;}}
.shop-admin-cal-book .form-group{margin-bottom:0.75rem;}
.admin-shop-ss{position:relative;}
.admin-shop-ss-list{position:absolute;z-index:40;left:0;right:0;max-height:12rem;overflow:auto;margin:0;padding:0.25rem 0;list-style:none;background:#fff;border:1px solid var(--gray-200);border-radius:8px;box-shadow:0 8px 24px rgba(15,23,42,.12);}
.admin-shop-ss-list li{padding:0.4rem 0.65rem;cursor:pointer;font-size:0.875rem;}
.admin-shop-ss-list li:hover{background:#f0fdf4;}
.admin-shop-ss-empty{color:var(--gray-500);cursor:default;}
</style>`;
        },

        bindShopCalendarPage(container, vert) {
            const mount = container.querySelector('[data-shop-admin-cal-mount]');
            if (mount && window.ShopCalendarWidget) {
                this._shopCalWidget = new window.ShopCalendarWidget({
                    rootId: 'admin-shop-cal-root',
                    mountEl: mount,
                    viewOnly: false,
                    view: 'month',
                    onSelectDay: (ymd) => {
                        const dateInput = container.querySelector('[data-shop-book-date]');
                        if (dateInput) dateInput.value = ymd;
                        void this.refreshShopBayAvailability(container, vert);
                    },
                    onRangeChange: () => {
                        void this.refreshShopCalendarData();
                    },
                    onEventClick: (appt) => {
                        this.openShopAppointmentModal(appt);
                    }
                });
                this._shopCalWidget.mount(mount);
            }

            const yearSs = container.querySelector('[data-shop-book-year-ss]');
            const makeSs = container.querySelector('[data-shop-book-make-ss]');
            const modelSs = container.querySelector('[data-shop-book-model-ss]');
            const vtypeSs = container.querySelector('[data-shop-book-vtype-ss]');
            const preview = container.querySelector('[data-shop-book-vehicle-preview]');

            const syncPreview = () => {
                const year = yearSs?._getValue?.() || '';
                const make = makeSs?._getValue?.() || '';
                const model = modelSs?._getValue?.() || '';
                const label = [year, make, model].filter(Boolean).join(' ');
                if (preview) {
                    preview.textContent = label || 'Pick year, make, and model — or look up by VIN last 6.';
                }
            };

            bindSearchSelect(vtypeSs, {
                getOptions: () => {
                    const isUph = vert === 'upholstery';
                    return isUph
                        ? [
                              { value: 'vehicle', label: 'Vehicle interior' },
                              { value: 'sofa', label: 'Sofa' },
                              { value: 'sectional', label: 'Sectional' },
                              { value: 'armchair', label: 'Armchair' },
                              { value: 'dining', label: 'Dining chairs' },
                              { value: 'ottoman', label: 'Ottoman' },
                              { value: 'other', label: 'Other piece' }
                          ]
                        : [
                              { value: 'car', label: 'Car / sedan' },
                              { value: 'suv', label: 'SUV / crossover' },
                              { value: 'truck', label: 'Truck / pickup' },
                              { value: 'van', label: 'Van' },
                              { value: 'other', label: 'Other' }
                          ];
                }
            });
            vtypeSs?._setOptions?.(
                vert === 'upholstery'
                    ? [
                          { value: 'vehicle', label: 'Vehicle interior' },
                          { value: 'sofa', label: 'Sofa' },
                          { value: 'sectional', label: 'Sectional' },
                          { value: 'armchair', label: 'Armchair' },
                          { value: 'dining', label: 'Dining chairs' },
                          { value: 'ottoman', label: 'Ottoman' },
                          { value: 'other', label: 'Other piece' }
                      ]
                    : [
                          { value: 'car', label: 'Car / sedan' },
                          { value: 'suv', label: 'SUV / crossover' },
                          { value: 'truck', label: 'Truck / pickup' },
                          { value: 'van', label: 'Van' },
                          { value: 'other', label: 'Other' }
                      ],
                vert === 'upholstery' ? 'vehicle' : 'car'
            );

            bindSearchSelect(yearSs, {
                getOptions: () => YEARS.map((y) => ({ value: y, label: y })),
                onChange: syncPreview
            });
            yearSs?._setOptions?.(
                YEARS.map((y) => ({ value: y, label: y })),
                ''
            );

            bindSearchSelect(makeSs, {
                getOptions: () => MAKES.map((m) => ({ value: m, label: m })),
                onChange: () => {
                    const make = makeSs._getValue?.() || '';
                    const models = (MODELS[make] || []).map((m) => ({ value: m, label: m }));
                    modelSs?._setOptions?.(models, '');
                    syncPreview();
                }
            });
            makeSs?._setOptions?.(
                MAKES.map((m) => ({ value: m, label: m })),
                ''
            );

            bindSearchSelect(modelSs, {
                getOptions: () => [],
                onChange: syncPreview
            });
            modelSs?._setOptions?.([], '');

            container.querySelector('[data-shop-book-date]')?.addEventListener('change', () => {
                void this.refreshShopBayAvailability(container, vert);
            });
            container.querySelector('[data-shop-book-time]')?.addEventListener('change', () => {
                void this.refreshShopBayAvailability(container, vert);
            });
            container.querySelector('[data-shop-book-time]')?.addEventListener('input', () => {
                void this.refreshShopBayAvailability(container, vert);
            });

            container.querySelector('[data-shop-book-vin-lookup]')?.addEventListener('click', () => {
                void this.lookupShopBookVinTail(container, yearSs, makeSs, modelSs, syncPreview);
            });

            container.querySelector('[data-shop-book-create]')?.addEventListener('click', () => {
                void this.createShopAppointmentFromForm(container, vert, {
                    yearSs,
                    makeSs,
                    modelSs,
                    vtypeSs,
                    syncPreview
                });
            });
        },

        async lookupShopBookVinTail(container, yearSs, makeSs, modelSs, syncPreview) {
            const tail = String(container.querySelector('[data-shop-book-vin-tail]')?.value || '')
                .trim()
                .toUpperCase();
            const status = container.querySelector('[data-shop-book-vin-status]');
            const vinHidden = container.querySelector('[data-shop-book-vin]');
            if (tail.length !== 6) {
                if (status) status.textContent = 'Enter exactly 6 characters.';
                return;
            }
            if (status) status.textContent = 'Looking up…';
            // Demo VIN samples (shop verticals only — not ecommerce)
            const samples = {
                A1B2C3: { vin: '1HGCM82633A1B2C3', year: '2021', make: 'Toyota', model: 'Sequoia' },
                D4E5F6: { vin: '1GKS2CKJ5KR4E5F6', year: '2019', make: 'GMC', model: 'Yukon' },
                G7H8I9: { vin: '2HGFC2F59MH7H8I9', year: '2018', make: 'Honda', model: 'Civic' }
            };
            const hit = samples[tail];
            if (!hit) {
                if (status) status.textContent = 'No match — pick year / make / model.';
                return;
            }
            if (vinHidden) vinHidden.value = hit.vin;
            yearSs?._setOptions?.(
                YEARS.map((y) => ({ value: y, label: y })),
                hit.year
            );
            makeSs?._setOptions?.(
                MAKES.map((m) => ({ value: m, label: m })),
                hit.make
            );
            const models = (MODELS[hit.make] || []).map((m) => ({ value: m, label: m }));
            if (!models.some((m) => m.value === hit.model)) {
                models.push({ value: hit.model, label: hit.model });
            }
            modelSs?._setOptions?.(models, hit.model);
            syncPreview?.();
            if (status) status.textContent = `Matched ${hit.year} ${hit.make} ${hit.model}.`;
        },

        async refreshShopBayAvailability(container, vert) {
            const date = container.querySelector('[data-shop-book-date]')?.value || todayYmd();
            const time = container.querySelector('[data-shop-book-time]')?.value || '09:00';
            const availEl = container.querySelector('[data-shop-book-avail]');
            const bookBtn = container.querySelector('[data-shop-book-create]');
            let avail = { openCount: 0, totalCount: 0 };
            try {
                const res = await this.apiRequest(
                    `/admin/shop/bay-availability?date=${encodeURIComponent(date)}&time=${encodeURIComponent(
                        time
                    )}&jobType=${encodeURIComponent(vert)}`
                );
                if (res) avail = res;
            } catch {
                const bays = DEMO_BAYS[vert] || DEMO_BAYS.auto;
                const dayAppts = (this._shopCalAppointments || []).filter((a) => {
                    const d = String(a.date || a.startsAt || '').slice(0, 10);
                    const t = String(a.startTime || String(a.startsAt || '').slice(11, 16)).slice(0, 5);
                    return d === date && t === String(time).slice(0, 5);
                });
                const busy = new Set(dayAppts.map((a) => String(a.bay || '').toLowerCase()).filter(Boolean));
                const open = bays.filter((b) => !busy.has(b.toLowerCase())).length;
                avail = { openCount: open, totalCount: bays.length };
            }
            const open = Number(avail.openCount) || 0;
            const total = Number(avail.totalCount) || 0;
            const bayLabel = vert === 'upholstery' ? 'bench' : vert === 'tire' ? 'rack' : 'bay';
            if (availEl) {
                if (!total) availEl.textContent = 'No bays configured.';
                else if (open)
                    availEl.textContent = `${open} of ${total} ${bayLabel}${total === 1 ? '' : 's'} open at ${time}`;
                else
                    availEl.textContent = `All ${total} ${bayLabel}${
                        total === 1 ? '' : 's'
                    } are booked at ${time}. Choose another time.`;
            }
            if (bookBtn) bookBtn.disabled = !open;
        },

        async refreshShopCalendarData() {
            if (this._shopCalRefreshing) return;
            this._shopCalRefreshing = true;
            try {
            const vert = shopVertical(this);
            const widget = this._shopCalWidget;
            const range = widget?.getRange?.() || { from: todayYmd(), to: todayYmd() };
            let list = [];
            if (this.demoMode) {
                const start = new Date(range.from + 'T12:00:00');
                const end = new Date(range.to + 'T12:00:00');
                const collected = [];
                for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
                    const ymd = d.toISOString().slice(0, 10);
                    collected.push(...seedDemoDay(this, ymd, vert));
                }
                list = collected;
            } else {
                try {
                    const res = await this.apiRequest(
                        `/admin/shop/appointments?from=${encodeURIComponent(range.from + 'T00:00:00')}&to=${encodeURIComponent(
                            range.to + 'T23:59:59'
                        )}&jobType=${encodeURIComponent(vert)}`
                    );
                    list = res?.appointments || [];
                } catch {
                    list = [];
                }
            }
            this._shopCalAppointments = list;
            this._shopCalById = new Map(list.map((a) => [String(a.id), a]));
            widget?.setAppointments(list);
            const container = document.getElementById('schedulingBookingsTable');
            if (container) await this.refreshShopBayAvailability(container, vert);
            } finally {
                this._shopCalRefreshing = false;
            }
        },

        async createShopAppointmentFromForm(container, vert, sels) {
            const date = container.querySelector('[data-shop-book-date]')?.value || todayYmd();
            const startTime = container.querySelector('[data-shop-book-time]')?.value || '09:00';
            const customerName = container.querySelector('[data-shop-book-name]')?.value || 'Customer';
            const year = sels.yearSs?._getValue?.() || '';
            const make = sels.makeSs?._getValue?.() || '';
            const model = sels.modelSs?._getValue?.() || '';
            const vehicleType = sels.vtypeSs?._getValue?.() || '';
            const vin = container.querySelector('[data-shop-book-vin]')?.value || '';
            const vehicle =
                [year, make, model].filter(Boolean).join(' ') ||
                (vehicleType && vert === 'upholstery' ? vehicleType : '');
            const body = {
                date,
                startTime,
                customerName,
                vehicle,
                year,
                make,
                model,
                vehicleType,
                vin,
                jobType: vert
            };
            try {
                const res = await this.apiRequest('/admin/shop/appointments', {
                    method: 'POST',
                    body: JSON.stringify(body)
                });
                if (res?.appointment || res?.success || this.demoMode) {
                    if (!res?.appointment && this.demoMode) {
                        const store = ensureDemoStore(this);
                        const key = `${date}:${vert}`;
                        const list = seedDemoDay(this, date, vert);
                        const bayList = DEMO_BAYS[vert] || DEMO_BAYS.auto;
                        const busy = new Set(list.map((a) => String(a.bay || '').toLowerCase()));
                        const bay = bayList.find((b) => !busy.has(b.toLowerCase())) || bayList[0];
                        list.push({
                            id: `demo-new-${store.seq++}`,
                            date,
                            startTime,
                            startsAt: `${date}T${startTime}:00`,
                            customerName,
                            vehicle,
                            jobType: vert,
                            bay,
                            year,
                            make,
                            model,
                            vehicleType,
                            vin,
                            status: 'scheduled'
                        });
                        store.byDay[key] = list;
                    }
                    this.showToast?.('Appointment booked', 'success');
                    const nameEl = container.querySelector('[data-shop-book-name]');
                    if (nameEl) nameEl.value = '';
                    await this.refreshShopCalendarData();
                    return;
                }
                this.showToast?.(res?.error || 'Could not book', 'error');
            } catch (e) {
                // Local demo fallback when API stub returns success without appointment
                if (this.demoMode) {
                    const store = ensureDemoStore(this);
                    const key = `${date}:${vert}`;
                    const list = seedDemoDay(this, date, vert);
                    const bayList = DEMO_BAYS[vert] || DEMO_BAYS.auto;
                    const sameSlot = list.filter(
                        (a) => String(a.startTime || '').slice(0, 5) === String(startTime).slice(0, 5)
                    );
                    const busy = new Set(sameSlot.map((a) => String(a.bay || '').toLowerCase()));
                    const bay = bayList.find((b) => !busy.has(b.toLowerCase()));
                    if (!bay) {
                        this.showToast?.(`All bays booked at ${startTime}`, 'error');
                        return;
                    }
                    list.push({
                        id: `demo-new-${store.seq++}`,
                        date,
                        startTime,
                        startsAt: `${date}T${startTime}:00`,
                        customerName,
                        vehicle,
                        jobType: vert,
                        bay,
                        year,
                        make,
                        model,
                        vehicleType,
                        vin,
                        status: 'scheduled'
                    });
                    store.byDay[key] = list;
                    this.showToast?.('Appointment booked', 'success');
                    await this.refreshShopCalendarData();
                    return;
                }
                this.showToast?.(e.message || 'Could not book appointment', 'error');
            }
        },

        openShopAppointmentModal(appt) {
            if (!appt) return;
            const existing = document.getElementById('shop-appt-edit-modal');
            existing?.remove();
            const dateVal = String(appt.date || appt.startsAt || '').slice(0, 10);
            const timeVal = String(appt.startTime || String(appt.startsAt || '').slice(11, 16) || '09:00').slice(
                0,
                5
            );
            const modal = document.createElement('div');
            modal.id = 'shop-appt-edit-modal';
            modal.className = 'modal active';
            modal.innerHTML = `<div class="modal-content" style="max-width:28rem;">
  <div class="modal-header" style="display:flex;justify-content:space-between;align-items:center;">
    <h2 style="margin:0;color:var(--primary-green);font-size:1.15rem;">Appointment</h2>
    <button type="button" class="modal-close" data-close aria-label="Close">&times;</button>
  </div>
  <div class="modal-body">
    <div class="form-group"><label>Status</label>
      <select class="form-control" data-edit-status>
        <option value="scheduled"${appt.status === 'scheduled' ? ' selected' : ''}>Scheduled</option>
        <option value="completed"${appt.status === 'completed' ? ' selected' : ''}>Completed</option>
        <option value="cancelled"${
            appt.status === 'cancelled' || appt.status === 'canceled' ? ' selected' : ''
        }>Cancelled</option>
      </select>
    </div>
    <div class="form-group"><label>Date</label>
      <input type="date" class="form-control" data-edit-date value="${esc(dateVal)}">
    </div>
    <div class="form-group"><label>Time</label>
      <input type="time" class="form-control" data-edit-time value="${esc(timeVal)}">
    </div>
    <div class="form-group"><label>Customer</label>
      <input type="text" class="form-control" data-edit-name value="${esc(appt.customerName || '')}">
    </div>
    <div class="form-group"><label>Vehicle / piece</label>
      <input type="text" class="form-control" data-edit-vehicle value="${esc(appt.vehicle || '')}">
    </div>
    <div class="form-group"><label>Bay</label>
      <input type="text" class="form-control" data-edit-bay value="${esc(appt.bay || '')}">
    </div>
    <div class="form-group"><label>Staff notes</label>
      <textarea class="form-control" rows="2" data-edit-notes>${esc(appt.notes || '')}</textarea>
    </div>
    <p class="form-help">Bay occupancy is staff-internal. Technician names are not shown on customer-facing booking.</p>
  </div>
  <div class="modal-footer" style="display:flex;gap:0.5rem;justify-content:flex-end;">
    <button type="button" class="btn btn-secondary" data-close>Close</button>
    <button type="button" class="btn btn-primary" data-save>Save changes</button>
  </div>
</div>`;
            document.body.appendChild(modal);
            const close = () => modal.remove();
            modal.querySelectorAll('[data-close]').forEach((btn) => btn.addEventListener('click', close));
            modal.querySelector('[data-save]')?.addEventListener('click', async () => {
                const patch = {
                    status: modal.querySelector('[data-edit-status]')?.value,
                    date: modal.querySelector('[data-edit-date]')?.value,
                    startTime: modal.querySelector('[data-edit-time]')?.value,
                    customerName: modal.querySelector('[data-edit-name]')?.value,
                    vehicle: modal.querySelector('[data-edit-vehicle]')?.value,
                    bay: modal.querySelector('[data-edit-bay]')?.value,
                    notes: modal.querySelector('[data-edit-notes]')?.value
                };
                try {
                    await this.apiRequest(`/admin/shop/appointments/${encodeURIComponent(appt.id)}`, {
                        method: 'PATCH',
                        body: JSON.stringify(patch)
                    });
                    this.showToast?.('Appointment updated', 'success');
                    close();
                    await this.refreshShopCalendarData();
                } catch (e) {
                    if (this.demoMode) {
                        Object.assign(appt, patch);
                        this.showToast?.('Appointment updated', 'success');
                        close();
                        await this.refreshShopCalendarData();
                        return;
                    }
                    this.showToast?.(e.message || 'Update failed', 'error');
                }
            });
        }
    };

    if (typeof AdminApp !== 'undefined') {
        Object.assign(AdminApp.prototype, mixin);
        const orig = AdminApp.prototype.loadSchedulingBookings;
        AdminApp.prototype.loadSchedulingBookings = async function (...args) {
            if (typeof this._isShopAdminView === 'function' && this._isShopAdminView()) {
                return this.loadShopAppointmentsCalendar();
            }
            return orig.apply(this, args);
        };
    }
})();
