// Business profile settings page: DOM glue. Pure logic lives in ../lib/business-profile.ts
import type { BusinessProfile } from '../lib/business-profile.ts';
import {
  blankBusinessProfile,
  profileIsEmpty,
  loadBusinessProfile,
  saveBusinessProfile,
  clearBusinessProfile,
  exportBusinessProfile,
  parseBusinessProfileFile,
} from '../lib/business-profile.ts';
import { el, showError, hideError, loadImage, downloadText } from './common.ts';
import {
  blankBusinessExtras,
  blankBusinessSocial,
  loadBusinessExtras,
  saveBusinessExtras,
  serializeBusinessExtras,
  deserializeBusinessExtras,
  type BusinessExtras,
} from '../lib/business-extras.ts';

const LOGO_MAX = 360;

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export function initBusinessProfile(): void {
  let profile: BusinessProfile = loadBusinessProfile();
  let extras: BusinessExtras = loadBusinessExtras();
  let saveTimer: ReturnType<typeof setTimeout> | null = null;

  /** Shrink a logo to at most 360px on the long edge. PNG stays PNG, everything else becomes JPEG. */
  async function downscaleLogo(file: File): Promise<string> {
    const url = URL.createObjectURL(file);
    try {
      const img = await loadImage(url);
      const scale = Math.min(1, LOGO_MAX / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not read that image.');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      return file.type === 'image/png' ? canvas.toDataURL('image/png') : canvas.toDataURL('image/jpeg', 0.85);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function fieldIds(): [keyof BusinessProfile, string][] {
    return [
      ['name', 'bp-name'],
      ['tagline', 'bp-tagline'],
      ['address', 'bp-address'],
      ['email', 'bp-email'],
      ['phone', 'bp-phone'],
      ['website', 'bp-website'],
      ['color', 'bp-color'],
    ];
  }

  function fillForm(p: BusinessProfile): void {
    for (const [key, id] of fieldIds()) {
      const input = el<HTMLInputElement | HTMLTextAreaElement>(id);
      if (key === 'color') {
        input.value = p.color || '#a63d21';
      } else {
        input.value = p[key];
      }
    }
    el<HTMLInputElement>('bp-category').value = extras.category;
    el<HTMLTextAreaElement>('bp-hours').value = extras.hours;
    renderSocials();
    renderLogoPreview();
    updateEmptyNote();
  }

  function readForm(): BusinessProfile {
    const p = blankBusinessProfile();
    for (const [key, id] of fieldIds()) {
      const input = el<HTMLInputElement | HTMLTextAreaElement>(id);
      if (key === 'color') {
        // The color input always shows something; treat the untouched default as unset.
        p.color = input.value === '#a63d21' && profile.color === '' ? '' : input.value;
      } else {
        p[key] = input.value;
      }
    }
    p.logoDataUrl = profile.logoDataUrl;
    return p;
  }

  function renderLogoPreview(): void {
    const img = el<HTMLImageElement>('bp-logo-preview');
    const clearBtn = el<HTMLButtonElement>('bp-logo-clear');
    if (profile.logoDataUrl) {
      img.src = profile.logoDataUrl;
      img.hidden = false;
      clearBtn.hidden = false;
    } else {
      img.removeAttribute('src');
      img.hidden = true;
      clearBtn.hidden = true;
    }
  }

  function updateEmptyNote(): void {
    el('bp-empty-note').hidden = !profileIsEmpty(profile);
  }

  function persist(): void {
    saveBusinessProfile(profile);
    saveBusinessExtras(extras);
    const note = el('bp-saved');
    note.hidden = false;
    window.setTimeout(() => {
      note.hidden = true;
    }, 2000);
  }

  function scheduleSave(): void {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 400);
  }

  /** Write immediately, dropping any pending debounced save. */
  function flushSave(): void {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    persist();
  }

  // The 400 ms debounce can lose the tail of what was typed if the tab closes
  // inside the window. Flush on both events. persist() is idempotent.
  window.addEventListener('pagehide', flushSave);
  window.addEventListener('beforeunload', flushSave);

  function handleInput(): void {
    hideError('bp-error');
    profile = readForm();
    extras = readExtras();
    scheduleSave();
    updateEmptyNote();
  }

  function readExtras(): BusinessExtras {
    return {
      category: el<HTMLInputElement>('bp-category').value.slice(0, 80),
      hours: el<HTMLTextAreaElement>('bp-hours').value.slice(0, 500),
      socials: extras.socials,
    };
  }

  function renderSocials(): void {
    const box = el('bp-socials');
    if (extras.socials.length === 0) {
      box.innerHTML = '<p class="empty-state">No social profiles yet.</p>';
      return;
    }
    box.innerHTML = extras.socials
      .map(
        (s) => `<div class="fd-col" data-id="${s.id}">
          <input type="text" class="fd-label" data-bpsocial="label" data-id="${s.id}" value="${escapeHtml(s.label)}" placeholder="LinkedIn" aria-label="Social profile label" maxlength="40" />
          <input type="text" class="fd-label" data-bpsocial="url" data-id="${s.id}" value="${escapeHtml(s.url)}" placeholder="https://…" aria-label="Social profile URL" maxlength="300" />
          <span class="fd-actions">
            <button type="button" class="icon-btn" data-bpsocial-del="${s.id}" aria-label="Remove social profile">×</button>
          </span>
        </div>`
      )
      .join('');
  }

  // text fields, color picker, address textarea
  for (const [, id] of fieldIds()) {
    el(id).addEventListener('input', handleInput);
  }
  el('bp-category').addEventListener('input', handleInput);
  el('bp-hours').addEventListener('input', handleInput);

  el('bp-socials').addEventListener('input', (e) => {
    const input = (e.target as HTMLElement).closest('input[data-bpsocial]') as HTMLInputElement | null;
    if (!input) return;
    const s = extras.socials.find((x) => x.id === input.getAttribute('data-id'));
    if (!s) return;
    const which = input.getAttribute('data-bpsocial');
    if (which === 'label') s.label = input.value.slice(0, 40);
    else if (which === 'url') s.url = input.value.slice(0, 300);
    scheduleSave();
  });
  el('bp-socials').addEventListener('click', (e) => {
    const btn = (e.target as HTMLElement).closest('button[data-bpsocial-del]');
    if (!btn) return;
    const id = btn.getAttribute('data-bpsocial-del') ?? '';
    extras = { ...extras, socials: extras.socials.filter((x) => x.id !== id) };
    renderSocials();
    scheduleSave();
  });
  el('bp-add-social').addEventListener('click', () => {
    extras = { ...extras, socials: [...extras.socials, blankBusinessSocial()].slice(0, 12) };
    renderSocials();
    scheduleSave();
  });

  el('bp-save').addEventListener('click', () => {
    hideError('bp-error');
    profile = readForm();
    persist();
  });

  // logo upload
  el('bp-logo-input').addEventListener('change', async () => {
    const input = el<HTMLInputElement>('bp-logo-input');
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showError('bp-error', 'That file is not an image. Choose a JPG or PNG logo.');
      return;
    }
    hideError('bp-error');
    try {
      profile.logoDataUrl = await downscaleLogo(file);
      renderLogoPreview();
      scheduleSave();
    } catch {
      showError('bp-error', 'Could not read that image. Try a different file.');
    }
  });

  el('bp-logo-clear').addEventListener('click', () => {
    profile.logoDataUrl = '';
    renderLogoPreview();
    scheduleSave();
  });

  // export
  el('bp-export').addEventListener('click', () => {
    hideError('bp-error');
    try {
      const base = JSON.parse(exportBusinessProfile()) as Record<string, unknown>;
      base.extras = JSON.parse(serializeBusinessExtras(extras));
      downloadText('business-profile.json', JSON.stringify(base, null, 2), 'application/json');
    } catch {
      showError('bp-error', 'Could not create the export file.');
    }
  });

  // import
  el('bp-import').addEventListener('click', () => {
    el<HTMLInputElement>('bp-import-input').click();
  });
  el('bp-import-input').addEventListener('change', () => {
    const input = el<HTMLInputElement>('bp-import-input');
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = String(reader.result ?? '');
        // Newer exports carry the extra fields under "extras"; older exports
        // simply have none, in which case the current extras are kept.
        try {
          const parsed = JSON.parse(raw) as Record<string, unknown>;
          if (parsed && typeof parsed.extras === 'object' && parsed.extras !== null) {
            extras = deserializeBusinessExtras(JSON.stringify(parsed.extras));
          }
        } catch {
          // keep current extras
        }
        profile = parseBusinessProfileFile(raw);
        hideError('bp-error');
        fillForm(profile);
        persist();
      } catch (err) {
        showError('bp-error', err instanceof Error ? err.message : 'Could not read that file.');
      }
    };
    reader.onerror = () => showError('bp-error', 'Could not read that file.');
    reader.readAsText(file);
  });

  // clear (two-step inline confirm: native confirm() is auto-dismissed in
  // some contexts, which made the button look broken)
  const clearBtn = el<HTMLButtonElement>('bp-clear');
  let clearArmed = false;
  let clearTimer: number | undefined;
  function disarmClear(): void {
    clearArmed = false;
    clearBtn.textContent = 'Clear';
    clearBtn.classList.remove('btn-armed');
    if (clearTimer) window.clearTimeout(clearTimer);
    clearTimer = undefined;
  }
  clearBtn.addEventListener('click', () => {
    if (!clearArmed) {
      clearArmed = true;
      clearBtn.textContent = 'Click again to delete';
      clearBtn.classList.add('btn-armed');
      clearTimer = window.setTimeout(disarmClear, 5000);
      return;
    }
    disarmClear();
    clearBusinessProfile();
    profile = blankBusinessProfile();
    extras = blankBusinessExtras();
    fillForm(profile);
    persist();
  });

  fillForm(profile);
}
