const sidebar = document.querySelector('#sidebar');
const menuButton = document.querySelector('#menuButton');
const sidebarScrim = document.querySelector('#sidebarScrim');
const promptInput = document.querySelector('#prompt');
const promptCount = document.querySelector('#promptCount');
const toast = document.querySelector('#toast');

function setSidebar(open) {
  sidebar.classList.toggle('is-open', open);
  menuButton?.setAttribute('aria-expanded', String(open));
  sidebarScrim.hidden = !open;
}

function updatePromptCount() {
  promptCount.textContent = `${promptInput.value.length} / ${promptInput.maxLength}`;
}

function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => { toast.hidden = true; }, 2600);
}

menuButton?.addEventListener('click', () => setSidebar(!sidebar.classList.contains('is-open')));
sidebarScrim?.addEventListener('click', () => setSidebar(false));
promptInput?.addEventListener('input', updatePromptCount);

document.querySelectorAll('.p-nav-item').forEach((item) => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.p-nav-item').forEach((nav) => {
      nav.classList.toggle('is-active', nav === item);
      nav.toggleAttribute('aria-current', nav === item);
    });
    document.querySelectorAll('[data-panel]').forEach((panel) => {
      panel.hidden = panel.dataset.panel !== item.dataset.section;
    });
    setSidebar(false);
  });
});

document.querySelectorAll('[data-select-card]').forEach((card) => {
  card.addEventListener('click', () => {
    document.querySelectorAll('[data-select-card]').forEach((candidate) => candidate.classList.toggle('is-selected', candidate === card));
  });
});

document.querySelectorAll('[data-toggle-status]').forEach((row) => {
  row.addEventListener('click', () => {
    const dot = row.querySelector('.p-status-dot');
    const label = row.querySelector('small');
    const online = dot.classList.toggle('is-online');
    dot.classList.remove('is-working', 'is-error');
    label.textContent = online ? 'Online' : 'Offline';
  });
});

document.querySelector('#enhanceButton')?.addEventListener('click', () => {
  if (!promptInput.value.toLowerCase().includes('high-contrast')) {
    promptInput.value = `${promptInput.value.trim()} Use high-contrast sculpted lighting, clean composition, and refined material detail.`;
    updatePromptCount();
  }
  showToast('Prompt enhanced.');
});

document.querySelector('#promptForm')?.addEventListener('submit', (event) => {
  event.preventDefault();
  showToast('Prompt queued locally.');
});

updatePromptCount();
