(() => {
  /* ============================================================
     SOURCE DES DONNÉES (CSV PUBLIC GOOGLE SHEETS)
     - Si vous changez de feuille : garder les intitulés ou ajuster le mapping COL
     ============================================================ */
  const CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTrbhCHyINYJMEBbnl_SGBujZOOUB0rw4WnXWirV9dUF_PaktI2oVM0ubMRK6B_Xw/pub?output=csv';

  /* ============================================================
     FONCTIONS UTILITAIRES (sélecteurs, échappement, formats)
     ============================================================ */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (s) => String(s == null ? '' : s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", "&#39;");
  const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const isUrl = (v) => /^(https?:)?\/\//i.test(String(v));
  const isImg = (v) => /\.(png|jpe?g|gif|webp|bmp|svg)(\?.*)?$/i.test(String(v));

  /* ============================================================
     ÉTAT GLOBAL DE L’APPLICATION
     - Données en mémoire, index, filtres actifs
     ============================================================ */
  let rows = [], headers = [], bySlug = new Map();
  let expandedFacets = new Set();

  // Éléments actifs par catégorie de filtre (libellés en français)
  let activeTokens = new Map([
    ['Besoin', new Set()],
    ['Technologie', new Set()],
    ["Tranche d'âge", new Set()],
    ['Handicap', new Set()],
    ['Langue', new Set()],
    ['Prix', new Set()],
    ['Localisation', new Set()],
  ]);

  // Correspondance des colonnes (jeu de données en français)
  const COL = {
    name: { base: ['Nom'], suffix: true },
    description: { base: ['Description'], suffix: true },
    needs: { base: ['Besoin', 'Besoins'], suffix: true },
    technology: { base: ['Technologie', 'Type de technologie', 'Type_technologie'], suffix: true },
    age: { base: ["Tranche d'âge", "Tranche d'age", "Tranche_age", "Age"], suffix: true },
    disability: { base: ['Handicap'], suffix: true },
    langs: { base: ['Langue', 'Langues'], suffix: true },
    price: { base: ['Prix', 'Tarif', 'Coût', 'Cout'], suffix: true },
    location: { base: ['Localisation', 'Pays', 'Pays fournisseurs'], suffix: true },
  };

  const headersIndex = () => { const m = new Map(); headers.forEach(h => m.set(String(h || '').trim().toLowerCase(), h)); return m; };
  const findHeader = (cand) => headers.find(h => new RegExp(`^${cand}$`, 'i').test(h)) || null;

  // Sélection d’un en-tête correspondant à une clé logique
  // Stratégie : Base_fr puis Base ; enfin, correspondance souple si besoin
  function pickHeader(key) {
    const info = COL[key]; if (!info) return null;
    const H = headersIndex(); const list = [];
    for (const b of info.base) { if (info.suffix) { list.push(b + '_fr'); } list.push(b); }
    for (const c of list) { const hit = findHeader(c) || H.get(c.toLowerCase()); if (hit) return hit; }
    for (const b of info.base) { for (const h of headers) { if (new RegExp(b, 'i').test(h)) return h; } }
    return null;
  }
  const pickValue = (row, key) => { const h = pickHeader(key); return (h && row[h] != null && String(row[h]).trim() !== '') ? row[h] : ''; };
  const nameKey = () => pickHeader('name') || headers[0] || 'Nom';

  /* ============================================================
     CHARGEMENT DU CSV (PapaParse)
     - Télécharge le CSV public et prépare les lignes/colonnes
     ============================================================ */
  async function loadCSV(url) {
    return new Promise((resolve, reject) => {
      Papa.parse(url, {
        header: true, download: true, skipEmptyLines: true,
        complete: res => {
          // Nettoyage des lignes vides
          const data = (res.data || []).filter(o => Object.values(o).some(v => String(v || '').trim() !== ''));
          headers = (res.meta?.fields || Object.keys(data[0] || {})).map(h => String(h || '').trim());
          const nkey = nameKey();
          rows = data.map((r, i) => ({ ...r, __slug: slug(r[nkey] || `item-${i}`) }));
          bySlug = new Map(rows.map(r => [r.__slug, r]));
          // Tri alphabétique par nom (insensible à la casse/accents)
          rows.sort((a, b) => String(a[nkey] || '').localeCompare(String(b[nkey] || ''), 'fr', { sensitivity: 'base' }));
          route(); resolve();
        },
        error: err => { console.error(err); alert('Erreur CSV'); reject(err); }
      });
    });
  }

  /* ============================================================
     GESTION DES FILTRES (construction, valeurs, correspondances)
     ============================================================ */
  const facetDefs = () => [
    { key: 'needs', label: 'Besoin' },
    { key: 'technology', label: 'Technologie' },
    { key: 'age', label: "Tranche d'âge" },
    { key: 'disability', label: 'Handicap' },
    { key: 'langs', label: 'Langue' },
    { key: 'price', label: 'Prix' },
    { key: 'location', label: 'Localisation' },
  ];

  // Calcule les valeurs possibles par catégorie (dédoublonnées + triées)
  function facetValues() {
    const out = new Map(); for (const f of facetDefs()) out.set(f.label, new Set());
    for (const r of rows) {
      for (const f of facetDefs()) {
        String(pickValue(r, f.key) || '')
          .split(',').map(s => s.trim()).filter(Boolean)
          .forEach(t => out.get(f.label).add(t));
      }
    }
    const obj = {};
    for (const f of facetDefs()) {
      obj[f.label] = [...out.get(f.label)].sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));
    }
    return obj;
  }

  // Logique de filtrage : correspond si AU MOINS une valeur cochée apparaît dans la ligne
  function matchRow(r) {
    const any = [...activeTokens.values()].some(s => s.size > 0); if (!any) return true;
    for (const f of facetDefs()) {
      const selected = activeTokens.get(f.label); if (!selected?.size) continue;
      const tokens = String(pickValue(r, f.key) || '').split(',').map(s => s.trim());
      if (tokens.some(v => selected.has(v))) return true;
    }
    return false;
  }

  // Rend les blocs de filtres avec bouton « Voir plus / Voir moins »
  function renderFacets(intoEl) {
    const facets = facetValues();
    const html = Object.entries(facets).map(([label, vals]) => {
      const all = vals;
      const isExpanded = expandedFacets.has(label);
      const visible = isExpanded ? all : all.slice(0, 5);

      const opts = visible.map(v => {
        const checked = activeTokens.get(label)?.has(v) ? 'checked' : '';
        return `<label class="opt"><input type="checkbox" data-facet="${esc(label)}" value="${esc(v)}" ${checked}> ${esc(v)}</label>`;
      }).join('') || '<div class="opt">(aucun)</div>';

      const moreBtn = all.length > 5
        ? `<button class="see-more" data-facet-toggle="${esc(label)}">${isExpanded ? 'Voir moins' : 'Voir plus'}</button>`
        : '';

      return `<div class="facet"><h4>${esc(label)}</h4>${opts}${moreBtn}</div>`;
    }).join('');

    intoEl.innerHTML = html;

    // Gestion des cases à cocher → mise à jour du filtre + rechargement des cartes
    intoEl.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const label = cb.getAttribute('data-facet');
        const set = activeTokens.get(label);
        if (cb.checked) set.add(cb.value); else set.delete(cb.value);
        applyFiltersAndRenderCards();
      });
    });

    // Boutons « Voir plus / Voir moins »
    intoEl.querySelectorAll('.see-more').forEach(btn => {
      btn.addEventListener('click', () => {
        const label = btn.getAttribute('data-facet-toggle');
        if (expandedFacets.has(label)) expandedFacets.delete(label);
        else expandedFacets.add(label);
        renderFacets(intoEl);
      });
    });
  }
  const renderAllFacetBlocks = () => { const s = $('#facetRoot'); if (s) renderFacets(s); };

  /* ============================================================
     AFFICHAGE DES CARTES (liste) + RECHERCHE GLOBALE
     ============================================================ */
  function card(r) {
    const nkey = nameKey();
    const name = r[nkey] || '(sans nom)';
    const desc = pickValue(r, 'description');
    const short = String(desc || '').length > 140 ? String(desc).slice(0, 140).trim() + '…' : (desc || '');
    return `
      <article class="card" tabindex="0" role="button" aria-label="${esc(name)}" data-slug="${esc(r.__slug)}">
        <div class="title"><em><strong>${esc(name)}</strong></em></div>
        <div class="desc">${short ? esc(short) : '<span class="meta">Pas de description</span>'} <a href="#/repertoire/${esc(r.__slug)}">Voir plus…</a></div>
      </article>`;
  }

  function applyFiltersAndRenderCards() {
    const nkey = nameKey();
    const grid = $('#gridRoot');
    const count = $('#count');

    // La recherche globale utilise le champ du header (#q) uniquement sur le répertoire
    let q = '';
    if (location.hash.startsWith('#/repertoire')) q = ($('#q')?.value || '').trim().toLowerCase();

    let list = rows.filter(matchRow);
    if (q.length >= 2) list = list.filter(r => Object.values(r).some(v => String(v).toLowerCase().includes(q)));

    list.sort((a, b) => String(a[nkey] || '').localeCompare(String(b[nkey] || ''), 'fr', { sensitivity: 'base' }));
    grid.innerHTML = list.map(card).join('') || `<div class="meta">Aucun résultat.</div>`;
    count.textContent = list.length === 1 ? '1 élément' : `${list.length} éléments`;

    // Navigation par carte (clic ou clavier)
    grid.querySelectorAll('.card').forEach(el => {
      el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); location.hash = `#/repertoire/${el.dataset.slug}`; } });
      el.addEventListener('click', () => location.hash = `#/repertoire/${el.dataset.slug}`);
    });
  }

  /* ============================================================
     VUES (ACCUEIL, CONTACT, À PROPOS, RÉPERTOIRE, DÉTAIL)
     ============================================================ */
  function viewHome() {
    $('#page').innerHTML = `
      <section class="page">
        <div class="home-hero">
          <div class="home-search">
            <h2>LIBTECH — Répertoire des technologies accessibles</h2>
            <p>Recherchez une techno, un besoin, une langue…</p>
            <form id="homeSearchForm" class="search-wrap" role="search">
              <input id="homeSearchInput" type="search" placeholder="Rechercher… (min 2 caractères)" autocomplete="off">
              <button class="btn" type="submit">Rechercher</button>
            </form>
          </div>
        </div>
      </section>`;

    setTimeout(() => $('#homeSearchInput')?.focus(), 100);

    $('#homeSearchForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const q = $('#homeSearchInput').value || '';
      if ($('#q')) $('#q').value = q;
      location.hash = '#/repertoire';
      setTimeout(() => applyFiltersAndRenderCards(), 0);
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
        Où que vous soyez, si vous avez une question sur LibTech, une suggestion
        de technologie d’assistance ou une correction à proposer, n’hésitez pas à nous écrire.
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
                Merci de remplir le formulaire ci-dessous.
              </p>
          </div>
  
          <form id="soumettreForm" class="section soumettre-form">
  
              <h3>Informations sur la technologie</h3>
  
              <label>
                  Nom de la technologie
                  <input name="techname" type="text" required>
              </label>
  
              <label>
                  Brève description
                  <textarea name="description" required></textarea>
              </label>
  
              <label>
                  Lien du produit / site web
                  <input name="url" type="url" required>
              </label>
  
              <label>
                  Catégorie (facultatif)
                  <input name="category" type="text">
              </label>
  
              <h3>Informations sur l’auteur</h3>
  
              <label>
                  Nom / Prénom
                  <input name="author" type="text" required>
              </label>
  
              <label>
                  Email
                  <input name="email" type="email" required>
              </label>
  
              <label class="checkbox-row">
                  <input type="checkbox" name="privacy" required>
                  <span>J'accepte la politique de confidentialité</span>
              </label>
  
              <div class="submit-row">
                  <button class="btn submit-btn" type="submit">Envoyer</button>
              </div>
          </form>
  
          <div id="soumettreModal" class="modal hidden">
              <div class="modal-box">
                  <p><strong>Merci ! Votre technologie a bien été soumise.<br>
                  L’équipe LibTech vous contactera si nécessaire.</strong></p>
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
          <p style="white-space:pre-line; line-height:1.6;">
Notre mission est de faciliter l’accès
à l’information sur les technologies
d’assistance
en proposant un répertoire structuré,
fiable et simple à explorer.
Nous souhaitons soutenir les
étudiants, professionnels, aidants
et toute personne concernée par le
handicap dans la découverte d’outils
adaptés.</p>
        </div>

        <div>
          <h3 style="margin-top:0;">Vision</h3>
          <p style="white-space:pre-line; line-height:1.6;">
Notre vision est de construire une
ressource vivante et évolutive,
améliorée chaque année par les
nouvelles promotions du Master TECH.
Nous imaginons une plateforme
ouverte, durable et inclusive,
qui accompagne l’innovation
numérique et la conception accessible.</p>
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
        <h3>Équipe actuelle (Promotion 2024–2026)</h3>
        <p>
          Le développement de LibTech est assuré par la Promotion 2024–2026 du Master TECH – Université de Bordeaux.
          Cette promotion contribue à la mise à jour du répertoire, à l’évolution du design du site et à l’amélioration
          continue de son accessibilité.
        </p>
      </section>

      <section style="max-width:720px; margin:0 auto 32px;">
        <h3>Équipe précédente (Promotion 2023–2025)</h3>
        <p>
          La Promotion 2023–2025 a posé les bases du projet LibTech, en définissant la structure initiale du répertoire
          ainsi que les orientations générales du design et de l’accessibilité.
          Nous les remercions chaleureusement pour leur contribution essentielle.
        </p>
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
          <div><div class="grid" id="gridRoot"></div></div>
        </div>
      </section>`;

    renderAllFacetBlocks();
    applyFiltersAndRenderCards();

    const btn = $('#toggleFilters');
    const layout = $('#repoLayout');
    const sidebar = $('#facetRoot');
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
    const r = bySlug.get(slugId);
    if (!r) {
      $('#page').innerHTML = `<section class="page"><p>Élément introuvable.</p><p><a class="btn" href="#/repertoire">← Retour au répertoire</a></p></section>`;
      return;
    }
    const nkey = nameKey();
    const name = r[nkey] || '(sans nom)';

    const handicap = pickValue(r, 'disability');
    const besoinHeader = headers.find(h => /^(besoin|besoins)$/i.test(h) || /^besoin_?fr$/i.test(h));
    const besoin = besoinHeader ? (r[besoinHeader] || '') : '';
    const description = pickValue(r, 'description');

    const imageHeader = headers.find(h => /^(image|illustration|photo|visuel)(_fr)?$/i.test(h)) || headers.find(h => isUrl(r[h]) && isImg(r[h]));
    const imageUrl = imageHeader ? String(r[imageHeader]) : '';
    const imgCapHeader = headers.find(h => /^(description[_ ]?image|legende[_ ]?image)$/i.test(h));
    const imageCaption = imgCapHeader ? String(r[imgCapHeader]) : '';

    const siteHeader = headers.find(h => /^(site|url|lien|site web)$/i.test(h));
    const site = siteHeader ? String(r[siteHeader]) : '';
    const localisation = pickValue(r, 'location');
    const langues = pickValue(r, 'langs');
    const dateHeader = headers.find(h => /^(date|année)$/i.test(h));
    const dateVal = dateHeader ? String(r[dateHeader]) : '';
    const structHeader = headers.find(h => /^(structure|organisme|organisation)$/i.test(h));
    const structure = structHeader ? String(r[structHeader]) : '';

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
              ${imageUrl && isUrl(imageUrl) && isImg(imageUrl) ? `<img src="${esc(imageUrl)}" alt="image">` : `<span>Image</span>`}
            </div>
            <div class="imgcap">${imageCaption ? esc(imageCaption) : ''}</div>
            <dl>
              ${site ? `<dt>Site</dt><dd><a href="${esc(site)}" target="_blank" rel="noopener noreferrer">${esc(site)}</a></dd>` : ''}
              ${localisation ? `<dt>Localisation</dt><dd>${esc(localisation)}</dd>` : ''}
              ${langues ? `<dt>Langue</dt><dd>${esc(langues)}</dd>` : ''}
              ${dateVal ? `<dt>Date</dt><dd>${esc(dateVal)}</dd>` : ''}
              ${structure ? `<dt>Structure</dt><dd>${esc(structure)}</dd>` : ''}
            </dl>
            <p style="margin-top:12px"><a class="btn" href="#/repertoire">← Retour au répertoire</a></p>
          </div>
        </div>
      </section>`;
  }

  /* ============================================================
     ROUTEUR (mise à jour de la vue en fonction du hash)
     ============================================================ */
  function setActiveNav() {
    const h = location.hash || '#/';
    $$('a[data-nav]').forEach(a => {
      const href = a.getAttribute('href');
      const isRepo = href === '#/repertoire' && h.startsWith('#/repertoire');
      const isExact = href === h || (href === '#/' && (h === '#' || h === '#/'));
      a.setAttribute('aria-current', (isRepo || isExact) ? 'page' : 'false');
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
    if (mDetail) { viewDetail(mDetail[1]); return; }
    if (h.startsWith('#/repertoire')) { viewRepertoire(); return; }
    if (h === '#/' || h === '#') { viewHome(); return; }
    if (h === "#/contact") { viewContact(); return; }
    if (h === "#/a-propos") { viewAbout(); return; }
    if (h === "#/soumettre") { viewSoumettre(); return; }

    if (h === "#/plan-du-site") { $('#page').innerHTML = `<section class="page article"><div class="hero"><h2>Plan du site</h2></div><div class="section"><p>(Contenu à compléter.)</p></div></section>`; return; }
    if (h === "#/mentions-legales") { $('#page').innerHTML = `<section class="page article"><div class="hero"><h2>Mentions légales</h2></div><div class="section"><p>(Contenu à compléter.)</p></div></section>`; return; }
    if (h === "#/confidentialite") { $('#page').innerHTML = `<section class="page article"><div class="hero"><h2>Politique de confidentialité</h2></div><div class="section"><p>(Contenu à compléter.)</p></div></section>`; return; }
    viewHome();
  }



  window.addEventListener('hashchange', route);

  /* ============================================================
     COMPORTEMENTS GLOBAUX (recherche, langue, police)
     ============================================================ */
  $('#q').addEventListener('input', () => {
    if (location.hash.startsWith('#/repertoire')) applyFiltersAndRenderCards();
  });

  $('#lang').addEventListener('change', () => { });

  $('#font').addEventListener('change', () => {
    const v = $('#font').value;
    document.body.style.fontFamily = v === 'system' ? '' : (v === 'serif' ? 'Georgia,serif' : 'ui-monospace, Menlo, Consolas, "Courier New", monospace');
  });

  /* ============================================================
     DÉMARRAGE DE L’APPLICATION
     ============================================================ */
  (async function init() { await loadCSV(CSV_URL); })();
})();
