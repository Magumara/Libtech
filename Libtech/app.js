// ============================================================
// LibTech – Logique principale du site (SPA + répertoire CSV)
// ============================================================

(() => {
    'use strict';

    // ------------------------------------------------------------
    // 1. Source des données (Google Sheets publié en CSV)
    // ------------------------------------------------------------
    const CSV_URL =
        'https://docs.google.com/spreadsheets/d/e/2PACX-1vTrbhCHyINYJMEBbnl_SGBujZOOUB0rw4WnXWirV9dUF_PaktI2oVM0ubMRK6B_Xw/pub?output=csv';

    // ------------------------------------------------------------
    // 2. Fonctions utilitaires (sélecteurs, échappement, formats)
    // ------------------------------------------------------------
    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

    const esc = (s) =>
        String(s ?? '')
            .replaceAll('&', '&amp;')
            .replaceAll('<', '&lt;')
            .replaceAll('>', '&gt;')
            .replaceAll('"', '&quot;')
            .replaceAll("'", '&#39;');

    const slug = (s) =>
        String(s || '')
            .toLowerCase()
            .normalize('NFD')
            .replace(/\p{Diacritic}/gu, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');

    const isUrl = (v) => /^(https?:)?\/\//i.test(String(v));
    const isImg = (v) => /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(String(v));

    // ------------------------------------------------------------
    // 3. État global
    // ------------------------------------------------------------
    let rows = [];
    let headers = [];
    let bySlug = new Map();
    let expandedFacets = new Set();

    let currentLang = localStorage.getItem('libtechLang') === 'en' ? 'en' : 'fr';
    document.documentElement.lang = currentLang;

    const UI_STRINGS = {
        fr: {
            nav_home: 'Accueil',
            nav_directory: 'Répertoire',
            nav_submit: 'Soumettre',
            nav_about: 'À propos',
            nav_contact: 'Contact',
            footer_contact: 'Nous contacter',
            footer_resources: 'Ressources',
            footer_mentions: 'Mentions légales',
            footer_privacy: 'Politiques de confidentialité',
            footer_sitemap: 'Plan du site',
            search_global: 'Rechercher…',
            back_to_top: '↑ Retour haut',
            theme_enable_dark: 'Activer le mode sombre',
            theme_enable_light: 'Activer le mode clair',
        },
        en: {
            nav_home: 'Home',
            nav_directory: 'Directory',
            nav_submit: 'Submit',
            nav_about: 'About',
            nav_contact: 'Contact',
            footer_contact: 'Contact us',
            footer_resources: 'Resources',
            footer_mentions: 'Legal notice',
            footer_privacy: 'Privacy policy',
            footer_sitemap: 'Site map',
            search_global: 'Search…',
            back_to_top: '↑ Back to top',
            theme_enable_dark: 'Enable dark mode',
            theme_enable_light: 'Enable light mode',
        },
    };


    function applyTranslations() {
        const dict = UI_STRINGS[currentLang] || UI_STRINGS.fr;

        document.querySelectorAll('[data-i18n]').forEach((el) => {
            const key = el.getAttribute('data-i18n');
            const val = dict[key];
            if (val) el.textContent = val;
        });

        document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
            const key = el.getAttribute('data-i18n-placeholder');
            const val = dict[key];
            if (val) el.placeholder = val;
        });

        updateThemeToggle();
    }

    // Met à jour l'icône et le libellé accessible du bouton selon le thème et la langue actifs.
    function updateThemeToggle() {
        const themeToggle = $('#themeToggle');
        const isDark = document.documentElement.dataset.theme === 'dark';
        const dict = UI_STRINGS[currentLang] || UI_STRINGS.fr;
        const label = isDark ? dict.theme_enable_light : dict.theme_enable_dark;

        if (!themeToggle) return;
        themeToggle.textContent = isDark ? '☀' : '☾';
        themeToggle.setAttribute('aria-label', label);
        themeToggle.title = label;
    }

    const savedTheme = localStorage.getItem('libtechTheme') === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = savedTheme;
    updateThemeToggle();

    $('#themeToggle')?.addEventListener('click', () => {
        const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
        document.documentElement.dataset.theme = nextTheme;
        localStorage.setItem('libtechTheme', nextTheme);
        updateThemeToggle();
    });

    function renderTemplate(name) {
        const template = document.getElementById(`view-${name}`);
        if (!(template instanceof HTMLTemplateElement)) {
            throw new Error(`Template not found: view-${name}`);
        }

        const content = template.content.cloneNode(true);
        content.querySelectorAll('[data-lang]').forEach((el) => {
            el.hidden = el.dataset.lang !== currentLang;
        });
        content.querySelectorAll('[data-placeholder-fr]').forEach((el) => {
            el.placeholder =
                el.getAttribute(`data-placeholder-${currentLang}`) ||
                el.getAttribute('data-placeholder-fr');
        });

        $('#page').replaceChildren(content);
    }

    const FACET_LABELS = [
        'Besoin',
        'Technologie',
        "Tranche d'âge",
        'Handicap',
        'Langue',
        'Prix',
        'Localisation',
    ];
    // Restaure les choix des facettes après un rechargement, avec une sélection vide si les données enregistrées sont invalides.
    function restoreActiveTokens() {
        // Prépare une sélection vide pour chaque catégorie si aucune préférence n'est disponible.
        const emptyTokens = () => new Map(FACET_LABELS.map((label) => [label, new Set()]));
        const savedTokens = localStorage.getItem('libtechActiveTokens');
        if (!savedTokens) return emptyTokens();

        let parsedTokens;
        try {
            parsedTokens = JSON.parse(savedTokens);
        } catch (error) {
            console.error('Impossible de restaurer les filtres enregistrés.', error);
            return emptyTokens();
        }

        if (!parsedTokens || typeof parsedTokens !== 'object' || Array.isArray(parsedTokens)) {
            console.error('Les filtres enregistrés ont un format invalide.');
            return emptyTokens();
        }

        return new Map(FACET_LABELS.map((label) => [
            label,
            new Set(Array.isArray(parsedTokens[label])
                ? parsedTokens[label].filter((value) => typeof value === 'string')
                : []),
        ]));
    }

    let activeTokens = restoreActiveTokens();

    const PAGE_SIZE = 12;
    let currentPage = 1;

    let imageHeader = null;
    let imageDescHeader = null;

    // ------------------------------------------------------------
    // 4. Mapping logique des colonnes du CSV
    // ------------------------------------------------------------
    const COL = {
        name: { base: ['Nom'], suffix: true },
        description: { base: ['Description'], suffix: true },
        needs: { base: ['Besoin', 'Besoins'], suffix: true },
        technology: { base: ['Technologie', 'Type de technologie'], suffix: true },
        age: { base: ["Tranche d'âge", "Tranche d'age"], suffix: true },
        disability: { base: ['Handicap'], suffix: true },
        langs: { base: ['Langue', 'Langues'], suffix: true },
        price: { base: ['Prix', 'Tarif', 'Coût', 'Cout'], suffix: true },
        location: { base: ['Localisation', 'Pays'], suffix: true },
    };

    const headersIndex = () => {
        const map = new Map();
        headers.forEach((h) => map.set(String(h || '').trim().toLowerCase(), h));
        return map;
    };

    const findHeader = (cand) =>
        headers.find((h) => new RegExp(`^${cand}$`, 'i').test(h)) || null;

    function pickHeader(key) {
        const info = COL[key];
        if (!info) return null;

        const H = headersIndex();
        const candidates = [];

        for (const b of info.base) {
            if (info.suffix) {
                if (currentLang) {
                    candidates.push(`${b}_${currentLang}`);
                }
                candidates.push(b);
            } else {
                candidates.push(b);
            }
        }

        for (const c of candidates) {
            const exact = findHeader(c);
            if (exact) return exact;
            const loose = H.get(c.toLowerCase());
            if (loose) return loose;
        }

        for (const b of info.base) {
            for (const h of headers) {
                if (new RegExp(b, 'i').test(h)) return h;
            }
        }
        return null;
    }

    function pickValue(row, key) {
        const h = pickHeader(key);
        const v = h && row[h] != null ? String(row[h]).trim() : '';
        return v || '';
    }

    const nameKey = () => pickHeader('name') || headers[0] || 'Nom';

    // ------------------------------------------------------------
    // 5. Chargement du CSV
    // ------------------------------------------------------------
    function loadCSV(url) {
        return new Promise((resolve, reject) => {
            const bust = `${url}${url.includes('?') ? '&' : '?'}cache=${Date.now()}`;

            Papa.parse(bust, {
                header: true,
                download: true,
                skipEmptyLines: true,
                complete: (res) => {
                    const data = (res.data || []).filter((row) =>
                        Object.values(row).some((v) => String(v || '').trim() !== '')
                    );

                    headers = (res.meta?.fields || Object.keys(data[0] || {})).map((h) =>
                        String(h || '').trim()
                    );

                    // Normalise row keys (trim) so they match the header names
                    const nkey = nameKey();
                    rows = data.map((r, i) => {
                        const normalized = {};
                        Object.entries(r).forEach(([k, v]) => {
                            const key = String(k || '').trim();
                            normalized[key] = v;
                        });
                        normalized.__slug = slug(normalized[nkey] || `item-${i}`);
                        return normalized;
                    });

                    bySlug = new Map(rows.map((r) => [r.__slug, r]));

                    // Detect image and image-description columns (once)
                    imageHeader = headers.find((h) => /^image(_fr)?$/i.test(h)) || null;
                    imageDescHeader =
                        headers.find((h) => /^description[_ ]?image(_fr)?$/i.test(h)) || null;


                    rows.sort((a, b) =>
                        String(a[nkey] || '').localeCompare(String(b[nkey] || ''), 'fr', {
                            sensitivity: 'base',
                        })
                    );

                    route();
                    resolve();
                },
                error: (err) => {
                    console.error(err);
                    alert('Erreur lors du chargement des données (CSV).');
                    reject(err);
                },
            });
        });
    }

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            loadCSV(CSV_URL);
        }
    });

    // ------------------------------------------------------------
    // 6. Filtres
    // ------------------------------------------------------------
    const facetDefs = () => [
        { key: 'needs', label: 'Besoin' },
        { key: 'technology', label: 'Technologie' },
        { key: 'age', label: "Tranche d'âge" },
        { key: 'disability', label: 'Handicap' },
        { key: 'langs', label: 'Langue' },
        { key: 'price', label: 'Prix' },
        { key: 'location', label: 'Localisation' },
    ];

    function facetValues() {
        const map = new Map();
        facetDefs().forEach((f) => map.set(f.label, new Set()));

        for (const row of rows) {
            for (const f of facetDefs()) {
                const raw = pickValue(row, f.key);
                raw
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean)
                    .forEach((val) => map.get(f.label).add(val));
            }
        }

        const result = {};
        for (const f of facetDefs()) {
            result[f.label] = Array.from(map.get(f.label)).sort((a, b) =>
                a.localeCompare(b, 'fr', { sensitivity: 'base' })
            );
        }
        return result;
    }

    function toggleToken(label, value) {
        const set = activeTokens.get(label);
        if (!set) return;
        if (set.has(value)) set.delete(value);
        else set.add(value);

        saveActiveTokens();
    }

    // Enregistre les sélections des facettes pour les restaurer au prochain affichage du répertoire.
    function saveActiveTokens() {
        const savedTokens = Object.fromEntries(
            Array.from(activeTokens, ([facet, values]) => [facet, Array.from(values)])
        );
        localStorage.setItem('libtechActiveTokens', JSON.stringify(savedTokens));
    }

    function matchRow(row) {
        for (const [label, set] of activeTokens.entries()) {
            if (!set || set.size === 0) continue;

            const def = facetDefs().find((f) => f.label === label);
            if (!def) continue;

            const raw = pickValue(row, def.key);
            const values = raw
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);

            const hasAny = Array.from(set).some((tok) => values.includes(tok));
            if (!hasAny) return false;
        }
        return true;
    }

    // ------------------------------------------------------------
    // 7. Facettes + cartes
    // ------------------------------------------------------------
    function buildFacets() {
        const facetRoot = $('#facetRoot');
        if (!facetRoot) return;

        const valuesByFacet = facetValues();
        const parts = [];
        const hasActiveFilters = Array.from(activeTokens.values()).some((set) => set.size > 0);
        const resetLabel = currentLang === 'en'
            ? 'Reset all filters'
            : 'Réinitialiser tous les filtres';

        // Cette case n'est active que lorsqu'un filtre est choisi et efface alors toutes les catégories.
        parts.push(`
        <div class="opt facet-select-all facet-reset">
          <input id="resetAllFilters" type="checkbox" data-reset-all-filters
                 ${hasActiveFilters ? 'checked' : ''} ${hasActiveFilters ? '' : 'disabled'}>
          <label for="resetAllFilters">${resetLabel}</label>
        </div>`);

        for (const f of facetDefs()) {
            const values = valuesByFacet[f.label] || [];
            const set = activeTokens.get(f.label) || new Set();

            const isExpanded = expandedFacets.has(f.label);
            const max = isExpanded ? values.length : 6;
            // Cette case est cochée si la catégorie contient des sélections ; la décocher les efface toutes.
            const selectAllLabel = currentLang === 'en' ? 'Deselect all' : 'Tout décocher';

            parts.push(`
        <div class="facet">
          <h4>${esc(f.label)}</h4>
          <div class="opt facet-select-all">
            <input id="facet-${slug(f.label)}-all" type="checkbox"
                   data-select-all-label="${esc(f.label)}"
                   ${set.size ? 'checked' : ''}
                   ${set.size ? '' : 'disabled'}>
            <label for="facet-${slug(f.label)}-all">${selectAllLabel}</label>
          </div>
          ${values
                    .slice(0, max)
                    .map((val) => {
                        const id = `facet-${slug(f.label)}-${slug(val)}`;
                        const checked = set.has(val) ? 'checked' : '';
                        return `
              <div class="opt">
                <input id="${id}" type="checkbox" ${checked}
                       data-facet-label="${esc(f.label)}"
                       data-facet-value="${esc(val)}">
                <label for="${id}">${esc(val)}</label>
              </div>`;
                    })
                    .join('')}
          ${values.length > 6
                    ? `<button class="btn btn-sm" data-toggle-facet="${esc(f.label)}">
                 ${isExpanded ? 'Voir moins' : 'Voir plus'}
               </button>`
                    : ''
                }
        </div>`);
        }

        facetRoot.innerHTML = parts.join('');

        facetRoot
            .querySelectorAll('input[type="checkbox"][data-reset-all-filters]')
            .forEach((el) => {
                el.addEventListener('change', () => {
                    activeTokens.forEach((set) => set.clear());
                    saveActiveTokens();
                    currentPage = 1;
                    applyFiltersAndRenderCards();
                });
            });

        facetRoot
            .querySelectorAll('input[type="checkbox"][data-select-all-label]')
            .forEach((el) => {
                const facetLabel = el.getAttribute('data-select-all-label');
                const set = activeTokens.get(facetLabel);

                el.addEventListener('change', () => {
                    if (!set) return;
                    set.clear();
                    saveActiveTokens();
                    currentPage = 1;
                    applyFiltersAndRenderCards();
                });
            });

        facetRoot
            .querySelectorAll('input[type="checkbox"][data-facet-label]')
            .forEach((el) => {
                el.addEventListener('change', () => {
                    const label = el.getAttribute('data-facet-label');
                    const value = el.getAttribute('data-facet-value');
                    toggleToken(label, value);
                    currentPage = 1;
                    applyFiltersAndRenderCards();
                });
            });

        facetRoot
            .querySelectorAll('button[data-toggle-facet]')
            .forEach((btn) => {
                btn.addEventListener('click', () => {
                    const label = btn.getAttribute('data-toggle-facet');
                    if (expandedFacets.has(label)) expandedFacets.delete(label);
                    else expandedFacets.add(label);
                    buildFacets();
                    applyFiltersAndRenderCards();
                });
            });
    }

    function card(row) {
        const nkey = nameKey();
        const name = row[nkey] || '(Sans nom)';
        const description = pickValue(row, 'description');
        const needs = pickValue(row, 'needs');
        const handicap = pickValue(row, 'disability');

        const imageUrl = imageHeader ? row[imageHeader] : '';
        const imageCaption = imageDescHeader ? row[imageDescHeader] : '';

        const fallbackText =
            currentLang === 'en'
                ? 'Assistive solution listed on LibTech.'
                : 'Solution d’assistance référencée sur LibTech.';

        const thumb = imageUrl && isImg(imageUrl)
            ? `<img src="${esc(imageUrl)}" alt="${esc(name)}">`
            : `<div class="card-thumb-fallback">
                 <strong>${esc(name)}</strong><br>
                 ${esc(needs || handicap || 'Technologie d’assistance')}
               </div>`;

        return `
      <article class="card" tabindex="0" data-slug="${esc(row.__slug)}">
        <div class="card-thumb">
          ${thumb}
        </div>
        <div class="title">${esc(name)}</div>
        <div class="desc">
          ${esc(
            description ||
            needs ||
            handicap ||
            fallbackText
        )}
        </div>
      </article>`;
    }

    function applyFiltersAndRenderCards() {
        const grid = $('#gridRoot');
        const count = $('#count');
        if (!grid || !count) return;

        buildFacets();

        const q = ($('#q')?.value || '').toLowerCase().trim();
        const nkey = nameKey();

        let list = rows.filter(matchRow);
        if (q.length >= 2) {
            list = list.filter(r =>
                Object.values(r).some(v => String(v).toLowerCase().includes(q))
            );
        }

        list.sort((a, b) =>
            String(a[nkey] || '').localeCompare(String(b[nkey] || ''), 'fr', { sensitivity: 'base' })
        );

        const totalItems = list.length;
        const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));

        if (currentPage > totalPages) currentPage = totalPages;
        if (currentPage < 1) currentPage = 1;

        const start = (currentPage - 1) * PAGE_SIZE;
        const pageRows = list.slice(start, start + PAGE_SIZE);

        const noResultText = currentLang === 'en' ? 'No results.' : 'Aucun résultat.';
        grid.innerHTML = pageRows.length
            ? pageRows.map(card).join('')
            : `<div class="meta">${noResultText}</div>`;

        const countOne = currentLang === 'en' ? '1 item' : '1 élément';
        const countMany = (n) => currentLang === 'en' ? `${n} items` : `${n} éléments`;
        count.textContent = totalItems === 1 ? countOne : countMany(totalItems);

        const info = $('#pageInfo');
        const prevBtn = $('#prevPage');
        const nextBtn = $('#nextPage');

        if (info) {
            if (totalItems === 0) {
                info.textContent = currentLang === 'en' ? '0 result' : '0 résultat';
            } else {
                info.textContent = currentLang === 'en'
                    ? `Page ${currentPage} / ${totalPages}`
                    : `Page ${currentPage} / ${totalPages}`;
            }
        }
        if (prevBtn) prevBtn.disabled = currentPage <= 1 || totalItems === 0;
        if (nextBtn) nextBtn.disabled = currentPage >= totalPages || totalItems === 0;

        grid.querySelectorAll('.card').forEach(el => {
            el.addEventListener('keydown', e => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    location.hash = `#/repertoire/${el.dataset.slug}`;
                }
            });
            el.addEventListener('click', () => location.hash = `#/repertoire/${el.dataset.slug}`);
        });
    }

    // ------------------------------------------------------------
    // 8. Vues
    // ------------------------------------------------------------
    function viewHome() {
        renderTemplate('home');

        setTimeout(() => $('#homeSearchInput')?.focus(), 100);
        $('#homeSearchForm').addEventListener('submit', (e) => {
            e.preventDefault();
            const q = $('#homeSearchInput').value || '';
            const globalInput = $('#q');
            if (globalInput) globalInput.value = q;
            location.hash = '#/repertoire';
            setTimeout(applyFiltersAndRenderCards, 0);
        });
    }

    function viewContact() {
        renderTemplate('contact');
    }

    function viewSoumettre() {
        renderTemplate('submit');

        const form = $('#soumettreForm');
        const modal = $('#soumettreModal');
        const closeModal = $('#closeModal');
        if (!form || !modal || !closeModal) return;

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            modal.classList.remove('hidden');
            form.reset();
        });
        closeModal.addEventListener('click', () => {
            modal.classList.add('hidden');
        });
    }

    function viewAbout() {
        renderTemplate('about');
    }
    function viewRepertoire() {
        const isEn = currentLang === 'en';
        // Récupère la préférence d'affichage pour garder les filtres visibles ou masqués entre deux visites.
        const filtersVisible = localStorage.getItem('libtechFiltersVisible') === 'true';

        const toggleLabelShow = isEn ? '☰ Show filters' : '☰ Afficher les filtres';
        const toggleLabelHide = isEn ? '✕ Hide filters' : '✕ Masquer les filtres';
        const prevText = isEn ? 'Previous' : 'Précédent';
        const nextText = isEn ? 'Next' : 'Suivant';

        $('#page').innerHTML = `
      <section class="page">
        <div class="repo-topbar">
          <button id="toggleFilters" class="filters-toggle">${esc(filtersVisible ? toggleLabelHide : toggleLabelShow)}</button>
          <span class="pill" id="count" aria-live="polite">0</span>
        </div>
        <div class="repo-layout ${filtersVisible ? 'with-filters' : 'no-filters'}" id="repoLayout">
          <aside class="sidebar${filtersVisible ? '' : ' hidden'}" id="facetRoot" aria-label="Filtres"></aside>
          <div>
            <div class="grid" id="gridRoot"></div>
            <div class="pagination" id="pagination">
              <button type="button" id="prevPage" class="btn pagination-btn">${esc(prevText)}</button>
              <span id="pageInfo" class="pagination-info"></span>
              <button type="button" id="nextPage"
                      class="btn pagination-btn">${esc(nextText)}</button>
            </div>
          </div>
        </div>
      </section>`;

        const repoLayout = $('#repoLayout');
        const facetRoot = $('#facetRoot');
        const toggleFilters = $('#toggleFilters');

        if (toggleFilters && repoLayout && facetRoot) {
            toggleFilters.addEventListener('click', () => {
                const isHidden = facetRoot.classList.toggle('hidden');
                repoLayout.classList.toggle('no-filters', isHidden);
                repoLayout.classList.toggle('with-filters', !isHidden);
                toggleFilters.textContent = isHidden ? toggleLabelShow : toggleLabelHide;
                // Mémorise l'état choisi afin de le restaurer après actualisation ou retour d'une fiche.
                localStorage.setItem('libtechFiltersVisible', String(!isHidden));
            });
        }

        const prevPage = $('#prevPage');
        const nextPage = $('#nextPage');

        if (prevPage) {
            prevPage.addEventListener('click', () => {
                if (currentPage > 1) {
                    currentPage--;
                    applyFiltersAndRenderCards();
                }
            });
        }
        if (nextPage) {
            nextPage.addEventListener('click', () => {
                currentPage++;
                applyFiltersAndRenderCards();
            });
        }

        applyFiltersAndRenderCards();
    }

    function viewDetail(slugVal) {
        const row = bySlug.get(slugVal);
        const isEn = currentLang === 'en';

        if (!row) {
            $('#page').innerHTML = `
        <section class="page article">
          <div class="hero">
            <h2>${isEn ? 'Item not found' : 'Élément introuvable'}</h2>
          </div>
          <div class="section">
            <p>${isEn
                    ? 'The requested technology could not be found in the directory.'
                    : 'La technologie demandée n’a pas été trouvée dans le répertoire.'
                }</p>
            <p><a class="btn" href="#/repertoire">← ${isEn ? 'Back to directory' : 'Retour au répertoire'}</a></p>
          </div>
        </section>`;
            return;
        }

        const nkey = nameKey();
        const name = row[nkey] || '(Sans nom)';
        const description = pickValue(row, 'description');
        const besoin = pickValue(row, 'needs');
        const handicap = pickValue(row, 'disability');
        const langues = pickValue(row, 'langs');
        const localisation = pickValue(row, 'location');
        const prix = pickValue(row, 'price');
        const structure = row['Structure'] || row['structure'] || '';
        const dateVal = row['Date'] || row['date'] || '';

        const site = Object.keys(row).find((k) =>
            /^(site|url|lien)$/i.test(k)
        )
            ? row[Object.keys(row).find((k) => /^(site|url|lien)$/i.test(k))]
            : '';

        const imageUrl = imageHeader ? row[imageHeader] : '';
        const imageCaption = imageDescHeader ? row[imageDescHeader] : '';

        const labelHandicap = isEn ? 'Disability' : 'Handicap';
        const labelBesoin = isEn ? 'Need' : 'Besoin';
        const labelDesc = isEn ? 'Description' : 'Description';
        const noDesc = isEn ? 'No description' : 'Pas de description';
        const labelSite = isEn ? 'Website' : 'Site';
        const labelLoc = isEn ? 'Location' : 'Localisation';
        const labelLang = isEn ? 'Language' : 'Langue';
        const labelPrice = isEn ? 'Price' : 'Prix';
        const labelDate = isEn ? 'Date' : 'Date';
        const labelStructure = isEn ? 'Organization' : 'Structure';
        const backLabel = isEn ? '← Back to directory' : '← Retour au répertoire';

        $('#page').innerHTML = `
      <section class="page article">
        <div class="sheet">
          <div class="left">
            <div class="title">${esc(name)}</div>
            <div class="line">
              <div><span class="label">${esc(labelHandicap)} :</span> ${handicap ? esc(handicap) : ''}</div>
              <div><span class="label">${esc(labelBesoin)} :</span> ${besoin ? esc(besoin) : ''}</div>
            </div>
            <div class="desc">
              <h4>${esc(labelDesc)}</h4>
              <div class="descbox">${description ? esc(description) : esc(noDesc)}</div>
            </div>
          </div>

          <div class="right">
            <div class="imagebox">
              ${imageUrl && isImg(imageUrl)
                ? `<img src="${esc(imageUrl)}" alt="image">`
                : '<span>Image</span>'
            }
            </div>
            <div class="imgcap">${imageCaption ? esc(imageCaption) : ''}</div>
            <dl>
              ${site
                ? `<dt>${esc(labelSite)}</dt><dd><a href="${esc(
                    site
                )}" target="_blank" rel="noopener noreferrer">${esc(
                    site
                )}</a></dd>`
                : ''
            }
              ${localisation
                ? `<dt>${esc(labelLoc)}</dt><dd>${esc(localisation)}</dd>`
                : ''
            }
              ${langues ? `<dt>${esc(labelLang)}</dt><dd>${esc(langues)}</dd>` : ''}
              ${prix ? `<dt>${esc(labelPrice)}</dt><dd>${esc(prix)}</dd>` : ''}
              ${dateVal ? `<dt>${esc(labelDate)}</dt><dd>${esc(dateVal)}</dd>` : ''}
              ${structure ? `<dt>${esc(labelStructure)}</dt><dd>${esc(structure)}</dd>` : ''}
            </dl>
            <p style="margin-top:12px">
              <a class="btn" href="#/repertoire">${esc(backLabel)}</a>
            </p>
          </div>
        </div>
      </section>`;
    }

    function viewPlanSite() {
        renderTemplate('site-map');
    }

    function viewMentions() {
        renderTemplate('legal');
    }

    function viewConfidentialite() {
        renderTemplate('privacy');
    }
    // ------------------------------------------------------------
    // 9. Router
    // ------------------------------------------------------------
    function setActiveNav() {
        const h = location.hash || '#/';

        $$('a[data-nav]').forEach((a) => {
            const href = a.getAttribute('href');
            const isRepo = href === '#/repertoire' && h.startsWith('#/repertoire');
            const isExact =
                href === h || (href === '#/' && (h === '#/' || h === '#'));
            a.setAttribute('aria-current', isRepo || isExact ? 'page' : 'false');
        });

        if (h === '#/' || h === '#') {
            document.body.classList.add('home');
        } else {
            document.body.classList.remove('home');
        }
    }

    function route() {
        const h = location.hash || '#/';

        setActiveNav();

        const mDetail = h.match(/^#\/repertoire\/([a-z0-9_.-]+)/i);
        if (mDetail) {
            viewDetail(mDetail[1]);
            return;
        }

        if (h.startsWith('#/repertoire')) {
            viewRepertoire();
            return;
        }
        if (h === '#/' || h === '#') {
            viewHome();
            return;
        }
        if (h === '#/contact') {
            viewContact();
            return;
        }
        if (h === '#/soumettre') {
            viewSoumettre();
            return;
        }
        if (h === '#/a-propos') {
            viewAbout();
            return;
        }
        if (h === '#/plan-du-site') {
            viewPlanSite();
            return;
        }
        if (h === '#/mentions-legales') {
            viewMentions();
            return;
        }
        if (h === '#/confidentialite') {
            viewConfidentialite();
            return;
        }

        viewHome();
    }

    function renderCurrentRoute() {
        route();
    }

    // Ramène progressivement la fenêtre en haut lorsqu'une navigation interne change de page.
    function scrollToPageTop() {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    document.addEventListener('click', (event) => {
        const link = event.target instanceof Element
            ? event.target.closest('a[href^="#/"]')
            : null;
        if (
            !link ||
            event.defaultPrevented ||
            event.button !== 0 ||
            event.metaKey ||
            event.ctrlKey ||
            event.shiftKey ||
            event.altKey ||
            link.target === '_blank'
        ) {
            return;
        }

        scrollToPageTop();
    });

    window.addEventListener('hashchange', () => {
        scrollToPageTop();
        route();
    });

    // ------------------------------------------------------------
    // 10. Comportements globaux
    // ------------------------------------------------------------
    const qInput = $('#q');
    if (qInput) {
        qInput.addEventListener('input', () => {
            if (location.hash.startsWith('#/repertoire')) {
                currentPage = 1;
                applyFiltersAndRenderCards();
            }
        });

        // Entrée lance la recherche depuis n'importe quelle page et ouvre le répertoire si nécessaire.
        qInput.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;

            e.preventDefault();
            if (location.hash === '#/repertoire') {
                currentPage = 1;
                applyFiltersAndRenderCards();
            } else {
                location.hash = '#/repertoire';
            }
        });
    }

    const langSelect = $('#lang');
    if (langSelect) {
        langSelect.value = currentLang;
        applyTranslations();

        langSelect.addEventListener('change', () => {
            currentLang = langSelect.value || 'fr';
            localStorage.setItem('libtechLang', currentLang);
            document.documentElement.lang = currentLang;

            applyTranslations();

            if (typeof renderCurrentRoute === 'function') {
                renderCurrentRoute();
            } else {
                route();
            }
        });
    } else {
        applyTranslations();
    }
    function applyFontChoice(choice) {
        const fontScale = {
            normal: '100%',
            grand: '112.5%',
            'très grand': '125%',
        };
        document.documentElement.style.fontSize = fontScale[choice] || fontScale.normal;
    }

    // Le sélecteur redimensionne la racine pour appliquer l'échelle à toutes les tailles exprimées en rem.
    const fontSelect = $('#font');
    if (fontSelect) {
        const validChoices = ['normal', 'grand', 'très grand'];
        const storedChoice = localStorage.getItem('libtechFontChoice');
        const savedChoice = validChoices.includes(storedChoice) ? storedChoice : 'normal';
        applyFontChoice(savedChoice);
        fontSelect.value = savedChoice;

        fontSelect.addEventListener('change', () => {
            if (!validChoices.includes(fontSelect.value)) return;
            applyFontChoice(fontSelect.value);
            localStorage.setItem('libtechFontChoice', fontSelect.value);
        });
    }



    const backToTopLink = document.querySelector('.footer-top-link');
    if (backToTopLink) {
        // Affiche le bouton après défilement et le retire aussi de la navigation clavier lorsqu'il est caché.
        const updateBackToTopVisibility = () => {
            const isVisible = window.scrollY > 200;
            backToTopLink.classList.toggle('is-visible', isVisible);
            backToTopLink.setAttribute('aria-hidden', String(!isVisible));
            backToTopLink.tabIndex = isVisible ? 0 : -1;
        };

        backToTopLink.addEventListener('click', (e) => {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });

        window.addEventListener('scroll', updateBackToTopVisibility, { passive: true });
        updateBackToTopVisibility();
    }

    // ------------------------------------------------------------
    // 11. Démarrage
    // ------------------------------------------------------------
    (async function init() {
        await loadCSV(CSV_URL);
    })();
})();
