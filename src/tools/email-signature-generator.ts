// Email signature generator: DOM glue. Pure model logic lives in ../lib/signature-core.ts
import type { SignatureData, SignatureLayout } from '../lib/signature-core.ts';
import {
  ACCENT_SWATCHES,
  LAYOUTS,
  SIGNATURE_STORAGE_KEY,
  blankSignature,
  blankSocialLink,
  exampleSignature,
  isLayoutId,
  isAccentId,
  validateSignature,
  serializeSignature,
  deserializeSignature,
  renderSignature,
} from '../lib/signature-core.ts';
import { el, showError, hideError, ICONS, downscaleImageFile } from './common.ts';
import { loadBusinessProfile, saveBusinessProfile, profileIsEmpty } from '../lib/business-profile.ts';

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function initSignatureGenerator(): void {
  let sig: SignatureData = loadSignature();
  syncBusinessProfile();
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let copiedTimer: ReturnType<typeof setTimeout> | null = null;

  const editor = el('es-editor');
  const preview = el('es-preview');
  const code = el('es-code');

  function loadSignature(): SignatureData {
    try {
      return deserializeSignature(localStorage.getItem(SIGNATURE_STORAGE_KEY));
    } catch {
      return blankSignature(); // storage blocked or unavailable
    }
  }

  // ---------- business profile sync ----------
  //
  // The shared business profile fills empty company fields, and a one-time
  // migration copies details already saved here into the profile. Name and job
  // title are personal, not business data, so they are never touched.

  function syncBusinessProfile(): void {
    const hasDetails = [sig.company, sig.address, sig.email, sig.phone, sig.website, sig.photoDataUrl].some(
      (v) => v.trim() !== ''
    );
    const profile = loadBusinessProfile();
    if (!profileIsEmpty(profile)) {
      if (!hasDetails) {
        sig.company = profile.name;
        sig.address = profile.address;
        sig.email = profile.email;
        sig.phone = profile.phone;
        sig.website = profile.website;
        sig.photoDataUrl = profile.logoDataUrl;
      }
      return;
    }
    // Profile is empty: migrate this tool's own saved details once, but never
    // the shipped example content.
    const isExample = sig.name.trim() === 'Sam Rivera' && sig.company.trim() === 'Northwind Mobile';
    if (hasDetails && !isExample) {
      saveBusinessProfile({
        name: sig.company,
        tagline: '',
        address: sig.address,
        email: sig.email,
        phone: sig.phone,
        website: sig.website,
        color: '',
        logoDataUrl: sig.photoDataUrl,
      });
    }
  }

  function save(): void {
    try {
      localStorage.setItem(SIGNATURE_STORAGE_KEY, serializeSignature(sig));
    } catch {
      // Storage full or blocked: the tool still works for this session.
    }
  }

  function scheduleSave(): void {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 400);
  }

  function currentHtml(): string {
    return renderSignature(sig);
  }

  // ---------- preview + code view ----------

  function renderPreview(): void {
    const html = currentHtml();
    preview.innerHTML = html;
    code.textContent = html;
  }

  // ---------- editor ----------

  function field(f: keyof SignatureData, label: string, ph: string): string {
    const value = String(sig[f] ?? '');
    return `<label class="rb-field"><span>${escapeHtml(label)}</span><input type="text" data-field="${f}" value="${escapeHtml(value)}" placeholder="${escapeHtml(ph)}" /></label>`;
  }

  function editorHtml(): string {
    const s = sig;
    const photo = s.photoDataUrl
      ? `<div class="logo-pick"><img class="thumb" src="${escapeHtml(s.photoDataUrl)}" alt="Photo" style="border-radius:50%;" /><span class="file-name-label">Photo added</span><button type="button" class="link-btn" id="es-photo-clear">Remove</button></div>`
      : `<div class="logo-pick"><label class="btn btn-secondary btn-small" for="es-photo-input" style="cursor:pointer;">Upload photo</label><input type="file" id="es-photo-input" accept="image/*" hidden /><span class="file-name-label">Optional. Shows in Stacked and Two-column.</span></div>`;

    const layoutCards = LAYOUTS.map(
      (l) => `<label class="radio-card">
        <input type="radio" name="es-layout" value="${l.id}" ${s.layout === l.id ? 'checked' : ''} />
        <span><strong>${escapeHtml(l.name)}</strong><small>${escapeHtml(l.tagline)}</small></span>
      </label>`
    ).join('');

    const swatches = ACCENT_SWATCHES.map(
      (a) => `<button type="button" class="swatch${s.accent === a.id ? ' swatch-active' : ''}" data-accent="${a.id}" title="${escapeHtml(a.name)}" aria-label="${escapeHtml(a.name)} accent" aria-pressed="${s.accent === a.id}">
        <span style="background:${a.hex};"></span>
      </button>`
    ).join('');

    const socialRows = s.socials
      .map(
        (soc, i) => `<div class="rb-entry">
        <div class="rb-entry-bar">
          <span class="rb-entry-title">${escapeHtml(soc.label || soc.url || `Link ${i + 1}`)}</span>
          <button type="button" class="icon-btn" data-sact="remove" data-id="${soc.id}" aria-label="Remove">${ICONS.x}</button>
        </div>
        <div class="rb-grid">
          <label class="rb-field"><span>Label</span><input type="text" data-sfield="label" data-id="${soc.id}" value="${escapeHtml(soc.label)}" placeholder="LinkedIn" /></label>
          <label class="rb-field"><span>URL</span><input type="text" data-sfield="url" data-id="${soc.id}" value="${escapeHtml(soc.url)}" placeholder="https://linkedin.com/in/you" /></label>
        </div>
      </div>`
      )
      .join('');

    return `
      <section class="rb-section" aria-label="Your details">
        <div class="rb-section-head"><h3>Your details</h3></div>
        <div class="rb-grid">
          ${field('name', 'Name', 'Sam Rivera')}
          ${field('title', 'Job title', 'Senior Product Designer')}
          ${field('company', 'Company', 'Northwind Mobile')}
          ${field('phone', 'Phone', '(415) 555-0132')}
          ${field('email', 'Email', 'sam.rivera@example.com')}
          ${field('website', 'Website', 'samrivera.design')}
        </div>
        <label class="rb-field" style="margin-top:0.65rem;"><span>Address</span><input type="text" data-field="address" value="${escapeHtml(s.address)}" placeholder="San Francisco, CA" /></label>
        <div style="margin-top:0.65rem;">${photo}</div>
      </section>
      <section class="rb-section" aria-label="Layout">
        <div class="rb-section-head"><h3>Layout</h3></div>
        <div class="radio-cards">${layoutCards}</div>
      </section>
      <section class="rb-section" aria-label="Accent color">
        <div class="rb-section-head"><h3>Accent color</h3></div>
        <p class="rb-hint">Six tasteful presets. The accent colors your name divider, icons, and links.</p>
        <div class="swatches" role="group" aria-label="Accent color">${swatches}</div>
      </section>
      <section class="rb-section" aria-label="Social links">
        <div class="rb-section-head"><h3>Social links</h3><button type="button" class="btn btn-secondary btn-small" id="es-add-social">Add link</button></div>
        <p class="rb-hint">Optional. LinkedIn, portfolio, company site — whatever belongs in a signature.</p>
        <div id="es-socials">${socialRows}</div>
      </section>`;
  }

  function renderEditor(): void {
    editor.innerHTML = editorHtml();
  }

  // ---------- model updates ----------

  editor.addEventListener('input', (e) => {
    const t = e.target as HTMLElement;
    const f = t.closest('[data-field]') as HTMLElement | null;
    const sf = t.closest('[data-sfield]') as HTMLElement | null;
    if (f && !sf) {
      const fieldName = f.getAttribute('data-field') as keyof SignatureData;
      if (typeof sig[fieldName] === 'string') {
        (sig as unknown as Record<string, string>)[fieldName as string] = (f as HTMLInputElement).value;
        scheduleSave();
        renderPreview();
      }
      return;
    }
    if (sf) {
      const id = sf.getAttribute('data-id') ?? '';
      const key = sf.getAttribute('data-sfield')!;
      const soc = sig.socials.find((x) => x.id === id);
      if (soc && (key === 'label' || key === 'url')) {
        soc[key] = (sf as HTMLInputElement).value;
        scheduleSave();
        renderPreview();
      }
    }
  });

  editor.addEventListener('change', (e) => {
    const t = e.target as HTMLElement;
    const radio = t.closest('input[name="es-layout"]') as HTMLInputElement | null;
    if (radio && isLayoutId(radio.value)) {
      sig.layout = radio.value as SignatureLayout;
      scheduleSave();
      renderPreview();
      renderEditor();
      return;
    }
    const fileInput = t.closest('#es-photo-input') as HTMLInputElement | null;
    if (fileInput && fileInput.files && fileInput.files.length > 0) {
      const file = fileInput.files[0];
      if (!file.type.startsWith('image/')) {
        showError('es-error', 'That file is not an image. Choose a JPG or PNG photo.');
        return;
      }
      hideError('es-error');
      downscaleImageFile(file, 300)
        .then((dataUrl) => {
          sig.photoDataUrl = dataUrl;
          scheduleSave();
          renderEditor();
          renderPreview();
        })
        .catch(() => showError('es-error', 'Could not read that image. Try a different file.'));
    }
  });

  editor.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    if (t.closest('#es-photo-clear')) {
      sig.photoDataUrl = '';
      scheduleSave();
      renderEditor();
      renderPreview();
      return;
    }
    if (t.closest('#es-add-social')) {
      sig.socials = [...sig.socials, blankSocialLink()];
      scheduleSave();
      renderEditor();
      return;
    }
    const sw = t.closest('button[data-accent]') as HTMLElement | null;
    if (sw) {
      const id = sw.getAttribute('data-accent')!;
      if (isAccentId(id)) {
        sig.accent = id;
        scheduleSave();
        renderPreview();
        editor.querySelectorAll('.swatch').forEach((b) => {
          const on = b.getAttribute('data-accent') === id;
          b.classList.toggle('swatch-active', on);
          b.setAttribute('aria-pressed', String(on));
        });
      }
      return;
    }
    const rm = t.closest('button[data-sact="remove"]') as HTMLElement | null;
    if (rm) {
      const id = rm.getAttribute('data-id') ?? '';
      sig.socials = sig.socials.filter((x) => x.id !== id);
      scheduleSave();
      renderEditor();
      renderPreview();
    }
  });

  // ---------- copy ----------

  async function copyHtml(): Promise<void> {
    hideError('es-error');
    const problems = validateSignature(sig);
    if (problems.length > 0) {
      showError('es-error', 'Before copying: ' + problems.join(' '));
      el('es-error').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    const html = currentHtml();
    try {
      await navigator.clipboard.writeText(html);
      copied('HTML copied to your clipboard.');
    } catch {
      // Fallback for older browsers / non-secure contexts.
      const ta = document.createElement('textarea');
      ta.value = html;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        const done = document.execCommand('copy');
        copied(done ? 'HTML copied to your clipboard.' : 'Copy did not work in this browser.');
      } catch {
        copied('Copy did not work in this browser.');
      }
      ta.remove();
    }
  }

  function copied(msg: string): void {
    const note = el('es-copied');
    note.textContent = msg;
    note.hidden = false;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
      note.hidden = true;
    }, 3000);
  }

  el('es-copy').addEventListener('click', copyHtml);
  el('es-copy-rich').addEventListener('click', copyRichText);

  /** Copy the rendered signature so it pastes as formatted text into Gmail/Outlook. */
  async function copyRichText(): Promise<void> {
    hideError('es-error');
    const problems = validateSignature(sig);
    if (problems.length > 0) {
      showError('es-error', 'Before copying: ' + problems.join(' '));
      el('es-error').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    const html = currentHtml();
    try {
      const item = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([html], { type: 'text/plain' }),
      });
      await navigator.clipboard.write([item]);
      copied('Signature copied. Paste it into your email signature settings.');
    } catch {
      // Fallback: select the rendered preview and copy the selection.
      const range = document.createRange();
      range.selectNodeContents(preview);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
      try {
        const done = document.execCommand('copy');
        copied(done ? 'Signature copied. Paste it into your email signature settings.' : 'Copy did not work in this browser.');
      } catch {
        copied('Copy did not work in this browser.');
      }
      sel?.removeAllRanges();
    }
  }

  // ---------- toolbar ----------

  el('es-example').addEventListener('click', () => {
    if (!window.confirm('Replace your current signature with the example content?')) return;
    sig = exampleSignature();
    save();
    renderEditor();
    renderPreview();
  });

  el('es-clear').addEventListener('click', () => {
    if (!window.confirm('Clear everything and start over? This cannot be undone.')) return;
    sig = blankSignature();
    save();
    renderEditor();
    renderPreview();
  });

  renderEditor();
  renderPreview();

  // ---------- mobile tabs ----------

  el('es-tab-edit').addEventListener('click', () => {
    el('es-workspace').classList.remove('show-preview');
    el('es-tab-edit').classList.add('tab-active');
    el('es-tab-preview').classList.remove('tab-active');
  });
  el('es-tab-preview').addEventListener('click', () => {
    el('es-workspace').classList.add('show-preview');
    el('es-tab-preview').classList.add('tab-active');
    el('es-tab-edit').classList.remove('tab-active');
  });
}
