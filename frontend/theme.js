(function() {
  const savedTheme = localStorage.getItem('app_theme') || 'light';
  // Apply immediately to prevent white flash on load
  document.documentElement.setAttribute('data-theme', savedTheme);

  const updateUI = (theme) => {
    // Update any existing theme toggle buttons (navbar buttons across pages)
    const ids = ['theme-toggle-btn', 'navThemeToggleBtn', 'themeToggle'];
    ids.forEach((id) => {
      const btn = document.getElementById(id);
      if (!btn) return;
      // Sun icon for dark mode (click to go light), Moon for light mode (click to go dark)
      btn.innerHTML = theme === 'dark'
        ? '<span style="filter: drop-shadow(0 0 5px #fde047)">☀️</span>'
        : '<span style="filter: drop-shadow(0 0 5px #fff)">🌙</span>';
    });
  };

  window.toggleTheme = () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';

    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('app_theme', next);
    updateUI(next);
  };

  window.addEventListener('DOMContentLoaded', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    // DO NOT inject any floating button. Only update existing toggles (if present)
    updateUI(currentTheme);
  });
})();

