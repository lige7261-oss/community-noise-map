'use strict';

const sections = [...document.querySelectorAll('.project-section')];
const navigation = [...document.querySelectorAll('.section-nav a')];
if ('IntersectionObserver' in window) {
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.documentElement.classList.add('js');
    const revealObserver = new IntersectionObserver((entries, observer) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.remove('pending');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.04 });
    sections.forEach((section) => {
      section.classList.add('pending');
      revealObserver.observe(section);
    });
  }
  const sectionObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        navigation.forEach((link) => {
          const active = link.hash === `#${entry.target.id}`;
          link.classList.toggle('active', active);
          if (active) link.setAttribute('aria-current', 'location');
          else link.removeAttribute('aria-current');
        });
      }
    });
  }, { rootMargin: '-10% 0px -55% 0px', threshold: 0 });
  sections.forEach((section) => sectionObserver.observe(section));
}

// Public API only: no credentials, stored records, or replacement coordinates.
(() => {
  const container = document.querySelector('#noise-map');
  if (!container) return;
  const endpoint = 'https://sg-community-noise.api.ushahidi.io/api/v5/posts?status%5B%5D=published&form%5B%5D=2&limit=100';
  const status = document.querySelector('#map-status');
  const count = document.querySelector('#map-count');
  const update = document.querySelector('#map-update');
  const showFailure = () => {
    status.querySelector('p').textContent = 'Live observations could not be loaded.';
    status.hidden = false;
    count.textContent = 'REPORTS UNAVAILABLE / LIVE MAP';
    update.textContent = 'AUTOMATIC RETRY EVERY MINUTE.';
  };
  if (!window.L) { showFailure(); return; }

  const map = L.map(container, { scrollWheelZoom: false }).setView([1.3521, 103.8198], container.clientWidth < 450 ? 10 : 11);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
  }).addTo(map);
  const markers = L.layerGroup().addTo(map);
  if ('ResizeObserver' in window) new ResizeObserver(() => map.invalidateSize()).observe(container);

  const dateFormat = new Intl.DateTimeFormat('en-SG', {
    timeZone: 'Asia/Singapore', day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true
  });
  const coordinate = value => {
    if (typeof value !== 'number' && typeof value !== 'string') return NaN;
    return String(value).trim() ? Number(value) : NaN;
  };
  const popup = (post, fields) => {
    const root = document.createElement('div'); root.className = 'noise-popup';
    const title = document.createElement('h3'); title.textContent = post.title || 'Untitled report'; root.append(title);
    const list = document.createElement('dl');
    for (const label of ['Noise Source', 'Perceived Loudness', 'Disturbance Level', 'Time Experienced', 'Duration']) {
      const term = document.createElement('dt'); term.textContent = label;
      const detail = document.createElement('dd');
      let value = fields.get(label);
      if (label === 'Time Experienced' && value) {
        const date = new Date(String(value).replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
        value = Number.isNaN(date.getTime()) ? 'Not available' : `${dateFormat.format(date)} SGT`;
      }
      detail.textContent = value == null || value === '' ? 'Not provided' : String(value);
      list.append(term, detail);
    }
    root.append(list);
    if (typeof post.content === 'string' && post.content.trim()) {
      const description = document.createElement('p'); description.textContent = post.content; root.append(description);
    }
    return root;
  };

  let loading = false;
  async function refresh() {
    if (loading) return;
    loading = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25000);
    try {
      const posts = new Map();
      // Rebuild each page URL to preserve survey/status filters omitted by API pagination links.
      let page = 1;
      while (true) {
        const url = new URL(endpoint); url.searchParams.set('page', String(page));
        const response = await fetch(url, { credentials: 'omit', mode: 'cors', cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(`API HTTP ${response.status}`);
        const data = await response.json();
        if (!Array.isArray(data.results)) throw new Error('API response has no results array');
        data.results.forEach(post => { if (post.status === 'published' && Number(post.form_id) === 2) posts.set(post.id, post); });
        if (!data.links?.next) break;
        if (page >= 1000) throw new Error('API pagination exceeded safety limit');
        page += 1;
      }
      const valid = [];
      let skipped = 0;
      for (const post of posts.values()) {
        const fields = new Map((post.post_content || []).flatMap(stage => stage.fields || []).map(field => [field.label, field.value?.value]));
        const location = fields.get('Location');
        const lat = coordinate(location?.lat), lon = coordinate(location?.lon);
        // Broad Singapore-region bounds, not a precise national-border test.
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < 1.15 || lat > 1.5 || lon < 103.6 || lon > 104.15) {
          console.warn(`[Noise Map] Skipped published report ${post.id}: invalid or outside Singapore-region coordinates.`, {lat, lon});
          skipped += 1; continue;
        }
        valid.push({ post, fields, lat, lon });
      }
      markers.clearLayers();
      for (const {post, fields, lat, lon} of valid) {
        const marker = L.circleMarker([lat, lon], {
          radius: 4.5,
          fillColor: '#FFB400', fillOpacity: 0.75, stroke: false
        }).addTo(markers).bindPopup(popup(post, fields), { maxWidth: 260, maxHeight: 330 });
        const element = marker.getElement();
        element.setAttribute('tabindex', '0'); element.setAttribute('role', 'button');
        element.setAttribute('aria-label', `View report: ${post.title || 'Untitled report'}`);
        element.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); marker.openPopup(); }
        });
      }
      count.textContent = `${String(valid.length).padStart(2, '0')} REPORTS / LIVE MAP`;
      update.textContent = `${posts.size} PUBLISHED / ${valid.length} MAPPED${skipped ? ` / ${skipped} OUTSIDE REGION OR INVALID` : ''}. REFRESHES EVERY MINUTE.`;
      status.hidden = valid.length > 0;
      if (!valid.length) status.querySelector('p').textContent = 'No published Singapore observations to display yet.';
    } catch (error) {
      markers.clearLayers();
      console.error('[Noise Map] Live observations could not be loaded.', error);
      showFailure();
    } finally { clearTimeout(timeout); loading = false; }
  }
  refresh();
  setInterval(() => { if (!document.hidden) refresh(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
})();
