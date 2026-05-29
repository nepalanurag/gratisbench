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

const LOGO_MAX = 360;

export function initBusinessProfile(): void {
  let profile: BusinessProfile = loadBusinessProfile();
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

  function handleInput(): void {
    hideError('bp-error');
    profile = readForm();
    scheduleSave();
    updateEmptyNote();
  }

  // text fields, color picker, address textarea
  for (const [, id] of fieldIds()) {
    el(id).addEventListener('input', handleInput);
  }

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
      downloadText('business-profile.json', exportBusinessProfile(), 'application/json');
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
        profile = parseBusinessProfileFile(String(reader.result ?? ''));
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
    fillForm(profile);
    persist();
  });

  fillForm(profile);
}
