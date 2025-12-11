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

    let currentLang = localStorage.getItem('libtechLang') || 'fr';
    document.documentElement.lang = currentLang;

    const UI_STRINGS = {
        fr: {
            nav_home: 'Accueil',
            nav_directory: 'Répertoire',
            nav_submit: 'Soumettre',
            nav_about: 'À propos',
            nav_contact: 'Contact',
            footer_navigation: 'Navigation',
            footer_contact: 'Nous contacter',
            footer_resources: 'Ressources',
            footer_mentions: 'Mentions légales',
            footer_privacy: 'Politiques de confidentialité',
            footer_sitemap: 'Plan du site',
            search_global: 'Rechercher…',
            back_to_top: '↑ Retour en haut',
        },
        en: {
            nav_home: 'Home',
            nav_directory: 'Directory',
            nav_submit: 'Submit',
            nav_about: 'About',
            nav_contact: 'Contact',
            footer_navigation: 'Navigation',
            footer_contact: 'Contact us',
            footer_resources: 'Resources',
            footer_mentions: 'Legal notice',
            footer_privacy: 'Privacy policy',
            footer_sitemap: 'Site map',
            search_global: 'Search…',
            back_to_top: '↑ Back to top',
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
    let activeTokens = new Map(FACET_LABELS.map((label) => [label, new Set()]));

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

        for (const f of facetDefs()) {
            const values = valuesByFacet[f.label] || [];
            const set = activeTokens.get(f.label) || new Set();

            const isExpanded = expandedFacets.has(f.label);
            const max = isExpanded ? values.length : 6;

            parts.push(`
        <div class="facet">
          <h4>${esc(f.label)}</h4>
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
        const isEn = currentLang === 'en';
        const title = isEn
            ? 'The reference platform for assistive technologies'
            : "La plateforme de référence pour les technologies d'assistance";
        const intro = isEn
            ? 'LibTech is a collaborative platform dedicated to assistive technologies, developed within the TECH Master at the University of Bordeaux. It aims to make existing assistive solutions more accessible by offering a clear, up-to-date directory designed for everyone.'
            : 'LibTech est une plateforme collaborative dédiée aux technologies d’assistance, développée dans le cadre du Master TECH de l’Université de Bordeaux. Elle vise à rendre plus accessibles les solutions d’assistance existantes en proposant un répertoire clair, actualisé et pensé pour tous.';
        const placeholder = isEn
            ? 'Search for an assistive technology...'
            : "Rechercher une technologie d'assistance...";
        const buttonLabel = isEn ? 'Search' : 'Rechercher';

        $('#page').innerHTML = `
      <section class="page">
        <div class="home-hero">
          <div class="home-search">
            <h2>${esc(title)}</h2>
            <p>${esc(intro)}</p>
            <form id="homeSearchForm" class="search-wrap" role="search">
              <input id="homeSearchInput" type="search"
                     placeholder="${esc(placeholder)}"
                     autocomplete="off">
              <button class="btn" type="submit">${esc(buttonLabel)}</button>
            </form>
          </div>
        </div>
      </section>`;

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
        const isEn = currentLang === 'en';

        const intro = isEn
            ? `Wherever you are, if you have a question about LibTech, a suggestion for an assistive technology or a correction to propose, feel free to contact us. We will be happy to hear from you.`
            : `Où que vous soyez, si vous avez une question sur LibTech, une suggestion de technologie d’assistance ou une correction à proposer, n’hésitez pas à nous écrire. Nous serons ravis d’échanger avec vous.`;

        const cardText = isEn
            ? `You can contact us by e-mail using the button below. The LibTech team will get back to you as soon as possible.`
            : `Nous vous invitons à nous contacter par e-mail en utilisant le bouton ci-dessous. L’équipe LibTech vous répondra dans les meilleurs délais.`;

        const btnLabel = isEn ? 'Write to us' : 'Nous écrire';

        $('#page').innerHTML = `
      <section class="page article">
        <div class="hero">
          <h2>Contact</h2>
        </div>
        <div class="section">
          <p>${esc(intro)}</p>
        </div>
        <div style="
          background:#315A77;
          padding:40px 24px;
          border-radius:12px;
          margin:20px 22px 40px 22px;
          color:white;
        ">
          <h3 style="margin-top:0;">Contact</h3>
          <p style="max-width:420px; line-height:1.6;">
            ${esc(cardText)}
          </p>
          <a href="mailto:promom2sc@gmail.com"
             style="
               display:inline-block;
               margin-top:20px;
               padding:12px 24px;
               background:white;
               color:#0f172a;
               border-radius:8px;
               font-weight:600;
               text-decoration:none;
             ">
            ${esc(btnLabel)}
          </a>
        </div>
      </section>`;
    }

    function viewSoumettre() {
        const isEn = currentLang === 'en';

        const title = isEn ? 'Submit a technology' : 'Soumettre une technologie';
        const intro = isEn
            ? 'Use this section to propose a new assistive technology to be added to the LibTech directory. Fill in the form below and our team will review your submission and get back to you as soon as possible.'
            : 'Cette section permet de proposer une nouvelle technologie d’assistance à intégrer dans le répertoire LibTech. Remplissez le formulaire ci-dessous, notre équipe examinera votre dossier et vous répondra le plus rapidement possible.';

        const techInfo = isEn ? 'Information about your technology' : 'Informations sur votre technologie';
        const techName = isEn ? 'Name of the technology*' : 'Nom de la technologie*';
        const techDesc = isEn ? 'Short description*' : 'Description rapide*';
        const siteWeb = isEn ? 'Website' : 'Site web';
        const techType = isEn ? 'Type of technology*' : 'Type de technologie*';
        const techTypePh = isEn
            ? 'App, software, online platform, robot...'
            : 'Application, logiciel, plateforme en ligne, robot...';
        const target = isEn ? 'Target users*' : 'Public visé*';
        const targetPh = isEn
            ? 'General public, children, adults, older adults...'
            : 'Tout public, enfant, adulte, personne âgée...';
        const price = isEn ? 'Price*' : 'Prix*';
        const pricePh = isEn
            ? 'Free, paid, on quotation...'
            : 'Gratuit, payant, sur devis...';
        const availability = isEn ? 'Availability*' : 'Disponibilité*';
        const availabilityPh = isEn
            ? 'On the market, in development...'
            : 'Sur le marché, en cours de développement';

        const companyInfo = isEn ? 'Information about your company' : 'Informations sur votre entreprise';
        const companyName = isEn ? 'Company name*' : "Nom de l'entreprise*";
        const contactName = isEn ? 'Contact person*' : 'Nom de contact*';
        const siret = isEn ? 'SIRET number*' : 'Numéro de Siret*';
        const email = isEn ? 'Email*' : 'Email*';
        const submitLabel = isEn ? 'Send' : 'Envoyer';

        const modalText = isEn
            ? 'Thank you! Your technology has been submitted. The LibTech team will contact you if necessary.'
            : 'Merci ! Votre technologie a bien été soumise. L’équipe LibTech vous contactera si nécessaire.';
        const modalClose = isEn ? 'Close' : 'Fermer';

        $('#page').innerHTML = `
      <section class="page article">
        <div class="hero">
          <h2>${esc(title)}</h2>
        </div>
        <div class="section">
          <p>${esc(intro)}</p>
        </div>

        <form id="soumettreForm" class="section soumettre-form">
          <h3>${esc(techInfo)}</h3>

          <label>
            ${esc(techName)}
            <input name="tech_name" type="text" required>
          </label>

          <label>
            ${esc(techDesc)}
            <input name="tech_desc" type="text" required>
          </label>

          <label>
            ${esc(siteWeb)}
            <input name="tech_url" type="url">
          </label>

          <label>
            ${esc(techType)}
            <input name="tech_type" type="text" placeholder="${esc(techTypePh)}" required>
          </label>

          <label>
            ${esc(target)}
            <input name="tech_target" type="text" placeholder="${esc(targetPh)}" required>
          </label>

          <label>
            ${esc(price)}
            <input name="tech_price" type="text" placeholder="${esc(pricePh)}" required>
          </label>

          <label>
            ${esc(availability)}
            <input name="tech_availability" type="text" placeholder="${esc(availabilityPh)}" required>
          </label>

          <h3>${esc(companyInfo)}</h3>

          <label>
            ${esc(companyName)}
            <input name="company_name" type="text" required>
          </label>

          <label>
            ${esc(contactName)}
            <input name="contact_name" type="text" required>
          </label>

          <label>
            ${esc(siret)}
            <input name="siret" type="text" required>
          </label>

          <label>
            ${esc(email)}
            <input name="email" type="email" required>
          </label>

          <div class="submit-row">
            <button class="btn submit-btn" type="submit">${esc(submitLabel)}</button>
          </div>
        </form>

        <div id="soumettreModal" class="modal hidden">
          <div class="modal-box">
            <p>
              <strong>${esc(modalText)}</strong>
            </p>
            <button id="closeModal" class="btn">${esc(modalClose)}</button>
          </div>
        </div>
      </section>`;

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
        const isEn = currentLang === 'en';

        const intro = isEn
            ? 'LibTech is a collaborative platform dedicated to assistive technologies, developed within the TECH Master at the University of Bordeaux. It aims to make existing assistive solutions more accessible by offering a clear, up-to-date directory designed for everyone.'
            : 'LibTech est une plateforme collaborative dédiée aux technologies d’assistance, développée dans le cadre du Master TECH de l’Université de Bordeaux. Elle vise à rendre plus accessibles les solutions d’assistance existantes en proposant un répertoire clair, actualisé et pensé pour tous.';

        const missionTitle = isEn ? 'Mission' : 'Mission';
        const missionText = isEn
            ? 'Our mission is to make information about assistive technologies easier to access by offering a structured, reliable and easy-to-explore directory. We aim to support students, professionals, caregivers and anyone concerned by disability in finding appropriate tools.'
            : 'Notre mission est de faciliter l’accès à l’information sur les technologies d’assistance en proposant un répertoire structuré, fiable et simple à explorer. Nous souhaitons soutenir les étudiants, professionnels, aidants et toute personne concernée par le handicap dans la découverte d’outils adaptés.';

        const visionTitle = isEn ? 'Vision' : 'Vision';
        const visionText = isEn
            ? 'Our vision is to build a living, evolving resource, improved each year by new cohorts of the TECH Master. We imagine an open, sustainable and inclusive platform that accompanies digital innovation and accessible design.'
            : 'Notre vision est de construire une ressource vivante et évolutive, améliorée chaque année par les nouvelles promotions du Master TECH. Nous imaginons une plateforme ouverte, durable et inclusive, qui accompagne l’innovation numérique et la conception accessible.';

        const teamTitle = isEn ? 'Team and collaboration' : 'Équipe et collaboration';
        const teamText = isEn
            ? 'The LibTech project is carried by students of the Technologies, Ergonomics, Cognition, Disability (TECH) track. Each cohort contributes to updating the directory, designing the site and improving content accessibility. We thank the lecturers and partners for their support.'
            : 'Le projet LibTech est porté par les étudiants du parcours Technologies, Ergonomie, Cognition, Handicap (TECH). Chaque promotion contribue à la mise à jour du répertoire, au design du site et à l’accessibilité des contenus. Merci aux enseignants et aux partenaires pour leur accompagnement.';

        const currentTeamTitle = isEn
            ? 'Current team (Class of 2025–2026)'
            : 'Équipe actuelle (Promotion 2025–2026)';
        const currentTeamText = isEn
            ? 'The development of LibTech is currently ensured by the 2025–2026 cohort of the TECH Master at the University of Bordeaux. This cohort contributes to updating the directory, changing the site’s hosting and further developing the platform.'
            : 'Le développement de LibTech est assuré par la Promotion 2025–2026 du Master TECH à Université de Bordeaux. Cette promotion contribue à la mise à jour du répertoire et au changement d’hébergement du site, ainsi qu’à son développement.';

        const previousTeamTitle = isEn
            ? 'Previous team (Class of 2024–2025)'
            : 'Équipe précédente (Promotion 2024–2025)';
        const previousTeamText = isEn
            ? 'The 2024–2025 cohort made LibTech operational. We warmly thank them for their essential contribution.'
            : 'La promotion 2024–2025 a rendu LibTech fonctionnel. Nous les remercions chaleureusement pour leur contribution essentielle.';

        const supervisionTitle = isEn ? 'Supervision' : 'Encadrement';
        const supervisionText = isEn
            ? 'The project is supervised by the TECH Master teaching team, with the support of lecturers and professional partners.'
            : 'Le projet est encadré par l’équipe pédagogique du Master TECH, avec le soutien des enseignant·e·s et partenaires professionnels.';

        $('#page').innerHTML = `
      <section class="page article">
        <div class="hero">
          <h2>${isEn ? 'About' : 'À propos'}</h2>
        </div>

        <div class="section">
          <p>${esc(intro)}</p>
        </div>

        <div style="
          background:#175b67;
          padding:24px 22px 32px;
          border-radius:16px;
          margin:0 22px 32px;
          color:#ffffff;
        ">
          <div style="
            display:grid;
            grid-template-columns:1fr 1fr;
            gap:24px;
            align-items:flex-start;
          ">
            <div>
              <h3 style="margin-top:0;">${esc(missionTitle)}</h3>
              <p style="line-height:1.6;">
                ${esc(missionText)}
              </p>
            </div>

            <div>
              <h3 style="margin-top:0;">${esc(visionTitle)}</h3>
              <p style="line-height:1.6;">
                ${esc(visionText)}
              </p>
            </div>
          </div>
        </div>

        <div class="section">
          <h3>${esc(teamTitle)}</h3>
          <p>${esc(teamText)}</p>
        </div>

        <div style="
          background:#165c6f;
          padding:40px 22px 48px;
          color:#ffffff;
        ">
          <section style="max-width:720px; margin:0 auto 32px;">
            <h3>${esc(currentTeamTitle)}</h3>
            <p>${esc(currentTeamText)}</p>
          </section>

          <section style="max-width:720px; margin:0 auto 32px;">
            <h3>${esc(previousTeamTitle)}</h3>
            <p>${esc(previousTeamText)}</p>
          </section>

          <section style="max-width:720px; margin:0 auto;">
            <h3>${esc(supervisionTitle)}</h3>
            <p>${esc(supervisionText)}</p>
          </section>
        </div>
      </section>`;
    }

    function viewRepertoire() {
        const isEn = currentLang === 'en';

        const toggleLabelShow = isEn ? '☰ Show filters' : '☰ Afficher les filtres';
        const toggleLabelHide = isEn ? '✕ Hide filters' : '✕ Masquer les filtres';
        const prevText = isEn ? 'Previous' : 'Précédent';
        const nextText = isEn ? 'Next' : 'Suivant';

        $('#page').innerHTML = `
      <section class="page">
        <div class="repo-topbar">
          <button id="toggleFilters" class="filters-toggle">${esc(toggleLabelShow)}</button>
          <span class="pill" id="count" aria-live="polite">0</span>
        </div>
        <div class="repo-layout no-filters" id="repoLayout">
          <aside class="sidebar hidden" id="facetRoot" aria-label="Filtres"></aside>
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

    function viewStaticPage(title, contentHtml) {
        $('#page').innerHTML = `
      <section class="page article">
        <div class="hero"><h2>${esc(title)}</h2></div>
        <div class="section">${contentHtml}</div>
      </section>`;
    }

    function viewPlanSite() {
        const isEn = currentLang === 'en';
        if (isEn) {
            viewStaticPage(
                'Site map',
                `
      <ul>
        <li><a href="#/">Home</a></li>
        <li><a href="#/repertoire">Directory</a></li>
        <li><a href="#/soumettre">Submit a technology</a></li>
        <li><a href="#/contact">Contact</a></li>
        <li><a href="#/a-propos">About</a></li>
      </ul>`
            );
        } else {
            viewStaticPage(
                'Plan du site',
                `
      <ul>
        <li><a href="#/">Accueil</a></li>
        <li><a href="#/repertoire">Répertoire</a></li>
        <li><a href="#/soumettre">Soumettre une technologie</a></li>
        <li><a href="#/contact">Contact</a></li>
        <li><a href="#/a-propos">À propos</a></li>
      </ul>`
            );
        }
    }

    function viewMentions() {
        const isEn = currentLang === 'en';

        if (isEn) {
            viewStaticPage(
                'Legal notice',
                `
  <p class="meta">LIBTECH · Directory of assistive technologies</p>
  <p>
    Website:
    <a href="https://mael-jerez.emi.u-bordeaux.fr/libtech/" target="_blank" rel="noopener">
      https://mael-jerez.emi.u-bordeaux.fr/libtech/
    </a>
  </p>

  <h2>Publisher</h2>
  <p>
    This site is published as part of the LIBTECH project, whose objective is to list and promote
    technologies and services that support inclusion and digital accessibility.
  </p>

  <div style="
    padding:18px 16px;
    border:1px solid var(--border);
    border-radius:12px;
    background:#fafafa;
    margin:12px 0 20px;
  ">
    <p><strong>Publisher:</strong> LIBTECH</p>
    <p><strong>Publication manager:</strong> Maël JEREZ</p>
    <p>
      <strong>Postal address:</strong> 351 Cours de la Libération, 33400 Talence, France<br>
      <strong>E-mail:</strong> <a href="mailto:promom2sc@gmail.com">promom2sc@gmail.com</a>
    </p>
  </div>

  <h2>Hosting</h2>
  <p>
    The site is hosted by CREMI, the IT resources center of the University of Bordeaux.
  </p>

  <div style="
    padding:18px 16px;
    border:1px solid var(--border);
    border-radius:12px;
    background:#fafafa;
    margin:12px 0 20px;
  ">
    <p><strong>Host:</strong> CREMI — Université de Bordeaux</p>
    <p>
      <strong>Website:</strong>
      <a href="https://mael-jerez.emi.u-bordeaux.fr/libtech/" target="_blank" rel="noopener">
        https://mael-jerez.emi.u-bordeaux.fr/libtech/
      </a>
    </p>
    <p><strong>Postal address:</strong> 351 Cours de la Libération, 33400 Talence, France</p>
  </div>

  <h2>Liability</h2>
  <p>
    The information on this site is provided for information purposes only.
    Despite the care taken in updating it, some data may contain errors or be incomplete.
    The site may contain links to other resources whose content we do not control.
  </p>

  <h2>Accessibility</h2>
  <p>
    LIBTECH is engaged in a process aimed at promoting digital accessibility.
    To report a difficulty or suggest an improvement, please write to
    <a href="mailto:promom2sc@gmail.com">promom2sc@gmail.com</a>.
  </p>

  <hr>
  <p class="meta">© LIBTECH</p>
      `
            );
        } else {
            viewStaticPage(
                'Mentions légales',
                `
  <p class="meta">LIBTECH · Répertoire des technologies accessibles</p>
  <p>
    Adresse du site :
    <a href="https://mael-jerez.emi.u-bordeaux.fr/libtech/" target="_blank" rel="noopener">
      https://mael-jerez.emi.u-bordeaux.fr/libtech/
    </a>
  </p>

  <h2>Éditeur du site</h2>
  <p>
    Ce site est édité dans le cadre du projet LIBTECH, ayant pour objectif de recenser et valoriser des technologies
    et services favorisant l’inclusion et l’accessibilité numérique.
  </p>

  <div style="
    padding:18px 16px;
    border:1px solid var(--border);
    border-radius:12px;
    background:#fafafa;
    margin:12px 0 20px;
  ">
    <p><strong>Éditeur :</strong> LIBTECH</p>
    <p><strong>Responsable de publication :</strong> Maël JEREZ</p>
    <p>
      <strong>Adresse postale :</strong> 351 Cours de la Libération, 33400 Talence, France<br>
      <strong>E-mail :</strong> <a href="mailto:promom2sc@gmail.com">promom2sc@gmail.com</a>
    </p>
  </div>

  <h2>Hébergement</h2>
  <p>
    Le site est hébergé par le CREMI, Centre de Ressources Informatiques de l’Université de Bordeaux.
  </p>

  <div style="
    padding:18px 16px;
    border:1px solid var(--border);
    border-radius:12px;
    background:#fafafa;
    margin:12px 0 20px;
  ">
    <p><strong>Hébergeur :</strong> CREMI — Université de Bordeaux</p>
    <p>
      <strong>Adresse du site :</strong>
      <a href="https://mael-jerez.emi.u-bordeaux.fr/libtech/" target="_blank" rel="noopener">
        https://mael-jerez.emi.u-bordeaux.fr/libtech/
      </a>
    </p>
    <p><strong>Adresse postale :</strong> 351 Cours de la Libération, 33400 Talence, France</p>
  </div>

  <h2>Responsabilité</h2>
  <p>
    Les informations présentes sur ce site sont fournies à titre indicatif. Malgré le soin apporté à leur mise à jour,
    certaines données peuvent contenir des erreurs ou ne pas être entièrement à jour. Le site peut contenir des liens vers
    d’autres ressources, dont nous ne contrôlons pas le contenu.
  </p>

  <h2>Accessibilité</h2>
  <p>
    LIBTECH s’engage dans une démarche visant à promouvoir l’accessibilité numérique.
    Pour signaler une difficulté ou proposer une amélioration, vous pouvez nous écrire à 
    <a href="mailto:promom2sc@gmail.com">promom2sc@gmail.com</a>.
  </p>

  <hr>
  <p class="meta">© LIBTECH</p>
      `
            );
        }
    }

    function viewConfidentialite() {
        const isEn = currentLang === 'en';

        if (isEn) {
            viewStaticPage(
                'Privacy policy',
                `
  <p class="meta">Last update: 2025</p>

  <p>
    This policy explains how the LIBTECH site collects, uses and protects information about its visitors.
    It aims to ensure transparency and compliance with data-protection regulations.
    It does not constitute legal advice, and we recommend seeking professional counsel for specific questions.
  </p>

  <p>
    LIBTECH is an academic project whose goal is to list inclusive technologies.
    You can browse the entire site without creating an account and without providing personal data.
  </p>

  <h2>Information collected</h2>
  <p>
    The site does not collect personal data for advertising or commercial purposes.
    Technical information such as IP address, time of connection or pages visited may be logged automatically
    by the servers of the University of Bordeaux for security and operational purposes.
    LIBTECH does not actively exploit these data and does not use them for individual tracking.
  </p>
  <p>
    If you contact us by e-mail, we will receive your e-mail address and the content of your message.
  </p>

  <h2>Collection methods</h2>
  <p>
    There is no registration system on the site.
    The only personal information that may be collected is that which you voluntarily send us, mainly via e-mail.
  </p>

  <h2>Storage and sharing of data</h2>
  <p>
    The site is hosted by the IT resources center of the University of Bordeaux.
    Technical server information is managed in accordance with institutional practices.
  </p>
  <p>
    E-mails we receive are processed solely in order to respond.
    No data is sold, transferred or shared with third parties, except where legally required.
  </p>

  <h2>Communication with users</h2>
  <p>
    We only contact you if you write to us.
    Exchanges are carried out exclusively by e-mail and only to answer your questions or comments.
  </p>

  <h2>Cookies</h2>
  <p>
    No advertising cookies are used.
    Only technical cookies may be present to ensure the proper functioning of the site, without personalised tracking.
  </p>

  <h2>Your rights</h2>
  <p>
    If you have sent us information by e-mail, you may request to consult, modify or delete it
    by writing to:
    <a href="mailto:promom2sc@gmail.com">promom2sc@gmail.com</a>.
  </p>

  <h2>Updates</h2>
  <p>
    This policy may be updated at any time to reflect changes to the site or to legal obligations.
    The most recent version is always available on this page.
  </p>

  <hr>
  <p class="meta">
    For any question about this privacy policy, please contact:
    <a href="mailto:promom2sc@gmail.com">promom2sc@gmail.com</a>.
  </p>
      `
            );
        } else {
            viewStaticPage(
                'Politiques de confidentialité',
                `
  <p class="meta">Dernière mise à jour : 2025</p>

  <p>
    Ces politiques expliquent comment le site LIBTECH recueille, utilise et protège les informations concernant ses visiteurs.
    Elle vise à garantir la transparence et le respect de la réglementation en matière de protection des données personnelles.
    Elle ne constitue pas un conseil juridique et il est recommandé de solliciter un avis professionnel pour toute question spécifique.
  </p>

  <p>
    LIBTECH est un projet universitaire visant à répertorier des technologies inclusives.
    Vous pouvez consulter l’intégralité du site sans créer de compte et sans transmettre d’informations personnelles.
  </p>

  <h2>Informations recueillies</h2>
  <p>
    Le site ne collecte aucune donnée personnelle à des fins publicitaires ou commerciales.
    Des informations techniques telles que l’adresse IP, l’heure de connexion ou la page consultée peuvent être enregistrées automatiquement
    par le serveur de l’Université de Bordeaux pour des raisons de sécurité et de fonctionnement.
    LIBTECH n’exploite pas activement ces données et ne les utilise pas à des fins d’analyse individuelle.
  </p>
  <p>
    Si vous nous contactez par e-mail, nous recevrons votre adresse e-mail et le contenu de votre message.
  </p>

  <h2>Méthodes de collecte</h2>
  <p>
    Le site ne comporte pas de système d’inscription. Les seules informations personnelles pouvant être collectées
    sont celles que vous choisissez de nous transmettre volontairement, principalement par e-mail.
  </p>

  <h2>Stockage et partage des données</h2>
  <p>
    Le site est hébergé par le Centre de Ressources Informatiques de l’Université de Bordeaux.
    Les informations techniques du serveur sont gérées conformément aux pratiques institutionnelles.
  </p>
  <p>
    Les e-mails reçus sont traités uniquement pour répondre aux messages.
    Aucune donnée n’est vendue, cédée ou partagée avec des tiers, sauf obligation légale.
  </p>

  <h2>Communication avec les utilisateurs</h2>
  <p>
    Nous ne vous contactons que si vous nous écrivez.
    Les échanges se font exclusivement par e-mail et uniquement pour répondre à vos questions ou remarques.
  </p>

  <h2>Cookies</h2>
  <p>
    Aucun cookie publicitaire n’est utilisé.
    Seuls des cookies techniques peuvent être présents afin d’assurer le bon fonctionnement du site, sans suivi personnalisé.
  </p>

  <h2>Vos droits</h2>
  <p>
    Si vous nous avez transmis des informations par e-mail, vous pouvez demander leur consultation, modification ou suppression
    en nous écrivant à :
    <a href="mailto:promom2sc@gmail.com">promom2sc@gmail.com</a>.
  </p>

  <h2>Mises à jour</h2>
  <p>
    Ces politiques peuvent être modifiées à tout moment afin de refléter l’évolution du site ou des obligations légales.
    La version la plus récente est toujours disponible sur cette page.
  </p>

  <hr>
  <p class="meta">
    Pour toute question concernant ces politiques de confidentialité, contactez :
    <a href="mailto:promom2sc@gmail.com">promom2sc@gmail.com</a>.
  </p>
      `
            );
        }
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

    window.addEventListener('hashchange', route);

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
        let fs = 'clamp(14px, 1.6vw, 16px)';
        let fsSm = 'clamp(12px, 1.2vw, 14px)';

        if (choice === 'grand') {
            fs = 'clamp(16px, 1.9vw, 18px)';
            fsSm = 'clamp(14px, 1.5vw, 16px)';
        } else if (choice === 'très grand') {
            fs = 'clamp(18px, 2.2vw, 20px)';
            fsSm = 'clamp(16px, 1.8vw, 18px)';
        }

        const root = document.documentElement;
        root.style.setProperty('--fs', fs);
        root.style.setProperty('--fs-sm', fsSm);
    }

    // Font size selector (AAA)
    // Font size selector (AAA) – change CSS variables --fs / --fs-sm
    const fontSelect = $('#font');
    if (fontSelect) {
        const savedChoice = localStorage.getItem('libtechFontChoice') || 'normal';
        applyFontChoice(savedChoice);
        fontSelect.value = savedChoice;

        fontSelect.addEventListener('change', () => {
            const val = fontSelect.value; // "normal" | "grand" | "très grand"
            applyFontChoice(val);
            localStorage.setItem('libtechFontChoice', val);
        });
    }



    const backToTopLink = document.querySelector('.footer-top-link');
    if (backToTopLink) {
        backToTopLink.addEventListener('click', (e) => {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    // ------------------------------------------------------------
    // 11. Démarrage
    // ------------------------------------------------------------
    (async function init() {
        await loadCSV(CSV_URL);
    })();
})();
