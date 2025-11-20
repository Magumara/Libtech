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

  // Échappe les caractères HTML sensibles pour éviter les injections
  const esc = (s) =>
    String(s ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');

  // Transforme un texte en slug (pour les URLs internes)
  const slug = (s) =>
    String(s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

  // Détection simplifiée d’URL / d’URL d’image
  const isUrl = (v) => /^(https?:)?\/\//i.test(String(v));
  const isImg = (v) => /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(String(v));

  // ------------------------------------------------------------
  // 3. État global (données en mémoire, index, filtres actifs)
  // ------------------------------------------------------------
  let rows = [];              // lignes du CSV
  let headers = [];           // noms de colonnes
  let bySlug = new Map();     // index slug -> ligne
  let expandedFacets = new Set(); // catégories dont on a cliqué "Voir plus"

  // Filtres actifs par catégorie (libellés visibles dans l’UI)
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

  // Pagination : nombre d’éléments par page et page courante
  const PAGE_SIZE = 12;
  let currentPage = 1;

  // Colonnes d’images dans le CSV (déduites au chargement)
  let imageHeader = null;
  let imageDescHeader = null;


  // ------------------------------------------------------------
  // 4. Mapping logique des colonnes du CSV
  //    (permet de changer légèrement les en-têtes sans casser le code)
  // ------------------------------------------------------------
  const COL = {
    name:        { base: ['Nom'],                                suffix: true },
    description: { base: ['Description'],                        suffix: true },
    needs:       { base: ['Besoin', 'Besoins'],                  suffix: true },
    technology:  { base: ['Technologie', 'Type de technologie'], suffix: true },
    age:         { base: ["Tranche d'âge", "Tranche d'age"],     suffix: true },
    disability:  { base: ['Handicap'],                           suffix: true },
    langs:       { base: ['Langue', 'Langues'],                  suffix: true },
    price:       { base: ['Prix', 'Tarif', 'Coût', 'Cout'],      suffix: true },
    location:    { base: ['Localisation', 'Pays'],               suffix: true },
  };

  const headersIndex = () => {
    const map = new Map();
    headers.forEach((h) => map.set(String(h || '').trim().toLowerCase(), h));
    return map;
  };

  const findHeader = (cand) =>
    headers.find((h) => new RegExp(`^${cand}$`, 'i').test(h)) || null;

  /**
   * Recherche le nom de colonne correspondant à une clé logique (COL).
   * Stratégie :
   *  - tente Base_fr puis Base
   *  - sinon, tente une correspondance "souple" sur la base
   */
  function pickHeader(key) {
    const info = COL[key];
    if (!info) return null;

    const H = headersIndex();
    const candidates = [];

    // Priorité : "Nom_fr" puis "Nom"
    for (const b of info.base) {
      if (info.suffix) candidates.push(`${b}_fr`);
      candidates.push(b);
    }

    for (const c of candidates) {
      const exact = findHeader(c);
      if (exact) return exact;
      const loose = H.get(c.toLowerCase());
      if (loose) return loose;
    }

    // Dernier recours : match partiel sur la base
    for (const b of info.base) {
      for (const h of headers) {
        if (new RegExp(b, 'i').test(h)) return h;
      }
    }
    return null;
  }

  /** Récupère la valeur d’une colonne logique pour une ligne donnée */
  function pickValue(row, key) {
    const h = pickHeader(key);
    const v = h && row[h] != null ? String(row[h]).trim() : '';
    return v || '';
  }

  /** Colonne "Nom" utilisée pour trier et nommer les éléments */
  const nameKey = () => pickHeader('name') || headers[0] || 'Nom';

  // ------------------------------------------------------------
  // 5. Chargement du CSV (PapaParse)
  // ------------------------------------------------------------
  function loadCSV(url) {
    return new Promise((resolve, reject) => {
      // Ajout d’un paramètre anti-cache (force un nouveau téléchargement)
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

          const nkey = nameKey();
          rows = data.map((r, i) => ({
            ...r,
            __slug: slug(r[nkey] || `item-${i}`),
          }));

          bySlug = new Map(rows.map((r) => [r.__slug, r]));


          // Détection des colonnes Image et Description_Image (une seule fois)
          imageHeader = headers.find(h => /^image(_fr)?$/i.test(h)) || null;
          imageDescHeader = headers.find(h => /^description[_ ]?image(_fr)?$/i.test(h)) || null;

          // Tri global par nom
          rows.sort((a, b) =>
            String(a[nkey] || '').localeCompare(String(b[nkey] || ''), 'fr', {
              sensitivity: 'base',
            })
          );

          route(); // Affiche la vue correspondant au hash courant
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

  // Rafraîchit automatiquement les données lorsque l’onglet redevient actif
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      loadCSV(CSV_URL);
    }
  });

  // ------------------------------------------------------------
  // 6. Filtres (facettes) : définition, valeurs, application
  // ------------------------------------------------------------
  const facetDefs = () => [
    { key: 'needs',       label: 'Besoin' },
    { key: 'technology',  label: 'Technologie' },
    { key: 'age',         label: "Tranche d'âge" },
    { key: 'disability',  label: 'Handicap' },
    { key: 'langs',       label: 'Langue' },
    { key: 'price',       label: 'Prix' },
    { key: 'location',    label: 'Localisation' },
  ];

  /**
   * Calcule les valeurs distinctes pour chaque facette
   * (ex : tous les handicaps présents dans les lignes)
   */
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

  /**
   * Vérifie si une ligne correspond aux filtres courants.
   * Logique : la ligne est retenue si elle match AU MOINS une des valeurs cochées
   * dans l’ensemble des filtres (mode "OU global").
   */
  function matchRow(row) {
    const anySelected = Array.from(activeTokens.values()).some(
      (set) => set.size > 0
    );
    if (!anySelected) return true;

    for (const f of facetDefs()) {
      const selected = activeTokens.get(f.label);
      if (!selected?.size) continue;

      const tokens = pickValue(row, f.key)
        .split(',')
        .map((s) => s.trim());

      if (tokens.some((val) => selected.has(val))) return true;
    }
    return false;
  }

  /**
   * Construit l’HTML des filtres (cases à cocher + bouton Voir plus/Voir moins),
   * puis branche les événements.
   */
  function renderFacets(intoEl) {
    const facets = facetValues();

    const html = Object.entries(facets)
      .map(([label, values]) => {
        const all = values;
        const isExpanded = expandedFacets.has(label);
        const visible = isExpanded ? all : all.slice(0, 5);

        const options =
          visible
            .map((v) => {
              const checked = activeTokens.get(label)?.has(v) ? 'checked' : '';
              return `
                <label class="opt">
                  <input type="checkbox" data-facet="${esc(label)}" value="${esc(
                v
              )}" ${checked}>
                  ${esc(v)}
                </label>`;
            })
            .join('') || '<div class="opt">(aucun)</div>';

        const moreBtn =
          all.length > 5
            ? `<button class="see-more" data-facet-toggle="${esc(
                label
              )}">${isExpanded ? 'Voir moins' : 'Voir plus'}</button>`
            : '';

        return `<div class="facet"><h4>${esc(label)}</h4>${options}${moreBtn}</div>`;
      })
      .join('');

    intoEl.innerHTML = html;

    // Clic sur une case à cocher → mise à jour des filtres + rafraîchissement des cartes
    intoEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const label = cb.getAttribute('data-facet');
        const set = activeTokens.get(label);
        if (cb.checked) set.add(cb.value); else set.delete(cb.value);
        currentPage = 1;                 // Retour à la première page
        applyFiltersAndRenderCards();
      });
    });

    // Boutons "Voir plus"/"Voir moins"
    intoEl.querySelectorAll('.see-more').forEach((btn) => {
      btn.addEventListener('click', () => {
        const label = btn.getAttribute('data-facet-toggle');
        if (expandedFacets.has(label)) expandedFacets.delete(label);
        else expandedFacets.add(label);
        renderFacets(intoEl); // Re-rend uniquement le bloc filtres
      });
    });
  }

  const renderAllFacetBlocks = () => {
    const container = $('#facetRoot');
    if (container) renderFacets(container);
  };

  // ------------------------------------------------------------
  // 7. Affichage des cartes + recherche globale
  // ------------------------------------------------------------
  function card(r) {
    const nkey = nameKey();
    const name = r[nkey] || '(sans nom)';
    const desc = pickValue(r, 'description');
    const short = String(desc || '').length > 140
      ? String(desc).slice(0, 140).trim() + '…'
      : (desc || '');

    // Récupération du lien d’image et du texte de fallback depuis le CSV
    const imgUrl = imageHeader ? String(r[imageHeader] || '').trim() : '';
    const imgAlt = imageDescHeader ? String(r[imageDescHeader] || '').trim() : '';

    return `
      <article class="card" tabindex="0" role="button" aria-label="${esc(name)}" data-slug="${esc(r.__slug)}">
        <div class="card-thumb">
          ${
            imgUrl && isUrl(imgUrl) && isImg(imgUrl)
              ? `<img src="${esc(imgUrl)}"
                      alt="${esc(imgAlt || name)}"
                      onerror="this.style.display='none'; if(this.nextElementSibling){this.nextElementSibling.style.display='block';}" />`
              : ''
          }
          ${
            imgAlt
              ? `<span class="card-thumb-fallback" style="${imgUrl ? 'display:none;' : ''}">${esc(imgAlt)}</span>`
              : ''
          }
        </div>
        <div class="title"><em><strong>${esc(name)}</strong></em></div>
        <div class="desc">
          ${short ? esc(short) : '<span class="meta">Pas de description</span>'}
          <a href="#/repertoire/${esc(r.__slug)}">Voir plus…</a>
        </div>
      </article>`;
  }


  /**
   * Applique les filtres + la recherche texte, puis met à jour la grille de cartes.
   */
  function applyFiltersAndRenderCards() {
    const nkey = nameKey();
    const grid = $('#gridRoot');
    const count = $('#count');

    // Recherche globale : champ du header (#q) uniquement sur le répertoire
    let q = '';
    if (location.hash.startsWith('#/repertoire')) {
      q = ($('#q')?.value || '').trim().toLowerCase();
    }

    // 1) Filtrage par facettes + recherche
    let list = rows.filter(matchRow);
    if (q.length >= 2) {
      list = list.filter(r =>
        Object.values(r).some(v => String(v).toLowerCase().includes(q))
      );
    }

    // Tri alphabétique par nom
    list.sort((a, b) =>
      String(a[nkey] || '').localeCompare(String(b[nkey] || ''), 'fr', { sensitivity: 'base' })
    );

    // 2) Gestion de la pagination
    const totalItems = list.length;
    const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));

    if (currentPage > totalPages) currentPage = totalPages;
    if (currentPage < 1) currentPage = 1;

    const start = (currentPage - 1) * PAGE_SIZE;
    const pageRows = list.slice(start, start + PAGE_SIZE);

    // 3) Rendu des cartes de la page courante
    grid.innerHTML = pageRows.length
      ? pageRows.map(card).join('')
      : `<div class="meta">Aucun résultat.</div>`;

    // Affichage du nombre total d’éléments (sur toutes les pages)
    count.textContent = totalItems === 1 ? '1 élément' : `${totalItems} éléments`;

    // 4) Mise à jour de la barre de pagination (page X / Y + état des boutons)
    const info = $('#pageInfo');
    const prevBtn = $('#prevPage');
    const nextBtn = $('#nextPage');

    if (info) {
      info.textContent = totalItems === 0
        ? '0 résultat'
        : `Page ${currentPage} / ${totalPages}`;
    }
    if (prevBtn) prevBtn.disabled = currentPage <= 1 || totalItems === 0;
    if (nextBtn) nextBtn.disabled = currentPage >= totalPages || totalItems === 0;

    // 5) Navigation par carte (clic ou clavier)
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
  // 8. Vues (Accueil, Contact, À propos, Répertoire, Détail, Soumettre, etc.)
  // ------------------------------------------------------------

  function viewHome() {
    $('#page').innerHTML = `
      <section class="page">
        <div class="home-hero">
          <div class="home-search">
            <h2>La plateforme de référence pour les technologies d'assistances</h2>
            <p>LibTech est une plateforme collaborative dédiée aux technologies d’assistance, 
            développée dans le cadre du Master TECH de l’Université de Bordeaux. 
            Elle vise à rendre plus accessibles les solutions d’assistance existantes en proposant un répertoire clair, 
            actualisé et pensé pour tous. </p>
            <form id="homeSearchForm" class="search-wrap" role="search">
              <input id="homeSearchInput" type="search"
                     placeholder="Rechercher une technologie d'assistance..."
                     autocomplete="off">
              <button class="btn" type="submit">Rechercher</button>
            </form>
          </div>
        </div>
      </section>`;

    // Mise au focus automatique du champ de recherche
    setTimeout(() => $('#homeSearchInput')?.focus(), 100);

    // Soumission : recopie la requête dans la barre du header et ouvre le répertoire
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
    $('#page').innerHTML = `
      <section class="page article">
        <div class="hero">
          <h2>Contact</h2>
        </div>
        <div class="section">
          <p>
            Où que vous soyez, si vous avez une question sur LibTech,
            une suggestion de technologie d’assistance ou une correction à proposer,
            n’hésitez pas à nous écrire.
            <br>
            Nous serons ravis d’échanger avec vous.
          </p>
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
            Nous vous invitons à nous contacter par e-mail en utilisant le bouton ci-dessous.
            L’équipe LibTech vous répondra dans les meilleurs délais.
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
            Nous écrire
          </a>
        </div>
      </section>`;
  }

  function viewSoumettre() {
    $('#page').innerHTML = `
      <section class="page article">
        <div class="hero">
          <h2>Soumettre une technologie</h2>
        </div>
        <div class="section">
          <p>
            Cette section permet de proposer une nouvelle technologie d’assistance à intégrer dans le répertoire LibTech. 
            Remplissez le formulaire ci-dessous, notre équipe examinera votre dossier et vous répondra le plus rapidement possible.
          </p>
        </div>

        <form id="soumettreForm" class="section soumettre-form">
          <h3>Informations sur votre technologie</h3>

          <label>
            Nom de la technologie*
            <input name="tech_name" type="text" required>
          </label>

          <label>
            Description rapide*
            <input name="tech_desc" type="text" required>
          </label>

          <label>
            Site web
            <input name="tech_url" type="url">
          </label>

          <label>
            Type de technologie*
            <input name="tech_type" type="text" placeholder="Application, logiciel, plateforme en ligne, robot..." required>
          </label>

          <label>
            Public visé*
            <input name="tech_target" type="text" placeholder = "Tout public, enfant, adulte, personne agée..." required>
          </label>

          <label>
            Prix*
            <input name="tech_type" type="text" placeholder="Gratuit, Payant, Sur devis..." required>
          </label>

          <label>
            Disponibilité*
            <input name="tech_type" type="text" placeholder="Sur le marché, en cours de développement" required>
          </label>


          <h3>Informations sur votre entreprise</h3>

          <label>
            Nom de l'entreprise*
            <input name="author" type="text" required>
          </label>

          <label>
            Nom de contact*
            <input name="author" type="text" required>
          </label>


          <label>
            Numéro de Siret*
            <input name="author" type="text" required>
          </label>

          <label>
            Email*
            <input name="email" type="email" required>
          </label>

          <div class="submit-row">
            <button class="btn submit-btn" type="submit">Envoyer</button>
          </div>
        </form>

        <div id="soumettreModal" class="modal hidden">
          <div class="modal-box">
            <p>
              <strong>
                Merci ! Votre technologie a bien été soumise.<br>
                L’équipe LibTech vous contactera si nécessaire.
              </strong>
            </p>
            <button id="closeModal" class="btn">Fermer</button>
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
    $('#page').innerHTML = `
      <section class="page article">
        <div class="hero">
          <h2>À propos</h2>
        </div>

        <div class="section">
          <p>
            LibTech est une plateforme collaborative dédiée aux technologies d’assistance,
            développée dans le cadre du Master TECH de l’Université de Bordeaux.
            Elle vise à rendre plus accessibles les solutions d’assistance existantes en
            proposant un répertoire clair, actualisé et pensé pour tous.
          </p>
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
              <h3 style="margin-top:0;">Mission</h3>
              <p style="white-space; line-height:1.6;">
                Notre mission est de faciliter l’accès
                à l’information sur les technologies
                d’assistance en proposant un répertoire structuré,
                fiable et simple à explorer.
                Nous souhaitons soutenir les
                étudiants, professionnels, aidants
                et toute personne concernée par le
                handicap dans la découverte d’outils
                adaptés.
              </p>
            </div>

            <div>
              <h3 style="margin-top:0;">Vision</h3>
              <p style="white-space; line-height:1.6;">
                Notre vision est de construire une
                ressource vivante et évolutive,
                améliorée chaque année par les
                nouvelles promotions du Master TECH.
                Nous imaginons une plateforme
                ouverte, durable et inclusive,
                qui accompagne l’innovation
                numérique et la conception accessible.
              </p>
            </div>
          </div>
        </div>

        <div class="section">
          <h3>Équipe et collaboration</h3>
          <p>
            Le projet LibTech est porté par les étudiants du parcours Technologies, Ergonomie,
            Cognition, Handicap (TECH).
            Chaque promotion contribue à la mise à jour du répertoire, au design du site et à
            l’accessibilité des contenus.
            Merci aux enseignants et aux partenaires pour leur accompagnement.
          </p>
        </div>

        <div style="
          background:#165c6f;
          padding:40px 22px 48px;
          color:#ffffff;
        ">
          <section style="max-width:720px; margin:0 auto 32px;">
            <h3>Équipe actuelle (Promotion 2025–2026)</h3>
            <p>
              Le développement de LibTech est assuré par la Promotion 2025-2026 du Master TECH à Université de Bordeaux. 
              Cette promotion contribue à la mise à jour du répertoire et au changement d’hébergement du site, ainsi qu’à son développement.
            </p>
          </section>

          <section style="max-width:720px; margin:0 auto 32px;">
            <h3>Équipe précédente (Promotion 2024–2025)</h3>
            <p>La promotion 2024-2025 a rendu LibTech fonctionnel. Nous les remercions chaleureusement pour leur contribution essentielle.</p>
          </section>

          <section style="max-width:720px; margin:0 auto;">
            <h3>Encadrement</h3>
            <p>
              Le projet est encadré par l’équipe pédagogique du Master TECH, avec le soutien des enseignant·e·s
              et partenaires professionnels.
            </p>
          </section>
        </div>
      </section>`;
  }

  function viewRepertoire() {
    $('#page').innerHTML = `
      <section class="page">
        <div class="repo-topbar">
          <button id="toggleFilters" class="filters-toggle">☰ Afficher les filtres</button>
          <span class="pill" id="count" aria-live="polite">0</span>
        </div>
        <div class="repo-layout no-filters" id="repoLayout">
          <aside class="sidebar hidden" id="facetRoot" aria-label="Filtres"></aside>
          <div>
            <div class="grid" id="gridRoot"></div>
            <div class="pagination" id="pagination">
              <button type="button" id="prevPage" class="btn pagination-btn">Précédent</button>
              <span id="pageInfo" class="pagination-info"></span>
              <button type="button" id="nextPage" class="btn pagination-btn">Suivant</button>
            </div>
          </div>
        </div>
      </section>`;

    renderAllFacetBlocks();
    applyFiltersAndRenderCards();

    // Gestion des boutons de pagination
    const prev = $('#prevPage');
    const next = $('#nextPage');

    if (prev) {
      prev.addEventListener('click', () => {
        if (currentPage > 1) {
          currentPage--;
          applyFiltersAndRenderCards();
        }
      });
    }

    if (next) {
      next.addEventListener('click', () => {
        currentPage++;                  // Le clamp se fait dans applyFiltersAndRenderCards
        applyFiltersAndRenderCards();
      });
    }    

    const btn = $('#toggleFilters');
    const layout = $('#repoLayout');
    const sidebar = $('#facetRoot');

    if (!btn || !layout || !sidebar) return;

    btn.addEventListener('click', () => {
      const isHidden = sidebar.classList.contains('hidden');
      if (isHidden) {
        sidebar.classList.remove('hidden');
        layout.classList.replace('no-filters', 'with-filters');
        btn.textContent = '✖ Masquer les filtres';
      } else {
        sidebar.classList.add('hidden');
        layout.classList.replace('with-filters', 'no-filters');
        btn.textContent = '☰ Afficher les filtres';
      }
    });
  }

  function viewDetail(slugId) {
    const row = bySlug.get(slugId);
    if (!row) {
      $('#page').innerHTML =
        '<section class="page"><p>Élément introuvable.</p><p><a class="btn" href="#/repertoire">← Retour au répertoire</a></p></section>';
      return;
    }

    const nkey = nameKey();
    const name = row[nkey] || '(sans nom)';

    const handicap = pickValue(row, 'disability');
    const besoinHeader = headers.find(
      (h) => /^(besoin|besoins)$/i.test(h) || /^besoin_?fr$/i.test(h)
    );
    const besoin = besoinHeader ? String(row[besoinHeader] || '') : '';
    const description = pickValue(row, 'description');

    // Image principale : colonne Image*/Illustration, sinon première URL d’image trouvée
    const imageHeader =
      headers.find((h) =>
        /^(image|illustration|photo|visuel)(_fr)?$/i.test(h)
      ) || headers.find((h) => isUrl(row[h]) && isImg(row[h]));
    const imageUrl = imageHeader ? String(row[imageHeader]) : '';

    const imgCapHeader = headers.find((h) =>
      /^(description[_ ]?image|legende[_ ]?image)$/i.test(h)
    );
    const imageCaption = imgCapHeader ? String(row[imgCapHeader]) : '';

    // Métadonnées et liens
    const siteHeader = headers.find((h) =>
      /^(site|url|lien|site web)$/i.test(h)
    );
    const site = siteHeader ? String(row[siteHeader]) : '';

    const localisation = pickValue(row, 'location');
    const langues = pickValue(row, 'langs');

    const dateHeader = headers.find((h) => /^(date|année)$/i.test(h));
    const dateVal = dateHeader ? String(row[dateHeader]) : '';

    const structHeader = headers.find((h) =>
      /^(structure|organisme|organisation)$/i.test(h)
    );
    const structure = structHeader ? String(row[structHeader]) : '';

    $('#page').innerHTML = `
      <section class="page article">
        <div class="sheet">
          <div class="left">
            <div class="title">${esc(name)}</div>
            <div class="line">
              <div><span class="label">Handicap :</span> ${handicap ? esc(handicap) : ''}</div>
              <div><span class="label">Besoin :</span> ${besoin ? esc(besoin) : ''}</div>
            </div>
            <div class="desc">
              <h4>Description</h4>
              <div class="descbox">${description ? esc(description) : 'Pas de description'}</div>
            </div>
          </div>

          <div class="right">
            <div class="imagebox">
              ${
                imageUrl && isUrl(imageUrl) && isImg(imageUrl)
                  ? `<img src="${esc(imageUrl)}" alt="image">`
                  : '<span>Image</span>'
              }
            </div>
            <div class="imgcap">${imageCaption ? esc(imageCaption) : ''}</div>
            <dl>
              ${
                site
                  ? `<dt>Site</dt><dd><a href="${esc(
                      site
                    )}" target="_blank" rel="noopener noreferrer">${esc(
                      site
                    )}</a></dd>`
                  : ''
              }
              ${
                localisation
                  ? `<dt>Localisation</dt><dd>${esc(localisation)}</dd>`
                  : ''
              }
              ${langues ? `<dt>Langue</dt><dd>${esc(langues)}</dd>` : ''}
              ${dateVal ? `<dt>Date</dt><dd>${esc(dateVal)}</dd>` : ''}
              ${structure ? `<dt>Structure</dt><dd>${esc(structure)}</dd>` : ''}
            </dl>
            <p style="margin-top:12px">
              <a class="btn" href="#/repertoire">← Retour au répertoire</a>
            </p>
          </div>
        </div>
      </section>`;
  }

  // ------------------------------------------------------------
  // 9. Router (changement de vue en fonction du hash)
  // ------------------------------------------------------------
  function setActiveNav() {
    const h = location.hash || '#/';

    // Met à jour l’onglet actif dans le header
    $$('a[data-nav]').forEach((a) => {
      const href = a.getAttribute('href');
      const isRepo = href === '#/repertoire' && h.startsWith('#/repertoire');
      const isExact =
        href === h || (href === '#/' && (h === '#/' || h === '#'));
      a.setAttribute('aria-current', isRepo || isExact ? 'page' : 'false');
    });

    // Classe spéciale sur le body pour l’accueil (permet de masquer la recherche dans le header)
    if (h === '#/' || h === '#') {
      document.body.classList.add('home');
    } else {
      document.body.classList.remove('home');
    }
  }

  function viewStaticPage(title, contentHtml) {
    $('#page').innerHTML = `
      <section class="page article">
        <div class="hero"><h2>${esc(title)}</h2></div>
        <div class="section">${contentHtml}</div>
      </section>`;
  }

  function viewPlanSite() {
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

  function viewMentions() {
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

  <h2>Propriété intellectuelle</h2>
  <p>
    Le contenu du site, incluant les textes, la présentation et l’organisation des informations, est protégé par la
    législation en vigueur. Les ressources et technologies répertoriées demeurent la propriété de leurs éditeurs respectifs.
  </p>
  <p>
    Toute reproduction ou utilisation substantielle du contenu sans autorisation est interdite.
  </p>

  <h2>Données personnelles</h2>
  <p>
    Aucune donnée personnelle n’est collectée automatiquement à des fins commerciales ou publicitaires. Les seules données
    recueillies sont celles que vous nous transmettez volontairement par e-mail et elles ne sont utilisées que pour répondre
    à votre message.
  </p>

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

    function viewConfidentialite() {
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

  <h2>Finalité de la collecte</h2>
  <p>
    Les informations sont utilisées uniquement pour&nbsp;:
    assurer le fonctionnement et la sécurité du site,
    répondre aux sollicitations envoyées par e-mail,
    et respecter les obligations légales liées à l’hébergement universitaire.
  </p>
  <p>
    Aucun traitement marketing ou suivi personnalisé n’est effectué.
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
    Ces politiques peuvent être modifiée à tout moment afin de refléter l’évolution du site ou des obligations légales.
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

    // Fallback : accueil
    viewHome();
  }

  window.addEventListener('hashchange', route);

  // ------------------------------------------------------------
  // 10. Comportements globaux (recherche header, langue, taille texte)
  // ------------------------------------------------------------

  // Recherche globale (champ du header)
  const qInput = $('#q');
  if (qInput) {
    qInput.addEventListener('input', () => {
      if (location.hash.startsWith('#/repertoire')) {
        currentPage = 1;
        applyFiltersAndRenderCards();
      }
    });
  }

  // Sélecteur de langue : actuellement sans effet (prévu pour i18n futur)
  const langSelect = $('#lang');
  if (langSelect) {
    langSelect.addEventListener('change', () => {
      // Logique à ajouter si une internationalisation complète est mise en place
    });
  }

  // Sélecteur de taille de texte (AAA) – agit sur la taille de base du document
  //ca marche pas c'est normal avec les nom et tout mais là c'est juste un truc généré avc GPT juste histoir d'avoir une idée du fonctionement
  const fontSelect = $('#font');
  if (fontSelect) {
    fontSelect.addEventListener('change', () => {
      const val = fontSelect.value; // ex : "small" | "medium" | "large"
      let size = '100%';
      if (val === 'small') size = '90%';
      else if (val === 'large') size = '115%';
      // "medium" ou valeur inconnue : 100 %
      document.documentElement.style.fontSize = size;
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